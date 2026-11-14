// Pure helpers for grouping/identifying findings. Shared by report.mjs and
// (in later tasks) fixes.mjs/verify.mjs so grouping stays consistent everywhere.
import crypto from 'node:crypto';

// Merges engine findings with agent-supplied findings and annotations, then
// drops anything the agent dismissed. Mirrors the logic report.mjs used to
// inline before this file existed.
export function mergeAgentInput(findings, extra, annotations) {
  return [...findings, ...extra.map((f, i) => ({ id: f.id ?? `agent-${i + 1}`, source: 'agent', ...f }))]
    .map((f) => ({ ...f, ...(annotations[f.rule] ?? {}), ...(annotations[f.id] ?? {}) }))
    .filter((f) => f.kind !== 'dismissed');
}

export function groupFindings(list) {
  const groups = new Map();
  for (const f of list) {
    const key = f.group ?? `${f.source}:${f.rule ?? f.title}`;
    if (!groups.has(key)) groups.set(key, { key, title: f.title, description: f.description, impact: f.impact, wcag: [], source: f.source, rule: f.rule, helpUrl: f.helpUrl, fix: f.fix, sourceFile: f.sourceFile, items: [], byEl: new Map() });
    const g = groups.get(key);
    g.items.push(f);
    // The same element on several screens/states/viewports is one occurrence.
    for (const n of f.nodes?.length ? f.nodes : [{}]) {
      const el = elementKey(n) || `${f.id}`;
      const o = g.byEl.get(el);
      if (o) {
        o.also.push(f);
        if (!o.n.screenshot && n.screenshot) Object.assign(o, { f, n });
      } else g.byEl.set(el, { f, n, also: [] });
    }
    for (const sc of f.wcag ?? []) if (!g.wcag.includes(sc)) g.wcag.push(sc);
    if (rank(f.impact) < rank(g.impact)) g.impact = f.impact;
  }
  for (const g of groups.values()) {
    g.occ = [...g.byEl.values()];
    for (const o of g.occ) o.also = [...new Set(o.also.map((a) => a.target))].filter((x) => x !== o.f.target).map((target) => ({ target }));
  }
  return [...groups.values()].sort((a, b) => rank(a.impact) - rank(b.impact) || b.occ.length - a.occ.length);
}

// Generated ids (React useId etc.) differ between runs and viewports, so compare tags without them.
export function elementKey(n) {
  const tag = (n.html ?? '').match(/^<[^>]*>/)?.[0];
  return tag ? tag.replace(/\s(id|for|aria-(labelledby|describedby|controls|owns|activedescendant))="[^"]*"/g, '') + (n.summary ?? '') : n.selector ?? '';
}

export function rank(i) {
  return { critical: 0, serious: 1, moderate: 2, minor: 3 }[i] ?? 4;
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Short, deterministic, collision-safe suffix for ids/filenames derived from a
// group key (e.g. fix-<kind>-<source>-<rule>.md). Not wired into report.mjs's
// own anchors/slugs yet; future tasks (fixes.mjs) append this when two
// distinct keys slug to the same string.
export function groupId(key) {
  return crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 6);
}
