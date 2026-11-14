// scope-skill-spec §17 item 1 (unit, pure): quoted strings, negation binding, state/viewport
// synonyms, destructive verbs -> actionPolicy.forbid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, normalizeIntent } from '../scripts/lib/intent.mjs';

test('parseIntent: extracts quoted strings and keeps them verbatim in include phrases', () => {
  const intent = parseIntent('open the "Invite member" dialog and check its fields');
  assert.deepEqual(intent.quotedStrings, ['Invite member']);
  const withQuote = intent.include.find((i) => i.phrase.includes('Invite member'));
  assert.ok(withQuote, 'a clause referencing the quoted phrase is kept');
  assert.equal(withQuote.quoted, false, 'the clause as a whole is not a bare quoted phrase (it has surrounding words)');
});

test('parseIntent: a clause that is only the quoted phrase is marked quoted:true', () => {
  const intent = parseIntent('"Invite member"');
  assert.equal(intent.include.length, 1);
  assert.equal(intent.include[0].quoted, true);
  assert.equal(intent.include[0].phrase, 'Invite member');
});

test('parseIntent: leading negation cues move a clause to exclude, not include', () => {
  const intent = parseIntent('check the settings screen; not the billing screen');
  assert.equal(intent.include.length, 1);
  assert.match(intent.include[0].phrase, /settings screen/);
  assert.equal(intent.exclude.length, 1);
  assert.match(intent.exclude[0].phrase, /billing screen/);
  assert.match(intent.exclude[0].reason, /not the billing screen/);
});

test('parseIntent: "without" and "except" also bind as negation, excluding only their own clause', () => {
  const intent = parseIntent('validate the checkout flow, except the payment screen');
  assert.equal(intent.exclude.length, 1);
  assert.match(intent.exclude[0].phrase, /payment screen/);
  assert.ok(intent.include.some((i) => /checkout flow/.test(i.phrase)), 'the earlier, non-negated clause stays in include');
});

test('parseIntent: recognizes state synonyms (dark mode, validation error, empty) across clauses', () => {
  const intent = parseIntent('check the form in dark mode with a validation error, and the empty state list');
  assert.deepEqual(new Set(intent.states), new Set(['dark', 'validation-error', 'empty']));
});

test('parseIntent: recognizes viewport words (mobile/desktop) and drops pure-modifier clauses from include', () => {
  const intent = parseIntent('check the profile page; mobile');
  assert.deepEqual(intent.viewports, ['mobile']);
  assert.equal(intent.include.length, 1, 'the standalone "mobile" clause is a modifier, not a target to find');
  assert.match(intent.include[0].phrase, /profile page/);
});

test('parseIntent: a destructive verb mentioned in the prompt is removed from the default forbid list and recorded', () => {
  const intent = parseIntent('delete a project and check the confirmation dialog');
  assert.ok(!intent.actionPolicy.forbid.includes('delete'), '"delete" was explicitly requested, so it is allowed');
  assert.deepEqual(intent.actionPolicy.requestedDestructive, ['delete']);
  assert.ok(intent.actionPolicy.forbid.includes('submit'), 'verbs never mentioned stay forbidden');
});

test('parseIntent: destructive verbs not mentioned in the prompt all stay forbidden, and evaluate/storage default to disallowed', () => {
  const intent = parseIntent('check the dashboard screen');
  assert.ok(intent.actionPolicy.forbid.includes('delete'));
  assert.ok(intent.actionPolicy.forbid.includes('submit'));
  assert.equal(intent.actionPolicy.allowEvaluate, false);
  assert.equal(intent.actionPolicy.allowStorage, false);
});

test('normalizeIntent: rejects an unknown state/viewport synonym and a non-positive limit', () => {
  const { errors } = normalizeIntent({
    prompt: 'x',
    include: [],
    exclude: [],
    states: ['not-a-real-state'],
    viewports: ['not-a-real-viewport'],
    limits: { maxTargets: 0, maxJourneySteps: 10, maxExploreActions: 10 },
  });
  assert.ok(errors.some((e) => /unknown state synonym/.test(e)));
  assert.ok(errors.some((e) => /unknown viewport word/.test(e)));
  assert.ok(errors.some((e) => /maxTargets/.test(e)));
});

test('normalizeIntent: a valid, round-tripped parseIntent() output normalizes with no errors', () => {
  const original = parseIntent('check the dark mode settings screen on mobile');
  const { errors, intent } = normalizeIntent(original);
  assert.deepEqual(errors, []);
  assert.deepEqual(intent.states, original.states);
  assert.deepEqual(intent.viewports, original.viewports);
});

test('parseIntent: modality words map to modalities; the request is not turned into a screen phrase', () => {
  assert.deepEqual(parseIntent('keyboard only').modalities, ['keyboard']);
  assert.deepEqual(parseIntent('the invite dialog without a mouse').modalities, ['keyboard']);
  assert.deepEqual(parseIntent('the invite dialog with NVDA and quick nav').modalities, ['sr-keyboard', 'sr-navigation']);
  assert.deepEqual(parseIntent('the invite dialog, all input').modalities.length, 4);
});

test('parseIntent: negation removes a modality; quoted labels are ignored; touch is disclosed, never mapped', () => {
  const neg = parseIntent('the invite dialog, not with the mouse, and keyboard');
  assert.deepEqual(neg.modalities, ['keyboard']);
  assert.deepEqual(parseIntent('open the "Mouse settings" page').modalities, []);
  const touch = parseIntent('the invite dialog by touch');
  assert.deepEqual(touch.modalities, []);
  assert.deepEqual(touch.unsupportedModalities, ['touch']);
});

test('normalizeIntent: an unknown modality is rejected', () => {
  const { errors } = normalizeIntent({ ...parseIntent('keyboard only'), modalities: ['gamepad'] });
  assert.ok(errors.some((e) => /unknown modality/.test(e)));
});
