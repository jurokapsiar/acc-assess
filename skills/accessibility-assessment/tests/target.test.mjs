// §9 "target.test": `--target` behaviour against the real assess.mjs CLI - a single valid
// mobile-only key resolves correctly, and a valid+invalid key mix exits 1 with nothing run
// (no browser launch at all, since resolveTargets's UNKNOWN_TARGETS check runs before
// `chromium.launch()` - this makes both cases fast).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serveDir } from './serve.mjs';
import { FIXTURES_DIR, freshDir, loadTemplateInventory, withInventory, writeInventory, runAssess } from './helpers.mjs';

let server;
let inventoryPath;

before(async () => {
  server = await serveDir(FIXTURES_DIR);
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  inventoryPath = writeInventory(inv, freshDir('target-inv'));
});

after(async () => {
  await server.close();
});

test('target: a single mobile-only target key resolves and runs', async () => {
  const out = freshDir('target-mobile');
  const { code, results } = await runAssess({ inventory: inventoryPath, target: 'contrast__default__mobile', checks: 'axe', out });
  assert.equal(code, 0);
  assert.equal(results.targets.length, 1);
  assert.equal(results.targets[0].key, 'contrast__default__mobile');
  assert.equal(results.targets[0].viewport.name, 'mobile');
});

test('target: a mix of valid and invalid keys exits 1 and runs nothing', async () => {
  const out = freshDir('target-mixed');
  const { code, stderr, runDir } = await runAssess({
    inventory: inventoryPath,
    target: 'contrast__default__mobile,does-not-exist__default__mobile',
    checks: 'axe',
    out,
    expectFailure: true,
  });
  assert.equal(code, 1);
  assert.match(stderr, /does-not-exist__default__mobile/);
  assert.equal(runDir, null, 'no run directory should have been created');
});

test('target: --bail stops starting targets after one is unreachable', async () => {
  const inv = withInventory(loadTemplateInventory(), { baseUrl: server.url });
  for (const f of inv.features) for (const s of f.screens) if (s.id === 'contrast') s.steps = [{ action: 'evaluate', script: 'throw new Error("unreachable")' }];
  const invPath = writeInventory(inv, freshDir('target-bail-inv'));
  const { results, stdout } = await runAssess({ inventory: invPath, screen: 'contrast', viewport: 'desktop,mobile', checks: 'axe', out: freshDir('target-bail'), extraArgs: ['--bail', '--workers', '1'] });
  assert.equal(results.targets.length, 2);
  assert.equal(results.targets[0].status, 'error');
  assert.equal(results.targets[1].status, 'not-attempted');
  assert.match(results.targets[1].reason, /--bail/);
  assert.match(stdout, /stopped after an unreachable target; 1 target\(s\) not run/);
});
