# Accessibility rule catalog

Rule counts: axe 103, AbleDOM 10, Playwright 12, Guidepup (screen reader) 17, Agent (manual review) 24 — total 166.

## axe-core rules

| WCAG SC | Severity | Description | Rule id | Method | Kind |
|---|---|---|---|---|---|
| — | serious | Duplicate accesskey attribute values | `accesskeys` | axe | suggestion |
| 2.4.4, 4.1.2 | critical | Area element missing alt text | `area-alt` | axe | failure / review |
| 4.1.2 | critical | Unsupported ARIA attribute used | `aria-allowed-attr` | axe | failure / review |
| — | minor | Inappropriate ARIA role used | `aria-allowed-role` | axe | suggestion |
| 4.1.2 | serious | aria-braille missing non-braille equivalent | `aria-braille-equivalent` | axe | failure / review |
| 4.1.2 | serious | ARIA command missing accessible name | `aria-command-name` | axe | failure / review |
| 4.1.2 | serious | ARIA attribute misused for role | `aria-conditional-attr` | axe | failure / review |
| 4.1.2 | minor | Deprecated ARIA role used | `aria-deprecated-role` | axe | failure / review |
| — | serious | Dialog missing accessible name | `aria-dialog-name` | axe | suggestion |
| 1.3.1, 4.1.2 | critical | aria-hidden set on body | `aria-hidden-body` | axe | failure / review |
| 4.1.2 | serious | Hidden element is focusable | `aria-hidden-focus` | axe | failure / review |
| 4.1.2 | serious | Input field missing accessible name | `aria-input-field-name` | axe | failure / review |
| 1.1.1 | serious | Meter missing accessible name | `aria-meter-name` | axe | failure / review |
| 1.1.1 | serious | Progressbar missing accessible name | `aria-progressbar-name` | axe | failure / review |
| 4.1.2 | serious | Prohibited ARIA attribute used | `aria-prohibited-attr` | axe | failure / review |
| 4.1.2 | critical | Required ARIA attribute missing | `aria-required-attr` | axe | failure / review |
| 1.3.1 | critical | Role missing required children | `aria-required-children` | axe | failure / review |
| 1.3.1 | critical | Role missing required parent | `aria-required-parent` | axe | failure / review |
| 4.1.2 | serious | roledescription on non-semantic element | `aria-roledescription` | axe | failure / review |
| 4.1.2 | critical | Invalid ARIA role value | `aria-roles` | axe | failure / review |
| 4.1.2 | serious | Tab missing accessible name | `aria-tab-name` | axe | failure / review |
| — | serious | role=text has focusable descendants | `aria-text` | axe | suggestion |
| 4.1.2 | serious | Toggle field missing accessible name | `aria-toggle-field-name` | axe | failure / review |
| 4.1.2 | serious | Tooltip missing accessible name | `aria-tooltip-name` | axe | failure / review |
| — | serious | Treeitem missing accessible name | `aria-treeitem-name` | axe | suggestion |
| 4.1.2 | critical | Invalid ARIA attribute name | `aria-valid-attr` | axe | failure / review |
| 4.1.2 | critical | Invalid ARIA attribute value | `aria-valid-attr-value` | axe | failure / review |
| 1.2.1 | critical | Audio missing captions track | `audio-caption` | axe | failure / review |
| 1.3.5 | serious | Invalid autocomplete attribute value | `autocomplete-valid` | axe | failure / review |
| 1.4.12 | serious | Inline text spacing not adjustable | `avoid-inline-spacing` | axe | failure / review |
| 2.2.2 | serious | Deprecated blink element used | `blink` | axe | failure / review |
| 4.1.2 | critical | Button missing discernible text | `button-name` | axe | failure / review |
| 2.4.1 | serious | No way to bypass blocks | `bypass` | axe | failure / review |
| 1.4.3 | serious | Insufficient text color contrast | `color-contrast` | axe | failure / review |
| 1.4.6 | serious | Insufficient enhanced color contrast | `color-contrast-enhanced` | axe | suggestion |
| 1.3.4 | serious | CSS locks display orientation | `css-orientation-lock` | axe | failure / review |
| 1.3.1 | serious | Invalid definition list structure | `definition-list` | axe | failure / review |
| 1.3.1 | serious | dt/dd not inside dl | `dlitem` | axe | failure / review |
| 2.4.2 | serious | Document missing title element | `document-title` | axe | failure / review |
| 4.1.2 | critical | Duplicate ARIA/label id value | `duplicate-id-aria` | axe | failure / review |
| — | minor | Heading has no text | `empty-heading` | axe | suggestion |
| — | minor | Table header text empty | `empty-table-header` | axe | suggestion |
| — | minor | Focus order element wrong role | `focus-order-semantics` | axe | suggestion |
| 3.3.2 | moderate | Form field has multiple labels | `form-field-multiple-labels` | axe | failure / review |
| 2.1.1 | serious | Focusable frame has tabindex=-1 | `frame-focusable-content` | axe | failure / review |
| — | critical | Frame content needs review | `frame-tested` | axe | suggestion |
| 4.1.2 | serious | Frame missing accessible name | `frame-title` | axe | failure / review |
| 4.1.2 | serious | Frame title not unique | `frame-title-unique` | axe | failure / review |
| — | moderate | Heading levels skip a level | `heading-order` | axe | suggestion |
| — | minor | Hidden content needs review | `hidden-content` | axe | suggestion |
| 3.1.1 | serious | html element missing lang | `html-has-lang` | axe | failure / review |
| 3.1.1 | serious | Invalid html lang value | `html-lang-valid` | axe | failure / review |
| 3.1.1 | moderate | lang and xml:lang mismatch | `html-xml-lang-mismatch` | axe | failure / review |
| 2.4.9 | minor | Same-name links differ in purpose | `identical-links-same-purpose` | axe | suggestion |
| 1.1.1 | critical | Image missing alternative text | `image-alt` | axe | failure / review |
| — | minor | Alt text repeats visible text | `image-redundant-alt` | axe | suggestion |
| 4.1.2 | critical | Input button missing text | `input-button-name` | axe | failure / review |
| 1.1.1, 4.1.2 | critical | Image button missing alt text | `input-image-alt` | axe | failure / review |
| 4.1.2 | critical | Form element missing a label | `label` | axe | failure / review |
| 2.5.3 | serious | Accessible name omits visible text | `label-content-name-mismatch` | axe | failure / review |
| — | serious | Label is not visible | `label-title-only` | axe | suggestion |
| — | moderate | Banner nested in landmark | `landmark-banner-is-top-level` | axe | suggestion |
| — | moderate | Aside nested in landmark | `landmark-complementary-is-top-level` | axe | suggestion |
| — | moderate | Contentinfo nested in landmark | `landmark-contentinfo-is-top-level` | axe | suggestion |
| — | moderate | Main nested in landmark | `landmark-main-is-top-level` | axe | suggestion |
| — | moderate | Multiple banner landmarks present | `landmark-no-duplicate-banner` | axe | suggestion |
| — | moderate | Multiple contentinfo landmarks present | `landmark-no-duplicate-contentinfo` | axe | suggestion |
| — | moderate | Multiple main landmarks present | `landmark-no-duplicate-main` | axe | suggestion |
| — | moderate | Page missing main landmark | `landmark-one-main` | axe | suggestion |
| — | moderate | Landmarks not uniquely identified | `landmark-unique` | axe | suggestion |
| 1.4.1 | serious | Link distinguishable only by color | `link-in-text-block` | axe | failure / review |
| 2.4.4, 4.1.2 | serious | Link missing discernible text | `link-name` | axe | failure / review |
| 1.3.1 | serious | Invalid list markup structure | `list` | axe | failure / review |
| 1.3.1 | serious | li not inside ul/ol | `listitem` | axe | failure / review |
| 2.2.2 | serious | Deprecated marquee element used | `marquee` | axe | failure / review |
| 2.2.1 | critical | Page auto-refreshes under 20 hours | `meta-refresh` | axe | failure / review |
| 2.2.4, 3.2.5 | minor | Page uses delayed refresh | `meta-refresh-no-exceptions` | axe | suggestion |
| 1.4.4 | moderate | Zooming and scaling disabled | `meta-viewport` | axe | failure / review |
| — | minor | Cannot zoom text to 500% | `meta-viewport-large` | axe | suggestion |
| 4.1.2 | serious | Interactive controls are nested | `nested-interactive` | axe | failure / review |
| 1.4.2 | moderate | Audio or video autoplays | `no-autoplay-audio` | axe | failure / review |
| 1.1.1 | serious | Object missing alternative text | `object-alt` | axe | failure / review |
| 1.3.1 | serious | Paragraph styled as heading | `p-as-heading` | axe | failure / review |
| — | moderate | Page missing level-one heading | `page-has-heading-one` | axe | suggestion |
| — | minor | Presentational role inconsistently ignored | `presentation-role-conflict` | axe | suggestion |
| — | moderate | Content outside any landmark | `region` | axe | suggestion |
| 1.1.1 | serious | role=img missing alt text | `role-img-alt` | axe | failure / review |
| — | moderate | Incorrect table scope attribute | `scope-attr-valid` | axe | suggestion |
| 2.1.1, 2.1.3 | serious | Scrollable region not keyboard accessible | `scrollable-region-focusable` | axe | failure / review |
| 4.1.2 | critical | Select missing accessible name | `select-name` | axe | failure / review |
| 2.1.1 | minor | Server-side image map used | `server-side-image-map` | axe | failure / review |
| — | moderate | Skip link target missing | `skip-link` | axe | suggestion |
| 4.1.2 | serious | Summary element missing text | `summary-name` | axe | failure / review |
| 1.1.1 | serious | SVG image missing alt text | `svg-img-alt` | axe | failure / review |
| — | serious | Positive tabindex value used | `tabindex` | axe | suggestion |
| — | minor | Table summary duplicates caption | `table-duplicate-name` | axe | suggestion |
| 1.3.1 | serious | Data cell used as caption | `table-fake-caption` | axe | failure / review |
| 2.5.8 | serious | Touch target too small | `target-size` | axe | failure / review |
| 1.3.1 | critical | Data cell missing header | `td-has-header` | axe | failure / review |
| 1.3.1 | serious | headers attribute references wrong cell | `td-headers-attr` | axe | failure / review |
| 1.3.1 | serious | Header not referencing data cells | `th-has-data-cells` | axe | failure / review |
| 3.1.2 | serious | Invalid lang attribute value | `valid-lang` | axe | failure / review |
| 1.2.2 | critical | Video missing captions | `video-caption` | axe | failure / review |

