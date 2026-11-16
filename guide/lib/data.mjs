// Parses rules.md, criteria-coverage.md, the WCAG/APG knowledge files and the rule modules
// into one catalog. Every number shown in the guide is derived from here.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TOOLS = ['axe-core', 'AbleDOM', 'Playwright', 'Guidepup', 'agent', 'manual'];
export const AUTOMATED = new Set(['axe-core', 'AbleDOM', 'Playwright', 'Guidepup']);
const PRINCIPLES = { 1: 'Perceivable', 2: 'Operable', 3: 'Understandable', 4: 'Robust' };
const LEVEL_RANK = { A: 1, AA: 2, AAA: 3 };

// APG patterns are assessed by the agent (apg-* rules) and axe-core (role/attribute validity).
// These are additionally exercised by Playwright (keyboard walk, overlay Escape/focus, keyboard
// modality) or by Guidepup (dialog, state, status and landmark announcements).
const APG_PLAYWRIGHT = new Set(['accordion', 'alertdialog', 'carousel', 'combobox', 'dialog-modal', 'disclosure',
  'feed', 'grid', 'listbox', 'menu-button', 'menubar', 'radio', 'slider', 'slider-multithumb', 'spinbutton',
  'tabs', 'toolbar', 'tooltip', 'treegrid', 'treeview', 'windowsplitter']);
const APG_GUIDEPUP = new Set(['accordion', 'alert', 'alertdialog', 'checkbox', 'combobox', 'dialog-modal',
  'disclosure', 'landmarks', 'menu-button', 'radio', 'switch', 'tabs', 'treeview']);

const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const strip = (s = '') => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '').trim();

