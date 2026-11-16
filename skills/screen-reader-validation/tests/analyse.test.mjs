import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, summarise, spoken, contentWords, match, announcedState } from '../scripts/lib/analyse.mjs';
import { RULES } from '../scripts/lib/rules.mjs';

const body = { isBody: true, selector: 'body' };
const el = (o) => ({ isBody: false, tag: 'button', role: 'button', roleWord: 'button', native: true, interactive: true, name: '', html: '<button></button>', states: {}, dialog: null, ...o });
const facts = (o = {}) => ({ url: 'http://x/', title: 'X', focus: body, dialogs: [], live: [], errors: [], controls: [], ...o });
const step = (n, o) => ({ n, action: 'press', key: 'Tab', description: `step ${n}`, trace: { actionable: true }, ok: true, narration: [], screenshot: `shots/s${n}.png`, ...o });
const results = (steps, extra = {}) => ({ simulated: true, journeys: [{ id: 'j', status: 'complete', steps }], probes: [], ...extra });
const rules = (r) => analyse(r).map((f) => f.rule);

test('modality rules: sr-navigation is review-only; keyboard barriers fail; focus-mode sweeps are unreliable', () => {
  const nav = (o) => ({ ...results([step(1, { modality: 'sr-navigation', readerMode: 'focus', facts: { before: facts(), after: facts() }, narration: ['x'] })]), ...o });
  const r = analyse(nav());
  const f = r.find((x) => x.rule === 'srnav-focus-mode-required');
  assert.ok(f && f.kind === 'review');
  const kbd = { rule: 'kbd-not-focusable', note: 'Tab never reached it', meta: { kind: 'failure', impact: 'serious', wcag: ['2.1.1'], title: 'Not keyboard reachable', description: 'd', fix: 'f' } };
  const k = analyse(results([step(1, { ok: false, modality: 'sr-navigation', modalityFindings: [kbd], keysSent: ['Tab'], facts: { before: facts(), after: facts() } })]));
  assert.equal(k[0].kind, 'failure');
  const j = { id: 'j', key: 'j~sr-navigation', modality: 'sr-navigation', status: 'complete', steps: [] };
  const probe = { id: 'p1', journey: 'j~sr-navigation', startPlan: [], landmarks: { spoken: [], termination: 'end', dom: [{ role: 'main' }] }, headings: { spoken: [], termination: 'invalid-focus-mode', dom: [] } };
  const p = analyse({ simulated: true, journeys: [j], probes: [probe] });
  assert.deepEqual(p.map((x) => x.rule), ['srnav-no-semantic-nav'], 'discarded focus-mode sweep proves nothing (no sr-no-headings)');
});

test('a focused control announced only by its role has no name', () => {
  const f = analyse(results([step(1, { facts: { before: facts(), after: facts({ focus: el({ selector: '#a' }) }) }, narration: ['button'] })]));
  assert.deepEqual(f.map((x) => x.rule), ['sr-control-without-name']);
  assert.equal(f[0].source, 'screen-reader');
  assert.equal(f[0].target, 'j#1');
  assert.deepEqual(f[0].repro, ['step 1']);
  assert.equal(f[0].nodes[0].screenshot, 'shots/s1.png');
  assert.equal(f[0].evidence.simulated, true);
});

test('a named control with its name spoken is clean', () => {
  const f = rules(results([step(1, { facts: { before: facts(), after: facts({ focus: el({ selector: '#a', name: 'Search' }) }) }, narration: ['Search button'] })]));
  assert.deepEqual(f, []);
});

test('NVDA-style "blank" announcement is reported once, not also as nameless', () => {
  const f = rules(results([step(1, { facts: { before: facts(), after: facts({ focus: el({ selector: '#a', tag: 'input', role: 'textbox', roleWord: 'edit' }) }) }, narration: ['edit blank'] })]));
  assert.deepEqual(f, ['sr-blank-announcement']);
});