## AbleDOM rules

| WCAG SC | Severity | Description | Rule id | Method | Kind |
|---|---|---|---|---|---|
| 4.1.2, 2.4.6 | serious | Focusable element has no label | `focusable-element-label` | AbleDOM | failure |
| 4.1.2 | serious | Focusable element nested in control | `focusable-in-atomic` | AbleDOM | failure |
| 1.4.3 | serious | Insufficient text contrast | `contrast` | AbleDOM | failure |
| 1.3.1, 4.1.2 | serious | ARIA reference targets missing id | `missing-id` | AbleDOM | failure |
| 2.4.3, 2.1.1 | serious | Keyboard focus lost on change | `focus-lost` | AbleDOM | failure |
| 2.4.7, 2.4.3 | serious | Focus moved to invisible element | `bad-focus` | AbleDOM | failure |
| 1.3.1 | serious | Missing required ARIA parent | `aria-required-parent` | AbleDOM | failure |
| 4.1.2 | serious | Interactive controls are nested | `nested-interactive` | AbleDOM | failure |
| 2.4.3 | moderate | Positive tabindex used | `tabindex` | AbleDOM | review |
| — | minor | tabindex on non-interactive element | `tabindex-non-interactive` | AbleDOM | suggestion |

## Custom Playwright checks

