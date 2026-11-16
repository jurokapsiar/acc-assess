#!/usr/bin/env node
// Runs the assessment for selected features/screens/states/viewports and writes
// <out>/<timestamp>/results.json, screenshots and report.html.
//
//   node scripts/assess.mjs [--inventory .a11y/inventory.json] [--feature a,b] [--screen x,y]
//        [--state default,dark] [--viewport desktop,mobile] [--target key1,key2] [--level AA]
//        [--out .a11y/reports] [--checks axe,abledom,keyboard,overlay,reflow,text-spacing]
//        [--workers 2] [--channel msedge] [--headed] [--max-tabs 40] [--dry-run]
//        [--source auto|off] [--source-root <dir>] [--probe <file.json>] [--bail]
//        [--scope <scope.json>] [--storage-state <file>]
//        [--setup <module.mjs>] [--cdp <loopback endpoint>]
//        [--modality keyboard,mouse] [--max-presses 120] [--max-escalations 10] [--no-escalate]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { loadInventory, validateInventory, resolveTargets, inventoryTree, planHash, policyHash, DEFAULT_INVENTORY, allScreens, screenById } from './lib/inventory.mjs';
import { loadScope, applyScope, scopeDigest, loadJourneysFor } from './lib/scope.mjs';
import { runStep, describeStep, locate, stepTrace } from './lib/steps.mjs';
import { AXE_TAGS, tagToSc, axeRuleLevel, isRequired, loadCriteria, levelOf, scInfo, DEFAULT_KNOWLEDGE } from './lib/wcag.mjs';
import { abledomBundle, abledomVersion, ABLEDOM_INIT, ABLEDOM_RULES } from './lib/abledom.mjs';
import { keyboardWalk, escapeCheck, reflowCheck, textSpacingCheck } from './lib/checks.mjs';
import { captureNodes, applyProbes } from './lib/evidence.mjs';
import { gitInfo } from './lib/git.mjs';
import { resolveSourceRoot } from './lib/source.mjs';
import { MODALITIES, KEYBOARD_LIKE, guardSurface, makeObserver, runKeyboardStep } from './lib/modality.mjs';
import { MODALITY_RULES } from './lib/modality-rules.mjs';
import { createBrowserSession } from './lib/browser-setup.mjs';
import { STEPS_FILE, appendStep, probeFocus } from './lib/steps-log.mjs';
import { createResults, addTarget, addFindings, finalizeResults, validateResults } from './lib/results.mjs';

const require = createRequire(import.meta.url);
const args = parseArgs(process.argv.slice(2));
// --modality keyboard,mouse: extra guarded replays of every target's plan (see references/modalities.md).
// The sr-* modalities belong to the screen-reader-validation skill: giving one here is a usage error.
const cliModalities = args.modality ? String(args.modality).split(',').map((s) => s.trim()).filter(Boolean) : null;
for (const m of cliModalities ?? []) {
  if (!MODALITIES.includes(m) || m.startsWith('sr-')) {
    console.error(`Unsupported --modality "${m}" for assess.mjs (use keyboard and/or mouse; sr-keyboard/sr-navigation run with the screen-reader-validation skill).`);
    process.exit(3);
  }
}
const maxPresses = Number(args['max-presses'] ?? 120);
const maxEscalations = Number(args['max-escalations'] ?? 10);
const noEscalate = !!args['no-escalate'];

const level = String(args.level ?? 'AA').toUpperCase();
const checks = new Set(String(args.checks ?? 'axe,abledom,keyboard,overlay,reflow,text-spacing').split(','));
const OVERLAY_TYPES = ['dialog', 'popover', 'menu', 'drawer'];
const APG = 'https://www.w3.org/WAI/ARIA/apg/patterns/';
const OVERLAY_ID = '__a11y_assess_overlay';

let inv = loadInventory(args.inventory ?? DEFAULT_INVENTORY);
// --scope (scope-definition skill, or hand-written): overlays additional screens/states into
// the inventory IN MEMORY before anything else runs. A conflict (an id present with different
// content) aborts before validateInventory/resolveTargets so nothing partial gets assessed.
let scope = null;
if (args.scope) {
  scope = loadScope(args.scope);
  const applied = applyScope(inv, scope);
  if (applied.conflicts.length) {
    console.error(`Scope "${scope.id ?? args.scope}" conflicts with the inventory (nothing was run):\n- ${applied.conflicts.join('\n- ')}`);
    process.exit(1);
  }
  inv = applied.inv;
}
const { errors } = validateInventory(inv);
if (errors.length) {
  console.error('Inventory is invalid:\n- ' + errors.join('\n- '));
  process.exit(1);
}
// A scope's targets become the effective target set, ANDed with any explicit --target the
// user also gave; still narrowed (and strictly checked, like plain --target) by
// --feature/--screen/--state/--viewport.
const explicitTargets = args.target ? String(args.target).split(',').map((s) => s.trim()).filter(Boolean) : null;
const targetKeys = scope ? (explicitTargets ? scope.targets.filter((k) => explicitTargets.includes(k)) : scope.targets) : args.target;
if (scope && explicitTargets && !targetKeys.length) {
  console.error('No overlap between --scope targets and --target keys (nothing was run).');
  process.exit(1);
}
let targets;
try {
  targets = resolveTargets(inv, { features: args.feature, screens: args.screen, states: args.state, viewports: args.viewport, targets: targetKeys });
} catch (err) {
  if (err.code === 'UNKNOWN_TARGETS') {
    console.error(`Unknown or filtered-out --target keys (nothing was run):\n- ${err.missing.join('\n- ')}`);
    process.exit(1);
  }
  throw err;
}
if (!targets.length) {
  console.error('No targets match the selection.');
  process.exit(1);
}
if (args['dry-run']) {
  for (const t of targets) console.log(`${t.key}\n  ${t.plan.map(describeStep).join('\n  ')}`);
  process.exit(0);
}
// Dedup reflow (V8): attach it to the first selected viewport target of each screen x state,
// decided up front from the resolved target order so concurrent workers don't race for it.
const reflowOwner = new Map();
for (const t of targets) {
  const rsKey = `${t.screen.id}__${t.state.id}`;
  if (!reflowOwner.has(rsKey)) reflowOwner.set(rsKey, t.key);
}
// --probe file (internal, written by verify.mjs): [{ id, target, phase, selector, identity,
// source, box, nodeless }]. Relocated against the live DOM per phase via lib/evidence.mjs's
// applyProbes() (T6); each target's matches land in results.json's target.probes[].
const probeEntries = args.probe ? JSON.parse(fs.readFileSync(path.resolve(args.probe), 'utf8')) : [];

