#!/usr/bin/env node
// Renders <run>/report.html from <run>/results.json, merged with optional agent input:
//   <run>/agent-findings.json  -> array of extra findings (same shape as results.findings)
//   <run>/annotations.json     -> { "<findingId|rule>": { fix, sourceFile, kind, note } }
import fs from 'node:fs';
import path from 'node:path';
import { loadCriteria, scInfo } from './lib/wcag.mjs';
import { groupFindings, mergeAgentInput, slug } from './lib/findings.mjs';
import {
  pageHtml, groupHtml, scopeSection, journeysSection, modalitySection, disclosure, cmpSc, esc,
  ring, ringBox, legend, swatch, secHead, stickyNav, issueMap, screensOf, STATUS,
  scLink as scLinkImpl,
} from './lib/render.mjs';

const PRINCIPLES = { 1: 'Perceivable', 2: 'Operable', 3: 'Understandable', 4: 'Robust' };

const args = parseArgs(process.argv.slice(2));
const runDir = path.resolve(args._[0] ?? latestRun(args.reports ?? '.a11y/reports'));
const results = JSON.parse(fs.readFileSync(path.join(runDir, 'results.json'), 'utf8'));
const extra = readJson(path.join(runDir, 'agent-findings.json'), []);
const annotations = readJson(path.join(runDir, 'annotations.json'), {});
const criteria = loadCriteria(args.knowledge);

const findings = mergeAgentInput(results.findings, extra, annotations);

const byKind = (k) => groupFindings(findings.filter((f) => f.kind === k));
const failures = byKind('failure');
const reviews = byKind('review');
const suggestions = byKind('suggestion');
const targets = new Map(results.targets.map((t) => [t.key, t]));
const screenIds = (results.inventory?.features ?? []).flatMap((f) => f.screens).map((s) => s.id);
const totalScreens = screenIds.length;

const groupSections = [
  { id: 'issues', kind: 'failure', groups: failures, prefix: '' },
  { id: 'review', kind: 'review', groups: reviews, prefix: 'R' },
  { id: 'suggestions', kind: 'suggestion', groups: suggestions, prefix: 'S' },
];

const appName = results.app?.name ?? results.app?.baseUrl ?? '';
const criteriaScope = criteriaRows();
const failedScCount = criteriaScope.filter((r) => r.st === 'fail').length;

const modalityHtml = modalitySection(results, findings);
const nav = stickyNav(appName, [
  { id: 'summary', key: 'summary', label: 'Summary' },
  { id: 'criteria', key: 'criteria', label: 'Criteria', count: failedScCount },
  ...groupSections.filter((s) => s.groups.length).map((s) => ({ id: s.id, key: s.id, label: s.id === 'issues' ? 'Issues' : s.id === 'review' ? 'Review' : 'Suggestions', count: s.groups.length })),
  { id: 'scope', key: 'scope', label: 'Scope', count: totalScreens },
  ...(results.journeys?.length ? [{ id: 'journeys', key: 'journeys', label: 'User journeys', count: results.journeys.length }] : []),
  ...(modalityHtml ? [{ id: 'modalities', key: 'modalities', label: 'Modalities', count: (results.modalities ?? []).length }] : []),
]);

const dialogMap = new Map();

const body = `<header class="wrap page-head">
  <h1>Accessibility assessment</h1>
  <dl class="meta">
    <div><dt>App</dt><dd>${esc(appName)} <span class="muted">${esc(results.app?.baseUrl ?? '')}</span></dd></div>
    <div><dt>Standard</dt><dd>${esc(results.standard)}</dd></div>
    <div><dt>Date</dt><dd>${esc(new Date(results.startedAt).toLocaleString('en-GB'))}</dd></div>
    <div><dt>Engines</dt><dd>${Object.entries(results.engines ?? {}).filter(([, v]) => v).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(' · ')}</dd></div>
  </dl>
</header>
${nav}
<main id="main" class="wrap" tabindex="-1">
${summarySection()}
${criteriaSection()}
${groupSection('Issues', 'issues', failures, 'failure', '')}
${groupSection('Needs review', 'review', reviews, 'review', 'R')}
${groupSection('Suggestions', 'suggestions', suggestions, 'suggestion', 'S')}
${scopeSection(results, findings, groupSections, { dialogMap })}
${journeysSection(results.journeys, dialogMap)}
${modalityHtml}
</main>`;

