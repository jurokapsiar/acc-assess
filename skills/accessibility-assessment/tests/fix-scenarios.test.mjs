// §9 fixture/test table: the structural decision-rule scenarios (contrast, hashed, removed,
// reflow, regress, repeated) run against the real assess.mjs engine twice (baseline + "after")
// and fed through the real `decide()`/`checkConfig()` engine - these exercise the genuine
// relocation tiers (1 selector, 2 source, 3 role+name, 4 text) and rules 3/4/5/7, not mocks.
import { test, before, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import { serveDir } from './serve.mjs';
import { decide } from '../scripts/lib/verify.mjs';
import {
  FIXTURES_DIR,
  freshDir,
  loadTemplateInventory,
  withInventory,
  writeInventory,
  runAssess,
  fixMetaFromBaseline,
  buildProbeFile,
  okConfigCheck,
} from './helpers.mjs';

let server;

before(async () => {
  server = await serveDir(FIXTURES_DIR);
});

afterAll(async () => {
  await server.close();
});

/** Runs the baseline (v=before); caller builds fixMeta then calls runAfter() for the "after"
 * assess run with a real --probe file (mirrors scripts/verify.mjs's own flow), so relocation
 * tiers actually run instead of every node reporting 'unresolved'. */
async function runBaseline(screenId, { checks = 'axe', viewport } = {}) {
  const base = loadTemplateInventory();
  const beforeInv = withInventory(base, { baseUrl: server.url, screenUrls: { [screenId]: `${screenId}.html?v=before` } });
  const beforePath = writeInventory(beforeInv, freshDir(`${screenId}-before-inv`));
  const baseline = (await runAssess({ inventory: beforePath, screen: screenId, checks, viewport, out: freshDir(`${screenId}-before-out`) })).results;
  async function runAfter(fixMeta, { variant = 'after' } = {}) {
    const afterInv = withInventory(base, { baseUrl: server.url, screenUrls: { [screenId]: `${screenId}.html?v=${variant}` } });
    const afterPath = writeInventory(afterInv, freshDir(`${screenId}-${variant}-inv`));
    const probeFile = buildProbeFile(fixMeta, baseline, freshDir(`${screenId}-${variant}-probe`));
    const { results } = await runAssess({
      inventory: afterPath,
      screen: screenId,
      checks,
      viewport,
      out: freshDir(`${screenId}-${variant}-out`),
      extraArgs: ['--probe', probeFile],
    });
    return results;
  }
  return { baseline, runAfter };
}

test('contrast: before -> after (darkened) decides fixed', async () => {
  const { baseline, runAfter } = await runBaseline('contrast');
  const fixMeta = fixMetaFromBaseline(baseline, { rule: 'color-contrast', source: 'axe' });
  assert.ok(fixMeta.targets.length, 'baseline must have flagged color-contrast');
  const after = await runAfter(fixMeta);
  const result = decide({ fixMeta, configCheck: okConfigCheck(), baseline, after });
  assert.equal(result.status, 'fixed');
});

test('contrast: before -> before (unchanged) decides not fixed', async () => {
  const { baseline, runAfter } = await runBaseline('contrast');
  const fixMeta = fixMetaFromBaseline(baseline, { rule: 'color-contrast', source: 'axe' });
  const after = await runAfter(fixMeta, { variant: 'before' });
  const result = decide({ fixMeta, configCheck: okConfigCheck(), baseline, after });
  assert.equal(result.status, 'not fixed');
});

test('hashed: selector/class churn forces tier-3 (role+name) relocation, decides fixed', async () => {
  const { baseline, runAfter } = await runBaseline('hashed');
  const fixMeta = fixMetaFromBaseline(baseline, { rule: 'color-contrast', source: 'axe' });
  assert.ok(fixMeta.targets.length, 'baseline must have flagged color-contrast on the h2');
  const after = await runAfter(fixMeta);
  const result = decide({ fixMeta, configCheck: okConfigCheck(), baseline, after });
  assert.equal(result.status, 'fixed');
  const node = result.nodes.find((n) => n.relocation !== 'nodeless');
  assert.ok(node, 'expected at least one relocated node');
  assert.equal(node.via, 'role-name');
});

test('removed: the offending element is entirely gone -> confirmed-removed, decides fixed', async () => {
  const { baseline, runAfter } = await runBaseline('removed');
  const fixMeta = fixMetaFromBaseline(baseline, { rule: 'color-contrast', source: 'axe' });
  assert.ok(fixMeta.targets.length, 'baseline must have flagged the low-contrast link');
  const after = await runAfter(fixMeta);
  const result = decide({ fixMeta, configCheck: okConfigCheck(), baseline, after });
  assert.equal(result.nodes[0].relocation, 'confirmed-removed');
  assert.equal(result.status, 'fixed');
});

test('reflow: 320x640 context is forced regardless of configured viewport, decides fixed/not-fixed', async () => {
  const { baseline, runAfter } = await runBaseline('reflow', { checks: 'reflow' });
  const fixMeta = fixMetaFromBaseline(baseline, { rule: 'reflow-horizontal-scroll', source: 'reflow' });
  assert.ok(fixMeta.targets.length, 'baseline must have flagged the 500px-wide element at the forced 320px viewport');
  const after = await runAfter(fixMeta);
  const fixed = decide({ fixMeta, configCheck: okConfigCheck(), baseline, after });
  assert.equal(fixed.status, 'fixed');
  const unchanged = await runAfter(fixMeta, { variant: 'before' });
  const unchangedResult = decide({ fixMeta, configCheck: okConfigCheck(), baseline, after: unchanged });
  assert.equal(unchangedResult.status, 'not fixed');
});

test('reflow: dedup runs the check once per screen x state, not once per viewport', async () => {
  const base = loadTemplateInventory();
  const inv = withInventory(base, { baseUrl: server.url, screenUrls: { reflow: 'reflow.html?v=before' } });
  const invPath = writeInventory(inv, freshDir('reflow-dedup-inv'));
  const { results } = await runAssess({ inventory: invPath, screen: 'reflow', viewport: 'desktop,mobile', checks: 'reflow', out: freshDir('reflow-dedup-out') });
  assert.equal(results.targets.length, 2);
  const statuses = results.targets.map((t) => t.checks.reflow.status).sort();
  assert.deepEqual(statuses, ['ok', 'skipped']);
  const reflowFindings = results.findings.filter((f) => f.source === 'reflow');
  assert.equal(reflowFindings.length, 1, 'reflow should only be evaluated on the owning (first) viewport target');
});

test('text-spacing: clipped nodes keep selector/box/identity/crop from the spaced state and verify fixed', async () => {
  const { baseline, runAfter } = await runBaseline('spacing', { checks: 'text-spacing' });
  const f = baseline.findings.find((x) => x.rule === 'text-spacing-clipping');
  assert.ok(f, 'baseline must flag the fixed-height paragraph');
  const [n] = f.nodes;
  assert.equal(n.selector, '#label');
  assert.ok(n.box && n.box.height > 0, 'box captured while the override was applied');
  assert.equal(n.identity?.tag, 'p');
  assert.match(n.screenshot ?? '', /__s0-0\.png$/);
  const fixMeta = fixMetaFromBaseline(baseline, { rule: 'text-spacing-clipping', source: 'text-spacing', kind: 'review' });
  const after = await runAfter(fixMeta);
  const result = decide({ fixMeta, configCheck: okConfigCheck(), baseline, after });
  assert.equal(result.nodes[0].relocation, 'found');
  assert.equal(result.nodes[0].after, 'clear');
  assert.equal(result.status, 'needs review', 'review-kind issues still need an agent verdict');
});

test('regress: fixes the listed issue but introduces a new, unlisted failure -> decides regressed', async () => {
  const { baseline, runAfter } = await runBaseline('regress');
  const fixMeta = fixMetaFromBaseline(baseline, { rule: 'color-contrast', source: 'axe' });
  assert.ok(fixMeta.targets.length, 'baseline must have flagged the heading contrast');
  const after = await runAfter(fixMeta);
  const result = decide({ fixMeta, configCheck: okConfigCheck(), baseline, after });
  assert.equal(result.status, 'regressed');
  assert.ok(result.regressions.length >= 1);
  assert.ok(result.regressions.some((r) => r.rule === 'button-name'));
});

test('repeated: 5 identical buttons, one fixed -> per-node clear/flagged, overall not fixed', async () => {
  const { baseline, runAfter } = await runBaseline('repeated');
  const fixMeta = fixMetaFromBaseline(baseline, { rule: 'button-name', source: 'axe' });
  assert.ok(fixMeta.targets.length, 'baseline must have flagged all 5 unlabeled buttons');
  const baselineNodeCount = fixMeta.targets[0].nodes.length;
  assert.equal(baselineNodeCount, 5);
  const after = await runAfter(fixMeta);
  const result = decide({ fixMeta, configCheck: okConfigCheck(), baseline, after });
  assert.equal(result.status, 'not fixed', 'the rule is still flagged for 4 of the 5 buttons');
  // Adding aria-label changes the button's accessible name, so its OLD (unlabeled) identity
  // can no longer be found anywhere on the page - this is indistinguishable, from a pure
  // role+name/selector-relocation standpoint, from the element having been removed outright,
  // so decide() reports it as relocation:'confirmed-removed' / after:'removed' (counted as
  // fixed at the node level) rather than 'clear' (which is reserved for a still-findable node
  // whose issue cleared without an identity change, e.g. contrast/reflow fixes).
  const removed = result.nodes.filter((n) => n.after === 'removed');
  const flagged = result.nodes.filter((n) => n.after === 'flagged');
  assert.equal(removed.length, 1, 'exactly the one newly-labeled button should read removed (old identity gone)');
  assert.equal(removed[0].id, 'F0001#4', 'the labeled button (last in doc order) is the one that resolves cleanly');
  assert.equal(flagged.length, 4, 'the other 4 unlabeled buttons remain flagged');
});

test('keyboard: overlay initial focus is stop 0 with evidence; Tab leaving a menu is not "no focusable elements"; a popover that keeps focus outside is flagged for review', async () => {
  const inv = writeInventory(withInventory(loadTemplateInventory(), { baseUrl: server.url }), freshDir('overlay-inv'));
  const { results } = await runAssess({ inventory: inv, screen: 'overlay-menu,overlay-popover', checks: 'keyboard', viewport: 'desktop', out: freshDir('overlay-out') });
  const menu = results.targets.find((t) => t.key.startsWith('overlay-menu'));
  const [first] = menu.tabOrder;
  assert.equal(first.index, 0);
  assert.equal(first.initial, true);
  assert.match(first.selector, /mi-1/);
  assert.ok(first.box && first.box.width > 0);
  assert.match(first.screenshot ?? '', /__kinit0-0\.png$/);
  assert.match(menu.tabOrderNote, /Tab exits the overlay.*arrow-key navigation inside it was not measured/);
  assert.ok(menu.tabOrderShot, 'tab-order shot drawn even though Tab dismissed the menu');
  assert.ok(!results.findings.some((f) => f.target === menu.key && f.rule === 'initial-focus-outside-overlay'));
  const pop = results.targets.find((t) => t.key.startsWith('overlay-popover'));
  const flagged = results.findings.find((f) => f.target === pop.key && f.rule === 'initial-focus-outside-overlay');
  assert.equal(flagged?.kind, 'review');
  assert.deepEqual(flagged.wcag, ['2.4.3']);
});
