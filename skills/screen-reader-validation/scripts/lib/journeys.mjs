// Builds continuous replay plans from scope-definition outputs (scope.json + journeys.json)
// using the sibling skill's inventory model: the journey's start is resolved exactly like an
// assessment target (goto + parent chain + ready), then every segment's own steps are appended
// in order, so one browser page walks the whole journey the way a user would.
import fs from 'node:fs';
import path from 'node:path';
import { importSiblingLib } from './deps.mjs';

const stripRec = (steps = []) => steps.map(({ rec, ...st }) => st);

function firstExisting(...files) {
  return files.find((f) => f && fs.existsSync(f)) ?? files.find(Boolean);
}

/**
 * Loads scope + inventory (overlaid with journeys) and returns everything the runner needs.
 * A scope `storageState` that doesn't exist is a usage error unless `storageOverride` is set.
 */
export async function loadContext({ scopeFile, appRoot, storageOverride = null }) {
  const { loadScope, loadJourneysFor, applyScope } = await importSiblingLib('scope.mjs');
  const { loadInventory } = await importSiblingLib('inventory.mjs');
  const scope = loadScope(scopeFile);
  const scopeDir = path.dirname(scope.__file);
  const root = path.resolve(appRoot ?? process.cwd());
  const invFile = firstExisting(path.resolve(root, scope.inventory ?? '.a11y/inventory.json'), path.resolve(scopeDir, scope.inventory ?? '.a11y/inventory.json'));
  const inv = loadInventory(invFile);
  let journeysDoc = { journeys: [] };
  let journeysFile = null;
  try {
    const j = loadJourneysFor(scope);
    journeysDoc = j.doc;
    journeysFile = j.file;
  } catch (err) {
    if (scope.journeys) throw err;
  }
  const { inv: merged, conflicts } = journeysFile ? applyScope(inv, scope) : { inv, conflicts: [] };
  let storageState = null;
  if (scope.storageState && !storageOverride) {
    storageState = firstExisting(path.resolve(root, scope.storageState), path.resolve(scopeDir, scope.storageState));
    // Never silently fall back to the anonymous experience when the scope asks for a signed-in one.
    if (!fs.existsSync(storageState)) {
      throw Object.assign(new Error(`The scope's storageState file was not found: ${scope.storageState} (looked in ${root} and ${scopeDir}). Create it (sign in with a test account) or pass --storage-state <file>.`), { usage: true });
    }
  }
  return { scope, inv: merged, conflicts, journeysDoc, journeysFile, invFile, storageState, appRoot: root };
}

function viewportOf(inv, name) {
  const all = inv.viewports ?? { desktop: { width: 1280, height: 800 }, mobile: { width: 375, height: 812 } };
  const key = name && all[name] ? name : Object.keys(all)[0];
  if (name && !all[name]) throw new Error(`Unknown viewport "${name}". Known: ${Object.keys(all).join(', ')}`);
  return { name: key, ...all[key] };
}

const segmentOrigin = (seg, screens) => {
  const sid = typeof seg.screen === 'string' ? seg.screen : seg.screen?.id;
  const sName = (typeof seg.screen === 'object' && seg.screen?.name) || screens.get(sid)?.name || sid;
  return seg.kind === 'state' ? `${sName} › ${seg.state?.name ?? seg.state?.id}` : sName;
};

/**
 * Returns `[{ id, key, title, feature, viewport, notes, blocked, startPlan, plan }]`. `startPlan`
 * is the prefix that reaches the start screen (re-used for probes); `plan` is the whole journey.
 * `key` is `id@viewport` when a journey declares several viewports. `blocked` is a reason when
 * the journey can't be replayed as scoped (it is then reported, not run).
 * `filter`: journey ids (array) or null. `viewportName` overrides journey/inventory viewports.
 */
export const SR_MODALITIES = ['sr-keyboard', 'sr-navigation'];

/** CLI value -> list of requested modalities, or null (each journey's own declaration; none = `unspecified`). */
export function parseModalities(value) {
  if (value == null || value === true) return null;
  const out = [];
  for (const m of String(value).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (m === 'all') out.push(...SR_MODALITIES);
    else if (m === 'unspecified' || SR_MODALITIES.includes(m)) out.push(m);
    else throw Object.assign(new Error(`Unknown --modality "${m}" (screen-reader runs support ${SR_MODALITIES.join(' | ')} | all | unspecified; keyboard and mouse belong to accessibility-assessment)`), { usage: true });
  }
  return [...new Set(out)];
}