test('a dialog that opens without focus moving in is reported, and closing to body is a failure', () => {
  const dlg = { key: '#d', name: 'Settings' };
  const opener = el({ selector: '#open', name: 'Open' });
  const f = analyse(results([
    step(1, { action: 'click', target: { selector: '#open' }, facts: { before: facts({ focus: opener }), after: facts({ focus: opener, dialogs: [dlg] }) }, narration: ['Open button'] }),
    step(2, { action: 'click', target: { selector: '#close' }, facts: { before: facts({ focus: opener, dialogs: [dlg] }), after: facts() }, narration: ['Close button'] }),
  ]));
  const byRule = Object.fromEntries(f.map((x) => [x.rule, x]));
  assert.ok(byRule['sr-dialog-not-announced']);
  assert.ok(byRule['sr-focus-not-in-dialog']);
  assert.equal(byRule['sr-focus-not-returned'].kind, 'failure');
  assert.equal(byRule['sr-focus-not-returned'].nodes[0].selector, '#open');
});

test('a dialog announced with focus inside and returned to the opener is clean', () => {
  const dlg = { key: '#d', name: 'Help' };
  const opener = el({ selector: '#open', name: 'Open help' });
  const inner = el({ selector: '#close', name: 'Close', dialog: '#d' });
  const f = rules(results([
    step(1, { action: 'click', target: { selector: '#open' }, facts: { before: facts({ focus: opener }), after: facts({ focus: inner, dialogs: [dlg] }) }, narration: ['Help dialog', 'Close button'] }),
    step(2, { action: 'click', target: { selector: '#close' }, facts: { before: facts({ focus: inner, dialogs: [dlg] }), after: facts({ focus: opener }) }, narration: ['Open help button'] }),
  ]));
  assert.deepEqual(f, []);
});

test('status and error messages must be spoken', () => {
  const before = facts({ live: [{ key: '#s', role: 'status', politeness: 'polite', text: '' }] });
  const after = facts({ live: [{ key: '#s', role: 'status', politeness: 'polite', text: 'Saved' }], errors: [{ selector: '#e', kind: 'text', text: 'Enter an email address' }] });
  assert.deepEqual(rules(results([step(1, { action: 'click', facts: { before, after }, narration: ['Save button'] })])).sort(), ['sr-error-not-announced', 'sr-status-not-announced']);
  assert.deepEqual(rules(results([step(1, { action: 'click', facts: { before, after }, narration: ['Saved', 'Enter an email address'] })])), []);
});

test('silent navigation, duplicates and symbols', () => {
  const f = rules(results([
    step(1, { action: 'goto', facts: { before: null, after: facts() }, narration: [] }),
    step(2, { facts: { before: facts(), after: facts({ focus: el({ selector: '#b', name: 'Next' }) }) }, narration: ['Next button', 'Next button'] }),
    step(3, { facts: { before: facts({ focus: el({ selector: '#b', name: 'Next' }) }), after: facts({ focus: el({ selector: '#c', name: '🚀 Go' }) }) }, narration: ['🚀 Go button'] }),
  ]));
  assert.deepEqual(f, ['sr-silent-navigation', 'sr-duplicate-announcement', 'sr-symbol-noise']);
});

test('probes: landmarks, headings and reading order', () => {
  const probe = { id: 'p1', startPlan: [], headings: { spoken: [], dom: [] }, landmarks: { spoken: [], dom: [] },
    reading: { spoken: [{ text: 'A', selector: '#a', box: { x: 0, y: 100, width: 100, height: 20 } }, { text: 'B', selector: '#b', box: { x: 0, y: 10, width: 100, height: 20 } }] } };
  assert.deepEqual(rules({ journeys: [], probes: [probe] }), ['sr-no-landmarks', 'sr-no-headings', 'sr-reading-order']);
  const good = { ...probe, headings: { spoken: [{ text: 'Shop heading level 1' }], dom: [] }, landmarks: { spoken: [{ text: 'main landmark' }], dom: [] }, reading: { spoken: [] } };
  assert.deepEqual(rules({ journeys: [], probes: [good] }), []);
});

test('identical findings are deduplicated and ids are stable', () => {
  const s = step(1, { facts: { before: facts(), after: facts({ focus: el({ selector: '#a' }) }) }, narration: ['button'] });
  const f = analyse({ journeys: [{ id: 'j', steps: [s, { ...s }] }] });
  assert.equal(f.length, 1);
  assert.equal(f[0].id, 'sr-1');
});

