// WCAG helpers. Criteria data comes from the scraped knowledge cache (see fetch-knowledge.mjs);
// nothing about the criteria themselves is stored in the repository.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_KNOWLEDGE = path.join(SKILL_DIR, 'knowledge');

export const AXE_TAGS = {
  A: ['wcag2a', 'wcag21a'],
  AA: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  AAA: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
};

export function loadCriteria(dir = DEFAULT_KNOWLEDGE) {
  const file = path.join(dir ?? DEFAULT_KNOWLEDGE, 'wcag', 'criteria.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

export function scInfo(criteria, num) {
  return criteria.find((c) => c.num === num) ?? null;
}

/** "wcag143" -> "1.4.3"; non-SC tags -> null. */
export function tagToSc(tag) {
  const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

export function axeRuleLevel(tags) {
  if (tags.includes('wcag2aaa')) return 'AAA';
  if (tags.some((t) => t === 'wcag2aa' || t === 'wcag21aa' || t === 'wcag22aa')) return 'AA';
  if (tags.some((t) => t === 'wcag2a' || t === 'wcag21a')) return 'A';
  return null;
}

/** Criteria at the requested conformance level are failures; above it (or best practice) are suggestions. */
export function isRequired(level, target = 'AA') {
  if (!level) return false;
  const order = { A: 1, AA: 2, AAA: 3 };
  return order[level] <= order[target];
}

export function levelOf(criteria, num, fallback = null) {
  return scInfo(criteria, num)?.level ?? fallback;
}
