// Renders <run>/sr-report.html from <run>/results.json with the assessment report's own
// render helpers (render.mjs: page shell, CSS, sticky nav, rings, issue cards), so the two
// reports look the same and screen-reader findings can later be merged into report.html.
// Sections: Summary, Session log (every executed action with its narration and a screenshot
// dialog), then Issues / Needs review / Suggestions.
import fs from 'node:fs';
import path from 'node:path';
import { importSiblingLib } from './deps.mjs';

const KIND_SECTIONS = [
  { id: 'issues', kind: 'failure', title: 'Issues', prefix: '' },
  { id: 'review', kind: 'review', title: 'Needs review', prefix: 'R' },
  { id: 'suggestions', kind: 'suggestion', title: 'Suggestions', prefix: 'S' },
];
const IMPACTS = ['critical', 'serious', 'moderate', 'minor'];
const SHADES = { critical: 'var(--c-issue-1)', serious: 'var(--c-issue-2)', moderate: 'var(--c-issue-3)', minor: 'var(--c-issue-4)' };

// Same behaviour as render.mjs's (unexported) dialog script: buttons with data-dialog open the
// matching <dialog> with showModal(); the dialog's own form[method=dialog] closes it.
const DIALOG_SCRIPT = `<script>(function(){
document.querySelectorAll('[data-dialog]').forEach(function(b){b.addEventListener('click',function(){var d=document.getElementById(b.getAttribute('data-dialog'));if(d&&typeof d.showModal==='function')d.showModal();});});
})();</script>`;

const EXTRA_CSS = `
.sr-j{padding:var(--s4) 0}.sr-j+.sr-j{border-top:1px solid var(--line-soft)}.sr-j h3{margin:0 0 4px}
.sr-j .proof{width:100%;border-collapse:collapse}.sr-j .proof td{overflow-wrap:anywhere}
.narr{margin:0;padding-left:1.2em}.narr li{margin:0 0 2px}
.c-n{white-space:nowrap;width:2.5em}.c-shot{white-space:nowrap}
.refs{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 0}
.probe-t{width:100%;border-collapse:collapse}
.late{color:var(--muted)}.prep{margin:4px 0 0;color:var(--muted);font-size:.9rem}
.sr-warn{margin:var(--s3) 0 0;padding:var(--s3);border:1px solid var(--line);border-radius:6px;background:var(--t-review)}.sr-warn ul{margin:4px 0 0}`;

// Each occurrence shows the complete observed narration, the expectation and any confidence caveat.
function withEvidence(f) {
  const e = f.evidence ?? {};
  const extra = [];
  if (Array.isArray(e.narration)) extra.push(`Heard: ${e.narration.length ? e.narration.map((p) => `"${p}"`).join(' → ') : '(nothing)'}`);
  if (e.expected) extra.push(`Expected: ${e.expected}`);
  if (e.confidence) extra.push(`Needs review because: ${e.confidence}`);
  if (e.capture) extra.push(`Speech capture: ${e.capture}`);
  if (!extra.length) return f;
  const nodes = f.nodes?.length ? f.nodes : [{}];
  return { ...f, nodes: nodes.map((n, i) => (i ? n : { ...n, summary: [n.summary, ...extra].filter(Boolean).join('\n') })) };
}

