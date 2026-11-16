// Replay plans from scope-definition outputs: viewports, required feature states, usage errors,
// and the redaction / input-labelling helpers used by the session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadContext, buildJourneyPlans, parseModalities } from '../scripts/lib/journeys.mjs';
import { makeRedactor, inputOf } from '../scripts/lib/session.mjs';
import { setupApp } from './helpers.mjs';

async function ctxWith(journeys, { features = [] } = {}) {
  const app = setupApp('plan', 'http://fixture.test/');
  const ctx = await loadContext({ scopeFile: app.scopeFile, appRoot: app.appRoot });
  ctx.journeysDoc = { schemaVersion: 1, journeys };
  ctx.inv.features.push(...features);
  return ctx;
}

const journey = (o = {}) => ({ id: 'j', title: 'J', feature: { id: 'shop' }, start: { screen: 'home' }, segments: [], ...o });

test('every declared viewport becomes its own run with a distinct key; --viewport narrows', async () => {
  const ctx = await ctxWith([journey({ viewports: ['desktop', 'mobile'] })]);
  const plans = await buildJourneyPlans(ctx);
  assert.deepEqual(plans.map((p) => [p.key, p.viewport.width]), [['j@desktop', 1280], ['j@mobile', 375]]);
  const one = await buildJourneyPlans(ctx, { viewportName: 'mobile' });
  assert.deepEqual(one.map((p) => p.key), ['j']);
});

test('modalities multiply the plans; only sr-* modalities are accepted', async () => {
  const ctx = await ctxWith([journey({ modalities: ['sr-keyboard', 'sr-navigation'] }), journey({ id: 'k' })]);
  const plans = await buildJourneyPlans(ctx);
  assert.deepEqual(plans.map((p) => [p.key, p.modality]), [['j~sr-keyboard', 'sr-keyboard'], ['j~sr-navigation', 'sr-navigation'], ['k', 'unspecified']]);
  const only = await buildJourneyPlans(ctx, { modalities: parseModalities('sr-navigation') });
  assert.deepEqual(only.map((p) => p.key), ['j~sr-navigation', 'k~sr-navigation']);
  assert.throws(() => parseModalities('mouse'), (e) => e.usage === true);
  assert.deepEqual(parseModalities('all'), ['sr-keyboard', 'sr-navigation']);
});

test('required feature states are applied before the segment; unknown refs block the journey', async () => {
  const theme = { id: 'theme', name: 'Theme', screens: [], states: [{ id: 'dark', name: 'Dark', emulate: { colorScheme: 'dark' }, steps: [{ action: 'click', target: { selector: '#dark' } }] }] };
  const seg = (requires) => ({ kind: 'state', screen: 'home', state: { id: 's', name: 'S', requires }, steps: [{ action: 'press', key: 'Tab' }] });
  const ctx = await ctxWith([journey({ segments: [seg(['theme.dark'])] }), journey({ id: 'k', segments: [seg(['theme.nope'])] })], { features: [theme] });
  const [ok, bad] = await buildJourneyPlans(ctx);
  const actions = ok.plan.map((s) => s.action);
  assert.ok(actions.indexOf('emulate') < actions.indexOf('press'));
  assert.ok(actions.indexOf('click') < actions.indexOf('press'));
  assert.equal(ok.blocked, null);
  assert.match(ok.notes.join(' '), /theme\.dark/);
  assert.match(bad.blocked, /theme\.nope/);
});

test('a screen segment waits for the screen\'s ready target', async () => {
  const ctx = await ctxWith([journey({ segments: [{ kind: 'screen', screen: { id: 'home', ready: { selector: '#open' } }, steps: [] }] })]);
  const [p] = await buildJourneyPlans(ctx);
  assert.deepEqual(p.plan.at(-1), { action: 'waitFor', target: { selector: '#open' }, origin: 'Home', settle: 0 });
});

test('a scope storageState that does not exist is a usage error (never an anonymous fallback)', async () => {
  const app = setupApp('plan-state', 'http://fixture.test/');
  const scope = JSON.parse(fs.readFileSync(app.scopeFile, 'utf8'));
  scope.storageState = 'missing-auth.json';
  fs.writeFileSync(app.scopeFile, JSON.stringify(scope));
  const err = await loadContext({ scopeFile: app.scopeFile, appRoot: app.appRoot }).catch((e) => e);
  assert.ok(err instanceof Error && err.usage, String(err));
  const ctx = await loadContext({ scopeFile: app.scopeFile, appRoot: app.appRoot, storageOverride: path.join(app.appRoot, 'x.json') });
  assert.equal(ctx.storageState, null);
});

test('typed values are redacted everywhere, including URL-encoded forms', () => {
  const redact = makeRedactor([{ plan: [{ action: 'fill', value: 'Zebra Sentinel' }, { action: 'fill', value: 'ab' }] }]);
  const out = redact({ a: ['typed Zebra Sentinel'], url: 'http://x/?q=Zebra+Sentinel&r=Zebra%20Sentinel', n: 3, short: 'ab' });
  assert.deepEqual(out, { a: ['typed [redacted]'], url: 'http://x/?q=[redacted]&r=[redacted]', n: 3, short: 'ab' });
});

test('inputs are labelled honestly: mouse button, programmatic operations, OS vs CDP keys', () => {
  assert.equal(inputOf({ action: 'click', button: 'right' }).input, 'mouse (right button) click');
  assert.equal(inputOf({ action: 'click' }).input, 'mouse (left button) click');
  assert.match(inputOf({ action: 'fill' }).input, /programmatic/);
  assert.deepEqual(inputOf({ action: 'press', key: 'Tab' }, true).via, 'screen-reader');
  const cdp = inputOf({ action: 'press', key: 'Tab', times: 2 }, false).input;
  assert.match(cdp, /×2/);
  assert.match(cdp, /CDP/);
});
