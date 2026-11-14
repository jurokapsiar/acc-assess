// In-page helpers, installed with `page.addInitScript()` (serialised by Playwright, so every
// function here must be fully self-contained). They only READ the DOM (accessible name/role/
// state approximations, dialogs, live regions, error texts, headings, landmarks, reading
// items) and never mutate the app; nothing here records field values (secrets-safe).
//
// `installPageHelpers` is used with every driver: its `facts()` snapshot is the DOM ground
// truth the narration is compared against. `installMockSpeech` is used only by the mock
// driver: it synthesises NVDA-style phrases from focus/live-region/state events so the whole
// pipeline can be tested without a screen reader. Its output is an approximation, never
// evidence of real screen reader behaviour.

export function installPageHelpers() {
  if (window.__a11ySr) return;
  const WIDGET_ROLES = ['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'switch', 'slider', 'spinbutton', 'treeitem', 'gridcell'];
  const NAME_FROM_CONTENT = ['button', 'link', 'heading', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'checkbox', 'radio', 'switch', 'treeitem', 'cell', 'gridcell', 'columnheader', 'rowheader', 'tooltip'];
  const ROLE_WORDS = {
    button: 'button', link: 'link', textbox: 'edit', searchbox: 'edit', checkbox: 'check box', radio: 'radio button',
    combobox: 'combo box', listbox: 'list', option: 'option', tab: 'tab', menuitem: 'menu item', menuitemcheckbox: 'menu item',
    menuitemradio: 'menu item', switch: 'switch', slider: 'slider', spinbutton: 'spin button', treeitem: 'tree view item',
    dialog: 'dialog', alertdialog: 'dialog', img: 'graphic', heading: 'heading',
  };
  const LANDMARKS = ['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'form', 'region'];
  const LIVE_SEL = '[aria-live]:not([aria-live="off"]),[role="status"],[role="alert"],[role="log"],output';
  const DIALOG_SEL = 'dialog[open],[role="dialog"],[role="alertdialog"]';
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

  function hidden(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.closest('[aria-hidden="true"],[hidden],[inert]')) return true;
    if (!el.getClientRects().length) return true;
    const cs = getComputedStyle(el);
    return cs.visibility === 'hidden' || cs.display === 'none';
  }

  function inputRole(el) {
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (t === 'hidden') return null;
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
    if (t === 'range') return 'slider';
    if (t === 'number') return 'spinbutton';
    if (t === 'search') return 'searchbox';
    return 'textbox';
  }

  // Author-provided name only (form/section become landmarks only when labelled this way).
  function labelled(el) {
    return !!(clean(el.getAttribute('aria-label')) || (el.getAttribute('aria-labelledby') && byIds(el.getAttribute('aria-labelledby'))) || clean(el.getAttribute('title')));
  }

  function role(el) {
    if (!el || el.nodeType !== 1) return null;
    const explicit = clean(el.getAttribute('role')).split(' ')[0];
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return 'heading';
    switch (tag) {
      case 'a': case 'area': return el.hasAttribute('href') ? 'link' : null;
      case 'button': case 'summary': return 'button';
      case 'input': return inputRole(el);
      case 'select': return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
      case 'textarea': return 'textbox';
      case 'nav': return 'navigation';
      case 'main': return 'main';
      case 'aside': return 'complementary';
      case 'header': return el.closest('main,article,aside,nav,section') ? null : 'banner';
      case 'footer': return el.closest('main,article,aside,nav,section') ? null : 'contentinfo';
      case 'form': return labelled(el) ? 'form' : null;
      case 'section': return labelled(el) ? 'region' : null;
      case 'search': return 'search';
      case 'dialog': return 'dialog';
      case 'img': return el.getAttribute('alt') === '' ? 'presentation' : 'img';
      case 'ul': case 'ol': return 'list';
      case 'li': return 'listitem';
      case 'table': return 'table';
      case 'output': return 'status';
      default: return null;
    }
  }

  function textOf(node, depth = 0) {
    if (depth > 20) return '';
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    if (node.getAttribute('aria-hidden') === 'true') return '';
    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'template', 'noscript'].includes(tag)) return '';
    if (depth > 0 && node.getClientRects && !node.getClientRects().length && tag !== 'br') return '';
    if (depth > 0 && node.hasAttribute('aria-label')) return ` ${node.getAttribute('aria-label')} `;
    if (tag === 'img') return ` ${node.getAttribute('alt') ?? ''} `;
    if (tag === 'svg') return ` ${node.querySelector('title')?.textContent ?? ''} `;
    let out = '';
    for (const c of node.childNodes) out += textOf(c, depth + 1);
    const block = depth > 0 && /^(p|div|li|h[1-6]|br|tr|section|article)$/.test(tag);
    return block ? ` ${out} ` : out;
  }

  function byIds(ids) {
    return clean(String(ids).split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => textOf(n)).join(' '));
  }

  function name(el) {
    if (!el || el.nodeType !== 1) return '';
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const v = byIds(lb); if (v) return v; }
    const al = clean(el.getAttribute('aria-label'));
    if (al) return al;
    const tag = el.tagName.toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag)) {
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'input' && ['button', 'submit', 'reset'].includes(t)) return clean(el.value || (t === 'submit' ? 'Submit' : t === 'reset' ? 'Reset' : ''));
      if (tag === 'input' && t === 'image') return clean(el.getAttribute('alt'));
      const lbl = el.labels && [...el.labels].map((l) => textOf(l)).join(' ');
      if (clean(lbl)) return clean(lbl);
      if (clean(el.getAttribute('title'))) return clean(el.getAttribute('title'));
      return clean(el.getAttribute('placeholder'));
    }
    if (tag === 'img') return clean(el.getAttribute('alt') ?? el.getAttribute('title'));
    if (['dialog', 'fieldset', 'table', 'figure'].includes(tag)) {
      const cap = el.querySelector(':scope > legend, :scope > caption, :scope > figcaption');
      if (cap) return clean(textOf(cap));
    }
    const r = role(el);
    if (NAME_FROM_CONTENT.includes(r)) { const v = clean(textOf(el)); if (v) return v; }
    if (!r && el.tabIndex >= 0 && el.hasAttribute('tabindex')) { const v = clean(textOf(el)); if (v) return v; }
    return clean(el.getAttribute('title'));
  }

  function states(el) {
    const a = (k) => el.getAttribute(k);
    const tag = el.tagName.toLowerCase();
    const native = tag === 'input' && ['checkbox', 'radio'].includes((a('type') || '').toLowerCase());
    return {
      expanded: a('aria-expanded') === 'true' ? true : a('aria-expanded') === 'false' ? false : null,
      pressed: a('aria-pressed') === 'true' ? true : a('aria-pressed') === 'false' ? false : null,
      checked: native ? el.checked : a('aria-checked') === 'true' ? true : a('aria-checked') === 'false' ? false : null,
      selected: a('aria-selected') === 'true' ? true : null,
      invalid: a('aria-invalid') === 'true' || a('aria-invalid') === 'grammar' || a('aria-invalid') === 'spelling',
      required: el.required === true || a('aria-required') === 'true',
      disabled: el.disabled === true || a('aria-disabled') === 'true',
    };
  }

  function stateWords(el, r, s) {
    const w = [];
    if (s.expanded !== null) w.push(s.expanded ? 'expanded' : 'collapsed');
    if (s.pressed !== null) w.push(s.pressed ? 'pressed' : 'not pressed');
    if (s.checked !== null) w.push(r === 'switch' ? (s.checked ? 'on' : 'off') : s.checked ? 'checked' : 'not checked');
    if (s.selected) w.push('selected');
    if (s.disabled) w.push('unavailable');
    if (s.invalid) w.push('invalid entry');
    if (s.required) w.push('required');
    return w;
  }

  function roleWord(el, r = role(el)) {
    if (r === 'button' && el.hasAttribute('aria-pressed')) return 'toggle button';
    if (r === 'button' && el.getAttribute('aria-haspopup') && el.getAttribute('aria-haspopup') !== 'false') return 'menu button';
    if (r === 'heading') return `heading level ${Number(el.getAttribute('aria-level')) || Number(el.tagName.slice(1)) || 2}`;
    return ROLE_WORDS[r] ?? null;
  }

  function isNative(el) {
    const tag = el.tagName.toLowerCase();
    return (tag === 'a' && el.hasAttribute('href')) || ['button', 'select', 'textarea', 'summary'].includes(tag) || (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() !== 'hidden');
  }

  function interactive(el) {
    if (!el || el.nodeType !== 1 || el === document.body) return false;
    return isNative(el) || WIDGET_ROLES.includes(role(el)) || (el.hasAttribute('tabindex') && el.tabIndex >= 0) || el.isContentEditable;
  }

  // NVDA-like focus phrase: "<name> <role> <states>", "blank" for an empty edit field. Field
  // values are never spoken by the mock (secrets-safe); a filled field reads "has text".
  function describe(el) {
    if (!el || el.nodeType !== 1 || el === document.body) return '';
    const r = role(el);
    const s = states(el);
    const parts = [name(el), roleWord(el, r), ...stateWords(el, r, s)];
    if (r === 'textbox' || r === 'searchbox' || r === 'combobox' && el.tagName.toLowerCase() === 'input') {
      const t = (el.getAttribute('type') || '').toLowerCase();
      parts.push(el.value ? (t === 'password' ? 'protected' : 'has text') : 'blank');
    }
    return clean(parts.filter(Boolean).join(' '));
  }

  function selector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el === document.body) return 'body';
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 5; n = n.parentElement) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id) && document.querySelectorAll(`#${n.id}`).length === 1) { parts.unshift(`#${n.id}`); break; }
      let p = n.tagName.toLowerCase();
      const sibs = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (sibs.length > 1) p += `:nth-of-type(${sibs.indexOf(n) + 1})`;
      parts.unshift(p);
    }
    return parts.join(' > ');
  }

  function html(el) {
    if (!el || el.nodeType !== 1) return '';
    const s = el.outerHTML
      .replace(/\svalue\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/gi, '$1$2');
    return s.length > 300 ? `${s.slice(0, 297)}...` : s;
  }

  function rect(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) };
  }

  const visibleAll = (sel) => [...document.querySelectorAll(sel)].filter((el) => !hidden(el));

  function dialogs() {
    return visibleAll(DIALOG_SEL).map((d) => ({ key: selector(d), name: name(d), modal: d.getAttribute('aria-modal') === 'true' || (d.matches && (() => { try { return d.matches(':modal'); } catch { return false; } })()) }));
  }

  function dialogOf(el) {
    if (!el || el.nodeType !== 1) return null;
    const d = el.closest(DIALOG_SEL);
    return d && !hidden(d) ? d : null;
  }

  function live() {
    return [...document.querySelectorAll(LIVE_SEL)].map((r) => ({
      key: selector(r),
      role: r.getAttribute('role') || (r.tagName.toLowerCase() === 'output' ? 'status' : null),
      politeness: r.getAttribute('aria-live') || (r.getAttribute('role') === 'alert' ? 'assertive' : 'polite'),
      text: hidden(r) ? '' : clean(textOf(r)).slice(0, 300),
    }));
  }

  function errors() {
    const out = new Map();
    for (const f of visibleAll('[aria-invalid="true"]')) {
      const ids = [f.getAttribute('aria-errormessage'), f.getAttribute('aria-describedby')].filter(Boolean).join(' ');
      out.set(selector(f), { selector: selector(f), field: name(f), text: ids ? byIds(ids).slice(0, 300) : '', kind: 'invalid' });
    }
    for (const a of visibleAll('[role="alert"]')) {
      const t = clean(textOf(a));
      if (t) out.set(selector(a), { selector: selector(a), text: t.slice(0, 300), kind: 'alert' });
    }
    for (const e of visibleAll('[id*="error" i],[class*="error" i],[id*="invalid" i],[class*="invalid" i]')) {
      if (e.querySelector('[id*="error" i],[class*="error" i]') || interactive(e)) continue;
      const t = clean(textOf(e));
      if (t && t.length < 300 && !out.has(selector(e))) out.set(selector(e), { selector: selector(e), text: t, kind: 'text' });
    }
    return [...out.values()];
  }

  function focusInfo() {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return { isBody: true, selector: 'body' };
    const r = role(el);
    const d = dialogOf(el);
    // Evidence that a role-less focus target is meant to be operated (not just a focusable
    // paragraph/heading moved to programmatically): a click handler or a pointer cursor.
    const widgetLike = !!(el.hasAttribute('onclick') || typeof el.onclick === 'function' || (el.hasAttribute('tabindex') && getComputedStyle(el).cursor === 'pointer'));
    return {
      isBody: false, selector: selector(el), tag: el.tagName.toLowerCase(), role: r, roleWord: roleWord(el, r), name: name(el),
      explicitRole: el.hasAttribute('role'), native: isNative(el), interactive: interactive(el), widgetLike, states: states(el),
      dialog: d ? selector(d) : null, html: html(el), box: rect(el),
    };
  }

  function headings() {
    return visibleAll('h1,h2,h3,h4,h5,h6,[role="heading"]').map((h) => ({ level: Number(h.getAttribute('aria-level')) || Number(h.tagName.slice(1)) || 2, text: clean(textOf(h)).slice(0, 120), box: rect(h) }));
  }

  function landmarks() {
    return visibleAll('main,nav,aside,header,footer,form,section,search,[role]').map((el) => ({ el, r: role(el) }))
      .filter(({ r }) => LANDMARKS.includes(r)).map(({ el, r }) => ({ role: r, name: name(el), selector: selector(el) }));
  }

  // Virtual-cursor-like items in DOM order: controls, images, headings, and elements carrying
  // their own text. Used by the reading-order probe (mock) and to place spoken items (real).
  function readingItems(max = 80) {
    const items = [];
    const walk = (el) => {
      if (items.length >= max || hidden(el)) return;
      const r = role(el);
      const tag = el.tagName.toLowerCase();
      if (interactive(el) || r === 'heading' || r === 'img') {
        const t = describe(el) || clean(textOf(el));
        if (t) items.push({ text: t.slice(0, 120), selector: selector(el), box: rect(el) });
        return;
      }
      if (['script', 'style', 'template', 'svg'].includes(tag)) return;
      const own = clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' '));
      if (own) items.push({ text: clean(textOf(el)).slice(0, 120), selector: selector(el), box: rect(el) });
      else for (const c of el.children) walk(c);
    };
    if (document.body) for (const c of document.body.children) walk(c);
    return items;
  }

  function locateTexts(texts) {
    const items = readingItems(200);
    const norm = (s) => clean(s).toLowerCase();
    return texts.map((t) => {
      const n = norm(t);
      if (!n) return null;
      const hit = items.find((i) => norm(i.text) === n) ?? items.find((i) => n.includes(norm(i.text)) && norm(i.text).length > 2) ?? items.find((i) => norm(i.text).includes(n));
      return hit ? { selector: hit.selector, box: hit.box } : null;
    });
  }

  function facts() {
    return { url: location.href, title: document.title, focus: focusInfo(), dialogs: dialogs(), live: live(), errors: errors() };
  }

  // Fields the replay must never type into (resolved DOM semantics, not the plan's wording).
  function sensitive(el) {
    if (!el || el.nodeType !== 1) return null;
    const a = (k) => String(el.getAttribute(k) ?? '');
    if (a('type').toLowerCase() === 'password') return 'password field';
    if (/password|one-time-code|cc-/i.test(a('autocomplete'))) return `autocomplete="${a('autocomplete')}"`;
    const words = [el.id, a('name'), a('aria-label'), a('placeholder'), el.labels ? [...el.labels].map((l) => l.textContent).join(' ') : '', name(el)].join(' ');
    const m = words.match(/passw|passcode|passphrase|secret|token|\botp\b|\bpin\b|cvv|cvc|security code/i);
    return m ? `field described as "${m[0]}"` : null;
  }

  window.__a11ySr = { LIVE_SEL, clean, hidden, role, name, states, describe, textOf, selector, html, dialogs, dialogOf, live, errors, facts, headings, landmarks, readingItems, locateTexts, sensitive };
}

