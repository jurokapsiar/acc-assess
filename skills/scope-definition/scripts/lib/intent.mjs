// Deterministic prompt parsing (§6.2): no LLM call. Produces a baseline `intent.json`; the
// agent may hand-edit it for genuine semantic matching ("the invite dialog" -> which screen),
// then re-validates it with `normalizeIntent`/`parseIntent --from` (see scripts/scope.mjs).
const STATE_SYNONYMS = [
  [/\bdark\s*(mode|theme)?\b/i, 'dark'],
  [/\blight\s*(mode|theme)?\b/i, 'light'],
  [/\b(rtl|right[- ]to[- ]left|arabic|hebrew)\b/i, 'rtl'],
  [/\b(ltr|left[- ]to[- ]right)\b/i, 'ltr'],
  [/\bvalidation\s*error\b/i, 'validation-error'],
  [/\b(invalid|error)\b/i, 'validation-error'],
  [/\b(empty|no\s*data)\b/i, 'empty'],
  [/\b(high\s*contrast|forced\s*colors?)\b/i, 'forced-colors'],
  [/\breduced\s*motion\b/i, 'reduced-motion'],
  [/\bloading\b/i, 'loading'],
  [/\bdisabled\b/i, 'disabled'],
];

const VIEWPORT_WORDS = [
  [/\b(mobile|phone|narrow)\b/i, 'mobile'],
  [/\b(desktop|wide)\b/i, 'desktop'],
  [/\b(tablet)\b/i, 'tablet'],
  [/\ball\s+viewports\b|\bevery\s+viewport\b/i, 'all'],
];

export const MODALITY_IDS = ['keyboard', 'mouse', 'sr-keyboard', 'sr-navigation'];
// Order matters: the "without a mouse" family is a keyboard request and is removed from the text
// before the mouse words are tested. Touch is not an automated modality: it is disclosed, never mapped.
const KEYBOARD_ONLY_RE = /\b(without\s+(?:a\s+|the\s+|using\s+(?:a\s+)?)?mouse|no\s+mouse)\b/i;
const MODALITY_WORDS = [
  [/\ball\s+(?:input|modalities)\b/i, 'all'],
  [/\b(?:quick\s*nav(?:igation)?|headings?\s+nav(?:igation)?|rotor|elements?\s+list|browse\s+mode)\b/i, 'sr-navigation'],
  [/\b(?:screen\s*readers?|nvda|voiceover)\b/i, 'sr-keyboard'],
  [/\bkeyboard(?:\s+only)?\b/i, 'keyboard'],
  [/\b(?:mouse|pointer|click(?:ing)?)\b/i, 'mouse'],
];
const UNSUPPORTED_RE = /\b(touch(?:\s*screen)?|swipe|stylus)\b/i;

function modalitiesIn(text) {
  const found = new Set();
  let rest = text;
  if (KEYBOARD_ONLY_RE.test(rest)) {
    found.add('keyboard');
    rest = rest.replace(KEYBOARD_ONLY_RE, ' ');
  }
  for (const [re, id] of MODALITY_WORDS) {
    if (!re.test(rest)) continue;
    if (id === 'all') MODALITY_IDS.forEach((m) => found.add(m));
    else found.add(id);
  }
  return { found, unsupported: UNSUPPORTED_RE.test(rest) ? rest.match(UNSUPPORTED_RE)[1].toLowerCase() : null };
}

const NEGATION_CUES =  /\b(not|without|exclude|except|don't|dont|skip)\b/i;
const LEADING_NEGATION = /^(don't|dont|do\s+not|not|without|exclude|except|skip)\b[\s,]*/i;

export const DESTRUCTIVE_VERBS = [
  'submit', 'delete', 'remove', 'purchase', 'buy', 'pay', 'send', 'sign out', 'log out', 'logout',
  'unsubscribe', 'deactivate', 'destroy', 'erase', 'wipe', 'archive', 'publish', 'checkout', 'cancel',
];

const SCREEN_WORDS = /\b(dialogs?|modals?|popovers?|menus?|drawers?|pages?|screens?|views?|panels?|toasts?)\b/i;
const FLOW_WORDS = /\b(flows?|journeys?|wizards?|steps?)\b/i;
const STATE_WORDS = /\b(states?)\b/i;
const FEATURE_WORDS = /\b(features?|sections?)\b/i;

const DEFAULT_LIMITS = { maxTargets: 40, maxJourneySteps: 25, maxExploreActions: 60 };

function kindOf(phrase) {
  if (SCREEN_WORDS.test(phrase)) return 'screen';
  if (FLOW_WORDS.test(phrase)) return 'flow';
  if (STATE_WORDS.test(phrase)) return 'state';
  if (FEATURE_WORDS.test(phrase)) return 'feature';
  return 'any';
}

function extractQuoted(text) {
  const quoted = [];
  const re = /"([^"]+)"|'([^']+)'|\u201c([^\u201d]+)\u201d/g;
  let m;
  let i = 0;
  let working = '';
  let last = 0;
  while ((m = re.exec(text))) {
    const value = m[1] ?? m[2] ?? m[3];
    quoted.push(value);
    working += text.slice(last, m.index) + `\u0000Q${i}\u0000`;
    last = re.lastIndex;
    i++;
  }
  working += text.slice(last);
  return { quoted, working };
}

function restoreQuoted(text, quoted) {
  return text.replace(/\u0000Q(\d+)\u0000/g, (_, n) => `"${quoted[Number(n)]}"`);
}