export async function renderReport(runDir, { knowledge } = {}) {
  const R = await importSiblingLib('render.mjs');
  const { groupFindings, slug } = await importSiblingLib('findings.mjs');
  const { loadCriteria, scInfo } = await importSiblingLib('wcag.mjs');
  const { esc, attr, pathHref } = R;
  const results = JSON.parse(fs.readFileSync(path.join(runDir, 'results.json'), 'utf8'));
  const criteria = loadCriteria(knowledge);
  const scLink = (num, short = false) => R.scLink(criteria, scInfo, num, short);
  const findings = (results.findings ?? []).map(withEvidence);
  const journeys = results.journeys ?? [];
  const probes = results.probes ?? [];

  // Pseudo-targets so render.mjs's occurrence markup ("where", "also on") reads naturally.
  const targets = new Map();
  for (const j of journeys) {
    for (const s of j.steps ?? []) {
      targets.set(`${j.key ?? j.id}#${s.n}`, { kind: 'step', journey: j, step: s, screen: { name: j.title }, state: { name: `step ${s.n}` }, viewport: j.viewport });
    }
  }
  for (const p of probes) {
    const j = journeys.find((x) => (x.key ?? x.id) === p.journey);
    targets.set(p.id, { kind: 'probe', probe: p, screen: { name: p.title || p.url || p.id }, state: { name: 'page structure' }, viewport: p.viewport ?? j?.viewport ?? { name: '' } });
  }
  const where = (t, fallback) => {
    if (!t) return esc(fallback ?? '');
    const vp = t.viewport?.width ? `${esc(t.viewport.name)} ${t.viewport.width}×${t.viewport.height}` : esc(t.viewport?.name ?? '');
    if (t.kind === 'probe') return `Page structure › ${esc(t.screen.name)} <span class="muted">${vp}</span>`;
    return `${esc(t.journey.title)} › <a href="#log-${attr(t.journey.key ?? t.journey.id)}-${t.step.n}">step ${t.step.n}</a>: ${esc(t.step.description)} <span class="muted">${vp}</span>`;
  };

  const sections = KIND_SECTIONS.map((s) => ({ ...s, groups: groupFindings(findings.filter((f) => f.kind === s.kind)) }));
  // finding id -> marker/anchor, for the issue references next to each logged step.
  const refOf = new Map();
  for (const s of sections) {
    s.groups.forEach((g, i) => {
      for (const f of g.items) refOf.set(f.id, { marker: `${s.prefix}${i + 1}`, anchor: `${s.id}-${slug(g.key)}`, kind: s.kind, title: g.title });
    });
  }
  const refsByTarget = new Map();
  for (const f of findings) {
    const r = refOf.get(f.id);
    if (!r) continue;
    const list = refsByTarget.get(f.target) ?? [];
    if (!list.some((x) => x.marker === r.marker)) list.push(r);
    refsByTarget.set(f.target, list);
  }
  const refsHtml = (target) => {
    const list = refsByTarget.get(target);
    if (!list?.length) return '';
    return `<p class="refs">${list.map((r) => `<a class="badge outline" href="#${attr(r.anchor)}" title="${attr(r.title)}">${esc(r.marker)}<span class="sr"> ${esc(r.title)}</span></a>`).join('')}</p>`;
  };

  const dialogs = [];
  const shotButton = (id, src, label) => {
    if (!src) return '<span class="muted">—</span>';
    dialogs.push(`<dialog class="shot-dialog" id="${attr(id)}" aria-label="${attr(label)}">
  <div class="dialog-row"><strong>${esc(label)}</strong><form method="dialog"><button type="submit" class="close">Close</button></form></div>
  <div class="dialog-body" tabindex="0" role="group" aria-label="Scrollable screenshot area"><img src="${pathHref(src)}" alt="${attr(label)}" loading="lazy"></div>
</dialog>`);
    return `<button type="button" class="journey-link" data-dialog="${attr(id)}" aria-haspopup="dialog">Screenshot<span class="sr">: ${esc(label)}</span></button>`;
  };

  const appName = results.app?.name ?? results.app?.baseUrl ?? '';
  const sum = results.summary ?? {};
  const present = sections.filter((s) => s.groups.length);
  const nav = R.stickyNav(appName, [
    { id: 'summary', key: 'summary', label: 'Summary' },
    { id: 'journeys', key: 'journeys', label: 'Session log', count: journeys.length },
    ...present.map((s) => ({ id: s.id, key: s.id, label: s.id === 'review' ? 'Review' : s.title, count: s.groups.length })),
  ]);

  const env = results.env ?? {};
  const envText = [
    env.os && `${env.os} ${env.osRelease ?? ''}`.trim(),
    env.browser && `browser ${env.browser}`,
    env.guidepup && `Guidepup ${env.guidepup}`,
    env.node && `Node ${env.node}`,
    env.locale && `locale ${env.locale}`,
    env.settle != null && `settle ${env.settle} ms`,
  ].filter(Boolean).join(' · ');
  // A run that could not replay everything must never read as a clean pass.
  const warningsHtml = () => {
    const w = [];
    const blocked = journeys.filter((j) => j.status === 'blocked');
    const partial = journeys.filter((j) => j.status === 'partial');
    if (blocked.length) w.push(`${blocked.length} journey${blocked.length === 1 ? ' was' : 's were'} blocked and not (fully) replayed: ${blocked.map((j) => `${j.title}${j.error ? ` (${j.error})` : ''}`).join('; ')}.`);
    if (partial.length) w.push(`${partial.length} journey${partial.length === 1 ? '' : 's'} stopped at a failing step: ${partial.map((j) => j.title).join('; ')}.`);
    const incomplete = probes.filter((p) => p.error || ['headings', 'landmarks', 'reading'].some((k) => p[k]?.termination && p[k].termination !== 'end'));
    if (incomplete.length) w.push(`${incomplete.length} page-structure sweep${incomplete.length === 1 ? '' : 's'} did not reach the end of the page; structure conclusions for ${incomplete.length === 1 ? 'it' : 'them'} are limited.`);
    const unreliable = Object.entries(sum.capture ?? {}).filter(([h, n]) => !['captured', 'simulated', 'unknown'].includes(h) && n).map(([h, n]) => `${n} ${h}`);
    if (unreliable.length) w.push(`Speech capture was not reliable for some steps (${unreliable.join(', ')}); their findings are listed under Needs review.`);
    if (results.cleanupErrors?.length) w.push(`Cleanup reported errors (check the screen reader and browser state): ${results.cleanupErrors.join('; ')}.`);
    if (!w.length) return '';
    return `<div class="sr-warn" role="note" aria-label="Run warnings"><strong>This run is incomplete or partly unreliable.</strong><ul>${w.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  };

  const header = `<header class="wrap page-head">
  <h1>Screen reader validation</h1>
  <dl class="meta">
    <div><dt>App</dt><dd>${esc(appName)} <span class="muted">${esc(results.app?.baseUrl ?? '')}</span></dd></div>
    <div><dt>Screen reader</dt><dd>${esc(results.reader?.label ?? results.reader?.name ?? '')}${results.simulated ? ' <span class="badge outline">simulated narration</span>' : ''}</dd></div>
    <div><dt>Date</dt><dd>${esc(new Date(results.startedAt ?? Date.now()).toLocaleString('en-GB'))}</dd></div>
    <div><dt>Scope</dt><dd>${esc(results.scope?.id ?? '')}${results.scope?.intent ? ` <span class="muted">${esc(results.scope.intent)}</span>` : ''}</dd></div>
    ${envText ? `<div><dt>Environment</dt><dd class="muted">${esc(envText)}</dd></div>` : ''}
  </dl>
  ${results.simulated ? '<p class="muted">The mock driver synthesised this narration from DOM events. It tests the pipeline only and is not evidence of how a real screen reader behaves.</p>' : ''}
  ${warningsHtml()}
</header>`;

  const captureLine = () => {
    const c = Object.entries(sum.capture ?? {}).filter(([h]) => h !== 'unknown');
    if (results.simulated || !c.length) return '';
    return ` Speech capture: ${c.map(([h, n]) => `${n} ${h}`).join(', ')}.`;
  };
  const summary = () => {
    const failures = sections[0].groups;
    const occ = (imp) => failures.filter((g) => g.impact === imp).reduce((n, g) => n + g.occ.length, 0);
    const counts = Object.fromEntries(IMPACTS.map((i) => [i, occ(i)]));
    const total = IMPACTS.reduce((n, i) => n + counts[i], 0);
    const issueRing = R.ring({ segments: IMPACTS.map((i) => ({ value: counts[i], fill: SHADES[i] })) });
    const steps = sum.steps ?? 0;
    const narrated = sum.narrated ?? 0;
    const failed = sum.failedSteps ?? 0;
    const silent = Math.max(0, steps - narrated - failed);
    const stepRing = R.ring({ segments: [
      { value: narrated, fill: 'var(--c-pass)' },
      { value: silent, fill: 'var(--c-manual)' },
      { value: failed, fill: 'var(--c-issue-1)' },
    ] });
    return `<section id="summary" class="sec" aria-labelledby="summary-h">${R.secHead('summary', 'summary', 'Summary', null)}<div class="panel-box"><div class="sum-tiles two">
  <section class="tile" aria-labelledby="t-iss">
    <h3 id="t-iss">Issues by severity</h3>
    <div class="tile-body">${R.ringBox(issueRing, `<strong class="big">${total}</strong><span>occurrences</span>`)}
    ${R.legend([
    ...IMPACTS.map((i) => ({ fill: SHADES[i], label: i[0].toUpperCase() + i.slice(1), value: counts[i] })),
    { fill: 'var(--c-manual)', label: `<a class="lg-a" href="#review">Needs review</a>`, value: sections[1].groups.length },
    { fill: 'var(--c-manual)', label: `<a class="lg-a" href="#suggestions">Suggestions</a>`, value: sections[2].groups.length },
  ].filter((x, k) => k < IMPACTS.length || x.value))}</div>
  </section>
  <section class="tile" aria-labelledby="t-steps">
    <h3 id="t-steps">Steps replayed</h3>
    <div class="tile-body">${R.ringBox(stepRing, `<strong class="big">${narrated}</strong><span>of ${steps} narrated</span>`)}
    ${R.legend([
    { fill: 'var(--c-pass)', label: 'Narrated', value: narrated },
    { fill: 'var(--c-manual)', label: 'Silent', value: silent },
    { fill: 'var(--c-issue-1)', label: 'Failed to run', value: failed },
  ])}</div>
    <p class="muted">${sum.journeysComplete ?? 0} of ${sum.journeys ?? journeys.length} journeys completed${sum.journeysBlocked ? ` · ${sum.journeysBlocked} blocked` : ''}${sum.journeysPartial ? ` · ${sum.journeysPartial} partial` : ''}.${captureLine()}</p>
  </section>
</div></div></section>`;
  };

  const actionText = (s) => {
    const input = s.trace?.input ?? ({ goto: 'navigation', reload: 'navigation', waitFor: 'wait' }[s.action] ?? null);
    return `<strong>${esc(s.action)}</strong>${s.key ? ` <span class="pill">${esc(s.key)}</span>` : ''}${s.button ? ` <span class="muted">${esc(s.button)} button</span>` : ''}${input ? `<br><span class="muted">${esc(input)}${s.via === 'screen-reader' ? ' · via screen reader' : ''}</span>` : ''}`;
  };
  const NARR_MAX = 300;
  let moreId = 0;
  // Long narration is cut to NARR_MAX characters; the full text opens in a dialog.
  const clip = (text, label) => {
    const t = String(text);
    if (t.length <= NARR_MAX) return esc(t);
    const id = `dlg-more-${++moreId}`;
    dialogs.push(`<dialog class="shot-dialog" id="${id}" aria-label="${attr(label)}">
  <div class="dialog-row"><strong>${esc(label)}</strong><form method="dialog"><button type="submit" class="close">Close</button></form></div>
  <div class="dialog-body" tabindex="0" role="group" aria-label="Full narration"><p>${esc(t)}</p></div>
</dialog>`);
    return `${esc(t.slice(0, NARR_MAX).trimEnd())}… <button type="button" class="journey-link" data-dialog="${id}" aria-haspopup="dialog">more…<span class="sr"> (full narration)</span></button>`;
  };
  const narrHtml = (list, late, label = 'Full narration') => {
    const items = [...(list ?? []).map((p) => `<li>${clip(p, label)}</li>`), ...(late ?? []).map((p) => `<li class="late">${clip(p, label)} <span class="muted">(late)</span></li>`)];
    return items.length ? `<ol class="narr">${items.join('')}</ol>` : '<span class="muted">(nothing spoken)</span>';
  };
  const captureNote = (s) => {
    const h = s.capture?.health;
    return h && !['captured', 'simulated'].includes(h) ? `<br><span class="badge outline">capture ${esc(h)}</span>` : '';
  };
  const prepHtml = (prep) => {
    const said = (prep ?? []).filter((x) => x.phrases?.length);
    if (!said.length) return '';
    return said.map((x) => `<p class="prep">${x.step ? `Re-aligned after step ${x.step}` : 'Before step 1'}: ${x.phrases.map((p) => `“${clip(p, 'Full narration')}”`).join(' · ')}</p>`).join('');
  };

  const journeyHtml = (j, ji) => {
    const jk = j.key ?? j.id;
    const rows = (j.steps ?? []).map((s) => {
      const label = `${j.title}, step ${s.n}: ${s.description}`;
      return `<tr id="log-${attr(jk)}-${s.n}">
      <td data-label="#" class="c-n">${s.n}</td>
      <td data-label="Action">${actionText(s)}</td>
      <td data-label="Step">${esc(s.description)}${s.origin ? `<br><span class="muted">${esc(s.origin)}</span>` : ''}${s.modality ? `<br><span class="muted">${esc(s.outcome ?? '')}${s.keysSent?.length ? ` · keys: ${esc(s.keysSent.join(' '))}` : ''}${s.readerMode ? ` · reader mode: ${esc(s.readerMode)}` : ''}${s.modalityNote ? ` · ${esc(s.modalityNote)}` : ''}</span>` : ''}${s.escalation ? `<br><span class="badge serious">escalated: ${esc(s.escalation)}</span>` : ''}${s.ok ? '' : `<br><span class="badge serious">failed</span> ${esc(s.error ?? '')}`}</td>
      <td data-label="Before">${s.before ? clip(s.before, 'Full text') : '<span class="muted">—</span>'}</td>
      <td data-label="Narration after">${narrHtml(s.narration, s.late, `Full narration: ${label}`)}${captureNote(s)}${refsHtml(`${jk}#${s.n}`)}</td>
      <td data-label="Screenshot" class="c-shot">${shotButton(`dlg-j${ji + 1}-s${s.n}`, s.screenshot, label)}</td>
    </tr>`;
    }).join('');
    const vp = j.viewport ? `${j.viewport.name} ${j.viewport.width}×${j.viewport.height}` : '';
    return `<div class="sr-j" id="log-${attr(jk)}">
  <h3>${esc(j.title)}</h3>
  <p class="muted">${esc(j.id)}${j.feature ? ` · ${esc(j.feature.name ?? j.feature.id ?? j.feature)}` : ''} · ${esc(vp)}${j.modality && j.modality !== 'unspecified' ? ` · <span class="badge outline">${esc(j.modality)}</span>` : ''} · ${j.status === 'complete' ? 'completed' : `<span class="badge serious">${esc(j.status)}</span>`}${j.error ? ` ${esc(j.error)}` : ''}</p>
  ${(j.notes ?? []).length ? `<ul>${j.notes.map((n) => `<li class="muted">${esc(n)}</li>`).join('')}</ul>` : ''}
  ${prepHtml(j.prep)}
  ${(j.steps ?? []).length ? `<div class="table-scroll"><table class="proof">
    <caption class="sr">Session log: ${esc(j.title)}</caption>
    <thead><tr><th scope="col">#</th><th scope="col">Action</th><th scope="col">Step</th><th scope="col">Heard before</th><th scope="col">Narration after</th><th scope="col">Screenshot</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>` : ''}
</div>`;
  };

  const TERMINATION = { end: 'reached the end', repeat: 'stopped: item repeated', cap: 'stopped: item limit reached', silent: 'stopped: nothing spoken', unsupported: 'not supported by this reader (or browse mode not verified)', error: 'failed', 'invalid-focus-mode': 'discarded: reader was in focus mode' };
  const sweepHtml = (sw, full) => {
    if (!sw) return '<span class="muted">—</span>';
    const items = sw.spoken ?? [];
    const body = !items.length ? '<span class="muted">nothing spoken</span>'
      : full ? `<details><summary>${items.length} item${items.length === 1 ? '' : 's'}</summary>      <ol class="narr">${items.map((x) => `<li>${clip(x.text, 'Full narration')}</li>`).join('')}</ol></details>`
              : items.map((x) => clip(x.text, 'Full narration')).join(' · ');
    const term = sw.termination ? `<br><span class="${sw.termination === 'end' ? 'muted' : 'badge outline'}">${esc(TERMINATION[sw.termination] ?? sw.termination)}</span>` : '';
    const cmds = sw.commands?.length ? `<br><span class="muted">Commands: ${esc([...new Set(sw.commands)].join(', '))}</span>` : '';
    return `${body}${term}${cmds}${sw.error ? `<br><span class="muted">${esc(sw.error)}</span>` : ''}`;
  };
  const probesHtml = () => {
    if (!probes.length) return '';
    const rows = probes.map((p) => `<tr>
      <td data-label="Page">${esc(p.title || p.url || p.id)}<br><span class="muted">${esc(p.url ?? '')} · ${esc(p.viewport?.name ?? '')}</span>${p.error ? `<br><span class="badge serious">failed</span> ${esc(p.error)}` : ''}${refsHtml(p.id)}</td>
      <td data-label="Headings">${sweepHtml(p.headings)}</td>
      <td data-label="Landmarks">${sweepHtml(p.landmarks)}</td>
      <td data-label="Reading order">${sweepHtml(p.reading, true)}</td>
      <td data-label="Screenshot" class="c-shot">${shotButton(`dlg-${p.id}`, p.screenshot, `Page structure: ${p.title || p.url || p.id}`)}</td>
    </tr>`).join('');
    return `<div class="sr-j" id="log-structure">
  <h3>Page structure</h3>
  <p class="muted">Heading, landmark and reading-order sweeps with the screen reader's own navigation commands, once per start page. Each sweep notes why it stopped and which commands it sent.</p>
  <div class="table-scroll"><table class="proof probe-t">
    <caption class="sr">Page structure sweeps</caption>
    <thead><tr><th scope="col">Page</th><th scope="col">Headings spoken</th><th scope="col">Landmarks spoken</th><th scope="col">Reading order</th><th scope="col">Screenshot</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</div>`;
  };

  const sessionLog = `<section id="journeys" class="sec" aria-labelledby="journeys-h">
  ${R.secHead('journeys', 'journeys', 'Session log', journeys.length, `${sum.steps ?? 0} steps`)}
  <div class="panel-box">${journeys.map(journeyHtml).join('\n') || '<p class="muted">No journeys were replayed.</p>'}${probesHtml()}</div>
</section>`;

  const groupSection = (s) => {
    if (!s.groups.length) return '';
    const occ = s.groups.reduce((n, g) => n + g.occ.length, 0);
    return `<section id="${s.id}" class="sec" aria-labelledby="${s.id}-h">
  ${R.secHead(s.id, s.id, s.title, s.groups.length, `${occ} occurrence${occ === 1 ? '' : 's'}`)}
  <div class="panel-box">${s.groups.map((g, i) => R.groupHtml(g, s.id, scLink, { targets, where, paraHtml: (t, cls) => String(t).split(/\n+/).filter(Boolean).map((l) => `<p class="${cls}">${clip(l, 'Full text')}</p>`).join('') }, { kind: s.kind, marker: `${s.prefix}${i + 1}` })).join('\n')}</div>
</section>`;
  };

  const main = `<main id="main" class="wrap" tabindex="-1">
${summary()}
${sessionLog}
${sections.map(groupSection).join('\n')}
${present.length ? '' : `<p class="muted">${sum.journeysBlocked || sum.journeysPartial || sum.probesIncomplete ? 'No issues were identified from the narration that was captured, but the run was incomplete (see the warnings above); this is not a pass.' : 'No issues were identified from the narration.'}</p>`}
${dialogs.join('\n')}
</main>
${DIALOG_SCRIPT}`;

  const html = R.pageHtml(`Screen reader validation – ${esc(appName)}`, `${header}\n${nav}\n${main}`).replace('</style>', `${EXTRA_CSS}\n</style>`);
  const out = path.join(runDir, 'sr-report.html');
  fs.writeFileSync(out, html);
  return out;
}
