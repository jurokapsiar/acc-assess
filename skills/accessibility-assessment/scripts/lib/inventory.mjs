// Inventory model: features -> screens (pages, dialogs, popovers, ...) -> states.
// Screens may have a parent screen (e.g. a dialog opened from a page) and states that
// require feature-level states (e.g. "theme.dark") to be applied first.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DEFAULT_INVENTORY = '.a11y/inventory.json';
export const SCREEN_TYPES = ['page', 'view', 'dialog', 'popover', 'menu', 'drawer', 'panel', 'toast', 'other'];
const STEP_ACTIONS = ['goto', 'click', 'dblclick', 'hover', 'focus', 'fill', 'type', 'press', 'check', 'uncheck', 'select', 'wait', 'waitFor', 'evaluate', 'emulate', 'localStorage', 'reload'];

export function loadInventory(file = DEFAULT_INVENTORY) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`Inventory not found: ${abs}. Create it first (see references/inventory.md).`);
  const inv = JSON.parse(fs.readFileSync(abs, 'utf8'));
  inv.__file = abs;
  return inv;
}

export function saveInventory(inv, file = inv.__file ?? DEFAULT_INVENTORY) {
  const { __file, ...data } = inv;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function allScreens(inv) {
  return inv.features.flatMap((f) => (f.screens ?? []).map((s) => ({ ...s, feature: f.id })));
}

export function screenById(inv, id) {
  return allScreens(inv).find((s) => s.id === id);
}

function featureState(inv, ref) {
  const [featureId, stateId] = ref.split('.');
  const feature = inv.features.find((f) => f.id === featureId);
  const state = feature?.states?.find((s) => s.id === stateId);
  return state ? { feature, state } : null;
}

export function validateInventory(inv) {
  const errors = [];
  const warnings = [];
  if (!inv.app?.baseUrl) errors.push('app.baseUrl is required');
  if (!Array.isArray(inv.features) || inv.features.length === 0) errors.push('features[] must not be empty');
  // Optional, backwards-compatible fields (source tracking lands in a later task; just type-check here).
  if (inv.app?.sourceRoot !== undefined && typeof inv.app.sourceRoot !== 'string') errors.push('app.sourceRoot must be a string');
  if (inv.app?.sourceAttrs !== undefined && !(Array.isArray(inv.app.sourceAttrs) && inv.app.sourceAttrs.every((a) => typeof a === 'string'))) errors.push('app.sourceAttrs must be an array of strings');
  const featureIds = new Set();
  const screenIds = new Set();
  for (const f of inv.features ?? []) {
    if (!f.id) errors.push(`feature without id: ${JSON.stringify(f.name)}`);
    if (featureIds.has(f.id)) errors.push(`duplicate feature id: ${f.id}`);
    featureIds.add(f.id);
    if (!f.screens?.length && !f.states?.length) warnings.push(`feature ${f.id} has no screens or states`);
    for (const fs_ of f.states ?? []) checkSteps(fs_.steps, `feature ${f.id} state ${fs_.id}`, errors);
    for (const s of f.screens ?? []) {
      if (!s.id) errors.push(`screen without id in feature ${f.id}`);
      if (screenIds.has(s.id)) errors.push(`duplicate screen id: ${s.id} (screen ids must be globally unique)`);
      screenIds.add(s.id);
      if (s.type && !SCREEN_TYPES.includes(s.type)) errors.push(`screen ${s.id}: unknown type ${s.type}`);
      if (s.cut !== undefined && typeof s.cut !== 'string') errors.push(`screen ${s.id}: cut must be a string selector (or "scope")`);
      if (!s.parent && !s.url && !(s.steps ?? []).some((st) => st.action === 'goto')) warnings.push(`screen ${s.id}: no url/parent; app.baseUrl will be used`);
      checkSteps(s.steps, `screen ${s.id}`, errors);
      const stateIds = new Set();
      for (const st of s.states ?? []) {
        if (!st.id) errors.push(`screen ${s.id}: state without id`);
        if (stateIds.has(st.id)) errors.push(`screen ${s.id}: duplicate state ${st.id}`);
        stateIds.add(st.id);
        checkSteps(st.steps, `screen ${s.id} state ${st.id}`, errors);
        for (const ref of st.requires ?? []) {
          if (!featureState(inv, ref)) errors.push(`screen ${s.id} state ${st.id}: unknown feature state "${ref}" (use "<featureId>.<stateId>")`);
        }
      }
    }
  }
  for (const s of allScreens(inv)) {
    if (s.parent && !screenIds.has(s.parent)) errors.push(`screen ${s.id}: unknown parent ${s.parent}`);
    const seen = new Set([s.id]);
    let p = s.parent;
    while (p) {
      if (seen.has(p)) { errors.push(`screen ${s.id}: parent cycle`); break; }
      seen.add(p);
      p = screenById(inv, p)?.parent;
    }
  }
  return { errors, warnings };
}

function checkSteps(steps, where, errors) {
  for (const [i, st] of (steps ?? []).entries()) {
    if (!STEP_ACTIONS.includes(st.action)) errors.push(`${where} step ${i + 1}: unknown action "${st.action}"`);
  }
}

const csv = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : null);

/**
 * Expand the inventory into assessment targets (screen x state x viewport).
 * Filters: features, screens, states, viewports (comma separated strings or arrays).
 *
 * `targets`: comma separated target keys (`<screen>__<state>__<viewport>`), e.g. from
 * `assess.mjs --target`. When given, every inventory viewport is considered (not just the
 * default first one) so a key naming a non-default viewport still resolves; `viewports`
 * still narrows that set when both are passed. Every requested key must match a resolved
 * target, or this throws (`err.code === 'UNKNOWN_TARGETS'`, `err.missing`) rather than
 * returning a partial list - callers must not run a partial assessment in that case.
 */