// Source tracking (T4): precedence --source-root (CLI) > inventory.app.sourceRoot (relative
// to the app root/cwd) > the app root itself (§2). `sourceCache` is shared across every
// target/phase so a module's text and parsed source map are fetched at most once per run.
const sourceMode = args.source ? String(args.source) : 'auto';
const sourceRoot = resolveSourceRoot({ cliRoot: args['source-root'], invRoot: inv.app.sourceRoot, appRoot: process.cwd() });
const sourceAttrs = inv.app.sourceAttrs ?? undefined;
const sourceCache = new Map();
const sourceCtx = { source: sourceMode, sourceRoot, sourceAttrs, sourceCache };

const criteria = loadCriteria(args.knowledge);
if (!criteria.length) console.warn('Knowledge cache missing: run `npm run knowledge` in the skill folder for criterion titles and levels.');
const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');
const outBase = path.resolve(args.out ?? path.join(path.dirname(inv.__file), 'reports'));
const runDir = claimRunDir(outBase, stamp);
fs.mkdirSync(path.join(runDir, 'shots'), { recursive: true });

// Optional auth (§12 of the scope-definition spec): a Playwright storageState PATH only,
// never its content. `--storage-state` wins over `inventory.app.storageState` (relative to
// the inventory file's directory).
const storageStatePath = args['storage-state'] ?? inv.app.storageState ?? null;
const storageStateAbs = storageStatePath ? path.resolve(path.dirname(inv.__file), storageStatePath) : null;
if (storageStateAbs && !fs.existsSync(storageStateAbs)) {
  console.error(`storageState file not found: ${storageStateAbs}`);
  process.exit(1);
}

const bundle = checks.has('abledom') ? await abledomBundle() : null;
let session;
try {
  session = await createBrowserSession({ chromium, headed: !!args.headed, channel: args.channel, setupPath: args.setup, cdp: args.cdp });
  if (storageStateAbs && session.hasNewContext) throw new Error('--setup provides newContext, so --storage-state / inventory storageState cannot also be used');
} catch (err) {
  console.error(`Cannot launch browser: ${err.message.split('\n')[0]}\nRun \`npx playwright install chromium\` in the skill folder or pass --channel msedge|chrome.`);
  process.exit(1);
}

const results = createResults({
  standard: `WCAG 2.2 ${level}`,
  level,
  app: { name: inv.app.name, baseUrl: inv.app.baseUrl },
  engines: {
    playwright: require('playwright/package.json').version,
    'axe-core': checks.has('axe') ? require('axe-core/package.json').version : null,
    abledom: bundle ? abledomVersion() : null,
  },
  config: buildConfig(),
  inventory: inventoryTree(inv),
  selection: { feature: args.feature ?? null, screen: args.screen ?? null, state: args.state ?? null, viewport: args.viewport ?? null, scope: scope?.id ?? null },
  scope: scope ? buildScopeSummary() : null,
  execution: session.execution,
  startedAt: new Date().toISOString(),
});
const coverage = new Set();
// --bail (internal, passed by verify.mjs): once a target can't be reached, don't start the
// remaining ones - their results can't change the attempt's "unverified" outcome.
let bailed = false;

// Ancestor screens run first, and a target waits for the (already started) targets of its
// ancestor screens on the same viewport: if one of them could not be reached, the dependent
// target is `blocked` (not run), not a second, redundant error.
const screenDepth = (s) => (s.parent ? 1 + screenDepth(screenById(inv, s.parent)) : 0);
const ancestorIds = (s) => (s.parent ? [s.parent, ...ancestorIds(screenById(inv, s.parent))] : []);
const runOrder = targets.map((t, i) => ({ t, i })).sort((a, b) => screenDepth(a.t.screen) - screenDepth(b.t.screen) || a.i - b.i).map((x) => x.t);
const settled = new Map();

await pool(runOrder, Number(args.workers ?? 2), async (t) => {
  if (bailed) return;
  const started = Date.now();
  const deps = ancestorIds(t.screen).flatMap((id) => runOrder.filter((o) => o.screen.id === id && o.state.id === 'default' && o.viewport.name === t.viewport.name).map((o) => o.key));
  const depResults = await Promise.all(deps.filter((k) => settled.has(k)).map((k) => settled.get(k)));
  const failedDep = depResults.find((r) => r.target.status === 'error' || r.target.status === 'blocked');
  const promise = failedDep
    ? Promise.resolve({ target: { ...summary(t), status: 'blocked', blockedBy: failedDep.target.key, reason: `prerequisite target ${failedDep.target.key} was not reached${failedDep.target.error ? `: ${failedDep.target.error}` : ''}` }, findings: [] })
    : assessTarget(t).catch((err) => ({ target: { ...summary(t), status: 'error', error: err.message }, findings: [] }));
  settled.set(t.key, promise);
  const res = await promise;
  const mine = session.execution.interventions.filter((i) => i.target === t.key);
  if (mine.length) res.target.interventions = mine;
  if (fs.existsSync(path.join(runDir, STEPS_FILE))) res.target.stepsLog = STEPS_FILE;
  addTarget(results, res.target);
  addFindings(results, res.findings);
  if (args.bail && res.target.status === 'error') bailed = true;
  const fails = res.findings.filter((f) => f.kind === 'failure').length;
  console.log(`${res.target.status === 'ok' ? '✓' : '✗'} ${t.key}  ${res.target.status === 'blocked' ? 'blocked' : `${fails} failures`}  ${((Date.now() - started) / 1000).toFixed(1)}s${res.target.error || res.target.reason ? `  (${res.target.error ?? res.target.reason})` : ''}`);
});
await session.close();
if (bailed) {
  const ran = new Set(results.targets.map((x) => x.key));
  const failed = results.targets.find((x) => x.status === 'error');
  for (const t of targets) if (!ran.has(t.key)) addTarget(results, { ...summary(t), status: 'not-attempted', reason: `--bail: stopped after ${failed?.key ?? 'an unreachable target'}` });
  console.log(`--bail: stopped after an unreachable target; ${targets.length - ran.size} target(s) not run`);
}

const order = new Map(targets.map((t, i) => [t.key, i]));
finalizeResults(results, order);
results.coverage = [...coverage];
results.modalities = [...new Set(results.targets.flatMap((t) => (t.modalityRuns ?? []).map((r) => r.modality)))];
results.journeys = buildJourneys();
results.finishedAt = new Date().toISOString();
const { errors: resultErrors } = validateResults(results, { runDir });
if (resultErrors.length) {
  fs.writeFileSync(path.join(runDir, 'results.invalid.json'), JSON.stringify(results, null, 2));
  console.error(`The assessment produced an invalid results.json; it was saved as ${path.join(runDir, 'results.invalid.json')} and no report was rendered:\n- ${resultErrors.slice(0, 40).join('\n- ')}`);
  process.exit(1);
}
fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(results, null, 2));
execFileSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'report.mjs'), runDir, ...(args.knowledge ? ['--knowledge', args.knowledge] : []), ...(args.channel ? ['--channel', args.channel] : [])], { stdio: 'inherit' });
const total = results.findings.filter((f) => f.kind === 'failure').length;
console.log(`\n${results.targets.length} targets, ${total} failures → ${path.join(runDir, 'report.html')}`);

