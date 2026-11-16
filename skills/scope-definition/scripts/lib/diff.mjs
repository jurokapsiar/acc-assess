// Ground source (c) (§6.3c): maps changed files (from `--base/--changed` git refs, or a
// `--diff` patch file) to screens whose `source` globs match, plus screens whose latest
// `.a11y/reports/*/results.json` has a finding `node.source.file` in the diff. Deterministic;
// candidates are purely additive, `evidence: [{ diff: file }]`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Minimal glob -> RegExp (`**`, `*`, `?`), good enough for the `screen.source` globs used in
 * this repo's inventories (no brace expansion, no character classes - add only if needed). */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesGlob(file, glob) {
  const norm = file.split(path.sep).join('/');
  return globToRegExp(glob).test(norm);
}

/** Changed file paths (repo-root-relative, posix separators) from `git diff --name-only
 * base...changed`. Returns `null` (not an error) when git/the refs aren't available, so the
 * caller can fall back to `--diff`. */
export function changedFilesFromGit({ cwd, base, changed }) {
  if (!base || !changed) return null;
  const r = spawnSync('git', ['diff', '--name-only', `${base}...${changed}`], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return String(r.stdout ?? '').split(/\r?\n/).filter(Boolean);
}

/** Changed file paths from a unified-diff patch file's `+++ b/<path>` / `--- a/<path>` headers. */
export function changedFilesFromPatch(patchFile) {
  const text = fs.readFileSync(patchFile, 'utf8');
  const files = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(?:\+\+\+|---) (?:[ab]\/)?(.+)$/);
    if (m && m[1] !== '/dev/null') files.add(m[1].trim());
  }
  return [...files];
}

/** Flattened `{ id, source[] }` for every screen in the inventory. */
function screensWithSource(inv) {
  const out = [];
  for (const f of inv.features ?? []) {
    for (const s of f.screens ?? []) {
      if (s.source?.length) out.push({ id: s.id, source: s.source });
    }
  }
  return out;
}

/** Finds the newest `.a11y/reports/*\/results.json` (by directory name, which is a timestamp
 * stamp) under `reportsDir`, or `null` if there are none. */
function latestResults(reportsDir) {
  if (!fs.existsSync(reportsDir)) return null;
  const dirs = fs
    .readdirSync(reportsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (let i = dirs.length - 1; i >= 0; i--) {
    const file = path.join(reportsDir, dirs[i], 'results.json');
    if (fs.existsSync(file)) {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
    }
  }
  return null;
}

/** Maps changed files to candidate screens (§6.3c). `appRoot` is used to find
 * `.a11y/reports/*\/results.json` for the finding-based match. */
export function groundDiff({ appRoot, inv, changedFiles }) {
  const files = (changedFiles ?? []).map((f) => f.split(path.sep).join('/'));
  if (!files.length) return { source: 'diff', changedFiles: files, byScreen: {} };

  const byScreen = {};
  const addEvidence = (screenId, file) => {
    byScreen[screenId] ??= { evidence: [] };
    if (!byScreen[screenId].evidence.some((e) => e.diff === file)) byScreen[screenId].evidence.push({ diff: file });
  };

  for (const screen of screensWithSource(inv)) {
    for (const glob of screen.source) {
      for (const file of files) {
        if (matchesGlob(file, glob)) addEvidence(screen.id, file);
      }
    }
  }

  const results = latestResults(path.join(appRoot, '.a11y', 'reports'));
  for (const finding of results?.findings ?? results?.issues ?? []) {
    for (const node of finding.nodes ?? (finding.node ? [finding.node] : [])) {
      const srcFile = node?.source?.file;
      if (srcFile && files.includes(srcFile.split(path.sep).join('/'))) {
        const screenId = finding.target?.screen ?? finding.screen;
        if (screenId) addEvidence(screenId, srcFile);
      }
    }
  }

  return { source: 'diff', changedFiles: files, byScreen };
}
