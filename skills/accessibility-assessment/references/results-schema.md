# results.json contract

`results.json` is validated by `scripts/lib/results.mjs` (`validateResults`, `validateAgentFiles`) when it is written (`assess.mjs`) and whenever it is read (`report.mjs`, `fixes.mjs`, `summary.mjs`, `verify.mjs`). An invalid file makes the reader exit 1 with the list of problems; nothing is rendered. `assess.mjs` saves an invalid result as `results.invalid.json`.

## Top level

| Field | Notes |
|---|---|
| `schemaVersion` | Integer, currently `RESULTS_SCHEMA_VERSION` |
| `standard`, `level`, `app`, `engines`, `config`, `inventory`, `selection`, `scope` | Run description; `config` is what `verify.mjs` replays |
| `targets[]` | One per screen × state × viewport (see below) |
| `findings[]` | Engine and modality findings (`id`, `target`, `kind`, `rule`, `nodes[]` …) |
| `coverage[]`, `modalities[]`, `journeys[]` | Criteria checked, modalities run, journey summary |
| `execution` | `{ isolation: "fresh-context" \| "shared-context" \| "reused-page", setupModule, cdp, interventions[] }`. Anything but `fresh-context`, or any intervention, is shown as a banner and caps verification |
| `startedAt`, `finishedAt` | ISO timestamps |

## Targets

`status` is one of:

- `ok`: reached and assessed. Requires `screenshot`, `shot { file, width, height }` (must match the PNG on disk), finite positive `areas[]` boxes, and for each located finding either an area or a `geometry.findingsWithoutBox` count. A screen with a `scope` selector needs a `scope` area or `geometry.scope = "missing:<reason>"`. Tab stops with boxes need `tabstop` areas or `geometry.tabstopsWithoutBox`.
- `error`: attempted and failed; `error` holds the message.
- `blocked`: not run because a prerequisite target failed; needs `blockedBy` and `reason`.
- `not-attempted`: not run (for example `--bail`); needs `reason`.

Any target other than `ok` makes the run **partial**: the report shows a banner, and criteria with no finding are "Not evaluated (partial run)" instead of "No issues detected".

Optional per target: `interventions[]`, `stepsLog` (`steps.jsonl`), `modalityRuns[]`, `tabOrder[]`, `probes[]`.

## Findings and scope

Engine nodes carry `inScope` (`true`/`false`/`null`) and the finding carries `scopeSignal`: `in`, `out` (all located nodes outside the screen's scope selector) or `unknown` (nothing located). Agent input decides the final state:

- `agent-findings.json` entries need `scope: "in" | "potentially-out"` (+ optional `scopeNote`).
- `annotations.json` entries may set `scope`/`scopeNote` to override an engine finding; an explicit value always wins and clears `scopeUnreviewed`.
- Without an explicit value, `out`/`unknown` become `potentially-out` with `scopeUnreviewed: true`.

Potentially out-of-scope findings are excluded from counts, fixes and verification regressions, and listed separately.

## Evidence files

- `steps.jsonl`: one JSON line per modality or exploration action `{ ts, target, step, key|action, pageUrl, focused, outcome }`. `focused` is `{ role, name, selector }`, `"document"` or `"none"`; `outcome` may be `focus-timeout`.
- `report-check.json`: result of the rendered-report check (`problems[]`).
