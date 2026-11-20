// Shared HTML/CSS rendering helpers for report.mjs and fix-report (verify.mjs). Kept
// framework-free: plain template strings only. Palette, charts, section-title rows and the
// sticky nav follow files/report-design.md (reddish/amber/stone tints, radial charts with
// non-colour patterns, a CSS-first sticky nav, Scope meters updated purely by :has()).
import { slug } from './findings.mjs';

// ------------------------------------------------------------------ icons + pattern defs

// 16px line icons, aria-hidden; meaning is always also carried by adjacent text (a label, a
// chip, a legend entry) so none of these is the only way to tell sections/kinds apart.
const ICONS = {
  summary: '<circle cx="8" cy="8" r="6.25"/><path d="M8 1.75V8h6.25"/>',
  criteria: '<path d="M2 4.2l1.4 1.4L6 3M2 10.2l1.4 1.4L6 9M8.5 4.5H14M8.5 10.5H14"/>',
  issues: '<circle cx="8" cy="8" r="6.25"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/>',
  review: '<circle cx="8" cy="8" r="6.25"/><path d="M6.2 6.4a1.85 1.85 0 1 1 2.5 1.7c-.45.2-.7.55-.7 1v.4"/><path d="M8 11.3v.2"/>',
  suggestions: '<path d="M5.6 10.3a4 4 0 1 1 4.8 0c-.4.3-.6.7-.6 1.2v.5H6.2v-.5c0-.5-.2-.9-.6-1.2zM6.3 14h3.4"/>',
  scope: '<path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3"/><rect x="5" y="5" width="6" height="6" rx="1"/>',
  fixes: '<circle cx="8" cy="8" r="6.25"/><path d="M5.3 8.2l1.8 1.8 3.6-3.8"/>',
  journeys: '<circle cx="2.5" cy="12.5" r="1.3"/><path d="M2.5 11.2c0-6 3-8 5.5-8s5.5 2 5.5 8"/><circle cx="13.5" cy="12.5" r="1.3"/>',
  modalities: '<rect x="1.75" y="4.75" width="12.5" height="7.5" rx="1.5"/><path d="M4.5 7.5h1M7.5 7.5h1M10.5 7.5h1M5 10h6"/>',
};

export function icon(name, cls = 'ico') {
  return `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;
}

// Shared SVG <defs> (hatch/dot patterns) emitted once per page; ring segments reference them
// via fill="url(#p-…)" so status never depends on colour alone (WCAG 1.4.1/1.4.11).
export const PATTERN_DEFS = `<svg class="defs" aria-hidden="true" focusable="false" width="0" height="0"><defs>
<pattern id="p-fail" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--c-fail)"/><rect width="2" height="6" fill="var(--c-fail-ink)"/></pattern>
<pattern id="p-review" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--c-review)"/><circle cx="3" cy="3" r="1.15" fill="var(--c-review-ink)"/></pattern>
<pattern id="p-regressed" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" fill="var(--c-fail)"/><rect width="2" height="6" fill="var(--c-fail-ink)"/></pattern>
</defs></svg>`;

// Status -> fill + legend label, shared by Success criteria rings/table and the fix report's
// before/after columns.
export const STATUS = {
  fail: { fill: 'url(#p-fail)', label: 'Fail' },
  review: { fill: 'url(#p-review)', label: 'Review' },
  checked: { fill: 'var(--c-pass)', label: 'No issues detected' },
  unevaluated: { fill: '#c9d3e6', label: 'Not evaluated (partial run)' },
  manual: { fill: 'var(--c-manual)', label: 'Manual check' },
};

// ------------------------------------------------------------------ charts (portable)

// Half-donut gauge as filled annular-sector <path>s (no stroke-dasharray, so print/zoom stay
// crisp): a flat edge at the bottom, the arc sweeping the top 180° clockwise from 9 o'clock to
// 3 o'clock. segments: [{ value, fill, mark? }], a white gap between segments. `ringBox` pairs
// the bare gauge with a label placed inside the arc's empty lower half (the total, plain text)
// — the ring itself is aria-hidden since the label, legend and/or table beside it already
// carry the information.
export function ring({ segments, size = 132, thickness = 18, gap = 2.5, track = true }) {
  const c = size / 2, r1 = c - 1, r0 = r1 - thickness;
  const sweep = 0.5, start = -sweep / 2;
  const total = segments.reduce((n, s) => n + s.value, 0);
  const live = segments.filter((s) => s.value > 0);
  const gapT = live.length > 1 ? gap / (2 * Math.PI * ((r0 + r1) / 2)) : 0;
  const pt = (r, t) => `${(c + r * Math.sin(2 * Math.PI * t)).toFixed(2)} ${(c - r * Math.cos(2 * Math.PI * t)).toFixed(2)}`;
  const sector = (a0, a1) => {
    const large = a1 - a0 > 0.5 ? 1 : 0;
    return `M${pt(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${pt(r1, a1)}L${pt(r0, a1)}A${r0} ${r0} 0 ${large} 0 ${pt(r0, a0)}Z`;
  };
  let a = 0, out = track ? `<path d="${sector(start, start + sweep)}" fill="var(--c-track)"/>` : '';
  for (const s of live) {
    const span = total ? (s.value / total) * sweep : 0;
    const a0 = start + a + gapT / 2, a1 = start + a + span - gapT / 2;
    out += `<path d="${sector(a0, Math.max(a0 + 0.002, a1))}" fill="${s.fill}" fill-rule="evenodd"/>`;
    if (s.mark && span / sweep > 0.07) {
      const [x, y] = pt((r0 + r1) / 2, start + a + span / 2).split(' ');
      out += `<circle cx="${x}" cy="${y}" r="7.5" fill="#fff" stroke="var(--ink)" stroke-width="1"/><text x="${x}" y="${y}" dy=".35em" text-anchor="middle" class="ring-mark">${esc(s.mark)}</text>`;
    }
    a += span;
  }
  return `<svg class="ring-svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true" focusable="false">${out}</svg>`;
}

export function ringBox(svg, labelHtml, cls = '') {
  return `<div class="ring ${cls}">${svg}${labelHtml ? `<p class="ring-c">${labelHtml}</p>` : ''}</div>`;
}

export function swatch(fill) {
  return `<svg class="sw" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><rect x=".5" y=".5" width="11" height="11" rx="2.5" fill="${fill}" stroke="var(--ink)" stroke-opacity=".45"/></svg>`;
}

export function legend(items) {
  return `<ul class="legend">${items.map((i) => `<li>${swatch(i.fill)}<span class="lg-l">${i.label}</span><span class="lg-v">${i.value}</span></li>`).join('')}</ul>`;
}

// ------------------------------------------------------------------ section heads + nav

export function secHead(id, key, title, count, aside = '') {
  return `<div class="sec-head t-${key}"><h2 id="${id}-h">${icon(key)}<span>${esc(title)}</span>${count != null ? ` <span class="pill">${count}</span>` : ''}</h2>${aside ? `<p class="sec-aside">${esc(aside)}</p>` : ''}</div>`;
}

// `items`: [{ id, key, label, count? }], already filtered to sections that exist (a report
// with no Suggestions simply has no Suggestions nav link).
export function stickyNav(brand, items) {
  return `<nav class="topnav" aria-label="Report sections"><div class="topnav-in">
  <a class="brand" href="#top">${esc(brand)}</a>
  <ul>${items.map((i) => `<li><a class="nl t-${i.key}" href="#${i.id}">${icon(i.key)}<span>${esc(i.label)}</span>${i.count != null ? `<span class="nc">${i.count}</span>` : ''}</a></li>`).join('')}</ul>
</div></nav>`;
}

// Sticky-nav "current section" fallback (the only page-wide JS); `:target-current` covers
// this in engines that support it (render-design.md §6).
const NAV_SCRIPT = `<script>(function(){
if(!(window.CSS&&CSS.supports('selector(:target-current)'))&&'IntersectionObserver' in window){var ls=[].slice.call(document.querySelectorAll('.topnav a.nl'));var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)ls.forEach(function(l){l.classList.toggle('is-current',l.getAttribute('href')==='#'+e.target.id);});});},{rootMargin:'-60px 0px -70% 0px'});ls.forEach(function(l){var s=document.querySelector(l.getAttribute('href'));if(s)io.observe(s);});}
})();</script>`;

// Dialog-open + dialog-toggle-sync script, emitted once per Scope section (the only JS a
// screenshot dialog needs: there is no declarative way to call `showModal()`; everything else
// is native <dialog>/:has() behaviour). Kept local to scopeSection() so pages/tests that
// render just the section (no pageHtml wrapper) still get working dialogs. The selector is
// page-wide (not scoped to `.scope`) so the User journeys section's text-only screen links can
// open the very same `<dialog id="dlg-N">` elements the Scope section already renders.
const DIALOG_SCRIPT = `<script>(function(){
document.querySelectorAll('[data-dialog]').forEach(function(b){b.addEventListener('click',function(){var d=document.getElementById(b.getAttribute('data-dialog'));if(!d||typeof d.showModal!=='function')return;
d.querySelectorAll('input[data-kind]').forEach(function(c){var g=document.getElementById('g-'+c.dataset.kind);c.checked=!!(g&&g.checked);});d.showModal();});});
})();</script>`;

// Wraps the common <!doctype html>…<body>…</body></html> scaffold so every report shares one
// <head>/CSS/skip-link/pattern-defs/script. `title` must already be escaped by the caller.
// `body` already contains its own header + stickyNav() markup, in that order (the spec's
// wireframe: page header first, then the sticky nav immediately below it).
export function pageHtml(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${css()}</style>
</head>
<body id="top">
<a class="skip" href="#main">Skip to content</a>
${PATTERN_DEFS}
${body}
${NAV_SCRIPT}
</body>
</html>`;
}

// kind -> chip icon/label/marker style, shared by report.html's issue/review/suggestion cards
// and fix-report.html's attempt cards (kind 'fixed' reuses the fixes icon/colour).
const KIND_CHIP = {
  failure: { icon: 'issues', label: 'Issue' },
  review: { icon: 'review', label: 'Needs review' },
  suggestion: { icon: 'suggestions', label: 'Suggestion' },
  fixed: { icon: 'fixes', label: 'Fixed' },
};

// `opts.kind` selects the card tint (`k-<kind>`) and chip; `opts.marker` is the small numbered
// circle in the heading (solid for issues, dashed for review/suggestion) that connects this
// card to the summary ring/legend/issue-map row carrying the same marker.
export function groupHtml(g, section, scLinkFn, ctx, opts = {}) {
  const kind = opts.kind ?? 'failure';
  const chip = KIND_CHIP[kind] ?? KIND_CHIP.failure;
  const anchor = `${section}-${slug(g.key)}`;
  const markCls = kind === 'failure' || kind === 'fixed' ? 'mk' : `mk mk-${kind}`;
  return `<article class="issue k-${kind}" id="${anchor}" aria-labelledby="${anchor}-h">
  <header class="issue-head">
    <h3 id="${anchor}-h">${opts.marker != null ? `<span class="${markCls}" aria-hidden="true">${esc(opts.marker)}</span>` : ''}${esc(g.title)}</h3>
    <p class="tags">
      <span class="kind-chip">${icon(chip.icon)}${chip.label}</span>
      ${g.impact ? `<span class="badge ${g.impact}">${esc(g.impact)}</span>` : ''}
      ${g.wcag.map((sc) => `<span class="badge outline">${scLinkFn(sc, true)}</span>`).join('')}
      <span class="badge outline">${esc(g.source)}${g.rule ? `: ${esc(g.rule)}` : ''}</span>
      ${[...new Set((g.items ?? []).map((f) => f.modality).filter(Boolean))].map((m) => `<span class="badge outline">${esc(MODALITY_LABEL[m] ?? m)}</span>`).join('')}
      ${g.helpUrl ? `<a class="help" href="${attr(g.helpUrl)}">Rule details</a>` : ''}
    </p>
  </header>
  <div class="issue-body">
  ${g.description ? `<p>${esc(g.description)}</p>` : ''}
  ${g.fix ? `<div class="fix"><h4>Fix</h4>${para(g.fix)}${g.sourceFile ? `<p class="mono">${esc(g.sourceFile)}</p>` : ''}</div>` : ''}
  <h4>Occurrences <span class="count">${g.occ.length}</span></h4>
  <ol class="occ">${g.occ.map((o) => occurrenceHtml(o, g, ctx)).join('')}</ol>
  </div>
</article>`;
}

