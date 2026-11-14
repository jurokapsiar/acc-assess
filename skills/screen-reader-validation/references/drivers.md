# Drivers

A driver adapts one screen reader to the replay loop in `scripts/lib/session.mjs`. Selection:
`--reader nvda|voiceover|mock` (`dry-run` = `mock`); default by OS: `win32` → `nvda`,
`darwin` → `voiceover`, anything else → `mock` (`scripts/lib/drivers/index.mjs`).

## How Guidepup records speech (and why it matters)

Guidepup's `spokenPhraseLog()` is **not** a passive transcript of everything the reader says.
Speech is only recorded while a command runs through Guidepup's queue (`press`, `perform`,
`next`, `nextHeading`, …, or `capture(fn)` for actions Guidepup doesn't perform itself), and only
fully when that command's `capture` option is `true` (Guidepup's default is `"initial"`: first
phrase only). Consequently the drivers:

- start the reader with `start({ capture: true })`;
- run every Playwright action (click, fill, focus, goto, …) **inside** `sr.capture(fn, { capture:
  true })`, and every key press as `sr.press(key, { capture: true })`;
- **drain** the log (read, then clear) and never clear it unread: phrases already in the log when
  the next action starts are returned as `pre` and stored as the previous step's **late**
  phrases;
- return `{ pre, phrases, health, error? }` and never throw for an action failure, so the speech
  a failing action caused is kept.

`health` per step: `captured` (inside Guidepup capture), `unavailable` (the installed Guidepup has
no `capture()`: the action ran but speech could not be recorded), `simulated` (mock), and
`unaligned` (set by the session when the reader could not be verified to be in the page). The
analyser downgrades failures on steps without `captured`/`simulated` health to `review`.

## Interface

| Member | Purpose |
|---|---|
| `name`, `label`, `kind` (`real` \| `mock`), `settleMs` | Identity; `settleMs` is the wait after each action before reading the log (`--settle` overrides). NVDA 1200 ms, VoiceOver 1500 ms, mock 100 ms. |
| `start()` / `stop()` | Start/stop the reader with full capture. `stop()` errors are recorded in `results.cleanupErrors`. |
| `attach(page)` | Per-page setup before navigation (the mock installs its speech synthesiser). |
| `align(page)` | Bring the reader into the page's web content after a navigation; returns the preparation phrases (`prep`) and **throws** when alignment can't be verified (the journey becomes `blocked`). |
| `capture(fn, {settle})` | Run an external action inside the capture window → `{ pre, phrases, health, error? }`. |
| `keys(keys, {settle})` | OS key presses through the reader (`press('Tab')`); CDP key events never reach a screen reader. Same result shape. |
| `take()` | Read-and-clear phrases recorded since the last read. |
| `probe(page, kind, {cap})` | `headings` \| `landmarks` \| `reading` sweep → `{ items: [{text}], termination, commands, error? }`. |
| `readerMode(page)` / `ensureBrowseMode(page)` | `{ mode: browse\|focus\|unknown, confidence }`; the latter confirms browse mode (see NVDA below) and never guesses. |

Probe `termination`: `end` (an end message such as "no next heading", "bottom", "end of …", or
silence after at least one item), `cap` (stopped at the item cap), `repeat` (the same text three
times in a row — two consecutive identical items are legitimate), `silent` (nothing spoken at
all), `unsupported` (the reader has no such command), `error`. The analyser ignores
`unsupported`/`error` sweeps and silent sweeps with no items.

## NVDA (Windows) — `drivers/nvda.mjs`

- Package: `@guidepup/guidepup` (optional dependency of this skill); NVDA support is in the main
  package.
- Guidepup drives a **portable NVDA** with its add-on. The exact version is listed in the
  installed `@guidepup/guidepup/manifest.json`; the user downloads it once with
  `npx @guidepup/setup install nvda` (run from the skill dir so the matching manifest is used) to
  `%LOCALAPPDATA%\guidepup\nvda\all\<version>\extracted\nvda.exe` (override the cache with
  `GUIDEPUP_SCREEN_READERS_PATH`). Admin rights are not required. Preflight checks that exact
  path.
