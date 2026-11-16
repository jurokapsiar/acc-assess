// Scope overlay: lets a `scope.json` + `journeys.json` pair (written by the sibling
// `scope-definition` skill, or by hand) add screens/states to an inventory IN MEMORY, without
// ever writing to it. Owned here (not scope-definition) because `assess.mjs`, `inventory.mjs`
// and `verify.mjs` all need it and must not depend on a sibling skill's scripts.
//
// Overlay shape: `{ features: [{ id, name?, screens: [...] }] }`, screens/states using
// exactly the inventory schema (references/inventory.md). Merge rule (shared by in-memory
// `applyScope` and scope-definition's `scope.mjs merge`): per feature/screen/state id, absent
// -> append; present and deep-equal -> no-op; present and different -> conflict (nothing
// mutated, caller decides what to do).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { allScreens, resolveTargets, validateInventory } from './inventory.mjs';

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function loadScope(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`Scope file not found: ${abs}`);
  const scope = JSON.parse(fs.readFileSync(abs, 'utf8'));
  scope.__file = abs;
  return scope;
}

export function loadJourneysFor(scope) {
  const dir = path.dirname(scope.__file ?? '.');
  const file = path.resolve(dir, scope.journeys ?? 'journeys.json');
  if (!fs.existsSync(file)) throw new Error(`Journeys file not found: ${file} (referenced by scope "${scope.id ?? scope.__file}")`);
  const raw = fs.readFileSync(file, 'utf8');
  return { doc: JSON.parse(raw), file, sha256: crypto.createHash('sha256').update(raw).digest('hex') };
}

// Strips the recorder/producer-only `rec` field from every step so it never affects
// `planHash` (§7.2: "rec is ignored by the runner, stripped by compileJourneys").
function stripRec(steps = [], journey = null, modalities = null) {
  return steps.map(({ rec, ...st }) => {
    const out = journey && st.journey === undefined ? { ...st, journey } : st;
    return modalities?.length && out.modalities === undefined ? { ...out, modalities } : out;
  });
}

/**
 * Compiles `journeys.json`'s journeys into an inventory-shaped overlay:
 * `{ features: [{ id, name, screens: [...] }] }`. A `kind: "screen"` segment with a full
 * screen object introduces a new screen (its `steps` are the segment's steps, minus `rec`).
 * A `kind: "state"` segment attaches a state (its `steps` minus `rec`) to the screen named by
 * `segment.screen` (an id string, or the screen just introduced by an earlier segment in the
 * same journey).
 */
export function compileJourneys(journeysDoc) {
  const featuresById = new Map();
  const screensById = new Map();

  const featureFor = (ref) => {
    const id = typeof ref === 'string' ? ref : ref?.id;
    if (!id) throw new Error('journey.feature requires an id');
    if (!featuresById.has(id)) {
      featuresById.set(id, typeof ref === 'object' ? { id: ref.id, name: ref.name ?? ref.id, screens: [] } : { id, screens: [] });
    }
    return featuresById.get(id);
  };
  const screenFor = (feature, id) => {
    let screen = screensById.get(id);
    if (!screen) {
      screen = { id };
      screensById.set(id, screen);
      feature.screens.push(screen);
    }
    return screen;
  };

  for (const j of journeysDoc.journeys ?? []) {
    const feature = featureFor(j.feature);
    for (const seg of j.segments ?? []) {
      if (seg.kind === 'screen') {
        if (typeof seg.screen === 'string') continue; // revisiting an existing screen; no new entity
        const id = seg.screen.id;
        const screen = screenFor(feature, id);
        Object.assign(screen, seg.screen, { steps: stripRec(seg.steps ?? [], j.id, j.modalities) });
      } else if (seg.kind === 'state') {
        const screenId = typeof seg.screen === 'string' ? seg.screen : seg.screen.id;
        const screen = screenFor(feature, screenId);
        screen.states = screen.states ?? [];
        screen.states.push({ ...seg.state, steps: stripRec(seg.steps ?? [], j.id, j.modalities) });
      } else {
        throw new Error(`Unknown segment kind "${seg.kind}" in journey "${j.id}"`);
      }
    }
  }
  return { features: [...featuresById.values()] };
}

function sortedClone(v) {
  if (Array.isArray(v)) return v.map(sortedClone);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortedClone(v[k])]));
  }
  return v;
}

function deepEqual(a, b) {
  return JSON.stringify(sortedClone(a)) === JSON.stringify(sortedClone(b));
}

