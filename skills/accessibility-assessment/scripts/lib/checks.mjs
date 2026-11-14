// Checks for criteria that axe-core cannot evaluate statically. Each returns raw findings
// ({ rule, title, wcag, impact, kind, nodes, fix, stepNote }) that assess.mjs normalises.

const SHOT = { animations: 'disabled', caret: 'hide' };

// ---------------------------------------------------------------- keyboard walk
// Overlay screens (`overlay: true`) record the element focused on open as stop 0 (before any Tab);
// `onInitial(stop)` runs before the first Tab so evidence (source, crop) is taken while the overlay
// is still open, and may return extra fields to merge into that stop.
export async function keyboardWalk(page, { scope, maxTabs = 40, modalHint = false, fromStart = false, overlay = false, onInitial = null } = {}) {
  const findings = [];
  const stops = [];
  const info = () => page.evaluate(focusInfoInPage, scope ?? null);

  if (fromStart) {
    // Start the tab sequence at the top of the scope (or document), independent of earlier steps.
    await page.evaluate((sel) => {
      const root = (sel && document.querySelector(sel)) || document.body;
      const s = document.createElement('span');
      s.tabIndex = -1;
      s.dataset.a11yStart = '';
      root.prepend(s);
      s.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }, scope ?? null);
  }
  const initial = await info();
  const scopeInfo = await page.evaluate(scopeInfoInPage, scope ?? null);
  const modal = modalHint || scopeInfo.modal;
  if (scope && scopeInfo.exists && modal && !initial.inScope) {
    findings.push({
      rule: 'focus-not-moved-into-dialog', title: 'Focus does not move into the dialog when it opens', wcag: ['2.4.3'], impact: 'serious', kind: 'failure',
      nodes: [{ selector: scope, html: scopeInfo.html, summary: `Focus is on ${initial.desc ?? 'the page body'} after opening.` }],
      fix: 'Move focus to the first focusable element (or the dialog title with tabindex="-1") when the dialog opens.', pattern: 'dialog-modal',
    });
  } else if (scope && scopeInfo.exists && overlay && !initial.inScope) {
    findings.push({
      rule: 'initial-focus-outside-overlay', title: 'Focus does not move into the overlay when it opens', wcag: ['2.4.3'], impact: 'moderate', kind: 'review',
      nodes: [{ selector: scope, html: scopeInfo.html, summary: `Focus is on ${initial.desc ?? 'the page body'} after opening.` }],
      fix: 'If keyboard users are expected to operate the overlay, move focus into it when it opens (or confirm the trigger keeps focus by design, e.g. a non-modal popup reached with Arrow keys).',
    });
  }
  const seen = new Map();
  let initialStop = null;
  if (overlay && scope && scopeInfo.exists && initial.selector && initial.inScope) {
    initialStop = { ...initial, index: 0, initial: true };
    if (onInitial) Object.assign(initialStop, (await onInitial(initialStop)) ?? {});
    if ((await info()).selector !== initial.selector) await page.focus(initial.selector).catch(() => {});
    seen.set(initial.selector, initialStop);
  }

  let prev = null;
  let prevShot = null;
  let repeats = 0;
  let exited = false;
  for (let i = 1; i <= maxTabs; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    const cur = await info();
    if (!cur.selector) {
      if (stops.length && seen.size) break; // focus left the document (end of tab sequence)
      continue;
    }
    // Focus indicator: compare the previous stop's region focused vs. unfocused.
    if (prev && prevShot && prev.selector !== cur.selector) {
      const after = await shotRegion(page, prev.rect);
      if (after && after.equals(prevShot) && !overlaps(prev.rect, cur.rect)) {
        findings.push({
          rule: 'focus-not-visible', title: 'No visible focus indicator', wcag: ['2.4.7'], impact: 'serious', kind: 'failure',
          nodes: [{ selector: prev.selector, html: prev.html, summary: 'Element looks identical focused and unfocused.' }], tabIndex: prev.index,
          fix: 'Add a :focus-visible style (e.g. outline: 2px solid currentColor; outline-offset: 2px) that differs clearly from the unfocused state.',
        });
      }
    }
    if (prev && prev.selector === cur.selector) {
      if (++repeats >= 2) {
        findings.push({
          rule: 'keyboard-trap', title: 'Keyboard focus is trapped', wcag: ['2.1.2'], impact: 'critical', kind: 'failure',
          nodes: [{ selector: cur.selector, html: cur.html, summary: 'Tab does not move focus away from this element.' }], tabIndex: stops.length,
          fix: 'Let Tab/Shift+Tab move focus out of the component; do not call preventDefault on Tab unless focus is moved programmatically.',
        });
        break;
      }
      continue;
    }
    repeats = 0;
    if (seen.has(cur.selector)) break; // cycle complete
    cur.index = stops.length + 1;
    seen.set(cur.selector, cur);
    stops.push(cur);

    if (scope && scopeInfo.exists && !cur.inScope) {
      if (modal) {
        findings.push({
          rule: 'focus-escapes-modal', title: 'Focus leaves the modal dialog', wcag: ['2.4.3'], impact: 'serious', kind: 'failure',
          nodes: [{ selector: cur.selector, html: cur.html, summary: `Tab stop ${cur.index} is outside ${scope}.` }], tabIndex: cur.index,
          fix: 'Contain the tab sequence inside the modal (focus trap, or make background inert with the inert attribute / <dialog>.showModal()).', pattern: 'dialog-modal',
        });
      }
      stops.pop(); // the parent screen owns elements outside a non-modal overlay
      exited = true;
      break;
    }
    if (cur.obscured === 'full') {
      findings.push({
        rule: 'focus-obscured', title: 'Focused element is hidden by other content', wcag: ['2.4.11'], impact: 'serious', kind: 'failure',
        nodes: [{ selector: cur.selector, html: cur.html, summary: `Covered by ${cur.coveredBy}.` }], tabIndex: cur.index,
        fix: 'Ensure sticky/fixed content does not cover focused elements (e.g. scroll-padding-top equal to the sticky header height).',
      });
    } else if (cur.obscured === 'partial') {
      findings.push({
        rule: 'focus-partially-obscured', title: 'Focused element is partly hidden by other content', wcag: ['2.4.12'], impact: 'minor', kind: 'suggestion',
        nodes: [{ selector: cur.selector, html: cur.html, summary: `Partly covered by ${cur.coveredBy}.` }], tabIndex: cur.index,
        fix: 'Keep the whole focused element visible, e.g. with scroll-padding.',
      });
    }
    prev = cur;
    prevShot = await shotRegion(page, cur.rect);
  }

  await page.evaluate(() => document.querySelectorAll('[data-a11y-start]').forEach((s) => s.remove()));
  const unreachable = await page.evaluate(unreachableInPage, scope ?? null);
  for (const u of unreachable) {
    findings.push({
      rule: 'not-keyboard-focusable', title: 'Interactive element cannot be reached with the keyboard', wcag: ['2.1.1'], impact: 'serious', kind: 'failure',
      nodes: [{ selector: u.selector, html: u.html, summary: `role="${u.role}" is not focusable and no aria-activedescendant container manages it.` }],
      fix: 'Use a native element (button, a[href], input) or add tabindex="0" plus keyboard handlers (Enter/Space) matching the role.',
    });
  }
  if (initialStop) stops.unshift(initialStop);
  // Tab leaving an overlay at once is normal for composites (menu, listbox) that move with Arrow keys.
  let note = null;
  if (overlay && scope && scopeInfo.exists && !stops.some((st) => !st.initial)) {
    note = initialStop && exited
      ? 'Tab exits the overlay from its initially focused element; arrow-key navigation inside it was not measured.'
      : initialStop ? 'Only the initially focused element was reached inside the overlay.' : 'No focusable elements were reached inside the overlay.';
  }
  return { findings, stops, modal, note };
}

