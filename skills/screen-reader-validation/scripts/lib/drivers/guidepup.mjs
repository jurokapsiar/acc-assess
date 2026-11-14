// Shared Guidepup driver core (NVDA and VoiceOver differ only in startup alignment, key names
// and navigation commands). Guidepup's spoken phrase log is NOT a passive transcript: speech is
// only recorded while a command runs through Guidepup's queue (`press`, `perform`, `next`, ...,
// or `capture(action)` for external actions such as Playwright clicks). So every journey action
// runs inside `sr.capture(...)` / `sr.press(key, { capture: true })`, and the log is drained
// (never cleared unread) so no recorded phrase is discarded.
import { loadGuidepup } from '../deps.mjs';
import { toReaderKey } from './keys.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODE_RE = /\b(focus|browse) mode\b/i;
// End-of-sweep messages ("no next heading", "bottom", "end of document").
export const END_RE = /^(no (next|more)\b|bottom\b|end of\b)/i;
const FULL = { capture: true };

/**
 * `spec`: { name, label, settleMs, platform, pick(g) -> sr, guidepup?,
 *           align(ctx, page) -> phrases, top(ctx) -> command label, nav: { headings, landmarks, reading } }
 * where `nav[kind](ctx)` returns `null` when the reader has no such command (sweep "unsupported").
 */
