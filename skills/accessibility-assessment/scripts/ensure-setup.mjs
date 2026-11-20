// Idempotent one-time setup for the accessibility-assessment skill (and the sibling skills that
// reuse its node_modules): npm dependencies, Playwright Chromium, and the WCAG/APG knowledge cache.
// Installs only what is missing, so it is cheap to run before every session. A lock directory
// serialises concurrent runs (plugin SessionStart hook vs the agent's own step 0): a second run
// waits for the first and then re-checks instead of installing in parallel.
//
//   node scripts/ensure-setup.mjs            install what is missing (same as `npm run setup`)
//   node scripts/ensure-setup.mjs --check    report what is missing, exit 1 if anything is
//   node scripts/ensure-setup.mjs --hook     quiet mode for hooks: child output to .cache/setup.log
//
// Uses only Node built-ins: it must run before `npm install`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_STALE_MS = 30 * 60 * 1000;
const LOCK_WAIT_MS = 20 * 60 * 1000;

/** Which setup parts are missing in `skillDir`: subset of ['deps', 'browser', 'knowledge']. */
export function missingParts(skillDir = SKILL_DIR) {
  const missing = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(skillDir, 'package.json'), 'utf8'));
  // shortcut: presence only, not installed versions; delete node_modules to force a reinstall.
  const deps = Object.keys(pkg.dependencies ?? {});
  if (!deps.every((d) => fs.existsSync(path.join(skillDir, 'node_modules', d, 'package.json')))) missing.push('deps');
  if (missing.includes('deps') || !chromiumInstalled(skillDir)) missing.push('browser');
  const k = path.join(skillDir, 'knowledge');
  // meta.json is written last by fetch-knowledge.mjs, so it marks a completed fetch.
  if (!['meta.json', 'wcag/criteria.json', 'apg/index.md'].every((f) => fs.existsSync(path.join(k, f)))) missing.push('knowledge');
  return missing;
}

function chromiumInstalled(skillDir) {
  try {
    const exe = createRequire(path.join(skillDir, 'package.json'))('playwright').chromium.executablePath();
    return Boolean(exe) && fs.existsSync(exe);
  } catch {
    return false;
  }
}

/** Takes the lock (mkdir is atomic), waiting while another live run holds it. Returns a release fn. */
export async function acquireLock(lockDir, { staleMs = LOCK_STALE_MS, waitMs = LOCK_WAIT_MS, pollMs = 2000, log = () => {} } = {}) {
  const start = Date.now();
  let announced = false;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(path.join(lockDir, 'pid'), String(process.pid));
      return () => fs.rmSync(lockDir, { recursive: true, force: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let age = 0;
    try { age = Date.now() - fs.statSync(lockDir).mtimeMs; } catch { continue; }
    if (age > staleMs) {
      fs.rmSync(lockDir, { recursive: true, force: true });
      continue;
    }
    if (Date.now() - start > waitMs) throw new Error(`Setup lock still held after ${Math.round(waitMs / 60000)} min: ${lockDir} (delete it if no setup is running)`);
    if (!announced) log(`Another setup run is in progress (${lockDir}); waiting for it...`);
    announced = true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

function run(cmd, args, { cwd, logFd }) {
  const stdio = logFd === undefined ? 'inherit' : ['ignore', logFd, logFd];
  // npm is npm.cmd on Windows, which spawn only finds through a shell.
  const res = spawnSync(cmd, args, { cwd, stdio, shell: process.platform === 'win32' && cmd === 'npm' });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`\`${cmd} ${args.join(' ')}\` exited with ${res.status}`);
}

async function main(argv) {
  const hook = argv.includes('--hook');
  const log = (m) => console.log(`[acc-assess setup] ${m}`);
  const before = missingParts();
  if (argv.includes('--check')) {
    log(before.length ? `missing: ${before.join(', ')} (run \`npm run setup\` in ${SKILL_DIR})` : 'ready');
    return before.length ? 1 : 0;
  }
  if (!before.length) {
    if (!hook) log('ready');
    return 0;
  }
  const release = await acquireLock(path.join(SKILL_DIR, '.setup.lock'), { log });
  let logFd;
  try {
    const missing = missingParts(); // re-check: a concurrent run may have finished it
    if (!missing.length) { log('ready'); return 0; }
    if (hook) {
      fs.mkdirSync(path.join(SKILL_DIR, '.cache'), { recursive: true });
      logFd = fs.openSync(path.join(SKILL_DIR, '.cache', 'setup.log'), 'a');
    }
    log(`installing: ${missing.join(', ')} (can take several minutes)`);
    const opts = { cwd: SKILL_DIR, logFd };
    if (missing.includes('deps')) run('npm', ['install', '--no-audit', '--no-fund'], opts);
    if (missing.includes('browser')) {
      try {
        run(process.execPath, [path.join(SKILL_DIR, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium'], opts);
      } catch (err) {
        log(`Chromium install failed (${err.message}). Assess with --channel msedge or --channel chrome instead.`);
      }
    }
    if (missing.includes('knowledge')) run(process.execPath, [path.join(SKILL_DIR, 'scripts', 'fetch-knowledge.mjs')], opts);
    const left = missingParts();
    log(left.length ? `done, still missing: ${left.join(', ')}` : 'ready');
    return left.filter((p) => p !== 'browser').length ? 1 : 0;
  } catch (err) {
    log(`failed: ${err.message}${hook ? ` (details: ${path.join(SKILL_DIR, '.cache', 'setup.log')})` : ''}`);
    return 1;
  } finally {
    if (logFd !== undefined) fs.closeSync(logFd);
    release();
  }
}

if (import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
