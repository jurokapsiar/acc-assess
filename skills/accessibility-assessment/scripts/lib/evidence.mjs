// Per-phase evidence capture: box (document coords), identity and source for every
// retained finding node. Captured in the page and phase where the check ran, before
// that context closes (D5) - callers must invoke this before navigating away or closing
// the page/context that produced the findings.
//
// `context` shape: { phase: 'main'|'keyboard'|'text-spacing'|'overlay'|'reflow', viewport: {width,height}, page: 'fresh'|'live',
//   source: 'auto'|'off', sourceRoot: <absolute dir>, sourceAttrs: [<attr names>], sourceCache: <Map shared across the run> }
// Matches axe's current retention cap (10 nodes/rule, see assess.mjs's `rule.nodes.slice(0, 10)`);
// every retained node gets evidence, independent of the lower per-target crop/screenshot limit.
import { resolveSources } from './source.mjs';

// Attribute `applyProbes` tags relocated live elements with (T6/D10). Stripped from any
// reported `html`/`selector` strings so it never leaks into results.json/report output.
export const PROBE_ATTR = 'data-a11y-probe';
// Scratch attribute used only inside a single relocation pass (tier 2's source-based
// candidate re-querying); always removed before applyProbes returns.
const TMP_ATTR = 'data-a11y-relocate-tmp';
// Sentinel a tier helper returns when its candidate set (after filtering) was non-empty but
// not unique and not resolvable (e.g. count mismatch for ordinal) - distinct from `null`
// (no candidates at all, i.e. that tier simply didn't apply). The spec's `unresolved` outcome
// explicitly includes "ambiguity" as a cause distinct from "no live element" (`confirmed-removed`),
// so relocateOne() must tell the two apart rather than falling through to confirmed-removed.
const AMBIGUOUS = '__a11y_ambiguous__';

export async function captureNodes(page, findings, context) {
  const sourceMode = context.source ?? 'auto';
  for (const f of findings) {
    f.context = { phase: context.phase, viewport: context.viewport, page: context.page ?? 'live' };
    for (const node of f.nodes ?? []) {
      node.box = null;
      node.inScope = null;
      node.identity = null;
      if (sourceMode !== 'off') node.source = null; // resolved below; `--source off` omits the key entirely
      node.probe = null; // set below when a prior applyProbes() call marked this element
      if (!node.selector || node.framed) {
        node.html = stripProbeAttr(node.html);
        continue;
      }
      try {
        const data = await page.evaluate(captureNodeInPage, { selector: node.selector, scope: context.scope ?? null, probeAttr: PROBE_ATTR });
        if (data) {
          node.box = data.box;
          node.inScope = data.inScope;
          node.identity = data.identity;
          node.probe = data.probe;
        }
      } catch {
        // element not locatable in this phase/page (detached, hidden, or selector not resolvable)
      }
      // `node.html`/`node.selector` may have been captured (by axe/checks.mjs) after an
      // earlier applyProbes() call tagged the element in this same phase; axe-core in
      // particular echoes the live outerHTML, attribute and all.
      node.html = stripProbeAttr(node.html);
      node.selector = stripProbeAttr(node.selector);
    }
    f.scopeSignal = scopeSignalOf(f.nodes ?? [], context.scope);
  }
  if (sourceMode !== 'off') {
    const nodes = findings.flatMap((f) => f.nodes ?? []);
    await resolveSources(page, nodes, { root: context.sourceRoot, attrs: context.sourceAttrs, cache: context.sourceCache });
  }
  return findings;
}

/** in: no scope selector or some node is inside it; out: every located node is outside; unknown: nothing could be located. */
export function scopeSignalOf(nodes, scope) {
  if (!scope) return 'in';
  const known = nodes.filter((n) => typeof n.inScope === 'boolean');
  if (!known.length) return 'unknown';
  return known.some((n) => n.inScope) ? 'in' : 'out';
}

function stripProbeAttr(s) {
  return s ? s.replace(new RegExp(`\\s*${PROBE_ATTR}="[^"]*"`, 'g'), '') : s;
}

