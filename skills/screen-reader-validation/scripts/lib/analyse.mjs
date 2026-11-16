// Deterministic narration heuristics. Input: the replay results ({ reader, simulated, journeys,
// probes } from session.mjs); output: findings shaped like the assessment's finding schema
// (source "screen-reader") so they can later be merged into the main report. Pure: no I/O.
//
// Each step record carries the narration captured around the action (plus late phrases that
// arrived before the next action) and DOM "facts" before/after (focus, dialogs, live regions,
// errors). Rules compare what changed in the DOM with what the screen reader actually said.
// Uncertain evidence is reported as `review`, never as a confirmed failure: ambiguous text
// matches, heuristic error candidates, non-modal dialogs, and steps whose speech capture was
// not reliable (real reader not aligned / capture unavailable). See references/heuristics.md.
import { RULES } from './rules.mjs';

const ROLE_STATE_WORDS = new Set(`button toggle menu link edit editable text field textbox check box checkbox radio combo
  list listbox option tab item switch slider spin tree view graphic image img heading level dialog web group region landmark
  navigation main banner complementary contentinfo clickable expanded collapsed pressed not checked unchecked ticked
  on off selected unavailable dimmed disabled invalid entry required blank has protected secure focused visited popup
  submenu read only multi line multiline document frame collapsible pop up grid cell row column table`.split(/\s+/).filter(Boolean));
const BLANK_WORDS = /\b(blank|unlabell?ed|clickable)\b/;
const HINT_RE = [/you are currently (on|in) [^.,;]*[.,;]?/gi, /to (click|select|activate|press|interact|enter|exit|expand|collapse|open|close|start|choose)[^.;]*[.;]?/gi, /press control-option[^.;]*[.;]?/gi];
// [positive words, negative words]; negatives are matched (and removed) first so that
// "not checked" never counts as "checked".
const STATE_WORDS = {
  expanded: [['expanded', 'open'], ['collapsed', 'closed', 'collapse']],
  pressed: [['pressed', 'selected', 'on'], ['not pressed', 'unselected', 'not selected', 'off']],
  checked: [['checked', 'ticked', 'selected', 'on'], ['not checked', 'unchecked', 'not ticked', 'not selected', 'off']],
  selected: [['selected'], ['not selected', 'unselected']],
};
const NAV_ACTIONS = new Set(['goto', 'reload', 'back', 'forward']);
const QUIET_ACTIONS = new Set(['fill', 'type', 'hover', 'select']);
const ROLE_RE = /(^| )(button|link|edit|check box|checkbox|radio|radio button|combo box|tab|menu item|switch|slider|option|text field|toggle button)( |$)/;
const SYMBOL_RE = /[\p{Extended_Pictographic}\p{Co}]/u;
const NOT_SYMBOL = /[©®™‼⁉↔-↙↩↪⌚⌛⌨⏏⏩-⏳⏸-⏺]/u;
const MAX_PHRASE = 160;
const UNRELIABLE_PROBE = new Set(['unsupported', 'error', 'invalid-focus-mode']);

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const stripHints = (s) => HINT_RE.reduce((t, re) => t.replace(re, ' '), String(s ?? ''));
const tokens = (s) => norm(s).split(' ').filter(Boolean);
const phrasesOf = (narration) => (narration ?? []).map((p) => String(p ?? '').trim()).filter(Boolean);

/** Words of a phrase that are not role/state/hint vocabulary (i.e. name or content words). */
export function contentWords(phrase) {
  return tokens(stripHints(phrase)).filter((w) => !ROLE_STATE_WORDS.has(w) && !/^\d+$/.test(w));
}

const hasSeq = (hay, needle) => {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let k = 0;
    while (k < needle.length && hay[i + k] === needle[k]) k++;
    if (k === needle.length) return true;
  }
  return false;
};

/**
 * Was `text` spoken in one of the phrases? Whole-word matching within a single phrase:
 * `'yes'` when the full word sequence (or, for long texts, its first 6 words) appears;
 * `'partial'` when most of its words appear in one phrase (low confidence -> review);
 * `'no'` otherwise. "Unsaved changes" never matches "Saved".
 */
export function match(narration, text) {
  const t = tokens(text);
  if (!t.length) return 'yes';
  const phrases = phrasesOf(narration).map(tokens);
  if (phrases.some((p) => hasSeq(p, t) || (t.length > 8 && hasSeq(p, t.slice(0, 6))))) return 'yes';
  const words = t.filter((w) => w.length > 2);
  if (words.length && phrases.some((p) => words.filter((w) => p.includes(w)).length / words.length >= 0.6)) return 'partial';
  return 'no';
}

