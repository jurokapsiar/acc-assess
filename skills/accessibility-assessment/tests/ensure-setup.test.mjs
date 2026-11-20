// ensure-setup.mjs: missing-part detection and the setup lock (no network, no npm).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { missingParts, acquireLock, SKILL_DIR } from '../scripts/ensure-setup.mjs';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-setup-'));
}

test('empty skill dir: deps, browser and knowledge are missing', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { playwright: '*' } }));
  assert.deepEqual(missingParts(dir), ['deps', 'browser', 'knowledge']);
});

test('partial knowledge cache (no meta.json) counts as missing', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({}));
  fs.mkdirSync(path.join(dir, 'knowledge', 'wcag'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'knowledge', 'apg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'knowledge', 'wcag', 'criteria.json'), '[]');
  fs.writeFileSync(path.join(dir, 'knowledge', 'apg', 'index.md'), '');
  assert.ok(missingParts(dir).includes('knowledge'));
  fs.writeFileSync(path.join(dir, 'knowledge', 'meta.json'), '{}');
  assert.ok(!missingParts(dir).includes('knowledge'));
});

test('this skill reports ready after `npm run setup`', { skip: !fs.existsSync(path.join(SKILL_DIR, 'node_modules')) }, () => {
  assert.deepEqual(missingParts(), []);
});

test('lock: second acquirer waits until the first releases', async () => {
  const lock = path.join(tmp(), '.setup.lock');
  const release = await acquireLock(lock);
  let second = false;
  const waiting = acquireLock(lock, { pollMs: 20 }).then((r) => { second = true; return r; });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(second, false);
  release();
  (await waiting)();
  assert.equal(second, true);
  assert.equal(fs.existsSync(lock), false);
});

test('lock: a stale lock is taken over, a live one times out', async () => {
  const lock = path.join(tmp(), '.setup.lock');
  fs.mkdirSync(lock);
  await assert.rejects(acquireLock(lock, { waitMs: 50, pollMs: 10 }), /still held/);
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  (await acquireLock(lock, { staleMs: 1000 }))();
});
