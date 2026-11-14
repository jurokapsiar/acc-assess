// End-to-end with the mock driver: serve the fixture app, replay both journeys, analyse, report.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { serveDir, setupApp, runSr, readJson, FIXTURES_DIR } from './helpers.mjs';

let server;
let app;
let runDir;
let first;

before(async () => {
  server = await serveDir(path.join(FIXTURES_DIR, 'app'));
  app = setupApp('e2e', server.url);
  runDir = path.join(app.appRoot, 'run');
  first = await runSr(['run', '--scope', app.scopeFile, '--app-root', app.appRoot, '--reader', 'mock', '--out', runDir]);
});
after(async () => server?.close());

test('mock run replays every journey and writes results, report and screenshots', () => {
  // Exit 2: secret-flow is blocked (a sensitive field is refused), so the run is incomplete.
  assert.equal(first.code, 2, first.stderr + first.stdout);
  const r = readJson(path.join(runDir, 'results.json'));
  assert.equal(r.reader.name, 'mock');
  assert.equal(r.simulated, true);
  assert.deepEqual(r.journeys.map((j) => [j.id, j.status]), [['broken-flow', 'complete'], ['good-flow', 'complete'], ['secret-flow', 'blocked']]);
  assert.match(r.journeys[2].error, /Refused/);
  for (const s of r.journeys.flatMap((j) => j.steps).filter((x) => x.ok)) {
    assert.ok(s.action && s.description, 'action recorded');
    assert.ok(Array.isArray(s.narration) && typeof s.before === 'string', 'narration recorded');
    assert.equal(s.capture?.health, 'simulated');
    assert.ok(fs.existsSync(path.join(runDir, s.screenshot)), s.screenshot);
  }
  const clicks = r.journeys.flatMap((j) => j.steps).filter((s) => s.action === 'click');
  assert.ok(clicks.length && clicks.every((s) => ['left', 'right'].includes(s.button)));
  const right = clicks.find((s) => s.button === 'right');
  assert.ok(right, 'right-click step recorded');
  assert.ok([...right.narration, ...(right.late ?? [])].some((p) => p.includes('Share options opened')), right.narration.join(' | '));
  assert.ok(r.journeys[0].steps.some((s) => s.action === 'press' && s.key === 'Tab'));
  assert.ok(r.env?.os && r.env.node && r.env.browser, 'environment recorded');
  assert.ok(Array.isArray(r.cleanupErrors));
});

test('typed values and sensitive fields never reach results or report', () => {
  for (const file of ['results.json', 'sr-report.html']) {
    const text = fs.readFileSync(path.join(runDir, file), 'utf8');
    assert.ok(!text.includes('Zebra-Sentinel-4242'), `${file}: typed value leaked`);
    assert.ok(!text.includes('Hunter2-Sentinel-9999'), `${file}: secret leaked`);
  }
});

test('broken patterns are found and the well-built flow is clean', () => {
  const r = readJson(path.join(runDir, 'results.json'));
  const broken = new Set(r.findings.filter((f) => f.target.startsWith('broken-flow#')).map((f) => f.rule));
  for (const rule of ['sr-control-without-name', 'sr-missing-role', 'sr-missing-state', 'sr-symbol-noise', 'sr-focus-not-in-dialog', 'sr-focus-not-returned', 'sr-status-not-announced', 'sr-error-not-announced']) {
    assert.ok(broken.has(rule), rule);
  }
  const probes = new Set(r.findings.filter((f) => /^p\d+$/.test(f.target)).map((f) => f.rule));
  for (const rule of ['sr-no-landmarks', 'sr-no-headings', 'sr-reading-order']) assert.ok(probes.has(rule), rule);
  assert.deepEqual(r.findings.filter((f) => f.target.startsWith('good-flow#')), []);
  for (const f of r.findings) {
    assert.equal(f.source, 'screen-reader');
    assert.ok(f.wcag.length && f.repro.length && f.nodes.length && f.evidence, f.rule);
  }
});

