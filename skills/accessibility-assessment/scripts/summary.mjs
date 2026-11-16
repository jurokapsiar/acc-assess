#!/usr/bin/env node
// Read-only overview of a run, so agents don't have to read the (large) results.json whole:
//
//   node scripts/summary.mjs <run> [--rule id[,id]] [--screen id[,id]] [--top n] [--json]
//
// Merges agent-findings.json + annotations.json like report.mjs (dismissed findings are counted,
// not listed), then prints counts by kind/rule/screen/target, failed success criteria, the top
// issues with an example source location, config/engines and the fix files with their status.
import fs from 'node:fs';
import path from 'node:path';
import { groupFindings, mergeAgentInput, isOutOfScope } from './lib/findings.mjs';
import { loadCriteria, scInfo } from './lib/wcag.mjs';
import { loadRunInputs } from './lib/results.mjs';

const KINDS = ['failure', 'review', 'suggestion'];
const args = parseArgs(process.argv.slice(2));
if (!args._[0]) {
  console.error('Usage: node scripts/summary.mjs <run> [--rule id[,id]] [--screen id[,id]] [--top n] [--json]');
  process.exit(1);
}
const runDir = path.resolve(args._[0]);
const resultsPath = path.join(runDir, 'results.json');
if (!fs.existsSync(resultsPath)) {
  console.error(`No results.json in ${runDir}`);
  process.exit(1);
}
const { results, extra, annotations } = loadRunInputs(runDir);
const criteria = loadCriteria();

const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : null);
const rules = list(args.rule);
const screens = list(args.screen);
const targetsByKey = new Map((results.targets ?? []).map((t) => [t.key, t]));
const screenOf = (key) => targetsByKey.get(key)?.screen?.id ?? String(key).split('__')[0];
const targets = (results.targets ?? []).filter((t) => !screens || screens.includes(t.screen?.id));
const keep = (f) => (!rules || rules.includes(f.rule)) && (!screens || screens.includes(screenOf(f.target)));

const all = mergeAgentInput(results.findings ?? [], extra, {});
const mergedAll = mergeAgentInput(results.findings ?? [], extra, annotations).filter(keep);
const merged = mergedAll.filter((f) => !isOutOfScope(f));
const outOfScope = mergedAll.filter(isOutOfScope);
const dismissed = all.filter(keep).length - mergedAll.length;
const occurrences = (f) => Math.max(1, f.nodes?.length ?? 0);

const count = (key) => {
  const out = {};
  for (const f of merged) {
    const k = key(f);
    out[k] ??= { failure: 0, review: 0, suggestion: 0 };
    if (f.kind in out[k]) out[k][f.kind] += occurrences(f);
  }
  return out;
};

const failedSc = new Map();
for (const f of merged.filter((x) => x.kind === 'failure')) {
  for (const sc of f.wcag ?? []) failedSc.set(sc, (failedSc.get(sc) ?? 0) + occurrences(f));
}

const top = [];
for (const kind of KINDS) {
  for (const g of groupFindings(merged.filter((f) => f.kind === kind))) {
    const src = g.occ.map((o) => o.n?.source).find((s) => s?.file);
    top.push({
      kind,
      rule: g.rule ?? g.key,
      source: g.source,
      title: g.title ?? null,
      impact: g.impact ?? null,
      wcag: g.wcag,
      occurrences: g.occ.length,
      targets: new Set(g.items.map((f) => f.target)).size,
      example: src ? `${src.file}:${src.line ?? '?'}${src.component ? ` (${src.component})` : ''}` : g.items.find((f) => f.sourceFile)?.sourceFile ?? null,
    });
  }
}
const limit = Number(args.top ?? 15);