test('summarise counts steps, kinds and failure impacts', () => {
  const r = results([step(1, { narration: ['x'] }), step(2, {}), step(3, { ok: false })]);
  const s = summarise(r, [{ kind: 'failure', impact: 'serious' }, { kind: 'review', impact: 'moderate' }]);
  assert.equal(s.steps, 3);
  assert.equal(s.narrated, 1);
  assert.equal(s.silent, 1);
  assert.equal(s.failedSteps, 1);
  assert.deepEqual(s.byKind, { failure: 1, review: 1, suggestion: 0 });
  assert.equal(s.byImpact.serious, 1);
});

test('false positives: a name next to "blank"/"clickable" vocabulary is not a blank announcement', () => {
  const after = facts({ focus: el({ selector: '#s', name: 'Search' }) });
  assert.deepEqual(rules(results([step(1, { facts: { before: facts(), after }, narration: ['Search button', 'blank'] })])), []);
  assert.deepEqual(rules(results([step(1, { facts: { before: facts(), after }, narration: ['clickable', 'Search'] })])), []);
});

test('missing role: only for widget-like elements, not for focusable content', () => {
  const div = (o) => el({ selector: '#x', tag: 'div', role: null, roleWord: null, native: false, name: 'Buy now', ...o });
  const run = (focus, narration) => rules(results([step(1, { facts: { before: facts(), after: facts({ focus }) }, narration })]));
  assert.deepEqual(run(div({ widgetLike: true }), ['Buy now']), ['sr-missing-role']);
  assert.deepEqual(run(div({ tag: 'p', widgetLike: false }), ['Buy now']), []);
  assert.deepEqual(run(div({ widgetLike: true }), ['Buy now button']), []);
});

test('dialogs: non-modal dialogs and partial name matches are review, not failures', () => {
  const opener = el({ selector: '#open', name: 'Filters' });
  const run = (dlg, narration) => analyse(results([step(1, { action: 'click', target: { selector: '#open' }, facts: { before: facts({ focus: opener }), after: facts({ focus: opener, dialogs: [dlg] }) }, narration })]));
  const modal = Object.fromEntries(run({ key: '#d', name: 'Filter results', modal: true }, ['Filters button']).map((f) => [f.rule, f.kind]));
  assert.deepEqual(modal, { 'sr-dialog-not-announced': 'failure', 'sr-focus-not-in-dialog': 'failure' });
  const popover = Object.fromEntries(run({ key: '#d', name: 'Filter results', modal: false }, ['results Filter']).map((f) => [f.rule, f.kind]));
  assert.deepEqual(popover, { 'sr-dialog-not-announced': 'review', 'sr-focus-not-in-dialog': 'review' });
});

test('errors: real invalid fields fail, class/id candidates are review, page-load errors are ignored', () => {
  const run = (o) => analyse(results([step(1, { action: 'click', facts: { before: facts(), after: facts({ errors: [{ selector: '#e', ...o }] }) }, narration: ['Submit button'] })]));
  assert.deepEqual(run({ kind: 'invalid', field: 'Email', text: 'Enter an email address' }).map((f) => [f.rule, f.kind]), [['sr-error-not-announced', 'failure']]);
  assert.deepEqual(run({ kind: 'text', text: 'Enter an email address' }).map((f) => f.kind), ['review']);
  const onLoad = step(1, { action: 'goto', facts: { before: facts(), after: facts({ url: 'http://x/form', errors: [{ selector: '#e', kind: 'invalid', text: 'Required' }] }) }, narration: ['Form'] });
  assert.ok(!rules(results([onLoad])).includes('sr-error-not-announced'));
});

test('text matching is whole-word: "Unsaved changes" is not "Saved"', () => {
  assert.equal(match(['Unsaved changes'], 'Saved'), 'no');
  assert.equal(match(['Your order was saved'], 'order was saved'), 'yes');
  const live = (text) => facts({ live: [{ key: '#s', role: 'status', politeness: 'polite', text }] });
  assert.deepEqual(rules(results([step(1, { action: 'click', facts: { before: live(''), after: live('Saved') }, narration: ['Unsaved changes'] })])), ['sr-status-not-announced']);
});