// Runs in the page. Pure function (no outer closures) so it can cross the page.evaluate boundary.
function captureNodeInPage({ selector, scope, probeAttr }) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const box = { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
  const roleOf = (e) => e.getAttribute('role') || e.localName;
  const nameOf = (e) => {
    const lb = e.getAttribute('aria-labelledby');
    const lbText = lb ? lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ') : '';
    const text = (e.innerText || e.textContent || '').trim().slice(0, 120);
    return e.getAttribute('aria-label') || lbText || text || e.getAttribute('title') || e.getAttribute('alt') || '';
  };
  const tag = el.localName;
  const role = roleOf(el);
  const name = nameOf(el);
  const text = (el.innerText || el.textContent || '').trim().slice(0, 120);
  const root = (scope && document.querySelector(scope)) || document.body;
  const scopeEl = scope ? document.querySelector(scope) : null;
  const inScope = scope ? (scopeEl ? scopeEl.contains(el) : null) : null;
  const same = [...root.querySelectorAll('*')].filter((e) => e.localName === tag && roleOf(e) === role && nameOf(e) === name);
  const ordinal = Math.max(0, same.indexOf(el));
  return { box, inScope, identity: { tag, role, name, text, ordinal, count: same.length || 1 }, probe: el.getAttribute(probeAttr) || null };
}

// ------------------------------------------------------------------ --probe relocation (T6/D10)
//
// Relocates each baseline probe node in the *live* page for one check phase and tags the
// match with `data-a11y-probe="<id>"` so later `captureNodes()` calls on this same phase can
// read `node.probe` back off the real finding elements (exact, no after-side fuzzy matching).
//
// Tiers (§6), each only considered when its compared fields are non-empty on *both* sides and
// the candidate set is unique; assignment is one-to-one (`PROBE_ATTR` is both the claim marker
// and the exclusion filter for every later tier/probe in this same pass):
//   1. `selector` -> exactly one live element, agreeing on tag (+ role/name when both present).
//   2. `source.file:line` + tag (+ role/name when present); `ordinal` only when live count ==
//      baseline `identity.count` for that exact group.
//   3. role + name (+ tag), unique within scope.
//   4. visible text (>= 3 chars) + tag, unique within scope.
// Outcomes: `found` (marker set; box = the relocated element's current box), `confirmed-removed`
// (no tier 2-4 candidate, but the node had a strong identity - non-empty source line or
// role+name - and the screen was reached; box = the baseline box, nothing to mark) or
// `unresolved` (anything else - never treated as a fix, see lib/verify.mjs's decide()).
//
// Simplification vs. the literal tier-1 wording: this implementation's tier 1 agreement check
// is tag (+ role/name when both sides have it); it does not also accept a lone "same source
// line" agreement when role/name are empty on either side (that case falls through to tier 2,
// which performs the same source-line comparison with a full candidate scan instead).
export async function applyProbes(page, probes, phase, opts = {}) {
  const { scope = null, sourceRoot, sourceAttrs, sourceCache, sourceMode = 'auto' } = opts;
  const list = (probes ?? []).filter((p) => !p.phase || p.phase === phase);
  if (!list.length) return [];
  // Only sweep the scratch attribute (defensive, in case a prior call crashed mid-tier-2);
  // PROBE_ATTR markers from earlier phases on this same page must survive - a target can run
  // several phases (main/keyboard/text-spacing) on one page before its context closes, and a
  // later phase's captureNodes() still needs to read markers an earlier phase's probes set.
  await page.evaluate((tmpAttr) => document.querySelectorAll(`[${tmpAttr}]`).forEach((e) => e.removeAttribute(tmpAttr)), TMP_ATTR).catch(() => {});

  const results = [];
  for (const p of list) {
    if (p.nodeless) {
      results.push({ id: p.id, relocation: 'nodeless', via: null, box: null });
      continue;
    }
    const outcome = await relocateOne(page, p, { scope, sourceRoot, sourceAttrs, sourceCache, sourceMode });
    results.push({ id: p.id, ...outcome });
  }
  return results;
}

