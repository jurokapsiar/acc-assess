// Mock driver: no screen reader. Narration is synthesised in the page (inpage.mjs
// `installMockSpeech`) from focus, state and live-region events with NVDA-like wording, so the
// replay -> analyse -> report pipeline is testable anywhere (CI, Linux). Its narration is an
// approximation and must never be reported as evidence of real screen reader behaviour.
import { installMockSpeech } from '../inpage.mjs';

export function createMockDriver({ focusModeSweeps = 0 } = {}) {
  let page = null;
  let sweepsInFocusMode = focusModeSweeps; // test hook: the first N sweeps leave the simulated reader in focus mode
  let focusMode = false;
  let forcedBrowse = false;
  const drain = async () => {
    if (!page || page.isClosed()) return [];
    return page.evaluate(() => window.__a11ySr?.mock?.take() ?? []).catch(() => []);
  };
  const editable = () => page.evaluate(() => {
    const e = document.activeElement;
    return !!e && e !== document.body && (/^(input|textarea|select)$/i.test(e.tagName) || e.isContentEditable);
  }).catch(() => false);
  const readerMode = async () => ({ mode: focusMode || (!forcedBrowse && await editable()) ? 'focus' : 'browse', confidence: 'simulated' });
  const run = async (fn, settle) => {
    const pre = await drain();
    let error = null;
    try { await fn(); } catch (err) { error = err; }
    if (settle && !page.isClosed()) await page.waitForTimeout(settle);
    return { pre, phrases: await drain(), health: 'simulated', ...(error ? { error } : {}) };
  };
  return {
    name: 'mock',
    label: 'Mock (simulated narration)',
    kind: 'mock',
    settleMs: 100,
    async start() {},
    async attach(p) {
      page = p;
      focusMode = false;
      forcedBrowse = false;
      await p.addInitScript(installMockSpeech);
    },
    async align() { return []; },
    readerMode,
    async ensureBrowseMode() {
      const m = await readerMode();
      if (m.mode === 'browse') return { ...m, changed: false, phrases: [] };
      focusMode = false;
      forcedBrowse = true;
      return { mode: 'browse', confidence: 'simulated', changed: true, phrases: [] };
    },
    async capture(fn, { settle = 100 } = {}) { return run(fn, settle); },
    async keys(keys, { settle = 100 } = {}) {
      return run(async () => { for (const k of keys) await page.keyboard.press(k); }, settle);
    },
    async take() { return drain(); },
    async probe(p, kind) {
      if (sweepsInFocusMode > 0) {
        // Simulates a reader that slipped into focus mode mid-sweep: its output is meaningless.
        sweepsInFocusMode--;
        focusMode = true;
        return { items: [{ text: 'edit blank' }], termination: 'end', commands: ['DOM (simulated focus mode)'] };
      }
      const items = await p.evaluate((k) => {
        const H = window.__a11ySr;
        if (k === 'headings') return H.headings().map((h) => ({ text: `${h.text} heading level ${h.level}`, box: h.box }));
        if (k === 'landmarks') return H.landmarks().map((l) => ({ text: `${l.name ? `${l.name} ` : ''}${l.role} landmark`, selector: l.selector }));
        return H.readingItems(40);
      }, kind);
      const commands = { headings: ['DOM headings'], landmarks: ['DOM landmarks'], reading: ['DOM reading order'] }[kind];
      return { items, termination: 'end', commands };
    },
    async stop() { page = null; },
  };
}
