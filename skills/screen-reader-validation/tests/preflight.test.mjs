import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { preflight, guidepupCachePath, formatPreflight, findNvdaAsset, findVoiceOverAsset } from '../scripts/lib/preflight.mjs';
import { runSr, freshDir } from './helpers.mjs';

test('mock reader is always ready', async () => {
  const r = await preflight({ reader: 'mock' });
  assert.equal(r.ready, true);
  assert.ok(!r.checks.some((c) => c.status === 'fail'));
});

test('a screen reader on the wrong OS fails with an instruction', async () => {
  for (const [reader, platform] of [['nvda', 'linux'], ['voiceover', 'win32']]) {
    const r = await preflight({ reader, platform });
    assert.equal(r.ready, false, reader);
    const fail = r.checks.find((c) => c.status === 'fail');
    assert.ok(fail?.fix, `${reader} failure has a fix`);
    assert.match(formatPreflight(r), /FAIL/);
  }
});

test('guidepup cache path honours the env override and OS defaults', () => {
  assert.equal(guidepupCachePath('win32', { GUIDEPUP_SCREEN_READERS_PATH: 'X:\\sr' }), path.win32.resolve('X:\\sr'));
  assert.equal(guidepupCachePath('win32', { LOCALAPPDATA: 'C:\\L' }), path.win32.join('C:\\L', 'guidepup'));
  assert.equal(guidepupCachePath('darwin', {}, '/Users/u'), '/Users/u/Library/Caches/guidepup');
  assert.equal(guidepupCachePath('darwin', { HOME: '/Users/h' }, '/Users/u'), '/Users/h/Library/Caches/guidepup');
});

test('asset lookups follow the installed Guidepup manifest', () => {
  const cache = freshDir('cache');
  const manifest = { screenReaders: [
    { id: 'nvda', assets: [{ version: '9.9-test' }] },
    { id: 'voiceover', assets: [{ platformVersion: '24', version: '1.0', asset: 'vo.dmg' }] },
  ] };
  const missing = findNvdaAsset(cache, manifest);
  assert.equal(missing.path, null);
  assert.equal(missing.version, '9.9-test');
  assert.equal(missing.expected, path.win32.join(cache, 'nvda', 'all', '9.9-test', 'extracted', 'nvda.exe'));
  fs.mkdirSync(path.dirname(missing.expected), { recursive: true });
  fs.writeFileSync(missing.expected, '');
  assert.equal(findNvdaAsset(cache, manifest).path, missing.expected);
  assert.equal(findNvdaAsset(cache, null).path, null, 'no manifest: never guesses a version');

  assert.equal(findVoiceOverAsset('/c', manifest, '23.1.0').supported, false);
  const vo = findVoiceOverAsset('/c', manifest, '24.0.0');
  assert.equal(vo.supported, true);
  assert.equal(vo.expected, '/c/voiceover/24/1.0/vo.dmg');
  assert.equal(vo.path, null);
});

test('CLI: preflight --json for mock, usage errors exit 3', async () => {
  const ok = await runSr(['preflight', '--reader', 'mock', '--json']);
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).ready, true);
  assert.equal((await runSr(['bogus'])).code, 3);
  assert.equal((await runSr(['preflight', '--reader', 'jaws'])).code, 3);
});
