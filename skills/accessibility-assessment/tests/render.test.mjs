// Pure render tests for the Scope section (lib/render.mjs): areas follow the final findings
// list after agent annotations, not the raw results.json areas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeSection, journeysSection, fixReportHtml, ring, issueMap, screensOf, stickyNav } from '../scripts/lib/render.mjs';
import { mergeAgentInput } from '../scripts/lib/findings.mjs';

const box = (x) => ({ x, y: 10, width: 20, height: 20 });
const results = {
  inventory: { features: [{ id: 'f', name: 'F', screens: [{ id: 's', name: 'S', type: 'page', parent: null, states: ['default'] }] }] },
  targets: [{
    key: 's__default__desktop',
    screen: { id: 's', name: 'S' },
    state: { id: 'default', name: 'Default' },
    viewport: { name: 'desktop' },
    shot: { file: 'shots/s.png', width: 400, height: 300 },
    areas: [
      { kind: 'scope', box: { x: 0, y: 0, width: 400, height: 300 }, label: 'S' },
      { kind: 'finding', box: box(10), label: '1', finding: 'F0001', findingKind: 'failure' },
      { kind: 'finding', box: box(50), label: '2', finding: 'F0002', findingKind: 'failure' },
      { kind: 'tabstop', box: box(90), label: '1' },
    ],
  }],
};
const raw = [
  { id: 'F0001', kind: 'failure', source: 'axe', rule: 'region', target: 's__default__desktop', nodes: [{ box: box(10) }] },
  { id: 'F0002', kind: 'failure', source: 'axe', rule: 'list', target: 's__default__desktop', nodes: [{ box: box(50) }] },
];

test('scope: dismissed findings lose their area, re-kinded ones change colour, agent boxes are drawn', () => {
  const extra = [{ kind: 'review', source: 'agent', rule: 'focus-order', title: 'Focus order', target: 's__default__desktop', nodes: [{ box: box(130) }] }];
  const findings = mergeAgentInput(raw, extra, { region: { kind: 'dismissed' }, list: { kind: 'review' } });
  const html = scopeSection(results, findings, []);
  assert.doesNotMatch(html, /x="10"/, 'dismissed finding area is not drawn');
  assert.match(html, /class="area a-review" x="50"/, 'kind follows the merged finding');
  assert.match(html, /class="area a-review" x="130"/, 'agent finding with a box is drawn');
  assert.match(html, /id="g-finding" data-kind="finding" checked> Issues <span class="count">2</);
  assert.match(html, /0 failures/);
  assert.match(html, /<text class="tab-num"[^>]*>1<\/text>/);
  // Per-view duplicate toggles were removed; only the global master toggle and the dialog's
  // own one-row toggles remain, both carrying data-kind for the shared sync script.
  assert.doesNotMatch(html, /id="v0-tabstop"/, 'no more per-view toggle checkboxes');
  assert.match(html, /id="d0-tabstop" class="t-tabstop" data-kind="tabstop" checked/);
  // No screen in this fixture declares subscreens, so the toggle is omitted entirely (not
  // just shown disabled, unlike scope/issues/tab stops which always appear).
  assert.doesNotMatch(html, /Subscreens/);
});

