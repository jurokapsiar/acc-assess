// scope-skill-spec §17 item 4 (unit, pure): step without evidence rejected; password/secret
// label rejected; `evaluate` rejected by default (via actionPolicy.allowEvaluate: false);
// `nth` needs reason. Item 8: producer registry rejects invalid journeys from a producer,
// accepts a valid one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStep, addStep, addCheckpoint, renderProposal } from '../scripts/lib/journeys.mjs';
import { runProducer, registerProducer } from '../scripts/lib/producers/index.mjs';

function policy(overrides = {}) {
  return { forbid: ['delete', 'submit'], allowEvaluate: false, allowStorage: false, requestedDestructive: [], ...overrides };
}

test('buildStep: rejects a step with no --evidence', () => {
  assert.throws(
    () => buildStep({ action: 'click', target: { role: 'button', name: 'Save' }, policy: policy() }),
    /needs --evidence/,
  );
});

test('buildStep: rejects a step targeting a field whose label/name/testId looks like a secret', () => {
  assert.throws(
    () => buildStep({ action: 'fill', target: { role: 'textbox', name: 'Password' }, value: 'x', evidenceRaw: 'inventory:login', policy: policy() }),
    /Refusing to record a step targeting a sensitive field/,
  );
  assert.throws(
    () => buildStep({ action: 'fill', target: { testId: 'input-otp-code' }, value: '123456', evidenceRaw: 'inventory:login', policy: policy() }),
    /Refusing to record a step targeting a sensitive field/,
  );
});

test('buildStep: an --nth target requires --reason', () => {
  assert.throws(
    () => buildStep({ action: 'click', target: { role: 'button', nth: 2 }, evidenceRaw: 'snapshot:3#e1', policy: policy() }),
    /Positional \(--nth\) targets require --reason/,
  );
  const step = buildStep({ action: 'click', target: { role: 'button', nth: 2 }, evidenceRaw: 'snapshot:3#e1', nthReason: 'identical icon buttons, this is the 3rd row', policy: policy() });
  assert.equal(step.rec.reason, 'identical icon buttons, this is the 3rd row');
});

test('buildStep: a CSS --selector target requires --reason and is marked confidence "css"', () => {
  assert.throws(
    () => buildStep({ action: 'click', target: { selector: '.icon-btn' }, evidenceRaw: 'snapshot:3#e1', policy: policy() }),
    /CSS --selector targets require --reason/,
  );
  const step = buildStep({ action: 'click', target: { selector: '.icon-btn' }, evidenceRaw: 'snapshot:3#e1', selectorReason: 'no accessible name available', policy: policy() });
  assert.equal(step.rec.confidence, 'css');
});

test('buildStep: a destructive action/target forbidden by the session policy is rejected', () => {
  assert.throws(
    () => buildStep({ action: 'click', target: { role: 'button', name: 'Delete account' }, evidenceRaw: 'inventory:settings', policy: policy() }),
    /forbidden verb/,
  );
});

test('buildStep: an allowed (not forbidden) destructive verb still records normally', () => {
  const step = buildStep({ action: 'click', target: { role: 'button', name: 'Archive item' }, evidenceRaw: 'inventory:list', policy: policy({ forbid: ['delete'] }) });
  assert.equal(step.action, 'click');
});

test('buildStep: confidence is derived from the strongest evidence kind present', () => {
  const inv = buildStep({ action: 'click', target: { role: 'button', name: 'Save' }, evidenceRaw: 'inventory:home', policy: policy() });
  assert.equal(inv.rec.confidence, 'inventory');
  const snap = buildStep({ action: 'click', target: { role: 'button', name: 'Save' }, evidenceRaw: 'snapshot:1#e9', policy: policy() });
  assert.equal(snap.rec.confidence, 'snapshot');
  const src = buildStep({ action: 'click', target: { role: 'button', name: 'Save' }, evidenceRaw: 'source:src/App.tsx:42', policy: policy() });
  assert.equal(src.rec.confidence, 'source');
});

test('addStep: throws if no checkpoint has opened a segment yet', () => {
  const draft = { journeys: [] };
  const step = buildStep({ action: 'click', target: { role: 'button', name: 'Save' }, evidenceRaw: 'inventory:home', policy: policy() });
  assert.throws(
    () => addStep(draft, { journeyId: 'j1', step }),
    /has no open segment/,
  );
});