async function relocateOne(page, p, ctx) {
  const { scope, sourceRoot, sourceAttrs, sourceCache, sourceMode } = ctx;
  const id = p.identity ?? {};
  let ambiguous = false; // set when any tier saw a non-empty but non-unique/unresolvable candidate set

  if (p.selector) {
    const r = await page
      .evaluate(tier1InPage, { scope, selector: p.selector, tag: id.tag || null, role: id.role || null, name: id.name || null, probeAttr: PROBE_ATTR, markId: p.id })
      .catch(() => null);
    if (r === AMBIGUOUS) ambiguous = true;
    else if (r) return { relocation: 'found', via: 'selector', box: r.box };
  }

  if (sourceMode !== 'off' && p.source?.file && p.source.line != null && id.tag) {
    const r = await tier2(page, p, { scope, sourceRoot, sourceAttrs, sourceCache }).catch(() => null);
    if (r === AMBIGUOUS) ambiguous = true;
    else if (r) return { relocation: 'found', via: 'source', box: r.box };
  }

  if (id.role && id.name) {
    const r = await page
      .evaluate(tier3InPage, { scope, role: id.role, name: id.name, tag: id.tag || null, probeAttr: PROBE_ATTR, markId: p.id })
      .catch(() => null);
    if (r === AMBIGUOUS) ambiguous = true;
    else if (r) return { relocation: 'found', via: 'role-name', box: r.box };
  }

  if (id.text && id.text.trim().length >= 3 && id.tag) {
    const r = await page
      .evaluate(tier4InPage, { scope, text: id.text.trim(), tag: id.tag, probeAttr: PROBE_ATTR, markId: p.id })
      .catch(() => null);
    if (r === AMBIGUOUS) ambiguous = true;
    else if (r) return { relocation: 'found', via: 'text', box: r.box };
  }

  const strongIdentity = !!(p.source?.file && p.source.line != null) || !!(id.role && id.name);
  // Ambiguous candidates (seen but not uniquely resolvable) are explicitly an `unresolved`
  // cause per the spec, distinct from "no live element at all" (`confirmed-removed`).
  if (strongIdentity && !ambiguous) return { relocation: 'confirmed-removed', via: null, box: p.box ?? null };
  return { relocation: 'unresolved', via: null, box: null };
}

// Tier 1: selector -> exactly one unclaimed live element, agreeing on tag (+ role/name).
// Returns `AMBIGUOUS` when the selector matches more than one unclaimed element (distinct
// from zero matches, which is just a stale/neutral selector and returns null).
function tier1InPage({ scope, selector, tag, role, name, probeAttr, markId }) {
  const AMBIGUOUS = '__a11y_ambiguous__';
  const root = (scope && document.querySelector(scope)) || document.body;
  let list;
  try {
    list = [...root.querySelectorAll(selector)];
  } catch {
    list = [];
  }
  list = list.filter((e) => !e.hasAttribute(probeAttr));
  if (list.length === 0) return null;
  if (list.length > 1) return AMBIGUOUS;
  const el = list[0];
  if (tag && el.localName !== tag) return null;
  if (role && name) {
    const roleOf = (e) => e.getAttribute('role') || e.localName;
    const nameOf = (e) => {
      const lb = e.getAttribute('aria-labelledby');
      const lbText = lb ? lb.split(/\s+/).map((i) => document.getElementById(i)?.textContent?.trim()).filter(Boolean).join(' ') : '';
      const text = (e.innerText || e.textContent || '').trim().slice(0, 120);
      return e.getAttribute('aria-label') || lbText || text || e.getAttribute('title') || e.getAttribute('alt') || '';
    };
    if (roleOf(el) !== role || nameOf(el) !== name) return null;
  }
  el.setAttribute(probeAttr, markId);
  const r = el.getBoundingClientRect();
  return { box: r.width && r.height ? { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } : null };
}