// ------------------------------------------------------------------ per target

async function assessTarget(t) {
  const findings = [];
  const shots = path.join(runDir, 'shots');
  const base = baseRepro(t);
  const { context, page, ableLog, phase } = await openPage(t, t.viewport);
  const out = { ...summary(t), status: 'ok', repro: [...base, ...t.plan.map(describeStep)], steps: t.plan.map(stepTrace), checks: {}, planHash: planHash(t), ...(t.plan.some((s) => s.modalities || s.modalitySkip || s.intent || s.keys) ? { policyHash: policyHash(t) } : {}), areas: [], probes: [] };
  const targetProbes = probeEntries.filter((p) => p.target === t.key);
  try {
    try {
      await runPlan(page, t.plan, phase);
    } catch (err) {
      await page.screenshot({ path: path.join(shots, `${t.key}.png`) }).catch(() => {});
      out.screenshot = `shots/${t.key}.png`;
      throw Object.assign(err, { partial: out });
    }
    phase.name = 'ready';
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, `${t.key}.png`), fullPage: true, animations: 'disabled' });
    out.screenshot = `shots/${t.key}.png`;
    const mainProbes = await applyProbes(page, targetProbes, 'main', { scope: t.screen.scope, sourceRoot, sourceAttrs, sourceCache, sourceMode });
    await cropProbes(page, t, mainProbes, 'main');
    out.probes.push(...mainProbes);

    const pageSize = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
    out.shot = { file: out.screenshot, width: pageSize.width, height: pageSize.height };
    await captureShotAreas(page, t, out, pageSize, shots);

    // axe-core static analysis on the settled state
    let axeNodes = new Set();
    if (checks.has('axe')) {
      try {
        const { findings: axeFindings, axeRules } = await runAxe(page, t);
        await captureNodes(page, axeFindings, { ...sourceCtx, phase: 'main', viewport: { width: t.viewport.width, height: t.viewport.height }, page: 'live', scope: t.screen.scope });
        findings.push(...axeFindings);
        axeNodes = new Set(axeFindings.flatMap((f) => f.nodes.map((n) => openTag(n.html))));
        await cropNodes(page, t, axeFindings, 'a');
        out.annotated = await annotate(page, t, axeFindings.filter((f) => f.kind === 'failure'));
        out.axeRules = axeRules;
        pushFindingAreas(out, axeFindings);
        out.checks.axe = { status: 'ok' };
      } catch (err) {
        out.checks.axe = { status: 'error', error: err.message.split('\n')[0] };
      }
    }
    if (checks.has('keyboard')) {
      try {
        await ensureState(page, t, phase);
        phase.name = 'keyboard';
        const kbProbes = await applyProbes(page, targetProbes, 'keyboard', { scope: t.screen.scope, sourceRoot, sourceAttrs, sourceCache, sourceMode });
        const overlay = OVERLAY_TYPES.includes(t.screen.type);
        const onInitial = async (stop) => {
          const pseudo = [{ nodes: [{ selector: stop.selector, html: stop.html }] }];
          await captureNodes(page, pseudo, { ...sourceCtx, phase: 'keyboard', viewport: { width: t.viewport.width, height: t.viewport.height }, page: 'live', scope: t.screen.scope });
          await cropNodes(page, t, pseudo, 'kinit');
          const n = pseudo[0].nodes[0];
          return { source: n.source ?? null, screenshot: n.screenshot ?? null };
        };
        const kb = await keyboardWalk(page, { scope: t.screen.scope, maxTabs: Number(args['max-tabs'] ?? 40), modalHint: t.screen.type === 'dialog' && t.screen.modal !== false, fromStart: !overlay, overlay, onInitial });
        const kbFindings = kb.findings.map((f) => custom(t, f, 'keyboard', [...out.repro, ...(f.tabIndex ? [`Press Tab ${f.tabIndex} time${f.tabIndex > 1 ? 's' : ''}`] : [])]));
        await captureNodes(page, kbFindings, { ...sourceCtx, phase: 'keyboard', viewport: { width: t.viewport.width, height: t.viewport.height }, page: 'live', scope: t.screen.scope });
        await cropNodes(page, t, kbFindings, 'k');
        await cropProbes(page, t, kbProbes, 'keyboard');
        out.probes.push(...kbProbes);
        findings.push(...kbFindings);
        out.tabOrder = kb.stops.map((s) => ({ index: s.index, role: s.role, name: s.name, selector: s.selector, box: s.box ?? null, ...(s.initial ? { initial: true, source: s.source ?? null, screenshot: s.screenshot ?? null } : {}) }));
        if (kb.note) out.tabOrderNote = kb.note;
        if (overlay) await ensureState(page, t, phase).catch(() => {}); // the walk may have dismissed the overlay
        out.tabOrderShot = await tabOrderShot(page, t, kb.stops);
        out.areas.push(...kb.stops.filter((s) => s.box).map((s) => ({ kind: 'tabstop', box: s.box, label: String(s.index), phase: 'keyboard', shot: out.shot.file })));
        ['2.1.1', '2.1.2', '2.4.3', '2.4.7', '2.4.11'].forEach((sc) => coverage.add(sc));
        out.checks.keyboard = { status: 'ok' };
        await page.waitForTimeout(checks.has('abledom') ? 2200 : 0); // AbleDOM reports focus loss after 2s
      } catch (err) {
        out.checks.keyboard = { status: 'error', error: err.message.split('\n')[0] };
      }
    }

    if (checks.has('abledom')) {
      try {
        const ableF = ableFindings(t, ableLog, axeNodes, out.repro);
        await captureNodes(page, ableF, { ...sourceCtx, phase: 'main', viewport: { width: t.viewport.width, height: t.viewport.height }, page: 'live', scope: t.screen.scope });
        await cropNodes(page, t, ableF, 'd');
        findings.push(...ableF);
        pushFindingAreas(out, ableF);
        out.checks.abledom = { status: 'ok' };
      } catch (err) {
        out.checks.abledom = { status: 'error', error: err.message.split('\n')[0] };
      }
    }

    if (checks.has('text-spacing')) {
      try {
        await ensureState(page, t, phase);
        phase.name = 'text-spacing';
        const tsProbes = await applyProbes(page, targetProbes, 'text-spacing', { scope: t.screen.scope, sourceRoot, sourceAttrs, sourceCache, sourceMode });
        const tsRepro = [...out.repro, 'Apply text spacing: line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em, paragraph spacing 2em'];
        // Evidence is captured while the spacing override is applied (the failing geometry).
        const tsFindings = await textSpacingCheck(page, t.screen.scope, {
          whileApplied: async (raw) => {
            const mapped = raw.map((f) => custom(t, f, 'text-spacing', tsRepro));
            await captureNodes(page, mapped, { ...sourceCtx, phase: 'text-spacing', viewport: { width: t.viewport.width, height: t.viewport.height }, page: 'live', scope: t.screen.scope });
            await cropNodes(page, t, mapped, 's');
            return mapped;
          },
        });
        await cropProbes(page, t, tsProbes, 'text-spacing');
        out.probes.push(...tsProbes);
        findings.push(...tsFindings);
        coverage.add('1.4.12');
        out.checks['text-spacing'] = { status: 'ok' };
      } catch (err) {
        out.checks['text-spacing'] = { status: 'error', error: err.message.split('\n')[0] };
      }
    }
  } catch (err) {
    out.status = 'error';
    out.error = err.message.split('\n')[0];
  } finally {
    await context.close();
  }

  const modalities = modalitiesFor(t);
  if (out.status === 'ok' && modalities.length) {
    out.modalityRuns = [];
    for (const m of modalities) {
      if (m === 'mouse') { out.modalityRuns.push({ modality: 'mouse', status: 'complete', legacy: true, steps: [] }); continue; }
      const r = await runModalityPhase(t, m, out).catch((err) => ({ run: { modality: m, status: 'blocked', error: err.message.split('\n')[0], steps: [] }, found: [] }));
      out.modalityRuns.push(r.run);
      findings.push(...r.found);
    }
    const bad = out.modalityRuns.find((r) => r.status === 'blocked' || r.status === 'partial');
    out.checks.modality = bad ? { status: 'error', error: `${bad.modality} run ${bad.status}${bad.note ? `: ${bad.note}` : ''}` } : { status: 'ok' };
  }

  if (out.status === 'ok' && checks.has('overlay') && OVERLAY_TYPES.includes(t.screen.type)) {
    const r = await withFreshPage(t, t.viewport, async (page) => {
      const trigger = t.screen.trigger ? locate(page, t.screen.trigger) : lastTrigger(page, t.plan);
      const probes = await applyProbes(page, targetProbes, 'overlay', { scope: t.screen.scope, sourceRoot, sourceAttrs, sourceCache, sourceMode });
      const f = await escapeCheck(page, { scope: t.screen.scope ?? '[role=dialog],[role=menu],[role=alertdialog]', triggerLocator: trigger, type: t.screen.type });
      const mapped = f.map((x) => custom(t, x, 'keyboard', [...out.repro, 'Press Escape']));
      await captureNodes(page, mapped, { ...sourceCtx, phase: 'overlay', viewport: { width: t.viewport.width, height: t.viewport.height }, page: 'fresh', scope: t.screen.scope });
      await cropProbes(page, t, probes, 'overlay');
      return { findings: mapped, probes };
    });
    if (r.status === 'ok') {
      findings.push(...r.value.findings);
      out.probes.push(...r.value.probes);
      out.checks.overlay = { status: 'ok' };
    } else {
      out.checks.overlay = { status: 'error', error: r.error };
    }
  }

  const rsKey = `${t.screen.id}__${t.state.id}`;
  if (out.status === 'ok' && checks.has('reflow')) {
    if (reflowOwner.get(rsKey) === t.key) {
      const vp = { name: 'reflow', width: 320, height: 640 };
      const r = await withFreshPage(t, vp, async (page) => {
        const probes = await applyProbes(page, targetProbes, 'reflow', { scope: null, sourceRoot, sourceAttrs, sourceCache, sourceMode });
        const res = await reflowCheck(page);
        if (res.length) await page.screenshot({ path: path.join(runDir, 'shots', `${rsKey}__reflow.png`), animations: 'disabled' });
        const mapped = res.map((x) => {
          const c = custom(t, x, 'reflow', [`Set the browser viewport to 320×640 CSS px (or 1280px at 400% zoom)`, ...t.plan.map(describeStep), 'Observe the horizontal scrollbar']);
          c.nodes[0].screenshot = `shots/${rsKey}__reflow.png`;
          return c;
        });
        await captureNodes(page, mapped, { ...sourceCtx, phase: 'reflow', viewport: { width: vp.width, height: vp.height }, page: 'fresh', scope: null });
        await cropProbes(page, t, probes, 'reflow');
        return { findings: mapped, probes };
      });
      if (r.status === 'ok') {
        findings.push(...r.value.findings);
        out.probes.push(...r.value.probes);
        out.checks.reflow = { status: 'ok' };
      } else {
        out.checks.reflow = { status: 'error', error: r.error };
      }
      coverage.add('1.4.10');
    } else {
      out.checks.reflow = { status: 'skipped', reason: `done on ${reflowOwner.get(rsKey)}` };
    }
  }
  return { target: out, findings };
}

