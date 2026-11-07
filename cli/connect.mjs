// `corvid connect/disconnect/doctor` — register the Corvid Browser MCP server and
// the corvid-browser skill with external agent hosts (Claude Code, Codex, Cursor, dsh).
//
// Safety contract (docs/execution/external-agent-integration-plan.md P0):
// - Third-party config files are only written after the user explicitly runs
//   `corvid connect` and confirms the listed changes (`--yes` for non-interactive use).
// - `corvid disconnect` reverts exactly what connect wrote; entries modified by the
//   user are reported and left untouched.
// - Tests never touch real home directories: every path is derived from `homedir()`,
//   so tests run with a sandboxed HOME.

import { readFile, writeFile, mkdir, rm, copyFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { parse as tomlParse } from 'smol-toml';
import { parseDocument as yamlParseDocument, parse as yamlParse } from 'yaml';
import { connect as connectAdmin } from '../sdk/index.js';

const require = createRequire(import.meta.url);

export const SERVER_NAME = 'corvid-browser';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = join(REPO_ROOT, 'mcp', 'corvid.mjs');
const SKILL_SOURCE = join(REPO_ROOT, 'skills', 'corvid-browser', 'SKILL.md');
const TOKEN_ENV_KEY = 'CORVID_AGENT_TOKEN';
export const HOST_IDS = ['claude-code', 'codex', 'cursor', 'dsh'];

const HOST_LABELS = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'cursor': 'Cursor',
  'dsh': 'DeepSeek Harness (dsh)',
};

export function hostLabel(host) { return HOST_LABELS[host] || host; }

// ---- Deep equality for config entries ----

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function tomlString(value) { return JSON.stringify(value); }

// ---- Host adapters ----

class Aborted extends Error {}
class ConflictingEntry extends Error {}

function jsonHost({ configPath, entryType }) {
  return {
    kind: 'json',
    configPath,
    async readPlan(token) {
      const current = await readJsonIfExists(configPath);
      const servers = current?.mcpServers && typeof current.mcpServers === 'object' ? current.mcpServers : {};
      const entry = jsonEntry(entryType, token);
      const existing = servers[SERVER_NAME];
      return {
        path: configPath,
        create: !existsSync(configPath),
        action: existing === undefined ? 'add' : sameValue(existing, entry) ? 'current' : 'replace',
        entry,
        existing,
      };
    },
    async apply(token) {
      const current = await readJsonIfExists(configPath);
      const entry = jsonEntry(entryType, token);
      const servers = current?.mcpServers && typeof current.mcpServers === 'object' && !Array.isArray(current.mcpServers) ? { ...current.mcpServers } : {};
      servers[SERVER_NAME] = entry;
      await writeJson(configPath, { ...current, mcpServers: servers });
    },
    async remove() {
      const current = await readJsonIfExists(configPath);
      if (!current?.mcpServers?.[SERVER_NAME]) return { removed: false, reason: 'not-registered' };
      const servers = { ...current.mcpServers };
      const existing = servers[SERVER_NAME];
      delete servers[SERVER_NAME];
      await writeJson(configPath, { ...current, mcpServers: servers });
      return { removed: true, drifted: !isManagedJsonEntry(existing) };
    },
    async inspect() {
      const current = await readJsonIfExists(configPath);
      const existing = current?.mcpServers?.[SERVER_NAME];
      if (!existing) return { registered: false };
      const expected = jsonEntry(entryType, undefined);
      const tokenMatches = typeof existing?.env?.[TOKEN_ENV_KEY] === 'string' && existing.env[TOKEN_ENV_KEY].length > 0;
      return { registered: true, current: existing, matchesBase: sameValue({ ...existing, env: undefined }, { ...expected, env: undefined }), hasToken: tokenMatches };
    },
  };
}

function jsonEntry(entryType, token) {
  const entry = entryType ? { type: entryType, command: 'node', args: [SERVER_ENTRY] } : { command: 'node', args: [SERVER_ENTRY] };
  if (token) entry.env = { [TOKEN_ENV_KEY]: token };
  return entry;
}

