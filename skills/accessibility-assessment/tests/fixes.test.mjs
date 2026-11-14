// §9 "fixes.test": fixes.mjs's own CLI, fed a hand-built results.json (no browser/assess.mjs
// needed - fixes.mjs is a pure results.json -> markdown transform) - ready vs draft status,
// deterministic collision suffixes when two distinct rules slug to the same filename, a
// node-less (review-kind, no nodes[]) entry, and that the rendered Verify command/report link
// are relative to the run directory (the convention fixes.mjs/report.mjs/verify.mjs all share).
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { freshDir, runFixes, SKILL_DIR } from './helpers.mjs';

const TARGET = {
  key: 'demo__default__desktop',
  feature: { name: 'Demo' },
  screen: { name: 'Demo screen' },
  state: { name: 'default' },
  viewport: { name: 'desktop' },
  planHash: 'abc123',
};

function baseResults(findings) {
  return {
    config: { level: 'AA', checks: ['axe'], maxTabs: 20, viewports: {}, engines: { 'axe-core': '4.0.0' }, inventory: null, sourceRoot: null },
    targets: [TARGET],
    findings,
  };
}

function writeRun(dir, { findings, annotations }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(baseResults(findings), null, 2));
  if (annotations) fs.writeFileSync(path.join(dir, 'annotations.json'), JSON.stringify(annotations, null, 2));
  return dir;
}

test('fixes: an annotated+reviewed rule renders ready, an unannotated one renders draft', async () => {
  const dir = freshDir('fixes-ready-draft');
  const findings = [
    {
      id: 'F0001',
      kind: 'failure',
      source: 'abledom',
      rule: 'focus-trap',
      target: TARGET.key,
      impact: 'serious',
      wcag: ['2.4.3'],
      nodes: [{ selector: '.modal', html: '<div class="modal">', identity: { tag: 'div' }, screenshot: null }],
    },
    {
      id: 'F0002',
      kind: 'failure',
      source: 'abledom',
      rule: 'focus-lost',
      target: TARGET.key,
      impact: 'serious',
      wcag: ['2.4.3'],
      nodes: [{ selector: '.panel', html: '<div class="panel">', identity: { tag: 'div' }, screenshot: null }],
    },
  ];
  // "changes[].file" is resolved against the sourceRoot (cwd fixes.mjs runs from, i.e.
  // SKILL_DIR per helpers.mjs's spawnAsync) - point at a real fixture file so existingChanges
  // is non-empty and the reviewed rule actually qualifies as ready.
  const annotations = {
    'focus-trap': { reviewed: true, fix: 'Trap focus inside the modal.', changes: [{ file: 'tests/fixtures/contrast.html', line: 1, proposed: '<!doctype html>' }] },
  };
  writeRun(dir, { findings, annotations });
  const { code, stdout } = await runFixes(dir);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /1 ready, 1 draft/);

  const readyMd = fs.readFileSync(path.join(dir, 'fix-failure-abledom-focus-trap.md'), 'utf8');
  assert.match(readyMd, /\| Status \| ready \|/);
  const draftMd = fs.readFileSync(path.join(dir, 'fix-failure-abledom-focus-lost.md'), 'utf8');
  assert.match(draftMd, /\| Status \| draft \|/);
});

test('fixes: two rules that slug to the same filename both get a deterministic collision suffix', async () => {
  const dir = freshDir('fixes-collision');
  const findings = [
    { id: 'F0001', kind: 'failure', source: 'axe', rule: 'button-name!', target: TARGET.key, nodes: [{ selector: '#a', html: '<button id="a">', identity: { tag: 'button', role: 'button', name: 'A' }, screenshot: null }] },
    { id: 'F0002', kind: 'failure', source: 'axe', rule: 'button name', target: TARGET.key, nodes: [{ selector: '#b', html: '<button id="b">', identity: { tag: 'button', role: 'button', name: 'B' }, screenshot: null }] },
  ];
  writeRun(dir, { findings });
  const { code, stdout } = await runFixes(dir);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /2 draft/);
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('fix-failure-axe-button-name'));
  assert.equal(files.length, 2, 'both colliding rules get their own (suffixed) file, none overwrites the other');
  assert.ok(files.every((f) => /^fix-failure-axe-button-name-[0-9a-f]{6}\.md$/.test(f)), `expected both filenames suffixed, got: ${files.join(', ')}`);
  // Deterministic: re-running produces byte-identical filenames (not dependent on iteration order).
  const dir2 = freshDir('fixes-collision-rerun');
  writeRun(dir2, { findings: [findings[1], findings[0]] }); // reversed order
  await runFixes(dir2);
  const files2 = fs.readdirSync(dir2).filter((f) => f.startsWith('fix-failure-axe-button-name')).sort();
  assert.deepEqual(files2, [...files].sort());
});

