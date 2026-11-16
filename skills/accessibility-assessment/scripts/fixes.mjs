#!/usr/bin/env node
// Generates <run>/fix-<kind>-<source>-<rule>[--<component>].md (one per rule + component) from <run>/results.json merged with the
// same optional agent input report.mjs uses:
//   <run>/agent-findings.json  -> array of extra findings (same shape as results.findings)
//   <run>/annotations.json     -> { "<findingId|rule>": { fix, why, reviewed, changes[] } }
//
//   node scripts/fixes.mjs <run> [--kinds failure,review,suggestion] [--only rule,rule2] [--include-out-of-scope]
//
// Findings marked potentially out of scope (see report.mjs) are skipped unless --include-out-of-scope.//
// Run from the app root (cwd), same convention as assess.mjs/report.mjs (plan header):
// `node.source.file` on every finding node is already relative to the resolved source root,
// and `changes[].file` in annotations.json is expected in that same convention, so this
// resolves the source root the same way assess.mjs does (lib/source.mjs's
// `resolveSourceRoot`), using `results.config.sourceRoot` (the value assess.mjs recorded)
// and the current cwd as the app root.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadCriteria, scInfo } from './lib/wcag.mjs';
import { loadRunInputs } from './lib/results.mjs';
import { groupFindings, mergeAgentInput, isOutOfScope, slug, groupId } from './lib/findings.mjs';
import { fileURLToPath } from 'node:url';
import { resolveSourceRoot } from './lib/source.mjs';
import { loadInventory, resolveTargets } from './lib/inventory.mjs';

