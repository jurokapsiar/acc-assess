import { esc, halfDonut, bars, legend, toolFill, LEVEL_FILL, COVER_FILL } from './charts.mjs';
import { toolChip } from './sections-a.mjs';

const chip = (cls, text) => `<span class="chip ${cls}">${text}</span>`;

function annotated(img, file, alt, pins, items, caption) {
  return `<div class="annot reveal"><figure class="shot frame">${img(file, alt)}${pins.map(([x, y], i) => `<span class="pin" aria-hidden="true" style="left:${x}%;top:${y}%">${i + 1}</span>`).join('')}</figure>
<div><h3 style="margin-bottom:16px">${esc(caption)}</h3><ol class="legend-list">${items.map(([t, d]) => `<li><div><strong>${esc(t)}</strong><span>${esc(d)}</span></div></li>`).join('')}</ol></div></div>`;
}

export function reports(img) {
  const card = (t, title, file, alt, cap, wide) => `<article class="box ${t} reveal${wide ? ' wide' : ''}"><div class="hd"><h4 style="margin:0">${esc(title)}</h4></div><div class="bd">${img(file, alt)}</div><p class="small muted" style="margin:0;padding:10px 14px;border-top:1px solid var(--line-soft)">${esc(cap)}</p></article>`;
  return `<section id="reports" aria-labelledby="reports-h"><div class="wrap">
<div class="shead"><span class="num" aria-hidden="true">04</span><h2 id="reports-h">The reports</h2><p>Static HTML that opens from disk. Every finding links to a screen, a state, a viewport, a crop and a source line.</p></div>
${annotated(img, 'report-summary.png', 'Assessment report summary section.', [[33, 12], [63, 12], [95, 12], [26, 40], [30, 66], [91, 37]], [
    ['Issues by severity', 'Failures as a half-donut, split by impact.'],
    ['Criteria', 'Criteria with issues, needing review, or with nothing detected. Never "pass": tools can only fail to find problems.'],
    ['Screens with issues', 'How many scoped screens have at least one failure.'],
    ['Issues', 'Confirmed failures, grouped by rule.'],
    ['Needs review', 'Tool results that need judgement, and agent findings.'],
    ['Screens', 'Thumbnails jump to every state assessed.'],
  ], 'Summary')}
${annotated(img, 'report-issue.png', 'One issue card from the report.', [[83, 8], [4, 26], [23, 48], [28, 68], [76, 79]], [
    ['Chips', 'Kind, impact, WCAG criterion and the rule that found it.'],
    ['Fix', 'What to change, in plain words, with the affected files.'],
    ['Source', 'File and line resolved from the rendered element.'],
    ['Occurrence', 'Screen, state and viewport. Steps to reproduce are one click away.'],
    ['Element crop', 'The failing element, outlined on the real screenshot.'],
  ], 'Issue card')}
<div class="sub"><h3>Report sections</h3><p>Each section has its own tint, used in the title row of every box.</p></div>
<div class="gallery shots">
${card('t-criteria', 'Criteria', 'report-criteria.png', 'Criteria section: a table of WCAG criteria with status per criterion.', 'Each criterion with its status and the rules behind it.', true)}
${card('t-review', 'Needs review', 'report-review.png', 'Needs review section: a toggle field flagged by axe-core as needing review.', 'Items a tool could not decide, with the agent\u2019s note.')}
${card('t-scope', 'Scope', 'report-scope.png', 'Scope section: screens, states and viewports that were assessed.', 'What was assessed, and what was not.')}
${card('t-journeys', 'User journeys', 'report-journeys.png', 'User journeys section: each journey with its steps and status.', 'Each journey, step by step, with its outcome.', true)}
</div>
<div class="sub"><h3>Fix-verify report</h3><p>Fixed, not fixed, regressed, unverified or needs review, for each fix file.</p></div>
<div class="grid g2 shots">
${card('t-fixes', 'Verification status', 'fix-summary.png', 'Fix-verify summary: one of one fix verified as fixed; eight of eight proof elements clear.', 'Exit code 0 when all fixed; 1, 2 or 3 otherwise.')}
${card('t-fixes', 'Proof', 'fix-proof.png', 'Fix proof: before and after crops of the same element, now reported clear.', 'Before and after, element by element.')}
</div>
<div class="sub"><h3>Screen-reader report</h3><p>Real NVDA or VoiceOver output, step by step.</p></div>
<div class="grid g2 shots">
${card('t-modalities', 'Summary', 'sr-summary.png', 'Screen-reader report summary: issues by severity and how many steps were narrated.', 'Issues and how many steps produced speech.')}
${card('t-review', 'Finding', 'sr-issue.png', 'Screen-reader finding: navigation produced no announcement.', 'What was heard, what was expected, and the fix.')}
</div>

</div></section>`;
}

