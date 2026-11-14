// Host adapters for registering the Corvid Browser MCP server and the
// corvid-browser skill with external agent hosts (Claude Code, Codex, Cursor, dsh).
//
// Extracted from cli/connect.mjs (#438) so the CLI (plain node) and the Electron
// main process (agent auto-connect) share one implementation; CJS keeps the
// module loadable from inside app.asar and from plain node alike.
//
// Safety contract (docs/execution/external-agent-integration-plan.md P0):
// - Third-party config files are only written after an explicit apply call;
//   adapters validate that edits touch only the managed entry (TOML/YAML diff
//   guard) and abort on unparsable third-party configs.
// - Tests never touch real home directories: every path is derived from
//   `homedir()`, so tests run with a sandboxed HOME.
//
// Path resolution is asar-aware: inside a packaged app this file lives in
// app.asar, but mcp/ and skills/ are unpacked (electron-builder asarUnpack),
// so SERVER_ENTRY/SKILL_SOURCE must point into app.asar.unpacked — agent hosts
// spawn the entry with a plain `node` process that cannot read asar.

const { readFile, writeFile, mkdir, rm, copyFile, readdir } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { homedir } = require('node:os');
const { join, dirname, basename } = require('node:path');
const { parse: tomlParse } = require('smol-toml');
const { parseDocument: yamlParseDocument, parse: yamlParse } = require('yaml');

const SERVER_NAME = 'corvid-browser';
const TOKEN_ENV_KEY = 'CORVID_AGENT_TOKEN';
const BROWSER_SCRIPT_ENV_KEY = 'CORVID_BROWSER_SCRIPT';
const HOST_IDS = ['claude-code', 'codex', 'cursor', 'dsh'];

const HOST_LABELS = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'cursor': 'Cursor',
  'dsh': 'DeepSeek Harness (dsh)',
};

function hostLabel(host) { return HOST_LABELS[host] || host; }

// `…/app.asar` → `…/app.asar.unpacked`；其余路径（开发仓库、已解包目录）原样返回。
function resolveUnpackedRoot(root) {
  return basename(root) === 'app.asar' ? `${root}.unpacked` : root;
}

const APP_ROOT = join(__dirname, '..');
const RESOURCES_ROOT = resolveUnpackedRoot(APP_ROOT);
const SERVER_ENTRY = join(RESOURCES_ROOT, 'mcp', 'corvid.mjs');
const SKILL_SOURCE = join(RESOURCES_ROOT, 'skills', 'corvid-browser', 'SKILL.md');

class Aborted extends Error {}
class ConflictingEntry extends Error {}

// ---- Deep equality for config entries ----

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function tomlString(value) { return JSON.stringify(value); }

// ---- Host adapters ----

function jsonHost({ configPath, entryType, browserScript }) {
  return {
    kind: 'json',
    configPath,
    async readPlan(token) {
      const current = await readJsonIfExists(configPath);
      const servers = current?.mcpServers && typeof current.mcpServers === 'object' ? current.mcpServers : {};
      const entry = jsonEntry(entryType, token, browserScript);
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
      const entry = jsonEntry(entryType, token, browserScript);
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
      const expected = jsonEntry(entryType, undefined, browserScript);
      const tokenMatches = typeof existing?.env?.[TOKEN_ENV_KEY] === 'string' && existing.env[TOKEN_ENV_KEY].length > 0;
      return { registered: true, current: existing, matchesBase: sameValue({ ...existing, env: undefined }, { ...expected, env: undefined }), hasToken: tokenMatches, browserScript: existing?.env?.[BROWSER_SCRIPT_ENV_KEY] === '1' };
    },
  };
}

function jsonEntry(entryType, token, browserScript) {
  const entry = entryType ? { type: entryType, command: 'node', args: [SERVER_ENTRY] } : { command: 'node', args: [SERVER_ENTRY] };
  const env = {};
  if (token) env[TOKEN_ENV_KEY] = token;
  if (browserScript) env[BROWSER_SCRIPT_ENV_KEY] = '1';
  if (Object.keys(env).length) entry.env = env;
  return entry;
}

function isManagedJsonEntry(existing) {
  const variants = [jsonEntry(undefined, 'x'), jsonEntry(undefined, 'x', true), jsonEntry(undefined, undefined), jsonEntry(undefined, undefined, true)];
  const strip = entry => ({ ...entry, env: entry?.env ? { ...entry.env, [TOKEN_ENV_KEY]: 'x' } : undefined });
  return variants.some(variant => sameValue(strip(existing), strip(variant)));
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

function codexHost({ configPath, browserScript }) {
  const header = `[mcp_servers.${SERVER_NAME}]`;
  const sectionRe = new RegExp(`^\\[mcp_servers\\.(?:"${SERVER_NAME}"|${SERVER_NAME.replace(/[.-]/g, m => `\\${m}`)})\\]\\s*$`);
  const anySectionRe = /^\[/;
  function block(token) {
    const lines = [header, `command = "node"`, `args = [${tomlString(SERVER_ENTRY)}]`];
    const env = {};
    if (token) env[TOKEN_ENV_KEY] = token;
    if (browserScript) env[BROWSER_SCRIPT_ENV_KEY] = '1';
    if (Object.keys(env).length) lines.push(`env = { ${Object.entries(env).map(([key, value]) => `${key} = ${tomlString(value)}`).join(', ')} }`);
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
  const envKeys = Object.keys(existing.env).sort();
  return sameValue(envKeys, [TOKEN_ENV_KEY]) || sameValue(envKeys, [BROWSER_SCRIPT_ENV_KEY, TOKEN_ENV_KEY]);
}

const DSH_PATCH_NAME = '@deepseek-ai/dsh-mcp-client';

function dshHost({ configPath, browserScript }) {
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
    const env = {};
    if (token) env[TOKEN_ENV_KEY] = token;
    if (browserScript) env[BROWSER_SCRIPT_ENV_KEY] = '1';
    if (Object.keys(env).length) {
      lines.push('        env:');
      for (const [key, value] of Object.entries(env)) lines.push(`          ${key}: ${value}`);
    }
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
    if (config && typeof config.env === 'object' && config.env !== null) config.env = { ...config.env, [TOKEN_ENV_KEY]: 'x', [BROWSER_SCRIPT_ENV_KEY]: 'flag' };
    return { ...entry, config };
  }) };
}

