// Incremental evidence log: one JSON line per browser action, written synchronously so that
// observations survive a later step that throws or times out.
import fs from 'node:fs';

export const STEPS_FILE = 'steps.jsonl';
export const FOCUS_TIMEOUT_MS = 1000;

export function appendStep(file, record) {
  try {
    fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`);
  } catch {
    /* logging must never fail the run */
  }
}

/** Describes document.activeElement without ever waiting longer than `timeoutMs`.
 * Returns `{ focused, outcome }` where focused is `{role,name,selector}`, "document" or "none". */
export async function probeFocus(page, timeoutMs = FOCUS_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ focused: 'none', outcome: 'focus-timeout' }), timeoutMs); });
  const probe = page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { focused: 'none' };
    if (el === document.body || el === document.documentElement) return { focused: 'document' };
    const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const selector = el.id ? `#${el.id}` : el.tagName.toLowerCase();
    return { focused: { role: el.getAttribute('role') || el.tagName.toLowerCase(), name, selector } };
  }).then((r) => ({ ...r, outcome: 'ok' }), () => ({ focused: 'none', outcome: 'focus-timeout' }));
  try {
    return await Promise.race([probe, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
