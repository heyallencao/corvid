const { _electron } = require('playwright-core');
const electronPath = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function rgbChannels(value) {
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const expanded = hex[1].length === 3 ? [...hex[1]].map(part => part + part).join('') : hex[1];
    return [0, 2, 4].map(index => parseInt(expanded.slice(index, index + 2), 16));
  }
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  assert.equal(channels?.length, 3, `unsupported computed CSS color: ${value}`);
  return channels;
}

function relativeLuminance(color) {
  const [red, green, blue] = rgbChannels(color).map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function assertPaletteContrast(palette, theme) {
  for (const [surfaceName, surface] of Object.entries(palette.surfaces)) {
    assert.ok(contrastRatio(palette.textMuted, surface) >= 4.5, `${theme} muted text on ${surfaceName} is below WCAG AA text contrast`);
    assert.ok(contrastRatio(palette.focusRing, surface) >= 3, `${theme} focus indicator on ${surfaceName} is below non-text contrast`);
  }
  for (const [text, surfaces] of [[palette.warning, ['--surface', '--surface-soft', '--surface-warning']], [palette.success, ['--surface', '--surface-soft', '--surface-success']]]) {
    for (const surfaceName of surfaces) {
      assert.ok(contrastRatio(text, palette.surfaces[surfaceName]) >= 4.5, `${theme} semantic status text on ${surfaceName} is below WCAG AA text contrast`);
    }
  }
}

async function readContrastPalette(shell) {
  return shell.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const surfaces = Object.fromEntries(Array.from({ length: root.length }, (_, index) => root[index])
      .filter(name => name.startsWith('--surface') && !name.endsWith('-text'))
      .map(name => [name, root.getPropertyValue(name).trim()]));
    const probe = document.createElement('span');
    probe.style.color = 'var(--focus-ring)';
    document.body.append(probe);
    const focusRing = getComputedStyle(probe).color;
    probe.remove();
    return {
      textMuted: root.getPropertyValue('--text-muted').trim(),
      warning: root.getPropertyValue('--warning').trim(),
      success: root.getPropertyValue('--success').trim(),
      focusRing,
      surfaces,
    };
  });
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-agent-rooms-'));
  const site=http.createServer((_request,response)=>response.end('<!doctype html><title>Room task fixture</title><h1>Fixture</h1>'));
  await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
  let app;

  async function until(fn) {
    for (let i = 0; i < 200; i++) {
      const value = await fn();
      if (value) return value;
      await delay(25);
    }
    throw new Error('Timed out waiting for Agent Room panel state');
  }

  try {
    app = await _electron.launch({
      executablePath: electronPath,
      args: [project],
      env: { ...process.env, CORVID_DATA_DIR: dataDir, CORVID_TEST_MODE: '1', CORVID_PORT: '0' },
    });
    const shell = await app.firstWindow();
    const control = await until(() => {
      try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'control.json'), 'utf8')); }
      catch { return null; }
    });
    const call = async (route, method = 'GET', body) => {
      const response = await fetch(control.baseUrl + route, {
        method,
        headers: { authorization: `Bearer ${control.token}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      return result;
    };
    const startTask=async(room,prompt,expectedStatus='running')=>{
      const url=`http://127.0.0.1:${site.address().port}/`;
      await call(`/rooms/${room.id}/activate`,'POST',{});
      await shell.waitForFunction(name=>[...document.querySelectorAll('#room-strip button')].some(item=>item.textContent.startsWith(name)&&item.classList.contains('selected')),room.name);
      await call(`/tabs/${room.tabs[0].id}/navigate`,'POST',{url});
      await shell.waitForFunction(expected=>document.querySelector('#address')?.value===expected,url);
      if(await shell.locator('#library[data-kind="pi-workbench"]').count()===0)await shell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
      else await shell.getByRole('button',{name:/新建对话/}).click();
      await shell.waitForFunction(name=>document.querySelector('.pi-page-binding')?.textContent.includes(name),room.name);
      if(await shell.getByRole('button',{name:'连接当前页面'}).count())await shell.getByRole('button',{name:'连接当前页面'}).click();
      await shell.getByRole('textbox',{name:'描述要完成的浏览任务'}).fill(prompt);
      await shell.getByRole('button',{name:'检查并预览页面上下文'}).click();
      await shell.getByLabel(/我已检查/).check();
      await shell.getByRole('button',{name:'发送'}).click();
      const taskEntry=shell.locator('.pi-task-entry').filter({hasText:prompt});
      await taskEntry.waitFor();
      await taskEntry.locator(`.pi-task-state[data-status="${expectedStatus}"]`).waitFor();
      const taskId=await taskEntry.getAttribute('data-task-id');
      const saved=JSON.parse(fs.readFileSync(path.join(dataDir,'agent-tasks.json'),'utf8'));
      const task=(Array.isArray(saved)?saved:saved.tasks).find(item=>item.id===taskId);
      return {taskId,roomId:task?.roomId,pageBinding:await shell.locator('.pi-page-binding').textContent()};
    };

    await shell.getByRole('button', { name: '空间选项' }).waitFor();
    await shell.getByRole('button', { name: '新建空间' }).waitFor();
    await shell.getByRole('button', { name: '我的空间 · 用户空间', exact: true }).waitFor();
    assert.equal(await shell.locator('#spaces-heading').textContent(), '空间');

    const profileMenuTrigger=shell.locator('#profile-menu-trigger'),profileMenu=shell.locator('#profile-menu');
    assert.equal(await profileMenuTrigger.getAttribute('aria-haspopup'),'menu');
    assert.equal(await profileMenuTrigger.getAttribute('aria-controls'),'profile-menu');
    assert.equal(await profileMenu.getAttribute('aria-label'),'浏览身份选项');
    await profileMenuTrigger.press('Enter');
    await profileMenu.waitFor({state:'visible'});
    const profileItems=profileMenu.getByRole('menuitem');
    await shell.waitForFunction(()=>document.activeElement===document.querySelector('#profile-menu [role="menuitem"]'));
    assert.equal(await profileMenuTrigger.getAttribute('aria-expanded'),'true');
    await shell.keyboard.press('ArrowDown');
    assert.equal(await shell.evaluate(()=>document.activeElement.textContent),await profileItems.nth(1).textContent());
    await shell.keyboard.press('Home');
    assert.equal(await shell.evaluate(()=>document.activeElement.textContent),await profileItems.first().textContent());
    await shell.keyboard.press('End');
    assert.equal(await shell.evaluate(()=>document.activeElement.textContent),await profileItems.last().textContent());
    await shell.keyboard.press('Escape');
    await profileMenu.waitFor({state:'hidden'});
    assert.equal(await profileMenuTrigger.getAttribute('aria-expanded'),'false');
    assert.equal(await shell.evaluate(()=>document.activeElement.id),'profile-menu-trigger');
    await profileMenuTrigger.press('Space');
    assert.equal(await shell.evaluate(()=>document.activeElement.textContent),await profileItems.first().textContent(),'Space opens on the first menu action');
    await shell.keyboard.press('Escape');
    await profileMenuTrigger.press('ArrowUp');
    assert.equal(await shell.evaluate(()=>document.activeElement.textContent),await profileItems.last().textContent(),'ArrowUp opens on the final menu action');
    await shell.keyboard.press('Escape');

    const roomMenuTrigger=shell.locator('#room-menu-trigger'),roomMenu=shell.locator('#room-menu');
    assert.equal(await roomMenuTrigger.getAttribute('aria-haspopup'),'menu');
    assert.equal(await roomMenuTrigger.getAttribute('aria-controls'),'room-menu');
    assert.equal(await roomMenu.getAttribute('aria-label'),'空间选项');
    await roomMenuTrigger.press('ArrowDown');
    await roomMenu.waitFor({state:'visible'});
    const roomItems=roomMenu.getByRole('menuitem');
    assert.equal(await shell.evaluate(()=>document.activeElement.textContent),await roomItems.first().textContent());
    await shell.keyboard.press('End');
    assert.equal(await shell.evaluate(()=>document.activeElement.textContent),await roomItems.last().textContent());
    await shell.keyboard.press('ArrowDown');
    assert.equal(await shell.evaluate(()=>document.activeElement.textContent),await roomItems.first().textContent(),'ArrowDown wraps to the first menu action');
    for(const [selector,triggerId,menuId] of [['.profile-switcher','profile-menu-trigger','profile-menu'],['#spaces-heading','room-menu-trigger','room-menu'],['#room-strip','room-menu-trigger','room-menu']]){
      const trigger=shell.locator(`#${triggerId}`),menu=shell.locator(`#${menuId}`);
      await shell.locator(selector).evaluate(element=>element.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2})));
      await menu.waitFor({state:'visible'});
      assert.equal(await trigger.getAttribute('aria-expanded'),'true',`${selector} context menu updates expanded state`);
      await shell.waitForFunction(menuId=>document.activeElement===document.querySelector(`#${menuId} [role="menuitem"]`),menuId);
      await shell.keyboard.press('ArrowDown');
      assert.equal(await shell.evaluate(()=>document.activeElement.textContent),await menu.getByRole('menuitem').nth(1).textContent(),`${selector} context menu supports arrow navigation`);
      await shell.keyboard.press('Escape');
      await menu.waitFor({state:'hidden'});
      assert.equal(await trigger.getAttribute('aria-expanded'),'false',`${selector} context menu closes accessibly`);
      assert.equal(await shell.evaluate(()=>document.activeElement.id),triggerId,`${selector} context menu restores trigger focus`);
    }
    if(process.env.CORVID_POPUP_MENU_SCREENSHOT_PATH)await shell.screenshot({path:process.env.CORVID_POPUP_MENU_SCREENSHOT_PATH});
    await shell.keyboard.press('Tab');
    await roomMenu.waitFor({state:'hidden'});
    assert.equal(await roomMenuTrigger.getAttribute('aria-expanded'),'false');
    assert.equal(await shell.evaluate(()=>document.activeElement.closest('#room-menu')===null),true,'Tab moves focus out of the menu');

    await shell.emulateMedia({colorScheme:'light'});
    assertPaletteContrast(await readContrastPalette(shell), 'light');
    if (process.env.CORVID_CONTRAST_SCREENSHOT_PATH) await shell.screenshot({path:process.env.CORVID_CONTRAST_SCREENSHOT_PATH});

    const bookmarksTrigger=shell.locator('#show-bookmarks');
    await bookmarksTrigger.click();
    await shell.locator('#library[data-kind="bookmarks"]').waitFor();
    await shell.locator('#close-library').focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.evaluate(() => document.activeElement.id),'show-bookmarks','closing Bookmarks restores focus to the sidebar control that opened it');

    for(const [kind,triggerId] of [['history','show-history'],['downloads','show-downloads']]){
      await shell.locator(`#${triggerId}`).click();
      await shell.locator(`#library[data-kind="${kind}"]`).waitFor();
      await shell.locator('#close-library').focus();
      await shell.keyboard.press('Enter');
      await shell.locator('#library').waitFor({ state: 'hidden' });
      assert.equal(await shell.evaluate(() => document.activeElement.id),triggerId,`closing ${kind} restores focus to its sidebar control`);
    }

    const agentRoomsTrigger=shell.getByRole('button', { name: 'Agent 工作区' });
    await agentRoomsTrigger.focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library[data-kind="agent-rooms"]').waitFor();
    assert.equal(await shell.evaluate(() => document.activeElement.id), 'show-agent-rooms', 'keyboard activation keeps focus on the Agent workspace trigger');
    await shell.getByText('当前浏览身份还没有 Agent 空间。打开 Corvid Agent 后，可从当前网页创建工作区；发送页面内容前需要先检查并确认。').waitFor();
    await shell.emulateMedia({colorScheme:'light'});
    assertPaletteContrast(await readContrastPalette(shell), 'light');
    const lightShellPalette=await shell.evaluate(()=>({background:getComputedStyle(document.body).backgroundColor,sidebar:getComputedStyle(document.querySelector('#rooms')).backgroundColor,tabs:getComputedStyle(document.querySelector('#tab-strip')).backgroundColor,address:getComputedStyle(document.querySelector('#address-form')).backgroundColor,panel:getComputedStyle(document.querySelector('#library')).backgroundColor}));
    await shell.emulateMedia({colorScheme:'dark'});
    await shell.waitForFunction(()=>matchMedia('(prefers-color-scheme: dark)').matches&&getComputedStyle(document.documentElement).colorScheme==='dark');
    await shell.waitForFunction(()=>getComputedStyle(document.querySelector('#address-form')).backgroundColor==='rgb(34, 40, 51)');
    assertPaletteContrast(await readContrastPalette(shell), 'dark');
    const darkShellPalette=await shell.evaluate(()=>({background:getComputedStyle(document.body).backgroundColor,sidebar:getComputedStyle(document.querySelector('#rooms')).backgroundColor,tabs:getComputedStyle(document.querySelector('#tab-strip')).backgroundColor,address:getComputedStyle(document.querySelector('#address-form')).backgroundColor,panel:getComputedStyle(document.querySelector('#library')).backgroundColor,ctaBackground:getComputedStyle(document.querySelector('.workspace-empty-action')).backgroundColor,ctaText:getComputedStyle(document.querySelector('.workspace-empty-action')).color}));
    assert.deepEqual(darkShellPalette,{background:'rgb(24, 28, 36)',sidebar:'rgb(20, 24, 32)',tabs:'rgb(32, 37, 47)',address:'rgb(34, 40, 51)',panel:'rgb(24, 28, 36)',ctaBackground:'rgb(83, 103, 216)',ctaText:'rgb(255, 255, 255)'},'dark palette covers browser chrome, Agent workspace and high-contrast primary action');
    assert.notDeepEqual({background:darkShellPalette.background,sidebar:darkShellPalette.sidebar,tabs:darkShellPalette.tabs,address:darkShellPalette.address,panel:darkShellPalette.panel},lightShellPalette,'system color scheme changes the visible browser and workspace surfaces');
    await shell.locator('#room-menu-trigger').click();
    await shell.locator('#room-menu').getByRole('menuitem',{name:'新建空间'}).click();
    await shell.locator('#new-room[open]').waitFor();
    const darkDialog=await shell.locator('#new-room').evaluate(dialog=>({background:getComputedStyle(dialog).backgroundColor,input:getComputedStyle(dialog.querySelector('input')).backgroundColor,scheme:getComputedStyle(dialog).colorScheme}));
    assert.deepEqual(darkDialog,{background:'rgb(24, 28, 36)',input:'rgb(24, 28, 36)',scheme:'dark'},'native HTML dialog and controls follow the dark color scheme');
    await shell.keyboard.press('Escape');
    await shell.locator('#new-room').waitFor({state:'hidden'});
    const openAgentButton = shell.getByRole('button', { name: '打开 Corvid Agent', exact: true });
    await openAgentButton.focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library[data-kind="pi-workbench"]').waitFor();
    await shell.getByText('请先打开一个 HTTP(S) 页面，再连接 Corvid Agent').waitFor();
    const darkAgentPalette=await shell.evaluate(()=>({form:getComputedStyle(document.querySelector('#pi-task-form')).backgroundColor,composer:getComputedStyle(document.querySelector('#pi-task-form textarea')).backgroundColor,welcomeMark:getComputedStyle(document.querySelector('.pi-welcome-mark')).backgroundColor}));
    assert.deepEqual(darkAgentPalette,{form:'rgb(27, 32, 41)',composer:'rgb(29, 35, 45)',welcomeMark:'rgb(41, 47, 76)'},'Corvid Agent composer and empty state use dark surfaces');
    if(process.env.CORVID_THEME_SCREENSHOT_PATH)await shell.screenshot({path:process.env.CORVID_THEME_SCREENSHOT_PATH});
    await shell.emulateMedia({colorScheme:'light'});
    await shell.waitForFunction(()=>!matchMedia('(prefers-color-scheme: dark)').matches&&getComputedStyle(document.documentElement).colorScheme==='light');
    await shell.waitForFunction(()=>getComputedStyle(document.querySelector('#address-form')).backgroundColor==='rgb(247, 248, 250)');
    const restoredShellPalette=await shell.evaluate(()=>({background:getComputedStyle(document.body).backgroundColor,sidebar:getComputedStyle(document.querySelector('#rooms')).backgroundColor,tabs:getComputedStyle(document.querySelector('#tab-strip')).backgroundColor,address:getComputedStyle(document.querySelector('#address-form')).backgroundColor,panel:getComputedStyle(document.querySelector('#library')).backgroundColor}));
    assert.deepEqual(restoredShellPalette,lightShellPalette,'switching back to the system light scheme restores the light palette');
    assert.equal(await shell.evaluate(() => document.activeElement.getAttribute('aria-label')), '描述要完成的浏览任务', 'empty-state CTA moves focus into the Corvid Agent composer');
    const closeAgentPanel = shell.getByRole('button', { name: '关闭面板' });
    await closeAgentPanel.focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.evaluate(() => document.activeElement.id), 'show-pi-workbench', 'closing the CTA-opened workbench restores focus to its sidebar entry');
    await agentRoomsTrigger.click();
    await shell.locator('#library[data-kind="agent-rooms"]').waitFor();
    assert.equal(await shell.locator('#library-search').isVisible(), false);
    await shell.locator('#close-library').focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.getByRole('button', { name: 'Agent 工作区' }).getAttribute('aria-expanded'), 'false');
    assert.equal(await shell.evaluate(() => document.activeElement.id),'show-agent-rooms','closing Agent Rooms restores focus to its sidebar control');
    await shell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
    await shell.locator('#library[data-kind="pi-workbench"]').waitFor();
    await agentRoomsTrigger.click();
    await shell.locator('#library[data-kind="agent-rooms"]').waitFor();
    await shell.locator('#close-library').focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.evaluate(() => document.activeElement.id),'show-agent-rooms','switching panels updates the focus restoration target');
    await shell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
    await shell.locator('#library[data-kind="pi-workbench"]').waitFor();
    await shell.locator('#close-library').focus();
    await shell.keyboard.press('Enter');
    await shell.locator('#library').waitFor({ state: 'hidden' });
    assert.equal(await shell.evaluate(() => document.activeElement.id),'show-pi-workbench','closing Pi workbench restores focus to its sidebar control');
    await agentRoomsTrigger.click();
    await shell.getByText('当前浏览身份还没有 Agent 空间。打开 Corvid Agent 后，可从当前网页创建工作区；发送页面内容前需要先检查并确认。').waitFor();

    const defaultRoom = await call('/rooms', 'POST', { name: 'Default agent room' });
    await shell.getByRole('button', { name: '查看 Default agent room' }).waitFor();
    assert.equal(await shell.getByText('Agent 控制中 · 1 个标签').isVisible(), true);
    await call('/rooms', 'POST', { name: 'Parallel agent room' });
    await shell.getByRole('button', { name: '查看 Parallel agent room' }).waitFor();

    const firstTaskRoom=await startTask(defaultRoom,'[fixture:hold] first parallel room task');
    assert.ok(firstTaskRoom?.roomId&&firstTaskRoom.taskId,'first deterministic task is bound to its own Agent Room');
    assert.equal(firstTaskRoom.roomId,defaultRoom.id,`first task Room mismatch: ${JSON.stringify({expected:defaultRoom.id,actual:firstTaskRoom.roomId})}`);
    const parallelRoom=(await call('/rooms')).rooms.find(room=>room.name==='Parallel agent room');
    const secondTaskRoom=await startTask(parallelRoom,'[fixture:hold] second parallel room task');
    assert.equal(secondTaskRoom.roomId,parallelRoom.id,`second task Room mismatch: ${JSON.stringify({expected:parallelRoom.id,actual:secondTaskRoom.roomId,first:firstTaskRoom.roomId,pageBinding:secondTaskRoom.pageBinding,activeRoom:(await call('/rooms')).activeRoomId})}`);
    const roomButton=name=>shell.locator('#room-strip button').filter({hasText:name});
    await roomButton('Default agent room').locator('.room-task-status[data-status="running"]').waitFor();
    await roomButton('Parallel agent room').locator('.room-task-status[data-status="running"]').waitFor();
    assert.match(await roomButton('Default agent room').getAttribute('aria-label'),/任务运行中/,'Room navigation announces the running task state');
    assert.match(await roomButton('Default agent room').getAttribute('title'),/任务运行中/,'Room navigation tooltip includes the task state');
    await agentRoomsTrigger.click();
    await shell.getByRole('button',{name:/^\[fixture:hold\] first parallel room task；正在回复；页面：Room task fixture；最近活动：/}).waitFor();
    await shell.getByRole('button',{name:/^\[fixture:hold\] second parallel room task；正在回复；页面：Room task fixture；最近活动：/}).waitFor();
    const roomAnnouncement=shell.locator('#agent-room-announcer');
    await roomAnnouncement.waitFor({timeout:3_000});
    assert.equal(await roomAnnouncement.getAttribute('role'),'status','Agent Room states use one stable live region');
    assert.equal(await roomAnnouncement.getAttribute('aria-live'),'polite');
    assert.equal(await roomAnnouncement.getAttribute('aria-atomic'),'true');
    assert.equal(await shell.locator('.agent-room-task-state[role="status"]').count(),0,'task rows do not create duplicate transient live regions');
    await roomAnnouncement.evaluate(region=>{window.__agentRoomAnnouncement=region;});
    const visibleRoomSurface=await shell.locator('#library').evaluate(panel=>({text:panel.innerText,labels:[...panel.querySelectorAll('[aria-label],[title]')].flatMap(node=>[node.getAttribute('aria-label'),node.getAttribute('title')]).filter(Boolean)}));
    assert.doesNotMatch(`${visibleRoomSurface.text}\n${visibleRoomSurface.labels.join('\n')}`,/\bPi\b|pi-coding-agent/i,'Agent Room task statuses and accessible labels use Corvid product semantics');
    assert.equal(await shell.locator('.agent-room-task-state[data-status="running"]').count(),2,'parallel Agent Rooms expose their independent running task states');
    assert.equal(await shell.getByText('Agent 控制中 · 1 个标签').count(),2,'Room control state remains independently visible beside task state');
    assert.equal(await shell.getByText('[fixture:hold] first parallel room task',{exact:true}).count(),0,'task prompt text is not exposed in the Agent Room list');
    const firstOpen=shell.getByRole('button',{name:/^\[fixture:hold\] first parallel room task；正在回复；页面：Room task fixture；最近活动：/});
    await firstOpen.click();
    await shell.locator('#library[data-kind="pi-workbench"]').waitFor();
    await shell.locator('.pi-task-entry').waitFor();
    assert.equal(await shell.locator('.pi-task-entry').getAttribute('data-task-id'),firstTaskRoom.taskId,'opening a Room task selects its existing conversation and task ID');
    assert.match(await shell.locator('.pi-page-binding').textContent(),/任务页面：Default agent room\s*\//,'the composer stays bound to the opened task page without activating a different Room');
    await shell.getByRole('button',{name:'停止任务'}).click();
    await shell.locator('.pi-task-state[data-status="interrupted"]').waitFor();
    await agentRoomsTrigger.click();
    await shell.locator('.agent-room-task-state[data-status="interrupted"]').waitFor();
    assert.equal(await roomAnnouncement.evaluate(region=>window.__agentRoomAnnouncement===region),true,'Agent Room status region survives task-list redraw');
    assert.match(await roomAnnouncement.textContent(),/Default agent room/);
    assert.match(await roomAnnouncement.textContent(),/等待检查/);
    await shell.getByRole('button',{name:'接管 Parallel agent room'}).click();
    await shell.locator('.agent-room-task-state[data-status="waiting_for_user"]').waitFor();
    await roomButton('Parallel agent room').locator('.room-task-status[data-status="waiting"]').waitFor();
    assert.match(await roomButton('Parallel agent room').getAttribute('aria-label'),/等待你处理/,'Room navigation announces the task waiting for user action');
    assert.match(await roomAnnouncement.textContent(),/Parallel agent room/);
    assert.match(await roomAnnouncement.textContent(),/等待你接管/);
    assert.match(await roomAnnouncement.textContent(),/用户控制中/);
    await shell.getByRole('button',{name:'交还 Agent: Parallel agent room'}).click();
    await until(async()=>(await call('/rooms')).rooms.find(room=>room.id===parallelRoom.id)?.ownership==='agent');
    await shell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
    const completedTask=await startTask(defaultRoom,'summarize fixture page','completed');
    assert.ok(completedTask.taskId);
    const failedTask=await startTask(parallelRoom,'[fixture:fail-once] simulated provider issue','failed');
    assert.ok(failedTask.taskId);
    await agentRoomsTrigger.click();
    await shell.locator('.agent-room-task-state[data-status="completed"]').waitFor();
    await shell.locator('.agent-room-task-state[data-status="failed"]').waitFor();
    await roomButton('Default agent room').locator('.room-task-status[data-status="completed"]').waitFor();
    assert.match(await roomButton('Default agent room').getAttribute('aria-label'),/任务已完成，待查看/,'Room navigation announces completion awaiting review');
    await shell.evaluate(()=>window.browserShell.invoke('setUiLocale',{locale:'en'}));
    await shell.waitForFunction(()=>[...document.querySelectorAll('#room-strip button')].some(item=>item.getAttribute('aria-label')?.includes('Completed · ready to review')));
    assert.equal(await shell.locator('#room-strip .room-task-status').filter({hasText:'Completed · ready to review'}).count(),1,'English navigation marker includes the completed review state');
    await shell.evaluate(()=>window.browserShell.invoke('setUiLocale',{locale:'zh-CN'}));
    await shell.getByRole('button',{name:'Corvid Agent',exact:true}).click();
    assert.equal(await roomAnnouncement.isHidden(),true,'Agent Room announcement region is hidden outside its panel');
    assert.equal(await roomAnnouncement.textContent(),'','closed Agent Room panel does not retain a stale live announcement');
    await agentRoomsTrigger.click();
    await shell.locator('.agent-room-task-state[data-status="completed"]').waitFor();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(640,600));
    await shell.waitForFunction(()=>window.innerWidth<=725);
    const taskViewport=await shell.evaluate(()=>({width:window.innerWidth,height:window.innerHeight,deviceScaleFactor:window.devicePixelRatio}));
    const taskRowLayouts=await shell.locator('.agent-room-entry').evaluateAll(rows=>rows.map(row=>{const tasks=row.querySelector('.agent-room-tasks');return{width:row.clientWidth,scrollWidth:row.scrollWidth,taskWidth:tasks?.clientWidth,taskScrollWidth:tasks?.scrollWidth,taskActions:[...(tasks?.querySelectorAll('button')||[])].map(action=>({left:action.getBoundingClientRect().left,right:action.getBoundingClientRect().right}))};}));
    assert.equal(taskViewport.width>=719&&taskViewport.width<=725,true,`719px minimum viewport applies: ${JSON.stringify(taskViewport)}`);
    assert.equal(await shell.locator('.agent-room-task-state').count(),4,'all parallel and terminal task states remain present in the narrow Agent Room list');
    const narrowTaskMarker=await roomButton('Default agent room').locator('.room-task-status').evaluate(marker=>{const rect=marker.getBoundingClientRect();return{width:rect.width,height:rect.height,right:rect.right,buttonRight:marker.parentElement.getBoundingClientRect().right,visible:getComputedStyle(marker).display!=='none'};});
    assert.equal(narrowTaskMarker.visible,true,'the completed task marker remains visible in the compact space rail');
    assert.ok(narrowTaskMarker.width>=6&&narrowTaskMarker.height>=6&&narrowTaskMarker.right<=narrowTaskMarker.buttonRight,JSON.stringify({taskViewport,narrowTaskMarker}));
    assert.ok(taskRowLayouts.every(row=>row.scrollWidth<=row.width&&(!row.taskWidth||row.taskScrollWidth<=row.taskWidth)&&row.taskActions.every(action=>action.left>=0&&action.right<=taskViewport.width)),JSON.stringify({taskViewport,taskRowLayouts}));
    const minimumViewportLayout=await Promise.all([
      app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];return{width:window.getContentSize()[0],pageWidths:window.contentView.children.map(view=>view.getBounds().width)};}),
      shell.locator('#library').evaluate(panel=>panel.querySelector('.agent-room-entry')?.getBoundingClientRect().width||0),
    ]);
    assert.ok(minimumViewportLayout[0].width>=719&&minimumViewportLayout[0].pageWidths.every(width=>width>=320)&&minimumViewportLayout[1]>=280,JSON.stringify({taskViewport,minimumViewportLayout}));
    if(process.env.CORVID_AGENT_PANEL_LAYOUT_SCREENSHOT_PATH)await shell.screenshot({path:process.env.CORVID_AGENT_PANEL_LAYOUT_SCREENSHOT_PATH});

    const otherProfile = await call('/profiles', 'POST', { name: 'Work profile' });
    const otherRoom = await call('/rooms', 'POST', { name: 'Work agent room', profileId: otherProfile.id });
    await shell.getByRole('button', { name: '查看 Default agent room' }).waitFor();
    assert.equal(await shell.getByText('Work agent room', { exact: true }).count(), 0);

    await shell.locator('#profile-select').selectOption(otherProfile.id);
    await shell.getByRole('button', { name: '查看 Work agent room' }).waitFor();
    assert.equal(await shell.getByText('Default agent room', { exact: true }).count(), 0);
    assert.equal(await shell.getByText('Parallel agent room', { exact: true }).count(), 0);
    assert.equal(await shell.locator('.agent-room-task-state').count(),0,'other Profile cannot see the active Profile task state');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 600));
    await shell.waitForFunction(() => window.innerWidth <= 725);
    const panelLayout = await shell.locator('#library').evaluate(panel => {
      const row = panel.querySelector('.agent-room-entry');
      return { width: panel.clientWidth, scrollWidth: row.scrollWidth, rowWidth: row.clientWidth };
    });
    assert.ok(panelLayout.width > 0);
    assert.ok(panelLayout.scrollWidth <= panelLayout.rowWidth, JSON.stringify(panelLayout));

    const responsiveLayouts=[];
    for(const requestedWidth of [719,720,721,800,860,873,874,900,972,983,984,1024,1280]){
      await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,600),requestedWidth);
      await shell.waitForFunction(width=>window.innerWidth===width,requestedWidth);
      const layout=await Promise.all([
        app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];return{windowWidth:window.getContentSize()[0],pageWidths:window.contentView.children.map(view=>view.getBounds().width)};}),
        shell.locator('#library').evaluate(panel=>panel.querySelector('.agent-room-entry')?.getBoundingClientRect().width||0),
      ]);
      const [browser,agentWidth]=layout;
      responsiveLayouts.push({requestedWidth,browserWidth:browser.pageWidths[0],agentContentWidth:agentWidth});
      assert.ok(browser.pageWidths.length>0&&browser.pageWidths.every(width=>width>=320),`web canvas must retain 320px at ${requestedWidth}px: ${JSON.stringify({browser,agentWidth})}`);
      assert.ok(agentWidth>=280,`Agent panel content must retain 280px at ${requestedWidth}px: ${JSON.stringify({browser,agentWidth})}`);
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(640,600));
    await shell.waitForFunction(()=>window.innerWidth<=725);

    const view = shell.getByRole('button', { name: '查看 Work agent room' });
    await view.focus();
    await shell.keyboard.press('Tab');
    assert.equal(await shell.evaluate(() => document.activeElement.getAttribute('aria-label')), '接管 Work agent room');
    await shell.keyboard.press('Enter');
    await until(async () => (await call('/rooms')).rooms.find(room => room.id === otherRoom.id)?.ownership === 'user');
    await shell.getByRole('button', { name: '交还 Agent: Work agent room' }).focus();
    await shell.keyboard.press('Enter');
    await until(async () => (await call('/rooms')).rooms.find(room => room.id === otherRoom.id)?.ownership === 'agent');

    const risky = await call('/tabs/' + otherRoom.tabs[0].id + '/action', 'POST', {
      operation: 'evaluate',
      args: { expression: 'new Promise(() => {})', timeoutMs: 100 },
    });
    assert.equal(risky.status, 'timed_out');
    await shell.getByRole('button', { name: '复核 Work agent room 的执行状态' }).waitFor();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
    await shell.getByRole('button', { name: '复核 Work agent room 的执行状态' }).click();
    const reviewed = (await call('/rooms')).rooms.find(room => room.id === otherRoom.id);
    assert.equal(reviewed.ownership, 'user');
    assert.ok(reviewed.executionRisk);
    await shell.getByText('页面执行状态未知 · 1 个标签').waitFor();

    await shell.getByRole('button', { name: '查看 Work agent room' }).click();
    await shell.locator('#library').waitFor({ state: 'hidden' });
    const active = await call('/rooms');
    assert.equal(active.activeRoomId, otherRoom.id);
    assert.equal(await shell.getByRole('button', { name: 'Work agent room' }).getAttribute('class').then(value => value.includes('selected')), true);

    console.log(`PASS Agent Room panel empty state, parallel task status, exact conversation return, Profile filtering, 320px browser/280px Agent layout widths ${responsiveLayouts.map(item=>item.requestedWidth).join('/')}, narrow layout ${taskViewport.width}×${taskViewport.height} @${taskViewport.deviceScaleFactor}x, keyboard handoff and Room activation`);
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve=>site.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
