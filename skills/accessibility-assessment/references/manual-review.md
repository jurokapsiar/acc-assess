# Agent review checklist

Use this after `assess`, for each screen in the selection. Every check needs evidence: a screenshot, a Playwright observation, or a source line. Anything you can't observe stays *Manual check*.

Inputs per target (in the run folder):
- Summary first: `node <skill-dir>/scripts/summary.mjs <run> [--screen <id>] [--rule <id>]` (counts, failed criteria, top issues, fix files). Read `results.json` only for details it doesn't show.
- `results.json`: the target's `repro`, `tabOrder` (on overlays, stop `0` is the element focused on open, with `source` and `screenshot`), `tabOrderNote` and findings.
- `shots/<key>.png`: full screen, when the target was reached (the target's `screenshot`).
- `shots/<key>__taborder.png`: numbered focus order, only when the keyboard check ran and found stops (the target's `tabOrderShot`).
- `shots/<key>__annotated.png`: axe failures, only when axe flagged elements with a box (the target's `annotated`).

Use the paths recorded in `results.json`; a missing one means that evidence wasn't produced. A `tabOrderNote` saying Tab exits the overlay means arrow-key navigation wasn't measured: check it under APG conformance below.

Knowledge:
- `<skill-dir>/knowledge/apg/<slug>.md` for each pattern in the screen's `patterns`.
- `<skill-dir>/knowledge/wcag/<num>-<id>.md` for criterion text and failure techniques.

## APG conformance

For each pattern slug:
1. Open the screen with Playwright, following the repro steps.
2. Do each item in **Keyboard Interaction**, then record the focused element and the visible change.
3. Compare the DOM against **WAI-ARIA Roles, States, and Properties**: roles, `aria-expanded`, `aria-selected`, `aria-controls`, `aria-modal`, labelling.
4. Classify each deviation:
   - Missing required keyboard support (for example, Arrow keys don't move between tabs, Enter doesn't activate) → `failure`, SC 2.1.1.
   - Wrong or missing role/state → `failure`, SC 4.1.2.
   - APG "optional" behaviour, or recommendations without an SC (Home/End, typeahead, focus wrapping) → `suggestion` with `pattern: "<slug>"`.

## Visual checks (screenshots)

| SC | Check |
|---|---|
| 1.3.2, 2.4.3 | Tab-order numbers follow reading order; no jumps between regions |
| 1.4.1 | State, errors, required fields and links aren't shown by color alone |
| 1.4.3 | Text on images, gradients or translucent surfaces (axe *incomplete* items) |
| 1.4.5 | No images of text, except logos |
| 1.4.11 | Input borders, icons, focus rings and toggle states have at least 3:1 against adjacent colors. Sample pixels from the screenshot |
| 2.4.6 | Headings and labels describe their purpose |
| 2.4.7 | Focus indicator is visible in every theme state in the inventory |

## Interaction checks (Playwright)

| SC | Check |
|---|---|
| 1.3.4 | Swap viewport width/height; content isn't locked to one orientation |
| 1.4.4 | Emulate 200% zoom by halving the viewport width (and set root `font-size: 200%` to catch rem-based text): no clipping or overlap |
| 1.4.13 | Hover/focus a tooltip trigger: Escape dismisses it without moving the pointer, the pointer can move onto the tooltip, and it stays until dismissed |
| 2.1.4 | Single printable-key shortcuts can be turned off or remapped, or only work on focus |
| 2.5.1, 2.5.7 | Drag, swipe and pinch actions have single-pointer alternatives (buttons) |
| 3.2.1, 3.2.2 | Focusing a control or changing a value doesn't navigate, submit or move focus unexpectedly |
| 3.3.1, 3.3.3 | Error states (add them as inventory states) name the field, describe the error in text, suggest a fix and are programmatically associated (`aria-describedby`/`aria-invalid`) |
| 4.1.3 | Toasts, validation summaries and loading states are announced: `role=status`/`alert` or `aria-live`, present before the update |

## Cross-screen checks (inventory level)

| SC | Check |
|---|---|
| 2.4.2 | Each page or view has a distinct, descriptive `document.title` |
| 2.4.5 | More than one way to reach pages (nav plus search, sitemap or links) |
| 3.2.3 | Navigation is in the same relative order on every page |
| 3.2.4 | Same function, same name and icon (for example "Close", not "Dismiss" elsewhere) |
| 3.2.6 | Help or contact appears in the same place on every page |
| 3.3.7 | Multi-step flows don't ask for the same data twice |

## Writing findings

- One finding per element and problem. Use `nodes[].selector`, and add `screenshot` paths relative to the run folder. To capture a new screenshot, save it under `shots/agent-*.png`.
- `repro`: start from the target's `repro` and append the steps you performed.
- `fix`: name the file and line, and give the exact attribute, element or CSS change.
- `kind`: `failure` only for a violated criterion at or below the selected level (`--level`, default AA); otherwise `suggestion`; `review` when uncertain.