test('state announcements: negatives first, last phrase wins', () => {
  assert.equal(announcedState(['Accept terms check box not checked'], 'checked'), false);
  assert.equal(announcedState(['Menu button collapsed', 'expanded'], 'expanded'), true);
  assert.equal(announcedState(['Menu button'], 'expanded'), null);
  const btn = (expanded) => el({ selector: '#m', name: 'Menu', states: { expanded } });
  const toggled = step(1, { action: 'click', target: { selector: '#m' }, facts: { before: facts({ focus: btn(false) }), after: facts({ focus: btn(true) }) }, narration: ['Menu button collapsed', 'expanded'] });
  assert.deepEqual(rules(results([toggled])), []);
});

test('unreliable speech capture downgrades failures to review with the capture health', () => {
  const s = step(1, { facts: { before: facts(), after: facts({ focus: el({ selector: '#a' }) }) }, narration: [], capture: { mode: 'press', health: 'unavailable' } });
  const [f] = analyse(results([s], { simulated: false }));
  assert.equal(f.rule, 'sr-control-without-name');
  assert.equal(f.kind, 'review');
  assert.equal(f.evidence.capture, 'unavailable');
  const [ok] = analyse(results([{ ...s, capture: { mode: 'press', health: 'captured' } }], { simulated: false }));
  assert.equal(ok.kind, 'failure');
});

test('incomplete probe sweeps (unsupported / error / nothing spoken) prove nothing', () => {
  const sweep = (termination, spoken = []) => ({ spoken, dom: [], termination });
  for (const t of ['unsupported', 'error']) {
    const p = { id: 'p1', startPlan: [], headings: sweep(t), landmarks: sweep(t), reading: sweep(t) };
    assert.deepEqual(rules({ journeys: [], probes: [p] }), [], t);
  }
  const silent = { id: 'p1', startPlan: [], headings: sweep('silent'), landmarks: sweep('silent'), reading: sweep('silent') };
  assert.deepEqual(rules({ journeys: [], probes: [silent] }), []);
  const ended = { id: 'p1', startPlan: [], headings: sweep('end'), landmarks: sweep('end', [{ text: 'navigation landmark' }]), reading: sweep('end') };
  assert.deepEqual(rules({ journeys: [], probes: [ended] }), ['sr-no-landmarks', 'sr-no-headings']);
});

test('summarise reports coverage: blocked/partial journeys, capture health, incomplete sweeps', () => {
  const r = {
    journeys: [
      { id: 'a', status: 'complete', steps: [step(1, { narration: ['x'], capture: { health: 'captured' } })] },
      { id: 'b', status: 'blocked', steps: [] },
      { id: 'c', status: 'partial', steps: [step(1, { late: ['y'], capture: { health: 'unavailable' } })] },
    ],
    probes: [{ id: 'p1', headings: { termination: 'end' }, landmarks: { termination: 'unsupported' }, reading: { termination: 'cap' } }, { id: 'p2', error: 'boom' }],
  };
  const s = summarise(r, []);
  assert.deepEqual([s.journeysComplete, s.journeysBlocked, s.journeysPartial], [1, 1, 1]);
  assert.equal(s.narrated, 2, 'late phrases count as narration');
  assert.deepEqual(s.capture, { captured: 1, unavailable: 1 });
  assert.equal(s.probesIncomplete, 3);
});

test('text helpers and rule catalogue', () => {
  assert.ok(spoken(['Order saved successfully'], 'Order saved'));
  assert.ok(!spoken(['Save button'], 'Order could not be saved'));
  assert.deepEqual(contentWords('button collapsed'), []);
  assert.deepEqual(contentWords('Search button collapsed'), ['search']);
  for (const [id, r] of Object.entries(RULES)) {
    assert.match(id, /^sr(nav)?-/);
    assert.ok(r.title && r.fix && Array.isArray(r.wcag) && r.impact && r.kind, id);
    if (r.kind !== 'suggestion') assert.ok(r.wcag.length, `${id} maps to a WCAG SC`);
  }
});
