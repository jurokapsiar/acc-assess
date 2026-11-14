// Preflight: checks (never changes) everything a screen reader run needs and says exactly what
// the user has to do. It never installs software, downloads assets or edits system settings;
// every fix is an instruction for the user to run themselves.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { SKILL_DIR, SIBLING_SKILL_DIR, requireFromSibling, resolveOwn } from './deps.mjs';

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: String(stdout ?? ''), err: String(stderr ?? '') }));
});

/** Guidepup's screen reader asset cache (mirrors its resolveCachePath()), with the target OS's path rules. */
export function guidepupCachePath(platform = process.platform, env = process.env, home = os.homedir()) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (env.GUIDEPUP_SCREEN_READERS_PATH) return p.resolve(env.GUIDEPUP_SCREEN_READERS_PATH);
  if (platform === 'win32') return p.resolve(env.LOCALAPPDATA ?? p.join(env.USERPROFILE ?? home, 'AppData', 'Local'), 'guidepup');
  if (platform === 'darwin') return p.resolve(env.HOME ?? home, 'Library', 'Caches', 'guidepup');
  return p.resolve(env.HOME ?? home, '.cache', 'guidepup');
}

/** The manifest of the installed @guidepup/guidepup (lists the exact screen reader assets it needs). */
export function guidepupManifest() {
  const main = resolveOwn('@guidepup/guidepup');
  if (!main) return null;
  for (let dir = path.dirname(main); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const m = path.join(dir, 'manifest.json');
    if (fs.existsSync(m) && fs.existsSync(path.join(dir, 'package.json'))) {
      try { return JSON.parse(fs.readFileSync(m, 'utf8')); } catch { return null; }
    }
  }
  return null;
}

const assetsOf = (manifest, id) => manifest?.screenReaders?.find((s) => s.id === id)?.assets ?? [];

/** Installed @guidepup/guidepup version, or null (recorded in results.env). */
export function guidepupVersion() {
  const main = resolveOwn('@guidepup/guidepup');
  if (!main) return null;
  for (let dir = path.dirname(main); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const p = path.join(dir, 'package.json');
    if (!fs.existsSync(p)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (pkg.name === '@guidepup/guidepup') return pkg.version ?? null;
    } catch { return null; }
  }
  return null;
}

/** Guidepup's portable NVDA executable as its manifest requires it: `{ path|null, expected, version }`. */
export function findNvdaAsset(cache = guidepupCachePath('win32'), manifest = guidepupManifest()) {
  const p = path.win32;
  const version = assetsOf(manifest, 'nvda')[0]?.version ?? null;
  const exe = p.join(cache, 'nvda', 'all', version ?? '<version>', 'extracted', 'nvda.exe');
  return { path: version && fs.existsSync(exe) ? exe : null, expected: exe, version };
}

/**
 * The VoiceOver preferences DMG this Guidepup version mounts (mirrors its resolveDmgPath()):
 * `<cache>/voiceover/<darwin major>/<version>/<asset>`. `supported` is false when the manifest
 * has no asset for this macOS (Darwin) version.
 */
export function findVoiceOverAsset(cache = guidepupCachePath('darwin'), manifest = guidepupManifest(), release = os.release()) {
  const platformVersion = String(release).split('.')[0];
  const asset = assetsOf(manifest, 'voiceover').find((a) => a.platformVersion === platformVersion);
  if (!asset) return { supported: false, platformVersion, path: null, expected: null };
  const dmg = path.posix.join(cache, 'voiceover', platformVersion, asset.version, asset.asset);
  return { supported: true, platformVersion, version: asset.version, path: fs.existsSync(dmg) ? dmg : null, expected: dmg };
}
const ok = (id, message) => ({ id, status: 'ok', message });
const info = (id, message, fix) => ({ id, status: 'info', message, ...(fix ? { fix } : {}) });
const warn = (id, message, fix) => ({ id, status: 'warn', message, ...(fix ? { fix } : {}) });
const fail = (id, message, fix) => ({ id, status: 'fail', message, ...(fix ? { fix } : {}) });

/**
 * Returns `{ reader, platform, ready, checks: [{ id, status: ok|info|warn|fail, message, fix? }] }`.
 * `ready` is false when any check failed.
 */