function isManagedJsonEntry(existing) {
  const withToken = jsonEntry(undefined, 'x');
  const withoutToken = jsonEntry(undefined, undefined);
  const strip = entry => ({ ...entry, env: entry?.env ? { ...entry.env, [TOKEN_ENV_KEY]: 'x' } : undefined });
  return sameValue(strip(existing), strip(withToken)) || sameValue(strip(existing), strip(withoutToken));
}

async function readJsonIfExists(path) {
  if (!existsSync(path)) return undefined;
  const text = await readFile(path, 'utf8');
  try { return JSON.parse(text); }
  catch (error) { throw new Aborted(`${path} 不是有效的 JSON，已中止（请手动修复后重试）`); }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function codexHost({ configPath }) {
  const header = `[mcp_servers.${SERVER_NAME}]`;
  const sectionRe = new RegExp(`^\\[mcp_servers\\.(?:"${SERVER_NAME}"|${SERVER_NAME.replace(/[.-]/g, m => `\\${m}`)})\\]\\s*$`);
  const anySectionRe = /^\[/;
  function block(token) {
    const lines = [header, `command = "node"`, `args = [${tomlString(SERVER_ENTRY)}]`];
    if (token) lines.push(`env = { ${TOKEN_ENV_KEY} = ${tomlString(token)} }`);
    return lines.join('\n');
  }
  function parseToml(text, label) {
    try { return tomlParse(text); }
    catch (error) { throw new Aborted(`${configPath} 无法按 TOML 解析（${error.message}），已中止`); }
  }
  function splitOffSection(lines) {
    const start = lines.findIndex(line => sectionRe.test(line));
    if (start < 0) return { lines, removed: null };
    let end = start + 1;
    while (end < lines.length && !anySectionRe.test(lines[end])) end++;
    return { lines: [...lines.slice(0, start), ...lines.slice(end)], removed: lines.slice(start, end).join('\n') };
  }
  return {
    kind: 'toml',
    configPath,
    async readPlan(token) {
      if (!existsSync(configPath)) return { path: configPath, create: true, action: 'add', entry: block(token), existing: null };
      const before = parseToml(await readFile(configPath, 'utf8'));
      const existing = before.mcp_servers?.[SERVER_NAME];
      const entry = tomlParse(`${block(token)}\n`);
      const managed = { command: entry.mcp_servers[SERVER_NAME] };
      const action = existing === undefined ? 'add' : sameValue(existing, managed.command) ? 'current' : 'replace';
      return { path: configPath, create: false, action, entry: managed.command, existing };
    },
    async apply(token) {
      const originalText = existsSync(configPath) ? await readFile(configPath, 'utf8') : '';
      const before = parseToml(originalText);
      const { lines } = splitOffSection(originalText.split('\n'));
      const nextText = [...lines.filter((line, index) => !(index === lines.length - 1 && line === '')), block(token), ''].join('\n');
      const after = parseToml(nextText);
      const strip = data => JSON.stringify({ ...data, mcp_servers: { ...data.mcp_servers, [SERVER_NAME]: undefined } });
      if (strip(before) !== strip(after)) throw new ConflictingEntry('编辑会改动配置文件的其他内容，已中止');
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, nextText, { mode: 0o600 });
    },
    async remove() {
      if (!existsSync(configPath)) return { removed: false, reason: 'not-registered' };
      const text = await readFile(configPath, 'utf8');
      const { lines, removed } = splitOffSection(text.split('\n'));
      if (removed === null) return { removed: false, reason: 'not-registered' };
      const before = parseToml(text), after = parseToml(lines.join('\n'));
      const strip = data => JSON.stringify({ ...data, mcp_servers: { ...data.mcp_servers, [SERVER_NAME]: undefined } });
      const drifted = strip(before) !== strip(after) || !isManagedTomlEntry(before.mcp_servers?.[SERVER_NAME]);
      const trimmed = lines.join('\n').replace(/\n+$/, '\n');
      await writeFile(configPath, trimmed, { mode: 0o600 });
      return { removed: true, drifted };
    },
    async inspect() {
      if (!existsSync(configPath)) return { registered: false };
      const data = parseToml(await readFile(configPath, 'utf8'));
      const existing = data.mcp_servers?.[SERVER_NAME];
      if (!existing) return { registered: false };
      const managed = tomlParse(`${block(undefined)}\n`).mcp_servers[SERVER_NAME];
      return {
        registered: true, current: existing,
        matchesBase: sameValue({ ...existing, env: undefined }, { ...managed, env: undefined }),
        hasToken: typeof existing?.env?.[TOKEN_ENV_KEY] === 'string' && existing.env[TOKEN_ENV_KEY].length > 0,
      };
    },
  };
}

function isManagedTomlEntry(existing) {
  if (!existing || existing.command !== 'node' || !Array.isArray(existing.args) || existing.args.length !== 1) return false;
  const keys = Object.keys(existing).filter(key => key !== 'env');
  if (keys.length !== 2 || keys[0] !== 'command' || keys[1] !== 'args') return false;
  if (existing.args[0] !== SERVER_ENTRY) return false;
  if (existing.env === undefined) return true;
  const envKeys = Object.keys(existing.env);
  return envKeys.length === 1 && envKeys[0] === TOKEN_ENV_KEY;
}

const DSH_PATCH_NAME = '@deepseek-ai/dsh-mcp-client';

function dshHost({ configPath }) {
  function managedYaml(token) {
    const lines = [
      '- insert:',
      `    - id: ${SERVER_NAME}`,
      `      name: "${DSH_PATCH_NAME}"`,
      '      config:',
      '        transport: stdio',
      `        serverName: ${SERVER_NAME}`,
      '        command: node',
      '        args:',
      `          - ${SERVER_ENTRY}`,
    ];
    if (token) lines.push('        env:', `          ${TOKEN_ENV_KEY}: ${token}`);
    return `${lines.join('\n')}\n`;
  }
  function loadDocument() {
    if (!existsSync(configPath)) return Promise.resolve(null);
    return readFile(configPath, 'utf8').then(text => yamlParseDocument(text, {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }],
    }));
  }
  return {
    kind: 'yaml',
    configPath,
    async readPlan(token) {
      if (!existsSync(configPath)) return { path: configPath, create: true, action: 'add', entry: yamlParse(managedYaml(token))[0], existing: null };
      const document = await loadDocument();
      if (document.errors.length) throw new Aborted(`${configPath} 无法按 YAML 解析，已中止`);
      const items = Array.isArray(document.toJS()) ? document.toJS() : null;
      if (!items) throw new Aborted(`${configPath} 顶层必须是 YAML 数组，已中止`);
      const existing = findManagedItem(items);
      const entry = yamlParse(managedYaml(token))[0];
      const action = existing === undefined ? 'add' : sameValue(existing, entry) ? 'current' : 'replace';
      return { path: configPath, create: false, action, entry, existing };
    },
    async apply(token) {
      const originalText = existsSync(configPath) ? await readFile(configPath, 'utf8') : null;
      let document;
      if (originalText === null) {
        document = yamlParseDocument('[]\n');
      } else {
        document = yamlParseDocument(originalText, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] });
        if (document.errors.length) throw new Aborted(`${configPath} 无法按 YAML 解析，已中止`);
        if (!Array.isArray(document.toJS())) throw new Aborted(`${configPath} 顶层必须是 YAML 数组，已中止`);
      }
      const before = document.toJS();
      const managedIndex = document.contents.items.findIndex(isManagedItem);
      const node = yamlParseDocument(managedYaml(token), { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] }).contents.items[0];
      node.commentBefore = ' Corvid Browser MCP 注册：由 `corvid connect dsh` 写入，`corvid disconnect dsh` 移除。';
      if (managedIndex >= 0) document.contents.items.splice(managedIndex, 1, node);
      else document.contents.items.push(node);
      const text = String(document);
      const afterItems = yamlParse(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] });
      if (!Array.isArray(afterItems)) throw new ConflictingEntry('编辑结果不是 YAML 数组，已中止');
      if (JSON.stringify(before.filter(item => !isManagedItem(item))) !== JSON.stringify(afterItems.filter(item => !isManagedItem(item)))) throw new ConflictingEntry('编辑会改动 patch 文件的其他内容，已中止');
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, text, { mode: 0o600 });
    },
    async remove() {
      if (!existsSync(configPath)) return { removed: false, reason: 'not-registered' };
      const document = await loadDocument();
      if (document.errors.length) throw new Aborted(`${configPath} 无法按 YAML 解析，已中止`);
      const items = document.toJS();
      const existing = findManagedItem(items);
      if (existing === undefined) return { removed: false, reason: 'not-registered' };
      const driftBase = [yamlParse(managedYaml(undefined))[0], yamlParse(managedYaml('x'))[0]].map(entry => JSON.stringify(stripToken(entry)));
      const drifted = !driftBase.includes(JSON.stringify(stripToken(existing)));
      for (let index = document.contents.items.length - 1; index >= 0; index--) {
        if (isManagedItem(items[index])) document.contents.items.splice(index, 1);
      }
      await writeFile(configPath, String(document), { mode: 0o600 });
      return { removed: true, drifted };
    },
    async inspect() {
      if (!existsSync(configPath)) return { registered: false };
      const document = await loadDocument();
      if (document.errors.length) return { registered: false, unparsable: true };
      const existing = findManagedItem(document.toJS());
      if (!existing) return { registered: false };
      return { registered: true, current: existing };
    },
  };
}