function overlaps(a, b) {
  if (!a || !b) return false;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function shotRegion(page, rect) {
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  const vp = page.viewportSize();
  const pad = 6;
  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  const width = Math.min(vp.width - x, rect.width + pad * 2);
  const height = Math.min(vp.height - y, rect.height + pad * 2);
  if (width < 2 || height < 2) return null;
  try {
    return await page.screenshot({ ...SHOT, clip: { x, y, width, height } });
  } catch {
    return null;
  }
}

// Runs in page.
function focusInfoInPage(scopeSel) {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { selector: null, desc: 'the page body' };
  const path = (e) => {
    const parts = [];
    for (let n = e; n && n.nodeType === 1 && parts.length < 6; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let p = n.localName;
      const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.localName === n.localName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(n) + 1})`;
      parts.unshift(p);
    }
    return parts.join(' > ');
  };
  let r = el.getBoundingClientRect();
  const tiny = r.width < 4 || r.height < 4;
  // Visually hidden inputs (e.g. slider/switch internals) draw focus on an ancestor.
  for (let a = el.parentElement; (r.width < 4 || r.height < 4) && a && a !== document.body; a = a.parentElement) r = a.getBoundingClientRect();
  const rect = { x: r.x, y: r.y, width: r.width, height: r.height };
  // Obscured: sample points inside the element and check what is on top (meaningless for zero-size elements).
  let hits = 0;
  let total = 0;
  let coveredBy = null;
  const pts = tiny ? [] : [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
  for (const [fx, fy] of pts) {
    const x = r.x + r.width * fx;
    const y = r.y + r.height * fy;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
    total++;
    const top = document.elementFromPoint(x, y);
    if (top && (el.contains(top) || top.contains(el))) hits++;
    else if (top) coveredBy = coveredBy ?? path(top);
  }
  const scope = scopeSel ? document.querySelector(scopeSel) : null;
  const name = el.getAttribute('aria-label') || el.innerText?.trim().slice(0, 60) || el.getAttribute('title') || '';
  return {
    selector: path(el),
    html: el.outerHTML.slice(0, 300),
    role: el.getAttribute('role') || el.localName,
    name,
    desc: `${el.getAttribute('role') || el.localName} “${name}”`,
    rect,
    box: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height }, // document coords, for results.json areas
    inScope: scopeSel ? !!(scope && scope.contains(el)) : true,
    obscured: total && hits === 0 ? 'full' : total && hits < total ? 'partial' : null,
    coveredBy,
  };
}

function scopeInfoInPage(scopeSel) {
  const el = scopeSel ? document.querySelector(scopeSel) : null;
  if (!el) return { exists: false, modal: false };
  let modal = el.getAttribute('aria-modal') === 'true';
  try { modal = modal || el.matches(':modal'); } catch {}
  return { exists: true, modal, html: el.outerHTML.slice(0, 200) };
}

function unreachableInPage(scopeSel) {
  const root = (scopeSel && document.querySelector(scopeSel)) || document.body;
  const roles = ['button', 'link', 'checkbox', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'slider', 'combobox', 'textbox', 'spinbutton', 'searchbox', 'treeitem', 'gridcell'];
  const out = [];
  for (const el of root.querySelectorAll(roles.map((r) => `[role="${r}"]`).join(','))) {
    if (el.hasAttribute('tabindex') || el.tabIndex >= 0) continue;
    if (el.closest('[aria-activedescendant]') || el.closest('[aria-disabled="true"],[disabled],[inert],[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden') continue;
    // Roving tabindex containers keep only one item focusable.
    const group = el.closest('[role=tablist],[role=radiogroup],[role=menu],[role=menubar],[role=listbox],[role=tree],[role=grid],[role=treegrid],[role=toolbar]');
    if (group && group.querySelector('[tabindex="0"]')) continue;
    if (el.querySelector('a[href],button,input,select,textarea,[tabindex="0"]')) continue;
    out.push({ role: el.getAttribute('role'), html: el.outerHTML.slice(0, 300), selector: cssPathOf(el) });
    if (out.length >= 10) break;
  }
  return out;
  function cssPathOf(e) {
    const parts = [];
    for (let n = e; n && n.nodeType === 1 && parts.length < 6; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let p = n.localName;
      const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.localName === n.localName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(n) + 1})`;
      parts.unshift(p);
    }
    return parts.join(' > ');
  }
}

