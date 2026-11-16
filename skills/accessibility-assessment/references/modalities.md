# Interaction modalities

A modality states **how** a person operates the page. Without one, the assessment behaves as before.
Declared per journey/step in `journeys.json` (`modalities: [...]`, written by `scope-definition`) or
chosen on the command line with `--modality`.

| Modality | Allowed | Run by |
|---|---|---|
| `keyboard` | Tab, Shift+Tab, arrow keys, Enter, Space for navigation and activation (any key to type text, Escape to dismiss). No mouse, no programmatic focus. | `assess.mjs` |
| `mouse` | Pointer. Legacy complete run; no extra pointer rules yet. | `assess.mjs` |
| `sr-keyboard` | Same keys as `keyboard`, sent through a screen reader. | `screen-reader-validation` |
| `sr-navigation` | Keys plus reader navigation (headings, landmarks, reading). | `screen-reader-validation` |

Touch is never run automatically; disclose it as untested. `sr-*` given to `assess.mjs` is a usage
error (exit 3), and so are `keyboard`/`mouse` given to `sr.mjs`.

## Flags

`--modality keyboard,mouse` · `--max-presses 120` (search bound per step) ·
`--max-escalations 10` (the run stops as `partial` after this many) · `--no-escalate` (never fall
back to the mouse or script focus; a stuck step is reported inconclusive).

## Procedure (keyboard)

Each target's plan is replayed in a fresh context. Per step the mouse is banned and programmatic
focus is not used. The agent Tabs (and uses arrows in composite widgets) up to `--max-presses`
looking for the element, then activates it with Enter or Space. Only when it is **stuck** is the
barrier demonstrated once in a rescue scope (pointer click or script focus), and it is reported as
a finding with repro steps, screenshot and fix proposal. Typing into sensitive fields is refused.
Steps using Home/End/PageUp/PageDown/F6 for navigation are not run (`kbd-nonstandard-key`).
Evaluate steps are flagged (`kbd-programmatic-intervention`).

Run status: `complete` · `escalated` (a barrier was found, run continued) · `partial` (inconclusive
step or escalation cap) · `blocked` (could not continue). `partial`/`blocked` exit 2; "no issues"
is never a pass for them. A setup intervention (`target.addIntervention`, see the
accessibility-assessment SKILL.md) during a run makes it `partial`. Each action is appended to
`<run>/steps.jsonl` as it happens.

## Rules

Failures need demonstrated evidence; WCAG numbers say what the barrier is *potentially relevant*
to. Reviews and suggestions carry no WCAG attribution.

| Rule | Kind | Meaning |
|---|---|---|
| `kbd-mouse-required` | failure, critical, 2.1.1 | Only a pointer click completed the step |
| `kbd-programmatic-focus` | failure, serious, 2.1.1/2.4.3 | Tab cycle never reached it, script focus did |
| `kbd-not-focusable` | failure, serious, 2.1.1 | Interactive element cannot take focus |
| `kbd-trap` | failure, critical, 2.1.2 | Tab, Shift+Tab and Escape do not leave |
| `kbd-no-activation` | failure, serious, 2.1.1 | Enter/Space do nothing; a click does |
| `kbd-composite-no-arrows` | failure, serious, 2.1.1 | Catalogued; not emitted yet |
| `kbd-hover-only` | review | Step hovers; check a focus equivalent |
| `kbd-focus-lost` | review, 2.4.3 | Catalogued; not emitted yet |
| `kbd-programmatic-intervention` | review | Script needed mid-journey |
| `kbd-search-inconclusive` | review | Press limit reached |
| `kbd-activation-unobserved` | review | No observable change from Enter, Space or click |
| `kbd-step-skipped` | review | Step declared not performed for the modality |
| `kbd-nonstandard-key` | suggestion | Navigation uses keys outside the allowed set |
| `kbd-unexpected-autofocus` | suggestion | Catalogued; not emitted yet |

Screen-reader rules (`srnav-*`, `sr-autofocus-focus-mode`) are in
`screen-reader-validation/references/heuristics.md`.

## Output

`results.json`: `modalityRuns[]` per target (`modality`, `status`, `steps[]` with `outcome`,
`presses`, `escalation`, `rules`) and findings with `source: "modality"`, `modality`, `stepIndex`,
`journey`, `escalation`, `presses`. The report shows a modality badge, a summary count and the
findings with the other issues. Fix files (`fix-<issue>.md`) carry the repro and fix proposal;
`fix-verify` re-runs the same modality, and a missing modality run is `unverified`.

## Limits

- Pointer-only hazards (hover/down activation, drag, target size under pointer) are not covered.
- A focus order or visibility problem is left to the legacy keyboard walk.
- Observation of "activation worked" is by DOM/focus/URL change; silent but valid actions are reviews.
