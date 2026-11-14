// Ground source (a): the inventory itself (§6.3a). Pure - no fs, no browser. Flattens
// features/screens/states into a catalogue, then scores every `intent.include` phrase and
// `quotedStrings` entry against it with the same token-Jaccard + substring algorithm as the
// reference skill's `textSimilarity` (kept here, not reused from anywhere, since nothing else
// in this repo already has it).
export function tokenize(s) {
  return (String(s ?? '').toLowerCase().match(/[a-z0-9]+/g)) ?? [];
}

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size && !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return union ? inter / union : 0;
}

/** Token-Jaccard + substring bonus, 0..1. Exact (case-insensitive) string equality is handled
 * by the caller as a hard 1.0 (id/key matches), not here. */
export function textSimilarity(a, b) {
  const an = String(a ?? '').trim().toLowerCase();
  const bn = String(b ?? '').trim().toLowerCase();
  if (!an || !bn) return 0;
  if (an === bn) return 1;
  const j = jaccard(tokenize(an), tokenize(bn));
  const sub = an.includes(bn) || bn.includes(an) ? 0.35 : 0;
  return Math.min(1, j * 0.65 + sub);
}

/** Flattens an inventory into scorable catalogue entries: one per feature, screen, screen
 * state and feature-level state. `ref` is what a journey segment / `--feature|--screen|--state`
 * would use to address it; `names` is every string worth matching against (name, id, trigger
 * text, ready name, source globs). */
export function buildCatalogue(inv) {
  const entries = [];
  for (const f of inv.features ?? []) {
    entries.push({ kind: 'feature', ref: f.id, names: [f.id, f.name ?? f.id] });
    for (const fs_ of f.states ?? []) {
      entries.push({ kind: 'featureState', ref: `${f.id}.${fs_.id}`, names: [fs_.id, fs_.name ?? fs_.id] });
    }
    for (const s of f.screens ?? []) {
      const names = [s.id, s.name ?? s.id, s.type, triggerName(s.trigger), s.ready ? readyName(s.ready) : null, ...(s.source ?? [])].filter(Boolean);
      entries.push({ kind: 'screen', ref: s.id, names, feature: f.id, type: s.type ?? 'page' });
      for (const st of s.states ?? []) {
        entries.push({ kind: 'state', ref: `${s.id}.${st.id}`, names: [st.id, st.name ?? st.id], feature: f.id, screen: s.id });
      }
    }
  }
  return entries;
}

function triggerName(t) {
  if (!t) return null;
  if (typeof t === 'string') return t;
  return t.name ?? t.text ?? t.label ?? null;
}
function readyName(r) {
  if (typeof r === 'string') return null;
  return r?.name ?? r?.text ?? r?.label ?? null;
}

/** Scores one phrase against the whole catalogue. Exact id/key equality (case-insensitive,
 * against `ref` or any plain segment of it) scores 1.0; otherwise the best `textSimilarity`
 * across the entry's `names`. Returns candidates with score >= 0.18, top 8, sorted descending;
 * `ambiguous: true` when the top two are within 0.1 of each other. */
export function scorePhrase(phrase, catalogue) {
  const scored = catalogue.map((entry) => {
    const idParts = entry.ref.split('.');
    const exact = idParts.some((p) => p.toLowerCase() === String(phrase).trim().toLowerCase()) || entry.ref.toLowerCase() === String(phrase).trim().toLowerCase();
    const score = exact ? 1 : Math.max(0, ...entry.names.map((n) => textSimilarity(phrase, n)));
    return { id: entry.ref, kind: entry.kind, ref: entry.ref, score, evidence: [{ inventory: entry.ref }] };
  });
  const kept = scored.filter((c) => c.score >= 0.18).sort((a, b) => b.score - a.score).slice(0, 8);
  const ambiguous = kept.length >= 2 && kept[0].score - kept[1].score < 0.1;
  return { candidates: kept, ambiguous };
}

/** Grounds every `intent.include[].phrase` and `intent.quotedStrings[]` against the inventory.
 * `existingTargetKeys` (precomputed by the caller via the sibling `resolveTargets`, with no
 * filters) is passed through unchanged for the proposal/validate step - this module never
 * imports the sibling skill (kept pure, per §14). */
export function groundInventory(inv, intent, { existingTargetKeys = [] } = {}) {
  const catalogue = buildCatalogue(inv);
  const byPhrase = {};
  for (const inc of intent.include ?? []) byPhrase[inc.phrase] = scorePhrase(inc.phrase, catalogue);
  for (const q of intent.quotedStrings ?? []) if (!(q in byPhrase)) byPhrase[q] = scorePhrase(q, catalogue);
  return { source: 'inventory', byPhrase, existingTargetKeys };
}
