#!/usr/bin/env node
// Builds guide/index.html (and guide/catalog.json) from rules.md and the skills' rule sources.
// Usage: node guide/build-guide.mjs [--root <repo>]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, summarize } from './lib/data.mjs';
import { CSS } from './lib/css.mjs';
import { CLIENT_JS } from './lib/client.mjs';
import { esc } from './lib/charts.mjs';
import { hero, install, workflow, skills, modalities } from './lib/sections-a.mjs';
import { reports, issues, catalog, footer } from './lib/sections-b.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ri = process.argv.indexOf('--root');
const root = resolve(ri > -1 ? process.argv[ri + 1] : join(here, '..'));

function size(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  for (let i = 2; i < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return [0, 0];
}

const img = (file, alt) => {
  const p = join(here, 'assets', file);
  if (!existsSync(p)) { console.warn(`build-guide: missing asset ${file}`); return ''; }
  const [w, h] = size(p);
  return `<img src="assets/${esc(file)}" alt="${esc(alt)}" width="${w}" height="${h}" decoding="async">`;
};

const cat = await loadCatalog(root);
const sum = { ...summarize(cat), tools: cat.tools.length };
if (!cat.rules.length) throw new Error(`No rules parsed from ${join(root, 'rules.md')}`);

const NAV = [['install', 'Install'], ['workflow', 'Workflow'], ['skills', 'Skills'], ['modalities', 'Modalities'], ['reports', 'Reports'], ['issues', 'Issues'], ['catalog', 'Catalog']];
const SOURCES = ['rules.md', 'skills/accessibility-assessment/references/criteria-coverage.md', 'skills/accessibility-assessment/knowledge/wcag/criteria.json', 'skills/accessibility-assessment/knowledge/apg/index.md', 'skills/accessibility-assessment/scripts/lib/modality-rules.mjs', 'skills/screen-reader-validation/scripts/lib/rules.mjs'];

const html = `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accessibility-assess skills · Guide</title>
<link rel="icon" href="assets/icon.svg" type="image/svg+xml">
<link rel="icon" href="assets/icon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="assets/icon-180.png">
<meta name="description" content="How to use the accessibility-assess skills: workflow, skills, modalities, reports, example issues and the full WCAG 2.2 criteria catalog.">
<style>${CSS}
.no-js .tabs{display:none}.no-js .panel[hidden]{display:block!important;margin-top:24px;border-top:1px solid var(--line);border-radius:var(--r-lg)}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap">
<a class="brand" href="#top-h"><svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect x="0" y="0" width="26" height="26" rx="8" fill="#0f6cbd"/><circle cx="13" cy="8" r="2.2" fill="#fff"/><path d="M7 11.5h12M13 11.5v4.5l-3 5M13 16l3 5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg><span>accessibility<span class="long">-assess skills</span></span></a>
<nav aria-label="Sections"><ul>${NAV.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('')}</ul></nav>
</div></header>
<main id="main" tabindex="-1">
${hero(sum, img)}
${install()}
${workflow()}
${skills()}
${modalities(sum)}
${reports(img)}
${issues(img, cat.moduleRules)}
${catalog(cat, sum)}
</main>
${footer(SOURCES)}
<script>${CLIENT_JS}</script>
</body>
</html>
`;

writeFileSync(join(here, 'index.html'), html);
const json = { summary: sum, tools: cat.tools, criteria: cat.criteria, rules: cat.rules, patterns: cat.patterns };
writeFileSync(join(here, 'catalog.json'), JSON.stringify(json, null, 2) + '\n');
const missing = Object.entries(cat.sources).filter(([, ok]) => !ok).map(([k]) => k);
console.log(`guide: ${sum.rules} rules, ${sum.criteria} criteria, ${sum.patterns} APG patterns → ${join(here, 'index.html')}`);
if (missing.length) console.warn(`guide: sources not found (skipped): ${missing.join(', ')}`);
