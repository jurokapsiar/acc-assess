// scope-definition spec §17, items 5-6 (AA, unit) and 12-14 (AA, integration): the shared
// `lib/scope.mjs` overlay (owned by this skill) plus `assess.mjs --scope`/`verify.mjs`
// forwarding/run-dir collision fix. Fixtures: tests/fixtures/scope/journeys.json (a new page
// screen appended to the "demo" feature, and a new state appended to the existing
// "host-dialog" screen) applied against tests/fixtures/inventory.json.
import { test, before, after as afterAll } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serveDir } from './serve.mjs';
import { loadInventory, resolveTargets, planHash } from '../scripts/lib/inventory.mjs';
import { loadScope, applyScope, compileJourneys, scopeDigest } from '../scripts/lib/scope.mjs';
import { FIXTURES_DIR, freshDir, loadTemplateInventory, withInventory, writeInventory, writeScopeFixture, runAssess, runFixes, runVerify } from './helpers.mjs';

let server;

before(async () => {
  server = await serveDir(FIXTURES_DIR);
});

afterAll(async () => {
  await server.close();
});

function journeysDoc() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'scope', 'journeys.json'), 'utf8'));
}

// ------------------------------------------------------------------ unit: compileJourneys / applyScope (AA 5, 6)

test('compileJourneys: strips rec so a journey with and without rec compiles identically', () => {
  const withRec = journeysDoc();
  const withoutRec = structuredClone(withRec);
  for (const j of withoutRec.journeys) for (const seg of j.segments) seg.steps = (seg.steps ?? []).map(({ rec, ...st }) => st);
  assert.deepEqual(compileJourneys(withRec), compileJourneys(withoutRec));
});

test('compileJourneys: a "screen" segment appends a new screen, a "state" segment appends a state to an existing screen by id', () => {
  const overlay = compileJourneys(journeysDoc());
  const demo = overlay.features.find((f) => f.id === 'demo');
  assert.ok(demo, 'overlay has a "demo" feature');
  const added = demo.screens.find((s) => s.id === 'scope-added');
  assert.ok(added, 'overlay has the new "scope-added" screen');
  assert.equal(added.url, 'contrast.html');
  const hostDialog = demo.screens.find((s) => s.id === 'host-dialog');
  assert.ok(hostDialog, 'overlay references the existing "host-dialog" screen to add a state');
  assert.equal(hostDialog.states?.[0]?.id, 'scope-state');
  assert.equal(hostDialog.states[0].steps[0].rec, undefined, 'rec must not survive into the compiled overlay');
});

test('applyScope: appends a new screen and a new state without mutating the original inventory', () => {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  const scope = { journeys: 'journeys.json', __file: path.join(FIXTURES_DIR, 'scope', 'scope.json') };
  const { inv: merged, conflicts } = applyScope(inv, scope);
  assert.deepEqual(conflicts, []);
  assert.equal(inv.features.flatMap((f) => f.screens).some((s) => s.id === 'scope-added'), false, 'original inventory is untouched');
  const demo = merged.features.find((f) => f.id === 'demo');
  assert.ok(demo.screens.some((s) => s.id === 'scope-added'));
  const hostDialog = demo.screens.find((s) => s.id === 'host-dialog');
  assert.ok(hostDialog.states.some((s) => s.id === 'scope-state'));
});

test('applyScope: re-applying the same overlay to the already-merged inventory is a no-op (deep-equal, no conflicts)', () => {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  const scope = { journeys: 'journeys.json', __file: path.join(FIXTURES_DIR, 'scope', 'scope.json') };
  const once = applyScope(inv, scope).inv;
  const { inv: twice, conflicts } = applyScope(once, scope);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(twice, once);
});

