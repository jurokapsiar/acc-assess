import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIntent, intentTemplate, DESTRUCTIVE_VERBS } from '../scripts/lib/intent.mjs';

const PROMPT = 'check the "Invite member" dialog with NVDA, no screen readers on the billing page';
const base = (extra = {}) => ({
  prompt: PROMPT,
  include: [{ phrase: 'Invite member', kind: 'screen', quoted: true, evidence: '"Invite member" dialog' }],
  exclude: [],
  ...extra,
});

test('validateIntent: a well-formed agent intent passes and derives quotedStrings + forbid', () => {
  const { errors, intent } = validateIntent(base(), { prompt: PROMPT });
  assert.deepEqual(errors, []);
  assert.deepEqual(intent.quotedStrings, ['Invite member']);
  assert.equal(intent.actionPolicy.forbid.length, DESTRUCTIVE_VERBS.length);
  assert.equal(intent.actionPolicy.allowEvaluate, false);
});

test('validateIntent: prompt must equal the session prompt', () => {
  const { errors } = validateIntent({ ...base(), prompt: 'something else' }, { prompt: PROMPT });
  assert.ok(errors.some((e) => /session prompt/.test(e)));
});

test('validateIntent: evidence must be verbatim (case/whitespace-insensitive) or an explicit assumption', () => {
  const bad = validateIntent(base({ include: [{ phrase: 'x', kind: 'any', evidence: 'not in the prompt' }] }), { prompt: PROMPT });
  assert.ok(bad.errors.some((e) => /not a substring/.test(e)));
  const missing = validateIntent(base({ include: [{ phrase: 'x', kind: 'any' }] }), { prompt: PROMPT });
  assert.ok(missing.errors.some((e) => /evidence is required/.test(e)));
  const ok = validateIntent(base({ include: [{ phrase: 'x', kind: 'any', evidence: 'THE   billing  PAGE' }, { phrase: 'y', kind: 'any', evidence: { assumption: 'user meant the invite flow' } }] }), { prompt: PROMPT });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.assumptions, ['include "y": user meant the invite flow']);
});

test('validateIntent: states and viewports are free strings (no synonym table)', () => {
  const { errors, intent } = validateIntent(base({ states: ['kanban-collapsed'], viewports: ['foldable'] }), { prompt: PROMPT });
  assert.deepEqual(errors, []);
  assert.deepEqual(intent.states, ['kanban-collapsed']);
});

test('validateIntent: "no screen readers" is expressed as an excluded modality, never a requested one', () => {
  const doc = base({ modalities: ['sr-keyboard'], excludedModalities: [{ modality: 'sr-keyboard', evidence: 'no screen readers' }] });
  const { errors } = validateIntent(doc, { prompt: PROMPT });
  assert.ok(errors.some((e) => /both requested and excluded/.test(e)));
  const ok = validateIntent(base({ modalities: ['keyboard'], excludedModalities: [{ modality: 'sr-keyboard', evidence: 'no screen readers' }] }), { prompt: PROMPT });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.intent.excludedModalities[0].modality, 'sr-keyboard');
});

test('validateIntent: unknown modality ids and excluded modalities without evidence are rejected', () => {
  assert.ok(validateIntent(base({ modalities: ['gamepad'] }), { prompt: PROMPT }).errors.some((e) => /unknown modality/.test(e)));
  assert.ok(validateIntent(base({ excludedModalities: [{ modality: 'mouse' }] }), { prompt: PROMPT }).errors.some((e) => /evidence is required/.test(e)));
});

test('validateIntent: requested destructive verbs need evidence and are removed from forbid', () => {
  const p = 'delete a project and check the confirmation dialog';
  const mk = (e) => ({ prompt: p, include: [{ phrase: 'confirmation dialog', kind: 'screen', evidence: 'confirmation dialog' }], exclude: [], actionPolicy: { requestedDestructive: [e] } });
  const ok = validateIntent(mk({ verb: 'delete', evidence: 'delete a project' }), { prompt: p });
  assert.deepEqual(ok.errors, []);
  assert.ok(!ok.intent.actionPolicy.forbid.includes('delete'));
  assert.ok(ok.intent.actionPolicy.forbid.includes('submit'));
  assert.ok(validateIntent(mk('delete'), { prompt: p }).errors.some((e) => /needs evidence/.test(e)));
});

test('validateIntent: allowEvaluate/allowStorage default false and true requires evidence; limits must be positive', () => {
  assert.ok(validateIntent(base({ actionPolicy: { allowEvaluate: true } }), { prompt: PROMPT }).errors.some((e) => /allowEvaluate/.test(e)));
  assert.ok(validateIntent(base({ limits: { maxTargets: 0 } }), { prompt: PROMPT }).errors.some((e) => /limits\.maxTargets/.test(e)));
});

test('intentTemplate: carries the session prompt and no interpretation', () => {
  const t = intentTemplate(PROMPT);
  assert.equal(t.prompt, PROMPT);
  assert.deepEqual(t.modalities, []);
  assert.deepEqual(t.states, []);
});
