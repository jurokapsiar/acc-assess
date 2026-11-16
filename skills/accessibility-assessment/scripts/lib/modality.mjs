// Interaction-modality runner: replays a target's plan under a declared modality
// (keyboard | sr-keyboard | mouse | sr-navigation) with a guarded Playwright surface, so a
// step that can only be completed with a pointer or a programmatic focus move is *reported*,
// never silently performed.
import { locate, describeStep, runStep } from './steps.mjs';
import { MODALITY_RULES } from './modality-rules.mjs';

export const MODALITIES = ['keyboard', 'mouse', 'sr-keyboard', 'sr-navigation'];
export const KEYBOARD_LIKE = ['keyboard', 'sr-keyboard', 'sr-navigation'];

// The only keys that may navigate or activate under a keyboard modality (purpose-based policy).
export const CORE_KEYS = ['Tab', 'Shift+Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space'];
const CORE = new Set(CORE_KEYS.map((k) => k.toLowerCase()));
const ALIASES = { ' ': 'space', spacebar: 'space', return: 'enter', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' };
const norm = (k) => { if (k === ' ') return 'space'; const s = String(k).trim().toLowerCase(); return ALIASES[s] ?? s; };

/**
 * Key policy. `purpose`: navigate | activate | text | dismiss | reader.
 * Only the core keys may navigate or activate; Escape only dismisses; text entry and reader
 * commands are allowed for their own purpose only. Home/End/PageUp/PageDown/F6 never navigate.
 */
export function guardKey(modality, key, purpose = 'navigate') {
  if (!KEYBOARD_LIKE.includes(modality)) return { allowed: true };
  const k = norm(key);
  if (purpose === 'text') return { allowed: String(key).length >= 1 };
  if (purpose === 'reader') return { allowed: modality !== 'keyboard' };
  if (purpose === 'dismiss') return { allowed: k === 'escape', reason: k === 'escape' ? null : 'only Escape may dismiss' };
  if (CORE.has(k)) return { allowed: true };
  return { allowed: false, reason: `${key} may not be used to ${purpose} under the ${modality} modality` };
}

export function validateKeys(keys) {
  const bad = (keys ?? []).filter((k) => !CORE.has(norm(k)));
  return bad.length ? `keys outside ${CORE_KEYS.join('/')}: ${bad.join(', ')}` : null;
}

/** Thrown when a guarded surface is used for a forbidden interaction outside a rescue scope. */
export class ModalityViolation extends Error {
  constructor(method) { super(`"${method}" is not allowed under the keyboard modality outside a rescue`); this.method = method; }
}

const FORBIDDEN = new Set(['click', 'dblclick', 'hover', 'tap', 'focus', 'fill', 'check', 'uncheck', 'selectOption', 'dispatchEvent', 'press', 'pressSequentially', 'type', 'evaluate', '$eval', '$$eval', 'evaluateHandle', 'setChecked', 'dragTo', 'blur']);
const WRAP = new Set(['locator', 'getByRole', 'getByLabel', 'getByText', 'getByPlaceholder', 'getByTestId', 'first', 'last', 'nth', 'frameLocator', 'mainFrame', 'frames', 'frame', 'filter', 'and', 'or', '$', '$$', 'contentFrame']);

/**
 * Recursive Proxy around Page/Locator/Frame/ElementHandle. Mutating or pointer methods throw
 * `ModalityViolation` unless `ctl.rescue` is set. `page.keyboard.*` is allowed (the key policy
 * guards it); `page.mouse.*` is always forbidden outside a rescue.
 */
export function guardSurface(target, ctl) {
  const cache = new WeakMap();
  const wrap = (obj) => {
    if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return obj;
    if (cache.has(obj)) return cache.get(obj);
    const p = new Proxy(obj, {
      get(t, prop, recv) {
        const v = Reflect.get(t, prop, t);
        if (typeof prop === 'symbol') return v;
        if (prop === 'mouse' || prop === 'touchscreen') {
          return new Proxy(v, { get(mt, mp) { const f = mt[mp]; return typeof f === 'function' ? (...a) => { if (!ctl.rescue) throw new ModalityViolation(`${String(prop)}.${String(mp)}`); return f.apply(mt, a); } : f; } });
        }
        if (typeof v !== 'function') return v;
        if (FORBIDDEN.has(prop)) {
          return (...a) => { if (!ctl.rescue) throw new ModalityViolation(prop); ctl.onRescueCall?.(prop); return v.apply(t, a); };
        }
        if (WRAP.has(prop)) return (...a) => { const r = v.apply(t, a); return Array.isArray(r) ? r.map(wrap) : wrap(r); };
        return v.bind(t);
      },
    });
    cache.set(obj, p);
    return p;
  };
  return wrap(target);
}

const TEXT_INPUT = 'input:not([type=button i],[type=submit i],[type=reset i],[type=checkbox i],[type=radio i],[type=image i],[type=range i],[type=color i],[type=file i]),textarea,[contenteditable=""],[contenteditable=true i]';

/** Observation helpers run on the *raw* (unguarded) page so measuring never counts as interaction. */
export function makeObserver(raw) {
  return {
    state: () => raw.evaluate(() => {
      const a = document.activeElement;
      const rect = a && a !== document.body ? a.getBoundingClientRect() : null;
      return {
        tag: a?.tagName ?? null, id: a?.id || null, role: a?.getAttribute?.('role') ?? null,
        text: (a?.getAttribute?.('aria-label') || a?.textContent || a?.value || '').trim().slice(0, 80),
        isBody: !a || a === document.body || a === document.documentElement,
        activedescendant: a?.getAttribute?.('aria-activedescendant') ?? null,
        controls: a?.getAttribute?.('aria-controls') ?? a?.getAttribute?.('aria-owns') ?? null,
        editable: !!a?.matches?.('input,textarea,select,[contenteditable=""],[contenteditable=true i]'),
        url: location.href, dialogs: document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog]').length,
        expanded: [...document.querySelectorAll('[aria-expanded],[aria-checked],[aria-pressed],[aria-selected]')].map((e) => e.getAttribute('aria-expanded') + e.getAttribute('aria-checked') + e.getAttribute('aria-pressed') + e.getAttribute('aria-selected')).join('|'),
        mutations: window.__a11yMut ?? 0, requests: performance.getEntriesByType('resource').length,
        checked: a?.checked ?? null, box: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
      };
    }),
    installMutationCounter: () => raw.evaluate(() => {
      if (window.__a11yMutObs) return;
      window.__a11yMut = 0;
      window.__a11yMutObs = new MutationObserver((l) => { window.__a11yMut += l.length; });
      window.__a11yMutObs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    }),
    /** True when the element described by `goal` is the logical focus (P1-04). */
    atGoal: (selectorInfo) => raw.evaluate((g) => {
      const goal = document.querySelector(g);
      if (!goal) return false;
      const a = document.activeElement;
      if (a === goal) return true;
      if (a?.shadowRoot?.activeElement === goal) return true;
      if (a && goal.id && a.getAttribute('aria-activedescendant') === goal.id) return true;
      const owned = a?.getAttribute('aria-controls') ?? a?.getAttribute('aria-owns');
      if (owned && owned.split(/\s+/).some((id) => { const el = document.getElementById(id); return el && (el === goal || el.contains(goal)); })) return a.matches('[role=combobox],[role=listbox],[role=grid],[role=tree],[role=menu],[role=menubar],[role=tablist],[role=toolbar],[aria-expanded]');
      return false;
    }, selectorInfo),
  };
}

