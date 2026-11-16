// Results contract + scope triage + report check: validateResults rules, blocked/not-attempted
// rendering, potentially-out-of-scope handling in report/fixes/summary, and the report gate.
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { freshDir, writeResults, pngBuffer, runReport, runFixes, runSummary } from './helpers.mjs';
import { validateResults, validateAgentFiles } from '../scripts/lib/results.mjs';
import { triageScope, mergeAgentInput } from '../scripts/lib/findings.mjs';
import { scopeSignalOf } from '../scripts/lib/evidence.mjs';

const tgt = (screen, extra = {}) => ({
  key: `${screen}__default__desktop`,
  feature: { id: 'f', name: 'F' },
  screen: { id: screen, name: screen },
  state: { id: 'default', name: 'Default' },
  viewport: { name: 'desktop', width: 1280, height: 800 },
  areas: [],
  ...extra,
});
const finding = (id, target, extra = {}) => ({ id, kind: 'failure', source: 'axe', rule: 'button-name', title: 'Buttons need names', impact: 'critical', wcag: ['4.1.2'], target, nodes: [{ selector: '#a' }], ...extra });

function run(overrides = {}) {
  return {
    app: { name: 'Demo', baseUrl: 'http://x/' },
    standard: 'WCAG 2.2 AA',
    level: 'AA',
    startedAt: '2026-01-01T00:00:00.000Z',
    engines: {},
    targets: [tgt('home')],
    coverage: ['2.4.1'],
    findings: [],
    ...overrides,
  };
}

function written(results) {
  const dir = freshDir('results');
  return { dir, results: writeResults(dir, results) };
}

test('validateResults: a complete run passes; each contract breach is named', () => {
  const { dir, results } = written(run({ findings: [finding('F0001', 'home__default__desktop')] }));
  assert.deepEqual(validateResults(results, { runDir: dir }).errors, []);

  const bad = structuredClone(results);
  bad.schemaVersion = 2;
  assert.match(validateResults(bad).errors[0], /schemaVersion/);

  const noInv = structuredClone(results);
  noInv.inventory.features[0].screens[0].states = [{ id: 'default' }];
  assert.match(validateResults(noInv).errors.join('\n'), /states must be an array of string ids/);

  const orphan = structuredClone(results);
  orphan.findings[0].target = 'nowhere__default__desktop';
  assert.match(validateResults(orphan).errors.join('\n'), /does not exist/);

  const wrongSize = structuredClone(results);
  wrongSize.targets[0].shot.width = 999;
  assert.match(validateResults(wrongSize, { runDir: dir }).errors.join('\n'), /PNG is 400x300/);

  const stray = structuredClone(results);
  stray.targets[0].areas = [{ kind: 'finding', box: { x: 0, y: 0, width: 5, height: 5 }, finding: 'F9999' }];
  assert.match(validateResults(stray).errors.join('\n'), /not a finding on this target/);
});

test('validateResults: located findings need an area or a disclosure; blocked targets name their blocker', () => {
  const { results } = written(run({ findings: [finding('F0001', 'home__default__desktop', { nodes: [{ selector: '#a', box: { x: 1, y: 1, width: 5, height: 5 } }] })] }));
  assert.match(validateResults(results).errors.join('\n'), /no area and no geometry\.findingsWithoutBox disclosure/);
  results.targets[0].geometry = { findingsWithoutBox: [{ finding: 'F0001', reason: 'offscreen' }], tabstopsWithoutBox: 0, scope: 'measured' };
  assert.deepEqual(validateResults(results).errors, []);

  const blocked = structuredClone(results);
  blocked.targets.push({ ...tgt('child'), status: 'blocked' });
  blocked.inventory.features[0].screens.push({ id: 'child', name: 'child', type: 'page', parent: 'home', states: ['default'] });
  assert.match(validateResults(blocked).errors.join('\n'), /blocked targets need blockedBy/);
  blocked.targets[1].blockedBy = 'home__default__desktop';
  blocked.targets[1].reason = 'parent screen failed';
  assert.deepEqual(validateResults(blocked).errors, []);
});

test('validateAgentFiles: agent findings must state their scope', () => {
  const noScope = validateAgentFiles({ agentFindings: [{ kind: 'failure', title: 'x' }] });
  assert.match(noScope.errors[0], /scope is required/);
  assert.deepEqual(validateAgentFiles({ agentFindings: [{ kind: 'failure', title: 'x', scope: 'potentially-out' }] }).errors, []);
  assert.match(validateAgentFiles({ annotations: { F1: { scope: 'maybe' } } }).errors[0], /scope must be one of/);
});