// Records one 'finding' area per retained, locatable node of a main-phase findings list
// (results.json target.areas; see captureShotAreas for 'scope'/'cut' and kb.stops for 'tabstop').
function pushFindingAreas(out, list) {
  for (const f of list) {
    for (const n of f.nodes ?? []) {
      if (!n.box) continue;
      out.areas.push({ kind: 'finding', box: n.box, label: String(out.areas.filter((a) => a.kind === 'finding').length + 1), finding: f, findingKind: f.kind, phase: 'main', shot: out.shot?.file });
    }
  }
}

// Scope area + cut crop, computed once from the clean, just-settled full screenshot (before
// any check mutates focus/DOM). `screen.cut`: "scope" (default) crops the scope element,
// another selector crops that element instead, and no match falls back to the viewport.
async function captureShotAreas(page, t, out, pageSize, shots) {
  const cutSel = !t.screen.cut || t.screen.cut === 'scope' ? t.screen.scope : t.screen.cut;
  const scopeBox = t.screen.scope ? await page.evaluate(boxInPage, t.screen.scope).catch(() => null) : null;
  if (scopeBox) out.areas.push({ kind: 'scope', box: scopeBox, label: t.screen.name, phase: 'main', shot: out.shot.file });
  else if (t.screen.scope) out.scopeMissingReason = 'not-locatable';
  await captureSubscreenTriggers(page, t, out);
  const cutBox = cutSel ? await page.evaluate(boxInPage, cutSel).catch(() => null) : null;
  const pad = 16;
  const base = cutBox ?? { x: 0, y: 0, width: t.viewport.width, height: t.viewport.height };
  const box = {
    x: Math.max(0, base.x - pad),
    y: Math.max(0, base.y - pad),
  };
  box.width = Math.min(pageSize.width - box.x, base.width + pad * 2);
  box.height = Math.min(pageSize.height - box.y, base.height + pad * 2);
  if (box.width < 4 || box.height < 4) return;
  const file = `shots/${t.key}__cut.png`;
  try {
    await page.screenshot({ path: path.join(shots, path.basename(file)), fullPage: true, clip: box, animations: 'disabled' });
    out.cut = { file, box };
  } catch {
    out.cut = null;
  }
}

