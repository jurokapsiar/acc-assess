// scope-skill-spec §17 item 2 (unit, pure): exact id = 1.0; fuzzy ranking; ambiguity within 0.1
// flagged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue, scorePhrase, groundInventory, textSimilarity } from '../scripts/lib/ground-inventory.mjs';

function sampleInventory() {
  return {
    app: { baseUrl: 'http://example.invalid/' },
    features: [
      {
        id: 'billing',
        name: 'Billing',
        screens: [
          { id: 'billing-home', name: 'Billing home', type: 'page' },
          { id: 'invoices', name: 'Invoices list', type: 'page' },
        ],
      },
      {
        id: 'team',
        name: 'Team',
        screens: [
          {
            id: 'invite-dialog',
            name: 'Invite member',
            type: 'dialog',
            trigger: { role: 'button', name: 'Invite' },
            ready: { role: 'dialog', name: 'Invite member' },
          },
        ],
      },
    ],
  };
}

test('scorePhrase: exact (case-insensitive) id match scores 1.0', () => {
  const catalogue = buildCatalogue(sampleInventory());
  const { candidates } = scorePhrase('invite-dialog', catalogue);
  assert.equal(candidates[0].ref, 'invite-dialog');
  assert.equal(candidates[0].score, 1);
});

test('scorePhrase: exact match on a dotted segment (feature id) also scores 1.0', () => {
  const catalogue = buildCatalogue(sampleInventory());
  const { candidates } = scorePhrase('billing', catalogue);
  assert.ok(candidates.some((c) => c.ref === 'billing' && c.score === 1));
});

test('scorePhrase: fuzzy text ranks the closer name/ready/trigger text above unrelated entries', () => {
  const catalogue = buildCatalogue(sampleInventory());
  const { candidates } = scorePhrase('the invite member dialog', catalogue);
  assert.equal(candidates[0].ref, 'invite-dialog', 'best candidate is the screen whose name/ready/trigger matches');
  assert.ok(!candidates.some((c) => c.ref === 'invoices'), 'an unrelated screen does not clear the 0.18 floor');
});

test('scorePhrase: two near-equal candidates (within 0.1) are flagged ambiguous', () => {
  const catalogue = [
    { ref: 'team-list', kind: 'screen', names: ['Team members list'] },
    { ref: 'team-panel', kind: 'screen', names: ['Team members panel'] },
  ];
  const { candidates, ambiguous } = scorePhrase('team members', catalogue);
  assert.ok(candidates.length >= 2);
  assert.ok(Math.abs(candidates[0].score - candidates[1].score) < 0.1);
  assert.ok(ambiguous, 'top two candidates within 0.1 of each other must be flagged ambiguous');
});

test('scorePhrase: an unrelated phrase returns no candidates (below the 0.18 floor)', () => {
  const catalogue = buildCatalogue(sampleInventory());
  const { candidates, ambiguous } = scorePhrase('completely unrelated zephyr xylophone', catalogue);
  assert.deepEqual(candidates, []);
  assert.equal(ambiguous, false);
});

test('textSimilarity: identical strings score 1, disjoint strings score 0', () => {
  assert.equal(textSimilarity('Invite member', 'Invite member'), 1);
  assert.equal(textSimilarity('Invite member', 'Invite MEMBER'), 1, 'case-insensitive');
  assert.equal(textSimilarity('zebra', 'quokka'), 0);
});

test('groundInventory: scores every intent.include phrase and quoted string against the catalogue', () => {
  const intent = {
    include: [{ phrase: 'the invite member dialog', kind: 'screen' }],
    quotedStrings: ['Invite'],
  };
  const grounding = groundInventory(sampleInventory(), intent, { existingTargetKeys: ['invite-dialog__default__desktop'] });
  assert.equal(grounding.source, 'inventory');
  assert.ok(grounding.byPhrase['the invite member dialog'].candidates[0].ref === 'invite-dialog');
  assert.ok('Invite' in grounding.byPhrase, 'quoted strings are scored too, even if not already in include');
  assert.deepEqual(grounding.existingTargetKeys, ['invite-dialog__default__desktop']);
});