export function occurrenceHtml({ f, n, also }, g, { targets, where, paraHtml }) {
  const t = targets.get(f.target);
  return `<li class="occ-item">
    <div class="occ-body">
      <p class="where">${where(t, f.target)}</p>
      ${f.modality ? `<p class="muted">${esc(MODALITY_LABEL[f.modality] ?? f.modality)}${f.journey ? ` · journey ${esc(f.journey)}` : ''}${f.stepIndex != null ? ` · step ${f.stepIndex + 1}` : ''}${f.escalation ? ` · needed ${esc(f.escalation)} to continue` : ''}</p>` : ''}
      ${also.length ? `<details class="also"><summary>Also on ${also.length} more screen${also.length > 1 ? 's' : ''}</summary><ul>${also.map((a) => { const at = targets.get(a.target); return `<li>${at ? esc(`${at.screen.name} · ${at.state.name} · ${at.viewport.name}`) : esc(a.target)}</li>`; }).join('')}</ul></details>` : ''}
      ${n.selector ? `<p class="mono">${esc(n.selector)}</p>` : ''}
      ${sourceHtml(n.source)}
      ${n.html ? `<pre><code>${esc(n.html)}</code></pre>` : ''}
      ${n.summary ? (paraHtml ?? para)(n.summary, 'summary') : ''}
      ${f.fix && f.fix !== g.fix ? `<p><strong>Fix:</strong> ${esc(f.fix)}</p>` : ''}
      <details><summary>Steps to reproduce</summary><ol class="steps">${(f.repro ?? t?.repro ?? []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>
    </div>
    ${n.screenshot ? thumbHtml(n, t) : ''}
  </li>`;
}

// Assess-detected nodes already get a node+padding clip at capture time. A node that points at the
// target's full-page shot (agent findings) is cropped here instead, using its `box` (document space)
// plus padding clamped to the page; the link still opens the full shot. No box or shot size: full image.
function thumbHtml(n, t) {
  const img = `<img src="${attr(n.screenshot)}" alt="Screenshot of the affected element" loading="lazy">`;
  const W = t?.shot?.width, H = t?.shot?.height, b = n.box;
  if (!(b && W > 0 && H > 0 && n.screenshot === t.shot.file && b.width > 0 && b.height > 0)) return `<a class="shot" href="${attr(n.screenshot)}">${img}</a>`;
  const pad = 48;
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
  const w = Math.min(W - x, b.width + pad * 2), h = Math.min(H - y, b.height + pad * 2);
  const pct = (v) => `${+(v * 100).toFixed(3)}%`;
  return `<a class="shot shot-crop" href="${attr(n.screenshot)}" title="Cropped to the element; opens the full screenshot" style="aspect-ratio:${+w.toFixed(1)}/${+h.toFixed(1)};max-width:${Math.round(w)}px">${img.replace('<img ', `<img style="width:${pct(W / w)};left:${pct(-x / w)};top:${pct(-y / h)}" `)}</a>`;
}

// Resolved source location plus the owner chain (when known). The first entry is where the
// element was created, which can be a shared wrapper component; the next entries are the
// components that rendered it, one of which is usually the call site to edit.
export function sourceHtml(source) {
  if (!source?.file) return '';
  const loc = (s) => `${s.file}:${s.line ?? '?'}`;
  const chain = (source.chain ?? []).slice(1, 6);
  return `<p class="mono src">Source: ${esc(loc(source))}${source.component ? ` <span class="muted">(${esc(source.component)})</span>` : ''}</p>${
    chain.length ? `<details class="chain"><summary>Rendered by</summary><ol class="mono">${chain.map((c) => `<li>${esc(c.component ?? '?')} <span class="muted">${esc(loc(c))}</span></li>`).join('')}</ol></details>` : ''
  }`;
}

// ------------------------------------------------------------------ Summary issue map

// `sections`: [{ id, kind, groups, prefix }] in the same order/ids report.mjs used for its own
// `groupSection(title, id, groups, kind, prefix)` calls, so `#${id}-${slug(group.key)}`
// anchors match. `ctx`: { targets, screens (ordered inventory screen ids), totalScreens,
// scLinkFn }. Renders `<table class="imap">` with one tinted `<tbody>` per kind (omitted when
// empty) - rule, impact, criteria, occurrences (bar) and screens (a per-screen strip, or a bar
// + fraction when there are more than 24 screens to keep the row from overflowing).
export function issueMap(sections, { targets, screens, totalScreens, scLinkFn }) {
  const present = sections.filter((s) => s.groups.length);
  if (!present.length) return '';
  const maxOcc = Math.max(1, ...present.flatMap((s) => s.groups.map((g) => g.occ.length)));
  const labelFor = { issues: 'Issues', review: 'Needs review', suggestions: 'Suggestions' };
  const rowsFor = (s) => s.groups.map((g, i) => {
    const anchor = `${s.id}-${slug(g.key)}`;
    const on = screensOf(g, targets);
    const markCls = s.kind === 'failure' ? 'mk' : `mk mk-${s.kind}`;
    const screensCell = screens.length > 24
      ? `<span class="bar" aria-hidden="true"><span style="width:${((on.size / (totalScreens || 1)) * 100).toFixed(1)}%"></span></span><span class="num">${on.size}<span class="of">/${totalScreens}</span></span>`
      : `<span class="strip" aria-hidden="true">${screens.map((id) => `<i${on.has(id) ? ' class="on"' : ''}></i>`).join('')}</span><span class="num">${on.size}<span class="of">/${totalScreens}</span></span>`;
    return `<tr class="k-${s.kind}">
      <td class="c-mk"><span class="${markCls}">${esc(s.prefix ?? '')}${i + 1}</span></td>
      <th scope="row" class="c-t"><a href="#${anchor}">${esc(g.title)}</a><span class="mono src-l">${esc(g.source)}${g.rule ? `: ${esc(g.rule)}` : ''}</span></th>
      <td data-label="Impact">${g.impact ? `<span class="badge ${g.impact}">${esc(g.impact)}</span>` : ''}</td>
      <td data-label="Criteria">${g.wcag.map((sc) => `<span class="badge outline">${scLinkFn(sc, true)}</span>`).join(' ')}</td>
      <td data-label="Occurrences" class="c-bar"><span class="bar" aria-hidden="true"><span style="width:${((g.occ.length / maxOcc) * 100).toFixed(1)}%"></span></span><span class="num">${g.occ.length}</span></td>
      <td data-label="Screens" class="c-strip">${screensCell}</td>
    </tr>`;
  }).join('');
  const kindRow = (s) => `<tr class="kind-row t-${s.id}"><th scope="rowgroup" colspan="6">${icon(s.id)} ${esc(labelFor[s.id] ?? s.id)} <span class="pill">${s.groups.length}</span></th></tr>`;
  const body = present.map((s) => `<tbody>${kindRow(s)}${rowsFor(s)}</tbody>`).join('');
  return `<div class="table-scroll"><table class="imap">
  <caption class="sr">Findings by rule, with impact, criteria, occurrences and screens affected</caption>
  <thead><tr><th scope="col"><span class="sr">Marker</span></th><th scope="col">Rule</th><th scope="col">Impact</th><th scope="col">Criteria</th><th scope="col">Occurrences</th><th scope="col">Screens</th></tr></thead>
  ${body}
</table></div>`;
}

// Every screen the group's occurrences (and their "also on" screens) touch, as a Set of
// inventory screen ids - shared by the summary issue map and anything else that needs "how
// many/which screens does this group affect".
export function screensOf(g, targets) {
  const ids = new Set();
  const add = (key) => { const t = targets.get(key); if (t) ids.add(t.screen.id); };
  for (const o of g.occ) {
    add(o.f.target);
    for (const a of o.also) add(a.target);
  }
  return ids;
}

// The Scope section: a left rail listing *all* inventory screens (assessed or not, features >
// screens > subscreens) with their states/viewports as selectable entries, and a main pane
// showing the selected state/viewport's cropped screenshot + SVG area overlay large. Rail
// navigation is CSS-only (one radio per entry, `:has()` shows the matching panel). Clicking
// the screenshot opens a native <dialog> full-screen view (the only bit that needs JS: there
// is no declarative way to call `showModal()`; everything else - closing, Esc, focus
// trap/return, the issue-list disclosure (a CSS-only checkbox, see `disclosure()`) - is
// native <dialog> behaviour or plain `:has()` CSS, so a no-JS page still shows the large
// screenshot inline, just not full-screen).
//
// `groupSections`: [{ id, groups }] in the same order/ids report.mjs used for its own
// `groupSection(title, id, groups)` calls, so `#${id}-${slug(group.key)}` anchors match.
// Only one set of master toggles exists now (the scope meters bar): per-view duplicate
// checkboxes were removed (§7). A per-view box only ever exists inside that view's own
// full-screen dialog, synced from the master when it opens. `subscreen` is omitted from a
// toggle row entirely when nothing of that kind is present there, rather than shown disabled
// like the other kinds - there is nothing to call it out for.
const TOGGLES = [
  { kind: 'finding', cls: 't-finding', globalLabel: 'Issues', checked: true },
  { kind: 'tabstop', cls: 't-tabstop', globalLabel: 'Tab stops', checked: false },
  { kind: 'scope', cls: 't-scope', globalLabel: 'Scope boxes', checked: true },
  { kind: 'subscreen', cls: 't-subscreen', globalLabel: 'Subscreens', checked: false },
  { kind: 'outscope', cls: 't-outscope', globalLabel: 'Potentially out of scope', checked: false },
];
const OPTIONAL_KINDS = new Set(['subscreen', 'outscope']);