// `subscreen` areas (D1, Scope section redesign): on the parent screen, box the trigger
// element of every child screen that declares one, so the report can highlight "what opens
// this subscreen" without a separate assessment pass. Best-effort: a trigger that isn't
// visible/locatable in this state is silently skipped, not an error.
async function captureSubscreenTriggers(page, t, out) {
  const children = inv.features.flatMap((f) => f.screens).filter((c) => c.parent === t.screen.id && c.trigger);
  for (const c of children) {
    try {
      const loc = locate(page, c.trigger);
      const bb = await loc.boundingBox();
      if (!bb || !bb.width || !bb.height) continue;
      const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
      out.areas.push({ kind: 'subscreen', box: { x: bb.x + scroll.x, y: bb.y + scroll.y, width: bb.width, height: bb.height }, label: c.name, childScreen: c.id, phase: 'main', shot: out.shot.file });
    } catch {
      // trigger not present/visible in this state - skip
    }
  }
}

// Runs in page.
function boxInPage(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width && r.height ? { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } : null;
}

async function openPage(t, viewport) {
  const { name, width, height, ...vpRest } = viewport;
  const context = await session.newContext({ viewport: { width, height }, ...vpRest, ...(storageStateAbs ? { storageState: storageStateAbs } : {}), ...(t.state.emulate ?? {}) }, t);
  const page = await context.newPage();
  await session.beforeTarget({ context, page, target: t });
  const realClose = context.close.bind(context);
  let closed = false;
  context.close = async () => {
    if (closed) return;
    closed = true;
    try { await session.afterTarget({ context, page, target: t, status: 'closed' }); } finally { await realClose(); }
  };
  const ableLog = [];
  const phase = { name: 'start', step: -1 };
  if (bundle) {
    await page.exposeFunction('__a11yAbleDOM', (rec) => ableLog.push({ ...rec, phase: phase.name, step: phase.step }));
    await page.addInitScript({ content: `window.__a11yScope = ${JSON.stringify(t.screen.scope ?? null)};` });
    await page.addInitScript({ path: bundle });
    await page.addInitScript({ content: ABLEDOM_INIT });
  }
  return { context, page, ableLog, phase };
}

// Runs `fn` in a fresh context/page replaying the target's plan (used by overlay/reflow,
// which need an isolated page per V2). Returns `{status:'ok', value}` or, instead of
// silently swallowing the error as `[]`, `{status:'error', error}` so the caller can record
// it on `target.checks[name]`.
async function withFreshPage(t, viewport, fn) {
  const { context, page, phase } = await openPage({ ...t, screen: { ...t.screen } }, viewport);
  try {
    await runPlan(page, t.plan, phase);
    await page.waitForTimeout(300);
    return { status: 'ok', value: await fn(page) };
  } catch (err) {
    return { status: 'error', error: err.message.split('\n')[0] };
  } finally {
    await context.close();
  }
}

async function runPlan(page, plan, phase) {
  for (const [i, st] of plan.entries()) {
    phase.name = 'plan';
    phase.step = i;
    try {
      await runStep(page, st);
    } catch (err) {
      throw new Error(`Step ${i + 1} failed – ${describeStep(st)}: ${err.message.split('\n')[0]}`);
    }
  }
}

function lastTrigger(page, plan) {
  const st = [...plan].reverse().find((s) => ['click', 'press'].includes(s.action) && s.target);
  return st ? locate(page, st.target) : null;
}

// ------------------------------------------------------------------ axe

async function runAxe(page, t) {
  const tags = [...AXE_TAGS[level], 'best-practice', ...(level === 'AAA' ? [] : ['wcag2aaa'])];
  let builder = new AxeBuilder({ page }).withTags(tags);
  if (t.screen.scope) builder = builder.include(t.screen.scope);
  for (const sel of inv.app.axeExclude ?? []) builder = builder.exclude(sel);
  const r = await builder.analyze();
  for (const rule of [...r.passes, ...r.violations, ...r.incomplete]) {
    for (const tag of rule.tags) {
      const sc = tagToSc(tag);
      if (sc && isRequired(levelOf(criteria, sc, axeRuleLevel(rule.tags)), level)) coverage.add(sc);
    }
  }
  const toFinding = (rule, bucket) => {
    const wcag = rule.tags.map(tagToSc).filter(Boolean).filter((sc) => sc !== '4.1.1');
    const lvl = axeRuleLevel(rule.tags);
    const required = isRequired(lvl, level) && !rule.tags.includes('best-practice');
    const kind = bucket === 'violations' ? (required ? 'failure' : 'suggestion') : required ? 'review' : null;
    if (!kind) return null;
    return {
      target: t.key,
      source: 'axe',
      rule: rule.id,
      title: rule.help,
      description: rule.description,
      impact: rule.impact ?? 'moderate',
      wcag,
      level: lvl ?? 'best-practice',
      kind,
      helpUrl: rule.helpUrl,
      fix: kind === 'review' ? 'Verify manually; axe could not determine the result.' : null,
      nodes: rule.nodes.slice(0, 10).map((n) => ({
        selector: Array.isArray(n.target.at(-1)) ? n.target.at(-1).at(-1) : n.target.at(-1),
        framed: n.target.length > 1,
        html: n.html,
        summary: n.failureSummary,
      })),
      moreNodes: Math.max(0, rule.nodes.length - 10),
      repro: [...baseRepro(t), ...t.plan.map(describeStep), `Inspect ${rule.nodes.length} element${rule.nodes.length > 1 ? 's' : ''} matching the selector(s) below`],
    };
  };
  return { findings: [...r.violations.map((x) => toFinding(x, 'violations')), ...r.incomplete.map((x) => toFinding(x, 'incomplete'))].filter(Boolean), axeRules: {
    violations: r.violations.map((x) => x.id),
    incomplete: r.incomplete.map((x) => x.id),
    passes: r.passes.map((x) => x.id),
    inapplicable: r.inapplicable.map((x) => x.id),
  } };
}

// ------------------------------------------------------------------ AbleDOM

