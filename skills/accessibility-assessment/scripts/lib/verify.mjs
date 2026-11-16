// Fix-verify decision engine (T6): parses `fix-*.md`'s trailing `a11y-verify` JSON block,
// checks baseline/current compatibility (§6 Version policy), selects which checks to re-run,
// and decides fixed/not fixed/regressed/unverified/needs review from a baseline run + a
// verify (after) run's results.json via the 7 ordered rules in §6 ("Decision rules").
//
// Pure/offline: nothing here touches a live page. Relocation against the live DOM happens in
// lib/evidence.mjs's `applyProbes` (run inside the `assess.mjs` subprocess verify.mjs spawns);
// this module only reads back that subprocess's results.json (`target.probes[]`).
import fs from 'node:fs';
import path from 'node:path';

const FIX_BLOCK_RE = /```json a11y-verify\n([\s\S]*?)\n```/;

// Checks an issue's own check has, and its directly-dependent check (§6 Flow step 3,
// `--quick`): axe only re-checks axe; abledom also re-checks keyboard (abledom's "focus
// lost"/"bad focus" rules are keyboard-driven); keyboard also re-checks overlay (keyboard
// walks can open/close overlays); reflow/text-spacing are self-contained.
const QUICK_DEPS = {
  axe: ['axe'],
  abledom: ['abledom', 'keyboard'],
  keyboard: ['keyboard', 'overlay'],
  reflow: ['reflow'],
  'text-spacing': ['text-spacing'],
};

// A finding's `source` doesn't map 1:1 to `target.checks[name]` - overlay-phase findings
// carry `source:'keyboard'` (escapeCheck reuses the keyboard custom() mapper) but land under
// `checks.overlay`. The correct check name is driven by `context.phase`, falling back to the
// finding/issue's own `source` for 'main'-phase (axe/abledom) findings.
// Agent-sourced findings (agent-findings.json) have no automated owning check: null.
const PHASE_TO_CHECK = { keyboard: 'keyboard', overlay: 'overlay', reflow: 'reflow', 'text-spacing': 'text-spacing' };
const ENGINE_CHECKS = new Set(['axe', 'abledom', 'modality', ...Object.keys(PHASE_TO_CHECK)]);
export function checkNameFor(source, phase) {
  if (source === 'agent') return null;
  if (source === 'modality') return 'modality';
  if (phase && phase !== 'main' && PHASE_TO_CHECK[phase]) return PHASE_TO_CHECK[phase];
  return ENGINE_CHECKS.has(source) ? source : null;
}

// True when a (non-nodeless) listed node carries ANY identity signal a live element could
// ever be relocated/marked by (selector, role+name, or a source line). Reflow/text-spacing
// findings' nodes never carry any of these (checks.mjs's reflowCheck/textSpacingCheck only
// record `html`/`summary`, see §8 "Overlay/reflow/text-spacing findings") - for those, a
// real `data-a11y-probe` marker can never be set, so "is the rule still flagged" must fall
// back to target-level presence (treated like a nodeless entry) instead of requiring a marker
// match, and an inevitable 'unresolved' relocation must not gate rule 4.
export function hasStrongOrWeakIdentity(n) {
  if (n.modality) return false; // modality findings are matched by modality + step, not by a live marker
  return !!(n.selector || n.identity?.role || n.identity?.name || n.source?.file);
}

// Modality evidence: the original step must have actually executed under the same modality in
// the verify run. A skipped, blocked, missing or inconclusive step proves nothing.
function modalityEvidenceGap(ft, at) {
  for (const n of ft.nodes ?? []) {
    if (!n.modality) continue;
    const run = (at.modalityRuns ?? []).find((r) => r.modality === n.modality);
    if (!run) return `modality "${n.modality}" did not run on ${ft.key}`;
    if (run.status === 'blocked' || run.status === 'partial') return `modality "${n.modality}" run was ${run.status} on ${ft.key}`;
    const st = (run.steps ?? []).find((s) => s.index === n.stepIndex);
    if (!st) return `step ${n.stepIndex} was not executed under "${n.modality}" on ${ft.key}`;
    if (st.outcome === 'skipped' || st.outcome === 'blocked' || st.outcome === 'inconclusive') return `step ${n.stepIndex} was ${st.outcome} under "${n.modality}" on ${ft.key}`;
  }
  return null;
}