function splitClauses(text) {
  return text
    .split(/[;,]|\band\b|\bbut\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Pure, deterministic prompt -> intent.json baseline (§6.2). No LLM call. */
export function parseIntent(prompt, opts = {}) {
  const { quoted, working } = extractQuoted(prompt);
  const clauses = splitClauses(working);

  const include = [];
  const exclude = [];
  const states = new Set();
  const viewports = new Set();
  const requestedDestructive = new Set();
  const modalities = new Set();
  const negatedModalities = new Set();
  const unsupportedModalities = new Set();

  for (const rawClause of clauses) {
    const isNegated = LEADING_NEGATION.test(rawClause) || (NEGATION_CUES.test(rawClause) && /^(but\s+)?(not|without|except|skip)\b/i.test(rawClause));
    const stripped = rawClause.replace(LEADING_NEGATION, '').trim();
    const { found: modsHere, unsupported } = modalitiesIn(rawClause);
    if (unsupported) unsupportedModalities.add(unsupported);
    const keyboardOnly = KEYBOARD_ONLY_RE.test(rawClause);
    const modifiesOnly = (modsHere.size > 0 || unsupported) && rawClause.trim().split(/\s+/).length <= 5
      && !SCREEN_WORDS.test(rawClause) && !FLOW_WORDS.test(rawClause) && !FEATURE_WORDS.test(rawClause);
    if (modsHere.size) {
      for (const m of modsHere) {
        if (isNegated && !keyboardOnly) negatedModalities.add(m);
        else modalities.add(m);
      }
    }
    const clauseText = restoreQuoted(isNegated ? stripped : rawClause, quoted).trim();
    if (!clauseText) continue;

    if (modifiesOnly) continue;
    if (isNegated) {
      exclude.push({ phrase: clauseText, reason: `prompt: "${restoreQuoted(rawClause, quoted).trim()}"` });
      continue;
    }

    for (const [re, id] of STATE_SYNONYMS) if (re.test(clauseText)) states.add(id);
    for (const [re, id] of VIEWPORT_WORDS) if (re.test(clauseText)) viewports.add(id);
    for (const verb of DESTRUCTIVE_VERBS) {
      const re = new RegExp(`\\b${verb.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (re.test(clauseText)) requestedDestructive.add(verb);
    }

    // A clause that's *only* a recognized viewport/state word (e.g. "mobile") isn't a thing to
    // find - it's a restriction on every found thing, so it never becomes an `include` phrase.
    const isPureModifier = (VIEWPORT_WORDS.some(([re]) => re.test(clauseText)) || STATE_SYNONYMS.some(([re]) => re.test(clauseText)))
      && clauseText.split(/\s+/).length <= 3
      && !SCREEN_WORDS.test(clauseText) && !FLOW_WORDS.test(clauseText) && !FEATURE_WORDS.test(clauseText);
    if (isPureModifier) continue;

    const quotedExact = quoted.find((q) => clauseText === q || clauseText === `"${q}"`);
    include.push({ phrase: clauseText.replace(/^"|"$/g, ''), kind: kindOf(clauseText), quoted: !!quotedExact });
  }

  const forbid = DESTRUCTIVE_VERBS.filter((v) => !requestedDestructive.has(v));
  const finalModalities = MODALITY_IDS.filter((m) => modalities.has(m) && !negatedModalities.has(m));

  return {
    prompt,
    include,
    quotedStrings: quoted,
    states: [...states],
    viewports: [...viewports],
    modalities: finalModalities,
    unsupportedModalities: [...unsupportedModalities],
    exclude,
    actionPolicy: { forbid, allowEvaluate: false, allowStorage: false, requestedDestructive: [...requestedDestructive] },
    changedFiles: opts.changedFiles ?? [],
    limits: { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) },
  };
}

/** Re-validates a (possibly hand-edited) intent.json: shape/type checks, re-normalizes
 * `states`/`viewports` through the synonym tables (so a typo doesn't silently pass through),
 * clamps `limits` to sane bounds. Used by `scope.mjs intent --from <edited.json>`. */
export function normalizeIntent(doc) {
  const errors = [];
  if (typeof doc.prompt !== 'string' || !doc.prompt) errors.push('prompt must be a non-empty string');
  if (!Array.isArray(doc.include)) errors.push('include must be an array');
  if (!Array.isArray(doc.exclude)) errors.push('exclude must be an array');
  const knownStates = new Set(STATE_SYNONYMS.map(([, id]) => id));
  const knownViewports = new Set([...VIEWPORT_WORDS.map(([, id]) => id), 'all']);
  const states = [...new Set((doc.states ?? []).map(String))];
  const viewports = [...new Set((doc.viewports ?? []).map(String))];
  for (const s of states) if (!knownStates.has(s)) errors.push(`unknown state synonym "${s}" (not in the state synonym table; use the literal inventory state id if intentional)`);
  for (const v of viewports) if (!knownViewports.has(v)) errors.push(`unknown viewport word "${v}"`);
  const modalities = [...new Set((doc.modalities ?? []).map(String))];
  for (const m of modalities) if (!MODALITY_IDS.includes(m)) errors.push(`unknown modality "${m}" (expected one of ${MODALITY_IDS.join(', ')})`);
  const forbid = [...new Set(doc.actionPolicy?.forbid ?? DESTRUCTIVE_VERBS)];
  const limits = { ...DEFAULT_LIMITS, ...(doc.limits ?? {}) };
  for (const k of Object.keys(DEFAULT_LIMITS)) {
    if (typeof limits[k] !== 'number' || limits[k] <= 0) errors.push(`limits.${k} must be a positive number`);
  }
  return {
    errors,
    intent: {
      ...doc,
      states,
      viewports,
      modalities,
      actionPolicy: { allowEvaluate: false, allowStorage: false, ...doc.actionPolicy, forbid },
      limits,
    },
  };
}