export function createGuidepupDriver(spec) {
  const ctx = { g: null, sr: null, kc: {} };
  const drain = async () => {
    const log = (await ctx.sr.spokenPhraseLog()) ?? [];
    await ctx.sr.clearSpokenPhraseLog();
    const phrases = log.map((p) => String(p ?? '').trim()).filter(Boolean);
    // The last spoken mode announcement is the only evidence of the reader's mode besides DOM focus.
    for (const p of phrases) { const m = MODE_RE.exec(p); if (m) ctx.modeHint = m[1].toLowerCase(); }
    return phrases;
  };
  const editableFocus = async (page) => {
    if (typeof page?.evaluate !== 'function') return null;
    return page.evaluate(() => {
      const e = document.activeElement;
      return !!e && e !== document.body && (/^(input|textarea|select)$/i.test(e.tagName) || e.isContentEditable || /^(textbox|combobox|searchbox|spinbutton)$/.test(e.getAttribute('role') ?? ''));
    }).catch(() => null);
  };
  /** Reader mode: announced (spoken) > inferred from DOM focus > unknown. Never changes anything. */
  ctx.readerMode = async (page) => {
    for (const p of (await ctx.sr.spokenPhraseLog()) ?? []) { const m = MODE_RE.exec(String(p ?? '')); if (m) ctx.modeHint = m[1].toLowerCase(); }
    if (ctx.modeHint) return { mode: ctx.modeHint, confidence: 'announced' };
    const editable = await editableFocus(page);
    if (editable === null) return { mode: 'unknown', confidence: 'none' };
    return { mode: editable ? 'focus' : 'browse', confidence: 'inferred' };
  };
  ctx.drain = drain;
  ctx.full = FULL;
  ctx.last = async () => String((await ctx.sr.lastSpokenPhrase().catch(() => '')) ?? '').trim();
  ctx.perform = async (name) => {
    if (!ctx.kc[name]) throw new Error(`${spec.label}: keyboard command "${name}" is not available in this Guidepup version`);
    await ctx.sr.perform(ctx.kc[name], FULL);
  };

  return {
    name: spec.name,
    label: spec.label,
    kind: 'real',
    settleMs: spec.settleMs,
    async start() {
      ctx.g = spec.guidepup ?? await loadGuidepup();
      ctx.sr = spec.pick(ctx.g);
      // Start first: VoiceOver's keyboardCommands getter throws until the reader is running.
      await ctx.sr.start(FULL);
      ctx.kc = ctx.sr.keyboardCommands ?? {};
    },
    async attach() { ctx.modeHint = null; },
    /** Brings the reader into the page's web content; returns the preparation phrases. Throws when alignment can't be verified. */
    async align(page) { return spec.align(ctx, page); },
    readerMode(page) { return ctx.readerMode(page); },
    /**
     * Establishes browse mode for reader navigation/probes only (never before form input). NVDA+Space
     * toggles, so it is sent only when the mode is not already browse and the result must be
     * confirmed by the spoken announcement; otherwise `{ mode: 'unknown' }` and the caller must not
     * run browse-mode probes. Never uses Escape and never changes the user's reader settings.
     */
    async ensureBrowseMode(page) {
      const m = await ctx.readerMode(page);
      if (m.mode === 'browse') return { ...m, changed: false, phrases: [] };
      if (m.mode === 'unknown' || !ctx.kc.toggleBetweenBrowseAndFocusMode) return { mode: 'unknown', confidence: 'none', changed: false, phrases: [], reason: 'mode cannot be determined' };
      ctx.modeHint = null;
      await ctx.perform('toggleBetweenBrowseAndFocusMode');
      await sleep(300);
      const phrases = await drain();
      if (ctx.modeHint === 'browse') return { mode: 'browse', confidence: 'announced', changed: true, phrases };
      return { mode: 'unknown', confidence: 'none', changed: true, phrases, reason: 'the reader did not announce browse mode after the toggle (sounds-only configuration?); the toggle may have switched it the wrong way' };
    },
    /** Runs an external (Playwright) action inside Guidepup's capture window. */
    /** Never throws for an action failure: returns `{ pre, phrases, health, error }` so no phrase is lost. */
    async capture(fn, { settle = spec.settleMs } = {}) {
      const pre = await drain();
      let health = 'captured';
      let error = null;
      try {
        if (typeof ctx.sr.capture === 'function') await ctx.sr.capture(() => fn(), FULL);
        else { health = 'unavailable'; await fn(); }
      } catch (err) { error = err; }
      if (settle) await sleep(settle);
      return { pre, phrases: await drain(), health, ...(error ? { error } : {}) };
    },
    /** OS-level key presses through the reader (CDP key events never reach a screen reader). */
    async keys(keys, { settle = spec.settleMs } = {}) {
      const pre = await drain();
      let error = null;
      try {
        for (const k of keys) await ctx.sr.press(toReaderKey(k, spec.platform), FULL);
      } catch (err) { error = err; }
      if (settle) await sleep(settle);
      return { pre, phrases: await drain(), health: 'captured', ...(error ? { error } : {}) };
    },
    async take() { return drain(); },
    async probe(page, kind, { cap = 40 } = {}) {
      const commands = [];
      const items = [];
      let termination = 'cap';
      try {
        await drain();
        commands.push(await spec.top(ctx));
        await sleep(400);
        const start = (await drain()).join('. ');
        // The start position is itself an item of a reading sweep (not of heading/landmark jumps).
        if (kind === 'reading' && start && !END_RE.test(start)) items.push({ text: start });
        const nav = spec.nav[kind](ctx);
        if (!nav) return { items, termination: 'unsupported', commands };
        commands.push(nav.label);
        let prev = null;
        let repeats = 0;
        for (let i = 0; i < cap; i++) {
          await nav.run();
          await sleep(400);
          const said = (await drain()).join('. ').trim();
          if (!said) { termination = items.length ? 'end' : 'silent'; break; }
          if (END_RE.test(said)) { termination = 'end'; break; }
          if (said === prev) {
            // Consecutive identically named items are legitimate; three in a row means stuck.
            if (++repeats >= 2) { termination = 'repeat'; break; }
          } else repeats = 0;
          items.push({ text: said });
          prev = said;
        }
      } catch (err) {
        return { items, termination: 'error', commands, error: String(err.message ?? err).split('\n')[0] };
      }
      return { items, termination, commands };
    },
    async stop() {
      const sr = ctx.sr;
      ctx.sr = null;
      if (sr) await sr.stop();
    },
  };
}
