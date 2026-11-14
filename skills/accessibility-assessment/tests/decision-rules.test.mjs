// §9 pure decision-rule tests: missing-target, failed-check, config-incompatible, and
// git-agnostic ("committed") rules - all driven by hand-built synthetic baseline/after/fixMeta
// objects fed straight to decide()/checkConfig() (no browser, no assess.mjs subprocess: these
// rules are pure data-shape checks over already-captured results.json-shaped objects).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, checkConfig, exitCodeFor } from '../scripts/lib/verify.mjs';
import { okConfigCheck } from './helpers.mjs';

const CONFIG = { engines: { 'axe-core': '4.10.0' }, level: 'AA', viewports: { desktop: { width: 1280, height: 800 } } };

function node(id, overrides = {}) {
  return { id, context: { phase: 'main' }, selector: `#el-${id}`, identity: { tag: 'button', role: 'button', name: 'X' }, source: null, box: null, before: null, ...overrides };
}

function fixMeta({ targets, config = CONFIG } = {}) {
  return { version: 1, status: 'draft', issue: 'failure:axe:button-name', source: 'axe', rule: 'button-name', kind: 'failure', wcag: ['4.1.2'], baseline: '.', config, targets, informational: { git: null, files: {} } };
}

function resultsShape({ targets = [], findings = [] } = {}) {
  return { config: CONFIG, targets, findings };
}

test('config: an incompatible axe-core engine version decides unverified (incompatible: axe-core)', () => {
  const fm = fixMeta({ targets: [{ key: 't1', planHash: 'h1', nodes: [node('F0001#0')] }], config: { ...CONFIG, engines: { 'axe-core': '4.9.0' } } });
  const configCheck = checkConfig(fm, CONFIG, new Map([['t1', 'h1']]));
  assert.equal(configCheck.ok, false);
  assert.equal(configCheck.reason, 'incompatible: axe-core');
  const result = decide({
    fixMeta: fm,
    configCheck,
    baseline: resultsShape({ targets: [{ key: 't1', status: 'ok', checks: { axe: { status: 'ok' } }, planHash: 'h1' }] }),
    after: resultsShape({ targets: [{ key: 't1', status: 'ok', checks: { axe: { status: 'ok' } }, planHash: 'h1', axeRules: { violations: [], incomplete: [], passes: [], inapplicable: [] }, probes: [] }] }),
  });
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'incompatible: axe-core');
});

test('config: checkConfig is git-agnostic - a changed/absent fixMeta.informational.git never fails or warns', () => {
  const currentTargets = new Map([['t1', 'h1']]);
  const fm = fixMeta({ targets: [{ key: 't1', planHash: 'h1', nodes: [node('F0001#0')] }] });
  fm.informational.git = { commit: 'deadbeef', dirty: true }; // arbitrary, mismatched-looking VCS info
  const withGit = checkConfig(fm, CONFIG, currentTargets);
  const fm2 = fixMeta({ targets: [{ key: 't1', planHash: 'h1', nodes: [node('F0001#0')] }] });
  fm2.informational.git = null;
  const withoutGit = checkConfig(fm2, CONFIG, currentTargets);
  assert.deepEqual(withGit, withoutGit, 'checkConfig never reads/compares informational.git at all');
  assert.equal(withGit.ok, true);
  assert.deepEqual(withGit.warnings, []);
});

test('missing-target: a listed target key absent from the after run decides unverified (target not reached)', () => {
  const fm = fixMeta({ targets: [{ key: 'does-not-exist__default__desktop', planHash: 'h1', nodes: [node('F0001#0')] }] });
  const result = decide({
    fixMeta: fm,
    configCheck: okConfigCheck(),
    baseline: resultsShape({ targets: [{ key: 'does-not-exist__default__desktop', status: 'ok', checks: { axe: { status: 'ok' } } }] }),
    after: resultsShape({ targets: [] }), // target wasn't resolved/run at all this time
  });
  assert.equal(result.status, 'unverified');
  assert.match(result.reason, /target not reached: does-not-exist__default__desktop/);
});

