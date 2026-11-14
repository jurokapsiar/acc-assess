# Narration heuristics

`scripts/lib/analyse.mjs` is pure and deterministic: the same `results.json` always yields the
same findings. Each journey step carries the narration captured around the action (plus **late**
phrases heard before the next action) and DOM facts before/after (`inpage.mjs`): focused element
(selector, role, accessible name, native, `widgetLike`, states, containing dialog), open dialogs
(with `modal`), live regions with their text, error messages (`kind`: `alert`, `invalid` field,
or `text` candidate), and `aria-controls` targets with visibility. Rules compare **what changed**
with **what was said**. Catalogue: `scripts/lib/rules.mjs`.

## Matching

- Text is normalised (case, punctuation) and matched **as whole words within one phrase**:
  `yes` when the full word sequence (or, for texts longer than 8 words, its first 6 words)
  occurs in a phrase; `partial` when ≥60% of its words (length > 2) occur in one phrase; `no`
  otherwise. "Unsaved changes" never matches "Saved".
- Role/state vocabulary and reader hints ("to activate press …", "you are currently on …") are
  stripped before deciding whether a *name* or other content was spoken.
- States: negative words are matched first ("not checked" never counts as "checked") and the
  **last** phrase that states the value wins (focus may announce the old state before the change).

## Evidence confidence: failure vs review

A rule's default kind is a ceiling. Findings are reported as `review` (never `failure`) when the
evidence is uncertain:

| Situation | Effect |
|---|---|
| Step capture health is not `captured`/`simulated` (`unavailable`, `unaligned`) | Every failure on that step → review; `evidence.capture` and `evidence.confidence` say why. |
| Expected text matched only `partial` (dialog name, status, error text) | review, `confidence` names the partial match. |
| Dialog is not modal (`aria-modal`/`<dialog>.showModal()` absent) and focus stayed outside | `sr-focus-not-in-dialog` → review (moving focus is recommended, not required). |
| Error candidate inferred from an id/class containing "error" (`kind: text`) | `sr-error-not-announced` → review. |
| Focus did not return after a dialog closed but landed on another element (not body) | `sr-focus-not-returned` → review. |

## Rules

| Rule | Kind / severity | WCAG | Fires when |
|---|---|---|---|
| `sr-blank-announcement` | failure / serious | 4.1.2 | Focus is on an element and a phrase contains "blank", "unlabelled" or "clickable" and **no phrase** of the step has other content words (a "clickable" prefix followed by a real name is fine). |
| `sr-control-without-name` | failure / serious | 4.1.2 | Focus moved to an interactive element, its name was not spoken, and the narration contained only role/state words (or nothing and the element has no name). |
| `sr-missing-role` | failure / serious | 4.1.2 | Focus moved to a non-native, role-less element that behaves like a widget (`widgetLike`: click handler or pointer cursor) and no role word was spoken. Focusable paragraphs/headings (programmatic focus targets) are ignored. |
| `sr-missing-state` | failure / moderate | 4.1.2 | A focused element has (or changed) expanded/pressed/checked/selected and that state was not announced, or the opposite was; or an action on an `aria-controls` element showed/hid its target while `aria-expanded` stayed the same/missing. |
| `sr-dialog-not-announced` | failure / serious | 4.1.2 | A dialog opened and neither the word "dialog" nor its full name was spoken. |
| `sr-focus-not-in-dialog` | failure (modal) or review (non-modal) / serious | 2.4.3 | A dialog opened and focus is not inside it. |
| `sr-focus-not-returned` | failure (body) or review (elsewhere) / moderate | 2.4.3 | A dialog opened during the journey closed and focus did not return to its opener. |
| `sr-status-not-announced` | failure / serious | 4.1.3 | A live region's text appeared/changed and was not spoken (the summary notes when the region was inserted together with its message). |
| `sr-error-not-announced` | failure (`alert`/`invalid`) or review (`text`) / serious | 3.3.1, 4.1.3 | Error text appeared/changed or a field became `aria-invalid` **because of a step** (errors already present on page load / after a navigation are ignored), and neither the text nor "invalid" was spoken. |
| `sr-silent-navigation` | review / moderate (failure / serious, 2.4.2 when the page has no title) | 2.4.3 | A `goto`/`reload`/`back`/`forward` or URL change produced no narration (late phrases count). |
| `sr-silent-action` | review / moderate | 4.1.2 | An actionable step (not fill/type/hover/select) produced no narration and no other rule fired for it. |
| `sr-duplicate-announcement` | suggestion / minor | — | The same phrase twice in a row, or a phrase repeating a word group ("Save Save"). |
| `sr-verbose` | suggestion / minor | — | A phrase (minus hints) is longer than 160 characters. |
| `sr-symbol-noise` | suggestion / minor | 1.1.1 | Narration or the focused name contains emoji / private-use icon-font glyphs. |
| `sr-reading-order` | review / moderate | 1.3.2 | Probe `reading` sweep: an item is read after one it is displayed above, in the same column (max 5 per page). |
| `sr-no-landmarks` | review / moderate | 2.4.1 | Probe: no "main" landmark announced and none in the DOM. |
| `sr-no-headings` | review / moderate | 1.3.1 | Probe: no heading announced and none in the DOM. |

## Probes

Probe sweeps report a `termination` (see `drivers.md`). Sweeps that ended `unsupported` or
`error`, or `silent` with no items, prove nothing and produce no findings; they are counted in
`summary.probesIncomplete` and flagged in the report. `cap` and `repeat` sweeps are analysed on
the items collected. A sweep during which the reader was in focus mode is retried once after
re-establishing browse mode, then discarded (`invalid-focus-mode`, no findings).

## Modality rules

Failures from `kbd-*` (shared catalogue, see `accessibility-assessment/references/modalities.md`)
come from the keyboard-only replay. SR-specific, review-only (reader position is name evidence
only): `srnav-not-reachable` (a read step's target name was not in the reading sweep; skipped for
empty/duplicate names or unusable sweeps), `srnav-no-semantic-nav` (headings/landmarks in the DOM,
none announced), `srnav-focus-mode-required` (browse mode could not be confirmed while reading);
suggestion `sr-autofocus-focus-mode` (editable field focused after load).

## Output

Deduplication: one finding per rule + target + selector + summary. Ids are `sr-<n>` in detection
order. Every finding carries `repro` (the step descriptions up to and including the step), the
screenshot of that step and `evidence.narration` (what was heard) vs `evidence.expected`, plus
`evidence.confidence` / `evidence.capture` for downgraded findings.

## Limits

- Timing: narration is read after `settleMs` (NVDA 1200 ms, VoiceOver 1500 ms, mock 100 ms);
  speech that arrives later is kept as the step's `late` phrases (and analysed with the step)
  only until the next action starts.
- Readers differ in wording; matching is lenient, but a translated reader UI (non-English
  role/state words) reduces accuracy of `sr-control-without-name` / `sr-missing-state`.
- DOM facts decide what *should* be announced; a custom widget the facts do not recognise as a
  dialog/live region/error is not checked.
- `review` items need a human listen-through before being reported as defects.