const ISSUES = [
  {
    t: 't-issues', title: 'Accessible name does not contain the visible label', rule: 'label-content-name-mismatch', tool: 'axe-core', kind: 'failure', impact: 'serious', sc: '2.5.3',
    what: 'A date button shows “Tuesday, November 3” but its accessible name is “Change task date”. Speech-input users who say what they see can\u2019t activate it.',
    repro: ['Open the app at 1280×800.', 'Select <strong>New task</strong>.', 'Inspect the date button in the dialog.', 'Compare its visible text with its accessible name.'],
    fix: 'Start the accessible name with the visible text.',
    code: '<span class="del">- &lt;button aria-label="Change task date"&gt;Tuesday, November 3&lt;/button&gt;</span><span class="add">+ &lt;button aria-label="Tuesday, November 3, change date"&gt;Tuesday, November 3&lt;/button&gt;</span>',
    img: ['annotated-screen.jpg', 'Task dialog with two numbered red boxes around the date and time buttons.'], img2: ['fix-proof.png', 'Fix-verify proof for this issue: before and after crops, now clear.'],
  },
  {
    t: 't-review', title: 'Toggle field name needs a check', rule: 'aria-toggle-field-name', tool: 'axe-core', kind: 'review', impact: 'serious', sc: '4.1.2',
    what: 'axe-core can\u2019t tell if a wrapping label names a role="switch". The agent checks each occurrence and records the result; mismatches become their own finding.',
    repro: ['Open the switch demo at 1280×800.', 'Inspect each switch.', 'Compare the label text with the computed name.'],
    fix: 'Keep aria-label equal to the visible label, or reference it with aria-labelledby.',
    code: '<span class="add">+ &lt;span role="switch" aria-labelledby="lbl-apca" aria-checked="true"&gt;</span>',
    img: ['report-review.png', 'Report card for the toggle field review item with fix text, source and element crops.'],
  },
  {
    t: 't-review', title: 'Tab order does not follow reading order', rule: 'tab-order-reading-order', tool: 'agent', kind: 'review', impact: '', sc: '1.3.2, 2.4.3',
    what: 'The keyboard walk is overlaid on the screenshot as numbered stops. The agent compares that order with the visual layout.',
    repro: ['Open the screen at 1280×800.', 'Press <kbd>Tab</kbd> from the top of the page.', 'Follow the numbered stops.'],
    fix: 'Make DOM order match visual order. Avoid positive tabindex and CSS-only reordering.',
    img: ['tab-order.jpg', 'Screenshot with numbered tab stops drawn over each focusable element.'],
  },
  {
    t: 't-review', title: 'Navigation produced no announcement', rule: 'sr-silent-navigation', tool: 'Guidepup', kind: 'review', impact: 'moderate', sc: '2.4.3',
    what: 'After a route change the screen reader said nothing, so the user can\u2019t tell where they are.',
    heard: ['(nothing)', 'The new page title or heading'],
    repro: ['Start NVDA.', 'Run the journey with <code>sr.mjs run</code>.', 'Activate the link that changes the view.', 'Listen.'],
    fixKey: 'sr-silent-navigation',
    img: ['sr-issue.png', 'Screen-reader report finding with heard and expected announcements.'],
  },
  {
    t: 't-issues', title: 'Step can only be completed with a mouse', rule: 'kbd-mouse-required', tool: 'Playwright', kind: 'failure', impact: 'critical', sc: '2.1.1', modality: 'keyboard',
    what: 'In the keyboard phase the runner climbed the escalation ladder; only a pointer click completed the step.',
    trace: 'step 3  intent: activate  target: "Add item"\n  rung 0  Tab ×14, Enter, Space   → not reached\n  rung 1  Escape, Home, End        → not reached\n  rung 2  programmatic focus()     → focused, Enter ignored\n  rung 3  mouse click              → completed\n  stuck: no-activation   focus came from: programmatic',
    repro: ['Run the journey with <code>--modality keyboard</code>.', 'Tab to the control.', 'Press <kbd>Enter</kbd> or <kbd>Space</kbd>.'],
    fixKey: 'kbd-mouse-required',
    code: '<span class="del">- &lt;div class="add" onClick={add}&gt;Add item&lt;/div&gt;</span><span class="add">+ &lt;button type="button" onClick={add}&gt;Add item&lt;/button&gt;</span>',
  },
];

