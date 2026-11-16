// summary.mjs: read-only run overview (counts, failed criteria, top issues, fix files) with
// --rule/--screen filters and --json output, fed a hand-built run folder.
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { freshDir, writeResults, runFixes, runSummary } from './helpers.mjs';

const target = (screen) => ({ key: `${screen}__default__desktop`, status: 'ok', feature: { name: 'F' }, screen: { id: screen, name: screen }, state: { name: 'Default' }, viewport: { name: 'desktop' }, planHash: 'h' });
const node = (id, file) => ({ selector: '#' + id, html: `<button id="${id}" class="${id}">`, identity: { tag: 'button' }, screenshot: null, source: file ? { file, line: 4 } : null });

test('summary: counts, failed criteria, top issues with example source, fix files; filters and --json', async () => {
  const dir = freshDir('summary');
  const results = {
    app: { name: 'Demo', baseUrl: 'http://x/' },
    standard: 'WCAG 2.2 AA',
    config: { level: 'AA', checks: ['axe'], engines: { 'axe-core': '4.0.0' }, viewports: {} },
    targets: [target('home'), target('settings')],
    findings: [
      { id: 'F1', kind: 'failure', source: 'axe', rule: 'button-name', title: 'Buttons need names', impact: 'critical', wcag: ['4.1.2'], target: 'home__default__desktop', nodes: [node('a', 'src/Toolbar.jsx'), node('b')] },
      { id: 'F2', kind: 'failure', source: 'axe', rule: 'button-name', title: 'Buttons need names', impact: 'critical', wcag: ['4.1.2'], target: 'settings__default__desktop', nodes: [node('c')] },
      { id: 'F3', kind: 'suggestion', source: 'axe', rule: 'region', wcag: [], target: 'home__default__desktop', nodes: [node('d')] },
      { id: 'F4', kind: 'review', source: 'axe', rule: 'color-contrast', wcag: ['1.4.3'], target: 'home__default__desktop', nodes: [node('e')] },
    ],
  };
  writeResults(dir, results);
  fs.writeFileSync(path.join(dir, 'annotations.json'), JSON.stringify({ region: { kind: 'dismissed' } }));
  await runFixes(dir);

  const text = await runSummary(dir);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /targets: 2\/2 reached/);
  assert.match(text.stdout, /3 failure · 1 review · 0 suggestion · 1 dismissed/);
  assert.match(text.stdout, /4\.1\.2.*: 3/);
  assert.match(text.stdout, /\[failure\] button-name · critical · 4\.1\.2 · 3 element\(s\) on 2 target\(s\)[\s\S]*e\.g\. src\/Toolbar\.jsx:4/);
  assert.match(text.stdout, /draft {2}fix-failure-axe-button-name--toolbar\.md/);

  const { stdout } = await runSummary(dir, ['--screen', 'settings', '--rule', 'button-name', '--json']);
  const s = JSON.parse(stdout);
  assert.deepEqual(s.kinds, { failure: 1, review: 0, suggestion: 0 });
  assert.deepEqual(Object.keys(s.byTarget), ['settings__default__desktop']);
  assert.deepEqual(s.failedCriteria.map((c) => c.sc), ['4.1.2']);
  assert.deepEqual(s.fixFiles.map((f) => f.file), ['fix-failure-axe-button-name.md'], 'only fix files touching the screen');
});