// `findings` is the final list (after agent annotations/dismissals): finding areas whose
// finding is no longer in it (dismissed) are dropped, the drawn kind follows the merged
// finding, and agent findings with a main-phase `box` are drawn too.
// `opts.title`/`opts.note`: heading and intro (the fix report labels its after-run Scope).
export function scopeSection(results, findings, groupSections, opts = {}) {
  const inv = results.inventory ?? { features: [] };
  const totalScreens = inv.features.reduce((n, f) => n + f.screens.length, 0);
  // Screen ids are globally unique (validateInventory), so look children up across every
  // feature, not just the current one's screens array: a screen whose parent lives in a
  // different feature still nests correctly, and is excluded from its own feature's
  // top-level list below so it isn't rendered twice.
  const allScreens = inv.features.flatMap((f) => f.screens);
  const byScreen = new Map();
  for (const t of results.targets ?? []) {
    const arr = byScreen.get(t.screen.id) ?? [];
    arr.push(t);
    byScreen.set(t.screen.id, arr);
  }
  const anchorFor = new Map();
  for (const { id, groups } of groupSections) {
    for (const g of groups) for (const item of g.items) anchorFor.set(item.id, { anchor: `${id}-${slug(g.key)}`, title: g.title });
  }
  const byId = new Map(findings.map((f) => [f.id, f]));
  const outById = new Map((opts.outFindings ?? []).map((f) => [f.id, f]));
  const areasByTarget = new Map();
  for (const t of results.targets ?? []) {
    const list = [];
    for (const a of t.areas ?? []) {
      if (a.kind === 'finding' && a.finding != null) {
        const f = byId.get(a.finding);
        if (f) list.push({ ...a, findingKind: f.kind });
        else if (outById.has(a.finding)) list.push({ ...a, kind: 'outscope', findingKind: outById.get(a.finding).kind });
      } else if (TOGGLES.some((d) => d.kind === a.kind) && a.kind !== 'outscope') list.push(a);
    }
    for (const f of [...findings, ...outById.values()]) {
      if (f.target !== t.key || f.source !== 'agent') continue;
      for (const n of f.nodes ?? []) if (n.box && (!n.phase || n.phase === 'main')) list.push({ kind: outById.has(f.id) ? 'outscope' : 'finding', box: n.box, label: f.title ?? f.rule, finding: f.id, findingKind: f.kind });
    }
    areasByTarget.set(t.key, list);
  }
  const allAreas = [...areasByTarget.values()].flat();
  const globalCounts = Object.fromEntries(TOGGLES.map((d) => [d.kind, allAreas.filter((a) => a.kind === d.kind).length]));
  let viewSeq = 0;
  let firstRadioId = null;
  const panels = [];
  const idRules = [];

  // One selectable rail entry per state (not assessed) or per state x viewport actually run.
  function screenEntries(s, own) {
    const list = [];
    for (const stateId of s.states) {
      const matches = own.filter((t) => t.state.id === stateId);
      if (!matches.length) {
        list.push({ id: `na__${s.id}__${stateId}`, label: titleCase(stateId), note: 'Not assessed', target: null });
        continue;
      }
      for (const t of matches) {
        const note = t.shot ? null
          : t.status === 'blocked' ? `Blocked: ${t.reason}`
            : t.status === 'not-attempted' ? `Not attempted: ${t.reason}`
              : t.status === 'error' ? (t.error ?? 'Not reached') : 'Not reached';
        list.push({ id: t.key, label: `${t.state.name ?? titleCase(stateId)} · ${t.viewport.name}`, target: t.shot ? t : null, note });
      }
    }
    return list;
  }

  function countsFor(e) {
    if (!e.target) return null;
    const areas = areasByTarget.get(e.target.key) ?? [];
    return Object.fromEntries(TOGGLES.map((d) => [d.kind, areas.filter((a) => a.kind === d.kind).length]));
  }

  function issueItemsFor(t) {
    return findings.filter((f) => f.target === t.key && anchorFor.has(f.id));
  }

  function issueListHtml(items) {
    if (!items.length) return '<p class="muted">No issues recorded for this view.</p>';
    // The link and its metadata are on separate block lines (not run together inline): a long
    // title can wrap to several lines, and trailing inline siblings sharing that last line make
    // the link's own line-box geometry ambiguous for corner-sampling focus/overlap checks.
    return `<ul class="issue-list">${items.map((f) => {
      const info = anchorFor.get(f.id);
      return `<li><a href="#${info.anchor}">${esc(f.title ?? info.title)}</a><div class="issue-meta"><span class="mono">${esc(f.source)}${f.rule ? `: ${esc(f.rule)}` : ''}</span>${f.impact ? ` <span class="badge ${f.impact}">${esc(f.impact)}</span>` : ''}${(f.wcag ?? []).map((sc) => ` <span class="badge outline">${esc(sc)}</span>`).join('')}</div></li>`;
    }).join('')}</ul>`;
  }

  // Rail entry: a radio (selection state) + label (visible control); the radio's `checked`
  // attribute on the very first entry is the CSS-only default view, no JS needed.
  function entryHtml(e) {
    const radioId = `rv-${slug(e.id)}`;
    if (firstRadioId == null) firstRadioId = radioId;
    const failN = e.target ? findings.filter((f) => f.target === e.target.key && f.kind === 'failure').length : 0;
    const badge = e.target ? `<span class="badge ${failN ? 'critical' : 'pass'}">${failN}</span>` : `<span class="badge neutral">${esc(e.note ?? 'Not assessed')}</span>`;
    idRules.push(`.scope-layout:has(#${radioId}:checked) [data-panel="${radioId}"]{display:block}`);
    return `<li><label class="entry" for="${radioId}">
      <input type="radio" name="scopeview" id="${radioId}" value="${attr(e.id)}"${radioId === firstRadioId ? ' checked' : ''}>
      <span>${esc(e.label)}</span>
      ${badge}
    </label></li>`;
  }

  // Main-pane panel for one rail entry: the large screenshot (click to open full screen) and
  // the dialog's own highlight toggles. The rail entry already identifies the screen/state/
  // viewport (and carries it in the screenshot's alt text), so the panel itself has no header.
  function panelHtml(s, e) {
    const radioId = `rv-${slug(e.id)}`;
    if (!e.target) return `<div class="panel" data-panel="${radioId}"><p class="not-assessed">${esc(e.note ?? 'Not assessed')}</p></div>`;
    const t = e.target;
    const n = viewSeq++;
    const cutBox = t.cut?.box ?? { x: 0, y: 0, width: t.shot.width, height: t.shot.height };
    const img = t.cut?.file ?? t.shot.file;
    const areas = areasByTarget.get(t.key) ?? [];
    const inside = (a) => overlaps(a.box, cutBox);
    const outside = areas.filter((a) => !inside(a)).length;
    const counts = countsFor(e) ?? {};
    const layers = () => TOGGLES.map((d) => `<g class="l-${d.kind}">${areas.filter((a) => a.kind === d.kind && inside(a)).map((a) => areaRect(a, cutBox)).join('')}</g>`).join('');
    const drawnCount = areas.filter((a) => inside(a) && TOGGLES.some((d) => d.kind === a.kind)).length;
    const alt = attr(`${s.name}, ${t.state.name}, ${t.viewport.name}`);
    const dialogId = `dlg-${n}`;
    opts.dialogMap?.set(t.key, dialogId);
    const items = issueItemsFor(t);
    const mobile = (t.viewport.width ?? 0) < 600;
    const printCounts = TOGGLES.filter((d) => !OPTIONAL_KINDS.has(d.kind) || (counts[d.kind] ?? 0) > 0)
      .map((d) => `${counts[d.kind] ?? 0} ${d.globalLabel.toLowerCase()}`).join(' · ');
    return `<div class="panel" data-panel="${radioId}">
      <figure class="view${mobile ? ' is-mobile' : ''}">
        <button type="button" class="expand" data-dialog="${dialogId}" aria-haspopup="dialog">
          <img src="${attr(img)}" alt="${alt}" loading="lazy">
          <svg viewBox="${cutBox.x} ${cutBox.y} ${cutBox.width} ${cutBox.height}" data-areas="${drawnCount}" aria-hidden="true">${layers()}</svg>
          <span class="expand-hint" aria-hidden="true">⤢ Full screen</span>
        </button>
        <noscript><p><a href="${attr(t.shot.file)}">Open screenshot</a></p></noscript>
        <figcaption>
          ${outside ? `<p class="view-label"><a class="outside" href="${attr(t.shot.file)}" title="Areas outside the cropped view; open the full screenshot">+${outside} outside</a></p>` : ''}
          ${printCounts ? `<p class="print-only">${esc(printCounts)}</p>` : ''}
          ${geometryNoteHtml(t)}
          ${issueLinksHtml(items)}
        </figcaption>
      </figure>
      <dialog class="shot-dialog" id="${dialogId}" aria-label="${attr(`${s.name} full screen, ${t.state.name}, ${t.viewport.name}`)}">
        <div class="dialog-row">
          ${toggleRow(`d${n}`, counts)}
          ${disclosure(`${dialogId}-issues`, `${items.length} issue${items.length === 1 ? '' : 's'}`, issueListHtml(items), { cls: 'issue-count' })}
          <form method="dialog"><button type="submit" class="close">Close</button></form>
        </div>
        <div class="dialog-body${mobile ? ' is-mobile' : ''}" tabindex="0" role="group" aria-label="Scrollable screenshot area">
          <img src="${attr(img)}" alt="${alt}" loading="lazy">
          <svg viewBox="${cutBox.x} ${cutBox.y} ${cutBox.width} ${cutBox.height}" data-areas="${drawnCount}" aria-hidden="true">${layers()}</svg>
        </div>
      </dialog>
    </div>`;
  }

  function geometryNoteHtml(t) {
    const g = t.geometry;
    if (!g) return '';
    const REASON = { 'other-viewport': 'measured at another viewport', 'other-phase': 'found in another check phase', offscreen: 'outside the screenshot', 'not-locatable': 'element not locatable' };
    const known = (id) => byId.has(id) || outById.has(id);
    const byReason = new Map();
    for (const d of g.findingsWithoutBox ?? []) if (known(d.finding)) byReason.set(d.reason, (byReason.get(d.reason) ?? 0) + 1);
    const parts = [...byReason].map(([r, n]) => `${n} issue${n === 1 ? '' : 's'} not drawn: ${REASON[r] ?? r}`);
    if (g.tabstopsWithoutBox) parts.push(`${g.tabstopsWithoutBox} tab stop${g.tabstopsWithoutBox === 1 ? '' : 's'} not drawn: not locatable`);
    if (String(g.scope).startsWith('missing:')) parts.push(`scope box not drawn: ${g.scope.slice(8)}`);
    return parts.length ? `<p class="geo-note">${parts.map(esc).join(' · ')}</p>` : '';
  }

  function issueLinksHtml(items) {
    const map = new Map();
    for (const f of items) {
      const info = anchorFor.get(f.id);
      const cur = map.get(info.anchor) ?? { title: info.title, count: 0 };
      cur.count += f.nodes?.length || 1;
      map.set(info.anchor, cur);
    }
    if (!map.size) return '';
    // One `<li>` per link (not inline text joined by separators): on narrow viewports long
    // titles wrap, and a shared bounding box around several run-in links can visually/
    // geometrically overlap the next link's box, which fails "focus not obscured" checks.
    // Separate block-level list items keep every link's focus rectangle self-contained.
    return `<ul class="view-issues">${[...map.entries()].map(([anchor, v]) => `<li><a href="#${anchor}">${v.count} ${esc(v.title)}</a></li>`).join('')}</ul>`;
  }

  function screenHtml(s) {
    const own = byScreen.get(s.id) ?? [];
    const failCount = own.reduce((n, t) => n + findings.filter((f) => f.target === t.key && f.kind === 'failure').length, 0);
    const failText = `${failCount} failure${failCount === 1 ? '' : 's'}`;
    const children = allScreens.filter((c) => c.parent === s.id);
    const entries = screenEntries(s, own);
    for (const e of entries) panels.push(panelHtml(s, e));
    return `<li class="screen-node">
      <p class="screen-head"><strong>${esc(s.name)}</strong> <span class="muted">${esc(s.type)} · ${failText}</span></p>
      <ul class="entries">${entries.map((e) => entryHtml(e)).join('')}</ul>
      ${children.length ? `<ul class="tree">${children.map((c) => screenHtml(c)).join('')}</ul>` : ''}
    </li>`;
  }

  // Scope meters (replacing the old global toggle row): one small radial chart + master
  // toggle + "N of TOTAL in this view" per kind, updated purely by CSS `:has()` when a rail
  // radio is selected (§7). Every assessed entry gets a `--p-*` custom-property rule and a
  // pair of `<span data-v>` counters (shown only for the selected entry).
  function scopeBarHtml() {
    const rows = TOGGLES.filter((d) => !OPTIONAL_KINDS.has(d.kind) || (globalCounts[d.kind] ?? 0) > 0);
    if (!rows.length) return '';
    const entries = allScreens.flatMap((s) => screenEntries(s, byScreen.get(s.id) ?? []));
    for (const e of entries) {
      const radioId = `rv-${slug(e.id)}`;
      const counts = countsFor(e);
      const vars = rows.map((d) => {
        const n = counts ? counts[d.kind] ?? 0 : 0;
        const g = globalCounts[d.kind] ?? 0;
        return `--p-${d.kind}:${(g ? (n / g) * 100 : 0).toFixed(2)}`;
      }).join(';');
      idRules.push(`.scope:has(#${radioId}:checked){${vars}}`, `.scope:has(#${radioId}:checked) [data-v="${radioId}"]{display:inline}`);
    }
    const pctText = (e, kind) => {
      if (!e.target) return '–';
      const n = countsFor(e)[kind] ?? 0;
      const g = globalCounts[kind] ?? 0;
      if (!g) return '–';
      if (n && n / g < 0.01) return '<1%';
      return `${Math.round((n / g) * 100)}%`;
    };
    const numText = (e, kind) => (e.target ? String(countsFor(e)[kind] ?? 0) : '–');
    return `<div class="scope-bar" role="group" aria-label="Highlights">${rows.map((d) => {
      const g = globalCounts[d.kind] ?? 0;
      const spansP = entries.map((e) => `<span class="vnum-p" data-v="rv-${slug(e.id)}">${pctText(e, d.kind)}</span>`).join('');
      const spansN = entries.map((e) => `<span class="vnum" data-v="rv-${slug(e.id)}">${numText(e, d.kind)}</span>`).join('');
      return `<div class="meter m-${d.kind}">
        <svg class="mring" viewBox="0 0 36 36" aria-hidden="true" focusable="false"><circle class="trk" cx="18" cy="18" r="15.9155"/><circle class="val" cx="18" cy="18" r="15.9155" pathLength="100" style="stroke:var(--m-${d.kind});stroke-dasharray:var(--p-${d.kind}, 0) 100"/></svg>
        <div class="meter-t"><label class="toggle"><input type="checkbox" id="g-${d.kind}" data-kind="${d.kind}"${d.checked ? ' checked' : ''}> ${esc(d.globalLabel)} <span class="count">${g}</span></label>
        <span class="meter-v">${spansP} · ${spansN} <span class="of">of ${g} in this view</span></span></div>
      </div>`;
    }).join('')}</div>`;
  }

  const meters = scopeBarHtml();
  const features = inv.features.filter((f) => f.screens.length);
  const railHtml = features.map((f) => disclosure(`feat-${slug(f.id)}`, `<h3>${esc(f.name)}</h3>`,
    `<ul class="tree">${f.screens.filter((s) => !s.parent || !allScreens.some((g) => g.id === s.parent)).map((s) => screenHtml(s)).join('')}</ul>`,
    { open: true, cls: 'feature' })).join('');
  const mainHtml = panels.join('');
  return `<section id="scope" class="sec scope" aria-labelledby="scope-h">
  ${secHead('scope', 'scope', opts.title ?? 'Scope', totalScreens, opts.note)}
  ${idRules.length ? `<style>${idRules.join('')}</style>` : ''}
  <div class="panel-box">
    ${meters}
    <div class="scope-layout">
      <nav class="rail" aria-label="Screens">${railHtml}</nav>
      <div class="main">${mainHtml}</div>
    </div>
  </div>
  ${DIALOG_SCRIPT}
</section>`;
}