test('applyScope: a different definition for an existing id is a conflict, with nothing mutated for that entity', () => {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  const conflictingDoc = journeysDoc();
  // Change the appended screen's scope selector so it collides with the inventory's own
  // "scope-added" entry once that's already been merged in.
  const merged = applyScope(inv, { journeys: 'journeys.json', __file: path.join(FIXTURES_DIR, 'scope', 'scope.json') }).inv;
  conflictingDoc.journeys[0].segments[0].screen.scope = '#not-the-real-scope';
  const dir = freshDir('scope-conflict');
  fs.writeFileSync(path.join(dir, 'journeys.json'), JSON.stringify(conflictingDoc));
  const result = applyScope(merged, { journeys: 'journeys.json', __file: path.join(dir, 'scope.json') });
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0], /scope-added/);
  const addedAfter = result.inv.features.find((f) => f.id === 'demo').screens.find((s) => s.id === 'scope-added');
  assert.equal(addedAfter.scope, '#scope', 'the original field is left unchanged on conflict');
});

test('applyScope + resolveTargets + planHash: the overlay target resolves the same plan shape as an equivalent inventory screen, and rec never affects planHash', () => {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  const scope = { journeys: 'journeys.json', __file: path.join(FIXTURES_DIR, 'scope', 'scope.json') };
  const { inv: merged } = applyScope(inv, scope);
  const [overlayTarget] = resolveTargets(merged, { targets: ['scope-added__default__desktop'] });
  const [contrastTarget] = resolveTargets(merged, { targets: ['contrast__default__desktop'] });
  // Same url/scope as the "contrast" fixture screen -> same plan shape (goto only, no ready).
  assert.deepEqual(overlayTarget.plan, contrastTarget.plan.map((st) => ({ ...st })));

  // rec is stripped before planHash is ever computed from it, so a hand-edited copy of the
  // journeys file that removes `rec` (recorder provenance) must hash identically.
  const withoutRecDir = freshDir('scope-norec');
  const doc = journeysDoc();
  for (const j of doc.journeys) for (const seg of j.segments) seg.steps = (seg.steps ?? []).map(({ rec, ...st }) => st);
  fs.writeFileSync(path.join(withoutRecDir, 'journeys.json'), JSON.stringify(doc));
  const mergedNoRec = applyScope(inv, { journeys: 'journeys.json', __file: path.join(withoutRecDir, 'scope.json') }).inv;
  const [hostTarget] = resolveTargets(merged, { targets: ['host-dialog__scope-state__desktop'] });
  const [hostTargetNoRec] = resolveTargets(mergedNoRec, { targets: ['host-dialog__scope-state__desktop'] });
  assert.equal(planHash(hostTarget), planHash(hostTargetNoRec));
});

// ------------------------------------------------------------------ integration: assess.mjs --scope (AA 12)

test('assess.mjs --scope: runs exactly scope.targets and records results.scope', async () => {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  const invPath = writeInventory(inv, freshDir('scope-assess-inv'));
  const out = freshDir('scope-assess-out');
  const scopeDir = freshDir('scope-assess-scope');
  const targets = ['scope-added__default__desktop', 'host-dialog__scope-state__desktop'];
  const scopePath = writeScopeFixture(scopeDir, { id: 'scope-assess-test', targets });

  const { code, results } = await runAssess({ inventory: invPath, checks: 'axe', out, extraArgs: ['--scope', scopePath] });
  assert.equal(code, 0);
  assert.deepEqual(results.targets.map((t) => t.key).sort(), targets.slice().sort());
  assert.ok(results.scope, 'results.scope must be set');
  assert.equal(results.scope.id, 'scope-assess-test');
  assert.equal(results.selection.scope, 'scope-assess-test');
  assert.equal(typeof results.scope.sha256, 'string');
});