export async function buildJourneyPlans(ctx, { filter = null, viewportName = null, modalities = null } = {}) {
  const { resolveTargets, allScreens } = await importSiblingLib('inventory.mjs');
  const { inv, scope, journeysDoc } = ctx;
  const screens = new Map(allScreens(inv).map((s) => [s.id, s]));
  const baseUrl = inv.app?.baseUrl;
  const out = [];

  const startFor = (start, vp) => {
    if (start?.screen) {
      const [t] = resolveTargets(inv, { targets: [`${start.screen}__default__${vp.name}`] });
      return t.plan.map((st) => ({ ...st }));
    }
    if (start?.url) {
      const url = baseUrl ? new URL(start.url, baseUrl).href : start.url;
      return [{ action: 'goto', url, origin: 'start' }];
    }
    if (!baseUrl) throw new Error('journey has no start and inventory has no app.baseUrl');
    return [{ action: 'goto', url: baseUrl, origin: 'start' }];
  };

  const featureState = (ref) => {
    const [fid, sid] = String(ref).split('.');
    const feature = (inv.features ?? []).find((f) => f.id === fid);
    const state = feature?.states?.find((s) => s.id === sid);
    return state ? { feature, state } : null;
  };

  for (const j of journeysDoc.journeys ?? []) {
    if (filter && !filter.includes(j.id)) continue;
    // Every declared viewport is replayed (a separate journey run each) unless --viewport narrows it.
    const vpNames = viewportName ? [viewportName] : j.viewports?.length ? j.viewports : [null];
    for (const vpName of vpNames) {
      const vp = viewportOf(inv, vpName);
      const startPlan = startFor(j.start, vp);
      const plan = [...startPlan];
      const notes = [];
      let blocked = null;
      for (const seg of j.segments ?? []) {
        const origin = segmentOrigin(seg, screens);
        const sid = typeof seg.screen === 'string' ? seg.screen : seg.screen?.id;
        // Required feature states (e.g. a theme or a feature flag) are applied at the segment
        // boundary, like the inventory applies them after the root screen is ready.
        for (const ref of (seg.kind === 'state' && seg.state?.requires) || []) {
          const req = featureState(ref);
          if (!req) { blocked ??= `State "${seg.state.name ?? seg.state.id}" requires unknown feature state "${ref}"; the journey can't be replayed as scoped.`; continue; }
          const reqOrigin = `${req.feature.name ?? req.feature.id}: ${req.state.name ?? req.state.id} (required by ${origin})`;
          if (req.state.emulate) plan.push({ action: 'emulate', ...req.state.emulate, origin: reqOrigin });
          for (const st of stripRec(req.state.steps)) plan.push({ ...st, origin: reqOrigin });
          notes.push(`Required feature state ${ref} was applied before "${origin}".`);
        }
        if (seg.kind === 'state' && seg.state?.emulate) plan.push({ action: 'emulate', ...seg.state.emulate, origin });
        for (const st of stripRec(seg.steps)) plan.push({ ...st, origin });
        const ready = (typeof seg.screen === 'object' && seg.screen?.ready) || screens.get(sid)?.ready;
        if (seg.kind === 'screen' && ready) plan.push({ action: 'waitFor', target: ready, origin, settle: 0 });
      }
      const declared = (j.modalities ?? []).filter((m) => SR_MODALITIES.includes(m));
      const mods = modalities ?? (declared.length ? declared : ['unspecified']);
      for (const modality of mods) {
        out.push({
          id: j.id,
          key: `${vpNames.length > 1 ? `${j.id}@${vp.name}` : j.id}${modality === 'unspecified' ? '' : `~${modality}`}`,
          title: j.title ?? j.id,
          feature: (() => {
            const id = typeof j.feature === 'object' ? j.feature?.id : j.feature;
            const known = (inv.features ?? []).find((f) => f.id === id);
            return { id, name: (typeof j.feature === 'object' && j.feature?.name) || known?.name || id };
          })(),
          viewport: vp,
          modality,
          notes,
          blocked,
          startPlan,
          plan,
        });
      }
    }
  }

  // No journeys (an inventory-only scope): every scope target becomes a one-target journey.
  if (!out.length && !(journeysDoc.journeys ?? []).length) {
    const keys = (scope.targets ?? []).filter((k) => !viewportName || k.endsWith(`__${viewportName}`));
    for (const t of keys.length ? resolveTargets(inv, { targets: keys }) : []) {
      if (filter && !filter.includes(t.key)) continue;
      const startTarget = resolveTargets(inv, { targets: [`${t.screen.id}__default__${t.viewport.name}`] })[0];
      out.push({
        id: t.key,
        key: t.key,
        blocked: null,
        modality: 'unspecified',
        title: `${t.screen.name ?? t.screen.id} · ${t.state.name}`,
        feature: t.feature,
        viewport: { ...t.viewport },
        notes: [],
        startPlan: startTarget.plan.filter((st) => st.action === 'goto').slice(0, 1),
        plan: t.plan,
      });
    }
  }
  if (filter) {
    const missing = filter.filter((id) => !out.some((j) => j.id === id));
    if (missing.length) throw new Error(`Unknown --journey id(s): ${missing.join(', ')}`);
  }
  return out;
}
