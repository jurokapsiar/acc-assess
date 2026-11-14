// Shared test glue: spawns the real assess.mjs CLI against fixture inventories/pages, and
// builds minimal `a11y-verify` fixMeta objects (same shape fixes.mjs's buildVerifyTargets/
// buildNodeJson produce) directly from a baseline results.json, so decision-rule tests can
// call `decide()` against the real engine's own output without going through fixes.mjs's CLI
// or a second verify.mjs subprocess layer.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(TESTS_DIR, '..');
export const FIXTURES_DIR = path.join(TESTS_DIR, 'fixtures');
export const OUT_DIR = path.join(TESTS_DIR, '.out');
const ASSESS_MJS = path.join(SKILL_DIR, 'scripts', 'assess.mjs');
const VERIFY_MJS = path.join(SKILL_DIR, 'scripts', 'verify.mjs');
const FIXES_MJS = path.join(SKILL_DIR, 'scripts', 'fixes.mjs');
const SUMMARY_MJS = path.join(SKILL_DIR, 'scripts', 'summary.mjs');
const REPORT_MJS = path.join(SKILL_DIR, 'scripts', 'report.mjs');

let seq = 0;
/** Fresh, empty directory under tests/.out/ for one scenario/run. */
export function freshDir(name) {
  const dir = path.join(OUT_DIR, `${name}-${process.pid}-${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadTemplateInventory() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'inventory.json'), 'utf8'));
}

/** Clones `inv` with `app.baseUrl` set and/or one screen's `url` overridden (for the ?v= toggle). */
export function withInventory(inv, { baseUrl, screenUrls } = {}) {
  const clone = structuredClone(inv);
  if (baseUrl) clone.app.baseUrl = baseUrl;
  if (screenUrls) {
    for (const f of clone.features ?? []) {
      for (const s of f.screens ?? []) {
        if (screenUrls[s.id] !== undefined) s.url = screenUrls[s.id];
      }
    }
  }
  return clone;
}

export function writeInventory(inv, dir, name = 'inventory.json') {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(inv, null, 2));
  return file;
}

// Runs `node args...` asynchronously (never spawnSync: spawnSync blocks the whole event loop,
// which would starve tests/serve.mjs's in-process static server of any chance to answer the
// CLI subprocess's HTTP requests - the TCP handshake completes but the response callback never
// runs, and the browser launched by the CLI hangs until its own goto timeout).
function spawnAsync(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: SKILL_DIR, encoding: 'utf8', ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Runs the real assess.mjs CLI and returns `{code, stdout, stderr, runDir, results}` (results
 * is null when the run didn't produce a results.json, e.g. a --dry-run or an exit-1 usage error). */
export async function runAssess({ inventory, target, feature, screen, state, viewport, checks, out, extraArgs = [], expectFailure = false }) {
  const cliArgs = [ASSESS_MJS, '--inventory', inventory, '--out', out];
  if (target) cliArgs.push('--target', target);
  if (feature) cliArgs.push('--feature', feature);
  if (screen) cliArgs.push('--screen', screen);
  if (state) cliArgs.push('--state', state);
  if (viewport) cliArgs.push('--viewport', viewport);
  if (checks) cliArgs.push('--checks', checks);
  cliArgs.push(...extraArgs);
  const r = await spawnAsync(cliArgs);
  if (r.code !== 0 && !expectFailure) {
    throw new Error(`assess.mjs failed (exit ${r.code}):\n${r.stdout}\n${r.stderr}`);
  }
  let runDir = null;
  let results = null;
  if (fs.existsSync(out)) {
    const subdirs = fs.readdirSync(out, { withFileTypes: true }).filter((d) => d.isDirectory());
    if (subdirs.length === 1) {
      runDir = path.join(out, subdirs[0].name);
      const resultsPath = path.join(runDir, 'results.json');
      if (fs.existsSync(resultsPath)) results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    }
  }
  return { code: r.code, stdout: r.stdout, stderr: r.stderr, runDir, results };
}

export async function runFixes(runDir, extraArgs = []) {
  const r = await spawnAsync([FIXES_MJS, runDir, ...extraArgs]);
  return r;
}

export function runSummary(runDir, extraArgs = []) {
  return spawnAsync([SUMMARY_MJS, runDir, ...extraArgs]);
}

export function runReport(runDir, extraArgs = []) {
  return spawnAsync([REPORT_MJS, runDir, ...extraArgs]);
}

export async function runVerify(fixFilePaths, extraArgs = []) {
  const r = await spawnAsync([VERIFY_MJS, ...fixFilePaths, ...extraArgs]);
  return r;
}

// Mirrors fixes.mjs's buildVerifyTargets/buildNodeJson exactly (trimmed node shape) so
// decide()/checkConfig() tests exercise the real decision engine against a hand-picked
// subset of a real baseline run's findings, without spawning fixes.mjs itself.
export function fixMetaFromBaseline(baseline, { rule, source, kind = 'failure', issue, config } = {}) {
  const matches = (baseline.findings ?? []).filter((f) => f.rule === rule && f.source === source && f.kind === kind);
  const byTarget = new Map();
  for (const f of matches) {
    const arr = byTarget.get(f.target) ?? byTarget.set(f.target, []).get(f.target);
    if (f.nodes?.length) f.nodes.forEach((n, i) => arr.push(buildNodeJson(f, n, i)));
    else arr.push({ id: `${f.id}#-`, nodeless: true });
  }
  const planHashByKey = new Map((baseline.targets ?? []).map((t) => [t.key, t.planHash]));
  const targets = [...byTarget.keys()]
    .sort()
    .map((key) => ({ key, planHash: planHashByKey.get(key) ?? null, nodes: byTarget.get(key).sort((a, b) => a.id.localeCompare(b.id)) }));
  return {
    version: 1,
    status: 'draft',
    issue: issue ?? `${kind}:${source}:${rule}`,
    source,
    rule,
    kind,
    wcag: matches[0]?.wcag ?? [],
    baseline: '.',
    config: config ?? baseline.config,
    targets,
    informational: { git: null, files: {} },
  };
}

