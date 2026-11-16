// scope-skill-spec §17 item 3 (unit, pure-ish: read-only fs under a temp dir, no network):
// tiny fixture tree with an i18n JSON, a route file, a dialog component and a `data-testid`
// -> expected candidates; excluded dirs skipped; `rg` missing -> fallback walker still finds
// the same hits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { groundSource, hasRipgrep } from '../scripts/lib/ground-source.mjs';
import { freshDir } from './helpers.mjs';

function buildSourceTree(root) {
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'locales'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'some-dep'), { recursive: true });

  fs.writeFileSync(
    path.join(root, 'src', 'locales', 'en.json'),
    JSON.stringify({ team: { inviteTitle: 'Invite member' } }),
  );
  fs.writeFileSync(
    path.join(root, 'src', 'components', 'InviteDialog.tsx'),
    [
      "import { t } from '../i18n';",
      "export function InviteDialog() {",
      "  return (",
      '    <div role="dialog" aria-label={t(\'team.inviteTitle\')} data-testid="invite-dialog">',
      "      <button data-testid=\"invite-submit\">Send invite</button>",
      "    </div>",
      "  );",
      "}",
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, 'src', 'routes.ts'),
    "export const routes = [{ path: '/invite-member', component: 'InviteDialog' }];",
  );
  // A decoy inside node_modules that would also fuzzy-match "Invite member" if excluded dirs
  // were not actually skipped.
  fs.writeFileSync(path.join(root, 'node_modules', 'some-dep', 'locale.json'), JSON.stringify({ x: 'Invite member' }));
  return root;
}

test('groundSource: finds i18n text, the component that renders it, its data-testid and a matching route', () => {
  const root = buildSourceTree(freshDir('ground-source'));
  const intent = { include: [{ phrase: 'the invite member dialog', kind: 'screen' }], quotedStrings: [] };
  const grounding = groundSource({ sourceRoot: root, intent });

  assert.equal(grounding.source, 'source');
  const info = grounding.byPhrase['the invite member dialog'];
  assert.ok(info, 'the phrase is a grounding key');
  assert.ok(info.evidence.some((e) => e.file === 'src/components/InviteDialog.tsx'), 'the component rendering the i18n value is found via its key');
  assert.ok(info.overlayFiles.includes('src/components/InviteDialog.tsx'), 'role=dialog marks the file as an overlay hint');
  assert.ok(info.testIds.some((t) => t.testId === 'invite-dialog'), 'a data-testid on the matched file is surfaced');
  assert.ok(info.routes.some((r) => r.path === '/invite-member'), 'the route whose path resembles the phrase is surfaced');
});

test('groundSource: never surfaces evidence from node_modules (or other excluded dirs)', () => {
  const root = buildSourceTree(freshDir('ground-source-excluded'));
  const intent = { include: [{ phrase: 'Invite member', kind: 'screen' }], quotedStrings: [] };
  const grounding = groundSource({ sourceRoot: root, intent });
  const info = grounding.byPhrase['Invite member'];
  assert.ok(!info.evidence.some((e) => e.file.includes('node_modules')), 'node_modules is skipped even though it contains the exact phrase');
});

test('groundSource: records whether ripgrep is available (boolean), and finds the same evidence either way', () => {
  const root = buildSourceTree(freshDir('ground-source-rg'));
  const intent = { include: [{ phrase: 'Invite member', kind: 'screen' }], quotedStrings: [] };
  const grounding = groundSource({ sourceRoot: root, intent });
  assert.equal(typeof grounding.rgAvailable, 'boolean');
  assert.equal(grounding.rgAvailable, hasRipgrep());
  // Whether or not rg is installed on this machine, the literal-text scan must find the
  // hardcoded "Send invite" button text via the plain-phrase fixed-string search.
  const info2 = groundSource({ sourceRoot: root, intent: { include: [{ phrase: 'Send invite', kind: 'any' }], quotedStrings: [] } }).byPhrase['Send invite'];
  assert.ok(info2.evidence.some((e) => e.file === 'src/components/InviteDialog.tsx' && e.via === 'literal'));
});