function findManagedItem(items) {
  return items.find(isManagedItem);
}

function createHostAdapter(host, home = homedir(), { browserScript = false } = {}) {
  if (host === 'claude-code') return jsonHost({ configPath: join(home, '.claude.json'), entryType: 'stdio', browserScript });
  if (host === 'cursor') return jsonHost({ configPath: join(home, '.cursor', 'mcp.json'), entryType: undefined, browserScript });
  if (host === 'codex') return codexHost({ configPath: join(home, '.codex', 'config.toml'), browserScript });
  if (host === 'dsh') return dshHost({ configPath: join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml'), browserScript });
  throw new Aborted(`Unknown host: ${host} (supported: ${HOST_IDS.join(', ')})`);
}

function skillTargetDir(host, home = homedir()) {
  const dirs = {
    'claude-code': () => join(home, '.claude', 'skills', SERVER_NAME),
    'codex': () => join(home, '.codex', 'skills', SERVER_NAME),
    'cursor': () => join(home, '.cursor', 'skills', SERVER_NAME),
    'dsh': () => join(home, '.dsh', 'skills', SERVER_NAME),
  };
  if (!dirs[host]) throw new Aborted(`Unknown host: ${host}`);
  return dirs[host]();
}

// ---- Skill distribution ----

function skillSourceText() { return readFile(SKILL_SOURCE, 'utf8'); }

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

// ---- Connection receipts (what connect wrote, so disconnect can revert + revoke) ----

const CONNECTIONS_FILE = 'agent-connections.json';

function connectionsPath(dataDir) {
  if (dataDir) return join(dataDir, CONNECTIONS_FILE);
  const { resolveDataDirectory } = require('./data-directory.cjs');
  return join(resolveDataDirectory({ override: process.env.CORVID_DATA_DIR, homeDir: homedir() }), CONNECTIONS_FILE);
}

function readReceipts(dataDir) {
  try { return JSON.parse(require('node:fs').readFileSync(connectionsPath(dataDir), 'utf8')); }
  catch (error) { return error.code === 'ENOENT' ? { version: 1, hosts: {} } : null; }
}

async function writeReceipts(receipts, dataDir) {
  await mkdir(dirname(connectionsPath(dataDir)), { recursive: true });
  await writeFile(connectionsPath(dataDir), `${JSON.stringify(receipts, null, 2)}\n`, { mode: 0o600 });
}

// Host 安装痕迹检测（自动接入用）：配置目录/文件存在即视为该 host 已在使用。
// claude-code 以 ~/.claude.json 或 ~/.claude/ 为痕迹；codex/dsh/cursor 以各自家目录为痕迹。
function detectHosts(home = homedir()) {
  const markers = {
    'claude-code': [join(home, '.claude.json'), join(home, '.claude')],
    'codex': [join(home, '.codex')],
    'cursor': [join(home, '.cursor')],
    'dsh': [join(home, '.dsh')],
  };
  return HOST_IDS.filter(host => markers[host].some(marker => existsSync(marker)));
}

// 托管条目形状判定（自动接入冲突策略用）：现有 corvid-browser 条目是我们写入的
// 形状（含用户只轮转过 token 的情形）即可安全重写；否则视为用户手改/外来条目，
// 只能由 corvid connect 显式处理，绝不自动覆盖。
function isManagedEntryShape(host, entry) {
  if (!entry) return false;
  if (host === 'claude-code' || host === 'cursor') return isManagedJsonEntry(entry);
  if (host === 'codex') return isManagedTomlEntry(entry);
  if (host === 'dsh') return isManagedItem(entry);
  return false;
}

module.exports = {
  SERVER_NAME, SERVER_ENTRY, SKILL_SOURCE, TOKEN_ENV_KEY, BROWSER_SCRIPT_ENV_KEY,
  HOST_IDS, HOST_LABELS, hostLabel, resolveUnpackedRoot,
  Aborted, ConflictingEntry,
  createHostAdapter, skillTargetDir, skillSourceText, installSkill, removeSkill,
  detectHosts, isManagedEntryShape, CONNECTIONS_FILE, connectionsPath, readReceipts, writeReceipts,
};