export function issues(img, moduleRules) {
  const body = (x) => {
    const fix = x.fix || moduleRules[x.fixKey]?.fix || '';
    return `<div><p>${esc(x.what)}</p>
${x.heard ? `<dl class="heard"><dt>Heard</dt><dd>${esc(x.heard[0])}</dd><dt>Expected</dt><dd>${esc(x.heard[1])}</dd></dl>` : ''}
<h4>Steps to reproduce</h4><ol>${x.repro.map((r) => `<li>${r}</li>`).join('')}</ol>
<div class="fixbox"><div class="hd">Fix</div><p>${esc(fix)}</p>${x.code ? `<pre class="diff"><code>${x.code}</code></pre>` : ''}</div></div>
<div>${x.trace ? `<h4>Escalation trace</h4><pre><code>${esc(x.trace)}</code></pre>` : ''}${x.img ? `<figure class="shotbox">${img(...x.img)}</figure>` : ''}${x.img2 ? `<figure class="shotbox" style="margin-top:12px">${img(...x.img2)}</figure>` : ''}</div>`;
  };
  return `<section id="issues" aria-labelledby="issues-h"><div class="wrap">
<div class="shead"><span class="num" aria-hidden="true">05</span><h2 id="issues-h">Example issues</h2><p>One from each assessor. Every issue carries the evidence, the steps to reproduce it and a fix you can apply.</p></div>
<div class="issues">${ISSUES.map((x) => `<article class="box issue ${x.t} reveal"><div class="hd"><h3>${esc(x.title)}</h3><ul class="chips" aria-label="Details"><li>${toolChip(x.tool)}</li><li>${chip(`k-${x.kind}`, esc(x.kind))}</li>${x.impact ? `<li>${chip(`imp-${x.impact}`, esc(x.impact))}</li>` : ''}<li>${chip('', `<b>SC</b> ${esc(x.sc)}`)}</li><li>${chip('', `<code>${esc(x.rule)}</code>`)}</li>${x.modality ? `<li>${chip('', `<b>modality</b> ${esc(x.modality)}`)}</li>` : ''}</ul></div><div class="bd">${body(x)}</div></article>`).join('')}</div>
</div></section>`;
}

const TOOL_DEF = {
  'axe-core': 'Automated DOM rules per state and viewport.',
  AbleDOM: 'Focus and accessibility-tree checks at runtime.',
  Playwright: 'Custom checks: keyboard walk, overlays, reflow, text spacing, keyboard modality.',
  Guidepup: 'Drives NVDA or VoiceOver and checks what is announced.',
  agent: 'LLM judgement on screenshots, DOM and tool output.',
  manual: 'Needs a human; not automatable.',
};

const data = (o) => Object.entries(o).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
const lv = (l) => `<span class="lv ${l === 'best practice' ? 'lv-bp' : `lv-${l}`}">${l === 'best practice' ? 'BP' : esc(l)}</span>${l === 'best practice' ? '<span class="sr-only">best practice</span>' : ''}`;
const toolsCell = (ts) => `<ul class="chips">${ts.map((t) => `<li>${toolChip(t)}</li>`).join('')}</ul>`;
const ruleList = (ids) => (ids.length ? `<details><summary>${ids.length} rule${ids.length > 1 ? 's' : ''}</summary><ul>${ids.map((i) => `<li><code>${esc(i)}</code></li>`).join('')}</ul></details>` : '<span class="muted">—</span>');