export function policyChanged(fixMeta, livePolicy) {
  for (const t of fixMeta.targets ?? []) {
    if (!t.policyHash) continue;
    const live = livePolicy?.get ? livePolicy.get(t.key) : livePolicy?.[t.key];
    if (live != null && live !== t.policyHash) return t.key;
  }
  return null;
}

export function parseFixFile(fixFilePath) {
  const abs = path.resolve(fixFilePath);
  if (!fs.existsSync(abs)) {
    const err = new Error(`Fix file not found: ${abs}`);
    err.code = 'FIX_NOT_FOUND';
    throw err;
  }
  const text = fs.readFileSync(abs, 'utf8');
  const m = text.match(FIX_BLOCK_RE);
  if (!m) {
    const err = new Error(`No \`\`\`json a11y-verify fenced block found in ${abs}`);
    err.code = 'FIX_MALFORMED';
    throw err;
  }
  let meta;
  try {
    meta = JSON.parse(m[1]);
  } catch (cause) {
    const err = new Error(`Malformed a11y-verify JSON in ${abs}: ${cause.message}`);
    err.code = 'FIX_MALFORMED';
    throw err;
  }
  const fixFileDir = path.dirname(abs);
  const baselineDir = path.resolve(fixFileDir, meta.baseline ?? '.');
  return { meta, fixFilePath: abs, fixFileDir, baselineDir };
}

// Version policy (§6): hard-fails (rule 1, `unverified (incompatible: <field>)`) on engine
// version/level/viewport/planHash mismatches; everything else is collected as a warning only.
//
// `currentConfig` must be the BASELINE run's own results.json `config` (ground truth for
// engines/level/viewports - catches a hand-edited/stale fix-file config block, since comparing
// the fix file against itself could never show a mismatch). `currentTargets` must be a fresh
// Map<targetKey, planHash> (or plain object) resolved from the LIVE inventory right now
// (catches inventory drift - e.g. a renamed step label changing a target's plan without the
// fix file being regenerated).
export function checkConfig(fixMeta, currentConfig, currentTargets, { acceptPlanChange = false } = {}) {
  const cfg = fixMeta.config ?? {};
  const cur = currentConfig ?? {};
  const warnings = [];
  const fail = (field) => ({ ok: false, reason: `incompatible: ${field}`, warnings });
  const get = (key) => (currentTargets?.get ? currentTargets.get(key) : currentTargets?.[key]);

  if ((cfg.engines?.['axe-core'] ?? null) !== (cur.engines?.['axe-core'] ?? null)) return fail('axe-core');
  if ((cfg.engines?.abledom ?? null) !== (cur.engines?.abledom ?? null)) return fail('abledom');
  if ((cfg.level ?? null) !== (cur.level ?? null)) return fail('level');
  for (const [name, vp] of Object.entries(cfg.viewports ?? {})) {
    const curVp = cur.viewports?.[name];
    if (!curVp || curVp.width !== vp.width || curVp.height !== vp.height) return fail(`viewport:${name}`);
  }
  const changedPlans = [];
  for (const t of fixMeta.targets ?? []) {
    if (t.planHash == null) continue;
    const liveHash = get(t.key);
    if (liveHash == null) continue; // target unresolvable at all: rule 2 ("target not reached") reports this, not config
    if (liveHash !== t.planHash) {
      if (acceptPlanChange) changedPlans.push(t.key);
      else return fail(`planHash:${t.key}`);
    }
  }
  if (changedPlans.length) {
    warnings.push(`inventory steps changed since the baseline for ${changedPlans.length} target${changedPlans.length === 1 ? '' : 's'} (accepted with --accept-plan-change; review the inventory edit): ${changedPlans.join(', ')}`);
  }
  if ((cfg.engines?.playwright ?? null) !== (cur.engines?.playwright ?? null)) {
    warnings.push(`playwright ${cfg.engines?.playwright ?? '?'} → ${cur.engines?.playwright ?? '?'}`);
  }
  if ((cfg.inventory?.sha256 ?? null) !== (cur.inventory?.sha256 ?? null)) {
    warnings.push('inventory file changed since baseline (sha256 differs)');
  }
  return { ok: true, reason: null, warnings };
}

