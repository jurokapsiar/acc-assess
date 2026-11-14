// Source tracking (D4/D5, §2 of the plan): resolves each finding node back to the app's
// source file/line with no app changes required, using (in priority order, closest
// ancestor <= 8 levels, first hit wins): data attributes from dev-inspector bundler plugins,
// Svelte dev metadata, Vue dev metadata, React fiber owner stacks + source maps, Angular
// component name, else `{ via: "none" }`.
//
// React 19 removed `fiber._debugSource` (react#31981/#32574); the verified replacement is
// `_debugStack` (an Error captured at `createElement` time) read from the fiber itself and,
// when the host element's own stack only points into `node_modules`, from its `_debugOwner`
// chain (the component that rendered it) - first frame outside node_modules is the usage
// site, which is what an agent should fix (props/usage), not the library's internals.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping');

// Default data-attribute probes (§2): code-inspector-plugin's combined `data-insp-path`
// (`file:line:col:tag`), react-dev-inspector's trio, and a generic `data-source` combined
// attribute. `inventory.app.sourceAttrs` (plain attribute names) are tried first so an app
// can override/extend this list without losing the built-ins.
export const DEFAULT_SOURCE_ATTRS = [
  { attr: 'data-insp-path', kind: 'combined' },
  { attr: 'data-inspector-relative-path', kind: 'trio', line: 'data-inspector-line', column: 'data-inspector-column' },
  { attr: 'data-source', kind: 'combined' },
];

function buildAttrSpecs(extra) {
  const custom = (extra ?? []).map((attr) => ({ attr, kind: 'combined' }));
  const seen = new Set(custom.map((s) => s.attr));
  return [...custom, ...DEFAULT_SOURCE_ATTRS.filter((s) => !seen.has(s.attr))];
}

// Runs inside the page. Pure function (no outer closures) so it can cross the
// page.evaluate boundary; everything it needs comes through `args` or is defined inline
// (module-level consts above are NOT visible here - Playwright re-stringifies the function).
export function SOURCE_PROBE({ selector, attrs }) {
  const IGNORE_FRAME = /node_modules|\/@vite\/|\/@react-refresh/;
  // `jsxDEV`'s own frame (react/jsx-dev-runtime) is always the first frame of a `_debugStack`
  // and must never be mistaken for the owner's real call site. IGNORE_FRAME's node_modules
  // check catches it when every module keeps its own URL (an unbundled dev server), but a
  // single-file bundle (esbuild/webpack prod-ish single output) collapses jsxDEV's frame into
  // the app's own bundle URL, which has no node_modules segment to match - so it must also be
  // recognised by its function name (`jsxDEV` or `exports.jsxDEV` under a CJS interop wrapper).
  const IGNORE_FN = /(^|\.)jsxDEV$/;
  const MAX_ANCESTOR_LEVELS = 8;
  const MAX_OWNER_CHAIN = 6;
  const el = document.querySelector(selector);
  if (!el) return { via: 'none' };

  function parseCombined(raw) {
    if (!raw) return null;
    let m = raw.match(/^(.*):(\d+):(\d+):([^:]+)$/);
    if (m) return { file: m[1], line: +m[2], column: +m[3], tag: m[4] };
    m = raw.match(/^(.*):(\d+):(\d+)$/);
    if (m) return { file: m[1], line: +m[2], column: +m[3] };
    m = raw.match(/^(.*):(\d+)$/);
    if (m) return { file: m[1], line: +m[2] };
    return null;
  }

  function dataAttrHit(node) {
    for (const spec of attrs) {
      if (spec.kind === 'trio') {
        const file = node.getAttribute(spec.attr);
        if (!file) continue;
        const line = node.getAttribute(spec.line);
        const column = node.getAttribute(spec.column);
        return { via: 'data-attr', file, line: line ? +line : null, column: column ? +column : null };
      }
      const raw = node.getAttribute(spec.attr);
      if (!raw) continue;
      const parsed = parseCombined(raw);
      if (parsed) return { via: 'data-attr', file: parsed.file, line: parsed.line ?? null, column: parsed.column ?? null };
    }
    return null;
  }

  // Each owner's `_debugStack` was captured when *that* element was created (the JSX call
  // site); the host element's own stack usually resolves to nothing when it was created
  // deep inside a library (all frames match IGNORE_FRAME), so we walk `_debugOwner` until
  // we find the first ancestor whose creation call site was app code.
  function reactChain(fiber) {
    const chain = [];
    let f = fiber;
    for (let i = 0; i < MAX_OWNER_CHAIN && f; i++, f = f._debugOwner) {
      // `fiber.type` is a plain tag string ('h2', 'button', ...) for host DOM elements and a
      // function/class for composite components; only the latter counts as a "component" name.
      const t = f.type ?? f.elementType;
      const component = typeof t === 'string' ? null : t?.displayName || t?.name || null;
      const entry = { component };
      if (f._debugSource && f._debugSource.fileName) {
        entry.via = 'react-debug-source';
        entry.resolvedFile = f._debugSource.fileName;
        entry.resolvedLine = f._debugSource.lineNumber ?? null;
        entry.resolvedColumn = f._debugSource.columnNumber ?? null;
      } else if (f._debugStack && typeof f._debugStack.stack === 'string') {
        const lines = f._debugStack.stack.split('\n').slice(1);
        for (const l of lines) {
          const m = l.match(/at (?:(\S+) \()?(https?:[^)\s]+):(\d+):(\d+)\)?/);
          if (m && !IGNORE_FRAME.test(m[2]) && !(m[1] && IGNORE_FN.test(m[1]))) {
            entry.via = 'react-owner-stack';
            entry.url = m[2];
            entry.stackLine = +m[3];
            entry.stackColumn = +m[4];
            break;
          }
        }
      }
      chain.push(entry);
    }
    return { via: 'react', chain };
  }

  let cur = el;
  for (let level = 0; level <= MAX_ANCESTOR_LEVELS && cur; level++, cur = cur.parentElement) {
    const attrHit = dataAttrHit(cur);
    if (attrHit) return attrHit;

    if (cur.__svelte_meta?.loc) {
      const loc = cur.__svelte_meta.loc;
      return { via: 'svelte', file: loc.file, line: loc.line ?? null, column: loc.column ?? null };
    }

    const vueKey = Object.keys(cur).find((k) => k.startsWith('__vueParentComponent'));
    const vueType = vueKey && cur[vueKey]?.type;
    if (vueType?.__file) {
      return { via: 'vue', file: vueType.__file, component: vueType.__name || vueType.name || null, line: null, column: null };
    }
    if (cur.__vue__?.$options?.__file) {
      return { via: 'vue', file: cur.__vue__.$options.__file, component: cur.__vue__.$options.name || null, line: null, column: null };
    }

    const reactKey = Object.keys(cur).find((k) => k.startsWith('__reactFiber$'));
    if (reactKey) return reactChain(cur[reactKey]);

    if (window.ng?.getOwningComponent) {
      try {
        const comp = window.ng.getOwningComponent(cur);
        if (comp) return { via: 'angular', component: comp.constructor?.name ?? null, file: null, line: null, column: null };
      } catch {
        // best-effort; Angular dev hooks vary by version
      }
    }
  }
  return { via: 'none' };
}

