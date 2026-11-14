// Step/checkpoint drafting (§6.5), the in-memory journey builder that `scope.mjs step` mutates
// and `scope.mjs propose` compiles. Pure except for `applyDraftOverlay`, which borrows the
// sibling's `compileJourneys` (still no fs/browser access here).
import crypto from 'node:crypto';
import { loadScopeLib } from './deps.mjs';

export const CONFIDENCE_ORDER = ['verified', 'snapshot', 'source', 'inventory', 'css', 'hint', 'inferred'];
const SENSITIVE_RE = /pass|secret|token|otp|pin|card|cvv|ssn|iban/i;
const STEP_ACTIONS = ['goto', 'click', 'dblclick', 'hover', 'focus', 'fill', 'type', 'press', 'check', 'uncheck', 'select', 'wait', 'waitFor', 'evaluate', 'emulate', 'localStorage', 'reload'];

function targetDescriptor(t) {
  if (!t) return '';
  return String(t.name ?? t.text ?? t.label ?? t.placeholder ?? t.key ?? '');
}

function parseEvidence(raw) {
  // "snapshot:3#e41 | source:src/x.tsx:88 | inventory:team-members"
  return String(raw ?? '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [kind, rest] = part.split(/:(.+)/s).map((x) => x?.trim());
      if (kind === 'snapshot') {
        const m = rest?.match(/^(.+?)#(.+)$/);
        return { snapshot: m ? `work/snapshots/${m[1]}.yml` : `work/snapshots/${rest}.yml`, ref: m?.[2] };
      }
      if (kind === 'source') {
        const m = rest?.match(/^(.+?):(\d+)$/);
        return { source: { file: m?.[1] ?? rest, line: m ? Number(m[2]) : undefined, via: 'grep' } };
      }
      if (kind === 'inventory') return { inventory: rest };
      return { raw: part };
    });
}

function confidenceFromEvidence(evidence, target) {
  if (target?.selector) return 'css';
  if (evidence.some((e) => e.snapshot)) return 'snapshot';
  if (evidence.some((e) => e.source)) return 'source';
  if (evidence.some((e) => e.inventory)) return 'inventory';
  return 'hint';
}

/**
 * Validates one `step` invocation against §6.5/§12's safety rules. Throws with a descriptive
 * message on the first violation; returns the built step (with `rec`) on success.
 */
export const STEP_INTENTS = ['reach', 'activate', 'enter-text', 'choose', 'toggle', 'dismiss', 'open', 'read', 'reveal', 'setup'];
const MODALITY_IDS = ['keyboard', 'mouse', 'sr-keyboard', 'sr-navigation'];
const KEY_RE = /^(?:(?:Control|Shift|Alt|Meta)\+)*(?:[A-Za-z0-9]|F\d{1,2}|Arrow(?:Up|Down|Left|Right)|Tab|Enter|Space|Escape|Home|End|PageUp|PageDown|Backspace|Delete|Insert|[!-~])$/;

/** Validates the modality fields of a step (§9 of the modalities spec). Returns the fields to merge. */
export function modalityFields({ action, intent, keys, modalities, modalitySkip, skipReason, reason, keyboardJourney }) {
  const out = {};
  if (intent !== undefined) {
    if (!STEP_INTENTS.includes(intent)) throw new Error(`Unknown --intent "${intent}" (expected ${STEP_INTENTS.join(', ')})`);
    out.intent = intent;
  }
  if (keys !== undefined) {
    const list = Array.isArray(keys) ? keys : String(keys).split(',').map((k) => k.trim()).filter(Boolean);
    if (!list.length) throw new Error('--keys needs at least one key, e.g. "Tab,Tab,Enter"');
    const bad = list.filter((k) => !KEY_RE.test(k));
    if (bad.length) throw new Error(`Invalid key(s) in --keys: ${bad.join(', ')} (use Playwright key names, e.g. Tab, Shift+Tab, ArrowDown, Enter, Space)`);
    out.keys = list;
  }
  if (modalities !== undefined) {
    const list = Array.isArray(modalities) ? modalities : String(modalities).split(',').map((m) => m.trim()).filter(Boolean);
    const bad = list.filter((m) => !MODALITY_IDS.includes(m));
    if (bad.length) throw new Error(`Unknown modality ${bad.join(', ')} (expected ${MODALITY_IDS.join(', ')})`);
    out.modalities = list;
  }
  if (modalitySkip !== undefined) {
    if (!MODALITY_IDS.includes(modalitySkip)) throw new Error(`Unknown modality "${modalitySkip}" for --modality-skip`);
    if (!skipReason) throw new Error('--modality-skip requires --reason (it is reported as a review item for a person to judge)');
    out.modalitySkip = { [modalitySkip]: skipReason };
  }
  if (keyboardJourney && (action === 'focus' || action === 'evaluate') && !reason) {
    throw new Error(`A "${action}" step in a keyboard/screen-reader journey is a programmatic intervention and will be reported as a failure; pass --reason to record why it is needed (e.g. test fixture setup).`);
  }
  return out;
}