/** Boolean form of `match`: spoken with at least partial confidence. */
export const spoken = (narration, text) => match(narration, text) !== 'no';

const hasWord = (narration, word) => phrasesOf(narration).some((p) => hasSeq(tokens(p), tokens(word)));

/**
 * The state the narration announced: true / false / null (not announced). Negatives are matched
 * first; the last phrase that states it wins (focus may announce the old state before the change).
 */
export function announcedState(narration, st) {
  const [onWords, offWords] = STATE_WORDS[st];
  let last = null;
  for (const p of phrasesOf(narration)) {
    let t = ` ${tokens(p).join(' ')} `;
    let neg = false;
    for (const w of offWords) {
      if (t.includes(` ${w} `)) { neg = true; t = t.split(` ${w} `).join(' '); }
    }
    const pos = onWords.some((w) => t.includes(` ${w} `));
    if (pos !== neg) last = pos;
  }
  return last;
}

const symbolic = (s) => [...String(s ?? '')].some((c) => SYMBOL_RE.test(c) && !NOT_SYMBOL.test(c));
const quote = (s) => `"${String(s).length > 120 ? `${String(s).slice(0, 117)}...` : s}"`;
const narrText = (n) => (n.length ? n.map(quote).join(' → ') : '(nothing spoken)');

function repeated(phrase) {
  const w = tokens(phrase);
  for (let k = Math.min(6, Math.floor(w.length / 2)); k >= 1; k--) {
    for (let i = 0; i + 2 * k <= w.length; i++) {
      const a = w.slice(i, i + k).join(' ');
      if (a.length >= 3 && !/^\d+$/.test(a) && a === w.slice(i + k, i + 2 * k).join(' ')) return a;
    }
  }
  return null;
}

