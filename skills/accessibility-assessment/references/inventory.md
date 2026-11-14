# Inventory schema

`.a11y/inventory.json` in the target app. It maps the app into **features → screens → states** so any subset can be assessed reproducibly.

```jsonc
{
  "app": {
    "name": "Acme portal",
    "baseUrl": "http://localhost:5173/",
    "start": "npm run dev",                     // informational: how to start the app
    "axeExclude": ["#third-party-chat"],        // optional: CSS selectors axe should skip
    "sourceRoot": "..",                          // optional: base dir source paths are relative to (default: app root)
    "sourceAttrs": ["data-qa-source"]            // optional: extra data-attribute names to probe first for source tracking
  },
  "viewports": {                                // first one is the default
    "desktop": { "width": 1280, "height": 800 },
    "mobile":  { "width": 390, "height": 844, "isMobile": true, "hasTouch": true }
  },
  "features": [
    {
      "id": "appearance",                       // unique
      "name": "Appearance",
      "description": "Theme switcher in the header",
      "source": ["src/theme/ThemeMenu.tsx"],
      "states": [                               // feature-wide states other screens can require
        { "id": "dark", "name": "Dark theme", "steps": [
          { "action": "click", "target": { "role": "button", "name": "Theme" } },
          { "action": "click", "target": { "role": "menuitemradio", "name": "Dark" } }
        ] }
      ],
      "screens": []
    },
    {
      "id": "projects",
      "name": "Projects",
      "source": ["src/projects/"],
      "screens": [
        {
          "id": "project-list",                 // globally unique
          "name": "Project list",
          "type": "page",
          "url": "/projects",                   // resolved against app.baseUrl
          "ready": { "role": "heading", "name": "Projects", "level": 1 },
          "patterns": ["grid", "menu-button"], // APG slugs (knowledge/apg/index.md)
          "source": ["src/projects/ProjectList.tsx"],
          "cut": "#projects-grid",              // optional: selector cropped for the Scope view (default: scope, else first viewport)
          "states": [
            { "id": "dark", "name": "Dark theme", "requires": ["appearance.dark"] },
            { "id": "empty", "name": "No projects", "steps": [
              { "action": "localStorage", "key": "projects", "value": "[]" },
              { "action": "reload" }
            ] },
            { "id": "reduced-motion", "name": "Reduced motion", "emulate": { "reducedMotion": "reduce" } }
          ]
        },
        {
          "id": "new-project-dialog",
          "name": "New project dialog",
          "type": "dialog",
          "modal": true,                        // false for non-modal dialogs/popovers
          "parent": "project-list",             // opened from this screen
          "steps": [{ "action": "click", "target": { "role": "button", "name": "New project" } }],
          "ready": { "role": "dialog", "name": "New project" },
          "scope": "[role=dialog][aria-label=\"New project\"]",   // must match exactly one element; limits axe and the keyboard walk, and filters AbleDOM focus events
          "trigger": { "role": "button", "name": "New project" },   // optional: focus-return check; also highlighted as a "subscreen" area on the parent's Scope screenshot
          "patterns": ["dialog-modal"],
          "source": ["src/projects/NewProjectDialog.tsx"],
          "states": [
            { "id": "validation-error", "name": "Empty name error", "steps": [
              { "action": "click", "target": { "role": "button", "name": "Create" } }
            ] }
          ]
        }
      ]
    }
  ]
}
```

## How a target is reached

A target is a screen × state × viewport, with the key `<screen>__<state>__<viewport>`. Its plan is:

1. `goto` the root screen's `url` (or `app.baseUrl`).
2. Steps of every feature state in `state.requires`, in order (after the root's `ready` wait, when the root has no steps of its own).
3. For each screen from the root to the target, along `parent` links: its own `url` if it isn't the root, then its `steps`, then wait for its `ready`.
4. The state's own `steps`.

States aren't inherited. `--state dark` selects only screens that declare a `dark` state, so a child dialog that should be assessed in dark mode declares its own:

```jsonc
{ "id": "dark", "name": "Dark theme", "requires": ["theme.dark"] }
```

`state.emulate` sets Playwright context options, for example `colorScheme`, `reducedMotion`, `forcedColors`, `locale` or `timezoneId`. Every screen has an implicit `default` state.

## Locators (`target`, `ready`, `trigger`, `within`)

| Key | Playwright | Example |
|---|---|---|
| `role` + `name` (+ `exact`, `level`) | `getByRole` | `{ "role": "tab", "name": "Billing" }` |
| `label` | `getByLabel` | `{ "label": "E-mail" }` |
| `text` | `getByText` | `{ "text": "Delete this item?" }` |
| `placeholder` | `getByPlaceholder` | |
| `testId` | `getByTestId` | |
| `selector` | `locator` | `{ "selector": "#main nav" }` |
| `within` | scope another locator | `{ "role": "button", "name": "Edit", "within": { "role": "row", "name": "/Alpha/" } }` |
| `nth` | nth match (default: first) | |

A string of the form `"/pattern/flags"` becomes a RegExp. Prefer role + name: it's stable, and it checks that the accessible name exists.

## Step actions

| Action | Fields |
|---|---|
| `goto` | `url` |
| `reload` | |
| `click`, `dblclick`, `hover`, `focus`, `check`, `uncheck` | `target` |
| `fill`, `type` | `target`, `value` |
| `select` | `target`, `value` |
| `press` | `key`, optional `target`, `times` |
| `wait` | `ms` |
| `waitFor` | `target`, `state` (`visible`, `hidden`, `attached`, `detached`) |
| `evaluate` | `script` (JavaScript expression evaluated in the page), `description` |
| `emulate` | media features: `colorScheme`, `reducedMotion`, `forcedColors`, `contrast` |
| `localStorage` | `key`, `value` |

Every step accepts `description` (replaces the generated repro text) and `settle` (ms to wait afterwards, default 150).

## Screen types

`page` and `view` are full pages, so their keyboard walk starts at the top. `dialog`, `popover`, `menu` and `drawer` are overlays: they get the overlay check, and their keyboard walk starts from the focus after opening. `panel`, `toast` and `other` are regions of a page.

## Optional fields

| Field | On | Meaning |
|---|---|---|
| `screen.cut` | screen | CSS selector cropped for that screen's view in the report's Scope section. Defaults to `scope` (for overlays), else the first viewport's full screenshot. Use it to crop to a meaningful region of a large page |
| `app.sourceAttrs` | app | Extra data-attribute names a dev-inspector bundler plugin writes (checked before the built-in probes). See [references/source-tracking.md](source-tracking.md) |
| `app.sourceRoot` | app | Path, relative to the app root, that source file paths in findings (`node.source.file`) are reported relative to. Only used when source tracking is enabled (`--source auto`, the default) |
| `app.storageState` | app | Path (relative to this file's directory) to a Playwright storage-state JSON for authenticated apps, used for every `browser.newContext` unless `--storage-state` overrides it. Path only — never commit the file itself; keep it under `.a11y/auth/` and gitignored |
| `screen.provenance` / `state.provenance` | screen, state | Set by `scope.mjs merge` (`skills/scope-definition`) on entities it adds: `{ scope, producer, at }`. Informational only — ignored by validation and plan building, not part of `planHash` |

## Maintenance rules

- Ids are stable kebab-case. Don't rename them, because reports and annotations reference them.
- When a feature is added, add its screens, overlays and the states that change rendering (errors, empty, expanded, selected, theme).
- When UI is removed, delete its entries. `inventory verify` flags anything unreachable.
- Keep `source` paths current. Agents use them to locate fixes.