test('report has summary, session log with screenshot dialogs, and issues below', () => {
  const html = fs.readFileSync(path.join(runDir, 'sr-report.html'), 'utf8');
  const at = (id) => html.indexOf(`id="${id}"`);
  assert.ok(at('summary') > 0 && at('summary') < at('journeys') && at('journeys') < at('issues'));
  assert.match(html, /Session log/);
  assert.match(html, /<dialog/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /simulated narration/i);
  assert.match(html, /class="sr-warn"/);
  assert.match(html, /incomplete/i);
  assert.ok(!html.includes('[object Object]'));
});

test('analyse and report commands rebuild from results.json', async () => {
  const file = path.join(runDir, 'results.json');
  const before = readJson(file).findings.length;
  fs.rmSync(path.join(runDir, 'sr-report.html'));
  const a = await runSr(['analyse', runDir]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(readJson(file).findings.length, before);
  const rep = await runSr(['report', runDir]);
  assert.equal(rep.code, 0, rep.stderr);
  assert.ok(fs.existsSync(path.join(runDir, 'sr-report.html')));
});

test('--journey filters, unknown journeys are rejected', async () => {
  const out = path.join(app.appRoot, 'run-good');
  const good = await runSr(['run', '--scope', app.scopeFile, '--app-root', app.appRoot, '--reader', 'mock', '--journey', 'good-flow', '--out', out]);
  assert.equal(good.code, 0, good.stderr);
  const r = readJson(path.join(out, 'results.json'));
  assert.deepEqual(r.journeys.map((j) => j.id), ['good-flow']);
  assert.ok(!r.findings.some((f) => f.target.startsWith('good-flow#')));
  const bad = await runSr(['run', '--scope', app.scopeFile, '--app-root', app.appRoot, '--reader', 'mock', '--journey', 'nope', '--out', path.join(app.appRoot, 'run-bad')]);
  assert.equal(bad.code, 1);
});

test('--modality sr-keyboard replays keyboard-only, records modality evidence; sr-* only; unknown rejected', async () => {
  const out = path.join(app.appRoot, 'run-kbd');
  const r1 = await runSr(['run', '--scope', app.scopeFile, '--app-root', app.appRoot, '--reader', 'mock', '--journey', 'good-flow', '--modality', 'sr-keyboard', '--out', out]);
  assert.ok([0, 2].includes(r1.code), r1.stderr + r1.stdout);
  const r = readJson(path.join(out, 'results.json'));
  assert.equal(r.schemaVersion, 2);
  assert.ok(r.journeys.length && r.journeys.every((j) => j.modality === 'sr-keyboard' && j.key.endsWith('~sr-keyboard')));
  const steps = r.journeys.flatMap((j) => j.steps);
  assert.ok(steps.every((s) => s.modality === 'sr-keyboard' && s.via === 'keyboard' || s.via?.startsWith('escalation')));
  assert.ok(fs.existsSync(path.join(out, 'sr-report.html')));
  const mouse = await runSr(['run', '--scope', app.scopeFile, '--app-root', app.appRoot, '--reader', 'mock', '--modality', 'mouse', '--out', path.join(app.appRoot, 'run-m')]);
  assert.equal(mouse.code, 3);
});

test('usage errors exit 3: unknown reader, missing --storage-state file', async () => {
  const reader = await runSr(['run', '--scope', app.scopeFile, '--app-root', app.appRoot, '--reader', 'jaws']);
  assert.equal(reader.code, 3);
  const state = await runSr(['run', '--scope', app.scopeFile, '--app-root', app.appRoot, '--reader', 'mock', '--storage-state', path.join(app.appRoot, 'missing.json'), '--out', path.join(app.appRoot, 'run-state')]);
  assert.equal(state.code, 3);
  assert.match(state.stderr, /storage/i);
});