// Deterministic, no-fluff clause for one actionable step in a journey narrative; purely a
// function of the step's recorded action/label (never the literal value typed/selected, to
// stay generic across apps/data).
function journeyClause(st) {
  const label = st.label ? esc(st.label) : null;
  switch (st.action) {
    case 'click': return `clicks ${label ?? 'it'}`;
    case 'dblclick': return `double-clicks ${label ?? 'it'}`;
    case 'hover': return `hovers ${label ?? 'it'}`;
    case 'focus': return `moves focus to ${label ?? 'it'}`;
    case 'fill': return label ? `enters a value in ${label}` : 'enters a value';
    case 'type': return label ? `types in ${label}` : 'types';
    case 'press': return `presses ${esc(st.input?.split(' ').pop() ?? '')}${label ? ` on ${label}` : ''}`;
    case 'check': return `checks ${label ?? 'it'}`;
    case 'uncheck': return `unchecks ${label ?? 'it'}`;
    case 'select': return `selects an option in ${label ?? 'it'}`;
    default: return null;
  }
}

// One `<button data-dialog>` (opens the same `<dialog>` the Scope section renders for this
// target) when the screen was assessed, plain text otherwise - text-only, no thumbnail, per
// the User journeys spec.
function journeyScreenLink(s, dialogMap) {
  const dialogId = s.targetKey ? dialogMap?.get(s.targetKey) : null;
  if (!dialogId) return esc(s.name);
  return `<button type="button" class="journey-link" data-dialog="${dialogId}" aria-haspopup="dialog">${esc(s.name)}</button>`;
}

function journeyNarrative(j, dialogMap) {
  const parts = j.screens.map((s, i) => {
    const clauses = s.steps.filter((st) => st.actionable).map(journeyClause).filter(Boolean);
    const head = `${i === 0 ? 'Opens' : 'opens'} ${journeyScreenLink(s, dialogMap)}`;
    return clauses.length ? `${head}, ${clauses.join(', ')}` : head;
  });
  return `${parts.join('; ')}.`;
}

function journeyActionItems(j) {
  const items = j.screens.flatMap((s) => s.steps.filter((st) => st.actionable));
  if (!items.length) return '';
  return `<ul class="journey-actions">${items.map((st) => `<li><span class="journey-step-label">${esc(st.label ?? '—')}</span><span class="muted">${esc(st.role ?? 'control')}</span> — ${esc(st.input ?? st.device ?? '')} → ${esc(st.action)}</li>`).join('')}</ul>`;
}

// User journeys section: directly below Scope in both the nav and the page (report.mjs wires
// the ordering); only rendered when `journeys` is non-empty (no scope/journeys.json and no
// screen with its own inventory `steps` -> `assess.mjs`'s `results.journeys` is `[]`). Reuses
// the Scope section's own `<dialog>`s via `dialogMap` (target key -> dialog id), built by
// `scopeSection(..., { dialogMap })`, so a journey's screen links open the exact same
// screenshot/checkboxes/issues dialog as the Scope section, not a second copy.
export function journeysSection(journeys, dialogMap) {
  if (!journeys?.length) return '';
  const items = journeys.map((j) => `<li class="journey">
    <h3>${esc(j.title)}</h3>
    <p class="journey-narrative">${journeyNarrative(j, dialogMap)}</p>
    ${journeyActionItems(j)}
  </li>`).join('');
  return `<section id="journeys" class="sec journeys" aria-labelledby="journeys-h">
  ${secHead('journeys', 'journeys', 'User journeys', journeys.length)}
  <div class="panel-box"><ol class="journey-list">${items}</ol></div>
</section>`;
}

export const MODALITY_LABEL = { keyboard: 'Keyboard only', mouse: 'Mouse', 'sr-keyboard': 'Screen reader + keyboard', 'sr-navigation': 'Screen reader navigation' };
const RUN_LABEL = { complete: 'Completed', escalated: 'Completed after a pointer/focus escalation', partial: 'Incomplete', blocked: 'Blocked' };

// Interaction modalities: one row per modality that ran, with run status per target count and
// the failures/reviews it produced. Status is always text, never colour alone. Only rendered
// when at least one target recorded a modality run.
export function modalitySection(results, findings) {
  const runs = (results.targets ?? []).flatMap((t) => (t.modalityRuns ?? []).map((r) => ({ ...r, target: t.key })));
  if (!runs.length) return '';
  const mods = [...new Set(runs.map((r) => r.modality))];
  const rows = mods.map((m) => {
    const mine = runs.filter((r) => r.modality === m);
    const count = (s) => mine.filter((r) => r.status === s).length;
    const found = findings.filter((f) => f.modality === m);
    const status = Object.keys(RUN_LABEL).filter((s) => count(s)).map((s) => `${count(s)} ${RUN_LABEL[s].toLowerCase()}`).join(', ');
    const legacy = mine.every((r) => r.legacy);
    return `<tr><th scope="row">${esc(MODALITY_LABEL[m] ?? m)}</th><td>${mine.length}</td><td>${esc(status)}${legacy ? ' (default pointer-and-keyboard checks)' : ''}</td><td>${found.filter((f) => f.kind === 'failure').length}</td><td>${found.filter((f) => f.kind !== 'failure').length}</td></tr>`;
  }).join('');
  return `<section id="modalities" class="sec modalities" aria-labelledby="modalities-h">
  ${secHead('modalities', 'modalities', 'Interaction modalities', mods.length)}
  <div class="panel-box"><div class="table-scroll"><table class="crit-t" aria-label="Interaction modalities assessed"><thead><tr><th scope="col">Modality</th><th scope="col">Targets</th><th scope="col">Result</th><th scope="col">Failures</th><th scope="col">Review and suggestions</th></tr></thead><tbody>${rows}</tbody></table></div></div>
</section>`;
}

// Dialog's own one-row controls (toggles + issue-count disclosure + close), unaffected by the
// Scope meters master toggles until it is opened (synced then by the shared script).
function toggleRow(idPrefix, counts) {
  const rows = TOGGLES.filter((d) => !OPTIONAL_KINDS.has(d.kind) || (counts[d.kind] ?? 0) > 0);
  if (!rows.length) return '';
  return `<p class="toggles">${rows.map((d) => {
    const id = `${idPrefix}-${d.kind}`;
    const n = counts[d.kind] ?? 0;
    const disabled = n === 0;
    return `<label class="toggle"><input type="checkbox" id="${id}" class="${d.cls}" data-kind="${d.kind}"${!disabled ? ' checked' : ''}${disabled ? ' disabled' : ''}> ${esc(d.globalLabel)} <span class="count">${n}</span></label>`;
  }).join('')}</p>`;
}

