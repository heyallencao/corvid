const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts/check-pr-description-images.cjs');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corvid-pr-image-check-'));

const cases = [
  {
    name: '开放 PR 可引用自身分支的图片',
    action: 'opened',
    ref: 'codex/issue244-test',
    merged: false,
    body: '![截图](https://github.com/heyallencao/corvid/blob/codex/issue244-test/docs/qa/screenshots/a.png)',
    expected: 0,
  },
  {
    name: 'GitHub 附件可用于开放 PR',
    action: 'opened',
    ref: 'codex/demo',
    merged: false,
    body: '![截图](https://github.com/user-attachments/assets/abcdef)',
    expected: 0,
  },
  {
    name: '合并 PR 可引用 main 上的图片',
    action: 'closed',
    ref: 'codex/demo',
    merged: true,
    body: '![截图](https://github.com/heyallencao/corvid/blob/main/docs/qa/screenshots/a.png)',
    expected: 0,
  },
  {
    name: '拒绝本机图片路径',
    action: 'opened',
    ref: 'codex/demo',
    merged: false,
    body: '![截图](/tmp/private.png)',
    expected: 1,
  },
  {
    name: '拒绝相对图片路径',
    action: 'opened',
    ref: 'codex/demo',
    merged: false,
    body: '![截图](docs/qa/screenshots/a.png)',
    expected: 1,
  },
  {
    name: '拒绝引用其他分支的图片',
    action: 'opened',
    ref: 'codex/demo',
    merged: false,
    body: '![截图](https://github.com/heyallencao/corvid/blob/codex/other/docs/qa/screenshots/a.png)',
    expected: 1,
  },
  {
    name: '合并时拒绝仍依赖 PR 分支的图片',
    action: 'closed',
    ref: 'codex/demo',
    merged: true,
    body: '![截图](https://github.com/heyallencao/corvid/blob/codex/demo/docs/qa/screenshots/a.png)',
    expected: 1,
  },
  {
    name: '检查 Markdown 引用式图片',
    action: 'opened',
    ref: 'codex/demo',
    merged: false,
    body: '![截图][local]\n\n[local]: /Users/alice/Desktop/a.png',
    expected: 1,
  },
  {
    name: '检查未加引号的 HTML 图片地址',
    action: 'opened',
    ref: 'codex/demo',
    merged: false,
    body: '<img src=/private/tmp/a.png>',
    expected: 1,
  },
  {
    name: '拒绝截图说明中的本机路径',
    action: 'edited',
    ref: 'codex/demo',
    merged: false,
    body: '截图文件：/Users/alice/Desktop/a.png',
    expected: 1,
  },
];

try {
  for (const [index, testCase] of cases.entries()) {
    const eventPath = path.join(tempDir, `${index}.json`);
    fs.writeFileSync(eventPath, JSON.stringify({
      action: testCase.action,
      pull_request: {
        body: testCase.body,
        merged: testCase.merged,
        head: { ref: testCase.ref },
      },
    }));
    const result = spawnSync(process.execPath, [script, eventPath], { encoding: 'utf8' });
    assert.equal(result.status, testCase.expected, `${testCase.name}\n${result.stdout}${result.stderr}`);
    console.log(`通过：${testCase.name}`);
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
