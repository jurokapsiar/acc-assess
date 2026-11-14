// Interaction modalities: key policy, guarded surface, and end-to-end keyboard replays.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decide } from '../scripts/lib/verify.mjs';
import { guardKey, guardSurface, validateKeys, ModalityViolation } from '../scripts/lib/modality.mjs';
import { planHash } from '../scripts/lib/inventory.mjs';
import { stepTrace } from '../scripts/lib/steps.mjs';
import { serveDir } from './serve.mjs';
import { FIXTURES_DIR, freshDir, loadTemplateInventory, withInventory, writeInventory, runAssess, runReport, runFixes } from './helpers.mjs';

let server;
before(async () => { server = await serveDir(FIXTURES_DIR); });
after(async () => { await server.close(); });

test('key policy is purpose based: only the core keys navigate or activate', () => {
  for (const k of ['Tab', 'Shift+Tab', 'ArrowDown', 'Enter', 'Space', ' ']) assert.equal(guardKey('keyboard', k, 'navigate').allowed, true, k);
  for (const k of ['Home', 'End', 'PageDown', 'F6']) {
    assert.equal(guardKey('keyboard', k, 'navigate').allowed, false, k);
    assert.equal(guardKey('keyboard', k, 'activate').allowed, false, k);
  }
  assert.equal(guardKey('keyboard', 'Escape', 'dismiss').allowed, true);
  assert.equal(guardKey('keyboard', 'Escape', 'navigate').allowed, false);
  assert.equal(guardKey('keyboard', 'Insert+Down', 'reader').allowed, false, 'plain keyboard has no reader commands');
  assert.equal(guardKey('mouse', 'Home', 'navigate').allowed, true, 'mouse modality has no key policy');
  assert.match(validateKeys(['Tab', 'Home']), /Home/);
  assert.equal(validateKeys(['Tab', 'Enter']), null);
});

test('guarded surface blocks pointer/focus/script calls outside a rescue, wraps locators, allows keyboard', async () => {
  const calls = [];
  const loc = { click: () => calls.push('click'), focus: () => calls.push('focus'), count: () => 1 };
  const raw = { locator: () => loc, getByRole: () => loc, keyboard: { press: (k) => calls.push(`press ${k}`) }, mouse: { click: () => calls.push('mouse') }, evaluate: () => calls.push('evaluate') };
  const ctl = { rescue: false };
  const page = guardSurface(raw, ctl);
  await page.keyboard.press('Tab');
  assert.throws(() => page.locator('x').click(), ModalityViolation);
  assert.throws(() => page.getByRole('button').first?.().focus?.() ?? page.getByRole('button').focus(), ModalityViolation);
  assert.throws(() => page.mouse.click(), ModalityViolation);
  assert.throws(() => page.evaluate(() => 1), ModalityViolation);
  assert.equal(page.locator('x').count(), 1, 'observation-only methods pass through');
  ctl.rescue = true;
  page.locator('x').click();
  assert.deepEqual(calls, ['press Tab', 'click']);
});

test('policy-only step fields never change the legacy planHash', () => {
  const t = (extra) => ({ plan: [{ action: 'click', target: { role: 'button', name: 'X' }, ...extra }], viewport: { width: 1, height: 1 }, state: {}, screen: {} });
  assert.equal(planHash(t({})), planHash(t({ modalities: ['keyboard'], intent: 'activate', keys: ['Enter'], journey: 'j1', segment: 's', skipReason: 'r', rec: { x: 1 } })));
});

test('stepTrace labels focus steps as programmatic, not keyboard', () => {
  assert.equal(stepTrace({ action: 'focus', target: { role: 'button', name: 'X' } }).device, 'programmatic');
});

function modalityInventory(steps) {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  inv.features = [{ id: 'm', name: 'Modality', screens: Object.entries(steps).map(([id, st]) => ({ id, name: id, type: 'page', url: 'modality.html', scope: '#scope', steps: st })) }];
  return writeInventory(inv, freshDir('modality-inv'));
}
const click = (name, role = 'button') => ({ action: 'click', target: { role, name } });

async function run(steps, extra = []) {
  const out = freshDir('modality-out');
  return runAssess({ inventory: modalityInventory(steps), viewport: 'desktop', checks: 'axe', out, extraArgs: ['--modality', 'keyboard', ...extra], expectFailure: true });
}

test('keyboard modality: a native button is operated with the keyboard alone (no findings, exit 0)', async () => {
  const { code, results } = await run({ ok: [click('Save changes')] });
  assert.equal(code, 0);
  const mod = results.findings.filter((f) => f.source === 'modality');
  assert.deepEqual(mod, []);
  assert.equal(results.targets[0].modalityRuns[0].status, 'complete');
  assert.deepEqual(results.modalities, ['keyboard']);
});

