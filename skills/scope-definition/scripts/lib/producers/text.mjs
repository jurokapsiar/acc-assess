// The MVP producer: `text`. Per §6.5/§15, the heavy lifting (matching the prompt's intent to
// screens/states and deciding on steps) is the agent's job, performed interactively via
// `scope.mjs step`/`checkpoint`; this producer is the thin pass-through that hands the
// session's already-built, already-validated draft to the registry as `journeys.json`-shaped
// output. It never does its own text-to-locator inference.
export default {
  id: 'text',
  version: 1,
  interactive: false,
  async produce(ctx) {
    const journeys = ctx.session.draft?.journeys ?? [];
    return {
      journeys: journeys.map((j) => ({ ...j, producer: 'text', producerVersion: 1 })),
      artifacts: [],
      warnings: journeys.length ? [] : ['No journeys drafted yet - run "step"/"checkpoint" before "propose".'],
    };
  },
};
