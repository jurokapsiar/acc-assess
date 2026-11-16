// assess.mjs: `results.journeys` (User journeys report section data) - synthesized one per
// inventory screen with its own non-empty `steps` when there's no scope, or from a scope's
// journeys.json (titles + screen order) when one was used. Either way the actual per-step
// narrative/actionable data is read back from the already-assessed `target.steps[]` (built by
// `stepTrace()`), never re-parsed from journeys.json.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serveDir } from './serve.mjs';
import { FIXTURES_DIR, freshDir, loadTemplateInventory, withInventory, writeInventory, writeScopeFixture, runAssess } from './helpers.mjs';

let server;

before(async () => {
  server = await serveDir(FIXTURES_DIR);
});

after(async () => {
  await server.close();
});

test('assess.mjs: with no scope, one journey is synthesized per screen with its own inventory steps, ancestors included', async () => {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  const invPath = writeInventory(inv, freshDir('journeys-fallback-inv'));
  const out = freshDir('journeys-fallback-out');
  const { code, results } = await runAssess({ inventory: invPath, screen: 'host,host-dialog', checks: 'axe', out });
  assert.equal(code, 0);

  // target.steps[]: a structured record per plan step (device/action), parallel to `repro`.
  const dlgTarget = results.targets.find((t) => t.key === 'host-dialog__default__desktop');
  assert.ok(Array.isArray(dlgTarget.steps) && dlgTarget.steps.length, 'target.steps is populated');
  const clickStep = dlgTarget.steps.find((s) => s.action === 'click');
  assert.ok(clickStep, 'the click step that opens the dialog is recorded');
  assert.equal(clickStep.device, 'mouse');
  assert.equal(clickStep.actionable, true);
  const waitStep = dlgTarget.steps.find((s) => s.action === 'waitFor');
  assert.equal(waitStep.actionable, false, 'navigational steps are not actionable');

  // results.journeys: a "Host dialog" journey whose screen order includes the host-dialog's
  // own ancestor ("Host") before itself.
  const journey = results.journeys.find((j) => j.title === 'Host dialog');
  assert.ok(journey, 'a journey was synthesized for the host-dialog screen');
  assert.deepEqual(journey.screens.map((s) => s.name), ['Host fixture', 'Host dialog']);
  const dlgScreen = journey.screens.find((s) => s.name === 'Host dialog');
  assert.equal(dlgScreen.targetKey, 'host-dialog__default__desktop');
  assert.ok(dlgScreen.steps.some((s) => s.action === 'click'), 'the dialog screen carries its own click step, filtered by origin');
});

test('assess.mjs --scope: journeys.json drives titles/screen order; a scope-added screen with no declared steps still gets a journey entry', async () => {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  const invPath = writeInventory(inv, freshDir('journeys-scope-inv'));
  const out = freshDir('journeys-scope-out');
  const scopeDir = freshDir('journeys-scope-scope');
  const targets = ['scope-added__default__desktop', 'host-dialog__scope-state__desktop'];
  const scopePath = writeScopeFixture(scopeDir, { id: 'journeys-scope-test', targets });

  const { code, results } = await runAssess({ inventory: invPath, checks: 'axe', out, extraArgs: ['--scope', scopePath] });
  assert.equal(code, 0);
  assert.equal(results.journeys.length, 2);
  const titles = results.journeys.map((j) => j.title).sort();
  assert.deepEqual(titles, [
    'A brand-new page screen added purely by the scope overlay',
    'An extra state on an existing screen (no new steps needed)',
  ].sort());

  const added = results.journeys.find((j) => j.id === 'scope-added-journey');
  assert.equal(added.screens.length, 1);
  assert.equal(added.screens[0].name, 'Scope-added fixture');
  assert.equal(added.screens[0].targetKey, 'scope-added__default__desktop');
});

test('assess.mjs: no journeys at all (no scope, no screen declares its own steps) means results.journeys is an empty array', async () => {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  const invPath = writeInventory(inv, freshDir('journeys-empty-inv'));
  const out = freshDir('journeys-empty-out');
  const { code, results } = await runAssess({ inventory: invPath, screen: 'contrast', checks: 'axe', out });
  assert.equal(code, 0);
  assert.deepEqual(results.journeys, []);
});
