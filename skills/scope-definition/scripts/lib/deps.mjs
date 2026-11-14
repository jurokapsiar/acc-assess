// Resolves the sibling `accessibility-assessment` skill: its `node_modules` (Playwright) and
// its shared `scripts/lib/*.mjs` (inventory model, step runner, scope overlay). This skill has
// no `package.json` of its own in MVP - everything comes from the sibling, same convention as
// `fix-verify`.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(SCRIPT_LIB_DIR, '..', '..');
export const SIBLING_SKILL_DIR = path.resolve(SKILL_DIR, '..', 'accessibility-assessment');
export const SIBLING_SCRIPTS_DIR = path.join(SIBLING_SKILL_DIR, 'scripts');
export const SIBLING_LIB_DIR = path.join(SIBLING_SCRIPTS_DIR, 'lib');

export function assertSiblingInstalled() {
  if (!fs.existsSync(SIBLING_SKILL_DIR)) {
    throw new Error(`Sibling skill not found: ${SIBLING_SKILL_DIR} (scope-definition must sit next to accessibility-assessment)`);
  }
  const pkgPath = path.join(SIBLING_SKILL_DIR, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`${SIBLING_SKILL_DIR} has no package.json (run "npm run setup" there first)`);
  }
}

/** Resolves `playwright` (or any package) from the sibling skill's own node_modules. */
export function requireFromSibling(pkg) {
  assertSiblingInstalled();
  const siblingRequire = createRequire(path.join(SIBLING_SKILL_DIR, 'package.json'));
  return siblingRequire(pkg);
}

/** Imports one of the sibling's `scripts/lib/<name>.mjs` modules (the real, shared code -
 * never reimplemented here). `name` is a bare filename, e.g. "inventory.mjs". */
export async function importSiblingLib(name) {
  const abs = path.join(SIBLING_LIB_DIR, name);
  if (!fs.existsSync(abs)) throw new Error(`Sibling lib module not found: ${abs}`);
  return import(pathToFileURL(abs).href);
}

export async function loadInventoryLib() {
  return importSiblingLib('inventory.mjs');
}
export async function loadStepsLib() {
  return importSiblingLib('steps.mjs');
}
export async function loadScopeLib() {
  return importSiblingLib('scope.mjs');
}

export async function launchChromium({ channel, headed } = {}) {
  const pw = requireFromSibling('playwright');
  return pw.chromium.launch({ headless: !headed, ...(channel ? { channel } : {}) });
}
