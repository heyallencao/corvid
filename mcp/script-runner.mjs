#!/usr/bin/env node
// browser_script 子进程执行器：与 `cli/corvid.mjs run` 同引擎（SDK 子集，本地 Node
// 权限运行，非沙箱）。由 mcp/corvid.mjs 拉起：stdin 收 { roomId, script }，stdout 回
// JSON 收据；父进程负责超时强杀（kill 后桌面端页面状态不受影响——SDK 是无状态 HTTP）。
// 绑定面提供 room/client 两个 SDK 对象（脚本另可通过 dynamic import 触达整个 Node
// API——这是非沙箱合同的一部分）；不提供任何 raw CDP 逃生舱。入口执行与页面动作
// 工具一致的 Room 闸门（Agent 控制、无待接管、无执行风险）。
import { connect } from '../sdk/index.js';
import capabilityCore from '../desktop/agent-browser-capabilities.cjs';

const { assertAgentReadable } = capabilityCore;

function readStdin() {
  return new Promise((resolve, reject) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { raw += chunk; });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', reject);
  });
}

const started = Date.now();
const DEBUG = process.env.CORVID_SCRIPT_DEBUG === '1';
const trace = message => { if (DEBUG) process.stderr.write(`[script-runner] ${message}\n`); };
process.on('exit', code => trace(`exit ${code}`));
process.on('SIGTERM', () => { trace('SIGTERM'); process.exit(2); });
process.on('SIGINT', () => { trace('SIGINT'); process.exit(2); });
let payload;
try {
  payload = JSON.parse(await readStdin());
  trace(`payload ok, roomId=${payload.roomId}, scriptLen=${payload.script?.length}`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: `invalid runner payload: ${error.message}`, code: 'CORVID_INVALID_ARGUMENT' })}\n`);
  process.exit(0);
}

const logs = [];
const write = line => {
  if (logs.length < 200) logs.push(String(line).slice(0, 2000));
  else if (logs.length === 200) logs.push('…[truncated]');
};
console.log = (...args) => write(args.map(String).join(' '));
console.info = console.log;
console.warn = console.log;
console.error = console.log;

async function main() {
  trace('connecting');
  const client = await connect();
  trace('connected');
  try {
    const room = await client.room(payload.roomId);
    assertAgentReadable(room);
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const script = new AsyncFunction('room', 'client', `"use strict";\n${payload.script}`);
    trace('script start');
    const result = await script(room, client);
    trace('script done');
    let encoded = null;
    if (result !== undefined) {
      try { encoded = JSON.parse(JSON.stringify(result ?? null)); }
      catch { encoded = String(result); }
    }
    const current = await client.room(payload.roomId).catch(() => null);
    return {
      ok: true,
      result: encoded,
      logs,
      room: current ? {
        id: current.id, name: current.name, ownership: current.ownership,
        tabs: (current.info.tabs || []).map(tab => ({ id: tab.id, label: tab.label, title: tab.title, url: tab.url, openedBy: tab.openedBy })),
      } : { id: payload.roomId, closed: true },
      durationMs: Date.now() - started,
    };
  } finally { await client.disconnect(); }
}

// 裸 promise（无 timer/IO）不会保持 Node 事件循环——脚本"挂起"时会直接干净退出。
// keep-alive 保证脚本语义上运行到收据写完或被父进程超时强杀。
const keepAlive = setInterval(() => {}, 2_147_483_647);
main()
  .then(receipt => { process.stdout.write(`${JSON.stringify(receipt)}\n`); clearInterval(keepAlive); })
  .catch(error => {
    const code = typeof error?.code === 'string' && error.code.startsWith('CORVID_') ? error.code : 'CORVID_SCRIPT_ERROR';
    process.stdout.write(`${JSON.stringify({ ok: false, error: error?.message || String(error), code, logs, durationMs: Date.now() - started })}\n`);
    clearInterval(keepAlive);
  });