- If the user's own NVDA is running, Guidepup stops it during the run and restarts it after.
  Guidepup keeps its portable NVDA configuration in its cache, outside the run dir.
- Needs an **interactive, unlocked desktop** (console or RDP; not a service/SSH session — not
  verifiable by preflight), a **headed** browser in the foreground and no user input during the
  run.
- `align` is a **verified foreground check that fails closed**: `bringToFront`, then up to 5
  `reportTitle` attempts until the spoken title contains the page title (or the browser name for an
  untitled page); otherwise it throws `code: 'foreground-not-verified'` (journey `blocked`). It
  never sends Alt+Escape, never toggles the mode and never clicks or focuses the app.
- `ensureBrowseMode(page)` / `readerMode(page)`: the mode is the last "browse/focus mode"
  announcement, else inferred from editable DOM focus, else `unknown`. NVDA+Space toggles, so the
  toggle is sent only when the mode is known not to be browse and is accepted only if "browse
  mode" is then announced; otherwise `{ mode: 'unknown' }` and browse-mode probes are not run.
  Called before probes and `sr-navigation` read steps, never before typing. Never uses Escape.
- Probe commands: `moveToTop` (or `Control+Home`), `nextHeading` (H), `nextLandmark` (D),
  `next` (Down Arrow).

## VoiceOver (macOS) — `drivers/voiceover.mjs`

- macOS 12+. The user runs `npx @guidepup/setup install voiceover` (the preferences DMG for the
  current Darwin version: `~/Library/Caches/guidepup/voiceover/<darwin major>/<version>/<asset>`)
  and, once, `npx @guidepup/setup` (machine setup: AppleScript control of VoiceOver), or enables
  VoiceOver Utility → General → "Allow VoiceOver to be controlled with AppleScript". Preflight
  checks the DMG and the AppleScript flag; it never changes them.
- The terminal/IDE running Node needs **Accessibility** and **Automation** (VoiceOver, System
  Events) in System Settings → Privacy & Security. These cannot be verified; preflight lists them
  as `info`. Never suggest disabling SIP.
- **Start order**: Guidepup's `voiceOver.keyboardCommands` getter throws until VoiceOver is
  running, so the driver calls `start()` before reading it.
- `align` ports `@guidepup/playwright`'s VoiceOver flow: activate the browser by bundle id
  (`macOSActivate`), `Control`, `Escape`, open the item chooser until VoiceOver says "item
  chooser" (max 10; otherwise throw), type "web content", Enter, `interact()`.
- Probe commands: `moveToAreaTop`, `nextHeading` (findNextHeading), `nextLandmark` (VoiceOver
  "web spots" — the closest available command; `unsupported` when absent), `next` (VO-Right).

## Mock — `drivers/mock.mjs`

No screen reader. `inpage.mjs` installs a synthesiser that speaks NVDA-like phrases on: document
load (`"<title> document"`), `focusin` (`"<name> <role> <states>"`), focus entering a dialog
(`"<name> dialog"`), state attribute changes, and text changes of live regions that existed
before the change. It follows the same `{ pre, phrases, health: 'simulated' }` contract so the
pipeline (replay → analyse → report) is testable in CI; results carry `simulated: true` and the
report says so. Never report mock narration as evidence.

## Browser

Chromium from the sibling skill's Playwright install (or `--channel chrome|msedge`). Real
readers always launch **headed**; the mock is headless unless `--headed`. The `--channel` also
tells the driver which window/app name to look for when aligning to web content.

## Why not `@guidepup/playwright`

It provides Playwright Test fixtures (`nvdaTest`, `voiceOverTest`). This skill replays journeys
from a CLI rather than from a test runner, so it uses `@guidepup/guidepup` directly and ports the
small "navigate to web content" helpers into the drivers (minus any action on the app itself).

## Tests

`tests/drivers.test.mjs` runs both real drivers against a fake Guidepup that only records speech
inside queued commands and whose VoiceOver `keyboardCommands` throws before `start()`; it checks
capture around external actions, `pre`/late phrases, error handling, key mapping, start order,
alignment failure and every probe termination. Real-reader behaviour (timing, alignment, end
messages) still needs a run on a real machine.
