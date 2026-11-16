#!/usr/bin/env node
// Re-verifies one or more fix-*.md files (T6): parses each file's trailing `a11y-verify`
// block, checks it's still compatible with the current inventory/engines, re-runs
// assess.mjs as a subprocess against just the affected targets with a --probe file so the
// baseline's flagged elements get relocated in the live page, decides fixed/not
// fixed/regressed/unverified/needs review, and appends one "attempt" per issue to
// `<baselineDir>/fix-report.json`. If the baseline was a scoped run (scope-definition skill),
// the same scope file is forwarded to the subprocess and applied to the live target hashes;
// a missing scope file is `unverified` (never a silent fallback to the bare inventory).
//
//   node scripts/verify.mjs <fix.md...> [--quick] [--accept-plan-change] [--channel c]
//        [--headed] [--workers n]
//   node scripts/verify.mjs --render-only <run>
//
// Run from the app root (cwd), same convention as assess.mjs/fixes.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadInventory, resolveTargets, planHash, policyHash } from './lib/inventory.mjs';
import { loadScope, applyScope } from './lib/scope.mjs';
import { resolveSourceRoot } from './lib/source.mjs';
import { abledomVersion } from './lib/abledom.mjs';
import { parseFixFile, checkConfig, checksFor, decide, exitCodeFor, policyChanged } from './lib/verify.mjs';
import { loadCriteria, scInfo } from './lib/wcag.mjs';
import { validateResults } from './lib/results.mjs';
import { groupFindings } from './lib/findings.mjs';
import { fixReportHtml, scLink as scLinkImpl } from './lib/render.mjs';

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ASSESS_MJS = path.join(SCRIPT_DIR, 'assess.mjs');

const args = parseArgs(process.argv.slice(2));

if (args['render-only']) {
  renderFixReport(path.resolve(args['render-only']));
  console.log(path.join(path.resolve(args['render-only']), 'fix-report.html'));
  process.exit(0);
}

if (!args._.length) {
  console.error('Usage: node scripts/verify.mjs <fix.md...> [--quick] [--accept-plan-change] [--channel c] [--headed] [--workers n]\n       node scripts/verify.mjs --render-only <run>');
  process.exit(3);
}

// Parse every fix file up front; a bad path/malformed block is a usage error (exit 3) and
// aborts before any real work (subprocess spawns, fix-report.json writes) happens.
let parsed;
try {
  parsed = args._.map((p) => parseFixFile(p));
} catch (err) {
  console.error(err.message);
  process.exit(3);
}

const statuses = parsed.map((entry) => verifyOne(entry));
process.exit(exitCodeFor(statuses));

// ------------------------------------------------------------------ one fix file