test('missing-target: a listed target present but not status "ok" also decides unverified', () => {
  const fm = fixMeta({ targets: [{ key: 't1', planHash: 'h1', nodes: [node('F0001#0')] }] });
  const result = decide({
    fixMeta: fm,
    configCheck: okConfigCheck(),
    baseline: resultsShape({ targets: [{ key: 't1', status: 'ok', checks: { axe: { status: 'ok' } } }] }),
    after: resultsShape({ targets: [{ key: 't1', status: 'error', checks: {} }] }),
  });
  assert.equal(result.status, 'unverified');
  assert.match(result.reason, /target not reached: t1/);
});

test('failed-check: the baseline check itself errored on the affected target decides unverified', () => {
  const fm = fixMeta({ targets: [{ key: 't1', planHash: 'h1', nodes: [node('F0001#0')] }] });
  const result = decide({
    fixMeta: fm,
    configCheck: okConfigCheck(),
    baseline: resultsShape({ targets: [{ key: 't1', status: 'ok', checks: { axe: { status: 'error' } } }] }),
    after: resultsShape({ targets: [{ key: 't1', status: 'ok', checks: { axe: { status: 'ok' } }, axeRules: { violations: ['button-name'], incomplete: [], passes: [], inapplicable: [] }, probes: [] }] }),
  });
  assert.equal(result.status, 'unverified');
  assert.match(result.reason, /baseline check "axe" errored on t1/);
});

test('failed-check: the issue\'s own axe rule did not run at all this time decides unverified', () => {
  const fm = fixMeta({ targets: [{ key: 't1', planHash: 'h1', nodes: [node('F0001#0')] }] });
  const result = decide({
    fixMeta: fm,
    configCheck: okConfigCheck(),
    baseline: resultsShape({ targets: [{ key: 't1', status: 'ok', checks: { axe: { status: 'ok' } } }] }),
    after: resultsShape({ targets: [{ key: 't1', status: 'ok', checks: { axe: { status: 'ok' } }, axeRules: { violations: [], incomplete: [], passes: [], inapplicable: [] }, probes: [] }] }),
  });
  assert.equal(result.status, 'unverified');
  assert.match(result.reason, /axe rule "button-name" did not run on t1/);
});

const AXE_RAN = { violations: [], incomplete: [], passes: ['button-name'], inapplicable: [] };

test('agent issue: no automated owning check is required; a clean re-run decides needs review', () => {
  const fm = { ...fixMeta({ targets: [{ key: 't1', planHash: 'h1', nodes: [node('agent-1#0')] }] }), issue: 'failure:agent:label-in-name', source: 'agent', rule: 'label-in-name' };
  const result = decide({
    fixMeta: fm,
    configCheck: okConfigCheck(),
    baseline: resultsShape({ targets: [{ key: 't1', status: 'ok', checks: { axe: { status: 'ok' } } }] }),
    after: resultsShape({ targets: [{ key: 't1', status: 'ok', checks: { axe: { status: 'ok' } }, axeRules: AXE_RAN, probes: [{ id: 'agent-1#0', relocation: 'found', via: 'selector' }] }] }),
  });
  assert.equal(result.status, 'needs review', result.reason);
  const verdict = decide({
    fixMeta: fm,
    configCheck: okConfigCheck(),
    baseline: resultsShape({ targets: [{ key: 't1', status: 'ok', checks: { axe: { status: 'ok' } } }] }),
    after: resultsShape({ targets: [{ key: 't1', status: 'ok', checks: { axe: { status: 'ok' } }, axeRules: AXE_RAN, probes: [{ id: 'agent-1#0', relocation: 'found', via: 'selector' }] }] }),
    agentVerdict: { 'failure:agent:label-in-name': { status: 'fixed', note: 'names match' } },
  });
  assert.equal(verdict.status, 'fixed');
});