export function changed(a, b) {
  if (!a || !b) return false;
  return ['url', 'dialogs', 'expanded', 'mutations', 'requests', 'checked', 'id', 'tag', 'text'].some((k) => a[k] !== b[k]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bareSelector = (loc) => loc.evaluate((el) => {
  if (!el.dataset.a11yGoal) el.dataset.a11yGoal = String(Math.random()).slice(2);
  return `[data-a11y-goal="${el.dataset.a11yGoal}"]`;
});

/**
 * Reaches the step target with the keyboard alone: Tab forward until a full cycle completed
 * (or `maxPresses` reached -> inconclusive), arrow keys once the focus is on a composite widget.
 * Returns { reached, cycle: bool, presses, inconclusive, trapped }.
 */
export async function keyboardReach({ page, raw, loc, obs, maxPresses = 120, goal, uiWrap = 0 }) {
  const seen = new Set();
  let presses = 0;
  const start = await obs.state();
  const key = (s) => `${s.tag}|${s.id}|${s.text}|${s.box?.x}|${s.box?.y}`;
  seen.add(key(start));
  if (await obs.atGoal(goal)) return { reached: true, presses, cycle: false };
  // Focus already inside a composite widget (an open menu, listbox, tablist…): arrows move
  // within it, Tab is not expected to, so probe the arrows before treating a still Tab as a trap.
  if (start.role && /^(menuitem|menuitemcheckbox|menuitemradio|option|tab|treeitem|gridcell|menu|menubar|listbox|tablist|grid|tree)$/.test(start.role)) {
    for (const k of ['ArrowDown', 'ArrowRight']) {
      for (let i = 0; i < 12 && presses < maxPresses; i++) {
        await page.keyboard.press(k); presses++; await sleep(20);
        if (await obs.atGoal(goal)) return { reached: true, presses, cycle: false, viaArrows: true };
      }
    }
  }
  let stuck = 0;
  let wrapChecked = false;
  while (presses < maxPresses) {
    const before = await obs.state();
    await page.keyboard.press('Tab');
    presses++;
    await sleep(30);
    if (await obs.atGoal(goal)) return { reached: true, presses, cycle: false };
    const now = await obs.state();
    if (key(now) === key(before)) {
      // no movement: try the sanctioned escape routes before declaring a trap
      stuck++;
      // Real browsers: Tab may have left the page for the browser UI; keep tabbing until the
      // page takes the focus back (wrapping to its first stop) before calling it stuck.
      if (uiWrap) {
        let wrapped = false;
        for (let i = 0; i < uiWrap && presses < maxPresses; i++) {
          await page.keyboard.press('Tab'); presses++; await sleep(60);
          if (await obs.atGoal(goal)) return { reached: true, presses, cycle: false };
          if (key(await obs.state()) !== key(before)) { wrapped = true; break; }
        }
        if (wrapped) continue;
      }
      await page.keyboard.press('Shift+Tab'); presses++; await sleep(30);
      const back = await obs.state();
      if (key(back) === key(before)) {
        await page.keyboard.press('Escape'); await sleep(30);
        const esc = await obs.state();
        if (key(esc) === key(before) && stuck >= 2) return { reached: false, trapped: true, presses };
      } else if (await obs.atGoal(goal)) return { reached: true, presses, cycle: false };
      continue;
    }
    // a composite widget owns arrow navigation: probe it before moving on
    if (now.role && /^(listbox|menu|menubar|tablist|radiogroup|grid|tree|toolbar|combobox)$/.test(now.role) || now.activedescendant) {
      for (const k of ['ArrowDown', 'ArrowRight']) {
        for (let i = 0; i < 12 && presses < maxPresses; i++) {
          await page.keyboard.press(k); presses++; await sleep(20);
          if (await obs.atGoal(goal)) return { reached: true, presses, cycle: false, viaArrows: true };
        }
      }
    }
    const k = key(now);
    if (seen.has(k) && k === key(start)) {
      // A real reader leaves the DOM focus unchanged while Tab crosses the browser UI, so the
      // "cycle" may be the UI traversal: keep tabbing to let the page take the focus back.
      if (uiWrap && !wrapChecked) {
        wrapChecked = true;
        for (let i = 0; i < uiWrap * 2 && presses < maxPresses; i++) {
          await page.keyboard.press('Tab'); presses++; await sleep(60);
          if (await obs.atGoal(goal)) return { reached: true, presses, cycle: false };
        }
      }
      return { reached: false, cycle: true, presses };
    }
    seen.add(k);
  }
  return { reached: false, cycle: false, inconclusive: true, presses };
}

/**
 * Activates the focused control with the role-correct key first; the alternate key is tried only
 * when settling showed no change at all. Never double-activates: an unobservable result is
 * reported as `unobserved`, not retried (P1-06).
 */
export async function keyboardActivate({ page, obs, role, kind }) {
  const primary = /^(button|menuitem|tab|switch|option|link)?$/.test(role ?? '') && kind !== 'checkbox' ? 'Enter' : 'Space';
  const alternate = primary === 'Enter' ? 'Space' : 'Enter';
  const before = await obs.state();
  await page.keyboard.press(primary);
  await sleep(250);
  let after = await obs.state();
  if (changed(before, after)) return { activated: true, key: primary };
  await sleep(350);
  after = await obs.state();
  if (changed(before, after)) return { activated: true, key: primary };
  await page.keyboard.press(alternate);
  await sleep(300);
  after = await obs.state();
  return changed(before, after) ? { activated: true, key: alternate } : { activated: false, unobserved: true };
}

// Which actions need the pointer/focus/script under a keyboard modality, and the keyboard form.
const ACTION_KIND = { click: 'activate', dblclick: 'activate', check: 'activate', uncheck: 'activate', select: 'choose', hover: 'hover', focus: 'focus', fill: 'text', type: 'text', press: 'press', evaluate: 'script' };

/**
 * Runs one plan step under a keyboard-like modality. Returns a step record:
 * { outcome: 'ok'|'skipped'|'escalated'|'inconclusive'|'blocked', findings: [rule...], key, presses, note }.
 */
export async function runKeyboardStep(ctx, st, opts = {}) {
  const { page, raw, ctl, obs, modality } = ctx;
  const kind = ACTION_KIND[st.action];
  if (!kind) { await runStep(raw, st, opts); return { outcome: 'ok', findings: [], presses: 0 }; }
  const rec = { outcome: 'ok', findings: [], presses: 0 };
  await obs.installMutationCounter().catch(() => {});
  const describe = describeStep(st);
  if (kind === 'script') {
    if (!ctx.actionable) { await runStep(raw, st, opts); return rec; }
    ctl.rescue = true;
    try { await runStep(raw, st, opts); } finally { ctl.rescue = false; }
    rec.outcome = 'escalated'; rec.findings.push({ rule: 'kbd-programmatic-intervention' });
    return rec;
  }
  ctx.actionable = true;
  if (kind === 'press') {
    for (let i = 0; i < (st.times ?? 1); i++) {
      const g = guardKey(modality, st.key, st.purpose ?? 'navigate');
      if (!g.allowed && !/^(escape)$/i.test(st.key)) {
        rec.outcome = 'skipped'; rec.findings.push({ rule: 'kbd-nonstandard-key', note: g.reason });
        return rec;
      }
      await page.keyboard.press(st.key);
    }
    await sleep(st.settle ?? 150);
    return rec;
  }
  if (kind === 'text') {
    if (st.target) {
      const r = await focusViaKeyboard(ctx, st, opts, rec);
      if (!r) return rec;
    }
    await raw.keyboard.type(String(st.value ?? ''));
    return rec;
  }
  if (kind === 'hover') { rec.findings.push({ rule: 'kbd-hover-only' }); rec.outcome = 'skipped'; return rec; }
  const reached = await focusViaKeyboard(ctx, st, opts, rec);
  if (!reached) return rec;
  if (kind === 'focus') return rec;
  if (kind === 'choose') {
    const k = await keyboardActivate({ page, obs, role: 'combobox' });
    if (!k.activated) rec.findings.push({ rule: 'kbd-activation-unobserved' });
    return rec;
  }
  const loc = locate(raw, st.target);
  const role = await loc.evaluate((el) => el.getAttribute('role') || el.tagName.toLowerCase()).catch(() => null);
  const isCheckbox = await loc.evaluate((el) => el.matches('input[type=checkbox],input[type=radio],[role=checkbox],[role=switch],[role=radio]')).catch(() => false);
  if ((st.action === 'check' || st.action === 'uncheck') && isCheckbox) {
    const want = st.action === 'check';
    const now = await loc.evaluate((el) => el.checked ?? el.getAttribute('aria-checked') === 'true');
    if (now === want) return rec; // idempotent
  }
  const res = await keyboardActivate({ page, obs, role, kind: isCheckbox ? 'checkbox' : undefined });
  if (res.activated) { rec.key = res.key; return rec; }
  // Keyboard failed: rescue with a click to learn whether the control works at all.
  const before = await obs.state();
  if (ctx.noEscalate) { rec.outcome = 'inconclusive'; rec.findings.push({ rule: 'kbd-activation-unobserved', note: 'escalation disabled' }); return rec; }
  const rescued = await rescue(ctl, async () => { await locate(raw, st.target).click({ timeout: opts.timeout ?? 10000 }); await sleep(300); });
  const after = await obs.state();
  if (rescued && changed(before, after)) { rec.outcome = 'escalated'; rec.escalation = 'click'; rec.findings.push({ rule: 'kbd-no-activation' }); }
  else { rec.outcome = 'inconclusive'; rec.findings.push({ rule: 'kbd-activation-unobserved' }); }
  return rec;
}

async function rescue(ctl, fn) {
  ctl.rescue = true;
  try { await fn(); return true; } catch { return false; } finally { ctl.rescue = false; }
}

// Focus the step target using only the keyboard; escalate to programmatic focus when needed.
async function focusViaKeyboard(ctx, st, opts, rec) {
  const { page, raw, ctl, obs } = ctx;
  const loc = locate(raw, st.target);
  const exists = await loc.count().catch(() => 0);
  if (!exists) { rec.outcome = 'blocked'; rec.note = 'target not found'; return false; }
  const goal = await bareSelector(loc);
  const focusable = await loc.evaluate((el) => el.matches('a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex],[contenteditable]')).catch(() => true);
  const res = await keyboardReach({ page, raw, loc, obs, maxPresses: ctx.maxPresses, goal, uiWrap: ctx.uiWrap ?? 0 });
  rec.presses = res.presses;
  if (res.reached) return true;
  if (res.inconclusive) { rec.outcome = 'inconclusive'; rec.findings.push({ rule: 'kbd-search-inconclusive' }); return false; }
  if (res.trapped) { rec.outcome = 'blocked'; rec.findings.push({ rule: 'kbd-trap' }); return false; }
  if (ctx.noEscalate) { rec.outcome = 'inconclusive'; rec.findings.push({ rule: 'kbd-search-inconclusive', note: 'escalation disabled' }); return false; }
  // A full cycle completed without the goal: demonstrate the barrier with a programmatic focus rescue.
  const ok = await rescue(ctl, async () => { await loc.focus({ timeout: opts.timeout ?? 10000 }); });
  if (ok && (await obs.atGoal(goal))) {
    rec.outcome = 'escalated'; rec.escalation = 'focus';
    rec.findings.push({ rule: 'kbd-programmatic-focus' });
    return true;
  }
  const clicked = await rescue(ctl, async () => { await loc.click({ timeout: opts.timeout ?? 10000 }); });
  rec.outcome = clicked ? 'escalated' : 'blocked'; rec.escalation = clicked ? 'click' : null;
  rec.findings.push({ rule: focusable ? 'kbd-mouse-required' : 'kbd-not-focusable' });
  return clicked;
}

export function ruleMeta(rule) { return MODALITY_RULES[rule]; }
export { TEXT_INPUT };