const VERIFY_SCRIPT = normalizeSlashes(path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify.mjs'));

const SECTION_ID = { failure: 'issues', review: 'review', suggestion: 'suggestions' };

const args = parseArgs(process.argv.slice(2));
if (!args._[0]) {
  console.error('Usage: node scripts/fixes.mjs <run> [--kinds failure,review,suggestion] [--only rule,rule2]');
  process.exit(1);
}
const runDir = path.resolve(args._[0]);
const { results, extra, annotations } = loadRunInputs(runDir);
const criteria = loadCriteria(args.knowledge);

const findings = mergeAgentInput(results.findings, extra, annotations).filter((f) => args['include-out-of-scope'] || !isOutOfScope(f));
const kindsSet = new Set(args.kinds ? String(args.kinds).split(',').map((s) => s.trim()).filter(Boolean) : ['failure', 'review', 'suggestion']);
const onlySet = args.only ? new Set(String(args.only).split(',').map((s) => s.trim()).filter(Boolean)) : null;

const targetsByKey = new Map((results.targets ?? []).map((t) => [t.key, t]));
// Same precedence as assess.mjs (§2): --source-root isn't a fixes.mjs option, so this is
// just `results.config.sourceRoot` (what assess.mjs was given) resolved against the cwd
// fixes.mjs runs from, which by convention is the same app root assess.mjs ran from.
const sourceRootAbs = resolveSourceRoot({ cliRoot: null, invRoot: results.config?.sourceRoot ?? null, appRoot: process.cwd() });
const sourceRootRel = normalizeSlashes(path.relative(runDir, sourceRootAbs)) || '.';

// One fix file per rule + component: every finding is split by the component that renders
// each node (`source.file` + `source.component`, or the agent's `sourceFile`), so a file only
// covers related elements and verifies on its own. Nodes without a source stay rule-only.
let entries = [];
for (const kind of ['failure', 'review', 'suggestion']) {
  if (!kindsSet.has(kind)) continue;
  for (const group of groupFindings(splitByComponent(findings.filter((f) => f.kind === kind)))) {
    const ruleId = group.rule ?? slug(group.title ?? group.key);
    const source = group.source ?? 'none';
    const comp = group.items[0].component ?? null;
    const ruleKey = `${kind}:${source}:${ruleId}`;
    entries.push({ kind, group, ruleId, source, comp, ruleKey, fullKey: comp ? `${ruleKey}@${comp.key}` : ruleKey });
  }
}
if (onlySet) entries = entries.filter((e) => onlySet.has(e.ruleId));
const unassigned = assignChanges(entries);

// Filenames + deterministic collision suffixes (V13): two distinct keys that slug to the same
// `fix-<kind>-<source>-<rule>[--<component>].md` both get `-<first 6 of sha1(fullKey)>`
// appended (not just the second one), so the result never depends on iteration order.
const byBase = new Map();
for (const e of entries) {
  e.base = `fix-${slug(e.kind)}-${slug(e.source)}-${slug(e.ruleId)}${e.comp ? `--${e.comp.slug}` : ''}`;
  if (!byBase.has(e.base)) byBase.set(e.base, []);
  byBase.get(e.base).push(e);
}
for (const list of byBase.values()) {
  const collide = list.length > 1;
  for (const e of list) e.filename = collide ? `${e.base}-${groupId(e.fullKey)}.md` : `${e.base}.md`;
}
entries.sort((a, b) => a.filename.localeCompare(b.filename));

const inventoryPlans = loadInventoryPlans();

let ready = 0;
let draft = 0;
const draftNotes = [];
const planNotes = [];
for (const e of entries) {
  const { status, markdown, problems, planHits } = buildFixFile(e);
  fs.writeFileSync(path.join(runDir, e.filename), markdown);
  if (status === 'ready') ready++;
  else {
    draft++;
    draftNotes.push(problems.length ? `${e.filename}: ${problems.join('; ')}` : `${e.filename}: add "changes" + "reviewed": true for "${e.ruleId}" in annotations.json`);
  }
  if (planHits.length) planNotes.push(`${e.filename}: changes text an inventory step uses (${planHits.map((h) => `"${h.text}"`).join(', ')}); see "Inventory steps" in the file`);
}
// Stale fix files (F14): a full regeneration removes files an earlier run of this script
// wrote that are no longer produced; partial runs (--only/--kinds) only add to the manifest.
const manifestPath = path.join(runDir, 'fixes-manifest.json');
const previous = readJson(manifestPath, { files: [] }).files ?? [];
const produced = entries.map((e) => e.filename);
const partial = Boolean(args.only || args.kinds);
const removed = [];
if (!partial) {
  for (const f of previous) {
    if (produced.includes(f) || !/^fix-[^/\\]+\.md$/.test(f)) continue;
    const abs = path.join(runDir, f);
    if (fs.existsSync(abs)) { fs.rmSync(abs); removed.push(f); }
  }
}
fs.writeFileSync(manifestPath, JSON.stringify({ files: partial ? [...new Set([...previous, ...produced])].sort() : produced }, null, 2) + '\n');
console.log(`${ready} ready, ${draft} draft`);
for (const line of draftNotes) console.log(line);
for (const line of planNotes) console.log(line);
for (const line of unassigned) console.log(line);
if (removed.length) console.log(`removed stale: ${removed.join(', ')}`);

// ---------------------------------------------------------------- split by component

function componentOf(f, n) {
  const file = n?.source?.file ?? String(f.sourceFile ?? '').split(',')[0].trim().replace(/:\d+(-\d+)?$/, '');
  if (!file) return null;
  const name = n?.source?.file ? n.source.component ?? null : null;
  const parts = normalizeSlashes(file).split('/');
  let base = parts.at(-1).replace(/\.[^.]+$/, '');
  if (/^(index|page|main)$/i.test(base) && parts.length > 1) base = parts.at(-2);
  const label = [base, name].filter((x, i, a) => x && a.findIndex((y) => y?.toLowerCase() === x.toLowerCase()) === i);
  return { key: name ? `${file}#${name}` : file, file, name, slug: slug(label.join('-')) };
}

function splitByComponent(list) {
  const out = [];
  for (const f of list) {
    const base = f.group ?? `${f.source}:${f.rule ?? f.title}`;
    if (!f.nodes?.length) {
      const comp = componentOf(f, null);
      out.push({ ...f, component: comp, group: comp ? `${base}@${comp.key}` : base });
      continue;
    }
    const parts = new Map();
    for (const n of f.nodes) {
      const comp = componentOf(f, n);
      const k = comp?.key ?? '';
      if (!parts.has(k)) parts.set(k, { comp, nodes: [] });
      parts.get(k).nodes.push(n);
    }
    for (const [k, p] of parts) out.push({ ...f, nodes: p.nodes, component: p.comp, group: k ? `${base}@${k}` : base });
  }
  return out;
}

// Annotations are usually keyed by rule, so a change has to be routed to the component file it
// edits: the file that renders the node wins, then a file in the owner chain (a call site),
// then the rule-only file. A change matching none is kept on every file of that rule.
function assignChanges(list) {
  const notes = [];
  const files = (e, chain) => new Set(e.group.items.flatMap((f) => (f.nodes?.length ? f.nodes : [{}]).flatMap((n) => {
    if (!chain) return [n.source?.file ?? e.comp?.file].filter(Boolean);
    return (n.source?.chain ?? []).map((c) => c.file).filter(Boolean);
  })));
  for (const e of list) {
    e.ann = annotationFor(e.group);
    e.primaryFiles = files(e, false);
    e.chainFiles = files(e, true);
  }
  const byRule = new Map();
  for (const e of list) byRule.set(e.ruleKey, [...(byRule.get(e.ruleKey) ?? []), e]);
  for (const sibs of byRule.values()) {
    const keyOf = (c) => `${c.file}:${c.line}:${c.endLine ?? c.line}:${c.proposed}`;
    const all = new Map();
    for (const e of sibs) for (const c of e.ann.changes) all.set(keyOf(c), c);
    const owners = new Map();
    for (const [k, c] of all) {
      const has = sibs.filter((e) => e.ann.changes.some((x) => keyOf(x) === k));
      let to = has.filter((e) => e.primaryFiles.has(c.file));
      if (!to.length) to = has.filter((e) => e.chainFiles.has(c.file));
      if (!to.length) to = has.filter((e) => !e.comp);
      if (!to.length) {
        to = has;
        if (has.length > 1) notes.push(`${c.file}:${c.line}: change matches no component of "${has[0].ruleId}"; kept on all ${has.length} files (key it by finding id in annotations.json to target one)`);
      }
      owners.set(k, new Set(to));
    }
    for (const e of sibs) e.changes = e.ann.changes.filter((c) => owners.get(keyOf(c)).has(e));
  }
  return notes;
}

// ---------------------------------------------------------------- fix file rendering

function buildFixFile(e) {
  const { kind, group, ruleId, source, comp } = e;
  const ann = { ...e.ann, changes: e.changes };
  const problems = ann.changes.flatMap((c, i) => validateChange(c).map((m) => `change ${i + 1}: ${m}`));
  const status = ann.reviewed && ann.changes.length && !problems.length ? 'ready' : 'draft';
  const planHits = planTextHits(ann.changes, group);
  const issue = e.fullKey;
  const anchor = `${SECTION_ID[kind]}-${slug(group.key.split('@')[0])}`; // report.html groups by rule
  const targetCount = new Set(group.items.map((f) => f.target)).size;
  const occ = [...group.occ].sort(occCompare);
  const primary = occ[0];

  const table = [
    `| Status | ${status} |`,
    `|---|---|`,
    `| Issue | \`${issue}\`${group.impact ? ` · ${group.impact}` : ''} |`,
    `| Component | ${comp ? `\`${cell(comp.name ? `${comp.name} (${comp.file})` : comp.file)}\`` : '— (no source; all elements of this rule)'} |`,
    `| WCAG | ${wcagRow(group)} |`,
    `| Occurrences | ${occ.length} element${occ.length === 1 ? '' : 's'} on ${targetCount} target${targetCount === 1 ? '' : 's'} |`,
    `| Report | [report.html#${anchor}](report.html#${anchor}) |`,
    ...(kind === 'suggestion' ? [`| Conformance | Optional; not required for WCAG ${results.config?.level ?? results.level ?? ''} conformance |`] : []),
  ].join('\n');

  const fixBody = ann.fix
    ? ann.fix.trim()
    : kind === 'suggestion'
      ? 'Optional improvement. If you choose to address it, add a fix recommendation and mark reviewed:true in annotations.json'
      : 'Add a fix recommendation and mark reviewed:true in annotations.json';
  const whyLine = ann.why ? `\n\n**Why:** ${ann.why.trim()}` : '';
  const changesBody = (ann.changes.length ? ann.changes.map((c, i) => changeBlock(c, i + 1)).join('\n\n') : fallbackChangesNote(group, ruleId, e.ann.changes.length))
    + (problems.length ? `\n\n**Not ready:** ${problems.join('; ')}` : '')
    + (ann.changes.length && !ann.reviewed ? '\n\n**Not ready:** set "reviewed": true on every annotation of this group once the changes are checked' : '')
    + planSection(planHits);

  const occTable = ['| # | Where | Element | Source | Before |', '|---|---|---|---|---|', ...occ.map((o, i) => occRow(o, i + 1))].join('\n');
  const summaryText = primary?.n?.summary ? `\n\nSummary: ${flatten(primary.n.summary)}` : '';
  const reproLines = reproSteps(primary, occ.length).map((s, i) => `${i + 1}. ${s}`).join('\n');

  const fixFilePathRel = normalizeSlashes(path.relative(process.cwd(), path.join(runDir, e.filename)));
  const manual = kind === 'review' || source === 'agent';
  const fixedWhen = manual
    ? `Automated checks can't prove this one: a clean re-run (targets reached, checks complete, no new failures) ends as \`needs review\`. Compare the before/after shots in fix-report.html, then write \`<run>/verify/<timestamp>/agent-verdicts.json\` as \`{"${issue}": {"status": "fixed" | "not fixed", "note": "..."}}\` and re-render with \`node "${VERIFY_SCRIPT}" --render-only <run>\`.`
    : `Fixed when all listed targets are reached, every check from the baseline completes, \`${ruleId}\` ran and flags none of the listed elements (relocated or confirmed removed), and no new failures appear on those targets.`;

  const verifyJson = {
    version: 1,
    status,
    issue,
    source,
    rule: ruleId,
    component: comp ? { file: comp.file, name: comp.name } : null,
    kind,
    wcag: group.wcag,
    baseline: '.',
    config: buildConfigBlock(),
    targets: buildVerifyTargets(group),
    informational: { git: results.config?.git ?? null, files: filesInfo(ann.changes) },
  };

  const markdown = `# Fix: ${group.title ?? ruleId}${comp ? ` — ${comp.name ?? comp.file.split('/').pop()}` : ''}

${table}

## Fix
${fixBody}${whyLine}

## Changes
${changesBody}

## Occurrences
${occTable}${summaryText}

## Reproduce
${reproLines}

## Verify
\`node "${VERIFY_SCRIPT}" "${fixFilePathRel}"\`
${fixedWhen}

\`\`\`json a11y-verify
${JSON.stringify(verifyJson, null, 2)}
\`\`\`
`;

  return { status, markdown, problems, planHits };
}

// A change is only "ready" when it can be applied as written: the file exists, `line`..`endLine`
// is a real range inside it and `proposed` is text.
function validateChange(c) {
  const out = [];
  const abs = c.file ? path.resolve(sourceRootAbs, c.file) : null;
  const exists = abs && fs.existsSync(abs) && fs.statSync(abs).isFile();
  if (!c.file) out.push('missing "file"');
  else if (!exists) out.push(`file not found: ${c.file}`);
  if (!Number.isInteger(c.line) || c.line < 1) out.push('"line" must be an integer >= 1');
  else if (exists) {
    const len = fs.readFileSync(abs, 'utf8').split(/\r?\n/).length;
    const end = c.endLine ?? c.line;
    if (c.line > len) out.push(`"line" ${c.line} is past the end of ${c.file} (${len} lines)`);
    else if (!Number.isInteger(end) || end < c.line || end > len) out.push(`"endLine" must be an integer between ${c.line} and ${len}`);
  }
  if (typeof c.proposed !== 'string') out.push('"proposed" must be a string');
  return out;
}

// Inventory plans of the group's targets, keyed by target key (null when the inventory can't be
// loaded; the check is advisory).
function loadInventoryPlans() {
  const file = results.config?.inventory?.file;
  if (!file) return null;
  try {
    const inv = loadInventory(path.resolve(runDir, file));
    const keys = (results.targets ?? []).map((t) => t.key);
    return new Map(resolveTargets(inv, { targets: keys }).map((t) => [t.key, t.plan]));
  } catch {
    return null;
  }
}

function literalTargetTexts(target, out = []) {
  if (!target || typeof target !== 'object') return out;
  for (const k of ['name', 'label', 'text', 'placeholder']) {
    const v = target[k];
    if (typeof v === 'string' && v.trim() && !/^\/.*\/[a-z]*$/.test(v)) out.push(v);
  }
  if (target.within) literalTargetTexts(target.within, out);
  return out;
}

// Changes whose current lines contain a literal name/label/text an inventory step of an
// affected target locates by, and whose proposed text drops it: verify would then fail to
// reach the target (F11).
function planTextHits(changes, group) {
  if (!inventoryPlans || !changes.length) return [];
  const keys = new Set(group.items.map((f) => f.target));
  const texts = new Map();
  for (const key of keys) {
    for (const step of inventoryPlans.get(key) ?? []) {
      for (const t of literalTargetTexts(step.target)) {
        if (!texts.has(t)) texts.set(t, new Set());
        texts.get(t).add(key);
      }
    }
  }
  const hits = [];
  for (const c of changes) {
    const abs = c.file ? path.resolve(sourceRootAbs, c.file) : null;
    if (!abs || !fs.existsSync(abs) || !Number.isInteger(c.line)) continue;
    const current = fs.readFileSync(abs, 'utf8').split(/\r?\n/).slice(c.line - 1, c.endLine ?? c.line).join('\n');
    const proposed = String(c.proposed ?? '');
    for (const [text, tkeys] of texts) {
      // Whole string literal or text node only (quote/tag delimited), so a short step name
      // like a heading doesn't match every longer string that happens to contain it.
      const re = new RegExp(`(^|["'\`>])\\s*${text.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(["'\`<]|$)`, 'im');
      if (re.test(current) && !re.test(proposed) && !hits.some((h) => h.text === text)) hits.push({ text, targets: [...tkeys].sort() });
    }
  }
  return hits;
}

function planSection(hits) {
  if (!hits.length) return '';
  return `\n\n### Inventory steps\nThis change removes text that inventory steps locate by, so verify would not reach these targets:\n${hits.map((h) => `- "${cell(h.text)}": ${h.targets.map((k) => `\`${k}\``).join(', ')}`).join('\n')}\n\nBefore verifying, change those step names in the inventory to a regex that matches both the old and new text (e.g. \`"/^Start of name/i"\`) and run verify with \`--accept-plan-change\`.`;
}

// Merges `fix`/`why`/`reviewed`/`changes` across every raw finding in the group: annotations
// are applied by rule (shared across all occurrences) or by id (mergeAgentInput already put
// both on each finding), so scanning every item picks up either and de-dupes `changes`.
function annotationFor(group) {
  const items = group.items;
  const reviewed = items.every((f) => f.reviewed === true);
  const fix = items.map((f) => f.fix).find((v) => typeof v === 'string' && v.trim()) ?? null;
  const why = items.map((f) => f.why).find((v) => typeof v === 'string' && v.trim()) ?? null;
  const seen = new Set();
  const changes = [];
  for (const f of items) {
    for (const c of f.changes ?? []) {
      const key = `${c.file}:${c.line}:${c.endLine ?? c.line}:${c.proposed}`;
      if (seen.has(key)) continue;
      seen.add(key);
      changes.push(c);
    }
  }
  changes.sort((a, b) => (a.file || '').localeCompare(b.file || '') || (a.line ?? 0) - (b.line ?? 0));
  return { reviewed, fix, why, changes };
}

function changeBlock(c, num) {
  const endLine = c.endLine ?? c.line;
  const lang = langFor(c.file ?? '');
  const abs = c.file ? path.resolve(sourceRootAbs, c.file) : null;
  let current;
  if (abs && fs.existsSync(abs)) {
    const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    const from = Math.max(1, c.line ?? 1);
    const to = Math.min(lines.length, endLine ?? from);
    current = `\`\`\`${lang}\n${lines.slice(from - 1, to).join('\n')}\n\`\`\``;
  } else {
    current = `_File not found: \`${c.file ?? '(no file)'}\`_`;
  }
  const proposed = `\`\`\`${lang}\n${c.proposed ?? ''}\n\`\`\``;
  return `### ${num}. \`${c.file ?? '?'}:${c.line ?? '?'}-${endLine ?? '?'}\`\nCurrent:\n${current}\nProposed:\n${proposed}`;
}

// No annotated changes: point at what to grep for instead of a diff (plan's "No source" note,
// applied generally whenever there's nothing to show a before/after of).
function fallbackChangesNote(group, ruleId, otherChanges) {
  const locs = [...new Set([
    ...group.occ.flatMap((o) => (o.n?.source?.file ? [`${o.n.source.file}:${o.n.source.line ?? '?'}${o.n.source.component ? ` (${o.n.source.component})` : ''}`] : [])),
    ...group.items.map((f) => f.sourceFile).filter(Boolean),
  ])].slice(0, 8);
  const selectors = [...new Set(group.occ.map((o) => o.n?.selector).filter(Boolean))].slice(0, 5).map((s) => `\`${cell(s)}\``);
  const names = [...new Set(group.occ.map((o) => o.n?.identity?.name).filter(Boolean))].slice(0, 3).map((n) => `"${cell(n)}"`);
  const known = locs.length ? `Known locations:\n${locs.map((l) => `- \`${cell(l)}\``).join('\n')}` : `No source location known; grep for: ${[...selectors, ...names].join(', ') || 'the selectors/names in Occurrences above'}`;
  const head = otherChanges ? 'None of the annotated changes edits this component (they belong to other fix files of this rule).' : 'No reviewed change supplied.';
  return `${head}\n\n${known}\n\nNext: add \`changes\` (\`[{file, line, endLine, proposed}]\`) and \`"reviewed": true\` for "${ruleId}" in annotations.json, then re-run fixes.mjs.`;
}

