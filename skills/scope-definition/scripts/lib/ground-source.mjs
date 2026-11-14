// Ground source (b) (§6.3b): read-only, generic heuristics under `--source-root`. Finds
// candidate evidence for intent phrases from i18n strings, router files, overlay/trigger
// component hints and `data-testid`-style attributes. Uses `rg` when available (fast, respects
// nothing but our own exclude globs), falling back to a plain directory walk + substring scan
// otherwise (§6.1 preflight warns when `rg` is missing).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { textSimilarity } from './ground-inventory.mjs';

export const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);
const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.html', '.astro']);
const I18N_EXT = new Set(['.json', '.po', '.properties', '.resx', '.xliff', '.arb', '.strings']);

function isSkippable(name) {
  return SKIP_DIRS.has(name) || name.startsWith('.') || /\.min\./.test(name);
}

function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (isSkippable(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

export function hasRipgrep() {
  try {
    return spawnSync('rg', ['--version'], { encoding: 'utf8' }).status === 0;
  } catch {
    return false;
  }
}

/** `rg --fixed-strings <pattern> <root>` (excluding the standard skip dirs/extensions),
 * normalized to `{file, line, text}` (file relative to root). Returns `null` when `rg` isn't
 * available so the caller can fall back. */
function rgFixedStrings(root, pattern) {
  if (!pattern) return [];
  if (!hasRipgrep()) return null;
  const globs = [...SKIP_DIRS].flatMap((d) => ['--glob', `!${d}`]).concat(['--glob', '!*.min.*']);
  const r = spawnSync('rg', ['--fixed-strings', '--line-number', '--no-heading', ...globs, pattern, root], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return null;
  if (r.status !== 0 && r.status !== 1) return null;
  return String(r.stdout ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?):(\d+):(.*)$/);
      if (!m) return null;
      return { file: path.relative(root, m[1]).split(path.sep).join('/'), line: Number(m[2]), text: m[3].trim() };
    })
    .filter(Boolean);
}

/** Fallback for when `rg` isn't installed: plain substring scan of code files only. */
function fallbackFixedStrings(root, pattern, files) {
  if (!pattern) return [];
  const out = [];
  for (const file of files) {
    if (!CODE_EXT.has(path.extname(file).toLowerCase())) continue;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    text.split(/\r?\n/).forEach((line, i) => {
      if (line.includes(pattern)) out.push({ file: path.relative(root, file).split(path.sep).join('/'), line: i + 1, text: line.trim() });
    });
  }
  return out;
}

function findFixedStrings(root, pattern, files) {
  return rgFixedStrings(root, pattern) ?? fallbackFixedStrings(root, pattern, files);
}

function flattenJson(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flattenJson(v, key));
    else if (typeof v === 'string') out[key] = v;
  }
  return out;
}

function parseI18nFile(file) {
  const ext = path.extname(file).toLowerCase();
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  try {
    if (ext === '.json' || ext === '.arb') return flattenJson(JSON.parse(text));
    if (ext === '.properties') {
      const out = {};
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([^#!=:\s][^=:]*?)\s*[=:]\s*(.*)$/);
        if (m) out[m[1]] = m[2];
      }
      return out;
    }
    if (ext === '.po') {
      const out = {};
      const re = /msgid\s+"((?:[^"\\]|\\.)*)"\s*\n\s*msgstr\s+"((?:[^"\\]|\\.)*)"/g;
      let m;
      while ((m = re.exec(text))) if (m[2]) out[m[1]] = m[2];
      return out;
    }
    if (ext === '.resx') {
      const out = {};
      const re = /<data[^>]*name="([^"]+)"[^>]*>\s*<value>([\s\S]*?)<\/value>/g;
      let m;
      while ((m = re.exec(text))) out[m[1]] = m[2];
      return out;
    }
    if (ext === '.strings') {
      const out = {};
      const re = /"([^"]+)"\s*=\s*"((?:[^"\\]|\\.)*)";/g;
      let m;
      while ((m = re.exec(text))) out[m[1]] = m[2];
      return out;
    }
    if (ext === '.xliff') {
      const out = {};
      const re = /<trans-unit[^>]*id="([^"]+)"[^>]*>[\s\S]*?<target>([\s\S]*?)<\/target>/g;
      let m;
      while ((m = re.exec(text))) out[m[1]] = m[2];
      return out;
    }
  } catch {
    return {};
  }
  return {};
}