test('fixes: a node-less (review, no nodes[]) finding gets a nodeless verify target entry', async () => {
  const dir = freshDir('fixes-nodeless');
  const findings = [{ id: 'R0001', kind: 'review', source: 'agent', rule: null, title: 'Confirm reading order manually', target: TARGET.key, wcag: ['1.3.2'] }];
  writeRun(dir, { findings });
  const { code } = await runFixes(dir);
  assert.equal(code, 0);
  const [file] = fs.readdirSync(dir).filter((f) => f.startsWith('fix-review-'));
  assert.ok(file, 'expected a fix-review-*.md file');
  const md = fs.readFileSync(path.join(dir, file), 'utf8');
  const block = md.match(/```json a11y-verify\n([\s\S]*?)\n```/)[1];
  const verify = JSON.parse(block);
  assert.equal(verify.targets.length, 1);
  assert.equal(verify.targets[0].nodes.length, 1);
  assert.equal(verify.targets[0].nodes[0].nodeless, true);
  assert.equal(verify.targets[0].nodes[0].id, 'R0001#-');
});

test('fixes: the Verify command and report.html link are relative to the run directory', async () => {
  const dir = freshDir('fixes-paths');
  const findings = [{ id: 'F0001', kind: 'failure', source: 'axe', rule: 'color-contrast', target: TARGET.key, wcag: ['1.4.3'], nodes: [{ selector: 'h2', html: '<h2>', identity: { tag: 'h2' }, screenshot: null }] }];
  writeRun(dir, { findings });
  await runFixes(dir);
  const [file] = fs.readdirSync(dir).filter((f) => f.startsWith('fix-failure-axe-color-contrast'));
  const md = fs.readFileSync(path.join(dir, file), 'utf8');
  // fixes.mjs renders the fix file's own path relative to `process.cwd()` (SKILL_DIR, see
  // spawnAsync) - since `dir` lives under tests/.out/, the run-relative verify command must
  // point back through that full relative path, not a bare filename.
  const relDir = path.relative(SKILL_DIR, dir).split(path.sep).join('/');
  const verifyAbs = path.join(SKILL_DIR, 'scripts', 'verify.mjs').split(path.sep).join('/');
  assert.ok(md.includes(`node "${verifyAbs}" "${relDir}/${file}"`), 'Verify command is runnable as written');
  assert.match(md, /\[report\.html#issues-[^\]]+\]\(report\.html#issues-[^)]+\)/);
});

test('fixes: a reviewed change with an out-of-range line stays draft and says why', async () => {
  const dir = freshDir('fixes-invalid-range');
  const findings = [{ id: 'F0001', kind: 'failure', source: 'axe', rule: 'button-name', target: TARGET.key, nodes: [{ selector: '#a', html: '<button id="a">', identity: { tag: 'button' }, screenshot: null }] }];
  writeRun(dir, { findings, annotations: { 'button-name': { reviewed: true, fix: 'Name it.', changes: [{ file: 'tests/fixtures/contrast.html', line: 9999, proposed: 'x' }] } } });
  const { stdout } = await runFixes(dir);
  assert.match(stdout, /0 ready, 1 draft/);
  assert.match(stdout, /change 1: "line" 9999 is past the end/);
  const md = fs.readFileSync(path.join(dir, 'fix-failure-axe-button-name.md'), 'utf8');
  assert.match(md, /\*\*Not ready:\*\* change 1: "line" 9999/);
});

test('fixes: a change that drops text an inventory step locates by is flagged with the affected targets', async () => {
  const dir = freshDir('fixes-plan-text');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'inventory.json'), JSON.stringify({
    app: { baseUrl: 'http://127.0.0.1:9/' },
    viewports: { desktop: { width: 1280, height: 800 } },
    features: [{ id: 'demo', name: 'Demo', screens: [{ id: 'demo', name: 'Demo screen', url: '/', steps: [{ action: 'waitFor', target: { role: 'heading', name: 'Save' } }, { action: 'click', target: { role: 'button', name: 'Save draft' } }] }] }],
  }));
  const src = path.join(dir, 'Toolbar.jsx');
  fs.writeFileSync(src, '<button>Save draft</button>\n');
  const findings = [{ id: 'F0001', kind: 'failure', source: 'axe', rule: 'label-content-name-mismatch', target: TARGET.key, nodes: [{ selector: 'button', html: '<button>', identity: { tag: 'button' }, screenshot: null }] }];
  writeRun(dir, { findings, annotations: { 'label-content-name-mismatch': { reviewed: true, changes: [{ file: path.relative(SKILL_DIR, src).split(path.sep).join('/'), line: 1, proposed: '<button>Store</button>' }] } } });
  const results = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
  results.config.inventory = { file: 'inventory.json', sha256: 'x' };
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results));
  const { stdout } = await runFixes(dir);
  assert.match(stdout, /1 ready, 0 draft/);
  assert.match(stdout, /changes text an inventory step uses \("Save draft"\)/, 'a shorter name contained in a longer string is not flagged');
  const md = fs.readFileSync(path.join(dir, 'fix-failure-axe-label-content-name-mismatch.md'), 'utf8');
  assert.match(md, /### Inventory steps[\s\S]*"Save draft": `demo__default__desktop`[\s\S]*--accept-plan-change/);
});