function occRow(o, num) {
  const t = targetsByKey.get(o.f.target);
  const nodeless = !o.f.nodes?.length;
  const where = t ? `${cell(t.feature.name)} › ${cell(t.screen.name)} · ${cell(t.state.name)} · ${cell(t.viewport.name)}` : cell(o.f.target);
  const also = o.also.length
    ? ` (+ ${o.also
        .map((a) => {
          const at = targetsByKey.get(a.target);
          return at ? `${cell(at.screen.name)} · ${cell(at.state.name)} · ${cell(at.viewport.name)}` : cell(a.target);
        })
        .join(', ')})`
    : '';
  const element = nodeless ? '—' : elementCell(o.n);
  const source = nodeless ? '—' : sourceCell(o.n.source);
  const before = nodeless || !o.n.screenshot ? '—' : `![](${o.n.screenshot})`;
  return `| ${num} | ${where}${also} | ${element} | ${source} | ${before} |`;
}

function elementCell(n) {
  const d = elementDisplay(n);
  return d ? `\`${cell(d)}\`` : '—';
}

// Tag + classes, derived like `lib/findings.mjs`'s `elementKey` (same "strip generated ids,
// keep everything that identifies the element") but condensed to a CSS-selector-ish string
// for the table instead of the full opening tag.
function elementDisplay(n) {
  const m = (n.html ?? '').match(/^<([a-zA-Z0-9-]+)([^>]*)>/);
  if (m) {
    const cls = m[2]
      .match(/class="([^"]*)"/)?.[1]
      ?.trim()
      .split(/\s+/)
      .filter(Boolean) ?? [];
    return cls.length ? `${m[1]}.${cls.join('.')}` : m[1];
  }
  return n.selector || n.identity?.tag || null;
}