function ableFindings(t, log, axeNodes, repro) {
  const NON_ANCHORED = new Set(['focus-lost', 'bad-focus']);
  const active = new Map();
  const events = [];
  for (const [i, rec] of log.entries()) {
    if (NON_ANCHORED.has(rec.rule)) {
      // Plan-phase events repeat on every child target, and out-of-scope ones come from the background page.
      if (rec.kind === 'added' && rec.phase !== 'plan' && (!t.screen.scope || rec.inScope !== false)) events.push(rec);
      continue;
    }
    const key = `${rec.rule}|${rec.selector}`;
    if (rec.kind === 'removed') active.delete(key);
    else if (!active.has(key)) active.set(key, { ...rec, index: i });
  }
  const scope = t.screen.scope;
  // axe-core is authoritative for contrast; AbleDOM misreads transparent backgrounds.
  const skip = new Set(checks.has('axe') ? ['contrast'] : []);
  // tabindex="-1" makes skip-link targets/hidden internals programmatically focusable; APG recommends tabindex="0" on tab panels.
  const benign = (r) => /^<[^>]*\sdata-a11y-start/.test(r.html ?? '') || (r.id === 'tabindex-non-interactive' && (/^<[^>]*\stabindex="-1"/.test(r.html ?? '') || /^<[^>]*\srole="tabpanel"/.test(r.html ?? '')));
  const anchored = [...active.values()].filter((r) => !skip.has(r.id) && !r.hidden && !benign(r) && !axeNodes.has(openTag(r.html)) && (!scope || r.inScope !== false));
  const all = [...anchored, ...events];
  const seen = new Set();
  return all.flatMap((rec) => {
    const meta = ABLEDOM_RULES[rec.id] ?? { title: rec.message, wcag: [], impact: 'moderate' };
    const k = `${rec.id}|${rec.selector}|${rec.phase}`;
    if (seen.has(k)) return [];
    seen.add(k);
    const steps = rec.phase === 'plan' ? [...baseRepro(t), ...t.plan.slice(0, rec.step + 1).map(describeStep)] : rec.phase === 'keyboard' ? [...repro, 'Press Tab repeatedly through the screen'] : repro;
    return [custom(t, {
      rule: rec.id, title: meta.title, wcag: meta.wcag, impact: meta.impact, kind: meta.kind ?? 'failure',
      nodes: [{ selector: rec.selector, html: rec.html, summary: rec.message }],
      fix: meta.fix, helpUrl: rec.help,
    }, 'abledom', [...steps, `Observe: ${rec.message}`])];
  });
}

// ------------------------------------------------------------------ helpers

function custom(t, f, source, repro) {
  const wcag = f.wcag ?? [];
  const lvl = wcag.length ? wcag.map((sc) => levelOf(criteria, sc, 'A')).sort()[0] : null;
  let kind = f.kind ?? 'failure';
  if (kind === 'failure' && (!lvl || !wcag.some((sc) => isRequired(levelOf(criteria, sc, 'A'), level)))) kind = 'suggestion';
  return {
    target: t.key,
    source,
    rule: f.rule,
    title: f.title,
    description: f.description ?? null,
    impact: f.impact ?? 'moderate',
    wcag,
    level: lvl ?? (f.pattern ? 'pattern' : null),
    kind,
    helpUrl: f.helpUrl ?? (f.pattern ? `${APG}${f.pattern}/` : wcag[0] ? scInfo(criteria, wcag[0])?.url : null),
    pattern: f.pattern ?? null,
    fix: f.fix ?? null,
    nodes: f.nodes ?? [],
    repro,
  };
}

function baseRepro(t) {
  const em = Object.entries(t.state.emulate ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ');
  return [`Use a ${t.viewport.width}×${t.viewport.height} viewport${em ? ` with ${em}` : ''}`];
}

// Effective modalities of a target: --modality, else the union declared by its steps (journeys.json).
function modalitiesFor(t) {
  if (cliModalities) return [...new Set(cliModalities)].sort((a, b) => KEYBOARD_LIKE.includes(b) - KEYBOARD_LIKE.includes(a));
  const declared = new Set(t.plan.flatMap((s) => s.modalities ?? []).filter((m) => MODALITIES.includes(m) && !m.startsWith('sr-')));
  return [...declared].sort((a, b) => KEYBOARD_LIKE.includes(b) - KEYBOARD_LIKE.includes(a));
}

// Guarded replay of the target's plan in a fresh context under a keyboard modality. A step that
// needs a pointer or a programmatic focus move is performed in a rescue scope so the barrier is
// demonstrated, then reported as a finding with the step as repro and a screenshot.
async function runModalityPhase(t, modality, out) {
  const interventionsBefore = (t.interventions ?? []).length;
  const { context, page: raw } = await openPage(t, t.viewport);
  const stepsFile = path.join(runDir, STEPS_FILE);
  const ctl = { rescue: false };
  const ctx = { page: guardSurface(raw, ctl), raw, ctl, obs: makeObserver(raw), modality, maxPresses, noEscalate, actionable: false };
  const run = { modality, status: 'complete', steps: [] };
  const found = [];
  let escalations = 0;
  try {
    for (const [i, st] of t.plan.entries()) {
      const rec = { index: i, journey: st.journey ?? null, action: st.action, outcome: 'ok' };
      const skip = st.modalitySkip?.[modality];
      const notFor = st.modalities && !st.modalities.includes(modality);
      let r;
      if (skip || notFor) r = { outcome: 'skipped', findings: skip ? [{ rule: 'kbd-step-skipped', note: skip }] : [], presses: 0 };
      else {
        try { r = await runKeyboardStep(ctx, st, {}); } catch (err) { r = { outcome: 'blocked', findings: [], note: err.message.split('\n')[0], presses: 0 }; }
      }
      Object.assign(rec, { outcome: r.outcome, presses: r.presses, escalation: r.escalation ?? null, note: r.note ?? null, key: r.key ?? null, rules: r.findings.map((f) => f.rule) });
      run.steps.push(rec);
      const fp = await probeFocus(raw);
      appendStep(stepsFile, { target: t.key, modality, step: i, action: st.action, key: r.key ?? null, pageUrl: raw.url(), focused: fp.focused, outcome: fp.outcome === 'ok' ? r.outcome : fp.outcome, ...(r.note ? { note: r.note } : {}) });
      for (const f of r.findings) {
        const meta = MODALITY_RULES[f.rule];
        if (!meta) continue;
        if (r.escalation) escalations++;
        const info = st.target ? await locate(raw, st.target).evaluate((el) => ({ selector: el.id ? `#${el.id}` : el.tagName.toLowerCase(), html: el.outerHTML.slice(0, 300), summary: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 80) })).catch(() => null) : null;
        const shot = `shots/${t.key}__${modality}-${i}-${f.rule}.png`;
        await raw.screenshot({ path: path.join(runDir, shot), animations: 'disabled' }).catch(() => {});
        const repro = [...baseRepro(t), ...t.plan.slice(0, i).map(describeStep), `${modality === 'keyboard' ? 'With the keyboard only (Tab, Shift+Tab, arrow keys, Enter, Space): ' : 'Without a mouse: '}${describeStep(st)}`];
        const c = custom(t, { rule: f.rule, title: meta.title, description: f.note ? `${meta.description} (${f.note})` : meta.description, impact: meta.impact, wcag: meta.wcag, fix: meta.fix, kind: meta.kind, nodes: info ? [{ ...info, screenshot: shot }] : [{ selector: 'page', html: '', summary: describeStep(st), screenshot: shot }] }, 'modality', repro);
        Object.assign(c, { modality, stepIndex: i, journey: st.journey ?? null, escalation: r.escalation ?? null, presses: r.presses });
        found.push(c);
      }
      coverage.add('2.1.1').add('2.1.2').add('2.4.3');
      if (r.outcome === 'blocked') { run.status = 'blocked'; break; }
      if (escalations >= maxEscalations) { run.status = 'partial'; run.note = `stopped after ${maxEscalations} escalations`; break; }
    }
    if (run.status === 'complete' && run.steps.some((s) => s.outcome === 'escalated')) run.status = 'escalated';
    if (run.status === 'complete' && run.steps.some((s) => s.outcome === 'inconclusive')) run.status = 'partial';
    if (run.status === 'complete' && (t.interventions ?? []).length > interventionsBefore) { run.status = 'partial'; run.note = 'setup intervention recorded during this run'; }
  } finally {
    await context.close();
  }
  if (run.status === 'blocked' || run.status === 'partial') process.exitCode = 2;
  return { run, found };
}

