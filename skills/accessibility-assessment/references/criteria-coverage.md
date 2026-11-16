# Criteria coverage (WCAG 2.2 A + AA)

Which part of the toolchain can detect failures for each success criterion.

**Legend:**
- **axe**: axe-core rules (static, scoped).
- **AbleDOM**: real-time DOM/focus monitoring.
- **kbd**: keyboard walk.
- **ovl**: overlay Escape/focus-return check.
- **reflow**: 320 px reflow.
- **ts**: text-spacing.
- **agent**: agent review with screenshots, Playwright interaction and APG patterns (see [manual-review.md](manual-review.md)).
- **manual**: needs a human or tooling we don't have yet (see `new-tools.md` in the repository root).

Automated detection is partial everywhere. A criterion with no findings is reported as *No issues detected*, never as *Pass*.

| SC | Level | Automated | Agent / manual |
|---|---|---|---|
| 1.1.1 Non-text Content | A | axe (image-alt, svg-img-alt, role-img-alt …) | agent: alt quality, decorative vs. informative |
| 1.2.1–1.2.5 Time-based media | A/AA | axe (audio-caption, video-caption: presence only) | manual: caption/description accuracy |
| 1.3.1 Info and Relationships | A | axe (lists, tables, required parent/children), AbleDOM (required parent, missing ids) | agent: visual headings/groups without semantics |
| 1.3.2 Meaningful Sequence | A | | agent: DOM order vs. visual order (tab-order screenshot) |
| 1.3.3 Sensory Characteristics | A | | agent: instructions relying on shape, color, position |
| 1.3.4 Orientation | AA | axe (css-orientation-lock) | agent: landscape/portrait viewport |
| 1.3.5 Identify Input Purpose | AA | axe (autocomplete-valid: validity only) | agent: missing autocomplete on personal-data fields |
| 1.4.1 Use of Color | A | axe (link-in-text-block) | agent: color-only state, errors, charts |
| 1.4.2 Audio Control | A | axe (no-autoplay-audio) | |
| 1.4.3 Contrast (Minimum) | AA | axe (color-contrast; *incomplete* → review) | agent: text over images/gradients |
| 1.4.4 Resize Text | AA | axe (meta-viewport) | manual: 200 % text zoom |
| 1.4.5 Images of Text | AA | | agent: screenshots |
| 1.4.10 Reflow | AA | reflow | agent: content lost at 320 px |
| 1.4.11 Non-text Contrast | AA | | agent: borders, icons, focus rings, states |
| 1.4.12 Text Spacing | AA | axe (avoid-inline-spacing), ts (clipping → review) | agent: confirm overlap/clipping |
| 1.4.13 Content on Hover or Focus | AA | | agent: tooltips/popovers dismissible, hoverable, persistent |
| 2.1.1 Keyboard | A | axe (scrollable-region-focusable …), kbd (unreachable roles) | agent: APG keyboard interaction |
| 2.1.2 No Keyboard Trap | A | kbd | |
| 2.1.4 Character Key Shortcuts | A | | agent: single-key shortcuts |
| 2.2.1 Timing Adjustable | A | axe (meta-refresh) | manual: session timeouts, auto-dismiss toasts |
| 2.2.2 Pause, Stop, Hide | A | axe (blink, marquee) | agent: carousels, animations, auto-updating content |
| 2.3.1 Three Flashes | A | | manual |
| 2.4.1 Bypass Blocks | A | axe (bypass) | agent: skip link works |
| 2.4.2 Page Titled | A | axe (document-title) | agent: title is descriptive and changes with the view |
| 2.4.3 Focus Order | A | kbd (dialog focus, escaping a modal), ovl (focus return), AbleDOM (focus lost) | agent: logical order (tab-order screenshot) |
| 2.4.4 Link Purpose | A | axe (link-name) | agent: ambiguous link text |
| 2.4.5 Multiple Ways | AA | | agent: across the inventory (nav + search/sitemap) |
| 2.4.6 Headings and Labels | AA | AbleDOM (focusable label) | agent: descriptive headings/labels |
| 2.4.7 Focus Visible | AA | kbd (pixel diff), AbleDOM (focus on hidden element) | agent: indicator visible in all themes |
| 2.4.11 Focus Not Obscured | AA | kbd (sticky/fixed overlap) | |
| 2.5.1 Pointer Gestures | A | | agent: multipoint/path gestures have alternatives |
| 2.5.2 Pointer Cancellation | A | | manual: down-event activation |
| 2.5.3 Label in Name | A | axe (label-content-name-mismatch) | agent: icon buttons with tooltips |
| 2.5.4 Motion Actuation | A | | manual |
| 2.5.7 Dragging Movements | AA | | agent: drag-and-drop, sliders and splitters have single-pointer alternatives |
| 2.5.8 Target Size (Minimum) | AA | axe (target-size) | |
| 3.1.1 Language of Page | A | axe (html-has-lang, html-lang-valid) | |
| 3.1.2 Language of Parts | AA | axe (valid-lang) | agent: untagged foreign-language content |
| 3.2.1 On Focus | A | | agent: kbd walk screenshots show no context change |
| 3.2.2 On Input | A | | agent: changing selects/radios doesn't navigate unexpectedly |
| 3.2.3 Consistent Navigation | AA | | agent: compare screens in the inventory |
| 3.2.4 Consistent Identification | AA | | agent: same function, same name across screens |
| 3.2.6 Consistent Help | A | | agent: help location across screens |
| 3.3.1 Error Identification | A | | agent: error states (inventory states) |
| 3.3.2 Labels or Instructions | A | axe (label, form-field-multiple-labels) | agent: format hints, required markers |
| 3.3.3 Error Suggestion | AA | | agent: error text suggests a fix |
| 3.3.4 Error Prevention | AA | | agent: confirm/undo for legal, financial and data actions |
| 3.3.7 Redundant Entry | A | | agent: multi-step flows |
| 3.3.8 Accessible Authentication | AA | | agent: paste allowed, no cognitive tests |
| 4.1.2 Name, Role, Value | A | axe (aria-*, button-name, nested-interactive …), AbleDOM (labels, nested/atomic focusables) | agent: APG roles/states/properties |
| 4.1.3 Status Messages | AA | | agent: live regions for toasts, validation, loading |

4.1.1 Parsing is obsolete in WCAG 2.2 and is ignored.