test('scope: rail is a CSS-only radio/label tree; the first entry is pre-selected so its panel shows with no JS', () => {
  const findings = mergeAgentInput(raw, [], {});
  const html = scopeSection(results, findings, []);
  // Rail entry: a radio (selection state) + its own visible label text and failure badge.
  assert.match(html, /<input type="radio" name="scopeview" id="rv-s-default-desktop" value="s__default__desktop" checked>/);
  assert.match(html, /<span>Default · desktop<\/span>/);
  // CSS-only panel switch: one generated rule per radio id, scoped to the layout ancestor.
  assert.match(html, /\.scope-layout:has\(#rv-s-default-desktop:checked\) \[data-panel="rv-s-default-desktop"\]\{display:block\}/);
  assert.match(html, /<div class="panel" data-panel="rv-s-default-desktop">/);
  // The large screenshot opens a native <dialog> (focus trap/Esc/focus-return are free); the
  // only JS is wiring the open button, and a <noscript> keeps the screenshot reachable without it.
  assert.match(html, /<button type="button" class="expand" data-dialog="dlg-0" aria-haspopup="dialog">/);
  assert.match(html, /<dialog class="shot-dialog" id="dlg-0"/);
  assert.match(html, /<noscript><p><a href="shots\/s\.png">Open screenshot<\/a><\/p><\/noscript>/);
  assert.match(html, /showModal/);
});

test('scope: the full-screen dialog keeps one row with the toggles, a close control and an issue-count disclosure', () => {
  const findings = mergeAgentInput(raw, [], {});
  const html = scopeSection(results, findings, []);
  const dialog = /<dialog class="shot-dialog"[^]*?<\/dialog>/.exec(html)[0];
  assert.match(dialog, /<div class="dialog-row">[^]*<\/form>\s*<\/div>/, 'toggles + issue-count + close share one row');
  assert.match(dialog, /<input type="checkbox" id="d0-scope" class="t-scope" data-kind="scope" checked>/);
  assert.match(dialog, /<div class="disclosure issue-count"><input type="checkbox" class="disc-check" id="dlg-0-issues"><label class="disc-label" for="dlg-0-issues">\d+ issues?<\/label>/);
  assert.match(dialog, /<form method="dialog"><button type="submit" class="close">Close<\/button><\/form>/);
});

test('scope: not-assessed states still render a selectable "Not assessed" entry/panel', () => {
  const inv2 = { features: [{ id: 'f', name: 'F', screens: [{ id: 's', name: 'S', type: 'page', parent: null, states: ['default', 'dark'] }] }] };
  const html = scopeSection({ ...results, inventory: inv2 }, mergeAgentInput(raw, [], {}), []);
  assert.match(html, /<span class="badge neutral">Not assessed<\/span>/);
  assert.match(html, /<p class="not-assessed">Not assessed<\/p>/);
});

test('scope: a subscreen-trigger area shows the toggle (unlike the zero case) and colours the area', () => {
  const withSub = {
    ...results,
    targets: [{ ...results.targets[0], areas: [...results.targets[0].areas, { kind: 'subscreen', box: box(200), label: 'Delete dialog' }] }],
  };
  const html = scopeSection(withSub, mergeAgentInput(raw, [], {}), []);
  assert.match(html, /id="g-subscreen"[^>]*> Subscreens <span class="count">1</);
  assert.match(html, /class="area a-subscreen" x="200"/);
});

test('journeys: absent entirely when results.journeys is empty/undefined', () => {
  assert.equal(journeysSection([]), '');
  assert.equal(journeysSection(undefined), '');
});

test('journeys: a scopeSection-populated dialogMap lets journey screen links reuse the same <dialog>', () => {
  const dialogMap = new Map();
  scopeSection(results, mergeAgentInput(raw, [], {}), [], { dialogMap });
  assert.equal(dialogMap.get('s__default__desktop'), 'dlg-0');
  const journeys = [{
    id: 'j1',
    title: 'Add an item',
    screens: [{
      id: 's', name: 'S', targetKey: 's__default__desktop',
      steps: [
        { origin: 'S', action: 'click', actionable: true, role: 'button', label: 'Add', device: 'mouse', input: 'mouse (left button) click' },
        { origin: 'S', action: 'fill', actionable: true, role: 'textbox', label: 'Amount', device: 'keyboard', input: 'keyboard typing' },
        { origin: 'S', action: 'waitFor', actionable: false, role: null, label: null, device: null, input: null },
      ],
    }],
  }];
  const html = journeysSection(journeys, dialogMap);
  assert.match(html, /<section id="journeys" class="sec journeys"/);
  assert.match(html, /<h3>Add an item<\/h3>/);
  // Text-only link that reuses the Scope section's own dialog id, no thumbnail markup.
  assert.match(html, /<button type="button" class="journey-link" data-dialog="dlg-0" aria-haspopup="dialog">S<\/button>/);
  assert.doesNotMatch(html, /<img[^>]*journey/);
  // Narrative is deterministic prose built from the actionable steps only (waitFor excluded).
  assert.match(html, /Opens <button[^>]*>S<\/button>, clicks Add, enters a value in Amount\./);
  // Actionable-elements list: label, role, input device\/detail, action - one per actionable step.
  assert.match(html, /<li><span class="journey-step-label">Add<\/span><span class="muted">button<\/span> — mouse \(left button\) click → click<\/li>/);
  assert.match(html, /<li><span class="journey-step-label">Amount<\/span><span class="muted">textbox<\/span> — keyboard typing → fill<\/li>/);
  assert.doesNotMatch(html, /waitFor/);
});

test('journeys: a screen with no resolvable target renders its name as plain text, not a link', () => {
  const journeys = [{ id: 'j2', title: 'Orphan flow', screens: [{ id: 'x', name: 'Unreached', targetKey: null, steps: [] }] }];
  const html = journeysSection(journeys, new Map());
  assert.match(html, /Opens Unreached\./);
  assert.doesNotMatch(html, /class="journey-link"/);
});

test('fix report: a component issue key shows the rule title with the component and keeps criteria', () => {
  const baseline = { findings: [{ kind: 'failure', source: 'axe', rule: 'button-name', title: 'Buttons need names', wcag: ['4.1.2'] }], targets: [] };
  const attempts = [{ issue: 'failure:axe:button-name@src/ui/components.tsx#IconButton', status: 'fixed', attempt: '2026-01-01-00-00-00', fixFile: 'fix-failure-axe-button-name--components-iconbutton.md', nodes: [] }];
  const html = fixReportHtml({ baseline, attempts, scLinkFn: (n) => n });
  assert.match(html, /Buttons need names — IconButton/);
  assert.match(html, /<td>4\.1\.2<\/td>/);
});

test('fix report: allFixes gives every manifest-listed fix file an overview row, even ones with no attempt', () => {
  const baseline = {
    findings: [
      { kind: 'failure', source: 'axe', rule: 'button-name', title: 'Buttons need names', wcag: ['4.1.2'] },
      { kind: 'failure', source: 'axe', rule: 'region', title: 'Content must be in a landmark', wcag: ['1.3.1'] },
    ],
    targets: [],
  };
  const attempts = [{ issue: 'failure:axe:button-name@src/ui/components.tsx#IconButton', status: 'fixed', attempt: '2026-01-01-00-00-00', fixFile: 'fix-failure-axe-button-name--components-iconbutton.md', nodes: [] }];
  const allFixes = [
    { filename: 'fix-failure-axe-button-name--components-iconbutton.md', meta: { status: 'ready', issue: 'failure:axe:button-name@src/ui/components.tsx#IconButton', component: { file: 'src/ui/components.tsx', name: 'IconButton' } } },
    { filename: 'fix-failure-axe-region.md', meta: { status: 'draft', issue: 'failure:axe:region', component: null } },
  ];
  const html = fixReportHtml({ baseline, attempts, scLinkFn: (n) => n, allFixes });
  // One overview row per manifest entry, not just per attempt.
  assert.match(html, /fix-overview/);
  assert.match(html, /Content must be in a landmark[^<]*<div class="muted mono">fix-failure-axe-region\.md/, 'unattempted file still gets a row');
  assert.match(html, /Not yet verified/, 'unattempted file is labelled not yet verified');
  assert.match(html, /<span class="badge outline">draft<\/span>/);
  assert.match(html, /<span class="badge outline">ready<\/span>/);
  // The attempted file's row links down to its proof article anchor, not the raw .md file.
  assert.match(html, /<a href="#attempt-0">fix-failure-axe-button-name--components-iconbutton\.md<\/a>/);
  // The unattempted file's row links to the raw .md file since there is no proof article for it.
  assert.match(html, /<a href="fix-failure-axe-region\.md">fix-failure-axe-region\.md<\/a>/);
  // Proof detail (the attempt article) still only renders for the attempted file.
  assert.match(html, /id="attempt-0"/);
  assert.doesNotMatch(html, /id="attempt-1"/);
});

test('fix report: without allFixes, the Fixes section falls back to attempts-only (no overview table)', () => {
  const baseline = { findings: [{ kind: 'failure', source: 'axe', rule: 'button-name', title: 'Buttons need names', wcag: ['4.1.2'] }], targets: [] };
  const attempts = [{ issue: 'failure:axe:button-name', status: 'fixed', attempt: '2026-01-01-00-00-00', fixFile: 'fix-failure-axe-button-name.md', nodes: [] }];
  const html = fixReportHtml({ baseline, attempts, scLinkFn: (n) => n });
  assert.doesNotMatch(html, /fix-overview/, 'no overview table is rendered when allFixes is not provided');
});

test('ring: half-donut gauge draws a track plus a sweep proportional to value, and small segments skip their marker', () => {
  const empty = ring({ segments: [{ value: 0, fill: '#f00' }] });
  assert.equal((empty.match(/<path/g) ?? []).length, 1, 'an all-zero ring draws only the track path, no segments');

  const solo = ring({ segments: [{ value: 5, fill: '#0f0' }] });
  assert.equal((solo.match(/<path/g) ?? []).length, 2, 'a single 100% segment is the track plus one closed sector path');

  const noTrack = ring({ segments: [{ value: 0, fill: '#f00' }], track: false });
  assert.doesNotMatch(noTrack, /<path/, 'track:false draws no paths when there are no live segments');

  const sized = ring({ segments: [{ value: 1, fill: '#f00', mark: '1' }, { value: 99, fill: '#0f0' }], size: 80 });
  assert.match(sized, /viewBox="0 0 80 80"/);
  assert.doesNotMatch(sized, /class="ring-mark"/, 'a <7% segment gets no numbered marker even when one is requested');

  const marked = ring({ segments: [{ value: 50, fill: '#f00', mark: '1' }, { value: 50, fill: '#0f0' }] });
  assert.match(marked, /class="ring-mark"/, 'a large-enough segment keeps its marker');
});

test('screensOf: the set of screens a group touches comes from its occurrences and their "also on" targets', () => {
  const targets = new Map([
    ['home__default__desktop', { screen: { id: 'home' } }],
    ['settings__default__desktop', { screen: { id: 'settings' } }],
  ]);
  const group = { occ: [{ f: { target: 'home__default__desktop' }, also: [{ target: 'settings__default__desktop' }] }] };
  assert.deepEqual([...screensOf(group, targets)].sort(), ['home', 'settings']);
});

test('issueMap: builds one tinted rowgroup per kind, in order, only for sections that have groups', () => {
  const targets = new Map([['home__default__desktop', { screen: { id: 'home' } }]]);
  const sections = [
    { id: 'issues', kind: 'failure', groups: [{ key: 'axe-button-name', title: 'Buttons need names', source: 'axe', rule: 'button-name', wcag: ['4.1.2'], occ: [{ f: { target: 'home__default__desktop' }, also: [] }] }] },
    { id: 'review', kind: 'review', groups: [] },
    { id: 'suggestions', kind: 'suggestion', groups: [{ key: 'axe-region', title: 'Landmark', source: 'axe', rule: 'region', wcag: [], occ: [{ f: { target: 'home__default__desktop' }, also: [] }] }] },
  ];
  const html = issueMap(sections, { targets, screens: ['home'], totalScreens: 1, scLinkFn: (n) => n });
  assert.match(html, /<tr class="kind-row t-issues">[^]*Issues/);
  assert.match(html, /<tr class="k-failure">[^]*Buttons need names/);
  assert.match(html, /<tr class="kind-row t-suggestions">[^]*Suggestions/);
  assert.match(html, /<tr class="k-suggestion">[^]*Landmark/);
  assert.doesNotMatch(html, /t-review|k-review/, 'an empty section contributes no rowgroup');
});

test('stickyNav: omits sections not present in items, keeps brand and href/count for the rest', () => {
  const html = stickyNav('Demo', [
    { id: 'summary', key: 'summary', label: 'Summary' },
    { id: 'issues', key: 'issues', label: 'Issues', count: 3 },
  ]);
  assert.match(html, /<a class="brand" href="#top">Demo<\/a>/);
  assert.match(html, /<a class="nl t-summary" href="#summary">/);
  assert.match(html, /<a class="nl t-issues" href="#issues">[^]*<span class="nc">3<\/span>/);
  assert.doesNotMatch(html, /t-scope/, 'sections not passed in are simply absent, not disabled');
});
