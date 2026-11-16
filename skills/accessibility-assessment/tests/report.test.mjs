// report.mjs: renders report.html from a results.json fixture - summary data mapping
// (headline numbers, ring tiles, issue map), the sticky nav anchors, and the Scope section's
// per-rail CSS chart variables.
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { freshDir, writeResults, runReport } from './helpers.mjs';

const target = (screen, viewport = 'desktop') => ({
  key: `${screen}__default__${viewport}`,
  feature: { id: 'f', name: 'F' },
  screen: { id: screen, name: screen },
  state: { id: 'default', name: 'Default' },
  viewport: { name: viewport, width: viewport === 'desktop' ? 1280 : 390, height: 800 },
  shot: { file: `shots/${screen}.png`, width: 400, height: 300 },
  areas: [
    { kind: 'scope', box: { x: 0, y: 0, width: 400, height: 300 }, label: screen },
    { kind: 'finding', box: { x: 10, y: 10, width: 20, height: 20 }, label: '1' },
  ],
});

function buildResults() {
  return {
    app: { name: 'Demo', baseUrl: 'http://x/' },
    standard: 'WCAG 2.2 AA',
    level: 'AA',
    startedAt: '2026-01-01T00:00:00.000Z',
    engines: { playwright: '1.0.0', 'axe-core': '4.0.0' },
    inventory: {
      features: [{ id: 'f', name: 'F', screens: [
        { id: 'home', name: 'Home', type: 'page', parent: null, states: ['default'] },
        { id: 'settings', name: 'Settings', type: 'page', parent: null, states: ['default'] },
      ] }],
    },
    targets: [target('home'), target('settings')],
    coverage: ['2.4.1'],
    findings: [
      { id: 'F1', kind: 'failure', source: 'axe', rule: 'button-name', title: 'Buttons need names', impact: 'critical', wcag: ['4.1.2'], target: 'home__default__desktop', nodes: [{ selector: '#a' }] },
      { id: 'F2', kind: 'failure', source: 'axe', rule: 'button-name', title: 'Buttons need names', impact: 'critical', wcag: ['4.1.2'], target: 'settings__default__desktop', nodes: [{ selector: '#b' }] },
      { id: 'F3', kind: 'review', source: 'axe', rule: 'color-contrast', title: 'Check contrast', wcag: ['1.4.3'], target: 'home__default__desktop', nodes: [{ selector: '#c' }] },
      { id: 'F4', kind: 'suggestion', source: 'axe', rule: 'region', title: 'Landmark', wcag: [], target: 'home__default__desktop', nodes: [{ selector: '#d' }] },
    ],
  };
}

test('report: summary tiles map occurrences, failed criteria and affected screens', async () => {
  const dir = freshDir('report');
  writeResults(dir, buildResults());
  const r = await runReport(dir);
  assert.equal(r.code, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');

  // Summary: no headline text any more — the half-donut gauges plus their legends carry the
  // numbers (1 failed criterion of total; 1 issue group with 2 occurrences; 2 screens
  // affected of 2 total).
  assert.match(html, /<strong class="big">1<\/strong><span>failed of \d+<\/span>/);
  assert.match(html, /<strong class="big">2<\/strong><span>occurrences<\/span>/);
  assert.match(html, /<strong class="big">2<\/strong><span>of 2<\/span>/);
  // Summary tile legend links to the issue card anchor via the group's slug.
  assert.match(html, /href="#issues-axe-button-name"/);
});

test('report: sticky nav only lists sections that exist, with occurrence/criteria counts', async () => {
  const dir = freshDir('report');
  writeResults(dir, buildResults());
  await runReport(dir);
  const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert.match(html, /<nav class="topnav"[^]*<a class="nl t-summary" href="#summary">/);
  assert.match(html, /<a class="nl t-issues" href="#issues">[^]*?<span>Issues<\/span><span class="nc">1<\/span>/);
  assert.match(html, /<a class="nl t-review" href="#review">/);
  assert.match(html, /<a class="nl t-suggestions" href="#suggestions">/);
  assert.match(html, /<a class="nl t-scope" href="#scope">/);
});

test('report: sticky nav omits a finding-kind section entirely when it has no groups', async () => {
  const dir = freshDir('report');
  const results = buildResults();
  results.findings = results.findings.filter((f) => f.kind !== 'suggestion');
  writeResults(dir, results);
  await runReport(dir);
  const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert.doesNotMatch(html, /class="nl t-suggestions"/, 'nav link omitted');
  assert.doesNotMatch(html, /id="suggestions" class="sec"/, 'section omitted');
});

test('report: Scope meters bar registers one --p-<kind> custom property rule per rail entry', async () => {
  const dir = freshDir('report');
  writeResults(dir, buildResults());
  await runReport(dir);
  const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert.match(html, /\.scope:has\(#rv-home-default-desktop:checked\)\{--p-finding:[\d.]+;--p-tabstop:[\d.]+;--p-scope:[\d.]+\}/);
  assert.match(html, /\.scope:has\(#rv-settings-default-desktop:checked\)\{--p-finding:[\d.]+;--p-tabstop:[\d.]+;--p-scope:[\d.]+\}/);
  assert.match(html, /id="g-finding" data-kind="finding" checked> Issues <span class="count">2<\/span>/);
});

test('report: no "User journeys" nav entry or section when results.journeys is absent/empty', async () => {
  const dir = freshDir('report');
  writeResults(dir, buildResults());
  await runReport(dir);
  const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  assert.doesNotMatch(html, /class="nl t-journeys"/);
  assert.doesNotMatch(html, /id="journeys"/);
});

test('report: a populated results.journeys renders the "User journeys" section directly after Scope, with a nav entry reusing the Scope dialog', async () => {
  const dir = freshDir('report');
  const results = buildResults();
  results.targets[0].steps = [
    { origin: 'Home', action: 'click', actionable: true, role: 'button', label: 'Settings', device: 'mouse', input: 'mouse (left button) click' },
  ];
  results.journeys = [{
    id: 'home-tour',
    title: 'Visit settings',
    screens: [{ id: 'home', name: 'Home', targetKey: 'home__default__desktop', steps: results.targets[0].steps }],
  }];
  writeResults(dir, results);
  const r = await runReport(dir);
  assert.equal(r.code, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, 'report.html'), 'utf8');
  // Nav: Scope then User journeys, right after it.
  assert.match(html, /<a class="nl t-scope" href="#scope">[^]*?<\/a><\/li><li><a class="nl t-journeys" href="#journeys">/);
  // Section: directly below Scope's closing </section> in the page body.
  assert.match(html, /<\/section>\s*<section id="journeys" class="sec journeys"/);
  assert.match(html, /<h3>Visit settings<\/h3>/);
  const dialogId = /data-dialog="(dlg-\d+)" aria-haspopup="dialog">Home<\/button>/.exec(html)?.[1];
  assert.ok(dialogId, 'journey link resolves a dialog id');
  assert.match(html, new RegExp(`<dialog class="shot-dialog" id="${dialogId}"`), 'the same dialog is rendered by the Scope section');
  assert.match(html, /clicks Settings/);
});