// Primary location plus up to two more owner-chain entries: the primary file can be a
// shared wrapper, and the call site to edit is usually one of the components that rendered it.
function sourceCell(source) {
  if (!source || !source.file) return '—';
  const loc = `${source.file}:${source.line ?? '?'}`;
  const chain = (source.chain ?? []).slice(1, 3).map((c) => `\`${cell(`${c.component ?? '?'} ${c.file}:${c.line ?? '?'}`)}\``);
  return `\`${cell(loc)}\`${source.component ? ` (\`${cell(source.component)}\`)` : ''}${chain.length ? `<br>owner chain: ${chain.join(' ← ')}` : ''}`;
}

function reproSteps(primary, count) {
  const repro = (primary?.f?.repro ?? []).filter((s) => !/^Inspect \d+ element/.test(s));
  if (count === 1 && primary?.n?.selector) repro.push(`Inspect the element matching \`${primary.n.selector}\``);
  else if (count > 1) repro.push(`Inspect the ${count} elements listed in Occurrences above`);
  else repro.push('Inspect the affected element(s) listed in Occurrences above');
  return repro;
}

function occCompare(a, b) {
  return a.f.target.localeCompare(b.f.target) || occId(a).localeCompare(occId(b));
}

function occId(o) {
  if (!o.f.nodes?.length) return `${o.f.id}#-`;
  const idx = o.f.nodes.indexOf(o.n);
  return `${o.f.id}#${idx < 0 ? '-' : idx}`;
}