const html = pageHtml(`Accessibility assessment – ${esc(appName)}`, body);

fs.writeFileSync(path.join(runDir, 'report.html'), html);
console.log(path.join(runDir, 'report.html'));

// ---------- sections ----------

// Shared by summarySection() and criteriaSection(): one row per in-scope criterion with its
// status (fail > review > checked > manual, in that priority) and principle/level.
function criteriaRows() {
  const status = new Map();
  for (const sc of results.coverage ?? []) status.set(sc, 'checked');
  for (const g of reviews) for (const sc of g.wcag) status.set(sc, 'review');
  for (const g of failures) for (const sc of g.wcag) status.set(sc, 'fail');
  const level = args.level ?? results.level ?? 'AA';
  const inScope = criteria.length
    ? criteria.filter((c) => c.level === 'A' || (level !== 'A' && c.level === 'AA') || level === 'AAA')
    : [...status.keys()].map((num) => ({ num, title: '', level: '' }));
  return inScope.map((c) => ({ ...c, principle: c.principle?.replace(/^\d\s*/, '') ?? PRINCIPLES[c.num[0]], st: status.get(c.num) ?? 'manual' }));
}

function countBy(rows) {
  return rows.reduce((c, r) => ((c[r.st] += 1), c), { fail: 0, review: 0, checked: 0, manual: 0 });
}

function statusSegs(c) {
  return ['fail', 'review', 'checked', 'manual'].map((k) => ({ value: c[k], fill: STATUS[k].fill }));
}

function shortTitle(t) {
  return t.length > 46 ? `${t.slice(0, 44).replace(/\s+\S*$/, '')}…` : t;
}

function summarySection() {
  const occ = failures.reduce((n, g) => n + g.occ.length, 0);
  const affectedScreens = new Set(failures.flatMap((g) => [...screensOf(g, targets)])).size;
  const c = countBy(criteriaScope);
  const total = criteriaScope.length;
  const shades = ['var(--c-issue-1)', 'var(--c-issue-2)', 'var(--c-issue-3)', 'var(--c-issue-4)'];
  const shown = failures.slice(0, 3);
  const extraOcc = failures.slice(3).reduce((n, g) => n + g.occ.length, 0);
  const issueSegs = shown.map((g, i) => ({ value: g.occ.length, fill: shades[i % 4] }));
  if (extraOcc) issueSegs.push({ value: extraOcc, fill: 'var(--c-manual)' });
  const issueRing = ring({ segments: issueSegs });
  const critRing = ring({ segments: statusSegs(c) });
  const clearScreens = totalScreens - affectedScreens;
  const screenRing = ring({ segments: [
    { value: affectedScreens, fill: 'var(--c-issue-1)' },
    { value: clearScreens, fill: 'var(--c-manual)' },
  ] });

  const tiles = `<div class="sum-tiles">
  <section class="tile" aria-labelledby="t-iss">
    <h3 id="t-iss">Issues by occurrences</h3>
    <div class="tile-body">${ringBox(issueRing, `<strong class="big">${occ}</strong><span>occurrences</span>`)}
    ${legend([
    ...shown.map((g, i) => ({ fill: shades[i % 4], label: `<a class="lg-a" href="#issues-${slug(g.key)}">${esc(shortTitle(g.title))}</a>`, value: g.occ.length })),
    ...(extraOcc ? [{ fill: 'var(--c-manual)', label: `${failures.length - 3} more`, value: extraOcc }] : []),
  ])}</div>
  </section>
  <section class="tile" aria-labelledby="t-crit">
    <h3 id="t-crit">Success criteria</h3>
    <div class="tile-body">${ringBox(critRing, `<strong class="big">${c.fail}</strong><span>failed of ${total}</span>`)}
    ${legend(['fail', 'review', 'checked', 'manual'].map((k) => ({ fill: STATUS[k].fill, label: STATUS[k].label, value: c[k] })))}</div>
  </section>
  <section class="tile" aria-labelledby="t-scr">
    <h3 id="t-scr">Screens with issues</h3>
    <div class="tile-body">${ringBox(screenRing, `<strong class="big">${affectedScreens}</strong><span>of ${totalScreens}</span>`)}
    ${legend([
      { fill: 'var(--c-issue-1)', label: 'With issues', value: affectedScreens },
      { fill: 'var(--c-manual)', label: 'Clear', value: clearScreens },
    ])}</div>
  </section>
</div>`;

  const map = issueMap(groupSections, { targets, screens: screenIds, totalScreens, scLinkFn: scLink });
  return `<section id="summary" class="sec" aria-labelledby="summary-h">${secHead('summary', 'summary', 'Summary', null)}<div class="panel-box">${tiles}${map}</div></section>`;
}

