import { esc } from './charts.mjs';

const NODES = [
  ['Scope', 'scope.json · journeys', '--t-scope', 'scope-definition'],
  ['Inventory', 'inventory.json', '--t-journeys', 'accessibility-assessment'],
  ['Assess', 'axe · AbleDOM · Playwright', '--t-criteria', 'accessibility-assessment'],
  ['Report', 'report.html', '--t-summary', 'accessibility-assessment'],
  ['Fix files', 'fix-*.md', '--t-review', 'accessibility-assessment'],
  ['Fix-verify', 'fix-report.html', '--t-fixes', 'fix-verify'],
  ['Screen reader', 'NVDA · VoiceOver', '--t-modalities', 'screen-reader-validation'],
];
const TINT = { '--t-scope': '#e8f1fb', '--t-journeys': '#dff3ef', '--t-criteria': '#efebf8', '--t-summary': '#f3f1ea', '--t-review': '#fcf2d6', '--t-fixes': '#e3f4e7', '--t-modalities': '#ebe8f7' };

const ARROW = `<defs><marker id="ah-%" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#555"/></marker></defs>`;

function node(i, x, y, w, h) {
  const [title, out, tint] = NODES[i];
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${TINT[tint]}" stroke="#b9b9b9"/>
<circle cx="${x + 22}" cy="${y + 24}" r="12" fill="#fff" stroke="#8a8a8a"/><text x="${x + 22}" y="${y + 28}" text-anchor="middle" font-size="11" font-weight="700" fill="#1f1f1f">${i + 1}</text>
<text x="${x + 42}" y="${y + 29}" font-size="15" font-weight="700" fill="#1f1f1f">${esc(title)}</text>
<text x="${x + 14}" y="${y + h - 16}" font-size="11.5" fill="#444">${esc(out)}</text></g>`;
}

function flowH() {
  const w = 146, h = 88, gap = (1160 - 7 * w) / 6, y = 70;
  const X = (i) => i * (w + gap);
  let s = ARROW.replace('%', 'h');
  const groups = [[0, 0, 'scope-definition'], [1, 4, 'accessibility-assessment'], [5, 5, 'fix-verify'], [6, 6, 'screen-reader-validation']];
  for (const [a, b, name] of groups) {
    const x0 = X(a), x1 = X(b) + w;
    const fs = name.length * 7 > x1 - x0 ? 10 : 12;
    s += `<path d="M${x0 + 4} 40 V32 H${x1 - 4} V40" fill="none" stroke="#9a9a9a"/><text x="${(x0 + x1) / 2}" y="22" text-anchor="middle" font-size="${fs}" fill="#444" font-family="ui-monospace,Consolas,monospace">${name}</text>`;
  }
  for (let i = 0; i < 7; i++) {
    s += node(i, X(i), y, w, h);
    if (i < 6) s += `<line x1="${X(i) + w + 2}" y1="${y + h / 2}" x2="${X(i + 1) - 3}" y2="${y + h / 2}" stroke="#555" stroke-width="1.5" marker-end="url(#ah-h)"/>`;
  }
  const a = X(5) + w / 2, b = X(4) + w / 2, yb = y + h;
  s += `<path class="dash" d="M${a} ${yb + 2} C ${a} ${yb + 56}, ${b} ${yb + 56}, ${b} ${yb + 4}" fill="none" stroke="#555" stroke-width="1.5" marker-end="url(#ah-h)"/>
<rect x="${(a + b) / 2 - 78}" y="${yb + 36}" width="156" height="24" rx="12" fill="#fbe2df" stroke="#c9a6a1"/><text x="${(a + b) / 2}" y="${yb + 52}" text-anchor="middle" font-size="12" fill="#1f1f1f">not fixed → revise</text>
<rect x="${X(0) + w / 2 - 62}" y="${yb + 36}" width="124" height="24" rx="12" fill="#fff" stroke="#9a9a9a"/><text x="${X(0) + w / 2}" y="${yb + 52}" text-anchor="middle" font-size="12" fill="#1f1f1f">human approves</text>
<line x1="${X(0) + w / 2}" y1="${yb + 2}" x2="${X(0) + w / 2}" y2="${yb + 34}" stroke="#9a9a9a"/>
<rect x="${X(4) + w / 2 - 78}" y="${y - 12}" width="156" height="22" rx="11" fill="#1f1f1f"/><text x="${X(4) + w / 2}" y="${y + 3}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#fff">Code edit out of scope</text>`;
  return `<svg class="h" viewBox="0 -4 1160 252" role="img" aria-labelledby="fh-t fh-d"><title id="fh-t">Workflow diagram</title><desc id="fh-d">Seven steps from left to right: 1 Scope, 2 Inventory, 3 Assess, 4 Report, 5 Fix files, 6 Fix-verify, 7 Screen reader. A human approves the scope. Code edits after step 5 are out of scope due to code base specifics. When fix-verify reports not fixed, the loop goes back to step 5.</desc>${s}</svg>`;
}

function flowV() {
  const w = 232, h = 76, x = 16, step = 100, y0 = 10;
  let s = ARROW.replace('%', 'v');
  for (let i = 0; i < 7; i++) {
    const y = y0 + i * step;
    s += node(i, x, y, w, h);
    s += `<text x="${x + w - 12}" y="${y + 29}" text-anchor="end" font-size="10" fill="#555" font-family="ui-monospace,Consolas,monospace">${i === 0 ? 'scope-def.' : i === 5 ? 'fix-verify' : i === 6 ? 'sr-valid.' : 'assessment'}</text>`;
    if (i < 6) s += `<line x1="${x + w / 2}" y1="${y + h + 2}" x2="${x + w / 2}" y2="${y + step - 3}" stroke="#555" stroke-width="1.5" marker-end="url(#ah-v)"/>`;
  }
  const y5 = y0 + 5 * step + h / 2, y4 = y0 + 4 * step + h / 2;
  s += `<path class="dash" d="M${x + w + 2} ${y5} C ${x + w + 44} ${y5}, ${x + w + 44} ${y4}, ${x + w + 4} ${y4}" fill="none" stroke="#555" stroke-width="1.5" marker-end="url(#ah-v)"/>
<text x="${x + w + 42}" y="${(y4 + y5) / 2 - 2}" font-size="12" fill="#1f1f1f">not</text><text x="${x + w + 42}" y="${(y4 + y5) / 2 + 12}" font-size="12" fill="#1f1f1f">fixed</text>`;
  return `<svg class="v" viewBox="0 0 340 720" role="img" aria-labelledby="fv-t fv-d"><title id="fv-t">Workflow diagram</title><desc id="fv-d">Seven steps from top to bottom: 1 Scope, 2 Inventory, 3 Assess, 4 Report, 5 Fix files, 6 Fix-verify, 7 Screen reader. When fix-verify reports not fixed, the loop goes back to step 5.</desc>${s}</svg>`;
}

const chip = (cls, text) => `<span class="chip ${cls}">${text}</span>`;
export const toolChip = (t) => chip(`tool-${esc(t)}`, esc(t));

export function hero(sum, img) {
  return `<section class="hero" aria-labelledby="top-h"><div class="wrap">
<div>
<p class="eyebrow"><a href="https://www.w3.org/TR/WCAG22/">WCAG 2.2</a> + <a href="https://www.w3.org/WAI/ARIA/apg/">WAI-ARIA APG</a></p>
<h1 id="top-h">acc-assess</h1>
<p class="lede">A set of skills that validate accessibility based on user journeys, using deterministic tools and agents. <a href="https://github.com/dequelabs/axe-core">axe-core</a> static analysis, <a href="https://github.com/microsoft/abledom">AbleDOM</a> real-time analysis and <a href="https://www.w3.org/WAI/ARIA/apg/">WAI-ARIA APG</a> pattern review against <a href="https://www.w3.org/TR/WCAG22/">WCAG 2.2</a> combine into a comprehensive analysis.</p>
<p class="note">It still does not replace manual testing. It aims to make manual testing more accurate. <strong>Research phase:</strong> no evals yet, and validated with few models so far.</p>
</div>
<figure class="frame"><div class="bar" aria-hidden="true"><i></i><i></i><i></i><span>report.html</span></div>${img('report-summary.png', 'Report summary: half-donut charts for issues and criteria, issue groups by severity and a strip of screen thumbnails.')}</figure>
</div></section>`;
}

const INSTALL = [
  ['Option 1 · skills CLI', 'recommended', 't-fixes', 'Vercel\'s <a href="https://github.com/vercel-labs/skills">skills</a> CLI installs into the native skill folders of Claude Code, Cursor, Codex, GitHub Copilot, Gemini CLI, Antigravity and more. Omit <code>--global</code> for a project install; add <code>--agent claude-code cursor</code> to pick agents.',
    'npx skills add jurokapsiar/acc-assess --skill \'*\' --global --yes\ncd ~/.agents/skills/accessibility-assessment   # or the path the CLI printed\nnpm run setup'],
  ['Option 2 · Claude Code plugin', 'auto-updates', 't-scope', 'Setup is automatic: a background <code>SessionStart</code> hook installs whatever is missing in the installed plugin copy, and again after each plugin update. Skills are namespaced, e.g. <code>/acc-assess:accessibility-assessment</code>.',
    '/plugin marketplace add jurokapsiar/acc-assess\n/plugin install acc-assess@acc-assess'],
  ['Option 3 · Other agents', 'manual', 't-journeys', 'Copy all four <code>skills/*/</code> folders, side by side, into the agent\'s documented skill directory, then run setup in <code>accessibility-assessment/</code>.',
    'cp -r skills/* <agent-skills-dir>/\ncd <agent-skills-dir>/accessibility-assessment\nnpm run setup'],
  ['Option 4 · Release download', 'planned', 't-review', 'A GitHub Action will publish a <code>skills/</code> zip with every version tag (tests and plugin validation first). Until the first release, download the repository ZIP from GitHub and copy the four <code>skills/*/</code> folders as in option 3.',
    'cd ~/.claude/skills/accessibility-assessment\nnpm run setup'],
];

export function install() {
  return `<section id="install" aria-labelledby="install-h"><div class="wrap">
<div class="shead"><span class="num" aria-hidden="true">01</span><h2 id="install-h">Install</h2><p>Four <a href="https://agentskills.io">Agent Skills</a> plus a Claude Code plugin wrapper. Install all four together: the companion skills load Playwright and shared code from <code>accessibility-assessment</code>. Needs Node.js 20+, npm, and network access on first setup.</p></div>
<div class="grid g2">${INSTALL.map(([title, tag, t, text, cmd]) => `<article class="box ${t} reveal"><div class="hd"><h3>${esc(title)}</h3><span class="who">${esc(tag)}</span></div><div class="bd"><p>${text}</p><pre><code>${esc(cmd)}</code></pre></div></article>`).join('')}</div>
<div class="never research"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6M10 2v6l-6 11a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3L14 8V2" fill="#fff" stroke="#1f1f1f" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 15h10" stroke="#1f1f1f" stroke-width="1.6"/></svg><p><strong>Research phase.</strong> The skills still lack evals and validation across models. Agentic review does not replace user testing. <code>npm run setup</code> is idempotent: it installs only what is missing (npm deps, Playwright Chromium, the WCAG 2.2 + APG knowledge cache), and <code>npm run setup:check</code> prints <code>ready</code> when done.</p></div>
</div></section>`;
}

const STEPS = [
  ['scope-definition', 't-scope', 'Define the scope', 'Describe what to test in plain words. The skill turns it into screens, states and user journeys and asks you to approve them.', 'node scripts/scope.mjs init --prompt "New task flow and settings" --url http://localhost:3000', ['scope.json', 'journeys.json'], 'you approve'],
  ['accessibility-assessment', 't-journeys', 'Discover the inventory', 'Features, screens and states are discovered and checked against the scope, so nothing in scope is skipped silently.', 'node scripts/inventory.mjs validate\nnode scripts/inventory.mjs verify', ['inventory.json'], 'skill'],
  ['accessibility-assessment', 't-criteria', 'Assess', 'Every screen and state at each viewport: axe-core, AbleDOM, and Playwright checks such as keyboard walk, overlays, 320px reflow and text spacing.', 'node scripts/assess.mjs --scope .a11y/scope.json', ['results.json', 'screenshots'], 'skill'],
  ['accessibility-assessment', 't-summary', 'Review and report', 'The agent reviews what tools cannot decide and records its judgement. The report groups failures, items to review and suggestions.', 'node scripts/report.mjs', ['report.html'], 'skill + agent'],
  ['accessibility-assessment', 't-review', 'Write fix files', 'One Markdown file per issue: the fix, the changes, the occurrences, repro steps and a verify command. Applying the change is out of scope due to code base specifics.', 'node scripts/fixes.mjs', ['fix-*.md'], 'code edit out of scope'],
  ['fix-verify', 't-fixes', 'Verify the fix', 'Re-runs each fix file against the changed app and proves it with before/after crops of every occurrence.', 'node scripts/verify.mjs .a11y/fixes/fix-*.md', ['fix-report.html', 'exit 0 · 1 · 2 · 3'], 'skill'],
  ['screen-reader-validation', 't-modalities', 'Validate with a screen reader', 'Drives NVDA (Windows) or VoiceOver (macOS) through the same journeys with Guidepup and checks what is actually announced.', 'node scripts/sr.mjs preflight\nnode scripts/sr.mjs run --scope .a11y/scope.json\nnode scripts/sr.mjs analyse && node scripts/sr.mjs report', ['sr-report.html'], 'skill'],
];

export function workflow() {
  return `<section id="workflow" aria-labelledby="workflow-h"><div class="wrap">
<div class="shead"><span class="num" aria-hidden="true">02</span><h2 id="workflow-h">Workflow</h2><p>Seven steps, four skills. Each step writes a file the next step reads, so you can stop, inspect and resume.</p></div>
<div class="flow reveal">${flowH()}${flowV()}</div>
<ol class="steps">${STEPS.map(([skill, t, title, text, cmd, outs, who]) => `<li class="box ${t} reveal"><div class="hd"><h3>${esc(title)}</h3><span class="who">${esc(who)}</span></div><div class="bd"><p>${esc(text)}</p><pre><code>${esc(cmd)}</code></pre><div class="io"><span>Skill: <code>${esc(skill)}</code></span><span>Writes: ${outs.map((o) => `<code>${esc(o)}</code>`).join(' ')}</span></div></div></li>`).join('')}</ol>
<div class="never"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.5 9.3-8 11-4.5-1.7-8-6-8-11V5z" fill="#fff" stroke="#1f1f1f" stroke-width="1.6"/><path d="M8 12l3 3 5-6" fill="none" stroke="#1f1f1f" stroke-width="1.8"/></svg><p><strong>The skills never edit your source code.</strong> They read, run and report. Fixes are proposals in <code>fix-*.md</code>. Editing code is out of scope due to code base specifics; apply them with your own process, then fix-verify proves the result.</p></div>
</div></section>`;
}

const SKILLS = [
  ['scope-definition', 't-scope', 'Turns a sentence into an approved, reproducible test scope.', ['Screens, states and viewports from your prompt', 'User journeys as replayable steps', 'Pause for human approval before any assessment'], 'Assess the checkout flow on mobile and desktop.', 'scope.json, journeys.json'],
  ['accessibility-assessment', 't-criteria', 'Runs the tools, adds agent review, and writes the report and fix files.', ['axe-core, AbleDOM and Playwright checks per state', 'Agent judgement for what tools cannot decide', 'One fix file per issue, with repro and verify command'], 'Run an accessibility assessment of the approved scope.', 'report.html, fix-*.md'],
  ['fix-verify', 't-fixes', 'Proves that an applied fix worked, without new regressions.', ['Re-runs only what the fix file names', 'Before/after crops for every occurrence', 'Status: fixed, not fixed, regressed, unverified, needs review'], 'Verify the fixes I just applied.', 'fix-report.html'],
  ['screen-reader-validation', 't-modalities', 'Listens to real NVDA or VoiceOver output for each journey.', ['Guidepup drives the reader with OS-level keys', 'Session log: step, keys, what was heard', 'Silent, missing or wrong announcements become issues'], 'Check the new-task journey with NVDA.', 'sr-report.html'],
];

export function skills() {
  return `<section id="skills" aria-labelledby="skills-h"><div class="wrap">
<div class="shead"><span class="num" aria-hidden="true">03</span><h2 id="skills-h">The skills</h2><p>Ask in plain language. Each skill knows its scripts and hands off to the next.</p></div>
<div class="grid g4">${SKILLS.map(([name, t, what, list, prompt, out]) => `<article class="box skill ${t} reveal"><div class="hd"><h3><code>${esc(name)}</code></h3></div><div class="bd"><p>${esc(what)}</p><ul>${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p class="prompt">${esc(prompt)}</p><p class="out">Output: ${esc(out)}</p></div></article>`).join('')}</div>
</div></section>`;
}

const MODS = [
  ['keyboard', 'assessment', 'Tab, Shift+Tab, arrows, Enter, Space. Other keys only by escalation.', 'kbd-*', 'Mouse or programmatic focus needed = failure.'],
  ['mouse', 'assessment', 'Pointer click, hover and drag. Keys only to type values.', 'ptr-*', 'The reference pass: proves the journey is reachable at all.'],
  ['sr-keyboard', 'screen reader', 'The same keys, sent through the reader as OS keys. Browse or focus mode is recorded.', 'kbd-* + sr-*', 'Same failures, with reader context.'],
  ['sr-navigation', 'screen reader', 'Reader commands: quick-nav keys, elements list or rotor, browse arrows; keyboard keys too.', 'srnav-*', 'Reachable only by keyboard = review.'],
];

export function modalities(sum) {
  const k = (s) => s.split(',').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ');
  return `<section id="modalities" aria-labelledby="modalities-h"><div class="wrap">
<div class="shead"><span class="num" aria-hidden="true">04</span><h2 id="modalities-h">Interaction modalities</h2><p>Every journey step records how it was performed, so a run can't pass just because the runner clicked through. Described as specified; names and flags may still be refined.</p></div>
<div class="grid g4 mods">${MODS.map(([m, phase, keys, rules, judge]) => `<article class="box t-modalities reveal"><div class="hd"><h3><code>${m}</code></h3></div><div class="bd"><p>${esc(keys)}</p><dl><dt>Phase</dt><dd>${esc(phase)}</dd><dt>Rules</dt><dd><code>${esc(rules)}</code></dd><dt>Judged</dt><dd>${esc(judge)}</dd></dl></div></article>`).join('')}</div>
<p class="muted small" style="margin-top:14px">Run with <code>--modality keyboard,mouse</code> (assessment) or <code>--modality sr-keyboard,sr-navigation</code> (screen reader); <code>all</code> runs both of a skill's phases. Each modality is a separate replay in a fresh browser. Journeys without modalities keep the default behaviour.</p>
<div class="sub"><h3>When the keyboard gets stuck: the escalation ladder</h3><p>The runner climbs only as far as needed, records each rung, and keeps going.</p></div>
<ol class="ladder reveal">
<li class="l0"><span class="rung">rung 0</span><strong>Core keys</strong>${k('Tab,Shift+Tab,↑ ↓ ← →,Enter,Space')}<br>${chip('k-suggestion', 'no issue')}</li>
<li class="l1"><span class="rung">rung 1</span><strong>Other keys</strong>${k('Esc,Home,End,F6')} or a documented shortcut<br>${chip('k-suggestion', 'kbd-nonstandard-key · suggestion')}</li>
<li class="l2"><span class="rung">rung 2</span><strong>Programmatic focus</strong>The runner had to call <code>focus()</code><br>${chip('k-failure', 'kbd-programmatic-focus · failure')}</li>
<li class="l3"><span class="rung">rung 3</span><strong>Mouse</strong>Only a click got through<br>${chip('k-failure', 'kbd-mouse-required · failure')}</li>
<li class="l4"><span class="rung">rung 4</span><strong>Give up</strong>The journey is reported as partial<br>${chip('k-review', 'partial journey')}</li>
</ol>
<div class="grid g3" style="margin-top:28px">
<div class="box t-modalities reveal"><div class="hd"><h3>Why it got stuck</h3></div><div class="bd"><ul class="tags">${['trap', 'not-in-tab-sequence', 'composite-no-arrows', 'no-activation', 'focus-lost', 'target-hidden'].map((x) => `<li>${x}</li>`).join('')}</ul><p class="small muted" style="margin:10px 0 0">Each reason maps to a <code>kbd-*</code> rule with evidence and a fix.</p></div></div>
<div class="box t-modalities reveal"><div class="hd"><h3>Screen-reader navigation order</h3></div><div class="bd"><ol class="small" style="margin:0;padding-left:18px"><li>Quick-nav: ${k('H,D,K,B,F')} …</li><li>Elements list: ${k('NVDA+F7')} or the VoiceOver rotor</li><li>Browse-mode arrows and reading</li><li>Keyboard keys (then it's <code>srnav-*</code> review)</li></ol></div></div>
<div class="box t-modalities reveal"><div class="hd"><h3>Recorded per step</h3></div><div class="bd"><p class="small" style="margin:0 0 6px"><strong>Intent</strong></p><ul class="tags">${['reach', 'activate', 'enter-text', 'choose', 'toggle', 'dismiss', 'open', 'read'].map((x) => `<li>${x}</li>`).join('')}</ul><p class="small" style="margin:10px 0 6px"><strong>Focus came from</strong></p><ul class="tags">${['key', 'pointer', 'page', 'programmatic'].map((x) => `<li>${x}</li>`).join('')}</ul></div></div>
</div>
<p class="muted small" style="margin-top:14px">${sum.modalityRules} modality rules are in the catalog below. Page autofocus isn't a runner violation; when it leaves the reader in focus mode it is flagged for review.</p>
</div></section>`;
}