function wcagRow(group) {
  if (!group.wcag.length) return '—';
  if (group.wcag.length === 1) {
    const num = group.wcag[0];
    const lvl = scInfo(criteria, num)?.level;
    return `${scMdLink(num)}${lvl ? ` · ${lvl}` : ''}`;
  }
  return group.wcag.map((num) => `${scMdLink(num)}${scInfo(criteria, num)?.level ? ` (${scInfo(criteria, num).level})` : ''}`).join(', ');
}

function scMdLink(num) {
  const c = scInfo(criteria, num);
  const text = c?.title ? `${num} ${c.title}` : num;
  return c?.url ? `[${text}](${c.url})` : text;
}

function langFor(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return { css: 'css', scss: 'scss', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'tsx', html: 'html', vue: 'vue', svelte: 'svelte', json: 'json' }[ext] ?? '';
}

// ---------------------------------------------------------------- a11y-verify JSON block

function buildConfigBlock() {
  const c = results.config ?? {};
  return {
    level: c.level ?? results.level ?? null,
    checks: c.checks ?? [],
    maxTabs: c.maxTabs ?? null,
    viewports: c.viewports ?? {},
    engines: c.engines ?? {},
    inventory: c.inventory ?? null,
    sourceRoot: sourceRootRel,
  };
}

