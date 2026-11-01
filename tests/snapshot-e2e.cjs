const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { _electron } = require('playwright-core');
const electron = require('electron');

const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await delay(50);
  }
  throw new Error(`Timed out${last ? `: ${last.message}` : ''}`);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-snapshot-'));
  const pageMain = `<!doctype html><title>Snapshot fixture</title><script>window.clicks=[];</script>
<input id="top" aria-label="Top input">
<div id="sub" role="group" aria-label="Sub container">
  <button id="s1" onclick="window.clicks.push('s1')">Sub one</button>
  <button id="s2" onclick="window.clicks.push('s2')">Sub two</button>
</div>
<script>
const outer=document.createElement('iframe');outer.id='outer';
outer.srcdoc='<button id="outerbtn" onclick="window.top.clicks.push(\\'outer\\')">Outer action</button>';
document.body.append(outer);
outer.addEventListener('load',()=>{const inner=outer.contentDocument.createElement('iframe');inner.id='inner';inner.srcdoc='<input id="innerinput" aria-label="Inner input">';outer.contentDocument.body.append(inner);});
</script>
<div style="height:3000px"></div>
<button id="below" onclick="window.clicks.push('below')">Below action</button>
` + '__CROSS__';
  const pageMany = `<!doctype html><title>Many</title><div id="many"></div><script>window.clicks=[];for(let i=0;i<250;i++){const b=document.createElement('button');b.textContent='Item '+i;b.setAttribute('aria-label','Item '+i);document.querySelector('#many').append(b);}</script>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (req.url === '/many') { res.end(pageMany); return; }
    if (req.url === '/other') { res.end('<title>Other</title><button aria-label="Cross button">Cross button</button>'); return; }
    res.end(pageMain.replace('__CROSS__', `<iframe id="cross" src="http://127.0.0.1:${otherPort}/other"></iframe>`));
  });
  let otherPort;
  const other = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<title>Cross origin</title><button aria-label="Cross button">Cross button</button>');
  });
  await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
  otherPort = other.address().port;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const env = { ...process.env, CORVID_DATA_DIR: dir, CORVID_TEST_MODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  let app, client;
  try {
    app = await _electron.launch({ executablePath: electron, args: [root], env });
    await app.firstWindow();
    await until(() => fs.existsSync(path.join(dir, 'control.json')));
    client = await (await import('../sdk/index.js')).connect({ dataDir: dir });
    const room = await client.openRoom('Snapshot room');
    const page = room.page('p1');
    await page.goto(base + '/');
    await page.waitForLoadState('load');

    // Multi-level same-origin iframes need time to attach their srcdoc documents.
    await until(async () => (await page.snapshot()).items.some(item => item.name === 'Inner input'));

    // Default page scope: nested frames included, offscreen content included,
    // cross-origin frame excluded and reported.
    const pageSnapshot = await page.snapshot();
    assert.equal(pageSnapshot.scope, 'page');
    const names = pageSnapshot.items.map(item => item.name);
    assert.ok(names.includes('Top input'));
    assert.ok(names.includes('Inner input'), 'nested same-origin iframe is included');
    assert.ok(names.includes('Below action'), 'page scope includes offscreen elements');
    assert.ok(!names.includes('Cross button'), 'cross-origin iframe content is excluded');
    assert.ok(pageSnapshot.inaccessibleFrames >= 1);
    assert.ok(pageSnapshot.items.every(item => /^@\d+$/.test(item.ref)));
    assert.equal(pageSnapshot.items.find(item => item.name === 'Top input').frame, null);
    const innerItem = pageSnapshot.items.find(item => item.name === 'Inner input');
    assert.equal(innerItem.frame, '#outer');
    assert.ok(pageSnapshot.total >= pageSnapshot.items.length);

    // Viewport scope drops the offscreen button.
    const viewportSnapshot = await page.snapshot({ scope: 'viewport' });
    assert.equal(viewportSnapshot.scope, 'viewport');
    assert.ok(viewportSnapshot.items.some(item => item.name === 'Top input'));
    assert.ok(!viewportSnapshot.items.some(item => item.name === 'Below action'));

    // Subtree scope resolves a root reference and only collects inside it.
    const container = pageSnapshot.items.find(item => item.name === 'Sub container');
    assert.ok(container, 'role=group container is part of the snapshot');
    const subtree = await page.snapshot({ scope: 'subtree', root: container.ref });
    assert.equal(subtree.scope, 'subtree');
    const subtreeNames = subtree.items.map(item => item.name);
    assert.ok(subtreeNames.includes('Sub one') && subtreeNames.includes('Sub two'));
    assert.ok(!subtreeNames.includes('Top input'));

    // @N references work as action targets.
    const subOne = subtree.items.find(item => item.name === 'Sub one');
    await page.click(subOne.ref);
    const topInput = pageSnapshot.items.find(item => item.name === 'Top input');
    await page.fill(topInput.ref, 'typed');
    assert.equal(await page.evaluate(() => document.querySelector('#top').value), 'typed');
    assert.ok((await page.evaluate(() => window.clicks)).includes('s1'));

    // Playwright-style selector subset: :has-text, :text-is and >> nth=.
    await page.click('button:has-text("Sub two")');
    await page.click('button:text-is("Sub one")');
    await page.click('#sub button >> nth=1');
    await page.click('#sub button >> nth=-1');
    const clicks = await page.evaluate(() => window.clicks);
    assert.ok(clicks.filter(value => value === 's2').length >= 2);
    assert.ok(clicks.filter(value => value === 's1').length >= 2);

    // full_page is an alias of the default page scope.
    const fullPage = await page.snapshot({ scope: 'full_page' });
    assert.equal(fullPage.scope, 'page');
    assert.ok(fullPage.items.some(item => item.name === 'Below action'));

    // Truncation and total count.
    await page.goto(base + '/many');
    await page.waitForLoadState('load');
    const many = await page.snapshot();
    assert.equal(many.truncated, true);
    assert.equal(many.items.length, 200);
    assert.ok(many.total >= 250);

    // Invalid options are rejected in the SDK.
    await assert.rejects(() => page.snapshot({ scope: 'nope' }), /scope/);
    await assert.rejects(() => page.snapshot({ scope: 'subtree' }), /root/);

    await room.finish({ keep: [] });
    await client.disconnect();
    client = undefined;
    console.log('PASS snapshot scopes, nested frames, @ref targets, selector subset and truncation');
  } finally {
    if (client) await client.disconnect().catch(() => {});
    if (app) await app.close().catch(() => {});
    server.closeAllConnections();
    other.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => other.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