export function resolveTargets(inv, { features, screens, states, viewports, targets } = {}) {
  const fSel = Array.isArray(features) ? features : csv(features);
  const sSel = Array.isArray(screens) ? screens : csv(screens);
  const stSel = Array.isArray(states) ? states : csv(states);
  const tSel = Array.isArray(targets) ? targets : csv(targets);
  const vpAll = inv.viewports ?? { desktop: { width: 1280, height: 800 }, mobile: { width: 375, height: 812 } };
  const vpSel = (Array.isArray(viewports) ? viewports : csv(viewports)) ?? (tSel ? Object.keys(vpAll) : Object.keys(vpAll).slice(0, 1));
  const out = [];
  for (const screen of allScreens(inv)) {
    if (fSel && !fSel.includes(screen.feature)) continue;
    if (sSel && !sSel.includes(screen.id)) continue;
    const screenStates = [{ id: 'default', name: 'Default' }, ...(screen.states ?? [])];
    for (const state of screenStates) {
      if (stSel && !stSel.includes(state.id)) continue;
      for (const vp of vpSel) {
        if (!vpAll[vp]) throw new Error(`Unknown viewport "${vp}". Known: ${Object.keys(vpAll).join(', ')}`);
        out.push(buildTarget(inv, screen, state, vp, vpAll[vp]));
      }
    }
  }
  for (const id of stSel ?? []) {
    if (!out.some((t) => t.state.id === id)) console.warn(`Warning: no selected screen has a state "${id}". States are not inherited by child screens.`);
  }
  if (tSel) {
    const matched = out.filter((t) => tSel.includes(t.key));
    const missing = tSel.filter((k) => !matched.some((t) => t.key === k));
    if (missing.length) {
      const err = new Error(`Unknown or filtered-out --target keys: ${missing.join(', ')}`);
      err.code = 'UNKNOWN_TARGETS';
      err.missing = missing;
      throw err;
    }
    return matched;
  }
  return out;
}

const POLICY_FIELDS = ['rec', 'modalities', 'intent', 'keys', 'skipReason', 'journey', 'segment', 'modalitySkip'];
const stripPolicy = (plan) => plan.map((st) => Object.fromEntries(Object.entries(st).filter(([k]) => !POLICY_FIELDS.includes(k))));

/** Deterministic hash of what reaching and sizing a target means, independent of run results. */
export function planHash(t) {
  const payload = { plan: stripPolicy(t.plan), viewport: { width: t.viewport.width, height: t.viewport.height }, emulate: t.state.emulate ?? null, scope: t.screen.scope ?? null };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Hash of the execution policy (intent, modalities, keys, skips) the legacy planHash ignores. */
export function policyHash(t) {
  const policy = t.plan.map((st) => Object.fromEntries(POLICY_FIELDS.filter((k) => k !== 'rec' && st[k] !== undefined).map((k) => [k, st[k]])));
  return crypto.createHash('sha256').update(JSON.stringify(policy)).digest('hex');
}

/** `results.inventory`: a plain features -> screens tree for the Scope view (all screens, assessed or not). */
export function inventoryTree(inv) {
  return {
    features: (inv.features ?? []).map((f) => ({
      id: f.id,
      name: f.name ?? f.id,
      screens: (f.screens ?? []).map((s) => ({
        id: s.id,
        name: s.name ?? s.id,
        type: s.type ?? 'page',
        parent: s.parent ?? null,
        states: ['default', ...(s.states ?? []).map((st) => st.id)],
      })),
    })),
  };
}

function buildTarget(inv, screen, state, viewportName, viewport) {
  const chain = [];
  for (let s = screen; s; s = s.parent ? screenById(inv, s.parent) : null) chain.unshift(s);
  const root = chain[0];
  const url = new URL(root.url ?? '', inv.app.baseUrl).href;
  const plan = [{ action: 'goto', url }];
  if (state.requires?.length && root.ready && !root.steps?.length) plan.push({ action: 'waitFor', target: root.ready, origin: root.name ?? root.id });
  for (const ref of state.requires ?? []) {
    const { feature, state: fstate } = featureState(inv, ref);
    plan.push(...(fstate.steps ?? []).map((st) => ({ ...st, origin: `${feature.name ?? feature.id}: ${fstate.name ?? fstate.id}` })));
  }
  for (const s of chain) {
    if (s !== root && s.url) plan.push({ action: 'goto', url: new URL(s.url, inv.app.baseUrl).href });
    plan.push(...(s.steps ?? []).map((st) => ({ ...st, origin: s.name ?? s.id })));
    if (s.ready) plan.push({ action: 'waitFor', target: s.ready, origin: s.name ?? s.id });
  }
  plan.push(...(state.steps ?? []).map((st) => ({ ...st, origin: state.name ?? state.id })));
  const feature = inv.features.find((f) => f.id === screen.feature);
  return {
    key: [screen.id, state.id, viewportName].join('__'),
    feature: { id: feature.id, name: feature.name ?? feature.id },
    screen: {
      id: screen.id,
      name: screen.name ?? screen.id,
      type: screen.type ?? 'page',
      modal: screen.modal ?? null,
      scope: screen.scope ?? null,
      ready: screen.ready ?? null,
      patterns: screen.patterns ?? [],
      trigger: screen.trigger ?? null,
      source: screen.source ?? [],
      cut: screen.cut ?? 'scope',
    },
    state: { id: state.id, name: state.name ?? state.id, requires: state.requires ?? [], emulate: state.emulate ?? null },
    viewport: { name: viewportName, ...viewport },
    plan,
  };
}