// One entry per target the group has raw (non-deduped) occurrences on - unlike the Markdown
// Occurrences table (which groups identical elements across targets via `elementKey`), every
// target must be individually verifiable, so this walks `group.items` (the original findings)
// rather than `group.occ`.
function buildVerifyTargets(group) {
  const byTarget = new Map();
  for (const f of group.items) {
    if (!byTarget.has(f.target)) byTarget.set(f.target, []);
    const arr = byTarget.get(f.target);
    if (f.nodes?.length) f.nodes.forEach((n, i) => arr.push(buildNodeJson(f, n, i)));
    else arr.push({ id: `${f.id}#-`, nodeless: true });
  }
  return [...byTarget.keys()].sort().map((key) => ({
    key,
    planHash: targetsByKey.get(key)?.planHash ?? null,
    ...(targetsByKey.get(key)?.policyHash ? { policyHash: targetsByKey.get(key).policyHash } : {}),
    nodes: byTarget.get(key).sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

function buildNodeJson(f, n, i) {
  return {
    id: `${f.id}#${i}`,
    context: { phase: f.context?.phase ?? 'main' },
    ...(f.modality ? { modality: f.modality, stepIndex: f.stepIndex ?? null, journey: f.journey ?? null } : {}),
    selector: n.selector ?? null,
    identity: n.identity ? { tag: n.identity.tag, role: n.identity.role, name: n.identity.name, ordinal: n.identity.ordinal, count: n.identity.count } : null,
    source: n.source?.file ? { file: n.source.file, line: n.source.line ?? null } : null,
    box: n.box ?? null,
    before: n.screenshot ?? null,
  };
}

// Informational only (D9): sha256 of each file this fix's own annotated `changes` touch.
function filesInfo(changes) {
  const out = {};
  for (const file of new Set(changes.map((c) => c.file).filter(Boolean))) {
    const abs = path.resolve(sourceRootAbs, file);
    if (fs.existsSync(abs)) out[file] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  }
  return out;
}

// ---------------------------------------------------------------- helpers

function cell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function flatten(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeSlashes(p) {
  return String(p).split(path.sep).join('/');
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
