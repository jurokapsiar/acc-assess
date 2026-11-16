// Shared test glue for scope-definition's own tests. Reuses the sibling accessibility-assessment
// skill's fixture server and inventory helpers (same repo, same fixtures/conventions) rather than
// duplicating them - this skill has no fixtures or app code of its own to test against.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(TESTS_DIR, '..');
export const SIBLING_DIR = path.resolve(SKILL_DIR, '..', 'accessibility-assessment');
export const SIBLING_FIXTURES_DIR = path.join(SIBLING_DIR, 'tests', 'fixtures');
export const SCOPE_MJS = path.join(SKILL_DIR, 'scripts', 'scope.mjs');
export const OUT_DIR = path.join(TESTS_DIR, '.out');

export { serveDir } from '../../accessibility-assessment/tests/serve.mjs';

let seq = 0;
/** Fresh, empty directory under tests/.out/ for one scenario/run (an "app root" stand-in). */
export function freshDir(name) {
  const dir = path.join(OUT_DIR, `${name}-${process.pid}-${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadTemplateInventory() {
  return JSON.parse(fs.readFileSync(path.join(SIBLING_FIXTURES_DIR, 'inventory.json'), 'utf8'));
}

/** Clones `inv` with `app.baseUrl` set (for the fixture server's ephemeral port). */
export function withInventory(inv, { baseUrl } = {}) {
  const clone = structuredClone(inv);
  if (baseUrl) clone.app.baseUrl = baseUrl;
  return clone;
}

export function writeInventory(inv, dir, name = 'inventory.json') {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(inv, null, 2));
  return file;
}

// Never spawnSync: it would block the event loop that tests/serve.mjs's in-process HTTP
// server needs to answer the CLI subprocess's requests (same reasoning as the sibling's
// tests/helpers.mjs).
function spawnAsync(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { encoding: 'utf8', ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Runs the real scope.mjs CLI against `appRoot`. */
export async function runScope(command, flags = [], { appRoot }) {
  const r = await spawnAsync([SCOPE_MJS, command, ...flags, '--app-root', appRoot], { cwd: appRoot });
  return r;
}

/** Writes an agent-authored intent.json for `prompt` and runs `scope.mjs intent --from` on it. */
export async function runIntent(appRoot, sessionId, prompt, overrides = {}) {
  const file = path.join(appRoot, `intent-${sessionId}.json`);
  const doc = {
    prompt,
    include: [{ phrase: prompt, kind: 'any', quoted: false, evidence: prompt }],
    exclude: [],
    states: [],
    viewports: [],
    modalities: [],
    ...overrides,
  };
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return runScope('intent', ['--session', sessionId, '--from', file], { appRoot });
}

export function sessionJsonPath(appRoot, id) {
  return path.join(appRoot, '.a11y', 'scopes', id, 'work', 'session.json');
}
export function scopeJsonPath(appRoot, id) {
  return path.join(appRoot, '.a11y', 'scopes', id, 'scope.json');
}
export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