function areaRect(a, cutBox) {
  const cls = a.kind === 'scope' ? 'a-scope' : a.kind === 'tabstop' ? 'a-tabstop' : a.kind === 'subscreen' ? 'a-subscreen' : a.kind === 'outscope' ? 'a-out'
    : a.findingKind === 'failure' ? 'a-fail' : a.findingKind === 'review' ? 'a-review' : 'a-suggest';
  const rect = `<rect class="area ${cls}" x="${a.box.x}" y="${a.box.y}" width="${a.box.width}" height="${a.box.height}"><title>${esc(a.label ?? '')}</title></rect>`;
  if (a.kind !== 'tabstop' || !a.label) return rect;
  // Visible tab-order number, sized relative to the drawn view so it stays legible.
  const fs = Math.max(8, Math.round((cutBox?.width ?? 1000) / 30));
  return `${rect}<text class="tab-num" x="${a.box.x + 2}" y="${a.box.y + fs}" font-size="${fs}">${esc(a.label)}</text>`;
}

function overlaps(box, clip) {
  return box.x < clip.x + clip.width && box.x + box.width > clip.x && box.y < clip.y + clip.height && box.y + box.height > clip.y;
}

function titleCase(id) {
  return String(id).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// CSS-only disclosure: a checkbox (not `<details>`) drives a `:has()` rule that shows
// `bodyHtml`. Unlike `<details>`, a plain wrapper `<div>` isn't itself an interactive
// element, so any links/inputs inside `bodyHtml` aren't "nested interactive controls" -
// `<details>` containing another focusable element (a link, a radio) is exactly that,
// even once expanded, so it's avoided anywhere the body isn't plain text.
export function disclosure(id, summaryHtml, bodyHtml, { open = false, cls = '' } = {}) {
  return `<div class="disclosure${cls ? ` ${cls}` : ''}"><input type="checkbox" class="disc-check" id="${attr(id)}"${open ? ' checked' : ''}><label class="disc-label" for="${attr(id)}">${summaryHtml}</label><div class="disc-body">${bodyHtml}</div></div>`;
}

// ---------------------------------------------------------------------------------------
// fix-report.html: same pageHtml()/css()/secHead()/groupHtml()/scopeSection() report.html
// uses, plus its own Summary tiles (verification status + proof-elements-after-fix rings).
// Kept filesystem-free like the rest of the module: verify.mjs loads every results.json/
// agent-verdicts.json this needs and passes plain data.

const STATUS_LABEL = { fixed: 'Fixed', 'not fixed': 'Not fixed', regressed: 'Regressed', unverified: 'Unverified', 'needs review': 'Needs review', 'not yet verified': 'Not yet verified' };
const STATUS_FILL = { fixed: 'var(--c-pass)', 'not fixed': 'url(#p-fail)', regressed: 'url(#p-regressed)', unverified: 'var(--c-manual)', 'needs review': 'url(#p-review)', 'not yet verified': 'var(--c-track)' };
// Effective status -> attempt-card kind/tint (§1b).
const STATUS_KIND = { fixed: 'fixed', 'not fixed': 'failure', regressed: 'failure', unverified: 'suggestion', 'needs review': 'review', 'not yet verified': 'suggestion' };
const BEFORE_LABEL = { failure: 'Fail', review: 'Review', suggestion: 'Suggested', dismissed: 'Dismissed' };
const BEFORE_FILL = { failure: 'url(#p-fail)', review: 'url(#p-review)', suggestion: 'var(--c-manual)', dismissed: 'var(--c-manual)' };
const RESULT_LABEL = { clear: 'clear', flagged: 'still present', removed: 'removed', unresolved: 'unresolved', nodeless: 'n/a' };
const RELOCATION_LABEL = { found: 'found', 'confirmed-removed': 'confirmed removed', unresolved: 'unresolved', nodeless: 'nodeless' };

// Encodes each `/`-separated path segment (handles the literal `#` that verify's own
// `shots/<key>__probe-<phase>-<id>.png` filenames can contain - the id is `F0003#0`, and an
// unescaped `#` in an `href`/`src` is a URL fragment separator, not a filename character,
// which would otherwise silently break every proof-table image link) before HTML-attribute
// escaping it.
export function pathHref(p) {
  return attr(String(p ?? '').split('/').map((seg) => encodeURIComponent(seg)).join('/'));
}

/**
 * Renders `<run>/fix-report.html` from `<run>/fix-report.json` (+ the baseline's own
 * `results.json` for the header/criteria context). Used by both the normal verify.mjs flow
 * (right after appending a new attempt) and `--render-only` (one renderer).
 *
 * `attempts`: the raw `fix-report.json` attempts[] (oldest first), each optionally carrying an
 * `overlay` the caller attached (`{status, note}` from a `verify/<ts>/agent-verdicts.json`
 * written *after* an attempt was stored as `needs review`). The stored `status`/`reason` are
 * never overwritten here; the overlay renders as an annotation alongside them, and also
 * decides which Summary-ring/Criteria bucket that attempt's *latest-per-issue* row counts
 * under (agent verdicts apply only to the latest attempt of that issue).
 * `regressionData`: Map<attempt index (into `attempts`), {groups, targets}> - `groups` is
 * `groupFindings()` output and `targets` a `Map<targetKey, target>`, both resolved from that
 * regression's OWN verify run's results.json by the caller. Attempts with no regressions can
 * be omitted.
 * `scopeData`: the latest attempt's own verify run `results.json` (for "Scope of verified
 * targets"), or null when the latest attempt never produced one (e.g. incompatible config).
 */
// `allFixes` (optional): every `fix-*.md` the fixes-manifest.json for this run currently
// lists, each as `{ filename, meta }` (meta = the file's own parsed a11y-verify block, or
// null if it couldn't be read/parsed). When given, the Fixes section leads with an overview
// row per fix file (rule, component, ready/draft, verification status) covering files that
// were never run through verify.mjs too, not just `attempts`; the proof/regression detail
// below it still only exists for files that do have an attempt. Omitted (older callers/tests),
// the section falls back to attempts-only, as before.
export function fixReportHtml({ baseline, attempts, scLinkFn, regressionData = new Map(), scopeData = null, allFixes = null }) {
  const effective = (a) => (a.overlay ? (a.overlay.status === 'fixed' ? 'fixed' : 'not fixed') : a.status);
  const latestByIssue = new Map();
  for (const a of attempts) latestByIssue.set(a.issue, a);
  const latest = [...latestByIssue.values()];
  const counts = { fixed: 0, 'not fixed': 0, regressed: 0, unverified: 0, 'needs review': 0 };
  for (const a of latest) counts[effective(a)] = (counts[effective(a)] ?? 0) + 1;
  const lastAttempt = attempts.at(-1) ?? null;
  const appName = baseline?.app?.name ?? baseline?.app?.baseUrl ?? '';

  const nav = stickyNav(appName, [
    { id: 'summary', key: 'summary', label: 'Summary' },
    { id: 'criteria', key: 'criteria', label: 'Criteria', count: latest.length },
    { id: 'fixes', key: 'fixes', label: 'Fixes', count: allFixes ? allFixes.length : attempts.length },
    ...(scopeData ? [{ id: 'scope', key: 'scope', label: 'Scope', count: (scopeData.inventory?.features ?? []).reduce((n, f) => n + f.screens.length, 0) }] : []),
  ]);

  const body = `<header class="wrap page-head">
  <h1>Fix verification report</h1>
  <dl class="meta">
    <div><dt>App</dt><dd>${esc(baseline?.app?.name ?? '')} <span class="muted">${esc(baseline?.app?.baseUrl ?? '')}</span></dd></div>
    <div><dt>Standard</dt><dd>${esc(baseline?.standard ?? '')}</dd></div>
    <div><dt>Baseline date</dt><dd>${baseline?.startedAt ? esc(new Date(baseline.startedAt).toLocaleString('en-GB')) : '—'}</dd></div>
    <div><dt>Attempt date</dt><dd>${lastAttempt ? esc(formatStamp(lastAttempt.attempt)) : '—'}</dd></div>
    <div><dt>Engines</dt><dd>${Object.entries(baseline?.engines ?? {}).filter(([, v]) => v).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(' · ')}</dd></div>
  </dl>
</header>
${nav}
<main id="main" class="wrap" tabindex="-1">
  ${fixSummarySection(counts, latest)}
  ${criteriaTable(baseline, latest, effective, scLinkFn)}
  ${verifiedIssuesSection(baseline, attempts, effective, regressionData, scLinkFn, allFixes)}
  ${scopeData ? scopeSection(scopeData, scopeData.findings ?? [], [], { title: 'Scope of the latest verify run', note: 'Automated after-run coverage of the re-checked targets only; not a manual all-clear.' }) : ''}
</main>`;
  return pageHtml(`Fix verification – ${esc(appName)}`, body);
}

function fixSummarySection(counts, latest) {
  const total = latest.length;
  const nodeStatus = { clear: 0, removed: 0, flagged: 0, unresolved: 0 };
  for (const a of latest) for (const n of a.nodes ?? []) if (n.after && nodeStatus[n.after === 'clear' ? 'clear' : n.after === 'removed' ? 'removed' : n.after === 'flagged' ? 'flagged' : n.after === 'unresolved' ? 'unresolved' : ''] !== undefined) {
    nodeStatus[n.after === 'clear' ? 'clear' : n.after === 'removed' ? 'removed' : n.after === 'flagged' ? 'flagged' : 'unresolved'] += 1;
  }
  const nodeTotal = Object.values(nodeStatus).reduce((a, b) => a + b, 0);
  const statusRing = ring({ segments: Object.entries(counts).map(([k, v]) => ({ value: v, fill: STATUS_FILL[k] })) });
  const nodeRing = ring({ segments: [
    { value: nodeStatus.clear, fill: 'var(--c-pass)' },
    { value: nodeStatus.removed, fill: 'var(--c-manual)' },
    { value: nodeStatus.flagged, fill: 'url(#p-fail)' },
    { value: nodeStatus.unresolved, fill: 'url(#p-review)' },
  ] });
  const tiles = `<div class="sum-tiles two">
  <section class="tile" aria-labelledby="t-fx"><h3 id="t-fx">Verification status</h3><div class="tile-body">
  ${ringBox(statusRing, `<strong class="big">${counts.fixed}<small>/${total}</small></strong><span>fixed</span>`)}
  ${legend(Object.entries(counts).map(([k, v]) => ({ fill: STATUS_FILL[k], label: STATUS_LABEL[k], value: v })))}</div></section>
  <section class="tile" aria-labelledby="t-fc"><h3 id="t-fc">Proof elements after fix</h3><div class="tile-body">
  ${ringBox(nodeRing, `<strong class="big">${nodeStatus.clear}<small>/${nodeTotal}</small></strong><span>clear</span>`)}
  ${legend([{ fill: 'var(--c-pass)', label: 'Clear', value: nodeStatus.clear }, { fill: 'var(--c-manual)', label: 'Removed', value: nodeStatus.removed }, { fill: 'url(#p-fail)', label: 'Still present', value: nodeStatus.flagged }, { fill: 'url(#p-review)', label: 'Unresolved', value: nodeStatus.unresolved }])}</div></section>
</div>`;
  return `<section id="summary" class="sec" aria-labelledby="summary-h">${secHead('summary', 'summary', 'Summary', null)}<div class="panel-box">${tiles}</div></section>`;
}

// Issue keys are `<kind>:<source>:<rule>[@<file>[#<component>]]` (one fix file per rule + component).
function issueMeta(baseline, fullKey) {
  const at = String(fullKey ?? '').indexOf('@');
  const issueKey = at < 0 ? fullKey : fullKey.slice(0, at);
  const component = at < 0 ? null : fullKey.slice(at + 1);
  const label = component ? (component.split('#')[1] ?? component.split('/').pop()) : null;
  const i = String(issueKey ?? '').indexOf(':');
  const j = String(issueKey ?? '').indexOf(':', i + 1);
  const kind = i < 0 ? issueKey : issueKey.slice(0, i);
  const source = i < 0 || j < 0 ? '' : issueKey.slice(i + 1, j);
  const rule = i < 0 || j < 0 ? '' : issueKey.slice(j + 1);
  const f = (baseline?.findings ?? []).find((x) => x.kind === kind && x.source === source && x.rule === rule);
  const title = f?.title ?? rule ?? issueKey;
  return { kind, source, rule, title: label ? `${title} — ${label}` : title, impact: f?.impact ?? null, wcag: f?.wcag ?? [] };
}

function criteriaTable(baseline, latest, effective, scLinkFn) {
  const rows = [];
  for (const a of latest) {
    const meta = issueMeta(baseline, a.issue);
    const st = effective(a);
    for (const sc of meta.wcag.length ? meta.wcag : ['—']) rows.push({ sc, title: meta.title, beforeKind: meta.kind, st });
  }
  if (!rows.length) return '';
  rows.sort((a, b) => (a.sc === '—' || b.sc === '—' ? 0 : cmpSc(a.sc, b.sc)));
  return `<section id="criteria" class="sec" aria-labelledby="criteria-h">
  ${secHead('criteria', 'criteria', 'Success criteria', rows.length)}
  <div class="panel-box"><div class="table-scroll"><table class="crit-t">
    <thead><tr><th scope="col">Criterion</th><th scope="col">Issue</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${r.sc === '—' ? '—' : scLinkFn(r.sc, true)}</td><td>${esc(r.title)}</td><td><span class="status">${swatch(BEFORE_FILL[r.beforeKind] ?? 'var(--c-manual)')}${esc(BEFORE_LABEL[r.beforeKind] ?? 'Flagged')}</span></td><td><span class="status">${swatch(STATUS_FILL[r.st])}${esc(STATUS_LABEL[r.st])}</span></td></tr>`).join('')}</tbody>
  </table></div></div>