test('failed-check: another requested check failing on an affected target blocks a fixed proof', () => {
  const fm = fixMeta({ targets: [{ key: 't1', planHash: 'h1', nodes: [node('F0001#0')] }] });
  const baseline = resultsShape({ targets: [{ key: 't1', status: 'ok', checks: { axe: { status: 'ok' }, keyboard: { status: 'ok' } } }] });
  const after = (keyboard) => resultsShape({ targets: [{ key: 't1', status: 'ok', checks: { axe: { status: 'ok' }, keyboard }, axeRules: AXE_RAN, probes: [{ id: 'F0001#0', relocation: 'found', via: 'selector' }] }] });
  const broken = decide({ fixMeta: fm, configCheck: okConfigCheck(), baseline, after: after({ status: 'error', error: 'boom' }), checks: ['axe', 'keyboard'] });
  assert.equal(broken.status, 'unverified');
  assert.match(broken.reason, /check "keyboard" did not complete on t1 - boom/);
  assert.equal(decide({ fixMeta: fm, configCheck: okConfigCheck(), baseline, after: after({ status: 'ok' }), checks: ['axe', 'keyboard'] }).status, 'fixed');
  // --quick narrowed the requested checks to axe only: keyboard isn't part of this proof.
  assert.equal(decide({ fixMeta: fm, configCheck: okConfigCheck(), baseline, after: after({ status: 'error' }), checks: ['axe'] }).status, 'fixed');
});

test('failed-check: reflow skipped on a non-owner viewport counts via its owner target', () => {
  const fm = fixMeta({ targets: [{ key: 't1', planHash: 'h1', nodes: [node('F0001#0')] }, { key: 't2', planHash: 'h2', nodes: [node('F0002#0')] }] });
  const tgt = (key, reflow) => ({ key, status: 'ok', checks: { axe: { status: 'ok' }, reflow }, axeRules: AXE_RAN, probes: [{ id: key === 't1' ? 'F0001#0' : 'F0002#0', relocation: 'found', via: 'selector' }] });
  const baseline = resultsShape({ targets: [tgt('t1', { status: 'ok' }), tgt('t2', { status: 'ok' })] });
  const ok = decide({ fixMeta: fm, configCheck: okConfigCheck(), baseline, after: resultsShape({ targets: [tgt('t1', { status: 'ok' }), tgt('t2', { status: 'skipped', reason: 'done on t1' })] }), checks: ['axe', 'reflow'] });
  assert.equal(ok.status, 'fixed', ok.reason);
});

test('missing-target: an errored target is reported (with its error) before targets skipped by --bail', () => {
  const fm = fixMeta({ targets: [{ key: 'a', planHash: 'h', nodes: [node('F0001#0')] }, { key: 'b', planHash: 'h', nodes: [node('F0002#0')] }] });
  const result = decide({
    fixMeta: fm,
    configCheck: okConfigCheck(),
    baseline: resultsShape({ targets: [{ key: 'a', status: 'ok', checks: {} }, { key: 'b', status: 'ok', checks: {} }] }),
    after: resultsShape({ targets: [{ key: 'b', status: 'error', error: 'Step failed: Click button' }] }),
  });
  assert.equal(result.status, 'unverified');
  assert.equal(result.reason, 'target not reached: b - Step failed: Click button (+1 more)');
});

test('config: --accept-plan-change yields one warning listing every changed target; a changed inventory sha warns', () => {
  const fm = fixMeta({ targets: [{ key: 't1', planHash: 'h1', nodes: [] }, { key: 't2', planHash: 'h2', nodes: [] }] });
  fm.config = { ...CONFIG, inventory: { sha256: 'old' } };
  const r = checkConfig(fm, { ...CONFIG, inventory: { sha256: 'new' } }, new Map([['t1', 'x'], ['t2', 'y']]), { acceptPlanChange: true });
  assert.equal(r.ok, true);
  const plan = r.warnings.filter((w) => /inventory steps changed/.test(w));
  assert.equal(plan.length, 1);
  assert.match(plan[0], /2 targets.*t1, t2/);
  assert.doesNotMatch(plan[0], /knowledge/);
  assert.ok(r.warnings.some((w) => /sha256 differs/.test(w)));
});

test('exit code: a not-fixed/regressed result wins over unverified in either order', () => {
  assert.equal(exitCodeFor(['not fixed', 'unverified']), 1);
  assert.equal(exitCodeFor(['unverified', 'regressed']), 1);
  assert.equal(exitCodeFor(['fixed', 'needs review']), 2);
  assert.equal(exitCodeFor(['fixed', 'fixed']), 0);
});