test('scope triage: agent decision wins; unreviewed out/unknown signals are held back', () => {
  assert.equal(scopeSignalOf([{ inScope: true }, { inScope: false }], '#main'), 'in');
  assert.equal(scopeSignalOf([{ inScope: false }], '#main'), 'out');
  assert.equal(scopeSignalOf([{ inScope: null }], '#main'), 'unknown');
  assert.equal(scopeSignalOf([], null), 'in');
  assert.deepEqual(triageScope({ scopeSignal: 'out' }), { scopeSignal: 'out', scope: 'potentially-out', scopeUnreviewed: true });
  assert.equal(triageScope({ scopeSignal: 'out', scope: 'in' }).scope, 'in');
  assert.equal(triageScope({ scopeSignal: 'unknown', scope: 'potentially-out' }).scopeUnreviewed, false);
  const merged = mergeAgentInput([{ id: 'F1', kind: 'failure', rule: 'r', scopeSignal: 'out' }], [], { F1: { scope: 'in' } });
  assert.equal(merged[0].scope, 'in');
});

test('report: partial run banner, blocked targets without pass badge, criteria not evaluated', async () => {
  const { dir } = written(run({
    inventory: { features: [{ id: 'f', name: 'F', screens: [
      { id: 'home', name: 'Home', type: 'page', parent: null, states: ['default'] },
      { id: 'child', name: 'Child', type: 'page', parent: 'home', states: ['default'] },
    ] }] },
    targets: [
      tgt('home', { status: 'error', error: 'navigation failed' }),
      tgt('child', { status: 'blocked', blockedBy: 'home__default__desktop', reason: 'parent screen was not reached' }),
    ],
  }));
  const r = await runReport(dir);
  assert.equal(r.code, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert.match(html, /id="partial-run"/);
  assert.match(html, /Blocked: parent screen was not reached/);
  assert.match(html, /Not evaluated \(partial run\)/);
  assert.doesNotMatch(html, /badge pass/);
});

test('report: geometry reasons explain issues that are not drawn', async () => {
  const f = finding('F0001', 'home__default__desktop', { nodes: [{ selector: '#a', box: { x: 1, y: 1, width: 5, height: 5 } }] });
  const { dir } = written(run({ findings: [f], targets: [tgt('home', { geometry: { findingsWithoutBox: [{ finding: 'F0001', reason: 'offscreen' }], tabstopsWithoutBox: 0, scope: 'measured' } })] }));
  const r = await runReport(dir);
  assert.equal(r.code, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'report.html'), 'utf8'), /1 issue not drawn: outside the screenshot/);
});

test('out of scope: held back from counts, listed separately, skipped by fixes, counted by summary', async () => {
  const { dir } = written(run({
    findings: [
      finding('F0001', 'home__default__desktop'),
      finding('F0002', 'home__default__desktop', { rule: 'image-alt', title: 'Images need alt', scopeSignal: 'out' }),
    ],
  }));
  const r = await runReport(dir);
  assert.equal(r.code, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert.match(html, /id="out-of-scope-note"/);
  assert.match(html, /id="out-of-scope"/);
  assert.match(html, /not yet reviewed by the agent/);
  assert.doesNotMatch(html, /href="#issues-axe-image-alt"/);

  const s = JSON.parse((await runSummary(dir, ['--json'])).stdout);
  assert.deepEqual(s.outOfScope, { total: 1, scopeUnreviewed: 1 });
  assert.equal(s.kinds.failure, 1);

  await runFixes(dir);
  assert.ok(!fs.readdirSync(dir).some((n) => /image-alt/.test(n)), 'out-of-scope rule gets no fix file');
  await runFixes(dir, ['--include-out-of-scope']);
  assert.ok(fs.readdirSync(dir).some((n) => /image-alt/.test(n)), '--include-out-of-scope opts back in');

  fs.writeFileSync(path.join(dir, 'annotations.json'), JSON.stringify({ F0002: { scope: 'in' } }));
  const after = JSON.parse((await runSummary(dir, ['--json'])).stdout);
  assert.deepEqual(after.outOfScope, { total: 0, scopeUnreviewed: 0 });
  assert.equal(after.kinds.failure, 2);
});

test('report: invalid results fail closed and write no report', async () => {
  const dir = freshDir('results-invalid');
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ targets: [], findings: [] }));
  const r = await runReport(dir);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /schemaVersion/);
  assert.ok(!fs.existsSync(path.join(dir, 'report.html')));
});

test('report check: a failing check keeps the previous report and records the problem', async () => {
  const { dir } = written(run());
  assert.equal((await runReport(dir)).code, 0);
  const before = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  const r = await runReport(dir, [], { env: { A11Y_REPORT_TEST_CORRUPT: '1' } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /previous report\.html was kept/);
  assert.equal(fs.readFileSync(path.join(dir, 'report.html'), 'utf8'), before);
  const check = JSON.parse(fs.readFileSync(path.join(dir, 'report-check.json'), 'utf8'));
  assert.equal(check.ok, false);
  assert.match(check.problems.join('\n'), /\[object Object\]/);
  assert.ok(!fs.existsSync(path.join(dir, 'report.tmp.html')));
});

test('report check: a screenshot that does not load is reported', async () => {
  const { dir } = written(run());
  fs.writeFileSync(path.join(dir, 'shots', 'home__default__desktop.png'), Buffer.concat([pngBuffer(400, 300).subarray(0, 40)]));
  const r = await runReport(dir);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /image did not load|not a PNG|PNG is/);
});