</section>`;
}

function verifiedIssuesSection(baseline, attempts, effective, regressionData, scLinkFn, allFixes) {
  if (!attempts.length && !allFixes?.length) return '';
  const ordered = attempts.map((a, i) => ({ a, i })).reverse(); // newest first
  const issues = new Set(attempts.map((a) => a.issue)).size;
  const where = new Map((baseline?.targets ?? []).map((t) => [t.key, t]));
  const count = allFixes?.length ?? issues;
  const aside = allFixes?.length
    ? `${attempts.length} attempt${attempts.length === 1 ? '' : 's'} on ${allFixes.length} fix file${allFixes.length === 1 ? '' : 's'}`
    : `${attempts.length} attempt${attempts.length === 1 ? '' : 's'}`;
  return `<section id="fixes" class="sec" aria-labelledby="fixes-h">
  ${secHead('fixes', 'fixes', 'Fixes', count, aside)}
  <div class="panel-box">${allFixes?.length ? fixesOverviewTable(allFixes, attempts, effective, baseline) : ''}${ordered.map(({ a, i }) => attemptArticle(a, i, effective, regressionData, scLinkFn, issueMeta(baseline, a.issue).title, where)).join('\n')}</div>
</section>`;
}

// Overview row per fix file the run's fixes-manifest.json currently lists (not just the ones
// an attempt exists for): rule/component, ready/draft (from the file's own a11y-verify
// `status`), and verification status - the latest attempt for that exact filename if one
// exists, else `not yet verified`. Links down to that attempt's proof article when there is
// one; files that failed to parse (missing/malformed a11y-verify block) still get a row so
// they aren't silently dropped from the overview, with '—' where their metadata would be.
function fixesOverviewTable(allFixes, attempts, effective, baseline) {
  const latestIndexByFile = new Map();
  attempts.forEach((a, i) => latestIndexByFile.set(a.fixFile, i)); // last write wins: latest attempt per file
  const rows = allFixes.map(({ filename, meta }) => {
    const idx = latestIndexByFile.get(filename);
    const st = idx != null ? effective(attempts[idx]) : 'not yet verified';
    const title = meta ? issueMeta(baseline, meta.issue).title : filename;
    const component = meta?.component ? esc(meta.component.name ? `${meta.component.name} (${meta.component.file})` : meta.component.file) : '—';
    const readyBadge = meta ? `<span class="badge outline">${esc(meta.status)}</span>` : '<span class="badge outline">—</span>';
    const link = idx != null ? `<a href="#attempt-${idx}">${esc(filename)}</a>` : `<a href="${pathHref(filename)}">${esc(filename)}</a>`;
    return `<tr><td>${esc(title)}<div class="muted mono">${esc(filename)}</div></td><td>${component}</td><td>${readyBadge}</td><td><span class="status">${swatch(STATUS_FILL[st])}${esc(STATUS_LABEL[st])}</span></td><td>${link}</td></tr>`;
  });
  return `<div class="table-scroll"><table class="crit-t fix-overview">
    <thead><tr><th scope="col">Rule</th><th scope="col">Component</th><th scope="col">Status</th><th scope="col">Verification</th><th scope="col">Fix file</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table></div>`;
}

function attemptArticle(a, index, effective, regressionData, scLinkFn, title, where) {
  const st = effective(a);
  const kind = STATUS_KIND[st] ?? 'suggestion';
  const anchor = `attempt-${index}`;
  const reg = regressionData.get(index);
  const markCls = kind === 'failure' || kind === 'fixed' ? 'mk' : `mk mk-${kind}`;
  const chip = KIND_CHIP[kind] ?? KIND_CHIP.fixed;
  return `<article class="issue k-${kind}" id="${anchor}" aria-labelledby="${anchor}-h">
  <header class="issue-head">
    <h3 id="${anchor}-h"><span class="${markCls}" aria-hidden="true">${index + 1}</span>${esc(title ?? a.issue)} <span class="count mono">${esc(a.issue)}</span></h3>
    <p class="tags">
      <span class="kind-chip">${icon(chip.icon)}${chip.label}</span>
      <span class="status">${swatch(STATUS_FILL[st])}${esc(STATUS_LABEL[st])}</span>
      ${a.checks === 'partial' ? '<span class="badge outline">quick check</span>' : ''}
      <a class="help" href="${pathHref(a.fixFile)}">${esc(a.fixFile)}</a>
    </p>
  </header>
  <div class="issue-body">
  <p>${esc(formatStamp(a.attempt))}${a.reason ? ` — ${esc(a.reason)}` : ''}</p>
  ${agentOverlayNote(a)}
  ${a.warnings?.length ? `<details class="warnings"><summary>Warnings <span class="count">${a.warnings.length}</span></summary><ul>${a.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
  ${proofTable(a, where)}
  <p>Checks <span class="count">${a.counts?.before ?? 0} before → ${a.counts?.after ?? 0} after</span>${a.run ? ` · <a href="${pathHref(a.run)}">verify run</a>` : ''}</p>
  ${regressionScopeSentence(a)}
  ${reg && reg.groups.length ? `<h4>Regressions <span class="count">${reg.groups.length}</span></h4>${reg.groups.map((g, i) => groupHtml(g, `${anchor}-reg`, scLinkFn, { targets: reg.targets, where: whereTarget }, { kind: 'failure', marker: i + 1 })).join('')}` : ''}
  </div>
</article>`;
}

function agentOverlayNote(a) {
  if (!a.overlay) return '';
  const st = a.overlay.status === 'fixed' ? 'fixed' : 'not fixed';
  return `<p class="muted">Agent verdict: <span class="status">${swatch(STATUS_FILL[st])}${esc(STATUS_LABEL[st])}</span>${a.overlay.note ? ` — ${esc(a.overlay.note)}` : ''} (originally computed: ${esc(STATUS_LABEL[a.status] ?? a.status)})</p>`;
}

function proofTable(a, where = new Map()) {
  const whereText = (key) => {
    const t = where.get(key);
    return t ? `${esc(t.screen.name)} <span class="muted">${esc(t.state.name)} · ${esc(t.viewport.name)}</span>` : esc(key ?? '—');
  };
  if (!a.nodes?.length) return '';
  const rows = a.nodes
    .map(
      (n) => `<tr>
    <td data-label="Before">${imgCell(n.before, 'Before fix')}</td>
    <td data-label="After">${imgCell(n.afterShot, n.relocation === 'confirmed-removed' ? 'After fix (element removed)' : 'After fix')}</td>
    <td data-label="Where">${whereText(n.target)}</td>
    <td data-label="Relocation">${esc(RELOCATION_LABEL[n.relocation] ?? n.relocation ?? '—')}${n.via ? ` <span class="muted">via ${esc(n.via)}</span>` : ''}</td>
    <td data-label="Result">${esc(RESULT_LABEL[n.after] ?? n.after ?? '—')}</td>
  </tr>`,
    )
    .join('');
  return `<h4>Proof</h4>
  <div class="table-scroll"><table class="proof">
    <thead><tr><th scope="col">Before</th><th scope="col">After</th><th scope="col">Where</th><th scope="col">Relocation</th><th scope="col">Result</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function imgCell(p, label) {
  if (!p) return '—';
  const href = pathHref(p);
  return `<a class="shot" href="${href}"><img src="${href}" alt="${attr(label)}" loading="lazy"></a>`;
}

function regressionScopeSentence(a) {
  const rs = a.regressionScope ?? { targets: [], checks: [] };
  const n = rs.targets?.length ?? 0;
  const checksText = rs.checks?.length ? rs.checks.join(', ') : 'no checks';
  return `<p class="muted">Re-checked ${n} target${n === 1 ? '' : 's'} with: ${esc(checksText)}; other screens not re-checked.</p>`;
}

function whereTarget(t, fallback) {
  return t ? `${esc(t.feature.name)} › ${esc(t.screen.name)} <span class="muted">${esc(t.state.name)} · ${esc(t.viewport.name)} ${t.viewport.width}×${t.viewport.height}</span>` : esc(fallback ?? '');
}

function formatStamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return String(s ?? '');
  const [, y, mo, d, h, mi, se] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}Z`).toLocaleString('en-GB');
}

export function scLink(criteria, scInfo, num, short = false) {
  const c = scInfo(criteria, num);
  const text = short || !c?.title ? num : `${num} ${c.title}`;
  return c?.url ? `<a href="${attr(c.url)}">${esc(text)}</a>` : esc(text);
}

