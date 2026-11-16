// scope-skill-spec §17 items 9, 10, 11, 15 (integration: drives the real `scope.mjs` CLI as a
// subprocess against the sibling's fixture server - this skill has no fixtures of its own).
import { test, before, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serveDir } from './helpers.mjs';
import { runIntent, SIBLING_FIXTURES_DIR, freshDir, loadTemplateInventory, withInventory, writeInventory, runScope, sessionJsonPath, scopeJsonPath, readJson } from './helpers.mjs';

let server;

before(async () => {
  server = await serveDir(SIBLING_FIXTURES_DIR);
});

afterAll(async () => {
  await server.close();
});

function setupApp(name) {
  const appRoot = freshDir(name);
  // The fixture server has no "/" index, so point baseUrl at an existing fixture file (still a
  // valid base for every other sibling fixture's relative url, since they're all flat files in
  // the same directory) - this keeps preflight's reachability probe meaningful without needing
  // to touch the sibling's fixture server.
  const inv = withInventory(loadTemplateInventory(), { baseUrl: `${server.url}host.html` });
  const a11yDir = path.join(appRoot, '.a11y');
  writeInventory(inv, a11yDir);
  return appRoot;
}

async function run(appRoot, command, flags) {
  const r = await runScope(command, flags, { appRoot });
  if (r.code !== 0) throw new Error(`scope.mjs ${command} ${flags.join(' ')} exited ${r.code}:\n${r.stdout}\n${r.stderr}`);
  return r;
}

async function intent(appRoot, id, prompt, overrides) {
  const session = readJson(sessionJsonPath(appRoot, id));
  const r = await runIntent(appRoot, id, prompt ?? session.prompt, overrides);
  if (r.code !== 0) throw new Error(`intent exited ${r.code}:\n${r.stdout}\n${r.stderr}`);
  return r;
}

// ------------------------------------------------------------------ intent is agent-authored

test('intent: without --from it exits 3 (the agent must interpret the prompt); --template prints a skeleton', async () => {
  const appRoot = setupApp('cli-intent-required');
  await run(appRoot, 'init', ['--prompt', 'check the no screen readers case', '--inventory', '.a11y/inventory.json', '--id', 's1']);
  await run(appRoot, 'preflight', ['--session', 's1']);
  const r = await runScope('intent', ['--session', 's1'], { appRoot });
  assert.equal(r.code, 3);
  const t = await run(appRoot, 'intent', ['--session', 's1', '--template']);
  assert.equal(JSON.parse(t.stdout).prompt, 'check the no screen readers case');
});

// ------------------------------------------------------------------ item 9: full pipeline, a dialog screen + a new state, two viewports