// ---------------------------------------------------------------- overlay dismissal
export async function escapeCheck(page, { scope, triggerLocator, type }) {
  const findings = [];
  if (!scope || !(await page.locator(scope).first().isVisible().catch(() => false))) return findings;
  const pattern = type === 'menu' ? 'menu-button' : type === 'dialog' ? 'dialog-modal' : 'dialog-modal';
  // Make sure focus is inside the overlay first (APG: focus moves into dialogs/menus on open).
  const focusInside = await page.evaluate((s) => document.querySelector(s)?.contains(document.activeElement), scope);
  if (!focusInside) await page.locator(scope).first().focus().catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const stillOpen = await page.locator(scope).first().isVisible().catch(() => false);
  if (stillOpen) {
    findings.push({
      rule: 'escape-does-not-close', title: 'Escape does not close the overlay', wcag: [], impact: 'moderate', kind: 'suggestion', pattern,
      nodes: [{ selector: scope, summary: 'Overlay is still visible after pressing Escape.' }],
      fix: 'Close the overlay on Escape and return focus to the element that opened it.',
    });
    return findings;
  }
  const active = await page.evaluate(() => {
    const el = document.activeElement;
    return !el || el === document.body ? null : el.outerHTML.slice(0, 200);
  });
  let onTrigger = false;
  let triggerVisible = false;
  if (triggerLocator) {
    triggerVisible = await triggerLocator.isVisible().catch(() => false);
    onTrigger = triggerVisible && (await triggerLocator.evaluate((el) => el === document.activeElement || el.contains(document.activeElement)).catch(() => false));
  }
  if (!active) {
    findings.push({
      rule: 'focus-not-restored', title: 'Focus is lost when the overlay closes', wcag: ['2.4.3'], impact: 'serious', kind: 'failure', pattern,
      nodes: [{ selector: 'body', summary: 'After Escape, focus moved to the page body.' }],
      fix: 'Return focus to the element that opened the overlay (or a logical successor if it no longer exists).',
    });
  } else if (triggerVisible && !onTrigger) {
    findings.push({
      rule: 'focus-not-returned-to-trigger', title: 'Focus does not return to the trigger when the overlay closes', wcag: [], impact: 'moderate', kind: 'suggestion', pattern,
      nodes: [{ html: active, summary: 'After Escape, focus is on this element instead of the trigger.' }],
      fix: 'Return focus to the element that opened the overlay.',
    });
  }
  return findings;
}

