// Shared test glue: the sibling's in-process fixture server, fresh app roots under tests/.out,
// and an async CLI runner (never spawnSync - it would block the in-process HTTP server).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(TESTS_DIR, '..');
export const FIXTURES_DIR = path.join(TESTS_DIR, 'fixtures');
export const SR_MJS = path.join(SKILL_DIR, 'scripts', 'sr.mjs');
export const OUT_DIR = path.join(TESTS_DIR, '.out');

export { serveDir } from '../../accessibility-assessment/tests/serve.mjs';

let seq = 0;
export function freshDir(name) {
  const dir = path.join(OUT_DIR, `${name}-${process.pid}-${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** An app root with the fixture inventory (baseUrl = the fixture server) and scope copied in. */
export function setupApp(name, baseUrl) {
  const appRoot = freshDir(name);
  const a11y = path.join(appRoot, '.a11y');
  const inv = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'inventory.json'), 'utf8'));
  inv.app.baseUrl = baseUrl;
  fs.mkdirSync(path.join(a11y, 'scopes', 'sr-fixture'), { recursive: true });
  fs.writeFileSync(path.join(a11y, 'inventory.json'), JSON.stringify(inv, null, 2));
  for (const f of ['scope.json', 'journeys.json']) fs.copyFileSync(path.join(FIXTURES_DIR, 'scope', f), path.join(a11y, 'scopes', 'sr-fixture', f));
  return { appRoot, scopeFile: path.join(a11y, 'scopes', 'sr-fixture', 'scope.json') };
}

export function runSr(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SR_MJS, ...args], { cwd: cwd ?? SKILL_DIR });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