function verifyOne({ meta, fixFilePath, fixFileDir, baselineDir }) {
  const baselineResultsPath = path.join(baselineDir, 'results.json');
  if (!fs.existsSync(baselineResultsPath)) {
    console.error(`${meta.issue ?? path.basename(fixFilePath)}: baseline results.json not found at ${baselineResultsPath} (baseline: "${meta.baseline}")`);
    return 'unverified';
  }
  const baseline = JSON.parse(fs.readFileSync(baselineResultsPath, 'utf8'));
  const baselineErrors = validateResults(baseline, { runDir: baselineDir }).errors;
  if (baselineErrors.length) {
    console.error(`${meta.issue ?? path.basename(fixFilePath)}: baseline results.json is invalid:\n- ${baselineErrors.slice(0, 20).join('\n- ')}`);
    process.exit(1);
  }
  const affectedKeys = (meta.targets ?? []).map((t) => t.key);
  // Scope pass-through (scope-definition skill, §10 of its spec): a scoped baseline is
  // re-verified with the SAME scope file, never a silent fallback to the bare inventory.
  // Missing scope file -> unverified (not "configCheck not ok", which would mix it up with
  // engine/inventory/plan-hash reasons); a journeysSha256 mismatch is a warning only, like
  // the inventory checksum today.
  let scopeFileAbs = null;
  if (baseline.scope?.file) {
    scopeFileAbs = path.resolve(baselineDir, baseline.scope.file);
    if (!fs.existsSync(scopeFileAbs)) {
      return finish(meta, fixFilePath, baselineDir, {
        status: 'unverified', reason: 'scope file not found', warnings: [], nodes: [], regressions: [], counts: { before: 0, after: 0 }, agentVerdict: null,
      }, { run: null, checksScope: null, regressionScope: { targets: affectedKeys, checks: [] }, sourceRootAbs: resolveSourceRoot({ cliRoot: null, invRoot: baseline.config?.sourceRoot ?? null, appRoot: process.cwd() }) });
    }
  }
  const scopeWarnings = [];
  if (scopeFileAbs && baseline.scope?.journeysSha256) {
    const liveScope = JSON.parse(fs.readFileSync(scopeFileAbs, 'utf8'));
    const liveJourneysPath = liveScope.journeys ? path.resolve(path.dirname(scopeFileAbs), liveScope.journeys) : null;
    const liveJourneysSha = liveJourneysPath && fs.existsSync(liveJourneysPath) ? crypto.createHash('sha256').update(fs.readFileSync(liveJourneysPath)).digest('hex') : null;
    if (liveJourneysSha && liveJourneysSha !== baseline.scope.journeysSha256) scopeWarnings.push('scope journeys changed since the baseline run (journeysSha256 mismatch)');
  }

  // Version policy ground truth: level/checks/viewports/maxTabs/sourceRoot come from the
  // baseline run's OWN recorded config (untouched by hand-editing the fix file); engine
  // versions and the inventory file's sha256 are read live, so an engine upgrade or an
  // inventory edit since the baseline ran is still caught.
  const invPath = baseline.config?.inventory?.file ? path.resolve(baselineDir, baseline.config.inventory.file) : null;
  const liveInvSha = invPath && fs.existsSync(invPath) ? crypto.createHash('sha256').update(fs.readFileSync(invPath)).digest('hex') : null;
  const currentConfig = { ...baseline.config, engines: liveEngineVersions(), inventory: { ...baseline.config?.inventory, sha256: liveInvSha } };
  const currentTargets = invPath && fs.existsSync(invPath) ? liveTargetHashes(invPath, scopeFileAbs) : new Map();
  const configCheck = checkConfig(meta, currentConfig, currentTargets, { acceptPlanChange: !!args['accept-plan-change'] });
  if (configCheck.ok && !args['accept-plan-change']) {
    const livePolicy = invPath && fs.existsSync(invPath) ? liveTargetHashes(invPath, scopeFileAbs, policyHash) : new Map();
    const changed = policyChanged(meta, livePolicy);
    if (changed) { configCheck.ok = false; configCheck.reason = `incompatible: policy:${changed}`; }
  }
  if (scopeWarnings.length) configCheck.warnings = [...(configCheck.warnings ?? []), ...scopeWarnings];

  const sourceRootAbs = resolveSourceRoot({ cliRoot: null, invRoot: baseline.config?.sourceRoot ?? null, appRoot: process.cwd() });

  if (!configCheck.ok) {
    return finish(meta, fixFilePath, baselineDir, decide({ fixMeta: meta, configCheck, baseline, after: { targets: [], findings: [] } }), {
      run: null,
      checksScope: null,
      regressionScope: { targets: affectedKeys, checks: [] },
      sourceRootAbs,
    });
  }

  const { checks: checksList, scope } = checksFor(meta, { quick: !!args.quick });
  let probeFile;
  let verifyRunDir;
  try {
    probeFile = writeProbeFile(baselineDir, meta, baseline);
    verifyRunDir = runAssessSubprocess({ invPath, affectedKeys, meta, checksList, baselineDir, probeFile, scopeFileAbs });
  } catch (err) {
    console.error(`${meta.issue}: ${err.message}`);
    const decision = { status: 'unverified', reason: err.message, warnings: configCheck.warnings, nodes: [], regressions: [], counts: { before: 0, after: 0 }, agentVerdict: null };
    return finish(meta, fixFilePath, baselineDir, decision, { run: null, checksScope: scope, regressionScope: { targets: affectedKeys, checks: checksList }, sourceRootAbs });
  } finally {
    if (probeFile) fs.rmSync(probeFile, { force: true });
  }

  const afterResultsPath = path.join(verifyRunDir, 'results.json');
  const after = JSON.parse(fs.readFileSync(afterResultsPath, 'utf8'));
  const afterErrors = validateResults(after, { runDir: verifyRunDir }).errors;
  if (afterErrors.length) {
    console.error(`${meta.issue}: the verify run's results.json is invalid:\n- ${afterErrors.slice(0, 20).join('\n- ')}`);
    process.exit(1);
  }
  const afterRunRelPath = normalizeSlashes(path.relative(baselineDir, afterResultsPath));
  const agentVerdictsPath = path.join(verifyRunDir, 'agent-verdicts.json');
  const agentVerdict = fs.existsSync(agentVerdictsPath) ? JSON.parse(fs.readFileSync(agentVerdictsPath, 'utf8')) : null;

  const decision = decide({ fixMeta: meta, configCheck, baseline, after, afterRunRelPath, agentVerdict, checks: checksList });
  return finish(meta, fixFilePath, baselineDir, decision, {
    run: normalizeSlashes(path.relative(baselineDir, afterResultsPath)),
    checksScope: scope,
    regressionScope: { targets: affectedKeys, checks: checksList },
    sourceRootAbs,
  });
}