// Merges one overlay screen into an existing inventory screen, additively. Returns a
// conflict description, or null when applied cleanly (possibly a no-op).
function mergeScreen(existing, incoming, where) {
  const conflicts = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (key === 'states') continue;
    if (existing[key] === undefined) existing[key] = value;
    else if (!deepEqual(existing[key], value)) conflicts.push(`${where}: field "${key}" differs from the inventory`);
  }
  const existingStates = existing.states ?? [];
  for (const st of incoming.states ?? []) {
    if (!existing.states) existing.states = existingStates;
    const match = existingStates.find((s) => s.id === st.id);
    if (!match) existingStates.push(st);
    else if (!deepEqual(match, st)) conflicts.push(`${where}: state "${st.id}" differs from the inventory`);
  }
  return conflicts;
}

/**
 * Applies a scope's compiled journeys overlay onto an inventory IN MEMORY (a clone; the
 * original `inv` is untouched). Additive only: a new feature/screen/state id is appended; an
 * existing one with identical content is a no-op; an existing one with different content is a
 * conflict, listed in `conflicts` with nothing applied for that entity (every other entity in
 * the overlay still applies). Never writes to disk - that's `scope.mjs merge`'s job.
 */
export function applyScope(inv, scope) {
  const { doc } = loadJourneysFor(scope);
  const overlay = compileJourneys(doc);
  const merged = structuredClone(inv);
  if (inv.__file) merged.__file = inv.__file;
  const conflicts = [];
  for (const of of overlay.features) {
    const existing = merged.features.find((f) => f.id === of.id);
    if (!existing) {
      merged.features.push(structuredClone(of));
      continue;
    }
    existing.screens = existing.screens ?? [];
    for (const os of of.screens) {
      const existingScreen = existing.screens.find((s) => s.id === os.id);
      if (!existingScreen) {
        existing.screens.push(structuredClone(os));
        continue;
      }
      conflicts.push(...mergeScreen(existingScreen, os, `screen "${os.id}"`));
    }
  }
  return { inv: merged, conflicts };
}

/** Deterministic hash of the parts of a scope that, if edited, should invalidate an approval. */
export function scopeDigest(scope) {
  const { __file, approval, verification, status, ...rest } = scope;
  return crypto.createHash('sha256').update(JSON.stringify(sortedClone(rest))).digest('hex');
}

/**
 * Validates a scope against an inventory (§7.3): overlay applies without conflicts, every
 * `targets` key resolves against inventory ⊕ overlay, and `journeysSha256` matches the
 * journeys file currently on disk. Returns `{ errors, warnings, conflicts, mergedInv }`.
 */
export function validateScope(scope, inv) {
  const errors = [];
  const warnings = [];
  if (scope.schemaVersion !== 1) errors.push(`unknown schemaVersion ${scope.schemaVersion}`);
  if (scope.id && !KEBAB_RE.test(scope.id)) errors.push(`scope id "${scope.id}" is not kebab-case`);
  if (!Array.isArray(scope.targets) || !scope.targets.length) errors.push('targets[] must not be empty');

  let mergedInv = inv;
  let conflicts = [];
  try {
    const { doc, sha256 } = loadJourneysFor(scope);
    if (scope.journeysSha256 && scope.journeysSha256 !== sha256) warnings.push('journeysSha256 does not match the journeys file on disk');
    const overlay = compileJourneys(doc);
    for (const f of overlay.features) {
      for (const s of f.screens) {
        if (!KEBAB_RE.test(s.id)) errors.push(`screen id "${s.id}" is not kebab-case`);
        for (const st of s.states ?? []) if (!KEBAB_RE.test(st.id)) errors.push(`screen "${s.id}" state id "${st.id}" is not kebab-case`);
      }
    }
    const applied = applyScope(inv, scope);
    mergedInv = applied.inv;
    conflicts = applied.conflicts;
  } catch (err) {
    errors.push(err.message);
  }
  for (const c of conflicts) errors.push(`conflict: ${c}`);

  if (!errors.length) {
    const invCheck = validateInventory(mergedInv);
    errors.push(...invCheck.errors);
    warnings.push(...invCheck.warnings);
  }
  if (!errors.length && Array.isArray(scope.targets)) {
    try {
      resolveTargets(mergedInv, { targets: scope.targets });
    } catch (err) {
      errors.push(err.code === 'UNKNOWN_TARGETS' ? `unresolved targets: ${err.missing.join(', ')}` : err.message);
    }
    const screenIds = new Set(allScreens(mergedInv).map((s) => s.id));
    for (const ref of scope.targets) {
      const [screenId] = ref.split('__');
      if (!screenIds.has(screenId)) errors.push(`target "${ref}": unknown screen "${screenId}"`);
    }
  }
  return { errors, warnings, conflicts, mergedInv };
}