| WCAG SC | Severity | Description | Rule id | Method | Kind |
|---|---|---|---|---|---|
| 2.4.3 | serious | Focus not moved into dialog | `focus-not-moved-into-dialog` | Playwright | failure |
| 2.4.3 | moderate | Focus not moved into a non-modal overlay (popover, menu, drawer, non-modal dialog) on open | `initial-focus-outside-overlay` | Playwright | review |
| 2.4.7 | serious | No visible focus indicator | `focus-not-visible` | Playwright | failure |
| 2.1.2 | critical | Keyboard focus is trapped | `keyboard-trap` | Playwright | failure |
| 2.4.3 | serious | Focus leaves modal dialog | `focus-escapes-modal` | Playwright | failure |
| 2.4.11 | serious | Focused element fully hidden | `focus-obscured` | Playwright | failure |
| 2.4.12 | minor | Focused element partly hidden | `focus-partially-obscured` | Playwright | suggestion |
| 2.1.1 | serious | Interactive element not focusable | `not-keyboard-focusable` | Playwright | failure |
| — | moderate | Escape does not close overlay | `escape-does-not-close` | Playwright | suggestion |
| 2.4.3 | serious | Focus lost when overlay closes | `focus-not-restored` | Playwright | failure |
| — | moderate | Focus not returned to trigger | `focus-not-returned-to-trigger` | Playwright | suggestion |
| 1.4.10 | serious | Horizontal scroll at 320px | `reflow-horizontal-scroll` | Playwright | failure |
| 1.4.12 | moderate | Text clipped with text spacing | `text-spacing-clipping` | Playwright | review |