// Tier 2: source.file:line + tag (+ role/name); ordinal only when live count == baseline count.
async function tier2(page, p, { scope, sourceRoot, sourceAttrs, sourceCache }) {
  const id = p.identity ?? {};
  const candidates = await page
    .evaluate(
      ({ scope, tag, role, name, probeAttr, tmpAttr }) => {
        const root = (scope && document.querySelector(scope)) || document.body;
        const roleOf = (e) => e.getAttribute('role') || e.localName;
        const nameOf = (e) => {
          const lb = e.getAttribute('aria-labelledby');
          const lbText = lb ? lb.split(/\s+/).map((i) => document.getElementById(i)?.textContent?.trim()).filter(Boolean).join(' ') : '';
          const text = (e.innerText || e.textContent || '').trim().slice(0, 120);
          return e.getAttribute('aria-label') || lbText || text || e.getAttribute('title') || e.getAttribute('alt') || '';
        };
        let all = [...root.querySelectorAll(tag)];
        if (role && name) all = all.filter((e) => roleOf(e) === role && nameOf(e) === name);
        return all.map((e, i) => {
          e.setAttribute(tmpAttr, String(i));
          const r = e.getBoundingClientRect();
          return { tmpId: String(i), claimed: e.hasAttribute(probeAttr), box: r.width && r.height ? { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } : null };
        });
      },
      { scope, tag: id.tag, role: id.role || null, name: id.name || null, probeAttr: PROBE_ATTR, tmpAttr: TMP_ATTR },
    )
    .catch(() => []);
  if (!candidates.length) return null;

  const nodesForSource = candidates.map((c) => ({ selector: `[${TMP_ATTR}="${c.tmpId}"]` }));
  await resolveSources(page, nodesForSource, { root: sourceRoot, attrs: sourceAttrs, cache: sourceCache });
  const matches = candidates.filter((c, i) => nodesForSource[i].source?.file === p.source.file && nodesForSource[i].source?.line === p.source.line);

  // `matches` intentionally still includes elements another probe in this same batch already
  // claimed (via this or an earlier tier) - excluding them here would shrink the live count
  // for every probe processed after the first in a same-source-line group, so `id.count`
  // (captured once, at baseline time, as the TOTAL such elements) would never match again
  // past the first. Only the actual assignment step below refuses to reuse a claimed element.
  let chosen = null;
  let ambiguous = false;
  if (matches.length === 1) chosen = matches[0].claimed ? null : matches[0];
  else if (matches.length > 1) {
    if (id.count != null && id.ordinal != null && matches.length === id.count) {
      const picked = matches[id.ordinal] ?? null;
      chosen = picked && !picked.claimed ? picked : null;
    }
    if (!chosen) ambiguous = true; // multiple source-line matches but ordinal/count didn't disambiguate
  }

  if (chosen) {
    await page
      .evaluate(({ tmpId, probeAttr, tmpAttr, markId }) => {
        const e = document.querySelector(`[${tmpAttr}="${tmpId}"]`);
        if (e) e.setAttribute(probeAttr, markId);
      }, { tmpId: chosen.tmpId, probeAttr: PROBE_ATTR, tmpAttr: TMP_ATTR, markId: p.id })
      .catch(() => {});
  }
  await page.evaluate((tmpAttr) => document.querySelectorAll(`[${tmpAttr}]`).forEach((e) => e.removeAttribute(tmpAttr)), TMP_ATTR).catch(() => {});
  if (chosen) return { box: chosen.box };
  return ambiguous ? AMBIGUOUS : null;
}

// Tier 3: role + name (+ tag), unique within scope. Returns `AMBIGUOUS` for >1 candidates
// (distinct from zero, which is just "no such role+name live" and returns null).
function tier3InPage({ scope, role, name, tag, probeAttr, markId }) {
  const AMBIGUOUS = '__a11y_ambiguous__';
  const root = (scope && document.querySelector(scope)) || document.body;
  const roleOf = (e) => e.getAttribute('role') || e.localName;
  const nameOf = (e) => {
    const lb = e.getAttribute('aria-labelledby');
    const lbText = lb ? lb.split(/\s+/).map((i) => document.getElementById(i)?.textContent?.trim()).filter(Boolean).join(' ') : '';
    const text = (e.innerText || e.textContent || '').trim().slice(0, 120);
    return e.getAttribute('aria-label') || lbText || text || e.getAttribute('title') || e.getAttribute('alt') || '';
  };
  const all = [...root.querySelectorAll('*')].filter((e) => !e.hasAttribute(probeAttr) && roleOf(e) === role && nameOf(e) === name && (!tag || e.localName === tag));
  if (all.length === 0) return null;
  if (all.length > 1) return AMBIGUOUS;
  const el = all[0];
  el.setAttribute(probeAttr, markId);
  const r = el.getBoundingClientRect();
  return { box: r.width && r.height ? { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } : null };
}

// Tier 4: visible text (>= 3 chars, already trimmed by the caller) + tag, unique within scope.
// Returns `AMBIGUOUS` for >1 candidates (distinct from zero, see tier3InPage above).
function tier4InPage({ scope, text, tag, probeAttr, markId }) {
  const AMBIGUOUS = '__a11y_ambiguous__';
  const root = (scope && document.querySelector(scope)) || document.body;
  const textOf = (e) => (e.innerText || e.textContent || '').trim().slice(0, 120);
  const all = [...root.querySelectorAll(tag)].filter((e) => !e.hasAttribute(probeAttr) && textOf(e) === text);
  if (all.length === 0) return null;
  if (all.length > 1) return AMBIGUOUS;
  const el = all[0];
  el.setAttribute(probeAttr, markId);
  const r = el.getBoundingClientRect();
  return { box: r.width && r.height ? { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } : null };
}