function isManagedItem(item) {
  return typeof item === 'object' && item !== null && !('id' in item) && Array.isArray(item.insert)
    && item.insert.some(row => typeof row === 'object' && row !== null && row.id === SERVER_NAME);
}

function stripToken(item) {
  if (typeof item !== 'object' || item === null || !Array.isArray(item.insert)) return item;
  return { ...item, insert: item.insert.map(entry => {
    const config = typeof entry?.config === 'object' && entry.config !== null ? { ...entry.config } : entry?.config;
    if (config && typeof config.env === 'object' && config.env !== null) config.env = { ...config.env, [TOKEN_ENV_KEY]: 'x' };
    return { ...entry, config };
  }) };
}

function findManagedItem(items) {
  return items.find(isManagedItem);
}

export function createHostAdapter(host, home = homedir()) {
  if (host === 'claude-code') return jsonHost({ configPath: join(home, '.claude.json'), entryType: 'stdio' });
  if (host === 'cursor') return jsonHost({ configPath: join(home, '.cursor', 'mcp.json'), entryType: undefined });
  if (host === 'codex') return codexHost({ configPath: join(home, '.codex', 'config.toml') });
  if (host === 'dsh') return dshHost({ configPath: join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml') });
  throw new Aborted(`Unknown host: ${host} (supported: ${HOST_IDS.join(', ')})`);
}

export function skillTargetDir(host, home = homedir()) {
  const dirs = {
    'claude-code': () => join(home, '.claude', 'skills', SERVER_NAME),
    'codex': () => join(home, '.codex', 'skills', SERVER_NAME),
    'cursor': () => join(home, '.cursor', 'skills', SERVER_NAME),
    'dsh': () => join(home, '.dsh', 'skills', SERVER_NAME),
  };
  if (!dirs[host]) throw new Aborted(`Unknown host: ${host}`);
  return dirs[host]();
}

// ---- Connection receipts (what connect wrote, so disconnect can revert + revoke) ----

const CONNECTIONS_FILE = 'agent-connections.json';

function connectionsPath() {
  const { resolveDataDirectory } = require('../desktop/data-directory.cjs');
  return join(resolveDataDirectory({ override: process.env.CORVID_DATA_DIR, homeDir: homedir() }), CONNECTIONS_FILE);
}

function readReceipts() {
  try { return JSON.parse(require('node:fs').readFileSync(connectionsPath(), 'utf8')); }
  catch (error) { return error.code === 'ENOENT' ? { version: 1, hosts: {} } : null; }
}

async function writeReceipts(receipts) {
  await mkdir(dirname(connectionsPath()), { recursive: true });
  await writeFile(connectionsPath(), `${JSON.stringify(receipts, null, 2)}\n`, { mode: 0o600 });
}

// ---- Scoped credential issuance (openRoomGrant; requires the running desktop) ----

async function issueCredential(host) {
  let client;
  try { client = await connectAdmin(); }
  catch (error) {
    throw new Aborted('无法读取本地管理员凭据（Corvid 桌面未运行或 control.json 不可读）；请先启动 Corvid 桌面，或用 --token 显式提供授权客户端凭据');
  }
  try { return await client.createAgentClient(`corvid-${host}`, [], { openRoomGrant: true }); }
  finally { await client.disconnect(); }
}

async function revokeCredential(clientId) {
  try {
    const client = await connectAdmin();
    try { await client.revokeAgentClient(clientId); }
    catch (error) { if (error?.code !== 'CORVID_NOT_FOUND') throw error; }
    finally { await client.disconnect(); }
  } catch (error) {
    if (error?.code === 'ENOENT' || /control\.json|管理员凭据/.test(String(error?.message))) return false;
    throw error;
  }
  return true;
}

// ---- Skill distribution ----

async function skillSourceText() { return readFile(SKILL_SOURCE, 'utf8'); }

async function installSkill(host, home) {
  const target = skillTargetDir(host, home);
  await mkdir(target, { recursive: true });
  await copyFile(SKILL_SOURCE, join(target, 'SKILL.md'));
  return target;
}

async function removeSkill(host, home) {
  const target = skillTargetDir(host, home);
  const skillPath = join(target, 'SKILL.md');
  if (!existsSync(skillPath)) return { removed: false, reason: 'not-installed', path: target };
  const installed = await readFile(skillPath, 'utf8');
  const source = await skillSourceText();
  const drifted = installed !== source;
  if (drifted) return { removed: false, reason: 'modified', path: target };
  await rm(skillPath);
  const rest = (await readdir(target).catch(() => [])).filter(name => name !== '.DS_Store');
  if (!rest.length) await rm(target, { recursive: true, force: true });
  return { removed: true, path: target };
}

// ---- Plan / confirm / apply ----

function formatEntry(value) {
  return JSON.stringify(value, null, 2);
}

async function confirm(question, { yes }) {
  if (yes) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Aborted('非交互环境需要显式确认：加 --yes 重新运行');
  }
  process.stdout.write(`${question} [y/N] `);
  const answer = await new Promise(resolve => {
    let buffer = '';
    const onData = chunk => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      process.stdin.removeListener('data', onData);
      resolve(buffer.trim().toLowerCase());
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
  });
  return answer === 'y' || answer === 'yes';
}

export async function connectHost(host, { token, yes = false, home = homedir(), stdout = process.stdout } = {}) {
  if (!HOST_IDS.includes(host)) throw new Aborted(`Unknown host: ${host} (supported: ${HOST_IDS.join(', ')})`);
  let credential = null;
  if (!token) {
    stdout.write('未提供 --token：将用本地管理员凭据通过 Corvid 桌面签发 openRoomGrant 授权客户端（初始授权范围为空，仅能访问其自建的 Room）。\n');
    credential = await issueCredential(host);
    token = credential.token;
  }
  const issued = Boolean(credential);
  const adapter = createHostAdapter(host, home);
  const plan = await adapter.readPlan(token);
  const skillDir = skillTargetDir(host, home);
  stdout.write(`将为 ${hostLabel(host)}（${host}）接入 Corvid Browser MCP：\n`);
  stdout.write(`\n[1] MCP 配置 ${plan.path}${plan.create ? '（文件不存在，将创建）' : ''}：${plan.action === 'current' ? '已是最新，无需改动' : plan.action === 'add' ? '新增条目' : '替换现有条目'}\n`);
  if (plan.action !== 'current') stdout.write(`    条目：${formatEntry({ ...plan.entry, env: plan.entry?.env ? { [TOKEN_ENV_KEY]: 'corvid_agent_***' } : undefined })}\n`);
  if (plan.existing && plan.action === 'replace') stdout.write(`    现有条目：${formatEntry({ ...plan.existing, env: plan.existing?.env ? { [TOKEN_ENV_KEY]: 'corvid_agent_***' } : undefined })}\n`);
  stdout.write(`\n[2] Skill 安装 ${skillDir}/SKILL.md（来自 ${SKILL_SOURCE}）\n`);
  stdout.write(`\n${token ? `已携带 scoped token（${TOKEN_ENV_KEY} 写入 host 配置 env）。\n` : `未提供 --token：host 配置不带 ${TOKEN_ENV_KEY}，MCP 启动后需从环境变量读取；用 corvid doctor 诊断。\n`}`);
  if (plan.action === 'current' && existsSync(join(skillDir, 'SKILL.md'))) {
    const installedSkill = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    if (installedSkill === await skillSourceText()) {
      stdout.write('全部条目已是最新，未做任何写入。\n');
      return { changed: false };
    }
  }
  const approved = await confirm('确认写入以上内容？', { yes });
  if (!approved) { stdout.write('已取消，未写入。\n'); return { changed: false, cancelled: true }; }
  await adapter.apply(token);
  await installSkill(host, home);
  const receipts = readReceipts() || { version: 1, hosts: {} };
  const previous = receipts.hosts[host];
  let rotatedFrom = null;
  if (issued && previous?.clientId) {
    await revokeCredential(previous.clientId);
    rotatedFrom = previous.clientId;
  }
  receipts.hosts[host] = {
    label: hostLabel(host), configFile: adapter.configPath, kind: adapter.kind,
    skillDir, issued,
    clientId: credential ? credential.id : null,
    connectedAt: new Date().toISOString(),
  };
  await writeReceipts(receipts);
  stdout.write(`完成：${plan.path} 已${plan.action === 'replace' ? '更新' : '写入'}，skill 已安装到 ${skillDir}。\n`);
  if (credential) stdout.write(`凭据：${credential.id} 已签发${rotatedFrom ? `（旧凭据 ${rotatedFrom} 已撤销）` : ''}；disconnect 时自动撤销。\n`);
  stdout.write(`重启 ${hostLabel(host)} 后生效；用 corvid doctor ${host} 验证。\n`);
  return { changed: true };
}

export async function disconnectHost(host, { home = homedir(), stdout = process.stdout } = {}) {
  if (!HOST_IDS.includes(host)) throw new Aborted(`Unknown host: ${host} (supported: ${HOST_IDS.join(', ')})`);
  const receipts = readReceipts() || { version: 1, hosts: {} };
  const record = receipts.hosts[host];
  const adapter = createHostAdapter(host, home);
  const configResult = await adapter.remove();
  const skillResult = await removeSkill(host, home);
  let revoked = null;
  if (record?.clientId && record.issued) {
    revoked = (await revokeCredential(record.clientId)) ? record.clientId : `撤销失败：${record.clientId}`;
    delete receipts.hosts[host];
    await writeReceipts(receipts);
  } else if (record) {
    delete receipts.hosts[host];
    await writeReceipts(receipts);
  }
  const parts = [];
  if (configResult.removed) parts.push(`MCP 条目已从 ${adapter.configPath} 移除${configResult.drifted ? '（注意：条目内容与 corvid connect 写入的不一致，可能包含手工改动）' : ''}`);
  else parts.push(`${adapter.configPath} 中没有 corvid 的 MCP 条目${configResult.reason === 'not-registered' ? '' : `（${configResult.reason}）`}`);
  if (skillResult.removed) parts.push(`skill 已从 ${skillResult.path} 移除`);
  else if (skillResult.reason === 'modified') parts.push(`skill ${skillResult.path}/SKILL.md 被修改过，未删除（如需清理请手动处理）`);
  else parts.push(`${skillResult.path} 中没有 corvid skill`);
  if (record?.clientId && record.issued) parts.push(revoked === record.clientId ? `签发的凭据 ${record.clientId} 已撤销` : `凭据 ${record.clientId} 撤销失败（Corvid 桌面未运行？请在设置中手动撤销）`);
  else if (record && !record.issued) parts.push('该 host 使用 --token 提供的凭据，disconnect 不撤销（如需回收请在 Corvid 设置中处理）');
  else parts.push('没有 connect 收据记录');
  for (const part of parts) stdout.write(`${part}\n`);
  stdout.write('重启对应 agent 后生效。\n');
  return { configRemoved: configResult.removed, skillRemoved: skillResult.removed };
}

// ---- Doctor ----

async function checkDesktopEndpoint() {
  const dataDir = require('../desktop/data-directory.cjs').resolveDataDirectory({ override: process.env.CORVID_DATA_DIR, homeDir: homedir() });
  const controlPath = join(dataDir, 'control.json');
  if (!existsSync(controlPath)) return { ok: false, detail: `未找到 ${controlPath}；Corvid 桌面端未运行过或未启动控制服务` };
  let config;
  try { config = JSON.parse(await readFile(controlPath, 'utf8')); }
  catch { return { ok: false, detail: `${controlPath} 无法解析` }; }
  if (!config.baseUrl) return { ok: false, detail: `${controlPath} 缺少 baseUrl` };
  try {
    const response = await fetch(new URL('/rooms', config.baseUrl), { headers: { authorization: 'Bearer probe' } });
    if (response.status === 401 || response.status === 403) return { ok: true, detail: `控制服务在线：${config.baseUrl}` };
    return { ok: false, detail: `控制服务响应异常：HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: `控制服务不可达（${config.baseUrl}）：请先启动 Corvid 桌面端` };
  }
}

async function checkToken(token) {
  if (!token) return { ok: false, detail: `未找到 ${TOKEN_ENV_KEY}（环境变量或 host 配置 env）；在 Corvid 设置创建授权客户端后用 --token 提供` };
  const dataDir = require('../desktop/data-directory.cjs').resolveDataDirectory({ override: process.env.CORVID_DATA_DIR, homeDir: homedir() });
  let baseUrl;
  try { baseUrl = JSON.parse(await readFile(join(dataDir, 'control.json'), 'utf8')).baseUrl; }
  catch { return { ok: true, detail: '跳过 token 鉴权（控制服务不可达）' }; }
  try {
    const response = await fetch(new URL('/rooms', baseUrl), { headers: { authorization: `Bearer ${token}` } });
    if (response.ok) return { ok: true, detail: 'scoped token 有效' };
    return { ok: false, detail: `scoped token 被拒绝：HTTP ${response.status}` };
  } catch (error) {
    return { ok: true, detail: '跳过 token 鉴权（控制服务不可达）' };
  }
}

async function checkMcpHandshake(adapter) {
  const inspect = await adapter.inspect().catch(error => ({ registered: false, inspectError: error.message }));
  if (!inspect.registered) {
    return { registered: false, detail: `${adapter.configPath} 未注册 corvid-browser MCP${inspect.inspectError ? `（${inspect.inspectError}）` : ''}` };
  }
  const stale = inspect.matchesBase === false ? '；条目与当前版本不一致，建议重跑 connect 更新' : '';
  const token = inspect.hasToken ? inspect.current?.env?.[TOKEN_ENV_KEY] : process.env[TOKEN_ENV_KEY];
  const spawnCheck = await spawnMcpProbe(token);
  let tokenCheck = { ok: true, detail: '未携带 token（MCP 工具调用时才会鉴权）' };
  if (token) tokenCheck = await checkToken(token);
  return {
    registered: true,
    ok: spawnCheck.ok && tokenCheck.ok,
    detail: `已注册${stale}；${spawnCheck.detail}；${tokenCheck.detail}`,
  };
}

async function spawnMcpProbe(token) {
  const child = spawn('node', [SERVER_ENTRY], {
    env: { ...process.env, ...(token ? { [TOKEN_ENV_KEY]: token } : {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    const result = await new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('MCP initialize 超时（5s）')), 5000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        clearTimeout(timer);
        try {
          const message = JSON.parse(buffer.slice(0, newline));
          resolve(message?.result?.serverInfo?.name === SERVER_NAME ? { ok: true, detail: 'MCP initialize 握手成功' } : { ok: false, detail: 'MCP initialize 响应异常' });
        } catch { resolve({ ok: false, detail: 'MCP 响应不是有效 JSON-RPC' }); }
      });
      child.on('exit', code => reject(new Error(`MCP 进程提前退出（code ${code}）`)));
      child.on('error', reject);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'corvid-doctor', version: '1.0.0' } } })}\n`);
    });
    return result;
  } catch (error) {
    const stderr = await new Promise(resolve => { let text = ''; child.stderr.on('data', chunk => { text += chunk; }); child.stderr.on('end', () => resolve(text)); child.stderr.on('error', () => resolve('')); setTimeout(() => resolve(''), 500); });
    return { ok: false, detail: `MCP 启动失败：${error.message}${stderr ? `；stderr: ${stderr.trim().split('\n')[0]}` : ''}` };
  } finally {
    child.kill();
  }
}