export function buildStep({ action, target, value, key, evidenceRaw, nthReason, selectorReason, policy, modality }) {
  if (!STEP_ACTIONS.includes(action)) throw new Error(`Unknown action "${action}"`);
  const evidence = parseEvidence(evidenceRaw);
  if (!evidence.length) throw new Error('Every step needs --evidence (snapshot:n#ref | source:file:line | inventory:ref)');
  if (target?.nth !== undefined && !nthReason) throw new Error('Positional (--nth) targets require --reason');
  if (target?.selector && !selectorReason) throw new Error('CSS --selector targets require --reason (marked confidence: "css")');

  const forbid = (policy?.forbid ?? []).map((v) => String(v).toLowerCase());
  const descriptor = targetDescriptor(target).toLowerCase();
  const actionWord = action.toLowerCase();
  if (forbid.some((f) => descriptor.includes(f) || actionWord.includes(f))) {
    throw new Error(`Step target/action matches a forbidden verb; this session's intent policy forbids destructive actions here.`);
  }

  const fieldText = `${target?.label ?? ''} ${target?.name ?? ''} ${target?.testId ?? ''} ${key ?? ''}`;
  if (SENSITIVE_RE.test(fieldText) || (value !== undefined && SENSITIVE_RE.test(String(key ?? '')))) {
    throw new Error(`Refusing to record a step targeting a sensitive field ("${fieldText.trim()}"); secrets/credentials are never stored in journeys (§12). Use --storage-state auth instead.`);
  }

  const confidence = confidenceFromEvidence(evidence, target);
  const step = { action, ...(target ? { target } : {}), ...(value !== undefined ? { value } : {}), ...(key !== undefined ? { key } : {}) };
  if (modality) Object.assign(step, modalityFields({ action, ...modality }));
  step.rec = { producer: 'text', confidence, evidence, ...(nthReason ? { reason: nthReason } : {}), ...(selectorReason ? { reason: selectorReason } : {}) };
  return step;
}

/** Appends a step to the current (last) segment of `journeyId`'s last-open journey; creates the
 * journey/segment if this is its first step. Mutates `draft` in place; caller persists the
 * session. */
export function addStep(draft, { journeyId, journeyTitle, feature, start, step }) {
  draft.journeys = draft.journeys ?? [];
  let journey = draft.journeys.find((j) => j.id === journeyId);
  if (!journey) {
    journey = { id: journeyId, title: journeyTitle ?? journeyId, producer: 'text', producerVersion: 1, feature, start, segments: [], viewports: [] };
    draft.journeys.push(journey);
  }
  if (!journey.segments.length) throw new Error(`Journey "${journeyId}" has no open segment; call "checkpoint" first (screen/state) before "step".`);
  journey.segments.at(-1).steps.push(step);
  return journey;
}

/** Opens a new segment (screen or state checkpoint) on a journey, creating the journey if
 * needed. A `screen` checkpoint with a plain id string re-visits an existing screen (no new
 * entity); with an object it introduces a new screen. */
export function addCheckpoint(draft, { journeyId, journeyTitle, feature, start, kind, screen, state, parent }) {
  draft.journeys = draft.journeys ?? [];
  let journey = draft.journeys.find((j) => j.id === journeyId);
  if (!journey) {
    journey = { id: journeyId, title: journeyTitle ?? journeyId, producer: 'text', producerVersion: 1, feature, start, segments: [], viewports: [] };
    draft.journeys.push(journey);
  }
  if (kind === 'screen') {
    const screenDef = typeof screen === 'string' ? screen : { ...screen, ...(parent ? { parent } : {}) };
    journey.segments.push({ kind: 'screen', screen: screenDef, steps: [] });
  } else if (kind === 'state') {
    journey.segments.push({ kind: 'state', screen: typeof screen === 'string' ? screen : screen.id, state, steps: [] });
  } else {
    throw new Error(`Unknown checkpoint kind "${kind}" (expected "screen" or "state")`);
  }
  return journey;
}

/** In-memory overlay for `explore`: lets probes navigate to screens/states the draft has
 * introduced but not yet proposed. Additive-only, last-write-wins on conflicting fields (this
 * is a convenience overlay for exploration, not the authoritative merge - that's
 * `compileJourneys`/`applyScope`, used unmodified at `propose`/`verify` time). */
