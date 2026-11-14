# Source tracking

`assess.mjs --source auto` (the default) resolves each finding node back to the file and line
it came from, with no changes required in the target app. Every finding node gets a `source`
object: `{ via, file, line, column, component, chain, unresolved }`. `--source off` skips this
entirely (slightly faster, no `node.source`).

## Probe order

For each node, walk up to 8 ancestors from the element itself, first hit wins:

1. **Data attributes** — `app.sourceAttrs` (custom names, tried first), then the built-ins:
   `data-insp-path` (combined `file:line:col:tag`, [code-inspector-plugin](https://inspector.fe-dev.cn/en/guide/start.html)),
   `data-inspector-relative-path` + `-line`/`-column` ([react-dev-inspector](https://github.com/zthxxx/react-dev-inspector)), `data-source` (combined).
2. **Svelte** dev metadata (`__svelte_meta.loc`) — exact file + line.
3. **Vue** dev metadata (`__vueParentComponent.type.__file`, Vue 2 `__vue__.$options.__file`) — file + component name.
4. **React** fiber owner stacks (`_debugStack`/`_debugOwner`) plus source maps — exact file + line (see below).
5. **Angular** (`ng.getOwningComponent`) — component name only, no file/line.
6. Nothing resolved → `{ via: "none" }`. Grep the screen's `source` files, as before.

## Path resolution

Source root precedence: `--source-root` (CLI) > `inventory.app.sourceRoot` (relative to the
app root) > the app root itself (the directory commands run from). A resolved path outside the
source root is kept absolute; a path that doesn't exist on disk becomes
`{ file: null, unresolved: "<attempted path>" }` rather than a guess.

## What each framework gives you (dev mode, zero config)

| Framework | Yield | Notes |
|---|---|---|
| React (18/19) | Exact file + line | React 19 removed `_debugSource`; the resolver walks `_debugStack`/`_debugOwner` and maps the first app-code frame through the module's inline source map |
| Svelte | Exact file + line | `__svelte_meta.loc`, present in dev builds |
| Vue | File + component name, no line | `__file`/`__name` on the component type |
| Angular | Component name only | No file/line hook in dev mode; falls back to grep with the component name |

## Build-time plugins (optional)

For production-like builds, or frameworks with no dev-mode hook, a bundler plugin that writes a
source data attribute lets the same resolver pick it up (step 1 above), no code change:

- [**react-dev-inspector**](https://github.com/zthxxx/react-dev-inspector) — Babel plugin, React only, writes the `data-inspector-*` trio.
- [**code-inspector-plugin**](https://github.com/zh-lx/code-inspector) — bundler plugin (Vite/webpack/esbuild…), Vue/React/Svelte/Solid/Preact/Astro, writes `data-insp-path`.

Point `app.sourceAttrs` at any other attribute name your own tooling writes.
