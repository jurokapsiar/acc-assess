// AbleDOM real-time analysis. The npm package ships only CJS/ESM, so it is bundled into an IIFE
// once (cached) and injected with page.addInitScript before any app script runs.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { SKILL_DIR } from './wcag.mjs';

const require = createRequire(import.meta.url);
const CACHE = path.join(SKILL_DIR, '.cache');

// AbleDOM rule export -> WCAG mapping used for reporting.
export const ABLEDOM_RULES = {
  'focusable-element-label': { title: 'Focusable element has no accessible label', wcag: ['4.1.2', '2.4.6'], impact: 'serious', fix: 'Give the focusable element an accessible name (visible text, aria-label or aria-labelledby).' },
  'focusable-in-atomic': { title: 'Focusable element nested inside an atomic control', wcag: ['4.1.2'], impact: 'serious', fix: 'Move the nested focusable element out of the button/link/input, or make it non-focusable.' },
  contrast: { title: 'Insufficient text contrast', wcag: ['1.4.3'], impact: 'serious', fix: 'Raise the contrast between text and background to at least 4.5:1 (3:1 for large text).' },
  'missing-id': { title: 'ARIA/label reference points to a missing id', wcag: ['1.3.1', '4.1.2'], impact: 'serious', fix: 'Make aria-labelledby/aria-describedby/for reference ids that exist in the DOM while the element is rendered.' },
  'focus-lost': { title: 'Keyboard focus lost', wcag: ['2.4.3', '2.1.1'], impact: 'serious', fix: 'When the focused element is removed or hidden (closing a dialog, deleting an item), move focus programmatically to a logical element, e.g. the trigger or the next item.' },
  'bad-focus': { title: 'Focus moved to an invisible element', wcag: ['2.4.7', '2.4.3'], impact: 'serious', fix: 'Do not focus hidden elements; make the focus target visible or move focus to a visible element.' },
  'aria-required-parent': { title: 'Element is missing its required ARIA parent', wcag: ['1.3.1'], impact: 'serious', fix: 'Wrap the element in the required parent role (e.g. option in listbox, tab in tablist).' },
  'nested-interactive': { title: 'Interactive controls are nested', wcag: ['4.1.2'], impact: 'serious', fix: 'Do not nest interactive elements; restructure so each control is a sibling.' },
  tabindex: { title: 'Positive tabindex', wcag: ['2.4.3'], impact: 'moderate', kind: 'review', fix: 'Remove positive tabindex values; order focus through DOM order.' },
  'tabindex-non-interactive': { title: 'tabindex on a non-interactive element', wcag: [], impact: 'minor', fix: 'Remove tabindex from non-interactive elements or give them an interactive role and behaviour.' },
};

export async function abledomBundle() {
  const out = path.join(CACHE, `abledom-${require('abledom/package.json').version}.iife.js`);
  if (fs.existsSync(out)) return out;
  const { build } = await import('esbuild');
  fs.mkdirSync(CACHE, { recursive: true });
  await build({
    stdin: { contents: 'export * from "abledom";', resolveDir: SKILL_DIR },
    bundle: true,
    format: 'iife',
    globalName: 'AbleDOMLib',
    outfile: out,
    platform: 'browser',
    target: 'es2019',
    footer: { js: 'window.AbleDOMLib = AbleDOMLib;' },
    logLevel: 'silent',
  });
  return out;
}

export function abledomVersion() {
  return require('abledom/package.json').version;
}

// Runs in the page. Reports issues to Node through the exposed __a11yAbleDOM binding.
export const ABLEDOM_INIT = `
(() => {
  if (window.top !== window) return;
  const A = window.AbleDOMLib;
  if (!A) return;
  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return null;
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 6; e = e.parentElement) {
      if (e.id) { parts.unshift('#' + CSS.escape(e.id)); break; }
      let p = e.localName;
      const sib = e.parentElement ? [...e.parentElement.children].filter((c) => c.localName === e.localName) : [];
      if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')';
      parts.unshift(p);
    }
    return parts.join(' > ');
  };
  const send = (kind, element, rule, issue) => {
    const el = (issue && issue.element) || element;
    const rec = {
      kind, rule: rule && rule.name, id: issue && issue.id, message: issue && issue.message, help: issue && issue.help,
      selector: cssPath(el), html: el && el.outerHTML ? el.outerHTML.slice(0, 400) : null, t: Date.now(),
      inScope: !window.__a11yScope || !!(el && el.closest && el.closest(window.__a11yScope)),
      hidden: !!(el && el.isConnected && el.checkVisibility && !el.checkVisibility()),
    };
    try { window.__a11yAbleDOM && window.__a11yAbleDOM(rec); } catch {}
  };
  const start = () => {
    const ad = new A.AbleDOM(window, {
      headless: true,
      exposeInstanceForTesting: true,
      callbacks: {
        onIssueAdded: (el, rule, issue) => send('added', el, rule, issue),
        onIssueUpdated: (el, rule, issue) => send('updated', el, rule, issue),
        onIssueRemoved: (el, rule) => send('removed', el, rule, null),
      },
    });
    for (const R of ['AtomicRule', 'FocusableElementLabelRule', 'ContrastRule', 'ExistingIdRule', 'FocusLostRule',
      'BadFocusRule', 'RequiredParentRule', 'NestedInteractiveElementRule', 'TabIndexRule']) {
      if (A[R]) ad.addRule(new A[R]());
    }
    ad.start();
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
`;