function criteriaSection() {
  const rows = criteriaScope;
  const all = countBy(rows);
  const breakdownRow = (label, list) => {
    const c = countBy(list);
    return `<tr><td>${esc(label)}</td><td>${list.length}</td><td>${c.fail || '–'}</td><td>${c.review || '–'}</td></tr>`;
  };
  const breakdownTable = (caption, rowsHtml) => `<table class="breakdown"><caption>${esc(caption)}</caption>
    <thead><tr><th scope="col"><span class="sr">${esc(caption)}</span></th><th scope="col">Total</th><th scope="col">Fail</th><th scope="col">Review</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table>`;
  const order = { fail: 0, review: 1, checked: 2, manual: 3 };
  const sorted = [...rows].sort((a, b) => order[a.st] - order[b.st] || cmpSc(a.num, b.num));
  const table = `<div class="table-scroll"><table class="crit-t">
    <thead><tr><th scope="col">Criterion</th><th scope="col">Principle</th><th scope="col">Level</th><th scope="col">Status</th></tr></thead>
    <tbody>${sorted.map((r) => `<tr><td>${scLink(r.num)}</td><td>${esc(r.principle ?? '')}</td><td>${esc(r.level)}</td><td><span class="status">${swatch(STATUS[r.st].fill)}${STATUS[r.st].label}</span></td></tr>`).join('')}</tbody></table></div>`;
  const levels = rows.some((r) => r.level === 'AAA') ? ['A', 'AA', 'AAA'] : ['A', 'AA'];
  const byPrinciple = breakdownTable('By principle', Object.values(PRINCIPLES).map((p) => breakdownRow(p, rows.filter((r) => r.principle === p))).join(''));
  const byLevel = breakdownTable('By level', levels.map((l) => breakdownRow(`Level ${l}`, rows.filter((r) => r.level === l))).join(''));
  const body = `<div class="panel-box">
    <div class="crit">
      <div class="crit-ring">${ringBox(ring({ segments: statusSegs(all), size: 168, thickness: 24 }), `<strong class="big">${all.fail}</strong><span>failed of ${rows.length}</span>`, 'ring-l')}</div>
      ${legend(['fail', 'review', 'checked', 'manual'].map((k) => ({ fill: STATUS[k].fill, label: STATUS[k].label, value: all[k] })))}
      ${byPrinciple}
      ${byLevel}
    </div>
    ${disclosure('crit-d', `All ${rows.length} criteria`, table, { cls: 'crit-disc', open: !rows.some((r) => r.st === 'fail') })}
  </div>`;
  return `<section id="criteria" class="sec" aria-labelledby="criteria-h">${secHead('criteria', 'criteria', 'Success criteria', rows.length, results.standard)}${body}</section>`;
}

function groupSection(title, id, groups, kind, prefix) {
  if (!groups.length) return '';
  const occ = groups.reduce((n, g) => n + g.occ.length, 0);
  return `<section id="${id}" class="sec" aria-labelledby="${id}-h">
  ${secHead(id, id, title, groups.length, `${occ} occurrence${occ === 1 ? '' : 's'}`)}
  <div class="panel-box">${groups.map((g, i) => groupHtml(g, id, scLink, { targets, where }, { kind, marker: `${prefix}${i + 1}` })).join('\n')}</div>
</section>`;
}

function where(t, fallback) {
  return t ? `${esc(t.feature.name)} › ${esc(t.screen.name)} <span class="muted">${esc(t.state.name)} · ${esc(t.viewport.name)} ${t.viewport.width}×${t.viewport.height}</span>` : esc(fallback ?? '');
}

// ---------- helpers ----------

function scLink(num, short = false) {
  return scLinkImpl(criteria, scInfo, num, short);
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

function latestRun(dir) {
  const runs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'results.json'))).sort() : [];
  if (!runs.length) throw new Error(`No runs found in ${path.resolve(dir)}`);
  return path.join(dir, runs.at(-1));
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else out._.push(argv[i]);
  }
  return out;
}