export function toolOf(method = '') {
  const m = method.toLowerCase();
  if (/axe/.test(m)) return 'axe-core';
  if (/abledom/.test(m)) return 'AbleDOM';
  if (/playwright|keyboard|kbd/.test(m)) return 'Playwright';
  if (/guidepup|screen/.test(m)) return 'Guidepup';
  if (/agent|llm/.test(m)) return 'agent';
  if (/manual/.test(m)) return 'manual';
  return strip(method) || 'manual';
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

// Every markdown table, with the headings it sits under.
export function parseTables(md) {
  const out = [];
  let h2 = '', h3 = '', cur = null;
  for (const line of md.split(/\r?\n/)) {
    let m;
    if ((m = line.match(/^##\s+(.*)/))) { h2 = m[1].trim(); h3 = ''; cur = null; continue; }
    if ((m = line.match(/^###\s+(.*)/))) { h3 = m[1].trim(); cur = null; continue; }
    if (!line.trim().startsWith('|')) { cur = null; continue; }
    const cells = splitRow(line);
    if (!cur) { cur = { h2, h3, header: cells, rows: [] }; out.push(cur); continue; }
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    const row = {};
    cur.header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    cur.rows.push(row);
  }
  return out;
}

export function parseSc(cell = '') {
  const out = new Set();
  const range = /(\d)\.(\d+)\.(\d+)\s*[–-]\s*(?:\1\.\2\.)?(\d+)/g;
  let m;
  while ((m = range.exec(cell))) for (let i = +m[3]; i <= +m[4]; i++) out.add(`${m[1]}.${m[2]}.${i}`);
  for (const n of cell.replace(range, '').match(/\b\d\.\d+\.\d+\b/g) || []) out.add(n);
  return [...out];
}

const col = (row, re) => { const k = Object.keys(row).find((h) => re.test(h)); return k ? row[k] : ''; };

async function importSafe(file) {
  if (!existsSync(file)) return null;
  try { return await import(pathToFileURL(file).href); } catch (e) { console.warn(`build-guide: could not import ${file}: ${e.message}`); return null; }
}

function modalityOf(id) {
  if (id.startsWith('kbd-')) return 'keyboard';
  if (id.startsWith('ptr-')) return 'mouse';
  if (id.startsWith('srnav-')) return 'sr-navigation';
  if (id === 'sr-autofocus-focus-mode') return 'sr-keyboard, sr-navigation';
  return '';
}

export async function loadCatalog(root) {
  const P = {
    rules: join(root, 'rules.md'),
    criteria: join(root, 'skills/accessibility-assessment/knowledge/wcag/criteria.json'),
    coverage: join(root, 'skills/accessibility-assessment/references/criteria-coverage.md'),
    apg: join(root, 'skills/accessibility-assessment/knowledge/apg/index.md'),
    modality: join(root, 'skills/accessibility-assessment/scripts/lib/modality-rules.mjs'),
    sr: join(root, 'skills/screen-reader-validation/scripts/lib/rules.mjs'),
  };
  const sources = Object.fromEntries(Object.entries(P).map(([k, f]) => [k, existsSync(f)]));

  const crit = new Map();
  let cj = [];
  try { cj = JSON.parse(read(P.criteria) || '[]'); } catch { cj = []; }
  if (!Array.isArray(cj)) cj = cj.criteria || Object.values(cj);
  for (const c of cj) {
    if (!c?.num || c.num === '4.1.1') continue;
    crit.set(c.num, { num: c.num, title: c.title, level: c.level, principle: String(c.principle || '').replace(/^\d\s*/, '') || PRINCIPLES[c.num[0]], url: c.url || '', tools: new Set(), rules: [] });
  }
  const ensureSc = (num, title = '', level = '') => {
    if (num === '4.1.1') return null; // obsolete in WCAG 2.2
    if (!crit.has(num)) crit.set(num, { num, title, level, principle: PRINCIPLES[num[0]] || '', url: '', tools: new Set(), rules: [] });
    const c = crit.get(num);
    if (!c.title && title) c.title = title;
    if (!c.level && level) c.level = level;
    return c;
  };

  const rules = [];
  const seen = new Set();
  const rulesMd = read(P.rules);
  for (const t of parseTables(rulesMd)) {
    if (t.header.some((h) => /rule id/i.test(h))) {
      for (const row of t.rows) {
        const id = strip(col(row, /rule id/i));
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const sev = strip(col(row, /severity|impact/i));
        rules.push({
          id, section: t.h2, tool: toolOf(col(row, /method/i)), sc: parseSc(col(row, /wcag|sc/i)),
          severity: /^[a-z]+$/i.test(sev) ? sev.toLowerCase() : '', kind: strip(col(row, /kind/i)),
          description: strip(col(row, /description/i)), modality: modalityOf(id),
        });
      }
    } else if (t.header.some((h) => /proposed tool/i.test(h)) || /manual/i.test(t.h2)) {
      const level = /AAA/.test(t.h3) ? 'AAA' : '';
      for (const row of t.rows) {
        for (const num of parseSc(col(row, /wcag|sc/i))) {
          const c = ensureSc(num, strip(col(row, /description/i)), level);
          if (c) c.tools.add(toolOf(col(row, /method/i)));
        }
      }
    }
  }

  // Rule modules: adds rules not (yet) listed in rules.md and provides fix text.
  const modules = [];
  const mod = await importSafe(P.modality);
  if (mod) {
    const all = mod.ALL_MODALITY_RULES || { ...(mod.MODALITY_RULES || {}), ...(mod.SR_MODALITY_RULES || {}) };
    for (const [id, r] of Object.entries(all)) modules.push({ id, r, section: 'Interaction modality checks', tool: /^(kbd|ptr)-/.test(id) ? 'Playwright' : 'Guidepup' });
  }
  const sr = await importSafe(P.sr);
  for (const [id, r] of Object.entries(sr?.RULES || {})) modules.push({ id, r, section: 'Screen reader checks (Guidepup)', tool: 'Guidepup' });
  const moduleRules = {};
  for (const { id, r, section, tool } of modules) {
    moduleRules[id] = r;
    if (seen.has(id)) continue;
    seen.add(id);
    const wcag = Array.isArray(r.wcag) ? r.wcag : r.wcag ? [r.wcag] : [];
    rules.push({ id, section, tool, sc: wcag.flatMap((w) => parseSc(String(w))), severity: r.impact || '', kind: r.kind || '', description: r.title || '', modality: modalityOf(id) });
  }

  for (const t of parseTables(read(P.coverage))) {
    if (!t.header.some((h) => /automated/i.test(h))) continue;
    for (const row of t.rows) {
      const scCell = col(row, /^sc$/i) || Object.values(row)[0];
      const nums = parseSc(scCell);
      const title = strip(scCell.replace(/^[\d.\s–-]+/, ''));
      const auto = col(row, /automated/i), human = col(row, /agent|manual/i), lvl = col(row, /level/i);
      for (const num of nums) {
        const c = ensureSc(num, nums.length === 1 ? title : '', /^(A|AA|AAA)$/.test(lvl) ? lvl : '');
        if (!c) continue;
        if (/\baxe\b/i.test(auto)) c.tools.add('axe-core');
        if (/abledom/i.test(auto)) c.tools.add('AbleDOM');
        if (/\b(kbd|ovl|reflow|ts|playwright)\b/i.test(auto)) c.tools.add('Playwright');
        if (/guidepup|screen reader/i.test(auto)) c.tools.add('Guidepup');
        if (/agent/i.test(human)) c.tools.add('agent');
        if (/manual/i.test(human)) c.tools.add('manual');
      }
    }
  }

  for (const r of rules) {
    for (const num of r.sc) {
      const c = ensureSc(num);
      if (!c) continue;
      c.tools.add(r.tool);
      c.rules.push(r.id);
    }
  }
  for (const c of crit.values()) if (!c.tools.size) c.tools.add('manual');
  for (const r of rules) {
    const cs = r.sc.map((n) => crit.get(n)).filter(Boolean);
    const lv = [...new Set(cs.map((c) => c.level).filter(Boolean))];
    r.levels = lv.length ? lv.sort((a, b) => LEVEL_RANK[a] - LEVEL_RANK[b]) : ['best practice'];
    r.principles = [...new Set(cs.map((c) => c.principle).filter(Boolean))];
  }

  const apgRules = rules.filter((r) => r.id.startsWith('apg-')).map((r) => r.id);
  const patterns = [];
  for (const t of parseTables(read(P.apg))) {
    if (!t.header.some((h) => /slug/i.test(h))) continue;
    for (const row of t.rows) {
      const slug = strip(col(row, /slug/i));
      if (!slug) continue;
      const tools = new Set(['agent', 'axe-core']);
      if (APG_PLAYWRIGHT.has(slug)) tools.add('Playwright');
      if (APG_GUIDEPUP.has(slug)) tools.add('Guidepup');
      patterns.push({ slug, name: strip(col(row, /pattern/i)), summary: strip(col(row, /summary/i)), tools: TOOLS.filter((x) => tools.has(x)), rules: apgRules });
    }
  }

  const criteria = [...crit.values()]
    .map((c) => ({ ...c, tools: [...TOOLS.filter((t) => c.tools.has(t)), ...[...c.tools].filter((t) => !TOOLS.includes(t))] }))
    .sort((a, b) => a.num.localeCompare(b.num, 'en', { numeric: true }));
  const tools = [...TOOLS, ...new Set(rules.map((r) => r.tool).filter((t) => !TOOLS.includes(t)))];

  return { rules, criteria, patterns, tools, moduleRules, sources };
}

export function summarize(cat) {
  const count = (arr, f) => arr.reduce((m, x) => { for (const k of [].concat(f(x))) m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    rules: cat.rules.length,
    criteria: cat.criteria.length,
    patterns: cat.patterns.length,
    rulesByTool: count(cat.rules, (r) => r.tool),
    criteriaByLevel: count(cat.criteria, (c) => c.level || 'unknown'),
    criteriaByTool: count(cat.criteria, (c) => c.tools),
    coverage: count(cat.criteria, (c) => (c.tools.some((t) => AUTOMATED.has(t)) ? 'automated' : c.tools.includes('agent') ? 'agent' : 'manual')),
    modalityRules: cat.rules.filter((r) => r.modality).length,
  };
}