function summary(t) {
  return { key: t.key, feature: t.feature, screen: t.screen, state: t.state, viewport: t.viewport };
}

// results.config: replayed by a later verify task; versions/git/inventory hash are
// informational and best-effort (null rather than throwing when not applicable).
function buildConfig() {
  const engineVersion = (pkg) => {
    try { return require(`${pkg}/package.json`).version; } catch { return null; }
  };
  const knowledgeMeta = readJsonSafe(path.join(args.knowledge ?? DEFAULT_KNOWLEDGE, 'meta.json'));
  const vpUsed = {};
  for (const t of targets) vpUsed[t.viewport.name] ??= { width: t.viewport.width, height: t.viewport.height };
  return {
    level,
    checks: [...checks],
    viewports: vpUsed,
    maxTabs: Number(args['max-tabs'] ?? 40),
    modalities: cliModalities,
    maxPresses,
    noEscalate,
    source: args.source ? String(args.source) : 'auto',
    sourceRoot: args['source-root'] ?? inv.app.sourceRoot ?? null,
    engines: { playwright: engineVersion('playwright'), 'axe-core': engineVersion('axe-core'), abledom: engineVersion('abledom') },
    knowledge: knowledgeMeta?.fetchedAt ?? null,
    inventory: { file: path.relative(runDir, inv.__file).split(path.sep).join('/'), sha256: crypto.createHash('sha256').update(fs.readFileSync(inv.__file)).digest('hex') },
    git: gitInfo(),
  };
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// `results.scope`: file/id/digests relative to runDir, so fix-verify's verify.mjs can
// forward the exact same scope on a verify subprocess run started from a different cwd.
function buildScopeSummary() {
  return {
    file: path.relative(runDir, scope.__file).split(path.sep).join('/'),
    id: scope.id ?? null,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(scope.__file)).digest('hex'),
    journeysSha256: scope.journeysSha256 ?? null,
    producers: scope.producers ?? [],
    intent: scope.intent ?? null,
  };
}

// `results.journeys`: one entry per user journey, for the report's "User journeys" section.
// Two sources, same output shape (so render.mjs has a single code path):
//  - a scope's journeys.json, when one was used: gives curated titles and the screen order,
//    one flow at a time (journeys can revisit an already-covered screen with no new steps).
//  - otherwise, one journey per inventory screen that has its own non-empty `steps` (synthesized
//    from the merged inventory `inv`, so this also works with no scope-definition skill at all).
// Either way, the actual narrative/actionable-elements data always comes from the already-run
// `t.plan` (via each target's `out.steps`, built by `stepTrace()`) - never re-derived from the
// journeys.json step text, which can be dropped by `compileJourneys()` for revisited screens.
function buildJourneys() {
  const screenChain = (id) => {
    const chain = [];
    for (let s = screenById(inv, id); s; s = s.parent ? screenById(inv, s.parent) : null) chain.unshift(s);
    return chain;
  };
  const targetFor = (screenId) => {
    const matches = results.targets.filter((t) => t.screen.id === screenId && t.state.id === 'default');
    return matches.find((t) => t.viewport.name === 'desktop') ?? matches[0]
      ?? results.targets.find((t) => t.screen.id === screenId) ?? null;
  };

  let defs = null;
  if (scope) {
    try {
      const { doc } = loadJourneysFor(scope);
      defs = (doc.journeys ?? []).map((j) => ({
        id: j.id,
        title: j.title ?? j.id,
        screenIds: [...new Set((j.segments ?? []).map((seg) => (typeof seg.screen === 'string' ? seg.screen : seg.screen?.id)).filter(Boolean))],
      }));
    } catch { defs = null; } // scope has no journeys file (or it's unreadable): fall back below
  }
  if (!defs) {
    const assessedScreens = new Set(results.targets.map((t) => t.screen.id));
    defs = allScreens(inv)
      .filter((s) => (s.steps ?? []).length && assessedScreens.has(s.id))
      .map((s) => ({ id: s.id, title: s.name ?? s.id, screenIds: screenChain(s.id).map((c) => c.id) }));
  }

  return defs.map((j) => {
    const screens = j.screenIds.map((id) => {
      const scr = screenById(inv, id);
      const t = targetFor(id);
      const steps = (t?.steps ?? []).filter((st) => st.origin === (scr?.name ?? scr?.id));
      return { id, name: scr?.name ?? id, targetKey: t?.key ?? null, steps };
    }).filter((s) => screenById(inv, s.id));
    return screens.length ? { id: j.id, title: j.title, screens } : null;
  }).filter(Boolean);
}

