// Intent contract (§6.2). The agent - not a script - reads the prompt and writes `intent.json`.
// This module only provides the vocabulary and a schema check: it never interprets prose.
// Every claim in the intent must carry `evidence` (a verbatim prompt substring) or be declared
// as an explicit assumption, so a reviewer can tell what the user said from what the agent inferred.
export const MODALITY_IDS = ['keyboard', 'mouse', 'sr-keyboard', 'sr-navigation'];

export const DESTRUCTIVE_VERBS = [
  'submit', 'delete', 'remove', 'purchase', 'buy', 'pay', 'send', 'sign out', 'log out', 'logout',
  'unsubscribe', 'deactivate', 'destroy', 'erase', 'wipe', 'archive', 'publish', 'checkout', 'cancel',
];

export const DEFAULT_LIMITS = { maxTargets: 40, maxJourneySteps: 25, maxExploreActions: 60 };

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** An empty intent the agent fills in. `prompt` is copied from the session. */
export function intentTemplate(prompt) {
  return {
    prompt,
    include: [{ phrase: '', kind: 'any', quoted: false, evidence: '' }],
    exclude: [],
    states: [],
    viewports: [],
    modalities: [],
    excludedModalities: [],
    unsupportedModalities: [],
    actionPolicy: { requestedDestructive: [], allowEvaluate: false, allowStorage: false },
    limits: { ...DEFAULT_LIMITS },
  };
}

function checkEvidence(ev, label, prompt, errors) {
  if (ev && typeof ev === 'object' && typeof ev.assumption === 'string' && ev.assumption.trim()) return;
  if (typeof ev !== 'string' || !ev.trim()) {
    errors.push(`${label}: evidence is required (a verbatim substring of the prompt, or {"assumption": "..."})`);
    return;
  }
  if (!norm(prompt).includes(norm(ev))) errors.push(`${label}: evidence "${ev}" is not a substring of the prompt (use {"assumption": "..."} for inferred claims)`);
}

/** Schema-only validation of an agent-written intent.json. Returns `{ errors, intent, assumptions }`. */
export function validateIntent(doc, { prompt } = {}) {
  const errors = [];
  const d = doc && typeof doc === 'object' ? doc : {};
  if (typeof d.prompt !== 'string' || !d.prompt) errors.push('prompt must be a non-empty string');
  else if (prompt !== undefined && d.prompt !== prompt) errors.push('prompt must equal the session prompt verbatim');
  const text = prompt ?? d.prompt ?? '';
  const assumptions = [];
  const track = (ev, what) => { if (ev && typeof ev === 'object' && ev.assumption) assumptions.push(`${what}: ${ev.assumption}`); };

  const include = d.include ?? [];
  const exclude = d.exclude ?? [];
  if (!Array.isArray(include)) errors.push('include must be an array');
  if (!Array.isArray(exclude)) errors.push('exclude must be an array');
  (Array.isArray(include) ? include : []).forEach((e, i) => {
    if (!e || typeof e.phrase !== 'string' || !e.phrase.trim()) return errors.push(`include[${i}].phrase must be a non-empty string`);
    checkEvidence(e.evidence, `include[${i}]`, text, errors);
    track(e.evidence, `include "${e.phrase}"`);
  });
  (Array.isArray(exclude) ? exclude : []).forEach((e, i) => {
    if (!e || typeof e.phrase !== 'string' || !e.phrase.trim()) return errors.push(`exclude[${i}].phrase must be a non-empty string`);
    if (typeof e.reason !== 'string' || !e.reason.trim()) errors.push(`exclude[${i}].reason must be a non-empty string`);
    checkEvidence(e.evidence, `exclude[${i}]`, text, errors);
    track(e.evidence, `exclude "${e.phrase}"`);
  });

  const strList = (v, name) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) { errors.push(`${name} must be an array of non-empty strings`); return []; }
    return [...new Set(v.map((x) => x.trim()))];
  };
  const states = strList(d.states, 'states');
  const viewports = strList(d.viewports, 'viewports');
  const modalities = strList(d.modalities, 'modalities');
  const unsupportedModalities = strList(d.unsupportedModalities, 'unsupportedModalities');

  for (const m of modalities) if (!MODALITY_IDS.includes(m)) errors.push(`unknown modality "${m}" (expected one of ${MODALITY_IDS.join(', ')})`);

  const excludedRaw = d.excludedModalities ?? [];
  const excludedModalities = [];
  if (!Array.isArray(excludedRaw)) errors.push('excludedModalities must be an array of {modality, evidence}');
  else excludedRaw.forEach((e, i) => {
    const id = e?.modality;
    if (!MODALITY_IDS.includes(id)) return errors.push(`excludedModalities[${i}].modality must be one of ${MODALITY_IDS.join(', ')}`);
    checkEvidence(e.evidence, `excludedModalities[${i}]`, text, errors);
    track(e.evidence, `excluded modality ${id}`);
    if (modalities.includes(id)) errors.push(`modality "${id}" is both requested and excluded`);
    excludedModalities.push({ modality: id, evidence: e.evidence });
  });

  const policy = d.actionPolicy ?? {};
  const requestedRaw = policy.requestedDestructive ?? [];
  const requestedDestructive = [];
  if (!Array.isArray(requestedRaw)) errors.push('actionPolicy.requestedDestructive must be an array of {verb, evidence}');
  else requestedRaw.forEach((e, i) => {
    const verb = typeof e === 'string' ? e : e?.verb;
    if (!DESTRUCTIVE_VERBS.includes(verb)) return errors.push(`actionPolicy.requestedDestructive[${i}].verb must be one of ${DESTRUCTIVE_VERBS.join(', ')}`);
    if (typeof e === 'string') return errors.push(`actionPolicy.requestedDestructive[${i}] needs evidence: {"verb":"${verb}","evidence":"..."}`);
    checkEvidence(e.evidence, `actionPolicy.requestedDestructive[${i}]`, text, errors);
    track(e.evidence, `destructive ${verb}`);
    requestedDestructive.push(verb);
  });
  for (const k of ['allowEvaluate', 'allowStorage']) {
    if (policy[k] === true) {
      checkEvidence(policy[`${k}Evidence`], `actionPolicy.${k}`, text, errors);
      track(policy[`${k}Evidence`], k);
    }
  }
  const forbid = DESTRUCTIVE_VERBS.filter((v) => !requestedDestructive.includes(v));

  const limits = { ...DEFAULT_LIMITS, ...(d.limits ?? {}) };
  for (const k of Object.keys(DEFAULT_LIMITS)) {
    if (typeof limits[k] !== 'number' || !(limits[k] > 0)) errors.push(`limits.${k} must be a positive number`);
  }

  const incl = Array.isArray(include) ? include : [];
  return {
    errors,
    assumptions,
    intent: {
      ...d,
      include: incl,
      exclude: Array.isArray(exclude) ? exclude : [],
      quotedStrings: incl.filter((e) => e?.quoted).map((e) => e.phrase),
      states,
      viewports,
      modalities,
      excludedModalities,
      unsupportedModalities,
      actionPolicy: {
        forbid,
        allowEvaluate: policy.allowEvaluate === true,
        allowStorage: policy.allowStorage === true,
        requestedDestructive,
        ...(policy.allowEvaluateEvidence ? { allowEvaluateEvidence: policy.allowEvaluateEvidence } : {}),
        ...(policy.allowStorageEvidence ? { allowStorageEvidence: policy.allowStorageEvidence } : {}),
      },
      limits,
      assumptions,
    },
  };
}
