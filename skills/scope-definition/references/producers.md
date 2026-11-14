# Producer interface

`step`/`propose` accept input from a small registry of **producers** so journeys can later be
authored by something other than the agent typing `step` calls - without changing anything in
`propose → confirm → verify → merge`, the compiled-journey schema, or the sibling skills'
`--scope` consumption.

## Contract

A producer turns its own raw input into zero or more **steps** that satisfy the same rules
`buildStep` enforces for the `text` producer:

- Every step needs at least one piece of `evidence` (a live snapshot ref, a source location, an
  existing inventory reference, or an explicit `reason` for a positional/CSS locator) - a step
  with none is rejected, not recorded with a placeholder.
- A target matching a password/secret-labeled field is refused outright.
- A `--nth` or `--selector` (CSS) target requires `--reason` explaining why a better locator
  (role+name, label, test id) wasn't available.
- An action verb in `intent.actionPolicy.forbid` is refused unless the step is explicitly marked
  as one of `intent.actionPolicy.requestedDestructive` (and even then, `propose` surfaces it as a
  flagged item in `proposal.md` for the human confirm gate to see).
- Output steps are plain inventory step objects (`action`, `target`, optional `value`/`key`) plus
  a `rec` provenance block (`producer`, `producerVersion`, `confidence`, `evidence[]`, optional
  `reason`). `rec` carries no app data beyond what the step already captured.

`runProducer(id, input, ctx)` (registry in `scripts/lib/producers/index.mjs`) validates `id` is
registered, calls the producer's `run(input, ctx)`, and validates every returned step against the
rules above before it reaches the session draft - a producer cannot bypass the safety rules by
construction.

```js
// scripts/lib/producers/<id>.mjs
export const id = "example";
export const version = 1;
export function run(input, ctx) {
  // ctx: { intent, inventory, grounding, snapshots, actionPolicy }
  // return: { steps: [...], warnings: [...] }
}
```

## Shipped in MVP-1/MVP-2

| id | Input | Status |
|---|---|---|
| `text` | The agent's own `scope.mjs step` calls, grounded against the parsed intent, inventory and live snapshots | **Implemented** |

## Planned, not implemented

These are named and reserved in the schema (`journeys.json`'s `segments[].producer` accepts any
of them) so a future implementation needs no format migration, but **no code ships for them in
this MVP**:

| id | Input | Idea |
|---|---|---|
| `recorder` | A headed Playwright session where a human performs the flow once | Capture real clicks/fills as steps, each with a live snapshot ref as evidence, through the same `runProducer` validation - no different review/verify path |
| `codegen` | An existing Playwright test file (`*.spec.ts`) | Parse its action calls into steps, keeping the test as the evidence source |
| `devtools` | A Chrome DevTools Recorder export (`.json`) | Map its step kinds onto inventory actions/targets |

A contributor adding one of these should: implement `run(input, ctx)` returning steps in the
shape above, register it in `scripts/lib/producers/index.mjs`, and add its id to
`journeys.json`'s `producer` enum in [schema.md](schema.md) - everything downstream (`propose`,
`confirm`, `verify`, `merge`, the sibling skills' `--scope` consumption) needs no change, since
they only ever see the compiled, `rec`-stripped journey.
