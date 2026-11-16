// --setup / --cdp (browser extension point, isolation disclosure) and steps.jsonl evidence.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDir } from './serve.mjs';
import { assertLoopback } from '../scripts/lib/browser-setup.mjs';
import { probeFocus } from '../scripts/lib/steps-log.mjs';
import { FIXTURES_DIR, freshDir, loadTemplateInventory, withInventory, writeInventory, runAssess } from './helpers.mjs';

const MODULES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'setup-modules');
let server;
let inventoryPath;

before(async () => {
  server = await serveDir(FIXTURES_DIR);
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  inventoryPath = writeInventory(inv, freshDir('setup-inv'));
});

after(async () => {
  await server.close();
});

const base = (extra) => ({ inventory: inventoryPath, target: 'contrast__default__desktop', checks: 'axe', out: freshDir('setup-out'), extraArgs: extra });

test('--cdp accepts only loopback endpoints', () => {
  assert.equal(assertLoopback('http://127.0.0.1:9222'), 'http://127.0.0.1:9222');
  assert.equal(assertLoopback('ws://localhost:9222/devtools/browser/x'), 'ws://localhost:9222/devtools/browser/x');
  assert.throws(() => assertLoopback('http://example.com:9222'), /loopback/);
  assert.throws(() => assertLoopback('file:///tmp/x'), /protocol/);
});

test('--cdp with a non-loopback endpoint is rejected before any run', async () => {
  const r = await runAssess({ ...base(['--cdp', 'http://example.com:9222']), expectFailure: true });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /loopback/);
  assert.equal(r.runDir && r.results, null);
});

test('--setup newContext hook is used, target reaches ready, execution is recorded', async () => {
  const { results, runDir } = await runAssess(base(['--setup', path.join(MODULES, 'header.mjs')]));
  assert.equal(results.targets[0].status, 'ok');
  assert.deepEqual(results.execution, { isolation: 'fresh-context', setupModule: 'header.mjs', cdp: false, interventions: [] });
  assert.ok(fs.existsSync(path.join(runDir, 'report.html')));
});

test('a non-fresh setup and its interventions are disclosed in results and the report banner', async () => {
  const { results, runDir } = await runAssess(base(['--setup', path.join(MODULES, 'reused.mjs')]));
  assert.equal(results.execution.isolation, 'reused-page');
  assert.equal(results.execution.interventions[0].kind, 'setup-click');
  assert.equal(results.targets[0].interventions[0].reason, 'dismissed a startup banner');
  const html = fs.readFileSync(path.join(runDir, 'report.html'), 'utf8');
  assert.match(html, /id="isolation-note"/);
  assert.match(html, /dismissed a startup banner/);
});

test('--setup together with --storage-state is rejected when the module provides newContext', async () => {
  const r = await runAssess({ ...base(['--setup', path.join(MODULES, 'header.mjs'), '--storage-state', inventoryPath]), expectFailure: true });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /newContext/);
});

test('verify decide: a non-fresh after-run can never be "fixed"', async () => {
  const { decide } = await import('../scripts/lib/verify.mjs');
  const fixMeta = { issue: 'F0001', rule: 'x', source: 'axe', kind: 'failure', targets: [{ key: 't', nodes: [] }] };
  const run = { targets: [{ key: 't', status: 'ok', probes: [] }], findings: [], execution: { isolation: 'reused-page', interventions: [] } };
  const r = decide({ fixMeta, configCheck: { ok: true, warnings: [] }, baseline: { targets: [{ key: 't', status: 'ok' }], findings: [] }, after: run, checks: [] });
  assert.notEqual(r.status, 'fixed');
});

test('modality runs append steps.jsonl with one flushed line per action', async () => {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  inv.features = [{ id: 'm', name: 'M', screens: [{ id: 'ok', name: 'ok', type: 'page', url: 'modality.html', scope: '#scope', steps: [{ action: 'click', target: { role: 'button', name: 'Save changes' } }] }] }];
  const { runDir, results } = await runAssess({ inventory: writeInventory(inv, freshDir('steps-inv')), viewport: 'desktop', checks: 'axe', out: freshDir('steps-out'), extraArgs: ['--modality', 'keyboard'], expectFailure: true });
  const lines = fs.readFileSync(path.join(runDir, 'steps.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.length >= 1);
  for (const k of ['ts', 'target', 'step', 'pageUrl', 'focused', 'outcome']) assert.ok(k in lines[0], `missing ${k}`);
  assert.equal(results.targets[0].stepsLog, 'steps.jsonl');
});

test('probeFocus never waits past its timeout and reports focus-timeout', async () => {
  const hung = { evaluate: () => new Promise(() => {}) };
  const t0 = Date.now();
  const r = await probeFocus(hung, 150);
  assert.equal(r.outcome, 'focus-timeout');
  assert.equal(r.focused, 'none');
  assert.ok(Date.now() - t0 < 1000);
});
