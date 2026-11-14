// 外部 Agent 自动接入（#438，Kaze 式注册）：桌面启动后检测本机已在使用的外部
// Agent host（Claude Code / Codex / dsh），未接入且总开关开启时自动完成接线——
// 写入 corvid-browser MCP 注册、安装 corvid-browser skill、签发 openRoomGrant
// 授权客户端（初始授权范围为空，仅能访问其自建 Room）。
//
// 合同（docs/architecture/external-agent-integration.md）：
// - 注册 ≠ 授权：自动接入不触碰用户空间；访问用户空间仍走原生审批弹窗；
//   授权客户端仍仅 UI 可管理（fromApi 守卫不变）。
// - 第三方配置只写托管条目：已存在非托管形状的 corvid-browser 条目（用户手改
//   或外来工具写入）时跳过并标记 conflict，绝不自动覆盖。
// - 收据与 CLI 共用 agent-connections.json：corvid disconnect / doctor 语义不变。
// - 已接入 host 启动时自愈：条目形状与当前版本不一致（如 app 路径变化）时用
//   配置内现有 token 重写，不轮转凭据。
// - 逐 host 失败隔离：单个 host 配置损坏只标记该 host，不影响启动与其他 host。
// - 测试永不触碰真实 home：home/dataDir 均由调用方传入（沙箱）。