// Run-dir collision fix (§11 of the scope-definition spec): two `assess.mjs` runs starting in
// the same second must not land in the same directory. Claims the leaf with a non-recursive
// `mkdirSync` (atomic create, throws EEXIST if another process just created it) and appends
// `-2`, `-3` … on collision.
function claimRunDir(base, stamp) {
  fs.mkdirSync(base, { recursive: true });
  for (let n = 1; ; n++) {
    const dir = path.join(base, n === 1 ? stamp : `${stamp}-${n}`);
    try {
      fs.mkdirSync(dir);
      return dir;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

function openTag(html) {
  return String(html ?? '').split('>')[0].replace(/\s+/g, ' ').trim();
}

async function drawBoxes(page, boxes) {
  await page.evaluate(({ id, boxes }) => {
    const root = document.createElement('div');
    root.id = id;
    root.setAttribute('aria-hidden', 'true');
    root.setAttribute('popover', 'manual');
    root.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647';
    for (const b of boxes) {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;left:${b.x - 2}px;top:${b.y - 2}px;width:${b.width + 4}px;height:${b.height + 4}px;outline:2px solid #b4413c;background:rgba(240,150,150,.18);box-sizing:border-box`;
      if (b.label) {
        const s = document.createElement('span');
        s.textContent = b.label;
        s.style.cssText = `position:absolute;left:-2px;top:${b.y > 18 ? -18 : b.height + 2}px;background:#b4413c;color:#fff;font:600 11px/16px system-ui,sans-serif;padding:0 4px;border-radius:2px;white-space:nowrap`;
        d.appendChild(s);
      }
      root.appendChild(d);
    }
    document.documentElement.appendChild(root);
    try { root.showPopover(); } catch {}
  }, { id: OVERLAY_ID, boxes });
}

async function clearBoxes(page) {
  await page.evaluate((id) => document.getElementById(id)?.remove(), OVERLAY_ID).catch(() => {});
}

// Screenshots and scrolling can dismiss transient UI (menus, popovers); replay the plan if the screen is gone.
async function ensureState(page, t, phase) {
  const probe = t.screen.ready ? locate(page, t.screen.ready) : t.screen.scope ? page.locator(t.screen.scope) : null;
  if (!probe || (await probe.first().isVisible().catch(() => false))) return;
  phase.name = 'replay';
  await runPlan(page, t.plan, phase);
  await page.waitForTimeout(400);
}

async function cropNodes(page, t, findings, prefix) {
  let n = 0;
  for (const [fi, f] of findings.entries()) {
    for (const [ni, node] of f.nodes.entries()) {
      if (!node.selector || node.framed || ni >= 3 || n >= 40) continue;
      try {
        const loc = page.locator(node.selector).first();
        await loc.scrollIntoViewIfNeeded({ timeout: 1500 });
        const box = await loc.boundingBox({ timeout: 1500 });
        if (!box || box.width < 1 || box.height < 1) continue;
        const vp = page.viewportSize();
        const pad = 48;
        const x = Math.max(0, box.x - pad);
        const y = Math.max(0, box.y - pad);
        const clip = { x, y, width: Math.min(vp.width - x, box.width + pad * 2), height: Math.min(vp.height - y, box.height + pad * 2) };
        if (clip.width < 4 || clip.height < 4) continue;
        await drawBoxes(page, [box]);
        const file = `shots/${t.key}__${prefix}${fi}-${ni}.png`;
        await page.screenshot({ path: path.join(runDir, file), clip, animations: 'disabled' });
        node.screenshot = file;
        n++;
      } catch {
        // element not locatable (detached, hidden, or selector not resolvable by Playwright)
      } finally {
        await clearBoxes(page);
      }
    }
  }
}

// Proof-of-relocation crop for each --probe result (T6): 'found' gets an outlined box at the
// *current* box (the relocated element's new position/size); 'confirmed-removed' gets an
// unmarked crop of the *baseline* box's region on the current page (there's no live element to
// outline - the crop itself, showing whatever/nothing now occupies that spot, is the evidence);
// 'unresolved'/'nodeless' get no shot. Reuses the fullPage+document-space clip technique from
// cropNodes/captureShotAreas (box.x/y already include scrollX/scrollY).
async function cropProbes(page, t, probeResults, phase) {
  for (const r of probeResults) {
    if (!r.box || r.relocation === 'nodeless' || r.relocation === 'unresolved') continue;
    const pageSize = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })).catch(() => null);
    const pad = 48;
    const x = Math.max(0, r.box.x - pad);
    const y = Math.max(0, r.box.y - pad);
    const maxW = pageSize?.width ?? r.box.x + r.box.width + pad;
    const maxH = pageSize?.height ?? r.box.y + r.box.height + pad;
    const clip = { x, y, width: Math.min(maxW - x, r.box.width + pad * 2), height: Math.min(maxH - y, r.box.height + pad * 2) };
    if (clip.width < 4 || clip.height < 4) continue;
    try {
      if (r.relocation === 'found') await drawBoxes(page, [{ ...r.box, label: r.relocation }]);
      const file = `shots/${t.key}__probe-${phase}-${r.id}.png`;
      await page.screenshot({ path: path.join(runDir, file), fullPage: true, clip, animations: 'disabled' });
      r.shot = file;
    } catch {
      // not capturable (clip math stale after a layout shift since the box was measured)
    } finally {
      if (r.relocation === 'found') await clearBoxes(page);
    }
  }
}

async function annotate(page, t, failures) {
  const boxes = [];
  let i = 0;
  for (const f of failures) {
    i++;
    for (const node of f.nodes.slice(0, 5)) {
      if (!node.selector || node.framed) continue;
      const b = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width && r.height ? { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } : null;
      }, node.selector).catch(() => null);
      if (b) boxes.push({ ...b, label: String(i) });
    }
  }
  if (!boxes.length) return null;
  await page.evaluate(() => scrollTo(0, 0));
  await drawBoxes(page, boxes);
  const file = `shots/${t.key}__annotated.png`;
  await page.screenshot({ path: path.join(runDir, file), fullPage: true, animations: 'disabled' }).catch(() => {});
  await clearBoxes(page);
  return file;
}

async function tabOrderShot(page, t, stops) {
  if (!stops.length) return null;
  const boxes = [];
  for (const s of stops) {
    // Live geometry when the element still renders; otherwise the box saved during the walk
    // (document coords), so a dismissed or re-rendered overlay still gets its numbers.
    const b = await page.evaluate(({ sel, saved }) => {
      const el = document.querySelector(sel);
      const r = el?.getBoundingClientRect();
      if (r?.width && r?.height) return { x: r.x, y: r.y, width: r.width, height: r.height };
      return saved ? { x: saved.x - scrollX, y: saved.y - scrollY, width: saved.width, height: saved.height } : null;
    }, { sel: s.selector, saved: s.box ?? null }).catch(() => null);
    if (b) boxes.push({ ...b, label: String(s.index) });
  }
  if (!boxes.length) return null;
  await drawBoxes(page, boxes);
  const file = `shots/${t.key}__taborder.png`;
  await page.screenshot({ path: path.join(runDir, file), animations: 'disabled' }).catch(() => {});
  await clearBoxes(page);
  return file;
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.max(1, size) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}