// --- Node-side path resolution (V11) -----------------------------------------------------

function normalizeSlashes(p) {
  return p.replace(/\\/g, '/');
}

function isAbsoluteRaw(raw) {
  return path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw);
}

// Existence check + root-relativization, shared by data-attribute paths and source-mapped
// stack frames alike. Absolute paths that fall inside `root` are rewritten relative to it
// with forward slashes; outside `root` they stay absolute (still `/`-normalized). A path
// that doesn't exist on disk returns `{ file: null, unresolved: "<attempted path>" }`.
function finalizePath(raw, root) {
  const abs = isAbsoluteRaw(raw) ? path.resolve(raw) : path.resolve(root, raw);
  if (!fs.existsSync(abs)) return { file: null, unresolved: normalizeSlashes(abs) };
  const rel = path.relative(root, abs);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return { file: normalizeSlashes(rel) };
  return { file: normalizeSlashes(abs) };
}

// Pure URL -> path conversion (no network): `file:` via fileURLToPath; `/@fs/...` (Vite)
// strips the prefix and un-escapes a leading `/C:/` drive letter; other http(s) paths use
// the decoded pathname minus the leading slash. `webpack://<ns>/./x` needs no special case:
// WHATWG URL parsing already collapses the `/./` dot-segment, leaving a plain `ns`-hosted
// pathname of `/x`, handled by the same branch as other http(s) URLs.
export function urlToPath(urlLike, { root }) {
  const u = typeof urlLike === 'string' ? new URL(urlLike) : urlLike;
  let raw;
  if (u.protocol === 'file:') {
    raw = fileURLToPath(u);
  } else {
    const pathname = decodeURIComponent(u.pathname);
    if (pathname.startsWith('/@fs/')) {
      raw = pathname.slice('/@fs/'.length);
      if (/^\/[A-Za-z]:\//.test(raw)) raw = raw.slice(1); // '/C:/x' -> 'C:/x'
    } else {
      raw = pathname.replace(/^\//, '');
    }
  }
  return finalizePath(raw, root);
}

async function fetchText(url, cache) {
  if (!cache.has(url)) {
    cache.set(
      url,
      (async () => {
        try {
          const res = await fetch(url);
          return res.ok ? await res.text() : null;
        } catch {
          return null;
        }
      })(),
    );
  }
  return cache.get(url);
}

async function loadSourceMap(moduleUrl, cache) {
  const text = await fetchText(moduleUrl, cache);
  if (!text) return null;
  const m = text.match(/\/\/[#@]\s*sourceMappingURL=([^\s'"]+)/);
  if (!m) return null;
  const ref = m[1];
  if (ref.startsWith('data:')) {
    const b64 = ref.match(/base64,([\s\S]*)$/);
    if (!b64) return null;
    try {
      return JSON.parse(Buffer.from(b64[1], 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }
  const mapUrl = new URL(ref, moduleUrl).href;
  const mapText = await fetchText(mapUrl, cache);
  if (!mapText) return null;
  try {
    return JSON.parse(mapText);
  } catch {
    return null;
  }
}

async function getTracer(moduleUrl, cache) {
  const key = `map:${moduleUrl}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        const mapJson = await loadSourceMap(moduleUrl, cache);
        return mapJson ? new TraceMap(mapJson) : null;
      })(),
    );
  }
  return cache.get(key);
}

// Fetches the module (cached per run, keyed by URL), resolves its source map, maps
// `line:column` back to the original position, computes
// `src = new URL((map.sourceRoot ?? '') + source, moduleUrl)` (§2) and converts that to a
// filesystem path. `cache` is a plain Map the caller owns and reuses across the whole run.
export async function urlToFile(moduleUrl, line, column, { root, cache }) {
  const tracer = await getTracer(moduleUrl, cache);
  if (!tracer) return { file: null, line: null, column: null, unresolved: moduleUrl };
  const pos = originalPositionFor(tracer, { line, column: Math.max(0, (column ?? 1) - 1) });
  if (!pos || pos.line == null || !pos.source) return { file: null, line: null, column: null, unresolved: moduleUrl };
  const srcUrl = new URL((tracer.sourceRoot ?? '') + pos.source, moduleUrl);
  const resolved = urlToPath(srcUrl, { root });
  return { file: resolved.file, line: pos.line, column: (pos.column ?? 0) + 1, unresolved: resolved.file ? null : resolved.unresolved };
}

const EMPTY_SOURCE = Object.freeze({ via: 'none', file: null, line: null, column: null, component: null, chain: null, unresolved: null });

async function finalizeDirect(raw, root) {
  // data-attr / svelte / vue: already-original coordinates, just need existence + root-relativization.
  if (!raw.file) return { ...EMPTY_SOURCE, via: raw.via };
  const resolved = finalizePath(normalizeSlashes(raw.file), root);
  return {
    via: raw.via,
    file: resolved.file,
    line: raw.line ?? null,
    column: raw.column ?? null,
    component: raw.component ?? null,
    chain: null,
    unresolved: resolved.file ? null : resolved.unresolved,
  };
}

async function finalizeReact(raw, { root, cache }) {
  const chain = [];
  for (const entry of raw.chain) {
    if (entry.resolvedFile) {
      const resolved = finalizePath(normalizeSlashes(entry.resolvedFile), root);
      if (resolved.file) chain.push({ component: entry.component, file: resolved.file, line: entry.resolvedLine ?? null });
    } else if (entry.url) {
      const resolved = await urlToFile(entry.url, entry.stackLine, entry.stackColumn, { root, cache });
      if (resolved.file) chain.push({ component: entry.component, file: resolved.file, line: resolved.line });
    }
  }
  if (!chain.length) return { ...EMPTY_SOURCE, via: 'react' };
  const [primary] = chain;
  return { via: 'react-owner-stack', file: primary.file, line: primary.line, column: null, component: primary.component, chain, unresolved: null };
}

async function finalizeSource(raw, { root, cache }) {
  if (!raw || raw.via === 'none') return EMPTY_SOURCE;
  if (raw.via === 'react') return finalizeReact(raw, { root, cache });
  if (raw.via === 'angular') return { ...EMPTY_SOURCE, via: 'angular', component: raw.component ?? null };
  return finalizeDirect(raw, root); // data-attr, svelte, vue
}

// Entry point used by lib/evidence.mjs's captureNodes. `nodes` are evidence nodes that
// already carry `selector` (and, when available, `node.source` left unset). `root` is the
// resolved source root (absolute path); `attrs` are extra data-attribute names from
// `inventory.app.sourceAttrs`; `cache` is a Map the caller should share across the whole run
// (module text + parsed source maps are fetched at most once per URL).
export async function resolveSources(page, nodes, { root, attrs, cache }) {
  const attrSpecs = buildAttrSpecs(attrs);
  const sharedCache = cache ?? new Map();
  const sourceRoot = root ?? process.cwd();
  for (const node of nodes) {
    if (node.source && node.source.via) continue; // already resolved (e.g. by a future caller)
    if (!node.selector || node.framed) {
      node.source = EMPTY_SOURCE;
      continue;
    }
    let raw;
    try {
      raw = await page.evaluate(SOURCE_PROBE, { selector: node.selector, attrs: attrSpecs });
    } catch {
      raw = { via: 'none' };
    }
    node.source = await finalizeSource(raw, { root: sourceRoot, cache: sharedCache });
  }
  return nodes;
}

// Source root precedence (§2): `--source-root` (CLI) > `inventory.app.sourceRoot` (relative
// to the app root) > the app root itself. `appRoot` is the cwd commands are run from.
export function resolveSourceRoot({ cliRoot, invRoot, appRoot }) {
  if (cliRoot) return path.resolve(appRoot, cliRoot);
  if (invRoot) return path.resolve(appRoot, invRoot);
  return appRoot;
}
