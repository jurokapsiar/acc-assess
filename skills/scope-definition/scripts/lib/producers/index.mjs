// Producer registry (§15): a thin, pluggable seam so a future `recorder`/`codegen`/`devtools`
// producer can slot in without touching `scope.mjs`. MVP ships only `text`.
import { loadScopeLib, loadInventoryLib } from '../deps.mjs';
import text from './text.mjs';

const REGISTRY = new Map([[text.id, text]]);

export function getProducer(id) {
  const p = REGISTRY.get(id);
  if (!p) throw new Error(`Unknown producer "${id}". Known: ${[...REGISTRY.keys()].join(', ')}`);
  return p;
}

export function registerProducer(producer) {
  REGISTRY.set(producer.id, producer);
}

/** Runs a producer's `produce(ctx)`, then validates its output the same way a hand-built draft
 * is validated (every journey step carries `rec.confidence` + `rec.evidence`, and the compiled
 * result passes `validateScope` once a scope/targets envelope is available). Producers never
 * write inventory.json, scope.json or reports (§15) - only the registry writes `journeys.json`
 * via the normal propose path. */
export async function runProducer(id, ctx) {
  const producer = getProducer(id);
  const result = await producer.produce(ctx);
  for (const j of result.journeys ?? []) {
    for (const seg of j.segments ?? []) {
      for (const st of seg.steps ?? []) {
        if (!st.rec?.confidence || !st.rec?.evidence?.length) {
          throw new Error(`Producer "${id}" emitted a step without rec.confidence/rec.evidence (journey "${j.id}"); every producer must attach provenance.`);
        }
      }
    }
  }
  return result;
}

export { loadScopeLib, loadInventoryLib };