test('full pipeline: init -> preflight -> intent -> ground -> step (reuse a screen, add a new state) -> propose -> confirm -> verify, 2 viewports', async () => {
  const appRoot = setupApp('cli-full-pipeline');
  const init = await run(appRoot, 'init', ['--prompt', 'open the example dialog, close it, and check the dialog-open state, on mobile and desktop', '--inventory', '.a11y/inventory.json', '--id', 'demo-session']);
  assert.match(init.stdout, /Created session "demo-session"/);

  await run(appRoot, 'preflight', ['--session', 'demo-session']);
  await intent(appRoot, 'demo-session', 'open the example dialog, close it, and check the dialog-open state, on mobile and desktop', { viewports: ['mobile', 'desktop'] });
  await run(appRoot, 'ground', ['--session', 'demo-session', '--no-source']);

  // Journey 1: revisit the existing "host" screen, then the existing "host-dialog" overlay
  // screen (the inventory already knows how to reach it) as a pivot to attach a brand-new
  // STATE ("closed") whose steps close the dialog again - a bare "screen" segment that just
  // revisits an existing id carries no steps of its own (spec §7.2: it only exists "to add
  // states to it"), so the close action belongs on a state segment, not the revisit itself.
  await run(appRoot, 'step', ['--session', 'demo-session', '--journey', 'open-and-close-dialog', '--feature', 'demo', '--checkpoint', 'screen', '--id', 'host']);
  await run(appRoot, 'step', ['--session', 'demo-session', '--journey', 'open-and-close-dialog', '--checkpoint', 'screen', '--id', 'host-dialog']);
  await run(appRoot, 'step', [
    '--session', 'demo-session', '--journey', 'open-and-close-dialog',
    '--checkpoint', 'state', '--screen', 'host-dialog', '--id', 'closed', '--name', 'Dialog closed',
  ]);
  await run(appRoot, 'step', [
    '--session', 'demo-session', '--journey', 'open-and-close-dialog',
    '--action', 'click', '--target', JSON.stringify({ role: 'button', name: 'Close' }),
    '--evidence', 'inventory:host-dialog',
  ]);

  // Journey 2: a brand-new STATE on the existing "host" screen (not a new screen) - exercises
  // the state-checkpoint path end to end.
  await run(appRoot, 'step', [
    '--session', 'demo-session', '--journey', 'dialog-open-state', '--feature', 'demo',
    '--checkpoint', 'state', '--screen', 'host', '--id', 'dialog-open', '--name', 'Dialog open',
  ]);
  await run(appRoot, 'step', [
    '--session', 'demo-session', '--journey', 'dialog-open-state',
    '--action', 'click', '--target', JSON.stringify({ role: 'button', name: 'Open dialog' }),
    '--evidence', 'inventory:host',
  ]);

  const propose = await run(appRoot, 'propose', ['--session', 'demo-session']);
  assert.match(propose.stdout, /host__default__desktop/);
  assert.match(propose.stdout, /host-dialog__default__desktop/);
  assert.match(propose.stdout, /host-dialog__closed__desktop/);
  assert.match(propose.stdout, /host__dialog-open__desktop/);

  const session = readJson(sessionJsonPath(appRoot, 'demo-session'));
  assert.equal(session.phase, 'proposed');
  const scopeFile = path.join(appRoot, session.scopeFile);
  let scope = readJson(scopeFile);
  assert.equal(scope.status, 'proposed');
  assert.equal(scope.approval, null);

  await run(appRoot, 'confirm', ['--session', 'demo-session', '--approved-by', 'integration-test']);
  scope = readJson(scopeFile);
  assert.equal(scope.status, 'confirmed');
  assert.equal(scope.approval.by, 'integration-test');

  const verify = await runScope('verify', ['--scope', scopeFile, '--viewport', 'desktop,mobile'], { appRoot });
  assert.equal(verify.code, 0, verify.stdout + verify.stderr);
  assert.match(verify.stdout, /8\/8 verified/);
  scope = readJson(scopeFile);
  assert.equal(scope.status, 'verified');
  for (const key of Object.keys(scope.verification.results)) {
    assert.equal(scope.verification.results[key].status, 'verified', key);
  }
  // No stale target-based "unresolved" entries should remain after a fully successful verify.
  assert.deepEqual((scope.unresolved ?? []).filter((u) => u.target), []);
});

// ------------------------------------------------------------------ item 10: ambiguity

test('verify: a step target that matches more than one element on the page is reported "ambiguous"', async () => {
  const appRoot = setupApp('cli-ambiguous');
  await run(appRoot, 'init', ['--prompt', 'play one of the tracks', '--inventory', '.a11y/inventory.json', '--id', 's1']);
  await run(appRoot, 'preflight', ['--session', 's1']);
  await intent(appRoot, 's1');
  await run(appRoot, 'ground', ['--session', 's1', '--no-source']);
  await run(appRoot, 'step', ['--session', 's1', '--journey', 'play-track', '--feature', 'demo', '--checkpoint', 'screen', '--id', 'repeated']);
  // The action belongs on a new STATE attached to the existing "repeated" screen (a bare
  // screen-revisit segment carries no steps of its own, see the full-pipeline test above).
  // Five identical unlabeled buttons on the "repeated" fixture - no --nth, so this is
  // deliberately ambiguous.
  await run(appRoot, 'step', ['--session', 's1', '--journey', 'play-track', '--checkpoint', 'state', '--screen', 'repeated', '--id', 'tap-track', '--name', 'Tap a track']);
  await run(appRoot, 'step', [
    '--session', 's1', '--journey', 'play-track',
    '--action', 'click', '--target', JSON.stringify({ role: 'button' }),
    '--evidence', 'inventory:repeated',
  ]);
  await run(appRoot, 'propose', ['--session', 's1']);
  const session = readJson(sessionJsonPath(appRoot, 's1'));
  const scopeFile = path.join(appRoot, session.scopeFile);
  await run(appRoot, 'confirm', ['--session', 's1', '--approved-by', 'integration-test']);

  const verify = await runScope('verify', ['--scope', scopeFile, '--viewport', 'desktop'], { appRoot });
  assert.equal(verify.code, 2);
  assert.match(verify.stdout, /ambiguous/);
  const scope = readJson(scopeFile);
  assert.equal(scope.status, 'partial');
  assert.equal(scope.verification.results['repeated__default__desktop'].status, 'verified', 'the unaffected screen target is unaffected');
  assert.equal(scope.verification.results['repeated__tap-track__desktop'].status, 'ambiguous');
});