export async function applyDraftOverlay(inv, draft) {
  if (!draft?.journeys?.length) return inv;
  const { compileJourneys } = await loadScopeLib();
  const overlay = compileJourneys({ journeys: draft.journeys });
  const merged = structuredClone(inv);
  for (const of_ of overlay.features) {
    let existing = merged.features.find((f) => f.id === of_.id);
    if (!existing) {
      existing = { id: of_.id, name: of_.name ?? of_.id, screens: [] };
      merged.features.push(existing);
    }
    existing.screens = existing.screens ?? [];
    for (const os of of_.screens) {
      let es = existing.screens.find((s) => s.id === os.id);
      if (!es) {
        existing.screens.push(structuredClone(os));
        continue;
      }
      const { states: incomingStates, ...rest } = os;
      Object.assign(es, rest);
      if (incomingStates) {
        es.states = es.states ?? [];
        for (const st of incomingStates) {
          const idx = es.states.findIndex((s2) => s2.id === st.id);
          if (idx === -1) es.states.push(st);
          else es.states[idx] = st;
        }
      }
    }
  }
  return merged;
}

export function journeysDocFromDraft(draft) {
  return { schemaVersion: 1, journeys: draft.journeys ?? [] };
}

function worstConfidence(steps) {
  let worst = -1;
  for (const st of steps ?? []) {
    const idx = CONFIDENCE_ORDER.indexOf(st.rec?.confidence ?? 'inferred');
    worst = Math.max(worst, idx < 0 ? CONFIDENCE_ORDER.length - 1 : idx);
  }
  return worst < 0 ? null : CONFIDENCE_ORDER[worst];
}

/** Renders `proposal.md` (§6.5): plain-language intent echo, target matrix, numbered steps per
 * journey with confidence badges, excluded/unresolved items, and warnings. */
export function renderProposal({ intent, targets, journeysDoc, excluded = [], unresolved = [], describeStep, modalities = [], unsupportedModalities = [] }) {
  const lines = [];
  lines.push(`# Scope proposal`, '', `**Intent:** ${intent}`, '');
  lines.push(`**Modalities:** ${modalities.length ? modalities.join(', ') : 'unspecified (current behaviour)'}`, '');
  lines.push('## Targets', '');
  lines.push('| Target | Confidence |', '|---|---|');
  for (const t of targets) lines.push(`| ${t.key} | ${t.confidence ?? '-'} |`);
  lines.push('');
  lines.push('## Journeys', '');
  const warnings = [];
  for (const j of journeysDoc.journeys ?? []) {
    lines.push(`### ${j.title} (\`${j.id}\`)`, '');
    lines.push(`Modalities: ${(j.modalities?.length ? j.modalities : modalities).join(', ') || 'unspecified'}`, '');
    let n = 1;
    for (const seg of j.segments ?? []) {
      const segName = seg.kind === 'screen' ? (typeof seg.screen === 'string' ? seg.screen : seg.screen.id) : `${typeof seg.screen === 'string' ? seg.screen : seg.screen.id}.${seg.state?.id}`;
      lines.push(`- **${seg.kind}:** \`${segName}\``);
      for (const st of seg.steps ?? []) {
        const badge = st.rec?.confidence ?? 'inferred';
        const mods = [st.intent ? `intent: ${st.intent}` : null, st.keys ? `keys: ${st.keys.join(' ')}` : null, st.modalities ? `modalities: ${st.modalities.join('/')}` : null, st.modalitySkip ? `skip: ${Object.entries(st.modalitySkip).map(([m, r]) => `${m} (${r})`).join('; ')}` : null].filter(Boolean);
        lines.push(`  ${n}. ${describeStep(st)} _(${badge})_${mods.length ? `  [${mods.join(' · ')}]` : ''}`);
        n++;
        if (badge === 'css') warnings.push(`CSS locator used for step ${n - 1} of "${j.id}" (reason: ${st.rec?.reason ?? 'n/a'})`);
        if (st.target?.nth !== undefined) warnings.push(`Positional (nth) locator used for step ${n - 1} of "${j.id}" (reason: ${st.rec?.reason ?? 'n/a'})`);
        if (typeof st.value === 'string' && /\d{3,}|@|\d{4}-\d{2}-\d{2}/.test(st.value)) warnings.push(`Value "${st.value}" in "${j.id}" looks data-bound; consider a "/regex/" matcher instead of a literal in assertions that depend on it.`);
      }
    }
    lines.push('');
  }
  if (excluded.length) {
    lines.push('## Excluded', '');
    for (const e of excluded) lines.push(`- \`${e.ref}\`: ${e.reason}`);
    lines.push('');
  }
  if (unresolved.length) {
    lines.push('## Unresolved', '');
    for (const u of unresolved) lines.push(`- "${u.phrase}": ${u.status}${u.candidates ? ` (candidates: ${u.candidates.join(', ')})` : ''}`);
    lines.push('');
  }
  for (const u of unsupportedModalities) warnings.push(`The request mentions ${u}; it is not an automated modality and is not covered. Verify it manually.`);
  if (warnings.length) {
    lines.push('## Warnings', '');
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push('');
  }
  lines.push('---', '', 'Review the above, then run `scope.mjs confirm --session <id> --approved-by <you>` to approve, or re-run `step`/`ground` to adjust.');
  return lines.join('\n') + '\n';
}

export function proposalSha256(markdown) {
  return crypto.createHash('sha256').update(markdown).digest('hex');
}
