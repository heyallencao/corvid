#!/usr/bin/env node

const fs = require('node:fs');

function fail(message) {
  console.error(`PR 描述截图检查失败：${message}`);
  process.exitCode = 1;
}

const eventPath = process.argv[2] || process.env.GITHUB_EVENT_PATH;
if (!eventPath) {
  fail('缺少 GitHub PR 事件文件路径。');
  process.exit();
}

let event;
try {
  event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
} catch (error) {
  fail(`无法读取 PR 事件文件：${error.message}`);
  process.exit();
}

const pullRequest = event.pull_request;
if (!pullRequest) {
  fail('当前事件不包含 pull_request。');
  process.exit();
}

const body = typeof pullRequest.body === 'string' ? pullRequest.body : '';
const merged = event.action === 'closed' && pullRequest.merged === true;
const headRef = typeof pullRequest.head?.ref === 'string' ? pullRequest.head.ref : '';
const problems = [];

function addProblem(message) {
  if (!problems.includes(message)) problems.push(message);
}

function isLocalPath(value) {
  return /^(?:file:\/\/|\/(?:Users|private\/tmp|tmp|home|var\/folders)\/|[A-Za-z]:\\Users\\)/i.test(value.trim());
}

function checkImageTarget(target, description) {
  const value = target.trim().replace(/^<|>$/g, '');
  if (isLocalPath(value)) {
    addProblem(`${description}使用本机路径：${value}`);
    return;
  }

  if (!/^https?:\/\//i.test(value)) {
    addProblem(`${description}不是可访问的绝对 URL：${value}`);
    return;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    addProblem(`${description}不是有效 URL：${value}`);
    return;
  }

  let branchPath = null;
  if (url.hostname.toLowerCase() === 'github.com') {
    const match = url.pathname.match(/^\/[^/]+\/[^/]+\/blob\/(.+)$/);
    if (match) branchPath = match[1];
  } else if (url.hostname.toLowerCase() === 'raw.githubusercontent.com') {
    const match = url.pathname.match(/^\/[^/]+\/[^/]+\/(.+)$/);
    if (match) branchPath = match[1];
  }

  if (branchPath === null) return;

  let decodedPath = branchPath;
  try {
    decodedPath = decodeURIComponent(branchPath);
  } catch {
    // Keep the literal URL path when it contains malformed escaping.
  }

  if (/^main\//.test(decodedPath)) return;
  if (!merged && headRef && (decodedPath === headRef || decodedPath.startsWith(`${headRef}/`))) return;
  addProblem(`${description}依赖非 main 分支：${value}`);
}

for (const match of body.matchAll(/!\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g)) {
  checkImageTarget(match[1], 'Markdown 图片');
}

const references = new Map(
  [...body.matchAll(/^\s*\[([^\]]+)\]:\s*(<[^>]+>|\S+)/gm)]
    .map((match) => [match[1].trim().toLowerCase(), match[2]]),
);
for (const match of body.matchAll(/!\[([^\]]*)\]\[([^\]]*)\]/g)) {
  const reference = (match[2] || match[1]).trim().toLowerCase();
  const target = references.get(reference);
  if (target) checkImageTarget(target, 'Markdown 引用图片');
}

for (const match of body.matchAll(/<img\b[^>]*\bsrc\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/gi)) {
  checkImageTarget(match[2] || match[3], 'HTML 图片');
}

for (const [index, line] of body.split(/\r?\n/).entries()) {
  if (!/(?:截图|图片|图像|screenshot|image)/i.test(line)) continue;
  const localPathMatch = line.match(/(?:file:\/\/\S*|\/(?:Users|private\/tmp|tmp|home|var\/folders)\/[^\s)`<>]+|[A-Za-z]:\\Users\\[^\s)`<>]+)/i);
  if (localPathMatch) addProblem(`第 ${index + 1} 行在截图说明中包含本机路径：${localPathMatch[0]}`);
}

if (problems.length > 0) {
  for (const problem of problems) fail(problem);
  console.error('请使用 GitHub 附件或已合并到 main 的 QA 截图 URL；评审中的 PR 分支截图须在合并后更新。');
  process.exit();
}

console.log(merged
  ? 'PR 描述截图检查通过：未发现本机路径、相对图片路径或合并后仍依赖分支的截图链接。'
  : 'PR 描述截图检查通过：未发现本机路径、相对图片路径或其他分支依赖。');