async function checkSkill(host, home) {
  const target = skillTargetDir(host, home);
  const skillPath = join(target, 'SKILL.md');
  if (!existsSync(skillPath)) return { ok: false, detail: `${skillPath} 不存在；运行 corvid connect ${host} 安装` };
  const installed = await readFile(skillPath, 'utf8');
  if (installed !== await skillSourceText()) return { ok: true, detail: `${skillPath} 已安装（内容与当前版本不一致，建议重跑 connect 更新）` };
  return { ok: true, detail: `${skillPath}` };
}

export async function doctor(host, { home = homedir(), stdout = process.stdout } = {}) {
  const hosts = host ? [host] : HOST_IDS;
  if (host && !HOST_IDS.includes(host)) throw new Aborted(`Unknown host: ${host} (supported: ${HOST_IDS.join(', ')})`);
  let failures = 0;
  let connectedCount = 0;
  if (!host) {
    const endpoint = await checkDesktopEndpoint();
    stdout.write(`${endpoint.ok ? '✓' : '✗'} Corvid 控制服务：${endpoint.detail}\n`);
    if (!endpoint.ok) failures++;
  }
  for (const id of hosts) {
    const adapter = createHostAdapter(id, home);
    const mcp = await checkMcpHandshake(adapter);
    if (!mcp.registered) {
      stdout.write(`— ${hostLabel(id)} MCP 注册：${mcp.detail}\n`);
      continue;
    }
    connectedCount++;
    stdout.write(`${mcp.ok ? '✓' : '✗'} ${hostLabel(id)} MCP 注册：${mcp.detail}\n`);
    if (!mcp.ok) failures++;
    const skill = await checkSkill(id, home);
    stdout.write(`${skill.ok ? '✓' : '✗'} ${hostLabel(id)} skill：${skill.detail}\n`);
    if (!skill.ok) failures++;
  }
  stdout.write(failures ? `\n${failures} 项未通过；按提示修复后重跑。\n` : connectedCount ? `\n全部通过（${connectedCount} 个 host 已接入）。\n` : '\n检查完成：尚无已接入的 host。\n');
  if (failures) process.exitCode = 1;
  return { failures };
}