export async function preflight({ reader, channel, platform = process.platform } = {}) {
  const checks = [];
  const real = reader === 'nvda' || reader === 'voiceover';
  const npmInstall = `cd "${SKILL_DIR}" && npm install`;

  checks.push(ok('os', `${platform} ${os.release()} (${os.arch()})`));
  const major = Number(process.versions.node.split('.')[0]);
  checks.push(major >= 20 ? ok('node', `Node.js ${process.versions.node}`) : fail('node', `Node.js ${process.versions.node} is too old`, 'Install Node.js 20 or newer.'));

  // Browser: the sibling skill's Playwright (shared node_modules).
  try {
    const pw = requireFromSibling('playwright');
    if (channel) checks.push(info('browser', `Using the installed "${channel}" browser channel (not checked here).`));
    else {
      const exe = pw.chromium.executablePath();
      checks.push(fs.existsSync(exe) ? ok('browser', `Playwright Chromium: ${exe}`) : fail('browser', 'Playwright Chromium is not installed.', `cd "${SIBLING_SKILL_DIR}" && npx playwright install chromium`));
    }
  } catch {
    checks.push(fail('browser', 'Playwright is not installed in the accessibility-assessment skill.', `cd "${SIBLING_SKILL_DIR}" && npm install && npx playwright install chromium`));
  }

  if (!real) {
    checks.push(info('reader', reader === 'mock' || reader === 'dry-run'
      ? 'Mock driver: narration is simulated from DOM events (pipeline testing only, not screen reader evidence).'
      : `No screen reader is supported on ${platform}; only --reader mock can run here.`));
    return finish(reader, platform, checks);
  }

  if (reader === 'nvda' && platform !== 'win32') checks.push(fail('reader', 'NVDA runs on Windows only.', 'Run on Windows, or use --reader voiceover on macOS.'));
  if (reader === 'voiceover' && platform !== 'darwin') checks.push(fail('reader', 'VoiceOver runs on macOS only.', 'Run on macOS, or use --reader nvda on Windows.'));

  const gp = resolveOwn('@guidepup/guidepup');
  checks.push(gp ? ok('guidepup', `@guidepup/guidepup ${pkgVersion(gp) ?? ''}`.trim()) : fail('guidepup', '@guidepup/guidepup is not installed (optional dependency of this skill).', npmInstall));

  if (reader === 'nvda' && platform === 'win32') await windowsChecks(checks);
  if (reader === 'voiceover' && platform === 'darwin') await macChecks(checks);
  return finish(reader, platform, checks);
}

function finish(reader, platform, checks) {
  return { reader, platform, ready: !checks.some((c) => c.status === 'fail'), checks };
}

function pkgVersion(resolved) {
  for (let dir = path.dirname(resolved); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p)) {
      try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (j.name === '@guidepup/guidepup') return j.version; } catch { /* keep looking */ }
    }
  }
  return null;
}

async function windowsChecks(checks) {
  const cache = guidepupCachePath('win32');
  const manifest = guidepupManifest();
  const asset = findNvdaAsset(cache, manifest);
  if (!manifest) checks.push(fail('nvda', 'Cannot tell which NVDA build is required: the installed @guidepup/guidepup manifest was not found.', `cd "${SKILL_DIR}" && npm install   (then re-run preflight)`));
  else checks.push(asset.path
    ? ok('nvda', `Guidepup NVDA ${asset.version}: ${asset.path}`)
    : fail('nvda', `Guidepup's portable NVDA ${asset.version} is not installed (expected ${asset.expected}). Guidepup does not use a system-wide NVDA installation.`,
      `cd "${SKILL_DIR}" && npx @guidepup/setup install nvda   (run it from this skill folder: it installs the build matching this skill's Guidepup version into ${cache}; set GUIDEPUP_SCREEN_READERS_PATH to use another folder, HTTPS_PROXY behind a proxy)`));

  const reg = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\nvda.exe', '/ve']);
  checks.push(info('nvda-system', reg.code === 0 ? 'A system NVDA is installed; Guidepup quits it during a run and restarts it afterwards.' : 'No system NVDA installation found (not required).'));

  const tl = await run('tasklist', ['/FI', 'IMAGENAME eq nvda.exe', '/NH']);
  if (/nvda\.exe/i.test(tl.out)) checks.push(warn('nvda-running', 'NVDA is running now. Guidepup will quit it when the run starts.', 'Save your work and expect speech to stop/restart; or quit NVDA (NVDA+Q) before the run.'));

  const admin = await run('net', ['session']);
  checks.push(info('admin', admin.code === 0 ? 'Running elevated (not required).' : 'Not running elevated - fine, administrator rights are not required.'));

  const session = process.env.SESSIONNAME;
  checks.push(session
    ? info('desktop', `Interactive session "${session}" detected; whether the desktop is unlocked and stays in the foreground cannot be verified here. Keep it unlocked and do not use mouse/keyboard during the run (NVDA and the browser window need the foreground).`)
    : warn('desktop', 'No interactive desktop session detected (service, CI agent or SSH?). NVDA needs an unlocked, interactive desktop with the headed browser in the foreground.', 'Run from a terminal on an unlocked interactive desktop (local or RDP console), not from a service or SSH session.'));
  checks.push(info('headed', 'The browser always runs headed for real screen readers.'));
  checks.push(info('side-effects', 'During the run Guidepup quits any running NVDA, starts its portable NVDA with a temporary session configuration and restores the previous state on stop (best effort; an interrupted run may leave NVDA stopped - restart it yourself). Nothing is installed and no permanent settings are changed.'));
}

