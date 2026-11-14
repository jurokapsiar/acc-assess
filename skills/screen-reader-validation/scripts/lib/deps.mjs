// Resolves the sibling `accessibility-assessment` skill: its `node_modules` (Playwright) and
// its shared `scripts/lib/*.mjs` (inventory model, step runner, scope overlay, report
// renderer). Same convention as scope-definition/fix-verify: shared code is imported, never
// re-implemented. Guidepup is this skill's only own (optional) dependency.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(SCRIPT_LIB_DIR, '..', '..');
export const SIBLING_SKILL_DIR = path.resolve(SKILL_DIR, '..', 'accessibility-assessment');
export const SIBLING_LIB_DIR = path.join(SIBLING_SKILL_DIR, 'scripts', 'lib');

export function assertSiblingInstalled() {
  if (!fs.existsSync(path.join(SIBLING_SKILL_DIR, 'package.json'))) {
    throw new Error(`Sibling skill not found: ${SIBLING_SKILL_DIR} (screen-reader-validation must sit next to accessibility-assessment)`);
  }
}

/** Resolves `playwright` (or any package) from the sibling skill's own node_modules. */
export function requireFromSibling(pkg) {
  assertSiblingInstalled();
  return createRequire(path.join(SIBLING_SKILL_DIR, 'package.json'))(pkg);
}

/** Imports one of the sibling's `scripts/lib/<name>.mjs` modules. */
export async function importSiblingLib(name) {
  const abs = path.join(SIBLING_LIB_DIR, name);
  if (!fs.existsSync(abs)) throw new Error(`Sibling lib module not found: ${abs}`);
  return import(pathToFileURL(abs).href);
}

/** Resolved path of an optional package of THIS skill, or null when not installed. */
export function resolveOwn(pkg) {
  try {
    return createRequire(path.join(SKILL_DIR, 'package.json')).resolve(pkg);
  } catch {
    return null;
  }
}

/** Lazily imports Guidepup (optional dependency); a clear, actionable error when missing. */
export async function loadGuidepup() {
  const resolved = resolveOwn('@guidepup/guidepup');
  if (!resolved) {
    throw new Error(`@guidepup/guidepup is not installed. Run "npm install" in ${SKILL_DIR} (see references/drivers.md), then "node scripts/sr.mjs preflight".`);
  }
  return import(pathToFileURL(resolved).href);
}

export function launchChromium({ channel, headed } = {}) {
  const pw = requireFromSibling('playwright');
  return pw.chromium.launch({ headless: !headed, ...(channel ? { channel } : {}) });
}