const ROUTE_PATTERNS = [/path\s*:\s*['"]([^'"]+)['"]/g, /<Route[^>]*\bpath\s*=\s*['"{]([^'"}]+)['"}]/g];
const OVERLAY_RE = /role\s*=\s*["']?(dialog|alertdialog|menu)["']?|<dialog\b|\b(Dialog|Modal|Popover|Menu|Drawer)\b/;
const TESTID_RE = /\b(data-testid|data-test|data-qa|data-cy)\s*=\s*["']([^"']+)["']/g;

function isI18nPath(file) {
  const norm = file.split(path.sep).join('/');
  return /\/(locales|i18n)\//.test(`/${norm}`) || I18N_EXT.has(path.extname(file).toLowerCase());
}

/** Read-only pass over `sourceRoot`: i18n strings, route declarations, overlay/trigger hints
 * and test-id attributes, each file read once. Independent of any phrase - `groundSource`
 * below matches phrases against the result. */
function scanSourceTree(sourceRoot) {
  const files = walkFiles(sourceRoot);
  const i18n = []; // { key, text, file }
  const routes = []; // { path, file }
  const overlayFiles = new Set();
  const testIds = []; // { attr, value, file, line }

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const rel = path.relative(sourceRoot, file).split(path.sep).join('/');
    if (isI18nPath(file) && I18N_EXT.has(ext)) {
      const strings = parseI18nFile(file);
      for (const [key, text] of Object.entries(strings)) i18n.push({ key, text, file: rel });
      continue;
    }
    if (!CODE_EXT.has(ext)) continue;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const re of ROUTE_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) routes.push({ path: m[1], file: rel });
    }
    if (OVERLAY_RE.test(text)) overlayFiles.add(rel);
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      TESTID_RE.lastIndex = 0;
      let tm;
      while ((tm = TESTID_RE.exec(line))) testIds.push({ attr: tm[1], value: tm[2], file: rel, line: i + 1 });
    });
  }
  return { files, i18n, routes, overlayFiles, testIds };
}

/** Grounds every `intent.include[].phrase` and `intent.quotedStrings[]` against source.
 * Source candidates never become steps by themselves (§6.3b) - they tell `explore` where to
 * look and supply `screen.source`. */
export function groundSource({ sourceRoot, intent }) {
  const root = path.resolve(sourceRoot);
  const { files, i18n, routes, overlayFiles, testIds } = scanSourceTree(root);
  const phrases = [...new Set([...(intent.include ?? []).map((i) => i.phrase), ...(intent.quotedStrings ?? [])])];

  const byPhrase = {};
  for (const phrase of phrases) {
    const evidence = [];

    // i18n: fuzzy-match the phrase against every flattened value, then rg the KEY and the
    // literal TEXT in code files.
    for (const entry of i18n) {
      if (textSimilarity(phrase, entry.text) < 0.4) continue;
      for (const hit of findFixedStrings(root, entry.key, files) ?? []) evidence.push({ file: hit.file, line: hit.line, text: hit.text, via: 'i18n-key', key: entry.key });
      for (const hit of findFixedStrings(root, entry.text, files) ?? []) evidence.push({ file: hit.file, line: hit.line, text: hit.text, via: 'i18n-text', key: entry.key });
    }

    // Hardcoded text: rg the phrase (and, if quoted, the exact quoted text) directly.
    for (const hit of findFixedStrings(root, phrase, files) ?? []) evidence.push({ file: hit.file, line: hit.line, text: hit.text, via: 'literal' });

    // Routes whose path substring-matches the phrase.
    const routeHits = routes.filter((r) => textSimilarity(phrase, r.path.replace(/[/:_-]/g, ' ')) >= 0.3);

    // Overlay/trigger hints and test ids near any file this phrase already matched.
    const matchedFiles = new Set(evidence.map((e) => e.file));
    const overlayHits = [...overlayFiles].filter((f) => matchedFiles.has(f));
    const testIdHits = testIds.filter((t) => matchedFiles.has(t.file));

    const seen = new Set();
    const dedupedEvidence = evidence.filter((e) => {
      const k = `${e.file}:${e.line}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    byPhrase[phrase] = {
      evidence: dedupedEvidence,
      routes: routeHits,
      overlayFiles: overlayHits,
      testIds: testIdHits.map((t) => ({ attr: t.attr, testId: t.value, file: t.file, line: t.line })),
    };
  }
  return { source: 'source', sourceRoot: root, rgAvailable: hasRipgrep(), byPhrase };
}