// ------------------------------------------------------------------ item 11: unreachable

test('verify: a step whose target never appears is reported "unreachable", overall status "partial", exit code 2', async () => {
  const appRoot = setupApp('cli-unreachable');
  await run(appRoot, 'init', ['--prompt', 'click a button that does not exist', '--inventory', '.a11y/inventory.json', '--id', 's1']);
  await run(appRoot, 'preflight', ['--session', 's1']);
  await intent(appRoot, 's1');
  await run(appRoot, 'ground', ['--session', 's1', '--no-source']);
  await run(appRoot, 'step', ['--session', 's1', '--journey', 'phantom', '--feature', 'demo', '--checkpoint', 'screen', '--id', 'host']);
  await run(appRoot, 'step', ['--session', 's1', '--journey', 'phantom', '--checkpoint', 'state', '--screen', 'host', '--id', 'phantom-click', '--name', 'Phantom click']);
  await run(appRoot, 'step', [
    '--session', 's1', '--journey', 'phantom',
    '--action', 'click', '--target', JSON.stringify({ role: 'button', name: 'Does Not Exist Anywhere' }),
    '--evidence', 'inventory:host',
  ]);
  await run(appRoot, 'propose', ['--session', 's1']);
  const session = readJson(sessionJsonPath(appRoot, 's1'));
  const scopeFile = path.join(appRoot, session.scopeFile);
  await run(appRoot, 'confirm', ['--session', 's1', '--approved-by', 'integration-test']);

  const verify = await runScope('verify', ['--scope', scopeFile, '--viewport', 'desktop'], { appRoot });
  assert.equal(verify.code, 2);
  assert.match(verify.stdout, /unreachable/);
  const scope = readJson(scopeFile);
  assert.equal(scope.status, 'partial');
  assert.equal(scope.verification.results['host__default__desktop'].status, 'verified');
  assert.equal(scope.verification.results['host__phantom-click__desktop'].status, 'unreachable');
}, { timeout: 30000 });

// ------------------------------------------------------------------ item 15: safety refusals

test('explore --url: refuses a goto that navigates outside the app origin, and writes nothing', async () => {
  const appRoot = setupApp('cli-safety-origin');
  await run(appRoot, 'init', ['--prompt', 'look around', '--inventory', '.a11y/inventory.json', '--id', 's1']);
  await run(appRoot, 'preflight', ['--session', 's1']);
  await intent(appRoot, 's1');
  await run(appRoot, 'ground', ['--session', 's1', '--no-source']);

  const before = fs.existsSync(path.join(appRoot, '.a11y', 'scopes', 's1', 'work', 'snapshots')) ? fs.readdirSync(path.join(appRoot, '.a11y', 'scopes', 's1', 'work', 'snapshots')) : [];
  const r = await runScope('explore', ['--session', 's1', '--url', 'http://example.invalid/'], { appRoot });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /outside the app origin/);
  const after = fs.existsSync(path.join(appRoot, '.a11y', 'scopes', 's1', 'work', 'snapshots')) ? fs.readdirSync(path.join(appRoot, '.a11y', 'scopes', 's1', 'work', 'snapshots')) : [];
  assert.deepEqual(after, before, 'a refused explore must not write any new snapshot/screenshot files');
});

test('explore --url --steps: refuses a step whose target matches a forbidden destructive verb', async () => {
  const appRoot = setupApp('cli-safety-forbidden');
  await run(appRoot, 'init', ['--prompt', 'look around, but do not delete anything', '--inventory', '.a11y/inventory.json', '--id', 's1']);
  await run(appRoot, 'preflight', ['--session', 's1']);
  await intent(appRoot, 's1');
  await run(appRoot, 'ground', ['--session', 's1', '--no-source']);

  const stepsFile = path.join(appRoot, 'forbidden-steps.json');
  fs.writeFileSync(stepsFile, JSON.stringify([{ action: 'click', target: { role: 'button', name: 'Delete account' } }]));
  const r = await runScope('explore', ['--session', 's1', '--url', 'host.html', '--steps', stepsFile], { appRoot });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /forbidden/);
});