test('addCheckpoint + addStep: builds a journey with a screen segment then an action step', () => {
  const draft = { journeys: [] };
  addCheckpoint(draft, { journeyId: 'j1', journeyTitle: 'Save settings', feature: { id: 'demo' }, kind: 'screen', screen: 'settings' });
  const step = buildStep({ action: 'click', target: { role: 'button', name: 'Save' }, evidenceRaw: 'inventory:settings', policy: policy() });
  addStep(draft, { journeyId: 'j1', step });
  assert.equal(draft.journeys.length, 1);
  assert.equal(draft.journeys[0].segments.length, 1);
  assert.equal(draft.journeys[0].segments[0].steps.length, 1);
  assert.equal(draft.journeys[0].segments[0].screen, 'settings');
});

// ------------------------------------------------------------------ producer registry (item 8)

test('runProducer: rejects a producer whose journeys include a step missing rec.confidence/evidence', async () => {
  registerProducer({
    id: 'broken-test-producer',
    version: 1,
    interactive: false,
    async produce() {
      return { journeys: [{ id: 'j1', segments: [{ kind: 'screen', screen: 'home', steps: [{ action: 'click', target: { role: 'button', name: 'Go' } }] }] }], artifacts: [], warnings: [] };
    },
  });
  await assert.rejects(
    () => runProducer('broken-test-producer', {}),
    /emitted a step without rec.confidence\/rec.evidence/,
  );
});

test('runProducer: accepts a producer whose journeys carry rec.confidence/evidence on every step', async () => {
  registerProducer({
    id: 'valid-test-producer',
    version: 1,
    interactive: false,
    async produce() {
      return {
        journeys: [{ id: 'j1', segments: [{ kind: 'screen', screen: 'home', steps: [{ action: 'click', target: { role: 'button', name: 'Go' }, rec: { confidence: 'inventory', evidence: [{ inventory: 'home' }] } }] }] }],
        artifacts: [],
        warnings: [],
      };
    },
  });
  const result = await runProducer('valid-test-producer', {});
  assert.equal(result.journeys.length, 1);
});

test('runProducer: unknown producer id throws', async () => {
  await assert.rejects(() => runProducer('does-not-exist', {}), /Unknown producer/);
});

const baseStep = { action: 'click', target: { role: 'button', name: 'Open' }, evidenceRaw: 'snapshot:n1#e2' };

test('buildStep: validates modality fields, requires a reason for skip and for programmatic steps in keyboard journeys', () => {
  const ok = buildStep({ ...baseStep, modality: { intent: 'activate', keys: 'Tab,Shift+Tab,Enter', keyboardJourney: true } });
  assert.deepEqual(ok.keys, ['Tab', 'Shift+Tab', 'Enter']);
  assert.equal(ok.intent, 'activate');
  assert.throws(() => buildStep({ ...baseStep, modality: { keys: 'Tab,Bogus Key' } }), /Invalid key/);
  assert.throws(() => buildStep({ ...baseStep, modality: { intent: 'teleport' } }), /Unknown --intent/);
  assert.throws(() => buildStep({ ...baseStep, modality: { modalitySkip: 'keyboard' } }), /requires --reason/);
  assert.deepEqual(buildStep({ ...baseStep, modality: { modalitySkip: 'keyboard', skipReason: 'drag only' } }).modalitySkip, { keyboard: 'drag only' });
  assert.throws(() => buildStep({ ...baseStep, action: 'focus', modality: { keyboardJourney: true } }), /programmatic intervention/);
  assert.equal(buildStep({ ...baseStep, action: 'focus', modality: { keyboardJourney: true, reason: 'fixture' } }).action, 'focus');
  assert.equal(buildStep({ ...baseStep, action: 'focus', modality: { keyboardJourney: false } }).action, 'focus');
});

test('renderProposal: lists modalities per journey and the step intent/keys, so approval covers them', () => {
  const step = buildStep({ ...baseStep, modality: { intent: 'activate', keys: 'Tab,Enter' } });
  const md = renderProposal({
    intent: 'x', targets: [], excluded: [], unresolved: [], modalities: ['keyboard'], unsupportedModalities: ['touch'],
    journeysDoc: { journeys: [{ id: 'j', title: 'J', modalities: ['keyboard', 'sr-keyboard'], segments: [{ kind: 'screen', screen: 's', steps: [step] }] }] },
    describeStep: () => 'Click Open',
  });
  assert.match(md, /\*\*Modalities:\*\* keyboard/);
  assert.match(md, /Modalities: keyboard, sr-keyboard/);
  assert.match(md, /intent: activate · keys: Tab Enter/);
  assert.match(md, /touch.*not an automated modality/);
});