// §6 Flow step 3: default = every check the baseline ran on the affected targets (attempt's
// top-level `checks: "full"`); `--quick` narrows to the issue's own check + its direct
// dependent(s) (`checks: "partial"`). An issue whose source isn't in QUICK_DEPS (review/agent/
// no-engine issues) can't be narrowed safely, so falls back to the full baseline check list
// even under --quick. `scope` here is the attempt's top-level `checks` field name (`full` |
// `partial`); the nested `regressionScope: {targets, checks}` object is assembled by the CLI.
export function checksFor(fixMeta, { quick = false } = {}) {
  const full = [...(fixMeta.config?.checks ?? [])];
  if (!quick) return { checks: full, scope: 'full' };
  const deps = QUICK_DEPS[fixMeta.source];
  const narrowed = deps ? deps.filter((c) => full.includes(c)) : full;
  return { checks: narrowed.length ? narrowed : full, scope: 'partial' };
}

// Decides one fix's verification outcome. Inputs:
//   fixMeta        - the parsed a11y-verify block (issue, rule, source, kind, targets[]).
//   configCheck     - result of checkConfig() for this attempt.
//   baseline        - the baseline run's results.json.
//   after           - the verify subprocess's results.json (same shape, includes target.probes[]
//                     written by lib/evidence.mjs's applyProbes during that run).
//   afterRunRelPath - `run` field for the attempt/regressions (e.g. "verify/<ts>/results.json").
//   agentVerdict    - parsed `<run>/verify/<ts>/agent-verdicts.json` content, or null if absent.
//   checks          - the checks this attempt asked assess.mjs to run (verify.mjs's checksFor());
//                     defaults to the fix file's baseline check list. Each one that completed on
//                     an affected baseline target must complete again for a fixed/regressed proof.
// Returns `{ status, reason, warnings, nodes[], regressions[], counts, agentVerdict }`.
export function decide({ fixMeta, configCheck, baseline, after, afterRunRelPath = '', agentVerdict = null, checks = null }) {
  const warnings = [...(configCheck?.warnings ?? [])];
  const finish = (status, reason, extra = {}) => ({ status, reason, warnings, nodes: [], regressions: [], counts: { before: 0, after: 0 }, agentVerdict: null, ...extra });
  // `r.shot` (set by assess.mjs's cropProbes) is relative to the verify subprocess's OWN run
  // dir ("shots/..."), but the attempt lives in the baseline dir - qualify it with the verify
  // run's directory (afterRunRelPath minus its trailing "results.json") so afterShot resolves
  // correctly from baselineDir, matching the Attempt schema example ("verify/<ts>/shots/...").
  const afterRunDir = afterRunRelPath ? afterRunRelPath.replace(/results\.json$/, '') : '';
  const qualifyShot = (shot) => (shot ? `${afterRunDir}${shot}` : null);

  // Rule 1: config incompatible.
  if (!configCheck?.ok) return finish('unverified', configCheck?.reason ?? 'incompatible config');

  const afterTargets = new Map((after.targets ?? []).map((t) => [t.key, t]));
  const baselineTargets = new Map((baseline.targets ?? []).map((t) => [t.key, t]));
  const affectedKeys = (fixMeta.targets ?? []).map((t) => t.key);

  // Rule 2a: a listed target wasn't reached this time. Report a target that actually errored
  // (with its error) before one that simply wasn't run (e.g. skipped after an early bail-out).
  const unreached = affectedKeys.filter((key) => afterTargets.get(key)?.status !== 'ok');
  if (unreached.length) {
    const errored = unreached.find((key) => afterTargets.has(key));
    const key = errored ?? unreached[0];
    const err = errored ? afterTargets.get(errored).error : null;
    const more = unreached.length > 1 ? ` (+${unreached.length - 1} more)` : '';
    return finish('unverified', `target not reached: ${key}${err ? ` - ${err}` : ''}${more}`);
  }

  // Rule 2b/2c: a baseline check errored on an affected target, or the issue's own check
  // didn't actually run this time (axe: rule absent from all four axeRules buckets).
  for (const ft of fixMeta.targets ?? []) {
    const phases = new Set((ft.nodes ?? []).map((n) => n.context?.phase ?? 'main'));
    if (!phases.size) phases.add('main');
    for (const phase of phases) {
      const checkName = checkNameFor(fixMeta.source, phase);
      if (!checkName) continue; // unknown source (agent/none issue): nothing to check-error against
      const bt = baselineTargets.get(ft.key);
      if (bt?.checks?.[checkName]?.status === 'error') return finish('unverified', `baseline check "${checkName}" errored on ${ft.key}`);
      const at = afterTargets.get(ft.key);
      if (checkName === 'axe') {
        const rules = at.axeRules ?? {};
        const ran = ['violations', 'incomplete', 'passes', 'inapplicable'].some((b) => (rules[b] ?? []).includes(fixMeta.rule));
        if (!ran) return finish('unverified', `axe rule "${fixMeta.rule}" did not run on ${ft.key}`);
      } else if (at.checks?.[checkName]?.status !== 'ok') {
        return finish('unverified', `check "${checkName}" did not run on ${ft.key}`);
      }
    }
  }

  // Rule 2d: every requested check that completed on an affected target in the baseline must
  // complete again; a check absent from the baseline target (e.g. overlay on a page) is not
  // applicable there. Reflow is recorded as `skipped` on all but one viewport of a screen x
  // state ("done on <owner>"), so the owner target's result stands in for it.
  for (const key of affectedKeys) {
    const bt = baselineTargets.get(key);
    const at = afterTargets.get(key);
    for (const c of checks ?? fixMeta.config?.checks ?? []) {
      if (bt?.checks?.[c]?.status !== 'ok') continue;
      let res = at.checks?.[c];
      if (res?.status === 'skipped') res = afterTargets.get(/done on (\S+)/.exec(res.reason ?? '')?.[1])?.checks?.[c] ?? res;
      if (res?.status !== 'ok') return finish('unverified', `check "${c}" did not complete on ${key}${res?.error ? ` - ${res.error}` : ''}`);
    }
  }

  // Rule 2e: modality findings need the original step to have executed under the same modality.
  for (const ft of fixMeta.targets ?? []) {
    const gap = modalityEvidenceGap(ft, afterTargets.get(ft.key));
    if (gap) return finish('unverified', gap);
  }

  // Relocation results from the verify subprocess (`target.probes[]`, one entry per listed node).
  const relocByTarget = new Map((after.targets ?? []).map((t) => [t.key, new Map((t.probes ?? []).map((p) => [p.id, p]))]));

  // Rule 3 lookup: does an after-finding of the same source+rule carry a probe marker on one
  // of our listed nodes (or, node-less, is the rule still present at all on that target)?
  const afterFindingsByTarget = new Map();
  for (const f of after.findings ?? []) (afterFindingsByTarget.get(f.target) ?? afterFindingsByTarget.set(f.target, []).get(f.target)).push(f);
  const sameRule = (f) => f.source === fixMeta.source && f.rule === fixMeta.rule;

  let stillFlagged = false;
  const nodeStatus = new Map(); // node id -> 'flagged' | 'clear'
  for (const ft of fixMeta.targets ?? []) {
    const findingsHere = (afterFindingsByTarget.get(ft.key) ?? []).filter(sameRule);
    const hasAnyFinding = findingsHere.length > 0;
    for (const n of ft.nodes ?? []) {
      // Nodeless items AND identity-less ones (reflow/text-spacing: checks.mjs never records
      // a selector/identity/source for these - §8 "Overlay/reflow/text-spacing findings") have
      // nothing a live-page marker could ever attach to, so "still flagged" falls back to "is
      // the rule present on the target at all", same as a true nodeless entry.
      if (n.nodeless || !hasStrongOrWeakIdentity(n)) {
        const present = n.modality ? findingsHere.some((f) => f.modality === n.modality && f.stepIndex === n.stepIndex) : hasAnyFinding;
        nodeStatus.set(n.id, present ? 'flagged' : 'clear');
      } else {
        const marked = findingsHere.some((f) => f.nodes?.some((an) => an.probe === n.id));
        nodeStatus.set(n.id, marked ? 'flagged' : 'clear');
      }
      if (nodeStatus.get(n.id) === 'flagged') stillFlagged = true;
    }
  }

  // Build the attempt's nodes[] (relocation/via/before/afterShot) regardless of which rule
  // fires - rule 3's "also lists regressions as evidence" implies the proof table is always
  // assembled once we're past the config/reachability gate.
  let anyUnresolved = false;
  const nodesOut = [];
  for (const ft of fixMeta.targets ?? []) {
    const relocMap = relocByTarget.get(ft.key) ?? new Map();
    for (const n of ft.nodes ?? []) {
      if (n.nodeless) {
        nodesOut.push({ id: n.id, target: ft.key, relocation: 'nodeless', via: null, after: nodeStatus.get(n.id), before: null, afterShot: null });
        continue;
      }
      const r = relocMap.get(n.id);
      const relocation = r?.relocation ?? 'unresolved';
      // Identity-less nodes (see above) are reported as 'unresolved' for transparency (there
      // was genuinely nothing to relocate) but, like nodeless, never gate rule 4 - there's no
      // selector/identity to have gone stale/ambiguous in the first place.
      if (relocation === 'unresolved' && hasStrongOrWeakIdentity(n)) anyUnresolved = true;
      const afterState = relocation === 'confirmed-removed' ? 'removed' : relocation === 'unresolved' && hasStrongOrWeakIdentity(n) ? 'unresolved' : nodeStatus.get(n.id);
      nodesOut.push({ id: n.id, target: ft.key, relocation, via: r?.via ?? null, after: afterState, before: n.before ?? null, afterShot: qualifyShot(r?.shot) });
    }
  }
  const counts = countsFor(fixMeta, nodeStatus);

  // Rule 3: not fixed. Still collects regressions as supplementary evidence, but rule order
  // means rule 5 never gets to override this status.
  if (stillFlagged) {
    const regressions = findRegressions({ fixMeta, baseline, after, affectedKeys, afterRunRelPath });
    return finish('not fixed', 'the issue is still present on at least one listed node/target', { nodes: nodesOut, regressions, counts });
  }

  // Rule 4: unverified - any listed node's relocation is unresolved.
  if (anyUnresolved) {
    return finish('unverified', 'one or more listed nodes could not be relocated (stale selector/class, no strong identity to fall back on)', { nodes: nodesOut, counts });
  }

  // Rule 5: regressed - new failures on the affected targets not explained by a baseline failure.
  const regressions = findRegressions({ fixMeta, baseline, after, affectedKeys, afterRunRelPath });
  if (regressions.length) {
    return finish('regressed', `${regressions.length} new failure${regressions.length === 1 ? '' : 's'} on affected target(s)`, { nodes: nodesOut, regressions, counts });
  }

  // A run that was not a fresh context (attached browser, shared context/page, setup interventions) can't prove a fix.
  const ex = after.execution;
  if (ex && (ex.isolation !== 'fresh-context' || (ex.interventions?.length ?? 0) > 0)) {
    return finish('unverified', `the verification run was not a fresh browser context (isolation: ${ex.isolation}, ${ex.interventions?.length ?? 0} intervention(s)); it can only be partial evidence`, { nodes: nodesOut, counts });
  }

  // Rule 6: needs review - review/agent-sourced issue with no recorded agent verdict yet.
  if (fixMeta.kind === 'review' || fixMeta.source === 'agent') {
    const verdict = agentVerdict?.[fixMeta.issue] ?? null;
    if (!verdict) return finish('needs review', 'review/agent-sourced issue has no recorded agent verdict for this attempt yet', { nodes: nodesOut, counts });
    return finish(verdict.status === 'fixed' ? 'fixed' : 'not fixed', verdict.note ?? null, { nodes: nodesOut, counts, agentVerdict: verdict });
  }

  // Rule 7: fixed.
  return finish('fixed', null, { nodes: nodesOut, counts });
}