## Screen reader checks (Guidepup)

From [`skills/screen-reader-validation`](skills/screen-reader-validation/SKILL.md): journeys replayed with NVDA (Windows) or VoiceOver (macOS) through [Guidepup](https://www.guidepup.dev/); the narration is compared with the DOM changes. Logic: [heuristics.md](skills/screen-reader-validation/references/heuristics.md). The Kind column is the ceiling: a failure is reported as review when the evidence is uncertain (speech capture unavailable or the reader not aligned to the page, a partial text match, a non-modal dialog, an error inferred only from an id/class).

| WCAG SC | Severity | Description | Rule id | Method | Kind |
|---|---|---|---|---|---|
| 4.1.2 | serious | Focused element announced as "blank" or unlabelled | `sr-blank-announcement` | Guidepup | failure |
| 4.1.2 | serious | Control announced without a name | `sr-control-without-name` | Guidepup | failure |
| 4.1.2 | serious | Focusable element announced without a role | `sr-missing-role` | Guidepup | failure |
| 4.1.2 | moderate | Expanded/pressed/checked/selected state not announced | `sr-missing-state` | Guidepup | failure |
| 4.1.2 | serious | Dialog opened without being announced | `sr-dialog-not-announced` | Guidepup | failure / review |
| 2.4.3 | serious | Focus not moved into the opened dialog (review for non-modal dialogs) | `sr-focus-not-in-dialog` | Guidepup | failure / review |
| 2.4.3 | moderate | Focus not returned after the dialog closed | `sr-focus-not-returned` | Guidepup | failure / review |
| 4.1.3 | serious | Status message not announced | `sr-status-not-announced` | Guidepup | failure / review |
| 3.3.1, 4.1.3 | serious | Validation error not announced (review when inferred from an id/class) | `sr-error-not-announced` | Guidepup | failure / review |
| 4.1.2 | moderate | Action produced no announcement | `sr-silent-action` | Guidepup | review |
| 2.4.3 | moderate | Navigation produced no announcement (failure, 2.4.2, when the page has no title) | `sr-silent-navigation` | Guidepup | review / failure |
| — | minor | Duplicated announcement | `sr-duplicate-announcement` | Guidepup | suggestion |
| — | minor | Very long announcement (over 160 characters) | `sr-verbose` | Guidepup | suggestion |
| 1.1.1 | minor | Emoji or icon-font glyph in the announcement | `sr-symbol-noise` | Guidepup | suggestion |
| 1.3.2 | moderate | Reading order differs from visual order | `sr-reading-order` | Guidepup | review |
| 2.4.1 | moderate | No main landmark | `sr-no-landmarks` | Guidepup | review |
| 1.3.1 | moderate | No headings | `sr-no-headings` | Guidepup | review |
| — | moderate | Element not found with reader navigation (point to verify) | `srnav-not-reachable` | Guidepup | review |
| — | moderate | Headings/landmarks exist but none announced | `srnav-no-semantic-nav` | Guidepup | review |
| — | minor | Browse mode could not be confirmed while reading | `srnav-focus-mode-required` | Guidepup | review |
| — | minor | Editable field autofocused, reader starts in focus mode | `sr-autofocus-focus-mode` | Guidepup | suggestion |

## Interaction modality checks

Journeys can declare how they must be operated: `keyboard` (Tab, Shift+Tab, arrows, Enter, Space; mouse banned until the agent is stuck), `mouse`, `sr-keyboard` (same keys through a screen reader) and `sr-navigation` (keys plus reader navigation; reader-specific failures are reviews). Needing a mouse or a programmatic focus move is a failure with repro, screenshot and fix. WCAG numbers name the criteria a barrier is potentially relevant to. Source `modality`, run by [`accessibility-assessment`](skills/accessibility-assessment/references/modalities.md) (`--modality keyboard`) and by `screen-reader-validation` (`--modality sr-keyboard`). Touch is never automated.

| WCAG SC | Severity | Description | Rule id | Method | Kind |
|---|---|---|---|---|---|
| 2.1.1 | critical | Step can only be completed with a mouse | `kbd-mouse-required` | Playwright | failure |
| 2.1.1, 2.4.3 | serious | Reachable only by moving focus programmatically | `kbd-programmatic-focus` | Playwright | failure |
| 2.1.1 | serious | Interactive element cannot receive focus | `kbd-not-focusable` | Playwright | failure |
| 2.1.2 | critical | Keyboard focus trapped | `kbd-trap` | Playwright | failure |
| 2.1.1 | serious | Enter/Space does not activate the focused control | `kbd-no-activation` | Playwright | failure |
| 2.1.1 | serious | Composite widget items not reachable with arrows (catalogued, not emitted yet) | `kbd-composite-no-arrows` | Playwright | failure |
| 2.4.3 | moderate | Focus lost after activation (catalogued, not emitted yet) | `kbd-focus-lost` | Playwright | review |
| — | moderate | Content may be hover-only | `kbd-hover-only` | Playwright | review |
| — | moderate | A script was needed to continue the journey | `kbd-programmatic-intervention` | Playwright | review |
| — | moderate | Press limit reached, inconclusive | `kbd-search-inconclusive` | Playwright | review |
| — | moderate | Activation produced no observable change | `kbd-activation-unobserved` | Playwright | review |
| — | moderate | Step skipped for this modality | `kbd-step-skipped` | Playwright | review |
| — | minor | Navigation relies on keys outside the allowed set | `kbd-nonstandard-key` | Playwright | suggestion |
| — | minor | Editable field takes focus on load (catalogued, not emitted yet) | `kbd-unexpected-autofocus` | Playwright | suggestion |

## Agent (manual review) checks

| WCAG SC | Severity | Description | Rule id | Method | Kind |
|---|---|---|---|---|---|
| 2.1.1 | — | Missing required keyboard support | `apg-keyboard-support` | Agent | failure |
| 4.1.2 | — | Wrong or missing ARIA state | `apg-role-state` | Agent | failure |
| — | — | Optional APG pattern behaviour missing | `apg-optional-behaviour` | Agent | suggestion |
| 1.3.2, 2.4.3 | — | Tab order skips reading order | `tab-order-reading-order` | Agent | review |
| 1.4.1 | — | State shown by color alone | `color-only-state` | Agent | review |
| 1.4.3 | — | Text over image low contrast | `text-on-image-contrast` | Agent | review |
| 1.4.5 | — | Image used instead of text | `image-of-text` | Agent | review |
| 1.4.11 | — | Borders or icons low contrast | `non-text-contrast` | Agent | review |
| 2.4.6 | — | Heading or label not descriptive | `ambiguous-heading-label` | Agent | review |
| 2.4.7 | — | Focus indicator missing in theme | `focus-indicator-per-theme` | Agent | review |
| 1.3.4 | — | Content locked to one orientation | `orientation-lock` | Agent | review |
| 1.4.4 | — | Clipping at 200 percent zoom | `text-resize-clipping` | Agent | review |
| 1.4.13 | — | Tooltip not dismissible or hoverable | `tooltip-dismiss-hover` | Agent | review |
| 2.1.4 | — | Single-key shortcut not remappable | `character-key-shortcut` | Agent | review |
| 2.5.1, 2.5.7 | — | Drag action lacks button alternative | `drag-pointer-alternative` | Agent | review |
| 3.2.1, 3.2.2 | — | Focus or input changes context | `unexpected-context-change` | Agent | review |
| 3.3.1, 3.3.3 | — | Error not named or suggested | `error-identification-suggestion` | Agent | review |
| 4.1.3 | — | Status update not announced | `status-not-announced` | Agent | review |
| 2.4.2 | — | Page title not descriptive | `page-title-not-distinct` | Agent | review |
| 2.4.5 | — | Only one way to page | `single-navigation-path` | Agent | review |
| 3.2.3 | — | Navigation order changes between pages | `inconsistent-navigation-order` | Agent | review |
| 3.2.4 | — | Same control named differently | `inconsistent-control-identification` | Agent | review |
| 3.2.6 | — | Help location changes between pages | `inconsistent-help-location` | Agent | review |
| 3.3.7 | — | Flow asks for data twice | `repeated-input-request` | Agent | review |

## Manual-only criteria (no rule)

Criteria with no automated or catalogued rule. `#n` refers to a row in [`new-tools.md`](new-tools.md).

### Level A / AA

| WCAG SC | Description | Method | Proposed tool |
|---|---|---|---|
| 1.2.3 | Audio description alternative | Manual | #15 |
| 1.2.4 | Live captions | Manual | #15 |
| 1.2.5 | Audio description prerecorded | Manual | #15 |
| 1.3.3 | Sensory characteristics | Agent | — |
| 2.3.1 | Three flashes threshold | Manual | #10 |
| 2.5.2 | Pointer cancellation | Manual | #7 |
| 2.5.4 | Motion actuation | Manual | — |
| 3.3.4 | Error prevention confirmations | Agent | #9 |
| 3.3.8 | Accessible authentication minimum | Agent | #13 |

### Level AAA (suggestions only)

| WCAG SC | Description | Method | Proposed tool |
|---|---|---|---|
| 1.2.6 | Sign language prerecorded | Manual | — |
| 1.2.7 | Extended audio description | Manual | — |
| 1.2.8 | Media alternative prerecorded | Manual | #15 |
| 1.2.9 | Audio-only live alternative | Manual | #15 |
| 1.3.6 | Identify purpose | Agent | — |
| 1.4.7 | Low background audio | Manual | — |
| 1.4.8 | Visual presentation | Agent | — |
| 1.4.9 | Images of text | Agent | — |
| 2.2.3 | No timing | Manual | #10 |
| 2.2.5 | Re-authenticating | Manual | — |
| 2.2.6 | Timeouts | Manual | #10 |
| 2.3.2 | Three flashes | Manual | #10 |
| 2.3.3 | Animation from interactions | Manual | #10 |
| 2.4.8 | Location | Agent | — |
| 2.4.10 | Section headings | Agent | — |
| 2.4.13 | Focus appearance | Agent | #14 |
| 2.5.5 | Target size enhanced | Agent | — |
| 2.5.6 | Concurrent input mechanisms | Manual | — |
| 3.1.3 | Unusual words | Agent | — |
| 3.1.4 | Abbreviations | Agent | — |
| 3.1.5 | Reading level | Agent | — |
| 3.1.6 | Pronunciation | Agent | — |
| 3.3.5 | Context-sensitive help | Agent | — |
| 3.3.6 | Error prevention all | Agent | #9 |
| 3.3.9 | Accessible authentication enhanced | Agent | #13 |