function buildNodeJson(f, n, i) {
  return {
    id: `${f.id}#${i}`,
    context: { phase: f.context?.phase ?? 'main' },
    selector: n.selector ?? null,
    identity: n.identity ? { tag: n.identity.tag, role: n.identity.role, name: n.identity.name, ordinal: n.identity.ordinal, count: n.identity.count } : null,
    source: n.source?.file ? { file: n.source.file, line: n.source.line ?? null } : null,
    box: n.box ?? null,
    before: n.screenshot ?? null,
  };
}

export function okConfigCheck(warnings = []) {
  return { ok: true, reason: null, warnings };
}

// Writes a scope.json + a copy of tests/fixtures/scope/journeys.json into a fresh dir, with
// journeysSha256 computed from the copy (never hand-typed, so it can't drift from the fixture).
export function writeScopeFixture(dir, { id = 'test-scope', targets, inventory = '.a11y/inventory.json' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const journeysSrc = path.join(FIXTURES_DIR, 'scope', 'journeys.json');
  const journeysDest = path.join(dir, 'journeys.json');
  const journeysRaw = fs.readFileSync(journeysSrc, 'utf8');
  fs.writeFileSync(journeysDest, journeysRaw);
  const journeysSha256 = crypto.createHash('sha256').update(journeysRaw).digest('hex');
  const scope = {
    schemaVersion: 1,
    id,
    status: 'verified',
    intent: 'scope.mjs test fixture',
    producers: ['text'],
    inventory,
    inventorySha256: null,
    journeys: 'journeys.json',
    journeysSha256,
    targets,
    selection: { features: null, screens: null, states: null, viewports: null },
    excluded: [],
    unresolved: [],
    storageState: null,
    approval: { by: 'test', at: new Date().toISOString(), proposalSha256: 'test' },
    verification: { at: new Date().toISOString(), results: Object.fromEntries(targets.map((k) => [k, { status: 'verified', planHash: null }])) },
  };
  const scopePath = path.join(dir, 'scope.json');
  fs.writeFileSync(scopePath, JSON.stringify(scope, null, 2));
  return scopePath;
}

// Mirrors scripts/verify.mjs's (module-private) writeProbeFile exactly: a real "after" assess.mjs
// run only populates `target.probes[]` (what decide()'s relocation tiers read) when it's invoked
// with `--probe <file>`; without this, every node in fixMeta would report relocation:'unresolved'
// regardless of whether the real engine could've relocated it.
export function buildProbeFile(fixMeta, baseline, dir) {
  const findingsById = new Map((baseline.findings ?? []).map((f) => [f.id, f]));
  const entries = [];
  for (const t of fixMeta.targets ?? []) {
    for (const n of t.nodes ?? []) {
      if (n.nodeless) {
        entries.push({ id: n.id, target: t.key, phase: 'main', nodeless: true });
        continue;
      }
      const [findingId, idxStr] = n.id.split('#');
      const finding = findingsById.get(findingId);
      const baseNode = finding?.nodes?.[Number(idxStr)];
      entries.push({
        id: n.id,
        target: t.key,
        phase: finding?.context?.phase ?? n.context?.phase ?? 'main',
        selector: baseNode?.selector ?? n.selector ?? null,
        identity: baseNode?.identity ?? n.identity ?? null,
        source: baseNode?.source ?? n.source ?? null,
        box: baseNode?.box ?? n.box ?? null,
      });
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `probe-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(entries));
  return file;
}

// Bundles tests/fixtures/react/entry.jsx -> tests/fixtures/react/bundle.js (gitignored,
// rebuilt on every test run so it never drifts from App.jsx). `jsxDev: true` makes esbuild
// emit `jsxDEV()` calls (react/jsx-dev-runtime) instead of `jsx()`/`jsxs()`, which is what
// populates React's `_debugOwner`/`_debugStack` fiber fields the source resolver reads -
// plain production `jsx()` calls carry no such debug info. Inline sourcemap lets
// lib/source.mjs's `urlToFile` map the bundled position back to the real .jsx line via a
// single `fetch()` of the served bundle (no separate .map request).
export async function buildReactFixture() {
  const esbuild = await import('esbuild');
  const reactDir = path.join(FIXTURES_DIR, 'react');
  const entry = path.join(reactDir, 'entry.jsx');
  const outfile = path.join(reactDir, 'bundle.js');
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    jsxDev: true,
    sourcemap: 'inline',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  return outfile;
}
