// `corvid connect/disconnect/doctor` — register the Corvid Browser MCP server and
// the corvid-browser skill with external agent hosts (Claude Code, Codex, Cursor, dsh).
//
// Host adapters, skill distribution and connection receipts live in
// desktop/agent-host-adapters.cjs (#438) so the Electron main process
// (agent auto-connect) shares the same implementation; this file keeps the
// CLI orchestration: plan display, confirmation, credential issuance and doctor.
//
// Safety contract (docs/execution/external-agent-integration-plan.md P0):
// - Third-party config files are only written after the user explicitly runs
//   `corvid connect` and confirms the listed changes (`--yes` for non-interactive use).
// - `corvid disconnect` reverts exactly what connect wrote; entries modified by the
//   user are reported and left untouched.
// - Tests never touch real home directories: every path is derived from `homedir()`,
//   so tests run with a sandboxed HOME.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { connect as connectAdmin } from '../sdk/index.js';
import {
  SERVER_NAME, SERVER_ENTRY, SKILL_SOURCE, TOKEN_ENV_KEY, HOST_IDS, hostLabel, Aborted,
  createHostAdapter, skillTargetDir, skillSourceText, installSkill, removeSkill,
  detectHosts, readReceipts, writeReceipts,
} from '../desktop/agent-host-adapters.cjs';

const require = createRequire(import.meta.url);

export {
  SERVER_NAME, HOST_IDS, hostLabel, createHostAdapter, skillTargetDir,
  detectHosts, readReceipts, writeReceipts,
};

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

export async function connectHost(host, { token, yes = false, home = homedir(), stdout = process.stdout, browserScript } = {}) {
  if (!HOST_IDS.includes(host)) throw new Aborted(`Unknown host: ${host} (supported: ${HOST_IDS.join(', ')})`);
  const willIssue = !token;
  // browser_script 批量执行开关：默认关；--browser-script 显式开启；交互环境单独询问。
  let useScript = browserScript === true;
  if (browserScript === undefined) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      useScript = await confirm('是否启用 browser_script 批量脚本执行？（脚本以本地 Node 权限运行，非沙箱）', { yes: false });
    }
  } else if (browserScript !== false) {
    useScript = true;
  }
  const adapter = createHostAdapter(host, home, { browserScript: useScript });
  const skillDir = skillTargetDir(host, home);
  // 计划展示用占位 token；真实签发在用户确认之后，取消/失败路径不会留下孤儿凭据。
  const plan = await adapter.readPlan(token || 'corvid_agent_***');
  stdout.write(`将为 ${hostLabel(host)}（${host}）接入 Corvid Browser MCP：\n`);
  stdout.write(`\n[1] MCP 配置 ${plan.path}${plan.create ? '（文件不存在，将创建）' : ''}：${plan.action === 'current' ? '已是最新，无需改动' : plan.action === 'add' ? '新增条目' : '替换现有条目'}\n`);
  if (plan.action !== 'current') stdout.write(`    条目：${formatEntry({ ...plan.entry, env: plan.entry?.env ? { [TOKEN_ENV_KEY]: 'corvid_agent_***' } : undefined })}\n`);
  if (plan.existing && plan.action === 'replace') stdout.write(`    现有条目：${formatEntry({ ...plan.existing, env: plan.existing?.env ? { [TOKEN_ENV_KEY]: 'corvid_agent_***' } : undefined })}\n`);
  stdout.write(`\n[2] Skill 安装 ${skillDir}/SKILL.md（来自 ${SKILL_SOURCE}）\n`);
  stdout.write(`\n[3] browser_script 批量脚本执行：${useScript ? '启用（CORVID_BROWSER_SCRIPT=1 写入 host 配置 env；脚本以本地 Node 权限运行，非沙箱）' : '不启用（默认；如需开启用 --browser-script）'}\n`);
  stdout.write(`\n${willIssue ? '未提供 --token：确认后用本地管理员凭据通过 Corvid 桌面签发 openRoomGrant 授权客户端（初始授权范围为空，仅能访问其自建的 Room），token 写入 host 配置 env。\n' : `已携带 scoped token（${TOKEN_ENV_KEY} 写入 host 配置 env）。\n`}`);
  if (plan.action === 'current' && existsSync(join(skillDir, 'SKILL.md'))) {
    const installedSkill = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    if (installedSkill === await skillSourceText()) {
      stdout.write('全部条目已是最新，未做任何写入。\n');
      return { changed: false };
    }
  }
  const approved = await confirm('确认写入以上内容？', { yes });
  if (!approved) { stdout.write('已取消，未写入。\n'); return { changed: false, cancelled: true }; }
  let credential = null;
  try {
    if (willIssue) credential = await issueCredential(host);
    token = token || credential?.token;
    await adapter.apply(token);
    await installSkill(host, home);
    if (token) await chmodConfig(adapter.configPath);
  } catch (error) {
    if (credential) {
      await revokeCredential(credential.id).catch(() => {});
      stdout.write(`写入失败，已撤销本次签发的凭据 ${credential.id}。\n`);
    }
    throw error;
  }
  const receipts = readReceipts() || { version: 1, hosts: {} };
  const previous = receipts.hosts[host];
  let rotatedFrom = null;
  if (credential && previous?.clientId) {
    await revokeCredential(previous.clientId);
    rotatedFrom = previous.clientId;
  }
  receipts.hosts[host] = {
    label: hostLabel(host), configFile: adapter.configPath, kind: adapter.kind,
    skillDir, issued: Boolean(credential),
    clientId: credential ? credential.id : null,
    connectedAt: new Date().toISOString(),
  };
  await writeReceipts(receipts);
  stdout.write(`完成：${plan.path} 已${plan.action === 'replace' ? '更新' : '写入'}，skill 已安装到 ${skillDir}。\n`);
  if (credential) stdout.write(`凭据：${credential.id} 已签发${rotatedFrom ? `（旧凭据 ${rotatedFrom} 已撤销）` : ''}；disconnect 时自动撤销。\n`);
  stdout.write(`重启 ${hostLabel(host)} 后生效；用 corvid doctor ${host} 验证。\n`);
  return { changed: true };
}

async function chmodConfig(configPath) {
  const { chmod } = await import('node:fs/promises');
  await chmod(configPath, 0o600).catch(() => {});
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
  const scriptState = inspect.browserScript ? 'browser_script 已启用' : 'browser_script 未启用';
  const token = inspect.hasToken ? inspect.current?.env?.[TOKEN_ENV_KEY] : process.env[TOKEN_ENV_KEY];
  const spawnCheck = await spawnMcpProbe(token);
  let tokenCheck = { ok: true, detail: '未携带 token（MCP 工具调用时才会鉴权）' };
  if (token) tokenCheck = await checkToken(token);
  return {
    registered: true,
    ok: spawnCheck.ok && tokenCheck.ok,
    detail: `已注册${stale}；${scriptState}；${spawnCheck.detail}；${tokenCheck.detail}`,
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
    // 兜底（#437）：SIGKILL 升级防子进程滞留；销毁父侧管道句柄，即使子进程
    // 因回归吞掉信号，CLI 事件循环也能排空退出，不悬挂 E2E。
    const escalate = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
    escalate.unref();
    child.once('exit', () => clearTimeout(escalate));
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
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
