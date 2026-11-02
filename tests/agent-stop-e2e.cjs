const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-stop-'));
  const fixture = http.createServer((_request, response) => response.end('<!doctype html><title>Stop fixture</title><main>Local page for stop behavior.</main>'));
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  let app;

  async function control() {
    for (let i = 0; i < 200; i++) {
      try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); }
      catch { await delay(25); }
    }
    throw new Error('Corvid control service did not start');
  }
  async function tasks() {
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-tasks.json'), 'utf8'));
    return Array.isArray(saved) ? saved : saved.tasks;
  }

  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const shell = await app.firstWindow();
    const service = await control();
    const base = `http://127.0.0.1:${fixture.address().port}/`;
    await shell.getByLabel('地址或搜索').fill(base);
    await shell.getByLabel('地址或搜索').press('Enter');
    await shell.getByRole('button', { name: 'Stop fixture' }).waitFor();
    await shell.getByRole('button', { name: 'Corvid Agent', exact: true }).click();
    await shell.getByRole('button', { name: '连接当前页面' }).click();
    const prompt = '[fixture:hold-stop-late] 测试主动停止';
    await shell.getByRole('textbox', { name: '描述要完成的浏览任务' }).fill(prompt);
    await shell.getByRole('button', { name: '检查并预览页面上下文' }).click();
    await shell.getByLabel(/我已检查/).check();
    await shell.getByRole('button', { name: '发送' }).click();
    const card = shell.locator('.pi-task-entry').filter({ hasText: prompt });
    await card.locator('.pi-task-state[data-status="running"]').waitFor();
    const taskId = (await tasks()).find(task => task.prompt === prompt)?.id;
    assert.ok(taskId, 'the running task is durably identified before stop');

    await card.getByRole('button', { name: '停止任务' }).click();
    await card.locator('.pi-task-state[data-status="interrupted"]').waitFor();
    await delay(350);

    const stopped = (await tasks()).find(task => task.id === taskId);
    assert.equal(stopped.status, 'interrupted');
    assert.equal(stopped.conversation.at(-1).status, 'interrupted');
    assert.equal(stopped.output, '', 'late assistant output after abort must not mutate the stopped task');
    assert.doesNotMatch(JSON.stringify(stopped.events), /late_fixture_tool/, 'late tool events after abort must not appear in the stopped task');
    assert.equal(await card.getByText('任务已停止；部分网页操作的最终结果可能需要检查').count(), 1);
    assert.equal(service.baseUrl.startsWith('http://127.0.0.1:'), true);

    await shell.getByRole('button', { name: /新建对话/ }).click();
    await shell.getByRole('button', { name: '连接当前页面' }).click();
    const abortFailurePrompt = '[fixture:hold-stop-fails] 测试停止失败提示';
    await shell.getByRole('textbox', { name: '描述要完成的浏览任务' }).fill(abortFailurePrompt);
    await shell.getByRole('button', { name: '检查并预览页面上下文' }).click();
    await shell.getByLabel(/我已检查/).check();
    await shell.getByRole('button', { name: '发送' }).click();
    const abortFailureCard = shell.locator('.pi-task-entry').filter({ hasText: abortFailurePrompt });
    await abortFailureCard.locator('.pi-task-state[data-status="running"]').waitFor();
    await abortFailureCard.getByRole('button', { name: '停止任务' }).click();
    await abortFailureCard.locator('.pi-task-state[data-status="interrupted"]').waitFor();
    await abortFailureCard.locator('.pi-task-error[role="alert"]').getByText(/无法确认 Agent 已停止/).waitFor();
    const abortFailureTask = (await tasks()).find(task => task.prompt === abortFailurePrompt);
    assert.equal(abortFailureTask.status, 'interrupted');
    assert.match(abortFailureTask.error, /无法确认停止/);
    assert.equal(abortFailureTask.stopUnconfirmed, true);
    await abortFailureCard.getByRole('status').getByText(/无法确认上一轮是否已停止/).waitFor();
    assert.equal(await abortFailureCard.getByRole('button', { name: '继续对话' }).count(), 0, 'an unconfirmed stop cannot resume into the same transcript');

    console.log('PASS Corvid Agent stop state, late event isolation, and abort failure feedback');
  } finally {
    if (app) await app.close().catch(() => {});
    fixture.closeAllConnections();
    await new Promise(resolve => fixture.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