test('assess.mjs --scope: an unknown target key in scope.targets exits 1 and runs nothing', async () => {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  const invPath = writeInventory(inv, freshDir('scope-assess-bad-inv'));
  const out = freshDir('scope-assess-bad-out');
  const scopeDir = freshDir('scope-assess-bad-scope');
  const scopePath = writeScopeFixture(scopeDir, { id: 'scope-bad', targets: ['does-not-exist__default__desktop'] });

  const { code, stderr, runDir } = await runAssess({ inventory: invPath, checks: 'axe', out, extraArgs: ['--scope', scopePath], expectFailure: true });
  assert.equal(code, 1);
  assert.match(stderr, /does-not-exist__default__desktop/);
  assert.equal(runDir, null, 'no run directory should have been created');
});

// ------------------------------------------------------------------ integration: verify.mjs forwarding (AA 13)

test('verify.mjs: forwards the baseline scope to the subprocess, and a deleted scope file is unverified', async () => {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  const invPath = writeInventory(inv, freshDir('scope-verify-inv'));
  const out = freshDir('scope-verify-out');
  const scopeDir = freshDir('scope-verify-scope');
  const scopePath = writeScopeFixture(scopeDir, { id: 'scope-verify-test', targets: ['scope-added__default__desktop'] });

  const { results, runDir } = await runAssess({ inventory: invPath, checks: 'axe', out, extraArgs: ['--scope', scopePath] });
  assert.ok(results.scope);
  assert.ok((results.findings ?? []).length > 0, 'the reused contrast.html fixture should still fail contrast');

  const fixesResult = await runFixes(runDir);
  assert.equal(fixesResult.code, 0, fixesResult.stderr);
  const fixFile = fs.readdirSync(runDir).find((f) => /^fix-.*\.md$/.test(f));
  assert.ok(fixFile, 'fixes.mjs should have generated at least one fix-*.md');
  const fixFilePath = path.join(runDir, fixFile);

  const verified = await runVerify([fixFilePath]);
  // Nothing was actually fixed in the app, so the real decision is "not fixed" - what matters
  // here is that the subprocess ran at all (a scope forwarding bug would instead surface as
  // "unverified" because the affected --target key wouldn't resolve without the overlay).
  assert.match(verified.stdout, /^(fixed|not fixed)\s/);
  const fixReport = JSON.parse(fs.readFileSync(path.join(runDir, 'fix-report.json'), 'utf8'));
  assert.ok(fixReport.attempts.at(-1).run, 'the verify subprocess must have produced a run (proves --scope resolved the target)');

  // Now delete the scope file the baseline points to: re-verifying must report "unverified"
  // with the "scope file not found" reason, never a silent fallback to the bare inventory.
  fs.rmSync(scopePath, { force: true });
  const afterDelete = await runVerify([fixFilePath]);
  assert.match(afterDelete.stdout, /^unverified/);
  const fixReportAfter = JSON.parse(fs.readFileSync(path.join(runDir, 'fix-report.json'), 'utf8'));
  assert.equal(fixReportAfter.attempts.at(-1).status, 'unverified');
  assert.match(fixReportAfter.attempts.at(-1).reason, /scope file not found/);
});

// ------------------------------------------------------------------ integration: run-dir collision (AA 14)

test('assess.mjs: two processes started together claim two distinct run directories', async () => {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  const invPath = writeInventory(inv, freshDir('scope-collision-inv'));
  const out = freshDir('scope-collision-out');
  const [a, b] = await Promise.all([
    runAssess({ inventory: invPath, screen: 'contrast', checks: 'axe', out }),
    runAssess({ inventory: invPath, screen: 'repeated', checks: 'axe', out }),
  ]);
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  const runDirOf = (r) => r.stdout.match(/→\s*(.+?)[\\/]report\.html\s*$/m)?.[1]?.trim();
  const dirA = runDirOf(a);
  const dirB = runDirOf(b);
  assert.ok(dirA && dirB, 'both runs must report a run directory');
  assert.notEqual(dirA, dirB, 'each concurrent run must claim its own run directory');
  const dirs = fs.readdirSync(out, { withFileTypes: true }).filter((d) => d.isDirectory());
  assert.equal(dirs.length, 2);
});