const fixFiles = fs.readdirSync(runDir).filter((f) => /^fix-.+\.md$/.test(f)).sort().map((file) => {
  const md = fs.readFileSync(path.join(runDir, file), 'utf8');
  const rule = md.match(/"rule": "([^"]+)"/)?.[1] ?? null;
  return { file, status: md.match(/^\| Status \| (\w+) \|/m)?.[1] ?? null, rule, screens: [...new Set([...md.matchAll(/"key": "([^"]+)"/g)].map((m) => screenOf(m[1])))] };
}).filter((x) => (!rules || rules.includes(x.rule)) && (!screens || x.screens.some((s) => screens.includes(s))));

const summary = {
  run: runDir,
  app: results.app ?? null,
  standard: results.standard ?? null,
  startedAt: results.startedAt ?? null,
  filters: { rule: rules, screen: screens },
  config: { level: results.config?.level ?? results.level ?? null, checks: results.config?.checks ?? [], viewports: results.config?.viewports ?? {}, git: results.config?.git ?? null },
  engines: results.config?.engines ?? results.engines ?? {},
  targets: { total: targets.length, ok: targets.filter((t) => t.status === 'ok').length, errors: targets.filter((t) => t.status !== 'ok').map((t) => ({ key: t.key, status: t.status, error: t.error ?? t.reason ?? t.status })) },
  kinds: Object.fromEntries(KINDS.map((k) => [k, merged.filter((f) => f.kind === k).reduce((n, f) => n + occurrences(f), 0)])),
  dismissed,
  outOfScope: { total: outOfScope.length, scopeUnreviewed: outOfScope.filter((f) => f.scopeUnreviewed).length },
  byRule: count((f) => f.rule ?? f.title),
  byScreen: count((f) => screenOf(f.target)),
  byTarget: count((f) => f.target),
  failedCriteria: [...failedSc].sort((a, b) => b[1] - a[1]).map(([sc, n]) => ({ sc, title: scInfo(criteria, sc)?.title ?? null, level: scInfo(criteria, sc)?.level ?? null, occurrences: n })),
  topIssues: top.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || b.occurrences - a.occurrences).slice(0, limit),
  fixFiles,
};

if (args.json) {
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
} else {
  const lines = [];
  const kcell = (c) => `${c.failure} failure · ${c.review} review · ${c.suggestion} suggestion`;
  lines.push(`${summary.app?.name ?? ''} ${summary.app?.baseUrl ?? ''}`.trim());
  lines.push(`${summary.standard ?? `WCAG ${summary.config.level}`} · started ${summary.startedAt ?? '?'} · checks ${summary.config.checks.join(',')}`);
  lines.push(`engines: ${Object.entries(summary.engines).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  if (rules || screens) lines.push(`filter: ${[rules && `rule=${rules.join(',')}`, screens && `screen=${screens.join(',')}`].filter(Boolean).join(' ')}`);
  lines.push(`targets: ${summary.targets.ok}/${summary.targets.total} reached${summary.targets.errors.length ? ` (errors: ${summary.targets.errors.map((e) => `${e.key}: ${e.error}`).join('; ')})` : ''}`);
  lines.push(`occurrences (element × target): ${kcell(summary.kinds)}${dismissed ? ` · ${dismissed} dismissed finding(s)` : ''}`);
  if (summary.outOfScope.total) lines.push(`potentially out of scope: ${summary.outOfScope.total} finding(s), excluded above · scopeUnreviewed: ${summary.outOfScope.scopeUnreviewed}${summary.outOfScope.scopeUnreviewed ? ' (set scope in annotations.json before delivery)' : ''}`);
  lines.push('', 'Failed criteria:');
  for (const c of summary.failedCriteria) lines.push(`  ${c.sc}${c.title ? ` ${c.title}` : ''}${c.level ? ` (${c.level})` : ''}: ${c.occurrences}`);
  if (!summary.failedCriteria.length) lines.push('  none');
  lines.push('', 'Top issues:');
  for (const t of summary.topIssues) lines.push(`  [${t.kind}] ${t.rule}${t.impact ? ` · ${t.impact}` : ''}${t.wcag.length ? ` · ${t.wcag.join(',')}` : ''} · ${t.occurrences} element(s) on ${t.targets} target(s)${t.title ? ` — ${t.title}` : ''}${t.example ? `\n      e.g. ${t.example}` : ''}`);
  for (const [label, obj] of [['By rule', summary.byRule], ['By screen', summary.byScreen], ['By target', summary.byTarget]]) {
    lines.push('', `${label}:`);
    for (const [k, c] of Object.entries(obj).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`  ${k}: ${kcell(c)}`);
  }
  lines.push('', `Fix files (${fixFiles.length}):`);
  for (const f of fixFiles) lines.push(`  ${f.status ?? '?'}  ${f.file}`);
  if (!fixFiles.length) lines.push('  none (run fixes.mjs)');
  console.log(lines.join('\n'));
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
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
