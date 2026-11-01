const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createPiAgentSession, readPiPageContext } = require('./pi-agent.cjs');

const MAX_OUTPUT = 24_000;
const copy = value => JSON.parse(JSON.stringify(value));

function createPiWorkbench({ dataDir, onChange = () => {}, createSession = createPiAgentSession, readContext = readPiPageContext }) {
  const file = path.join(dataDir, 'agent-tasks.json');
  let tasks = [];
  const sessions = new Map();
  let persistTimer;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(saved) || saved.some(item => !item || typeof item.id !== 'string' || typeof item.profileId !== 'string' || typeof item.roomId !== 'string' || typeof item.tabId !== 'string' || typeof item.status !== 'string')) throw new Error('Agent task data structure is invalid');
    if (new Set(saved.map(item => item.id)).size !== saved.length) throw new Error('Agent task data contains duplicate IDs');
    tasks = saved;
  } catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot read Agent task state: ${error.message}`); }
  for (const task of tasks) if (['preparing', 'running'].includes(task.status)) {
    task.status = 'interrupted';
    task.updatedAt = new Date().toISOString();
    task.events = [...(task.events || []), { type: 'interrupted', text: 'Corvid 重启时任务仍未结束；结果未知，可检查 Room 后重新发起。', at: task.updatedAt }].slice(-100);
  }
  persist();

  function persist() {
    fs.mkdirSync(dataDir, { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(tasks), { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, file);
  }
  function changed() { persist(); onChange(list()); }
  function scheduleChanged() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { persistTimer = null; persist(); onChange(list()); }, 150);
  }
  function list(profileId) { return copy(tasks.filter(task => !profileId || task.profileId === profileId)); }
  function taskById(taskId) { const task = tasks.find(item => item.id === taskId); if (!task) throw new Error('Agent task not found'); return task; }
  function addEvent(task, type, text) {
    if (typeof text !== 'string' || !text) return;
    task.events = [...(task.events || []), { type, text: text.slice(0, 4_000), at: new Date().toISOString() }].slice(-100);
    task.updatedAt = new Date().toISOString();
    changed();
  }
  function handlePiEvent(task, event) {
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent;
      if (update?.type === 'text_delta' && update.delta) {
        task.output = `${task.output || ''}${update.delta}`.slice(-MAX_OUTPUT);
        task.updatedAt = new Date().toISOString(); scheduleChanged();
      }
    } else if (event.type === 'tool_execution_start') {
      addEvent(task, 'tool', `正在使用浏览器工具：${event.toolName}`);
    } else if (event.type === 'tool_execution_end') {
      addEvent(task, event.isError ? 'error' : 'tool', `${event.toolName}${event.isError ? ' 执行失败' : ' 已完成'}`);
    } else if (event.type === 'auto_retry_start') {
      addEvent(task, 'retry', `连接异常，Pi 正在重试（${event.attempt}/${event.maxAttempts}）`);
    }
  }
  async function prepare({ profileId, roomId, tabId }) {
    const context = await readContext({ dataDir, profileId, roomId, tabId });
    const snapshotText = JSON.stringify(context.snapshot);
    return { profileId, roomId, tabId, label: context.label, url: context.url, title: context.title, snapshot: snapshotText.slice(0, 12_000), snapshotTruncated: snapshotText.length > 12_000 };
  }
  async function start({ profileId, roomId, tabId, prompt, includePageContext, contextPreview }) {
    if (includePageContext !== true) throw new Error('请先确认发送页面上下文');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.trim().length > 8_000) throw new Error('任务内容必须为 1 至 8000 个字符');
    const context = await readContext({ dataDir, profileId, roomId, tabId });
    const consentedSnapshot = JSON.stringify(context.snapshot).slice(0, 12_000);
    if (!contextPreview || contextPreview.url !== context.url || contextPreview.label !== context.label || contextPreview.title !== context.title || contextPreview.snapshot !== consentedSnapshot) throw new Error('页面已变化，请重新检查并确认上下文');
    const task = { id: crypto.randomUUID(), profileId, roomId, tabId, prompt: prompt.trim(), page: { label: context.label, url: context.url, title: context.title }, output: '', events: [], status: 'preparing', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    tasks.push(task); changed();
    try {
      const created = await createSession({ dataDir, taskId: task.id.replaceAll('-', '_'), profileId, roomId, tabId, includePageContext: true, expectedContext: { label: context.label, url: context.url, title: context.title, snapshot: consentedSnapshot } });
      task.runtime = created.fixture ? '本地确定性 fixture（无真实模型）' : 'Pi SDK';
      task.piSessionFile = created.sessionFile || null;
      changed();
      sessions.set(task.id, created.session);
      if (typeof created.session.subscribe === 'function') created.session.subscribe(event => handlePiEvent(task, event));
      task.status = 'running'; addEvent(task, 'started', 'Pi Agent 已开始处理任务');
      const payload = `用户任务：\n${task.prompt}\n\n用户明确确认共享的当前页面上下文（仅限此 Room 的 ${context.label}）：\n${JSON.stringify({ url: context.url, title: context.title, snapshot: consentedSnapshot })}`;
      void Promise.resolve(created.session.prompt(payload)).then(() => {
        if (task.status !== 'running') return;
        task.piSessionFile = created.session.sessionFile || task.piSessionFile;
        task.status = 'completed'; addEvent(task, 'completed', 'Pi Agent 已结束本轮任务'); sessions.delete(task.id); created.session.dispose?.();
      }, error => {
        if (task.status !== 'running') return;
        task.piSessionFile = created.session.sessionFile || task.piSessionFile;
        task.status = 'failed'; task.error = String(error?.message || error).slice(0, 1_000); addEvent(task, 'error', `Pi Agent 未完成：${task.error}`); sessions.delete(task.id); created.session.dispose?.();
      });
      return copy(task);
    } catch (error) {
      task.status = 'failed'; task.error = String(error?.message || error).slice(0, 1_000); addEvent(task, 'error', `无法启动 Pi Agent：${task.error}`); throw error;
    }
  }
  function stop(taskId) {
    const task = taskById(taskId), session = sessions.get(taskId);
    if (!session || task.status !== 'running') return copy(task);
    task.piSessionFile = session.sessionFile || task.piSessionFile;
    task.status = 'interrupted'; addEvent(task, 'interrupted', '任务已停止；部分网页操作的最终结果可能需要检查');
    sessions.delete(taskId); session.abort?.(); session.dispose?.();
    return copy(task);
  }
  function clear(taskId) {
    const task = taskById(taskId);
    if (['running', 'preparing'].includes(task.status)) throw new Error('请先停止运行中的任务');
    fs.rmSync(path.join(dataDir, 'agent-sessions', task.id.replaceAll('-', '_')), { recursive: true, force: true });
    tasks = tasks.filter(item => item.id !== taskId); changed(); return { ok: true };
  }
  return { list, prepare, start, stop, clear };
}

module.exports = { createPiWorkbench };
