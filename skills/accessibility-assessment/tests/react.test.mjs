// §9 "react.test.mjs": source.file:line exact match against the fixture's real JSX lines,
// chain populated for a nested/library-like usage, and tier-2 (source+ordinal) relocation
// across a `.map()`-rendered list that shares one JSX call site (requires real source.file:line
// data, which only a framework resolver - not static HTML - ever produces).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { serveDir } from './serve.mjs';
import { buildReactFixture, FIXTURES_DIR } from './helpers.mjs';
import { resolveSources } from '../scripts/lib/source.mjs';
import { applyProbes } from '../scripts/lib/evidence.mjs';

const REACT_FIXTURE_DIR = path.join(FIXTURES_DIR, 'react');

let browser;
let server;

before(async () => {
  await buildReactFixture();
  server = await serveDir(REACT_FIXTURE_DIR);
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  await server.close();
});

test('react: host element + owner chain resolve to exact fixture JSX lines', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${server.url}index.html?v=before`);
    await page.waitForSelector('.tab-btn');

    const nodes = [{ selector: '.tab-btn' }, { selector: '#react-title' }];
    await resolveSources(page, nodes, { root: REACT_FIXTURE_DIR, attrs: [], cache: new Map() });

    const [tabBtn, title] = nodes;
    assert.equal(tabBtn.source.via, 'react-owner-stack');
    assert.equal(tabBtn.source.file, 'App.jsx');
    assert.equal(tabBtn.source.line, 6); // `<button className="tab-btn">{label}</button>;` inside TabButton
    assert.ok(Array.isArray(tabBtn.source.chain) && tabBtn.source.chain.length >= 3, 'owner chain should include TabButton, Tabs and App');
    const byComponent = Object.fromEntries(tabBtn.source.chain.map((c) => [c.component, c]));
    assert.equal(byComponent.TabButton.file, 'App.jsx');
    assert.equal(byComponent.TabButton.line, 13); // `<TabButton key={item.id} label={item.label} />` inside Tabs
    assert.equal(byComponent.Tabs.file, 'App.jsx');
    assert.equal(byComponent.Tabs.line, 41); // `<Tabs items={...} />` inside App
    assert.equal(byComponent.App.file, 'entry.jsx');

    assert.equal(title.source.file, 'App.jsx');
    assert.equal(title.source.line, 40); // `<h2 id="react-title">React fixture</h2>`
  } finally {
    await page.close();
  }
});

test('react: tier-2 source+ordinal relocation finds each item of a .map()-rendered list', async () => {
  const page = await browser.newPage();
  try {
    // Baseline (`?v=before`): capture identity/source for all 5 repeated icon buttons, all of
    // which share the exact same JSX call site (App.jsx's RepeatedList), disambiguated only by
    // `ordinal`/`count` - tier 1 (selector) can't apply (no stable per-item selector) and tier
    // 3 (role+name) can't apply (every baseline name is empty), so a correct `found/source`
    // relocation here can only come from real tier-2 source+ordinal matching.
    await page.goto(`${server.url}index.html?v=before`);
    await page.waitForSelector('#repeated-list button');
    const buttons = await page.$$('#repeated-list button');
    assert.equal(buttons.length, 5);
    const probes = [];
    for (let i = 0; i < buttons.length; i++) {
      const sel = `#repeated-list li:nth-child(${i + 1}) button`;
      const nodes = [{ selector: sel }];
      await resolveSources(page, nodes, { root: REACT_FIXTURE_DIR, attrs: [], cache: new Map() });
      assert.equal(nodes[0].source.file, 'App.jsx');
      assert.equal(nodes[0].source.line, 27, `button ${i} should resolve to the shared RepeatedList JSX line`);
      probes.push({
        id: `p${i}`,
        target: 'react-app__default__desktop',
        phase: 'main',
        selector: null, // force past tier 1 straight to tier 2 (source+ordinal)
        identity: { tag: 'button', role: 'button', name: '', ordinal: i, count: 5 },
        source: { file: nodes[0].source.file, line: nodes[0].source.line },
        box: null,
      });
    }

    // After (`?v=after`): same 5 buttons, same structure, but button #3 gains an aria-label -
    // a real "fix" was applied to one occurrence without changing anything tier 1/3 could use
    // to find the OTHER four (their name is still empty).
    await page.goto(`${server.url}index.html?v=after`);
    await page.waitForSelector('#repeated-list button');
    const results = await applyProbes(page, probes, 'main', { scope: '#app-root', sourceRoot: REACT_FIXTURE_DIR, sourceAttrs: [], sourceCache: new Map(), sourceMode: 'auto' });
    assert.equal(results.length, 5);
    for (const r of results) {
      assert.equal(r.relocation, 'found', `probe ${r.id} should relocate via tier 2 (source+ordinal)`);
      assert.equal(r.via, 'source');
    }
  } finally {
    await page.close();
  }
});
