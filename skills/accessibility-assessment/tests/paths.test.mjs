// §9 "paths.test": pure unit tests for `urlToPath`/`urlToFile` (lib/source.mjs) - no browser,
// no subprocess; just real files on disk under tests/.out/ so `finalizePath`'s existence check
// is exercised for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { urlToPath, urlToFile } from '../scripts/lib/source.mjs';
import { freshDir } from './helpers.mjs';

function makeRoot() {
  const root = freshDir('paths-root');
  fs.mkdirSync(path.join(root, 'sub', 'dir'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sub', 'dir', 'File.jsx'), '// fixture\n');
  fs.writeFileSync(path.join(root, 'My File.jsx'), '// fixture with a space\n');
  fs.writeFileSync(path.join(root, 'x'), '// webpack-style bare module\n');
  return root;
}

test('urlToPath: /@fs/C:/... (Vite) strips the prefix and un-escapes the drive letter', () => {
  const root = makeRoot();
  const abs = path.join(root, 'sub', 'dir', 'File.jsx').replace(/\\/g, '/');
  const url = `http://localhost:5173/@fs/${abs}`;
  const result = urlToPath(url, { root });
  assert.equal(result.file, 'sub/dir/File.jsx');
  assert.equal(result.unresolved, undefined);
});

test('urlToPath: %20 in the URL pathname decodes to a literal space', () => {
  const root = makeRoot();
  const url = `http://localhost:5173/My%20File.jsx`;
  const result = urlToPath(url, { root });
  assert.equal(result.file, 'My File.jsx');
});

test('urlToPath: an absolute path inside root is rewritten root-relative with forward slashes', () => {
  const root = makeRoot();
  const abs = path.join(root, 'sub', 'dir', 'File.jsx');
  const url = `file://${abs.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}`;
  const result = urlToPath(url, { root });
  assert.equal(result.file, 'sub/dir/File.jsx');
});

test('urlToPath: webpack://ns/./x collapses the dot-segment and resolves to the ns-hosted pathname', () => {
  const root = makeRoot();
  const result = urlToPath('webpack://ns/./x', { root });
  assert.equal(result.file, 'x');
});

test('urlToPath: a path that does not exist on disk resolves unresolved with a null file', () => {
  const root = makeRoot();
  const result = urlToPath('http://localhost:5173/does/not/exist.js', { root });
  assert.equal(result.file, null);
  assert.match(result.unresolved, /does[\\/]not[\\/]exist\.js$/);
});

test('urlToFile: a module with no source map resolves unresolved (file: null) rather than throwing', async () => {
  const root = makeRoot();
  const moduleUrl = 'http://localhost:5173/does-not-exist-bundle.js';
  const result = await urlToFile(moduleUrl, 10, 5, { root, cache: new Map() });
  assert.equal(result.file, null);
  assert.equal(result.unresolved, moduleUrl);
});

test('gitInfo: generated .a11y output does not make the tree dirty; other changes do', async () => {
  const { execFileSync } = await import('node:child_process');
  const { gitInfo } = await import('../scripts/lib/git.mjs');
  const dir = freshDir('git-dirty');
  const git = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'app.js'), '1\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  fs.mkdirSync(path.join(dir, '.a11y', 'reports'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.a11y', 'reports', 'results.json'), '{}');
  assert.equal(gitInfo(dir).dirty, false);
  fs.writeFileSync(path.join(dir, 'app.js'), '2\n');
  assert.equal(gitInfo(dir).dirty, true);
});