// CLI exit code for a batch: 1 when any fix is not fixed/regressed (a known failure wins over
// inconclusive proof), else 2 when any is unverified/needs review, else 0.
export function exitCodeFor(statuses) {
  if (statuses.some((s) => s === 'not fixed' || s === 'regressed')) return 1;
  if (statuses.some((s) => s !== 'fixed')) return 2;
  return 0;
}

function countsFor(fixMeta, nodeStatus) {
  let before = 0;
  let after = 0;
  for (const ft of fixMeta.targets ?? []) {
    for (const n of ft.nodes ?? []) {
      before++;
      if (nodeStatus.get(n.id) === 'flagged') after++;
    }
  }
  return { before, after };
}

// Rule 5 helper: "new" failures on affected targets - failures (any rule) where the relevant
// check engine ran `ok` on BOTH the baseline and the after run, that don't equal any baseline
// failure via relocation tiers 1-3 (tier 4/visible-text is explicitly excluded here per §6 -
// text alone is too weak to rule out "this is actually the same element" vs. "coincidentally
// the same text"). Ambiguous/unclear cases count as new: `nodesEquivalent` only returns true
// for a confident tier 1-3 match, never a fuzzy guess.
export function findRegressions({ fixMeta, baseline, after, affectedKeys, afterRunRelPath = '' }) {
  const baselineTargets = new Map((baseline.targets ?? []).map((t) => [t.key, t]));
  const afterTargets = new Map((after.targets ?? []).map((t) => [t.key, t]));
  const baselineFailuresByTarget = new Map();
  for (const f of baseline.findings ?? []) {
    if (f.kind !== 'failure') continue;
    (baselineFailuresByTarget.get(f.target) ?? baselineFailuresByTarget.set(f.target, []).get(f.target)).push(f);
  }
  const out = [];
  for (const key of affectedKeys) {
    const bt = baselineTargets.get(key);
    const at = afterTargets.get(key);
    if (!bt || !at) continue;
    const baselineFailures = baselineFailuresByTarget.get(key) ?? [];
    const afterFailures = (after.findings ?? []).filter((f) => f.target === key && f.kind === 'failure' && (f.scopeSignal ?? 'in') === 'in');
    for (const f of afterFailures) {
      const checkName = checkNameFor(f.source, f.context?.phase ?? 'main');
      const afterOk = at.checks?.[checkName]?.status === 'ok';
      const baselineOk = bt.checks?.[checkName]?.status === 'ok';
      if (!afterOk || !baselineOk) continue; // engine didn't cleanly run on both sides; not comparable
      const matches = baselineFailures.some((bf) => bf.source === f.source && bf.rule === f.rule && nodesEquivalent(bf, f));
      if (!matches) out.push({ target: key, rule: f.rule, finding: `${afterRunRelPath}#${f.id}` });
    }
  }
  return out;
}

// Static node-list equivalence (no live DOM - both sides are already-captured finding
// records): every current node must tier-1/2/3-match *some* baseline node of the same
// rule+target for the pair of findings to be considered "the same" failure.
function nodesEquivalent(baselineFinding, afterFinding) {
  const bNodes = baselineFinding.nodes ?? [];
  const aNodes = afterFinding.nodes ?? [];
  if (!bNodes.length && !aNodes.length) return true;
  if (!bNodes.length || !aNodes.length) return false;
  return aNodes.every((an) => bNodes.some((bn) => oneNodeEquivalent(bn, an)));
}

function oneNodeEquivalent(bn, an) {
  const tagOk = !bn.identity?.tag || !an.identity?.tag || bn.identity.tag === an.identity.tag;
  if (!tagOk) return false;
  if (bn.selector && an.selector && bn.selector === an.selector) return true; // tier 1
  if (bn.source?.file && an.source?.file && bn.source.line != null && bn.source.line === an.source.line && bn.source.file === an.source.file) return true; // tier 2
  if (bn.identity?.role && an.identity?.role && bn.identity?.name && an.identity?.name && bn.identity.role === an.identity.role && bn.identity.name === an.identity.name) return true; // tier 3
  return false;
}