test('fixes: a full regeneration removes fix files it generated before that are no longer produced; partial runs keep them', async () => {
  const dir = freshDir('fixes-manifest');
  const mk = (id, rule) => ({ id, kind: 'failure', source: 'axe', rule, target: TARGET.key, nodes: [{ selector: '#' + rule, html: '<b>', identity: { tag: 'b' }, screenshot: null }] });
  writeRun(dir, { findings: [mk('F0001', 'region'), mk('F0002', 'list')] });
  await runFixes(dir);
  fs.writeFileSync(path.join(dir, 'fix-failure-axe-handwritten.md'), 'not ours');
  writeRun(dir, { findings: [mk('F0001', 'region')] });
  await runFixes(dir, ['--only', 'region']);
  assert.ok(fs.existsSync(path.join(dir, 'fix-failure-axe-list.md')), 'partial run keeps other files');
  const { stdout } = await runFixes(dir);
  assert.match(stdout, /removed stale: fix-failure-axe-list\.md/);
  assert.ok(!fs.existsSync(path.join(dir, 'fix-failure-axe-list.md')));
  assert.ok(fs.existsSync(path.join(dir, 'fix-failure-axe-handwritten.md')), 'files it never generated are left alone');
});

test('fixes: suggestion files are marked optional for conformance', async () => {
  const dir = freshDir('fixes-suggestion');
  writeRun(dir, { findings: [{ id: 'S0001', kind: 'suggestion', source: 'axe', rule: 'region', target: TARGET.key, nodes: [{ selector: 'div', html: '<div>', identity: { tag: 'div' }, screenshot: null }] }] });
  await runFixes(dir);
  const md = fs.readFileSync(path.join(dir, 'fix-suggestion-axe-region.md'), 'utf8');
  assert.match(md, /\| Conformance \| Optional; not required for WCAG AA conformance \|/);
});

test('fixes: one file per rule + component; changes go to the component they edit, unsourced nodes stay rule-only', async () => {
  const dir = freshDir('fixes-split');
  const node = (id, source) => ({ selector: '#' + id, html: `<button id="${id}" class="${id}">`, identity: { tag: 'button' }, screenshot: null, source });
  const findings = [{
    id: 'F0001', kind: 'failure', source: 'axe', rule: 'button-name', target: TARGET.key,
    nodes: [
      node('a', { file: 'tests/fixtures/contrast.html', line: 1, component: 'Toolbar' }),
      node('b', { file: 'lib/Button.jsx', line: 3, component: 'Button', chain: [{ file: 'lib/Button.jsx', line: 3, component: 'Button' }, { file: 'tests/fixtures/spacing.html', line: 2, component: 'Form' }] }),
      node('c', null),
    ],
  }];
  const changes = [
    { file: 'tests/fixtures/contrast.html', line: 1, proposed: '<!doctype html>' },
    { file: 'tests/fixtures/spacing.html', line: 1, proposed: '<!doctype html>' },
  ];
  writeRun(dir, { findings, annotations: { 'button-name': { reviewed: true, fix: 'Name it.', changes } } });
  const { stdout } = await runFixes(dir);
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('fix-')).sort();
  assert.deepEqual(files, ['fix-failure-axe-button-name--button.md', 'fix-failure-axe-button-name--contrast-toolbar.md', 'fix-failure-axe-button-name.md']);
  assert.match(stdout, /2 ready, 1 draft/);
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const toolbar = read('fix-failure-axe-button-name--contrast-toolbar.md');
  assert.match(toolbar, /"issue": "failure:axe:button-name@tests\/fixtures\/contrast.html#Toolbar"/);
  assert.match(toolbar, /contrast\.html:1-1/);
  assert.match(toolbar, /report\.html#issues-axe-button-name\)/, 'report link points at the rule group');
  assert.doesNotMatch(toolbar, /spacing\.html/);
  assert.match(read('fix-failure-axe-button-name--button.md'), /spacing\.html:1-1/, 'call-site change routed via the owner chain');
  const rest = read('fix-failure-axe-button-name.md');
  assert.match(rest, /"#c"/);
  assert.doesNotMatch(rest, /"#a"|"#b"/);
  assert.match(rest, /None of the annotated changes edits this component/);
});