// ---------------------------------------------------------------- reflow (1.4.10)
export async function reflowCheck(page) {
  const res = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - vw;
    if (overflow <= 1) return { overflow: 0, offenders: [] };
    const offenders = [];
    const scrollable = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
      }
      return false;
    };
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0 && r.height > 0 && !scrollable(el)) {
        if (offenders.some((o) => o.el.contains(el))) continue;
        offenders.push({ el, right: Math.round(r.right) });
        if (offenders.length >= 5) break;
      }
    }
    return { overflow, offenders: offenders.map((o) => ({ html: o.el.outerHTML.slice(0, 250), right: o.right, tag: o.el.localName })) };
  });
  if (!res.overflow) return [];
  return [{
    rule: 'reflow-horizontal-scroll', title: 'Content requires horizontal scrolling at 320 CSS px', wcag: ['1.4.10'], impact: 'serious', kind: 'failure',
    nodes: res.offenders.length
      ? res.offenders.map((o) => ({ html: o.html, summary: `Extends to ${o.right}px (viewport 320px).` }))
      : [{ summary: `Page is ${res.overflow}px wider than the viewport.` }],
    fix: 'Let layouts wrap at narrow widths: use flex-wrap, minmax() grid tracks, max-width: 100%, and avoid fixed widths.',
  }];
}

// ---------------------------------------------------------------- text spacing (1.4.12)
const TEXT_SPACING_CSS = `*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}`;

// `whileApplied(rawFindings)` runs while the spacing override is still in place, so callers can
// capture box/identity/source/crops of the clipped (failing) state; its return value replaces
// the raw findings. The override is always removed afterwards.
export async function textSpacingCheck(page, scope, { whileApplied } = {}) {
  const clipped = () => page.evaluate((s) => {
    const root = (s && document.querySelector(s)) || document.body;
    const pathOf = (e) => {
      const parts = [];
      for (let n = e; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
        if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
        let p = n.localName;
        const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.localName === n.localName) : [];
        if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(n) + 1})`;
        parts.unshift(p);
      }
      return parts.join(' > ');
    };
    const out = [];
    for (const el of root.querySelectorAll('*')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      for (let e = el, d = 0; e && d < 3; e = e.parentElement, d++) {
        const cs = getComputedStyle(e);
        const clipsX = ['hidden', 'clip'].includes(cs.overflowX);
        const clipsY = ['hidden', 'clip'].includes(cs.overflowY);
        if ((clipsY && e.scrollHeight > e.clientHeight + 2) || (clipsX && e.scrollWidth > e.clientWidth + 2)) {
          const r = el.getBoundingClientRect();
          if (r.width && r.height) out.push({ key: el.outerHTML.slice(0, 250), text: el.textContent.trim().slice(0, 80), selector: pathOf(el) });
          break;
        }
      }
    }
    return out;
  }, scope ?? null);
  const before = new Set((await clipped()).map((c) => c.key));
  const style = await page.addStyleTag({ content: TEXT_SPACING_CSS });
  try {
    await page.waitForTimeout(200);
    const after = (await clipped()).filter((c) => !before.has(c.key)).slice(0, 8);
    if (!after.length) return [];
    const raw = [{
      rule: 'text-spacing-clipping', title: 'Text is clipped when text spacing is increased', wcag: ['1.4.12'], impact: 'moderate', kind: 'review',
      nodes: after.map((c) => ({ selector: c.selector, html: c.key, summary: `“${c.text}” overflows a clipping container with WCAG text-spacing overrides.` })),
      fix: 'Avoid fixed heights and overflow: hidden on text containers; use min-height and let containers grow.',
    }];
    return whileApplied ? await whileApplied(raw) : raw;
  } finally {
    await style.evaluate((n) => n.remove()).catch(() => {});
  }
}