/** All findings for a results object. Stable ids: `sr-<n>` in detection order. */
export function analyse(results) {
  const out = [];
  const seen = new Set();
  const simulated = !!results.simulated;
  const add = (ruleId, { target, repro, node, evidence, kind, impact, wcag, description, confidence, meta }) => {
    const r = RULES[ruleId] ?? meta;
    const key = `${ruleId}|${target}|${node.selector}|${node.summary}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id: `sr-${out.length + 1}`, source: 'screen-reader', rule: ruleId, kind: kind ?? r.kind, title: r.title,
      description: description ?? r.description, impact: impact ?? r.impact, wcag: wcag ?? r.wcag, fix: r.fix,
      target, repro, nodes: [node], evidence: { ...evidence, simulated, ...(confidence ? { confidence } : {}) },
    });
  };

  for (const j of results.journeys ?? []) {
    const openers = new Map();
    const jkey = j.key ?? j.id;
    const repro = (n) => j.steps.slice(0, n).map((s) => s.description);
    for (const s of j.steps ?? []) {
      // Modality barriers (keyboard-only failures) are reported even when the step was blocked.
      for (const f of s.modalityFindings ?? []) {
        const meta = RULES[f.rule] ?? f.meta;
        if (!meta) continue;
        add(f.rule, {
          target: `${jkey}#${s.n}`, repro: repro(s.n), meta,
          node: { selector: s.target?.selector ?? s.facts?.after?.focus?.selector ?? 'body', html: s.target?.html ?? '', summary: f.note ?? meta.title, screenshot: s.screenshot },
          evidence: { modality: s.modality, keys: s.keysSent ?? [], escalation: s.escalation ?? null, presses: s.presses ?? 0, narration: phrasesOf([...(s.narration ?? []), ...(s.late ?? [])]), expected: 'Reachable and operable with Tab, Shift+Tab, arrows, Enter and Space only.' },
        });
      }
      if (s.modality === 'sr-navigation' && s.ok && s.readerMode && s.readerMode !== 'browse') {
        add('srnav-focus-mode-required', {
          target: `${jkey}#${s.n}`, repro: repro(s.n),
          node: { selector: s.target?.selector ?? 'body', html: '', summary: `Reader mode while reading: ${s.readerMode}${s.modeConfidence ? ` (${s.modeConfidence})` : ''}.`, screenshot: s.screenshot },
          evidence: { modality: s.modality, expected: 'Content readable in browse mode.' },
        });
      }
      if (!s.ok) continue;
      const b = s.facts?.before;
      const a = s.facts?.after;
      if (!a) continue;
      // Everything said for this step: the capture window plus late phrases before the next action.
      const narr = phrasesOf([...(s.narration ?? []), ...(s.late ?? [])]);
      const health = s.capture?.health ?? (simulated ? 'simulated' : 'captured');
      const reliable = simulated || health === 'captured';
      const target = `${jkey}#${s.n}`;
      const focusMoved = !a.focus.isBody && a.focus.selector !== b?.focus?.selector;
      const navigated = NAV_ACTIONS.has(s.action) || (!!b && b.url !== a.url);
      const elNode = (summary, el = a.focus) => ({ selector: el?.selector ?? 'body', html: el?.html ?? '', summary, screenshot: s.screenshot });
      const ctx = { target, repro: repro(s.n) };
      const step = [];
      const hit = (ruleId, o) => {
        step.push(ruleId);
        const kind = o.kind ?? RULES[ruleId].kind;
        // Without a reliable capture, silence is not evidence: downgrade to review.
        const downgrade = !reliable && kind === 'failure';
        add(ruleId, {
          ...ctx, ...o,
          kind: downgrade ? 'review' : kind,
          evidence: { ...o.evidence, ...(reliable ? {} : { capture: health }) },
          confidence: downgrade ? `capture ${health}` : o.confidence,
        });
      };

      if (NAV_ACTIONS.has(s.action) && /^(input|textarea)$/i.test(a.focus?.tag ?? '') && !a.focus.isBody) {
        add('sr-autofocus-focus-mode', { ...ctx, node: elNode(`Focus is already in <${a.focus.tag}> after the page loaded.`), evidence: { narration: narr, expected: 'No editable field focused on load.' } });
      }
      if (s.modality === 'sr-navigation' && s.action !== 'goto' && s.readerMode === 'browse' && s.target?.name) {
        const probe = (results.probes ?? []).find((p) => p.journey === jkey && !p.error);
        const reading = probe?.reading;
        const wanted = norm(s.target.name);
        const dup = (j.steps ?? []).filter((x) => norm(x.target?.name) === wanted).length > 1;
        if (wanted && !dup && reading && !UNRELIABLE_PROBE.has(reading.termination) && (reading.spoken ?? []).length && reading.termination !== 'cap' && !(reading.spoken ?? []).some((x) => spoken([x.text], s.target.name))) {
          add('srnav-not-reachable', { ...ctx, node: elNode(`${quote(s.target.name)} was not found in the reader's reading sweep (${reading.termination}).`, s.target), evidence: { narration: (reading.spoken ?? []).map((x) => x.text).slice(0, 12), expected: quote(s.target.name) }, confidence: 'name-based match only; the reader position is not tied to the DOM element' });
        }
      }

      // Blank / nameless / roleless focus announcements (the whole announcement is judged).
      const blank = narr.find((p) => BLANK_WORDS.test(norm(p)) && !contentWords(p).length);
      const anyContent = narr.some((p) => contentWords(p).length);
      if (blank != null && !anyContent && (focusMoved || !a.focus.isBody)) {
        hit('sr-blank-announcement', { node: elNode(`Announced as ${quote(blank)}. Announced: ${narrText(narr)}.`), evidence: { narration: narr, expected: 'A name and role, e.g. "Search button".' } });
      }
      if (focusMoved && a.focus.interactive && !step.includes('sr-blank-announcement')) {
        const nameMatch = a.focus.name ? match(narr, a.focus.name) : 'no';
        if (nameMatch === 'no' && ((narr.length && !anyContent) || (!narr.length && !a.focus.name))) {
          hit('sr-control-without-name', { node: elNode(`Announced: ${narrText(narr)}.`), evidence: { narration: narr, expected: `A name for the ${a.focus.roleWord ?? a.focus.tag} that says what it does.` } });
        }
        // Only elements that behave like widgets (click handler / pointer cursor) need a role:
        // a focusable paragraph or heading is a legitimate programmatic focus target.
        if (!a.focus.role && !a.focus.native && a.focus.widgetLike && !narr.some((p) => ROLE_RE.test(norm(p)))) {
          hit('sr-missing-role', { node: elNode(`<${a.focus.tag}> is focusable and clickable but has no role. Announced: ${narrText(narr)}.`), evidence: { narration: narr, expected: 'A role, e.g. "button" or "link".' } });
        }
      }

      // States: on focus, on change of the focused element, and disclosure without aria-expanded.
      if (!a.focus.isBody && a.focus.states) {
        const sameEl = b?.focus?.selector === a.focus.selector;
        for (const st of Object.keys(STATE_WORDS)) {
          const v = a.focus.states[st];
          if (v == null || (st === 'selected' && !v)) continue;
          const changed = sameEl && b.focus.states?.[st] !== v;
          if (!focusMoved && !changed) continue;
          const said = announcedState(narr, st);
          if (said === v) continue;
          const want = STATE_WORDS[st][v ? 0 : 1][0];
          const what = said === null ? `${quote(want)} was not announced` : `the opposite state was announced`;
          hit('sr-missing-state', { node: elNode(`${changed ? 'State changed to' : 'Focused with state'} ${st}=${v}, but ${what}. Announced: ${narrText(narr)}.`), evidence: { narration: narr, expected: quote(want) } });
          break;
        }
      }
      const acted = s.target?.selector ?? (s.action === 'press' ? b?.focus?.selector : null);
      for (const c of a.controls ?? []) {
        if (c.selector !== acted) continue;
        const prev = (b?.controls ?? []).find((x) => x.selector === c.selector);
        if (prev && prev.visible !== c.visible && prev.expanded === c.expanded) {
          const el = s.target?.selector === c.selector ? s.target : a.focus;
          hit('sr-missing-state', { node: { selector: c.selector, html: el?.html ?? '', summary: `The content it controls was ${c.visible ? 'shown' : 'hidden'}, but aria-expanded ${c.expanded == null ? 'is missing' : `stayed "${c.expanded}"`}. Announced: ${narrText(narr)}.`, screenshot: s.screenshot }, evidence: { narration: narr, expected: c.visible ? '"expanded"' : '"collapsed"' } });
        }
      }

      // Dialogs: announced, focus moved in (modal dialogs only), focus returned to the opener on close.
      const beforeD = new Map((b?.dialogs ?? []).map((d) => [d.key, d]));
      const afterD = new Map((a.dialogs ?? []).map((d) => [d.key, d]));
      if (b) {
        for (const [key, d] of afterD) {
          if (beforeD.has(key)) continue;
          openers.set(key, acted ?? b?.focus?.selector ?? null);
          const label = `${d.modal ? 'Modal dialog' : 'Dialog'}${d.name ? ` ${quote(d.name)}` : ''}`;
          const dn = { selector: key, html: '', summary: `${label} opened. Announced: ${narrText(narr)}.`, screenshot: s.screenshot };
          const nameMatch = d.name ? match(narr, d.name) : 'no';
          if (!hasWord(narr, 'dialog') && nameMatch !== 'yes') {
            hit('sr-dialog-not-announced', { ...(nameMatch === 'partial' ? { kind: 'review', confidence: 'dialog name partly matched' } : {}), node: dn, evidence: { narration: narr, expected: `"${d.name ? `${d.name} ` : ''}dialog"` } });
          }
          if (a.focus.dialog !== key) {
            hit('sr-focus-not-in-dialog', {
              ...(d.modal ? {} : { kind: 'review', confidence: 'non-modal dialog: moving focus is recommended, not required' }),
              node: { ...dn, summary: `${label} opened but focus stayed on ${a.focus.isBody ? 'the page body' : a.focus.selector}.` },
              evidence: { narration: narr, expected: 'Focus inside the dialog.' },
            });
          }
        }
      }
      for (const [key] of beforeD) {
        if (afterD.has(key) || !openers.has(key)) continue;
        const opener = openers.get(key);
        openers.delete(key);
        if (!opener || a.focus.selector === opener) continue;
        hit('sr-focus-not-returned', {
          kind: a.focus.isBody ? 'failure' : 'review',
          node: { selector: opener, html: '', summary: `Dialog closed; focus went to ${a.focus.isBody ? 'the page body' : a.focus.selector} instead of the opener ${opener}. Announced: ${narrText(narr)}.`, screenshot: s.screenshot },
          evidence: { narration: narr, expected: `Focus back on ${opener}.` },
        });
      }

      // Errors and status messages caused by this action (not those present on page load).
      if (b && !navigated) {
        const beforeE = new Map((b.errors ?? []).map((e) => [e.selector, e]));
        const errSel = new Set();
        for (const e of a.errors ?? []) {
          errSel.add(e.selector);
          const prev = beforeE.get(e.selector);
          if (prev && prev.text === e.text) continue;
          const m = e.text ? match(narr, e.text) : (hasWord(narr, 'invalid') ? 'yes' : 'no');
          if (m === 'yes') continue;
          // Heuristic candidates (an element whose class/id mentions "error") are not proof of an error message.
          const review = e.kind === 'text' || m === 'partial';
          hit('sr-error-not-announced', {
            ...(review ? { kind: 'review', confidence: m === 'partial' ? 'error text partly matched' : 'error candidate inferred from class/id' } : {}),
            node: { selector: e.selector, html: '', summary: `${e.kind === 'invalid' ? `Field${e.field ? ` ${quote(e.field)}` : ''} became invalid` : e.kind === 'alert' ? 'Alert appeared' : 'Possible error text appeared'}${e.text ? `: ${quote(e.text)}` : ''}. Announced: ${narrText(narr)}.`, screenshot: s.screenshot },
            evidence: { narration: narr, expected: e.text ? quote(e.text) : '"invalid entry"' },
          });
        }
        const beforeL = new Map((b.live ?? []).map((l) => [l.key, l]));
        for (const l of a.live ?? []) {
          if (!l.text || errSel.has(l.key)) continue;
          const prev = beforeL.get(l.key);
          if (prev && prev.text === l.text) continue;
          const m = match(narr, l.text);
          if (m === 'yes') continue;
          const late = !prev && l.role !== 'alert';
          hit('sr-status-not-announced', {
            ...(m === 'partial' ? { kind: 'review', confidence: 'status text partly matched' } : {}),
            node: { selector: l.key, html: '', summary: `${l.role ?? 'live region'} (${l.politeness}) ${prev ? 'changed to' : 'appeared with'} ${quote(l.text)}${late ? ' - the region was inserted together with its message, which screen readers usually ignore' : ''}. Announced: ${narrText(narr)}.`, screenshot: s.screenshot },
            evidence: { narration: narr, expected: quote(l.text) },
          });
        }
      }

      // Silence after navigation / an action.
      if (navigated && !narr.length) {
        hit('sr-silent-navigation', a.title
          ? { node: { selector: 'html', html: '', summary: `Moved to ${a.url} ("${a.title}") but nothing was announced.`, screenshot: s.screenshot }, evidence: { narration: narr, expected: `"${a.title}"` } }
          : { kind: 'failure', impact: 'serious', wcag: ['2.4.2'], node: { selector: 'title', html: '', summary: `Moved to ${a.url}, which has no <title>, and nothing was announced.`, screenshot: s.screenshot }, evidence: { narration: narr, expected: 'A page title.' } });
      } else if (s.trace?.actionable && !QUIET_ACTIONS.has(s.action) && !narr.length && !step.length) {
        hit('sr-silent-action', { node: { selector: s.target?.selector ?? a.focus.selector, html: s.target?.html ?? a.focus.html ?? '', summary: `${s.description}: nothing was announced.`, screenshot: s.screenshot }, evidence: { narration: narr, expected: 'Some announcement of the result.' } });
      }

      // Suggestions: duplicates, verbosity, symbols.
      const dupe = narr.find((p, i) => i > 0 && norm(p) && norm(p) === norm(narr[i - 1]));
      const rep = dupe ? null : narr.map(repeated).find(Boolean);
      if (dupe || rep) hit('sr-duplicate-announcement', { node: elNode(dupe ? `${quote(dupe)} was announced twice in a row.` : `${quote(rep)} is repeated within one announcement.`), evidence: { narration: narr, expected: 'Each piece of information once.' } });
      const long = narr.find((p) => stripHints(p).trim().length > MAX_PHRASE);
      if (long) hit('sr-verbose', { node: elNode(`${stripHints(long).trim().length} characters: ${quote(long)}`), evidence: { narration: narr, expected: `At most ${MAX_PHRASE} characters.` } });
      const sym = narr.find(symbolic) ?? (focusMoved && symbolic(a.focus.name) ? a.focus.name : null);
      if (sym) hit('sr-symbol-noise', { node: elNode(`Contains emoji/icon glyphs: ${quote(sym)}`), evidence: { narration: narr, expected: 'Decorative symbols hidden from assistive technology.' } });
    }
  }

  // An incomplete sweep (unsupported command, error, nothing spoken at all) proves nothing.
  const usable = (sw) => !!sw && !UNRELIABLE_PROBE.has(sw.termination) && !(sw.termination === 'silent' && !(sw.spoken ?? []).length);
  const isNav = (p) => (results.journeys ?? []).some((j) => (j.key ?? j.id) === p.journey && j.modality === 'sr-navigation');
  for (const p of results.probes ?? []) {
    if (p.error) continue;
    const target = p.id;
    const repro = (p.startPlan ?? []).map((st) => st.description ?? `${st.action} ${st.url ?? ''}`.trim());
    const shot = p.screenshot;
    if (usable(p.landmarks)) {
      const lmSpoken = (p.landmarks.spoken ?? []).map((x) => x.text);
      if (isNav(p) && !lmSpoken.length && (p.landmarks.dom ?? []).length) {
        add('srnav-no-semantic-nav', { target, repro, node: { selector: 'body', html: '', summary: `Landmark navigation announced nothing, but the page has ${p.landmarks.dom.length} landmark(s).`, screenshot: shot }, evidence: { narration: [], expected: 'The page landmarks.', termination: p.landmarks.termination } });
      }
      if (!lmSpoken.some((t) => hasWord([t], 'main')) && !(p.landmarks.dom ?? []).some((l) => l.role === 'main')) {
        add('sr-no-landmarks', { target, repro, node: { selector: 'body', html: '', summary: `Landmarks announced: ${lmSpoken.length ? lmSpoken.map(quote).join(', ') : 'none'}.`, screenshot: shot }, evidence: { narration: lmSpoken, expected: 'A "main landmark".', termination: p.landmarks.termination } });
      }
    }
    if (usable(p.headings)) {
      const hSpoken = (p.headings.spoken ?? []).map((x) => x.text);
      if (!hSpoken.length && !(p.headings.dom ?? []).length) {
        add('sr-no-headings', { target, repro, node: { selector: 'body', html: '', summary: 'Heading navigation found no headings.', screenshot: shot }, evidence: { narration: [], expected: 'At least one heading (h1).', termination: p.headings.termination } });
      }
    }
    if (!p.reading || UNRELIABLE_PROBE.has(p.reading.termination)) continue;
    const items = (p.reading.spoken ?? []).filter((x) => x.box && x.box.width > 0 && x.box.height > 0);
    let jumps = 0;
    for (let i = 1; i < items.length && jumps < 5; i++) {
      const prev = items[i - 1].box;
      const cur = items[i].box;
      const above = cur.y + cur.height <= prev.y;
      const overlap = cur.x < prev.x + prev.width && prev.x < cur.x + cur.width;
      if (above && overlap) {
        jumps++;
        add('sr-reading-order', { target, repro, node: { selector: items[i].selector ?? '', html: '', summary: `${quote(items[i].text)} is read after ${quote(items[i - 1].text)} but is displayed above it.`, screenshot: shot }, evidence: { narration: [items[i - 1].text, items[i].text], expected: 'Reading order follows the visual order.' } });
      }
    }
  }
  return out;
}

