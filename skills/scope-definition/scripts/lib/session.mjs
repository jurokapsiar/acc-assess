// Session state machine (`work/session.json`): the one mutable record a scope's commands read
// and write as they move through §6's phases. Atomic writes (temp file + rename), path
// containment (writes confined to `<app>/.a11y/scopes/**`, hard rule §3.1), and an O_EXCL
// counter so parallel subagents can claim distinct snapshot numbers (§11) without a second
// writer of session.json itself.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PHASES = ['init', 'preflighted', 'intent', 'grounded', 'explored', 'proposed', 'confirmed', 'verified', 'merged'];

export function phaseIndex(p) {
  const i = PHASES.indexOf(p);
  if (i < 0) throw new Error(`Unknown session phase "${p}"`);
  return i;
}

export function scopeDir(appRoot, id) {
  return path.join(appRoot, '.a11y', 'scopes', id);
}
export function workDir(appRoot, id) {
  return path.join(scopeDir(appRoot, id), 'work');
}
export function sessionFile(appRoot, id) {
  return path.join(workDir(appRoot, id), 'session.json');
}

/** Resolves `rel` against `appRoot` and rejects it if it escapes `<appRoot>/.a11y`
 * (§3.1: "Writes are confined to <app>/.a11y/scopes/** and ... inventory.json. Paths are
 * resolved and rejected if they escape .a11y/"). `allowOutsideA11y` is for read-only inputs
 * that are explicitly allowed elsewhere (e.g. `--storage-state`, §12). */
export function resolveContained(appRoot, rel, { allowOutsideA11y = false } = {}) {
  const abs = path.resolve(appRoot, rel);
  if (allowOutsideA11y) return abs;
  const a11yRoot = path.resolve(appRoot, '.a11y') + path.sep;
  if (!(abs + path.sep).startsWith(a11yRoot) && abs !== a11yRoot.slice(0, -1)) {
    const err = new Error(`Path escapes .a11y/: ${rel}`);
    err.code = 'PATH_ESCAPE';
    throw err;
  }
  return abs;
}

export function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function slugify(text) {
  return (
    String(text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'scope'
  );
}

export function defaultId(prompt) {
  const hash = crypto.createHash('sha256').update(String(prompt ?? '')).digest('hex').slice(0, 6);
  return `${slugify(prompt)}-${hash}`;
}

export function initSession(appRoot, opts) {
  const id = opts.id || defaultId(opts.prompt);
  const file = sessionFile(appRoot, id);
  if (fs.existsSync(file)) {
    const err = new Error(`A session for scope id "${id}" already exists (${path.dirname(file)}). Pick a different --id, or continue with the existing session.`);
    err.code = 'SESSION_EXISTS';
    throw err;
  }
  const session = {
    schemaVersion: 1,
    id,
    phase: 'init',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    prompt: opts.prompt,
    inventory: opts.inventory ?? '.a11y/inventory.json',
    baseUrl: opts.baseUrl ?? null,
    sourceRoot: opts.sourceRoot ?? null,
    viewport: opts.viewport ?? null,
    storageState: opts.storageState ?? null,
    diffSpec: { base: opts.base ?? null, changed: opts.changed ?? null, diff: opts.diff ?? null },
    insecure: !!opts.insecure,
    channel: opts.channel ?? null,
    invalidated: [],
    explorations: [],
    draft: { journeys: [] },
    runs: [],
  };
  writeJsonAtomic(file, session);
  return session;
}

export function loadSession(appRoot, id) {
  const file = sessionFile(appRoot, id);
  if (!fs.existsSync(file)) {
    const err = new Error(`No session for scope id "${id}" (expected ${file}). Run "scope.mjs init" first.`);
    err.code = 'NO_SESSION';
    throw err;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveSession(appRoot, session) {
  session.updatedAt = new Date().toISOString();
  writeJsonAtomic(sessionFile(appRoot, session.id), session);
}

/** Moving to `phase`: refuses to skip ahead of the required minimum unless `force`; moving
 * BACKWARDS (re-running an earlier phase) records every later phase it passed through in
 * `session.invalidated` (§6: "re-running an earlier phase invalidates later ones"). */
export function transitionPhase(session, phase, { force = false, minPhase } = {}) {
  if (minPhase && !force && phaseIndex(session.phase) < phaseIndex(minPhase)) {
    const err = new Error(`Session "${session.id}" is at phase "${session.phase}"; this command needs at least "${minPhase}" (run the earlier commands first, or pass --force).`);
    err.code = 'PHASE_ORDER';
    throw err;
  }
  const curIdx = phaseIndex(session.phase);
  const newIdx = phaseIndex(phase);
  if (newIdx <= curIdx && phase !== session.phase) {
    const invalidated = PHASES.slice(newIdx + 1, curIdx + 1);
    session.invalidated = [...new Set([...(session.invalidated ?? []), ...invalidated])];
  }
  session.phase = phase;
}

/** Atomically claims the next integer in a monotonic sequence under `dir` by creating
 * `.{prefix}-<n>.lock` with O_EXCL; used for `explore`'s snapshot numbering so parallel
 * subagents never collide on the same file name (§11). Does not touch session.json. */
export function claimSeq(dir, prefix = 'n') {
  fs.mkdirSync(dir, { recursive: true });
  for (let n = 1; n < 100000; n++) {
    try {
      fs.writeFileSync(path.join(dir, `.${prefix}-${n}.lock`), '', { flag: 'wx' });
      return n;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`Could not claim a sequence number under ${dir}`);
}