function finish(meta, fixFilePath, baselineDir, decision, { run, checksScope, regressionScope, sourceRootAbs }) {
  const attempt = {
    attempt: stamp(),
    fixFile: path.basename(fixFilePath),
    issue: meta.issue,
    status: decision.status,
    reason: decision.reason,
    warnings: decision.warnings ?? [],
    run,
    checks: checksScope,
    regressionScope,
    nodes: decision.nodes ?? [],
    counts: decision.counts ?? { before: 0, after: 0 },
    regressions: decision.regressions ?? [],
    agentVerdict: decision.agentVerdict ?? null,
    informational: { filesChanged: filesChanged(meta, sourceRootAbs) },
  };
  appendAttempt(baselineDir, attempt);
  console.log(`${decision.status}  ${attempt.fixFile}${decision.reason ? `  (${decision.reason})` : ''}`);
  return decision.status;
}

// ------------------------------------------------------------------ probe file + subprocess

// Recovers full identity/source/box/selector for each listed node from the baseline run's own
// results.json (the fix file's trimmed a11y-verify JSON omits `identity.text` and
// `source.component`/chain, which relocation tiers 3/4 and reporting can still use).
function writeProbeFile(baselineDir, meta, baseline) {
  const findingsById = new Map((baseline.findings ?? []).map((f) => [f.id, f]));
  const entries = [];
  for (const t of meta.targets ?? []) {
    for (const n of t.nodes ?? []) {
      if (n.nodeless) {
        entries.push({ id: n.id, target: t.key, phase: 'main', nodeless: true });
        continue;
      }
      const [findingId, idxStr] = n.id.split('#');
      const finding = findingsById.get(findingId);
      const idx = Number(idxStr);
      const baseNode = finding?.nodes?.[idx];
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
  const dir = path.join(baselineDir, 'verify');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `.probe-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(entries));
  return file;
}

// assess.mjs always mints its own timestamped subdirectory under --out (it doesn't accept an
// exact final run path), so the actual verify run dir is discovered from its stdout.
function runAssessSubprocess({ invPath, affectedKeys, meta, checksList, baselineDir, probeFile, scopeFileAbs }) {
  const cfg = meta.config ?? {};
  const cliArgs = [
    ASSESS_MJS,
    '--inventory', invPath,
    '--target', affectedKeys.join(','),
    '--level', String(cfg.level ?? 'AA'),
    '--checks', checksList.join(','),
    '--max-tabs', String(cfg.maxTabs ?? 40),
    '--probe', probeFile,
    '--out', path.join(baselineDir, 'verify'),
    '--bail', // stop scheduling targets once one can't be reached: the attempt is unverified anyway
  ];
  if (scopeFileAbs) cliArgs.push('--scope', scopeFileAbs);
  const mods = [...new Set((meta.targets ?? []).flatMap((t) => (t.nodes ?? []).map((n) => n.modality).filter(Boolean)))];
  if (mods.length) cliArgs.push('--modality', mods.join(','));
  if (args.channel) cliArgs.push('--channel', String(args.channel));
  if (args.setup) cliArgs.push('--setup', String(args.setup));
  if (args.cdp) cliArgs.push('--cdp', String(args.cdp));
  if (args.headed) cliArgs.push('--headed');
  if (args.workers) cliArgs.push('--workers', String(args.workers));

  const r = spawnSync(process.execPath, cliArgs, { cwd: process.cwd(), encoding: 'utf8' });
  if (r.error) throw new Error(`Failed to spawn assess.mjs: ${r.error.message}`);
  const m = String(r.stdout ?? '').match(/→\s*(.+?)[\\/]report\.html\s*$/m);
  if (!m) {
    const tail = String(r.stderr ?? r.stdout ?? '').trim().split('\n').slice(-5).join('\n');
    throw new Error(`assess.mjs subprocess did not report a run directory (exit ${r.status}).${tail ? `\n${tail}` : ''}`);
  }
  return path.resolve(m[1].trim());
}

function liveEngineVersions() {
  const v = (pkg) => {
    try { return require(`${pkg}/package.json`).version; } catch { return null; }
  };
  return { playwright: v('playwright'), 'axe-core': v('axe-core'), abledom: abledomVersion() };
}

// Resolves EVERY screen x state x viewport combination (no feature/screen/state/target
// filter) so a missing/renamed target simply doesn't appear in the map (handled by
// checkConfig/decide as "target not reached", not as an UNKNOWN_TARGETS throw) rather than
// resolveTargets's all-or-nothing --target behaviour.
function liveTargetHashes(invPath, scopeFileAbs, hashFn = planHash) {
  try {
    const inv = loadInventory(invPath);
    let effectiveInv = inv;
    if (scopeFileAbs) {
      const scope = loadScope(scopeFileAbs);
      const applied = applyScope(inv, scope);
      if (applied.conflicts.length) return new Map();
      effectiveInv = applied.inv;
    }
    const vp = Object.keys(effectiveInv.viewports ?? { desktop: 1, mobile: 1 });
    const all = resolveTargets(effectiveInv, { viewports: vp.join(',') });
    return new Map(all.map((t) => [t.key, hashFn(t)]));
  } catch {
    return new Map();
  }
}

function filesChanged(meta, sourceRootAbs) {
  const out = {};
  for (const [file, hash] of Object.entries(meta.informational?.files ?? {})) {
    const abs = path.resolve(sourceRootAbs, file);
    out[file] = !fs.existsSync(abs) || crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex') !== hash;
  }
  return out;
}

function appendAttempt(baselineDir, attempt) {
  const file = path.join(baselineDir, 'fix-report.json');
  const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { attempts: [] };
  report.attempts.push(attempt);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  renderFixReport(baselineDir);
}

// ------------------------------------------------------------------ fix-report.html (T7)

// Single renderer shared by the normal flow (right after appending an attempt) and
// `--render-only <run>` (§4): reads `<run>/fix-report.json` + the baseline's own
// `results.json`, resolves per-attempt extras (regression finding details, the latest
// attempt's own verify-run results.json for Scope, and any agent-verdicts.json written for a
// `needs review` attempt since it was recorded), then calls `lib/render.mjs`'s
// `fixReportHtml()` and writes `<run>/fix-report.html`.
function renderFixReport(runDir) {
  const reportPath = path.join(runDir, 'fix-report.json');
  if (!fs.existsSync(reportPath)) {
    console.error(`No fix-report.json at ${reportPath} (run verify.mjs on at least one fix-*.md first)`);
    process.exit(3);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const baselineResultsPath = path.join(runDir, 'results.json');
  const baseline = fs.existsSync(baselineResultsPath) ? JSON.parse(fs.readFileSync(baselineResultsPath, 'utf8')) : null;
  const criteria = loadCriteria();
  const scLinkFn = (num, short) => scLinkImpl(criteria, scInfo, num, short);

  const runCache = new Map();
  const loadRun = (relRunPath) => {
    const abs = path.resolve(runDir, relRunPath);
    if (!runCache.has(abs)) runCache.set(abs, fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, 'utf8')) : null);
    return runCache.get(abs);
  };

  // Every attempt stored with `regressions` carries `{target, rule, finding: "<run>#<id>"}`;
  // resolve each referenced run's actual finding objects so lib/render.mjs can reuse
  // `groupFindings`/`groupHtml` for them exactly like report.html (§6 "regressions via groupHtml").
  const regressionData = new Map();
  report.attempts.forEach((a, i) => {
    if (!a.regressions?.length) return;
    const byRun = new Map();
    for (const r of a.regressions) {
      const hash = r.finding.indexOf('#');
      const runRel = hash < 0 ? r.finding : r.finding.slice(0, hash);
      const fid = hash < 0 ? null : r.finding.slice(hash + 1);
      (byRun.get(runRel) ?? byRun.set(runRel, []).get(runRel)).push(fid);
    }
    const findings = [];
    const targets = new Map();
    for (const [runRel, ids] of byRun) {
      const data = loadRun(runRel);
      if (!data) continue;
      for (const f of data.findings ?? []) if (ids.includes(f.id)) findings.push(f);
      for (const t of data.targets ?? []) targets.set(t.key, t);
    }
    if (findings.length) regressionData.set(i, { groups: groupFindings(findings), targets });
  });

  // §6 "Scope of verified targets (after run)": the LATEST attempt's own verify run, not a
  // per-attempt rebuild - a later attempt that reached fewer/different targets should narrow
  // what the page shows as "currently verified", same as re-running verify.mjs would imply.
  const lastWithRun = [...report.attempts].reverse().find((a) => a.run);
  const scopeData = lastWithRun ? loadRun(lastWithRun.run) : null;

  // Agent verdicts (§6, fix-verify skill step 3) are written to a `needs review` attempt's OWN
  // verify run dir *after* that attempt was already recorded - never mutate the stored record;
  // render with an annotation instead (`decide()` already bakes in any verdict that existed
  // *before* the attempt was recorded, via its own `agentVerdict` field, so this only looks for
  // one when that didn't happen).
  const attempts = report.attempts.map((a) => {
    if (a.status !== 'needs review' || a.agentVerdict || !a.run) return a;
    const verdictsPath = path.resolve(runDir, path.dirname(a.run), 'agent-verdicts.json');
    if (!fs.existsSync(verdictsPath)) return a;
    const verdicts = JSON.parse(fs.readFileSync(verdictsPath, 'utf8'));
    const v = verdicts?.[a.issue];
    return v ? { ...a, overlay: v } : a;
  });

  const allFixes = loadAllFixes(runDir);

  const html = fixReportHtml({ baseline, attempts, scLinkFn, regressionData, scopeData, allFixes });
  fs.writeFileSync(path.join(runDir, 'fix-report.html'), html);
}

// Every fix file the run's own fixes-manifest.json currently lists (fixes.mjs, §F14) - not
// just the ones verify.mjs has ever been run on - so the Fixes section can show an overview
// row for all of them (ready/draft, verification status), with proof detail still limited to
// the ones an attempt actually exists for. Missing manifest (older/partial runs, or tests that
// never called fixes.mjs) -> null, so fixReportHtml falls back to its attempts-only rendering.
function loadAllFixes(runDir) {
  const manifestPath = path.join(runDir, 'fixes-manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  let files;
  try {
    files = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files ?? [];
  } catch {
    return null;
  }
  return files.map((filename) => {
    try {
      return { filename, meta: parseFixFile(path.join(runDir, filename)).meta };
    } catch {
      return { filename, meta: null };
    }
  });
}

// ------------------------------------------------------------------ helpers

function stamp() {
  return new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');
}

function normalizeSlashes(p) {
  return String(p).split(path.sep).join('/');
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else out._.push(argv[i]);
  }
  return out;
}