const { existsSync } = require('node:fs');
const { chmod, readFile, writeFile, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const adapters = require('./agent-host-adapters.cjs');

// 第一版自动接入范围（产品拍板 2026-11-14）：cursor 待运行态联测补账后放开。
const AUTO_CONNECT_HOSTS = ['claude-code', 'codex', 'dsh'];

const STATE_FILE = 'agent-auto-connect.json';

function defaultState() {
  return { version: 1, enabled: true, hosts: {} };
}

function statePath(dataDir) { return join(dataDir, STATE_FILE); }

async function readState(dataDir) {
  try { return JSON.parse(await readFile(statePath(dataDir), 'utf8')); }
  catch (error) { return defaultState(); }
}

async function writeState(state, dataDir) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(statePath(dataDir), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function markHost(dataDir, host, entry) {
  const state = await readState(dataDir);
  state.hosts[host] = entry;
  await writeState(state, dataDir);
}

// 设置分区的状态视图：检测结果 + 接入收据 + 最近一次自动接入尝试。
async function status({ home, dataDir }) {
  const state = await readState(dataDir);
  const receipts = adapters.readReceipts(dataDir) || { version: 1, hosts: {} };
  const detected = adapters.detectHosts(home).filter(host => AUTO_CONNECT_HOSTS.includes(host));
  const hosts = AUTO_CONNECT_HOSTS.map(host => {
    const receipt = receipts.hosts[host] || null;
    const record = state.hosts[host] || {};
    return {
      host,
      label: adapters.hostLabel(host),
      detected: detected.includes(host),
      connected: Boolean(receipt),
      configFile: receipt?.configFile || adapters.createHostAdapter(host, home).configPath,
      connectedAt: receipt?.connectedAt || null,
      clientId: receipt?.clientId || null,
      lastError: record.error || null,
      lastAttemptAt: record.at || null,
    };
  });
  return { enabled: state.enabled !== false, hosts };
}

async function setEnabled({ dataDir }, enabled) {
  const state = await readState(dataDir);
  state.enabled = enabled === true;
  await writeState(state, dataDir);
  return state.enabled;
}

async function skillMatches(host, home) {
  const skillPath = join(adapters.skillTargetDir(host, home), 'SKILL.md');
  if (!existsSync(skillPath)) return false;
  try { return (await readFile(skillPath, 'utf8')) === (await adapters.skillSourceText()); }
  catch { return false; }
}

// 单 host 接线。抛错路径保证不留孤儿凭据（签发失败/写入失败即撤销）。
async function connectOne({ home, dataDir, createGrant, revokeClient }, host) {
  if (!AUTO_CONNECT_HOSTS.includes(host)) throw new Error(`不支持的自动接入 host: ${host}`);
  const adapter = adapters.createHostAdapter(host, home, { browserScript: false });
  const inspect = await adapter.inspect().catch(error => { throw new Error(`${adapter.configPath} 无法检查：${error.message}`); });
  if (inspect.registered) {
    // 冲突判定只看条目形状：即使我们有该 host 的收据，用户手改后的条目也不许
    // 自动覆盖；只有我们写入的形状（含仅轮换 token）才允许重写。
    const managed = adapters.isManagedEntryShape(host, inspect.current);
    if (!managed) {
      const error = new Error(`${adapter.configPath} 已有非 Corvid 管理的 corvid-browser 条目；为避免覆盖手工改动，未自动接入（可在终端用 corvid connect ${host} 处理）`);
      error.code = 'CORVID_AUTO_CONNECT_CONFLICT';
      throw error;
    }
  }
  const grant = createGrant({ name: `corvid-${host}`, roomIds: [], openRoomGrant: true });
  try {
    await adapter.apply(grant.token);
    await adapters.installSkill(host, home);
    await chmod(adapter.configPath, 0o600).catch(() => {});
  } catch (error) {
    try { revokeClient(grant.id); } catch { /* 撤销失败时收据不会记录该客户端 */ }
    throw error;
  }
  const receipts = adapters.readReceipts(dataDir) || { version: 1, hosts: {} };
  const previous = receipts.hosts[host];
  if (previous?.clientId && previous.clientId !== grant.id) {
    try { revokeClient(previous.clientId); } catch { /* 旧凭据可能已被手动撤销 */ }
  }
  receipts.hosts[host] = {
    label: adapters.hostLabel(host), configFile: adapter.configPath, kind: adapter.kind,
    skillDir: adapters.skillTargetDir(host, home), issued: true, clientId: grant.id,
    connectedAt: new Date().toISOString(),
  };
  await adapters.writeReceipts(receipts, dataDir);
  return { clientId: grant.id, configFile: adapter.configPath };
}

async function connectOneWithState(ctx, host) {
  const at = new Date().toISOString();
  try {
    const result = await connectOne(ctx, host);
    await markHost(ctx.dataDir, host, { status: 'connected', at, error: null });
    return { ok: true, host, ...result };
  } catch (error) {
    await markHost(ctx.dataDir, host, { status: 'failed', at, error: String(error.message || error) });
    return { ok: false, host, error: String(error.message || error), code: error.code || null };
  }
}

// 断开 = CLI disconnect 语义：配置条目/skill/签发凭据三清、收据删除。
// 凭据撤销失败时保留收据（避免孤儿凭据），错误透传给 UI。
async function disconnectOne({ home, dataDir, revokeClient }, host) {
  if (!AUTO_CONNECT_HOSTS.includes(host)) throw new Error(`不支持的自动接入 host: ${host}`);
  const adapter = adapters.createHostAdapter(host, home);
  const configResult = await adapter.remove();
  const skillResult = await adapters.removeSkill(host, home);
  const receipts = adapters.readReceipts(dataDir) || { version: 1, hosts: {} };
  const record = receipts.hosts[host];
  let revoked = null;
  let revokeFailed = null;
  if (record?.clientId && record.issued) {
    try { revokeClient(record.clientId); revoked = record.clientId; }
    catch (error) {
      if (error?.code === 'CORVID_NOT_FOUND') { revoked = record.clientId; }
      else revokeFailed = String(error.message || error);
    }
  }
  // 与 CLI disconnect 相同：收据一律删除；仅撤销失败时保留收据防孤儿凭据。
  if (record && !revokeFailed) {
    delete receipts.hosts[host];
    await adapters.writeReceipts(receipts, dataDir);
  }
  if (revokeFailed) {
    await markHost(dataDir, host, { status: 'revoke-failed', at: new Date().toISOString(), error: revokeFailed });
    const error = new Error(`本地条目已移除，但凭据 ${record.clientId} 撤销失败：${revokeFailed}`);
    error.code = 'CORVID_AUTO_CONNECT_REVOKE_FAILED';
    throw error;
  }
  await markHost(dataDir, host, { status: 'disconnected', at: new Date().toISOString(), error: null });
  return { configRemoved: configResult.removed, skillRemoved: skillResult.removed, revoked };
}

// 启动自动接入：逐 host 顺序执行，互不阻塞；已接入的做自愈检查。
async function runStartup(ctx) {
  const state = await readState(ctx.dataDir);
  if (state.enabled === false) return { skipped: 'disabled' };
  const receipts = adapters.readReceipts(ctx.dataDir) || { version: 1, hosts: {} };
  const detected = adapters.detectHosts(ctx.home).filter(host => AUTO_CONNECT_HOSTS.includes(host));
  const results = {};
  for (const host of detected) {
    if (receipts.hosts[host]) {
      await refreshConnected(ctx, host).catch(() => {});
      continue;
    }
    results[host] = await connectOneWithState(ctx, host);
  }
  return { results };
}

// 已接入 host 的自愈：app 更新/移动后 SERVER_ENTRY 变化会使 matchesBase 为假，
// 用配置里现有 token 重写条目与 skill（不轮转凭据，token 不变则不弹新授权）。
async function refreshConnected({ home, dataDir }, host) {
  const adapter = adapters.createHostAdapter(host, home, { browserScript: false });
  const inspect = await adapter.inspect();
  if (!inspect.registered) return;
  const token = typeof inspect.current?.env?.[adapters.TOKEN_ENV_KEY] === 'string' ? inspect.current.env[adapters.TOKEN_ENV_KEY] : null;
  const entryStale = inspect.matchesBase === false && Boolean(token);
  const skillStale = !(await skillMatches(host, home));
  if (!entryStale && !skillStale) return;
  if (entryStale) await adapter.apply(token);
  await adapters.installSkill(host, home);
  await chmod(adapter.configPath, 0o600).catch(() => {});
}

// UI 即时接线入口：与自动接入同一状态记录路径。
async function connectNow(ctx, host) { return connectOneWithState(ctx, host); }

module.exports = {
  AUTO_CONNECT_HOSTS, STATE_FILE,
  status, setEnabled, connectNow, disconnectNow: disconnectOne, runStartup, refreshConnected,
};