export function catalog(cat, sum) {
  const T = cat.tools;
  const L = ['A', 'AA', 'AAA'];
  const ruleSeg = T.filter((t) => sum.rulesByTool[t]).map((t) => ({ label: t, value: sum.rulesByTool[t], color: toolFill(t) }));
  const lvSeg = Object.keys(LEVEL_FILL).filter((l) => sum.criteriaByLevel[l]).map((l) => ({ label: `Level ${l}`, value: sum.criteriaByLevel[l], color: LEVEL_FILL[l] }));
  const covSeg = [['automated', 'Automated + agent'], ['agent', 'Agent only'], ['manual', 'Manual only']].map(([k, label]) => ({ label, value: sum.coverage[k] || 0, color: COVER_FILL[k] }));
  const principles = [...new Set(cat.criteria.map((c) => c.principle))].filter(Boolean);
  const critRows = cat.criteria.map((c) => `<tr${data({ search: `${c.num} ${c.title} ${c.principle} ${c.tools.join(' ')} ${c.rules.join(' ')}`.toLowerCase(), levels: c.level, principles: c.principle, tools: c.tools.join(' ') })}><td class="id" data-label="SC">${c.url ? `<a href="${esc(c.url)}">${esc(c.num)}</a>` : esc(c.num)}</td><td data-label="Criterion">${esc(c.title)}</td><td data-label="Level">${lv(c.level)}</td><td data-label="Principle">${esc(c.principle)}</td><td data-label="Assessed by">${toolsCell(c.tools)}</td><td data-label="Rules">${ruleList([...new Set(c.rules)])}</td></tr>`).join('');
  const ruleRows = cat.rules.map((r) => `<tr${data({ search: `${r.id} ${r.description} ${r.sc.join(' ')} ${r.tool} ${r.kind} ${r.modality} ${r.principles.join(' ')}`.toLowerCase(), levels: r.levels.join(' ').replace('best practice', 'bp'), principles: r.principles.join(' '), tools: r.tool })}><td class="id" data-label="Rule"><code>${esc(r.id)}</code></td><td data-label="Description">${esc(r.description)}${r.modality ? `<br><span class="small muted">modality: ${esc(r.modality)}</span>` : ''}</td><td data-label="WCAG">${r.sc.length ? esc(r.sc.join(', ')) : '<span class="muted">—</span>'}</td><td data-label="Level">${r.levels.map(lv).join(' ')}</td><td data-label="Principle">${r.principles.length ? esc(r.principles.join(', ')) : '<span class="muted">—</span>'}</td><td data-label="Kind">${esc(r.kind || '—')}${r.severity ? `<br><span class="small muted">${esc(r.severity)}</span>` : ''}</td><td data-label="Assessed by">${toolsCell([r.tool])}</td></tr>`).join('');
  const apgRows = cat.patterns.map((p) => `<tr${data({ search: `${p.slug} ${p.name} ${p.summary} ${p.tools.join(' ')}`.toLowerCase(), levels: '', principles: '', tools: p.tools.join(' ') })}><td class="id" data-label="Pattern"><code>${esc(p.slug)}</code></td><td data-label="Name">${esc(p.name)}</td><td data-label="Summary">${esc(p.summary)}</td><td data-label="Assessed by">${toolsCell(p.tools)}</td><td data-label="Rules">${ruleList(p.rules)}</td></tr>`).join('');
  const panel = (id, kind, noun, head, rows, first) => `<div class="panel" id="p-${id}" role="tabpanel" aria-labelledby="tab-${id}" data-kind="${kind}" data-noun="${noun}"${first ? '' : ' hidden'}><div class="tblwrap"><table class="cat"><caption class="sr-only">${esc(noun[0].toUpperCase() + noun.slice(1))}</caption><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div><p class="empty" hidden>No ${noun} match these filters.</p></div>`;
  return `<section id="catalog" aria-labelledby="catalog-h"><div class="wrap">
<div class="shead"><span class="num" aria-hidden="true">06</span><h2 id="catalog-h">Criteria catalog</h2><p>Every WCAG 2.2 criterion, rule and APG pattern the suite covers, and what assesses it. Generated from the rule sources.</p></div>
<div class="charts">
<div class="box t-summary chart reveal"><div class="hd"><h3>Rules by assessor</h3></div><div class="bd">${halfDonut(ruleSeg, { label: 'Rules by assessor', total: sum.rules, caption: 'rules' })}</div></div>
<div class="box t-criteria chart reveal"><div class="hd"><h3>Criteria by level</h3></div><div class="bd">${halfDonut(lvSeg, { label: 'Criteria by level', total: sum.criteria, caption: 'criteria' })}</div></div>
<div class="box t-fixes chart reveal"><div class="hd"><h3>How criteria are covered</h3></div><div class="bd">${halfDonut(covSeg, { label: 'How criteria are covered', total: sum.criteria, caption: 'criteria' })}</div></div>
<div class="box t-scope chart reveal"><div class="hd"><h3>Criteria per assessor</h3></div><div class="bd">${bars(T.filter((t) => sum.criteriaByTool[t]).map((t) => ({ label: t, value: sum.criteriaByTool[t], color: toolFill(t) })), sum.criteria)}<p class="small muted" style="margin:0">A criterion can have several assessors.</p></div></div>
</div>
<ul class="toolkey">${T.map((t) => `<li>${toolChip(t)}<span>${esc(TOOL_DEF[t] || '')}</span></li>`).join('')}</ul>
<div class="tabs" role="tablist" aria-label="Catalog">
<button role="tab" id="tab-criteria" aria-controls="p-criteria" aria-selected="true" tabindex="0">WCAG criteria<span class="c">${sum.criteria}</span></button>
<button role="tab" id="tab-rules" aria-controls="p-rules" aria-selected="false" tabindex="-1">Rules<span class="c">${sum.rules}</span></button>
<button role="tab" id="tab-apg" aria-controls="p-apg" aria-selected="false" tabindex="-1">APG patterns<span class="c">${sum.patterns}</span></button>
</div>
<div class="filters" id="filters" role="search" aria-label="Filter catalog" hidden>
<div class="field"><label for="f-q">Search</label><input id="f-q" type="search" placeholder="id, title, rule…" autocomplete="off"></div>
<div class="field"><label for="f-level">Level</label><select id="f-level"><option value="">All levels</option>${L.map((l) => `<option value="${l}">${l}</option>`).join('')}<option value="bp">Best practice</option></select></div>
<div class="field"><label for="f-principle">Principle</label><select id="f-principle"><option value="">All principles</option>${principles.map((p) => `<option>${esc(p)}</option>`).join('')}</select></div>
<fieldset class="toolbtns"><legend>Assessed by (any)</legend>${T.map((t) => `<button type="button" aria-pressed="false" data-tool="${esc(t)}">${esc(t)}</button>`).join('')}</fieldset>
<button type="button" class="reset" id="f-reset">Reset</button>
</div>
<p class="count" id="f-count" aria-live="polite"></p>
${panel('criteria', 'criteria', 'criteria', ['SC', 'Criterion', 'Level', 'Principle', 'Assessed by', 'Rules'], critRows, true)}
${panel('rules', 'rules', 'rules', ['Rule', 'Description', 'WCAG', 'Level', 'Principle', 'Kind', 'Assessed by'], ruleRows)}
${panel('apg', 'apg', 'patterns', ['Pattern', 'Name', 'Summary', 'Assessed by', 'Rules'], apgRows)}
</div></section>`;
}

export function footer(sources) {
  return `<footer><div class="wrap"><p>Generated by <code>guide/build-guide.mjs</code> from:</p><ul>${sources.map((s) => `<li><code>${esc(s)}</code></li>`).join('')}</ul><p style="margin-top:12px">Screenshots are from assessments of sample apps.</p></div></footer>`;
}