async function macChecks(checks) {
  const sw = await run('sw_vers', ['-productVersion']);
  const ver = sw.out.trim();
  const major = Number(ver.split('.')[0]);
  checks.push(major >= 12 ? ok('macos', `macOS ${ver}`) : fail('macos', `macOS ${ver || '(unknown)'} - VoiceOver automation needs macOS 12 or newer.`, 'Use a macOS 12+ machine.'));

  const flagFile = '/private/var/db/Accessibility/.VoiceOverAppleScriptEnabled';
  let enabled = false;
  try { enabled = fs.readFileSync(flagFile, 'utf8').trim().startsWith('a'); } catch { /* not readable/missing */ }
  if (!enabled) {
    const d = await run('defaults', ['read', 'com.apple.VoiceOver4/default', 'SCREnableAppleScript']);
    enabled = d.out.trim() === '1';
  }
  checks.push(enabled ? ok('voiceover-applescript', 'VoiceOver can be controlled with AppleScript.')
    : fail('voiceover-applescript', 'VoiceOver AppleScript control is not enabled.',
      'Open VoiceOver Utility > General and tick "Allow VoiceOver to be controlled with AppleScript" (follow https://www.guidepup.dev/docs/guides/manual-voiceover-setup). Alternatively run the one-time machine configuration "npx @guidepup/setup setup" yourself - it changes system settings, so read its docs first. Never disable SIP for this.'));

  const cache = guidepupCachePath('darwin');
  const manifest = guidepupManifest();
  const dmg = findVoiceOverAsset(cache, manifest);
  const installCmd = `cd "${SKILL_DIR}" && npx @guidepup/setup install voiceover   (run it from this skill folder: it installs the assets matching this skill's Guidepup version into ${cache})`;
  if (!manifest) checks.push(fail('voiceover-assets', 'Cannot tell which VoiceOver assets are required: the installed @guidepup/guidepup manifest was not found.', `cd "${SKILL_DIR}" && npm install   (then re-run preflight)`));
  else if (!dmg.supported) checks.push(fail('voiceover-assets', `This Guidepup version has no VoiceOver assets for this macOS (Darwin ${dmg.platformVersion}); VoiceOver can't be started.`, 'Use a macOS version supported by the installed Guidepup, or update @guidepup/guidepup in this skill.'));
  else checks.push(dmg.path ? ok('voiceover-assets', `Guidepup VoiceOver preferences ${dmg.version}: ${dmg.path}`)
    : fail('voiceover-assets', `Guidepup's VoiceOver preferences image is missing (expected ${dmg.expected}).`, installCmd));
  checks.push(info('permissions', 'Not verifiable here: the terminal app running this command needs System Settings > Privacy & Security > Accessibility AND Automation (allow it to control "VoiceOver" and "System Events"). macOS asks on first use; approve the prompts or add the terminal manually.'));
  checks.push(info('desktop', 'Not verifiable here: keep the Mac unlocked and the browser window in the foreground; do not use mouse/keyboard during the run. VoiceOver must be stopped (Cmd+F5) before the run - Guidepup starts it.'));
  checks.push(info('headed', 'The browser always runs headed for real screen readers.'));
  checks.push(info('side-effects', 'During the run Guidepup mounts its VoiceOver preferences image and links them in place of your VoiceOver preferences, then restores them on stop (best effort; if a run is interrupted, run it once more to completion or restart VoiceOver). Nothing is installed and no permanent settings are changed.'));
}

export function formatPreflight(r) {
  const mark = { ok: 'OK  ', info: 'INFO', warn: 'WARN', fail: 'FAIL' };
  const lines = [`Preflight for --reader ${r.reader} on ${r.platform}:`];
  for (const c of r.checks) {
    lines.push(`  [${mark[c.status]}] ${c.id}: ${c.message}`);
    if (c.fix && c.status !== 'ok') lines.push(`         -> ${c.fix}`);
  }
  lines.push(r.ready ? 'Ready.' : 'Not ready: fix the FAIL items above (this tool never installs software or changes system settings for you).');
  return lines.join('\n');
}