export function cmpSc(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export function para(text, cls) {
  return String(text).split(/\n+/).filter(Boolean).map((l) => `<p${cls ? ` class="${cls}"` : ''}>${esc(l)}</p>`).join('');
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export function attr(s) {
  return esc(s).replace(/'/g, '&#39;');
}

export function css() {
  return `
:root{
--bg:#fafafa;--panel:#fff;--ink:#1f1f1f;--muted:#555;--line:#dcdcdc;--line-soft:#ececec;--code:#f3f3f3;--subscreen:#dbe6e2;
--t-summary:#f1ece1;--t-criteria:#ebe5f6;--t-issues:#fbe2df;--t-review:#fbedc9;--t-suggestions:#ebebe7;--t-scope:#dde9f8;--t-fixes:#dbf0e0;--t-journeys:#d8f0ec;--t-modalities:#e7e5f3;
--k-failure:#fdf4f3;--k-failure-line:#efcdc8;--k-review:#fef9ec;--k-review-line:#ecdcb0;--k-suggestion:#f7f7f5;--k-suggestion-line:#dddcd5;--k-fixed:#f3faf5;--k-fixed-line:#c7e3cf;
--critical:#f6caca;--serious:#f8dcc3;--moderate:#f6edbd;--minor:#d5e3f3;--review:#f7e3ad;--pass:#d3ead8;--neutral:#ececec;
--c-fail:#f2b8b2;--c-fail-ink:#a8433b;--c-review:#f3d892;--c-review-ink:#8a6510;--c-pass:#b9dcc2;--c-manual:#e2e2e2;--c-track:#f0f0f0;
--c-issue-1:#e9968e;--c-issue-2:#f3bdb7;--c-issue-3:#f9dcd8;--c-issue-4:#fcebe9;
--m-finding:#cc5248;--m-tabstop:#7a7a7a;--m-scope:#3f8a56;--m-outscope:#8a7ab8;
--fs-xs:.75rem;--fs-s:.85rem;--fs-l:1.15rem;--fs-xl:1.6rem;--fs-num:2rem;
--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:40px;--r1:4px;--r2:8px;--r3:12px;--nav-h:52px}
*{box-sizing:border-box}
html{scroll-padding-top:calc(var(--nav-h) + var(--s3))}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums}
a{color:inherit;text-underline-offset:2px}
:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
button,input,label{font:inherit}
input[type="checkbox"],input[type="radio"]{accent-color:var(--ink)}
.defs{position:absolute;width:0;height:0;overflow:hidden}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.skip{position:absolute;left:var(--s3);top:-60px;z-index:20;background:var(--ink);color:#fff;padding:var(--s2) var(--s3);border-radius:var(--r1)}
.skip:focus{top:var(--s2)}
.wrap{max-width:1160px;margin:0 auto;padding:0 20px}
.page-head{padding-top:28px;padding-bottom:var(--s4)}
h1{font-size:var(--fs-xl);margin:0 0 var(--s3);letter-spacing:-.01em}
h3{font-size:1.02rem;margin:0}
h4{font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:var(--s4) 0 6px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--s2) 20px;margin:0}
.meta dt{font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.meta dd{margin:0}
.muted{color:var(--muted)}
.count{font-weight:400;color:var(--muted);font-size:.9em}
.mono,pre{font:12.5px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
.mono,td{overflow-wrap:anywhere}
/* ---- sticky nav ---- */
.topnav{position:sticky;top:0;z-index:10;background:rgba(250,250,250,.97);border-bottom:1px solid var(--line);backdrop-filter:blur(6px)}
.topnav-in{max-width:1160px;margin:0 auto;padding:0 20px;display:flex;align-items:center;gap:var(--s4);min-height:var(--nav-h)}
.brand{font-weight:650;font-size:var(--fs-s);text-decoration:none;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}
.topnav ul{list-style:none;margin:0;padding:6px 2px;display:flex;gap:6px;overflow-x:auto;scrollbar-width:thin;scroll-target-group:auto;flex:1}
.nl{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;text-decoration:none;font-size:var(--fs-s);white-space:nowrap;border:1px solid transparent;min-height:32px}
.nl .ico{width:14px;height:14px}
.nl:hover{background:var(--line-soft)}
.nc{font-size:var(--fs-xs);background:#fff;border:1px solid var(--line);border-radius:999px;padding:0 6px;line-height:1.5}
.nl:target-current,.nl.is-current{background:var(--sec);border-color:var(--ink);font-weight:650}
/* ---- section title rows ---- */
.t-summary{--sec:var(--t-summary)}.t-criteria{--sec:var(--t-criteria)}.t-issues{--sec:var(--t-issues)}.t-review{--sec:var(--t-review)}
.t-suggestions{--sec:var(--t-suggestions)}.t-scope{--sec:var(--t-scope)}.t-fixes{--sec:var(--t-fixes)}.t-journeys{--sec:var(--t-journeys)}.t-modalities{--sec:var(--t-modalities)}
.sec{margin:var(--s6) 0 0;scroll-margin-top:calc(var(--nav-h) + var(--s3));border:1px solid var(--line);border-radius:var(--r3);overflow:hidden;background:var(--panel)}
.sec-head{background:var(--sec);padding:10px var(--s4);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--s1) var(--s4);margin:0;border-bottom:1px solid var(--line)}
.sec-head h2{margin:0;font-size:var(--fs-l);display:flex;align-items:center;gap:var(--s2)}
.sec-aside{margin:0;font-size:var(--fs-s);color:var(--muted)}
.ico{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.pill{font-size:var(--fs-xs);font-weight:600;background:rgba(255,255,255,.85);border:1px solid rgba(0,0,0,.14);border-radius:999px;padding:1px 8px}
[id]{scroll-margin-top:calc(var(--nav-h) + var(--s3))}
/* ---- summary ---- */
.panel-box{padding:var(--s5)}
.sum-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;margin:0 0 var(--s5)}
.sum-tiles.two{grid-template-columns:repeat(2,minmax(0,1fr));margin:0}
.tile{padding:0 var(--s5);border-left:1px solid var(--line-soft);min-width:0}
.tile:first-child{border-left:0;padding-left:0}
.tile h3{font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600;margin:0 0 var(--s3)}
.tile-body{display:flex;align-items:center;gap:var(--s4)}
.ring{position:relative;flex:none;line-height:1.15}
.ring-svg{display:block}
.ring-c{position:absolute;left:50%;top:68%;transform:translate(-50%,-50%);margin:0;text-align:center;font-size:var(--fs-xs);color:var(--muted);pointer-events:none;width:100%}
.ring-c .big{display:block;font-size:var(--fs-num);font-weight:650;color:var(--ink);line-height:1.15}
.ring-c small{font-size:.65em;font-weight:500;color:var(--muted)}
.ring-l .ring-c .big{font-size:1.7rem}
.ring-mark{font:700 9px system-ui,sans-serif;fill:var(--ink)}
.legend{list-style:none;margin:0;padding:0;display:grid;gap:5px;font-size:var(--fs-s);min-width:0;flex:1}
.legend li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:var(--s2);align-items:center}
.lg-l{min-width:0;overflow-wrap:anywhere;display:flex;align-items:center;gap:6px}
.lg-v{font-weight:650}
.sw{width:12px;height:12px;display:block;flex:none}
.mk{display:inline-grid;place-content:center;min-width:20px;height:20px;padding:0 5px;white-space:nowrap;border-radius:999px;border:1px solid var(--ink);background:#fff;font-size:.7rem;font-weight:700;flex:none;line-height:1}
.mk-review,.mk-suggestion{border-style:dashed}
/* issue map */
.imap{border-collapse:collapse;width:100%;font-size:var(--fs-s)}
.imap th,.imap td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line-soft);vertical-align:middle}
.imap thead th{font-size:var(--fs-xs);color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--line)}
.imap .kind-row th{background:var(--sec);font-size:var(--fs-s);font-weight:650;padding:6px 10px;border:0}
.imap .kind-row .ico{width:15px;height:15px;vertical-align:-3px;margin-right:4px}
.imap tbody+tbody .kind-row th{border-top:10px solid #fff}
.c-mk{width:36px}
.c-t{font-weight:600;min-width:220px}
.c-t a{display:block}
.src-l{display:block;font-weight:400;color:var(--muted);font-size:11.5px}
.c-bar{min-width:150px}
.bar{display:inline-block;vertical-align:middle;width:96px;height:10px;border:1px solid #9a9a9a;border-radius:3px;background:#fff;margin-right:var(--s2)}
.bar span{display:block;height:100%;background:#6b6b6b}
.num{font-weight:650}
.of{color:var(--muted);font-weight:400}
.strip{display:inline-grid;grid-auto-flow:column;gap:2px;vertical-align:middle;margin-right:var(--s2)}
.strip i{width:7px;height:14px;border-radius:2px;background:#e6e6e6}
.strip i.on{background:#4a4a4a}
/* ---- badges ---- */
.badge{display:inline-block;font-size:.78rem;padding:1px 8px;border-radius:999px;background:var(--neutral);white-space:nowrap}
.badge.outline{background:#fff;border:1px solid var(--line)}
.critical{background:var(--critical)}.serious{background:var(--serious)}.moderate{background:var(--moderate)}.minor{background:var(--minor)}.review{background:var(--review)}.pass{background:var(--pass)}.neutral{background:var(--neutral)}
.status{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
/* ---- criteria ---- */
.crit{display:flex;flex-wrap:wrap;gap:var(--s5) var(--s6);align-items:flex-start}
.crit-ring{flex:none}
.crit>.legend{flex:1 1 200px;min-width:170px;align-self:center}
.crit>.breakdown{flex:1 1 220px;min-width:220px}
.breakdown{width:100%;border-collapse:collapse;font-size:var(--fs-s)}
.breakdown caption{caption-side:top;text-align:left;font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600;padding:0 0 4px}
.breakdown th,.breakdown td{text-align:left;padding:3px 8px;border-bottom:1px solid var(--line-soft)}
.breakdown th{font-weight:600;color:var(--muted);font-size:var(--fs-xs)}
.breakdown td:not(:first-child),.breakdown th:not(:first-child){text-align:right}
.breakdown tbody tr:last-child td{border-bottom:0}
.crit-disc{margin-top:var(--s3)}
.crit-disc .disc-label{font-weight:600;padding:6px 0}
table{border-collapse:collapse;width:100%;background:var(--panel)}
.crit-t th,.crit-t td,.proof th,.proof td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line-soft);vertical-align:top}
.crit-t th,.proof th{font-size:var(--fs-xs);color:var(--muted);font-weight:600}
.table-scroll{overflow-x:auto}
/* ---- finding cards ---- */
.issue{background:var(--panel);margin:0}
.issue+.issue{border-top:1px solid var(--line)}
.k-failure{--kbg:var(--k-failure);--kline:var(--k-failure-line)}.k-review{--kbg:var(--k-review);--kline:var(--k-review-line)}
.k-suggestion{--kbg:var(--k-suggestion);--kline:var(--k-suggestion-line)}.k-fixed{--kbg:var(--k-fixed);--kline:var(--k-fixed-line)}
.issue-head{background:var(--kbg,var(--panel));border-bottom:1px solid var(--kline,var(--line));padding:var(--s4) 18px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;justify-content:space-between}
.issue-head h3{display:flex;gap:var(--s2);align-items:baseline}
.issue-head>*{min-width:0}
.issue-body{padding:var(--s4) 18px}
.tags{margin:0;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.kind-chip{display:inline-flex;align-items:center;gap:4px;font-size:.78rem;font-weight:600}
.kind-chip .ico{width:14px;height:14px}
.help{font-size:var(--fs-s)}
.fix{background:var(--neutral);border:1px solid var(--line);border-radius:6px;padding:4px 12px;margin-top:10px}
.fix h4{margin-top:8px}
.occ{list-style:none;padding:0;margin:0;display:grid;gap:10px}
.occ-item{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,300px);gap:14px;border-top:1px solid var(--line-soft);padding-top:10px}
.occ-item:first-child{border-top:0;padding-top:0}
.occ-body p{margin:4px 0}
.occ-body,.occ-item>*,.issue-head>*{min-width:0}
.where{font-weight:600}
.src{color:var(--muted)}
.chain ol{margin:4px 0;padding-left:20px}
pre{background:rgba(255,255,255,.8);border:1px solid var(--line-soft);padding:8px 10px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:6px 0}
.summary{color:var(--muted);font-size:.9rem}
.steps,.also ul{margin:6px 0;padding-left:20px}
.shot.shot-crop{display:block;position:relative;overflow:hidden;border:1px solid var(--line);border-radius:4px}.shot.shot-crop img{position:absolute;max-width:none;border:0;border-radius:0}
.shot img{display:block;max-width:100%;border:1px solid var(--line);border-radius:4px;background:#fff}
details>summary{cursor:pointer;color:var(--muted)}
/* ---- disclosure ---- */
.disclosure{position:relative}
.disc-check{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden}
.disc-label{cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.disc-label::before{content:"\\25b8";font-size:.75em}
.disc-check:checked+.disc-label::before{content:"\\25be"}
.disc-check:focus-visible+.disc-label{outline:2px solid var(--ink);outline-offset:2px}
.disc-body{display:none}
.disclosure:has(.disc-check:checked) .disc-body{display:block}
/* ---- scope ---- */
@property --p-finding{syntax:"<number>";inherits:true;initial-value:0}
@property --p-tabstop{syntax:"<number>";inherits:true;initial-value:0}
@property --p-scope{syntax:"<number>";inherits:true;initial-value:0}
.scope-bar{display:flex;flex-wrap:wrap;gap:var(--s3) var(--s5);align-items:center;padding:0 0 var(--s4);margin:0 0 var(--s4);border-bottom:1px solid var(--line)}
.meter{display:flex;align-items:center;gap:10px}
@media (prefers-reduced-motion:no-preference){.scope{transition:--p-finding .35s,--p-tabstop .35s,--p-scope .35s}}
.meter-t{display:flex;flex-direction:column;line-height:1.25}
.meter-v{font-size:var(--fs-xs);color:var(--muted)}
.vnum,.vnum-p{display:none;font-weight:700;color:var(--ink);font-size:var(--fs-s)}
.mring{width:48px;height:48px;transform:rotate(-90deg);flex:none}
.mring circle{fill:none;stroke-width:4.5}
.mring .trk{stroke:var(--c-track)}
.mring .val{stroke-linecap:butt}
.lg-a{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.dialog-body.is-mobile{max-width:480px;margin:0 auto}
.toggle{display:inline-flex;align-items:center;gap:5px;font-size:var(--fs-s);font-weight:600}
.print-only{display:none}
.scope-layout{display:grid;grid-template-columns:260px minmax(0,1fr);gap:20px;align-items:start}
.rail{min-width:0;max-height:calc(100vh - var(--nav-h) - 32px);overflow:auto;border:1px solid var(--line);border-radius:var(--r2);padding:10px;position:sticky;top:calc(var(--nav-h) + var(--s3));background:var(--panel)}
.feature{margin:0 0 14px}
.feature>.disc-label h3{display:inline;font-size:.95rem}
.tree{list-style:none;padding:0;margin:8px 0 0}
.tree .tree{padding-left:16px;margin-top:10px}
.screen-node{border-top:1px solid var(--line-soft);padding-top:10px;margin-top:10px}
.screen-node:first-child{border-top:0;padding-top:0;margin-top:0}
.screen-head{margin:0;font-size:var(--fs-s)}
.entries{list-style:none;margin:4px 0 6px;padding:0;display:flex;flex-direction:column;gap:1px}
.entry{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:4px;cursor:pointer;font-size:var(--fs-s)}
.entry:hover{background:var(--line-soft)}
.entry:has(input:focus-visible){outline:2px solid var(--ink);outline-offset:1px}
.entry:has(input:checked){background:var(--t-scope);font-weight:650}
.entry span:first-of-type{flex:1;min-width:0}
.main{min-width:0}
.panel{display:none}
.view{background:var(--panel);border:1px solid var(--line);border-radius:var(--r2);padding:8px;margin:0;position:relative}
.expand{display:block;width:100%;position:relative;padding:0;margin:0;border:1px solid var(--line);border-radius:4px;background:#fff;cursor:zoom-in;font:inherit}
.view.is-mobile .expand{max-width:340px;margin:0 auto}
.expand img{display:block;width:100%;border-radius:4px;background:#fff}
.expand svg{position:absolute;inset:0;width:100%;height:100%}
.expand-hint{position:absolute;right:8px;bottom:8px;background:rgba(255,255,255,.94);border:1px solid var(--line);border-radius:4px;padding:2px 8px;font-size:var(--fs-xs);color:var(--muted)}
.view svg rect{stroke-width:2;vector-effect:non-scaling-stroke;fill-opacity:.38}
.a-fail{fill:var(--critical);stroke:#b3463d}
.a-review{fill:var(--review);stroke:#a07a14}
.a-suggest{fill:#dddbd3;stroke:#7a786f}
.a-scope{fill:var(--pass);stroke:#4f9a66;fill-opacity:.18;stroke-dasharray:8 5}
.a-tabstop{fill:var(--neutral);stroke:#6b6b6b}
.a-subscreen{fill:var(--subscreen);stroke:#3f7a63}
.a-out{fill:rgba(138,122,184,.18);stroke:#6b5a9e;stroke-dasharray:5 3}
.geo-note{margin:var(--s1) 0;font-size:var(--fs-xs);color:var(--muted,#555)}
.banner{margin:var(--s4) 0;padding:var(--s3) var(--s4);border:1px solid var(--k-review-line);background:var(--k-review);border-radius:var(--r2)}
.banner h2{margin:0 0 var(--s2);font-size:var(--fs-l)}
.banner ul{margin:var(--s2) 0 0;padding-left:var(--s5)}
.banner-out{border-color:#cfc6e6;background:#f4f1fa}
.tab-num{font-weight:700;fill:var(--ink);paint-order:stroke;stroke:#fff;stroke-width:3px;vector-effect:non-scaling-stroke}
.view-label{margin:6px 0 0;font-size:.85rem}
.view-issues{list-style:none;margin:8px 0 0;padding:0;font-size:.82rem;display:flex;flex-direction:column;gap:2px}
.view-issues a{display:inline-block;min-height:24px;line-height:24px}
.outside{color:var(--muted)}
.not-assessed{color:var(--muted)}
.shot-dialog{border:1px solid var(--line);border-radius:var(--r2);padding:14px;max-width:min(96vw,1400px);width:100%;max-height:92vh;background:var(--panel);color:var(--ink)}
.shot-dialog::backdrop{background:rgba(20,20,20,.55)}
.dialog-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:0 0 10px}
.dialog-row .toggles{margin:0;display:flex;flex-wrap:wrap;gap:4px 14px}
.dialog-row form{margin-left:auto}
.dialog-body{position:relative;overflow:auto;max-height:78vh}
.dialog-body img{display:block;width:100%;border-radius:4px;background:#fff}
.dialog-body svg{position:absolute;inset:0;width:100%;height:100%}
.issue-count{font-size:var(--fs-s)}
.issue-count summary{cursor:pointer}
.issue-list{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:6px;max-height:40vh;overflow:auto}
.issue-list li a{display:block}
.issue-meta{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}
.close{font-size:.85rem}
/* ---- user journeys ---- */
.journey-list{list-style:none;margin:0;padding:0;display:grid;gap:var(--s5)}
.journey{border-top:1px solid var(--line-soft);padding-top:var(--s4)}
.journey:first-child{border-top:0;padding-top:0}
.journey h3{margin:0 0 6px}
.journey-narrative{margin:0 0 var(--s3)}
.journey-link{background:none;border:0;padding:0;margin:0;color:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer;font:inherit}
.journey-actions{list-style:none;margin:0;padding:0;display:grid;gap:4px;font-size:var(--fs-s)}
.journey-actions li{display:flex;flex-wrap:wrap;gap:0 6px;align-items:baseline}
.journey-step-label{font-weight:650}
/* layer visibility: master boxes (Scope meters) drive the inline view; dialog boxes (synced
   on open) drive the dialog, so toggling inside the dialog works even when a master is off. */
.scope:not(:has(#g-scope:checked)) .view .l-scope,.scope:not(:has(#g-finding:checked)) .view .l-finding,.scope:not(:has(#g-tabstop:checked)) .view .l-tabstop,.scope:not(:has(#g-subscreen:checked)) .view .l-subscreen,.scope:not(:has(#g-outscope:checked)) .view .l-outscope{display:none}
.shot-dialog:not(:has(.t-scope:checked)) .l-scope,.shot-dialog:not(:has(.t-finding:checked)) .l-finding,.shot-dialog:not(:has(.t-tabstop:checked)) .l-tabstop,.shot-dialog:not(:has(.t-subscreen:checked)) .l-subscreen,.shot-dialog:not(:has(.t-outscope:checked)) .l-outscope{display:none}
/* ---- responsive ---- */
@media (max-width:900px){.sum-tiles{grid-template-columns:1fr;gap:var(--s5)}.sum-tiles.two{grid-template-columns:1fr}.tile{padding:0;border-left:0}.tile+.tile{border-top:1px solid var(--line-soft);padding-top:var(--s5)}.crit>.legend,.crit>.breakdown{flex-basis:100%}}
@media (max-width:720px){
.wrap,.topnav-in{padding:0 14px}.brand{display:none}.topnav ul{scroll-snap-type:x proximity}.nl{scroll-snap-align:start}
.panel-box{padding:var(--s4)}h1{font-size:1.35rem}
.ring-svg{width:104px;height:104px}.ring-l .ring-svg{width:128px;height:128px}
.imap thead{display:none}.imap,.imap tbody{display:block}
.imap tr:not(.kind-row){display:grid;grid-template-columns:auto 1fr;gap:4px 10px;padding:10px;border-bottom:1px solid var(--line-soft)}
.imap .kind-row{display:block}.imap .kind-row th{display:block}
.imap td,.imap th{border:0;padding:0}.imap .c-mk{grid-row:span 5}
.imap td[data-label]{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.imap td[data-label]::before{content:attr(data-label);font-size:var(--fs-xs);color:var(--muted);min-width:80px}.strip{gap:1px}.strip i{width:6px}
.c-t{min-width:0}
.occ-item{grid-template-columns:1fr}
.scope-layout{grid-template-columns:1fr}.rail{position:static;max-height:280px}
.scope-bar{gap:var(--s2)}.meter{flex:1 1 0;flex-direction:column;text-align:center;gap:6px;min-width:0}.meter-t{align-items:center}.meter-v .of{display:block}
.proof thead{display:none}.proof td{display:block;border:0;padding:4px 0}.proof td::before{content:attr(data-label);display:block;font-size:var(--fs-xs);color:var(--muted)}.proof tr{display:block;border-bottom:1px solid var(--line);padding:6px 0}
}
@media print{
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.topnav,.skip,.expand-hint,.scope-bar{display:none}
.print-only{display:block}
body{background:#fff;font-size:11pt}
.sec{break-inside:auto}.sec-head{break-after:avoid}.issue,.tile,.breakdown tr,.imap tr{break-inside:avoid}
.disc-body{display:block!important}.disc-label::before{content:none}
details{display:block}details>summary{display:none}
.scope-layout{grid-template-columns:1fr}.rail{display:none}.panel{display:block!important;break-inside:avoid;margin-bottom:var(--s4)}.shot-dialog{display:none}
a[href^="http"]::after{content:" (" attr(href) ")";font-size:.75em;color:var(--muted)}
}
`;
}