test('keyboard modality: an unfocusable clickable element is a failure with repro, screenshot and fix, and exit 2 is not used for a finding', async () => {
  const { results } = await run({ mouse: [{ action: 'click', target: { text: 'Open details' } }] });
  const f = results.findings.find((x) => x.source === 'modality');
  assert.equal(f.rule, 'kbd-not-focusable');
  assert.equal(f.kind, 'failure');
  assert.equal(f.modality, 'keyboard');
  assert.ok(f.fix && f.nodes[0].screenshot && f.repro.some((r) => /keyboard only/.test(r)));
  assert.ok(f.wcag.includes('2.1.1'));
});

test('keyboard modality: a focusable-only-by-script control is kbd-programmatic-focus', async () => {
  const { results } = await run({ script: [click('Extra options')] });
  assert.equal(results.findings.find((x) => x.source === 'modality')?.rule, 'kbd-programmatic-focus');
});

test('keyboard modality: Enter/Space doing nothing while a click works is kbd-no-activation', async () => {
  const { results } = await run({ dead: [click('Press only with pointer')] });
  assert.equal(results.findings.find((x) => x.source === 'modality')?.rule, 'kbd-no-activation');
});

test('--no-escalate never uses the pointer or script: the result is inconclusive (exit 2), not a failure', async () => {
  const { code, results } = await run({ mouse: [{ action: 'click', target: { text: 'Open details' } }] }, ['--no-escalate']);
  assert.equal(code, 2);
  const f = results.findings.find((x) => x.source === 'modality');
  assert.equal(f.kind, 'review');
});

test('a low --max-presses is inconclusive (review), never a failure', async () => {
  const { code, results } = await run({ far: [{ action: 'click', target: { role: 'link', name: 'Last link' } }] }, ['--max-presses', '2']);
  assert.equal(code, 2);
  assert.equal(results.findings.find((x) => x.source === 'modality')?.rule, 'kbd-search-inconclusive');
});

test('sr-* modalities are a usage error for assess.mjs (exit 3)', async () => {
  const out = freshDir('modality-usage');
  const r = await runAssess({ inventory: modalityInventory({ ok: [] }), checks: 'axe', out, extraArgs: ['--modality', 'sr-keyboard'], expectFailure: true });
  assert.equal(r.code, 3);
});

test('without --modality nothing changes: no modality runs, no modality findings', async () => {
  const out = freshDir('modality-legacy');
  const { results } = await runAssess({ inventory: modalityInventory({ ok: [click('Save changes')] }), viewport: 'desktop', checks: 'axe', out });
  assert.equal(results.modalities.length, 0);
  assert.equal(results.targets[0].modalityRuns, undefined);
});

test('report and fix file carry the modality: badge, modality section, step, repro and a verify block with modality', async () => {
  const { runDir } = await run({ mouse: [{ action: 'click', target: { text: 'Open details' } }] });
  const rep = await runReport(runDir);
  assert.equal(rep.code, 0, rep.stderr);
  const html = fs.readFileSync(path.join(runDir, 'report.html'), 'utf8');
  assert.match(html, /Keyboard only/);
  assert.match(html, /id="modalities"/);
  const fx = await runFixes(runDir);
  assert.equal(fx.code, 0, fx.stderr);
  const file = fs.readdirSync(runDir).find((n) => /^fix-.*kbd-not-focusable.*\.md$/.test(n));
  assert.ok(file, 'a fix file exists for the modality rule');
  const md = fs.readFileSync(path.join(runDir, file), 'utf8');
  assert.match(md, /"modality": "keyboard"/);
});

test('verify evidence: a modality finding is unverified unless the original step ran under the same modality', () => {
  const node = { id: 'F0001#0', modality: 'keyboard', stepIndex: 0, selector: '#x' };
  const fixMeta = { issue: 'I1', source: 'modality', rule: 'kbd-not-focusable', kind: 'failure', config: { checks: [] }, targets: [{ key: 't', nodes: [node] }] };
  const base = { targets: [{ key: 't', status: 'ok', checks: { modality: { status: 'ok' } } }], findings: [] };
  const run = (steps, status = 'complete') => decide({ fixMeta, configCheck: { ok: true, warnings: [] }, baseline: base, after: { targets: [{ key: 't', status: 'ok', checks: { modality: { status: 'ok' } }, modalityRuns: [{ modality: 'keyboard', status, steps }] }], findings: [] }, checks: [] });
  assert.equal(run([{ index: 0, outcome: 'skipped' }]).status, 'unverified');
  assert.equal(run([]).status, 'unverified');
  assert.equal(run([{ index: 0, outcome: 'ok' }], 'partial').status, 'unverified');
  assert.equal(run([{ index: 0, outcome: 'ok' }]).status, 'fixed');
});