/** Counts by kind and impact, narrated/silent step totals, coverage and capture health. */
export function summarise(results, findings) {
  const journeys = results.journeys ?? [];
  const steps = journeys.flatMap((j) => j.steps ?? []);
  const byKind = { failure: 0, review: 0, suggestion: 0 };
  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const f of findings) {
    byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    if (f.kind === 'failure') byImpact[f.impact] = (byImpact[f.impact] ?? 0) + 1;
  }
  const said = (s) => phrasesOf([...(s.narration ?? []), ...(s.late ?? [])]).length > 0;
  const capture = {};
  for (const s of steps) {
    const h = s.capture?.health ?? 'unknown';
    capture[h] = (capture[h] ?? 0) + 1;
  }
  const probes = results.probes ?? [];
  const sweeps = probes.flatMap((p) => (p.error ? [{ termination: 'error' }] : [p.headings, p.landmarks, p.reading].filter(Boolean)));
  return {
    journeys: journeys.length,
    journeysComplete: journeys.filter((j) => j.status === 'complete').length,
    journeysBlocked: journeys.filter((j) => j.status === 'blocked').length,
    journeysPartial: journeys.filter((j) => j.status === 'partial').length,
    steps: steps.length,
    narrated: steps.filter((s) => s.ok && said(s)).length,
    silent: steps.filter((s) => s.ok && !said(s)).length,
    failedSteps: steps.filter((s) => !s.ok).length,
    capture,
    probesIncomplete: sweeps.filter((sw) => sw.termination !== 'end').length,
    findings: findings.length,
    byKind,
    byImpact,
  };
}
