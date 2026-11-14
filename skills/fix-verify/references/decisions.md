# Verification decisions

How `verify.mjs` (accessibility-assessment skill) turns a re-run into a status. Reference for
when a result looks surprising; see the sibling skill's `lib/verify.mjs` for the literal code.

## Version policy

Checked before anything else runs, per fix file.

| Field | Mismatch behaviour |
|---|---|
| `axe-core` version | Hard-fail → `unverified (incompatible)` |
| `abledom` version | Hard-fail → `unverified (incompatible)` |
| `level` (A/AA/AAA) | Hard-fail → `unverified (incompatible)` |
| Viewport sizes | Hard-fail → `unverified (incompatible)` |
| Target `planHash` | Hard-fail, unless `--accept-plan-change` (then one warning listing every changed target) |
| Execution policy (step `modalities`, `intent`, `keys`, skips) | Hard-fail like `planHash`, same `--accept-plan-change`: a changed policy means the replay is no longer the baseline's |
| `playwright` version | Warning only, attempt proceeds |
| Inventory file sha256 | Warning only, attempt proceeds. Inventory edits that matter show up as `planHash` changes |

## Relocation tiers

Each listed node from the fix file must be re-found in the live page before a verdict can
consider it. Tried in order, first non-empty **and unique** match wins; ties (more than one
candidate at a tier) fall through to the next tier:

1. **Selector + identity** — the original CSS selector, and the original identity data (role,
   name, attributes captured at baseline) both still agree on one element.
2. **Source + tag** — `file:line` from `node.source` (plus role/name when non-empty; ordinal
   position only counted when the number of matches is unchanged).
3. **Role + name + tag** — accessible role and name, unique among same-tag elements.
4. **Visible text (≥3 chars) + tag** — last resort, excluded from regression detection (too
   weak a signal to blame a *different* element for a new failure).

A node that matches nothing at any tier is `confirmed-removed` when it had a strong identity
(role + accessible name, or a source location) that is now absent from the page - the element
was removed, which counts as clear for its rule. Otherwise (weak or no identity, or more than
one candidate) it is `unresolved`. Findings without nodes (`nodeless`) are judged only by
whether the rule still fires on the target.

## Decision rules (first match wins)

| # | Condition | Result |
|---|---|---|
| 1 | Version policy hard-fail | `unverified (incompatible: <field>)` |
| 2 | Target not reached (the first errored target is named with its error), the issue's own check or rule didn't run, or any other requested check that completed at baseline didn't complete on an affected target | `unverified (target not reached / check not run / check "X" did not complete)` |
| 2e | A modality finding (`kbd-*`) whose original step did not execute under the same modality (modality run missing, `blocked`/`partial`, or the step `skipped`/`blocked`/`inconclusive`) | `unverified (modality evidence gap)`; a modality fix is never `fixed` by absence of a finding alone |
| 3 | The same rule still fires on a relocated node carrying the original finding's marker (or, for nodeless/identity-less findings, the rule still fires at all) | `not fixed` |
| 4 | Any listed node is `unresolved` | `unverified (node unresolved)` |
| 5 | New failures appear that don't correlate to any known node (tiers 1-3 only; tier-4/text-only matches are excluded from this check) | `regressed` |
| 6 | The issue is `kind: review`, or was sourced from agent judgement (`source: agent`), and has no entry in `agent-verdicts.json` | `needs review` |
| 7 | None of the above | `fixed` |

`needs review` and `unverified` results are what the fix-verify skill's workflow (replay +
`agent-verdicts.json` + `--render-only`, or re-baseline) resolves manually; see its `SKILL.md`.