export function installMockSpeech() {
  const H = window.__a11ySr;
  if (!H || H.mock) return;
  const st = { log: [], last: '', dialog: null, known: new WeakSet() };
  const speak = (s) => {
    const t = H.clean(s);
    if (!t) return;
    st.log.push(t);
    st.last = t;
  };
  H.mock = {
    take() { const l = st.log; st.log = []; return l; },
    last() { return st.last; },
    clear() { st.log = []; },
  };
  const scan = () => document.querySelectorAll(H.LIVE_SEL).forEach((r) => st.known.add(r));
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    const d = H.dialogOf(el);
    if (d && d !== st.dialog) speak(`${H.name(d)} dialog`);
    st.dialog = d;
    speak(H.describe(el));
  }, true);
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el === document.activeElement && el.matches?.('input[type=checkbox],input[type=radio]')) speak(el.checked ? 'checked' : 'not checked');
  }, true);
  const STATE_ATTRS = ['aria-expanded', 'aria-pressed', 'aria-checked', 'aria-selected'];
  new MutationObserver((muts) => {
    const changed = new Set();
    for (const m of muts) {
      if (m.type === 'attributes') {
        if (m.target === document.activeElement && STATE_ATTRS.includes(m.attributeName)) {
          const v = m.target.getAttribute(m.attributeName);
          const words = { 'aria-expanded': ['expanded', 'collapsed'], 'aria-pressed': ['pressed', 'not pressed'], 'aria-checked': ['checked', 'not checked'], 'aria-selected': ['selected', ''] }[m.attributeName];
          speak(v === 'true' ? words[0] : words[1]);
        }
        continue;
      }
      const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      const region = el?.closest?.(H.LIVE_SEL);
      if (region && st.known.has(region)) changed.add(region);
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        // Screen readers generally announce an alert when it is inserted, but not a polite
        // region that is inserted together with its content (it must exist beforehand).
        if (n.matches('[role="alert"]')) changed.add(n);
        n.querySelectorAll?.('[role="alert"]').forEach((a) => changed.add(a));
      }
    }
    for (const r of changed) if (!H.hidden(r)) speak(H.textOf(r));
    scan();
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: STATE_ATTRS });
  document.addEventListener('DOMContentLoaded', () => {
    scan();
    if (document.title) speak(`${document.title} document`);
  });
}
