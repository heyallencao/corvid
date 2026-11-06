import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const chromeImport = require('../desktop/chrome-import.cjs');
const messageIds = [
  ['[[corvid-error:chrome-sqlite-corrupt]]', 'chromeSqliteCorrupt'],
  ['[[corvid-error:chrome-sqlite-busy]]', 'chromeSqliteBusy'],
  ['[[corvid-error:chrome-sqlite-read-failed]]', 'chromeSqliteReadFailed'],
];

function makeProfile() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'corvid-chrome-sqlite-'));
  const profile = path.join(root, 'Default');
  mkdirSync(profile);
  return { root, profile };
}

function readError(root) {
  let caught;
  try {
    chromeImport.readProfile(root, 'Default');
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'Expected Chrome History to be rejected');
  return caught;
}

test('damaged History database is rejected with a stable code and source bytes stay unchanged', t => {
  const { root, profile } = makeProfile();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const historyFile = path.join(profile, 'History');
  const original = Buffer.from('not a SQLite database');
  writeFileSync(historyFile, original);

  const error = readError(root);

  assert.equal(error.message, messageIds[0][0]);
  assert.deepEqual(readFileSync(historyFile), original);
});

test('busy History database is reported separately from corruption', t => {
  const { root, profile } = makeProfile();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const historyFile = path.join(profile, 'History');
  const lock = new DatabaseSync(historyFile);
  lock.exec('CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER)');
  lock.exec('BEGIN EXCLUSIVE');
  t.after(() => {
    try { lock.exec('ROLLBACK'); } catch {}
    lock.close();
  });

  assert.equal(readError(root).message, messageIds[1][0]);
});

test('ordinary History query errors keep a distinct stable read failure code', t => {
  const { root, profile } = makeProfile();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const historyFile = path.join(profile, 'History');
  const database = new DatabaseSync(historyFile);
  database.exec('CREATE TABLE unrelated (value TEXT)');
  database.close();

  assert.equal(readError(root).message, messageIds[2][0]);
});

test('Chrome SQLite errors resolve to matching simplified Chinese and English copy', () => {
  const i18nWindow = {};
  const document = { documentElement: {}, querySelectorAll: () => [] };
  runInNewContext(readFileSync(new URL('../desktop/locales.js', import.meta.url), 'utf8'), {
    window: i18nWindow,
    document,
    Intl,
  });
  const messages = i18nWindow.corvidI18n;

  for (const [errorCode, key] of messageIds) {
    messages.setLocale('zh-CN');
    const chinese = messages.userFacingError(errorCode);
    assert.equal(chinese, messages.t(key));
    assert.equal(messages.userFacingError(`Error invoking remote method 'shell-action': Error: ${errorCode}`), messages.t(key));
    assert.match(chinese, /浏览器/);
    assert.match(chinese, /未修改|完全退出|检查文件访问权限/);

    messages.setLocale('en');
    const english = messages.userFacingError(errorCode);
    assert.equal(english, messages.t(key));
    assert.match(english, /selected browser profile database/);
  }
});
