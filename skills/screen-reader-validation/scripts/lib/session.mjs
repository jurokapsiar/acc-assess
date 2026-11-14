// Replays journey plans with a screen reader attached and records, per step: the action and
// the input actually dispatched (key / mouse button / programmatic operation), the narration
// captured around that action (plus late phrases that arrived before the next one), the DOM
// facts before and after (focus, dialogs, live regions, errors; inpage.mjs), the capture
// health and a screenshot. Afterwards, one "probe" per distinct start page sweeps headings,
// landmarks and the reading order with the reader's own navigation commands.
//
// Secrets: typing into a sensitive field (resolved in the DOM: password, one-time code,
// payment, PIN...) is refused; every typed value is redacted from the records; sensitive
// fields are masked in screenshots.
import fs from 'node:fs';
import path from 'node:path';
import { importSiblingLib, launchChromium } from './deps.mjs';
import { installPageHelpers } from './inpage.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAV_ACTIONS = new Set(['goto', 'reload']);
const TYPING = new Set(['fill', 'type']);
const BUTTONS = ['left', 'right', 'middle'];
export const SENSITIVE_MASK = 'input[type=password i], [autocomplete*=password i], [autocomplete*="cc-" i], [autocomplete*=one-time-code i]';
const firstLine = (err) => String(err?.message ?? err).split('\n')[0];
const SR_MODALITIES = new Set(['sr-keyboard', 'sr-navigation']);
const KEY_ACTIONS = new Set(['click', 'dblclick', 'check', 'uncheck', 'select', 'focus', 'fill', 'type', 'press']);

// Page whose `keyboard.press` is routed through the reader driver (OS-level keys on a real
// reader); every other member is the real page. The speech each key caused is collected in `said`.
// A freshly opened browser window keeps the OS keyboard focus in its own UI (toolbar, tab
// search), so Tab/Enter would drive the browser chrome instead of the page. (Playwright emulates
// page focus, so `document.hasFocus()` cannot tell.) A bare Shift key is sent through the reader
// as a probe: if the page saw no keydown, F6 cycles the browser panes and the probe is repeated.
// Neither key moves element focus in the page.
async function ensureContentFocus(page, driver, said, keys) {
  const seen = () => page.evaluate(() => { const n = window.__srKeyProbe ?? 0; window.__srKeyProbe = 0; return n; }).catch(() => 1);
  await page.evaluate(() => {
    if (!window.__srKeyProbeInstalled) { window.__srKeyProbeInstalled = true; window.addEventListener('keydown', () => { window.__srKeyProbe = (window.__srKeyProbe ?? 0) + 1; }, true); }
    window.__srKeyProbe = 0;
  }).catch(() => {});
  const send = async (k) => {
    keys.push(k);
    const r = await driver.keys([k], { settle: 100 });
    said.push(...(r.pre ?? []), ...(r.phrases ?? []));
  };
  for (let i = 0; i < 6; i++) {
    await send('Shift');
    if (await seen()) return true;
    await send('F6');
  }
  return false;
}

function routedPage(page, driver, said, keys, settle) {
  const press = async (k) => {
    keys.push(k);
    const r = await driver.keys([k], { settle });
    if (process.env.SR_DEBUG) console.error(`[key] ${k} -> ${JSON.stringify([...(r.pre ?? []), ...(r.phrases ?? [])])} ${r.error ? `ERR ${r.error.message}` : ''}`);
    said.push(...(r.pre ?? []), ...(r.phrases ?? []));
    if (r.error) throw r.error;
  };
  const keyboard = new Proxy(page.keyboard, { get(t, p) { if (p === 'press') return press; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } });
  return new Proxy(page, { get(t, p) { if (p === 'keyboard') return keyboard; const v = Reflect.get(t, p, t); return typeof v === 'function' ? v.bind(t) : v; } });
}

async function facts(page) {
  return page.evaluate(() => {
    const H = window.__a11ySr;
    if (!H) return null;
    const f = H.facts();
    f.controls = [...document.querySelectorAll('[aria-controls]')].slice(0, 50).map((el) => {
      const c = document.getElementById(String(el.getAttribute('aria-controls')).split(/\s+/)[0]);
      return { selector: H.selector(el), expanded: H.states(el).expanded, visible: !!c && !H.hidden(c) };
    });
    return f;
  }).catch(() => null);
}

// The element an actionable step is about to act on (before acting: it may disappear after).
async function targetInfo(page, locate, st) {
  if (!st.target || !['click', 'dblclick', 'press', 'focus', 'fill', 'type', 'check', 'uncheck', 'select'].includes(st.action)) return null;
  try {
    return await locate(page, st.target).evaluate((el) => {
      const H = window.__a11ySr;
      return H ? { selector: H.selector(el), html: H.html(el), name: H.name(el), role: H.role(el) } : null;
    }, null, { timeout: 2000 });
  } catch {
    return null;
  }
}

/** Replaces every value the plans type (and its URL-encoded forms) with "[redacted]", deeply. */
export function makeRedactor(plans) {
  const secrets = new Set();
  for (const p of plans) {
    for (const st of [...(p.startPlan ?? []), ...(p.plan ?? [])]) {
      if (!TYPING.has(st.action) || st.value == null) continue;
      const v = String(st.value);
      if (v.length < 3) continue;
      secrets.add(v);
      secrets.add(encodeURIComponent(v));
      secrets.add(encodeURIComponent(v).replace(/%20/g, '+'));
    }
  }
  const list = [...secrets].sort((a, b) => b.length - a.length);
  const str = (s) => list.reduce((o, v) => o.split(v).join('[redacted]'), s);
  const deep = (x) => {
    if (typeof x === 'string') return str(x);
    if (Array.isArray(x)) return x.map(deep);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, deep(v)]));
    return x;
  };
  return deep;
}

/** What was actually dispatched, labelled honestly (programmatic operations are not user input). */
export function inputOf(st, real) {
  const times = st.times > 1 ? ` ×${st.times}` : '';
  switch (st.action) {
    case 'click': return { via: 'playwright', input: `mouse (${st.button ?? 'left'} button) click` };
    case 'dblclick': return { via: 'playwright', input: `mouse (${st.button ?? 'left'} button) double-click` };
    case 'focus': return { via: 'programmatic focus', input: 'programmatic focus (no key press)' };
    case 'select': return { via: 'programmatic select', input: 'programmatic option selection (no pointer or key input)' };
    case 'fill': return { via: 'programmatic fill', input: 'programmatic text entry (no key presses)' };
    case 'type': return { via: 'playwright', input: 'synthetic per-character key events (CDP; not OS key presses)' };
    case 'press': return real
      ? { via: 'screen-reader', input: `OS key ${st.key}${times} sent through the screen reader` }
      : { via: 'playwright', input: `keyboard ${st.key}${times} (CDP key events)` };
    default: return { via: 'playwright', input: null };
  }
}

async function sensitiveReason(page, locate, st, timeout) {
  try {
    const check = (el) => (window.__a11ySr ? window.__a11ySr.sensitive(el) : 'page helpers unavailable');
    if (st.target) return await locate(page, st.target).evaluate(check, null, { timeout });
    return await page.evaluate(() => (window.__a11ySr ? window.__a11ySr.sensitive(document.activeElement) : 'page helpers unavailable'));
  } catch (err) {
    // Fail closed: a field that can't be inspected is not typed into.
    return `the field could not be inspected (${firstLine(err)})`;
  }
}

/** `log(msg)` receives progress lines; returns `{ journeys, probes, browserVersion, cleanupErrors }`. */
export async function runSession({ plans, driver, runDir, headed, channel, storageState, timeout = 10000, settleMs, log = () => {}, maxPresses = 120, maxEscalations = 3, noEscalate = false }) {
  const { runStep, locate, describeStep, describeTarget, stepTrace } = await importSiblingLib('steps.mjs');
  const mod = plans.some((p) => SR_MODALITIES.has(p.modality)) ? await importSiblingLib('modality.mjs') : null;
  const shotsDir = path.join(runDir, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const real = driver.kind === 'real';
  const settle = settleMs ?? driver.settleMs;
  const redact = makeRedactor(plans);
  const cleanupErrors = [];
  const browser = await launchChromium({ channel, headed: real || headed });
  const browserVersion = browser.version();
  let phase = 'start';
  browser.on('disconnected', () => { if (phase !== 'done') log(`browser disconnected unexpectedly during: ${phase}`); });
  const contextFor = (vp) => browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...(storageState ? { storageState } : {}) });
  const shoot = (page, file, full = false) => page.screenshot({ path: path.join(runDir, file), fullPage: full, mask: [page.locator(SENSITIVE_MASK)] }).then(() => file, () => null);

  const describe = (st) => {
    if (st.action === 'fill') return `Enter text in ${describeTarget(st.target)}`;
    if (st.action === 'type') return `Type text${st.target ? ` in ${describeTarget(st.target)}` : ''}`;
    return describeStep(st);
  };

  // Executes one plan step; click/dblclick honour the requested mouse button (the shared runner doesn't).
  const exec = async (page, st) => {
    if (TYPING.has(st.action)) {
      const why = await sensitiveReason(page, locate, st, timeout);
      if (why) throw Object.assign(new Error(`Refused: sensitive field (policy): ${why}`), { refused: true });
    }
    if (st.action === 'click' || st.action === 'dblclick') {
      const button = st.button ?? 'left';
      if (!BUTTONS.includes(button)) throw new Error(`Unsupported mouse button "${button}" (expected ${BUTTONS.join(' | ')})`);
      const loc = locate(page, st.target);
      const opts = { button, timeout, ...(st.modifiers ? { modifiers: st.modifiers } : {}) };
      await (st.action === 'click' ? loc.click(opts) : loc.dblclick(opts));
      return;
    }
    await runStep(page, { ...st, settle: 0 }, { timeout });
  };

  const journeys = [];
  const probes = [];
  const probeByStart = new Map();
  try {
    await driver.start({ channel });
    for (const [ji, plan] of plans.entries()) {
      const key = plan.key ?? plan.id;
      const base = { id: plan.id, key, title: plan.title, feature: plan.feature, viewport: plan.viewport, modality: plan.modality ?? 'unspecified', notes: plan.notes ?? [] };
      if (plan.blocked) {
        log(`journey ${key}: blocked - ${plan.blocked}`);
        journeys.push(redact({ ...base, status: 'blocked', error: plan.blocked, probe: null, prep: [], steps: [] }));
        continue;
      }
      log(`journey ${key} (${plan.plan.length} steps, ${plan.viewport.name})`);
      phase = `journey ${key}`;
      const context = await contextFor(plan.viewport);
      const page = await context.newPage();
      await page.addInitScript(installPageHelpers);
      await driver.attach(page);
      let loads = 0;
      page.on('load', () => { loads++; });
      const steps = [];
      const prep = [];
      let status = 'complete';
      let error = null;
      let aligned = !real;
      const modality = SR_MODALITIES.has(plan.modality) ? plan.modality : null;
      const said = [];
      const sentKeys = [];
      let mctx = null;
      let escalations = 0;
      let inconclusive = false;
      if (modality) {
        const routed = routedPage(page, driver, said, sentKeys, real ? 150 : 0);
        const ctl = { rescue: false };
        mctx = { page: mod.guardSurface(routed, ctl), raw: routed, ctl, obs: mod.makeObserver(routed), modality, maxPresses, noEscalate, actionable: false, uiWrap: real ? 14 : 0 };
      }
      // One step under a keyboard-like modality: keys only (through the reader); a pointer or
      // programmatic focus move happens only inside the guarded rescue scope and is reported.
      const modalStep = async (st, rec) => {
        const skip = st.modalitySkip?.[modality];
        const notFor = st.modalities && !st.modalities.includes(modality);
        said.length = 0;
        sentKeys.length = 0;
        let r;
        let error = null;
        if (skip || notFor) r = { outcome: 'skipped', findings: [], presses: 0, note: skip ?? `declared for ${st.modalities.join(', ')} only` };
        else if (st.intent === 'read' && modality === 'sr-navigation') {
          const gate = driver.ensureBrowseMode ? await driver.ensureBrowseMode(page) : { mode: 'browse', confidence: 'n/a' };
          rec.readerMode = gate.mode;
          rec.modeConfidence = gate.confidence;
          r = { outcome: 'ok', findings: [], presses: 0, note: 'read through reader navigation (see the sweeps)' };
        } else {
          try {
            if (TYPING.has(st.action)) {
              const why = await sensitiveReason(page, locate, st, timeout);
              if (why) throw Object.assign(new Error(`Refused: sensitive field (policy): ${why}`), { refused: true });
            }
            if (real && KEY_ACTIONS.has(st.action)) await ensureContentFocus(page, driver, said, sentKeys);
            r = await mod.runKeyboardStep(mctx, st, { timeout });
          } catch (err) { error = err; r = { outcome: 'blocked', findings: [], presses: 0, note: firstLine(err) }; }
        }
        if (r.outcome === 'blocked' && !error) error = Object.assign(new Error(r.note ?? r.findings.map((f) => f.rule).join(', ') ?? 'blocked by a modality barrier'), { refused: true });
        const tail = await driver.take();
        return { r, res: { pre: [], phrases: [...said, ...tail], health: real ? 'captured' : 'simulated', ...(error ? { error } : {}) }, keys: [...sentKeys] };
      };
      // Phrases that arrive after a step's capture window belong to that step ("late"), never dropped.
      const addLate = (phrases) => {
        if (!phrases?.length) return;
        if (steps.length) steps.at(-1).late.push(...phrases);
        else prep.push({ step: 0, phrases });
      };
      try {
        for (const [i, st] of plan.plan.entries()) {
          const n = i + 1;
          addLate(await driver.take());
          const before = await facts(page);
          const target = await targetInfo(page, locate, st);
          const prev = steps.at(-1);
          const io = mctx
            ? { via: 'keyboard', input: `keyboard only (${modality}): Tab, Shift+Tab, arrow keys, Enter, Space${real ? ' sent through the reader' : ' (simulated key events)'}` }
            : inputOf(st, real);
          const trace = stepTrace(st);
          if (io.input) trace.input = io.input;
          const rec = {
            n, origin: st.origin ?? null, action: st.action, description: describe(st), trace,
            key: st.action === 'press' ? st.key ?? null : null, times: st.action === 'press' ? st.times ?? 1 : null,
            button: ['click', 'dblclick'].includes(st.action) ? st.button ?? 'left' : null,
            via: io.via, target, before: prev ? ([...prev.narration, ...prev.late].at(-1) ?? prev.before ?? '') : '',
            narration: [], late: [], capture: { mode: real ? 'reader' : 'simulated', health: null },
            facts: { before, after: null }, screenshot: null, ok: true, error: null,
          };
          const stepSettle = st.action === 'waitFor' || st.action === 'wait' ? Math.min(settle, 300) : settle;
          const wasAligned = aligned;
          const loadsBefore = loads;
          let res;
          let mr = null;
          if (mctx) {
            const m = await modalStep(st, rec);
            res = m.res;
            mr = { ...m.r, keys: m.keys };
          } else if (st.action === 'press') {
            // Real key presses go through the reader (CDP key events never reach it); the
            // optional target is focused first inside its own capture window.
            let pre = [];
            let phrases = [];
            if (st.target) {
              const f = await driver.capture(() => locate(page, st.target).focus({ timeout }), { settle: 0 });
              pre = f.pre;
              phrases = f.phrases;
              if (f.error) res = f;
            }
            if (!res) {
              const k = await driver.keys(Array.from({ length: st.times ?? 1 }, () => st.key), { settle: stepSettle });
              res = st.target ? { ...k, pre, phrases: [...phrases, ...k.pre, ...k.phrases] } : k;
            }
          } else {
            res = await driver.capture(() => exec(page, st), { settle: stepSettle });
          }
          addLate(res.pre);
          rec.narration = res.phrases ?? [];
          if (mr) {
            Object.assign(rec, {
              modality, outcome: mr.outcome, presses: mr.presses ?? 0, escalation: mr.escalation ?? null, keysSent: mr.keys, ...(mr.note ? { modalityNote: mr.note } : {}),
              modalityFindings: mr.findings.map((f) => ({ rule: f.rule, note: f.note ?? null, meta: mod.ruleMeta(f.rule) ?? null })),
            });
            if (mr.escalation) { rec.via = `escalation: ${mr.escalation}`; rec.trace.input = `${mr.escalation === 'click' ? 'mouse click' : 'programmatic focus'} (escalation after the keyboard failed; reported)`; }
          }
          rec.capture.health = wasAligned ? res.health : 'unaligned';
          let refused = false;
          if (res.error) {
            rec.ok = false;
            rec.error = firstLine(res.error);
            refused = !!res.error.refused;
          }
          let alignError = null;
          let alignCode = null;
          if (real && rec.ok && (NAV_ACTIONS.has(st.action) || loads !== loadsBefore)) {
            // A new document: bring the reader back into the web content (recorded separately).
            try {
              prep.push({ step: n, phrases: await driver.align(page) });
              aligned = true;
            } catch (err) {
              prep.push({ step: n, phrases: err.prep ?? [] });
              aligned = false;
              alignError = firstLine(err);
              alignCode = err.code ?? null;
            }
          }
          rec.facts.after = await facts(page);
          if (mctx && rec.readerMode === undefined && driver.readerMode) rec.readerMode = (await driver.readerMode(page)).mode;
          rec.screenshot = await shoot(page, `shots/j${ji + 1}-s${n}.png`);
          steps.push(rec);
          if (!rec.ok) {
            status = refused ? 'blocked' : 'partial';
            error = `Step ${n} ${refused ? 'refused' : 'failed'}: ${rec.description}: ${rec.error}`;
            log(`  ${error}`);
            break;
          }
          if (alignError) {
            status = 'blocked';
            error = `${alignCode ?? 'alignment-failed'}: screen reader alignment failed after step ${n}: ${alignError}`;
            log(`  ${error}`);
            break;
          }
          if (mr?.outcome === 'inconclusive') inconclusive = true;
          if (mr?.escalation && ++escalations >= maxEscalations) {
            status = 'partial';
            error = `Stopped after ${maxEscalations} escalations (--max-escalations); later steps were not replayed.`;
            log(`  ${error}`);
            break;
          }
        }
        if (status === 'complete' && inconclusive) {
          status = 'partial';
          error = 'Some steps were inconclusive (no violation is reported for them): see the step outcomes.';
        }
        addLate(await driver.take());
      } finally {
        await context.close().catch((err) => cleanupErrors.push(`close browser context: ${firstLine(err)}`));
      }

      const startKey = JSON.stringify(plan.startPlan) + plan.viewport.name;
      if (!probeByStart.has(startKey)) {
        phase = `probe after ${key}`;
        const id = `p${probes.length + 1}`;
        const probe = await runProbe({ contextFor, driver, plan, key, id, exec, shoot, settle, real })
          .catch((err) => ({ id, journey: key, viewport: plan.viewport, startPlan: plan.startPlan, error: firstLine(err), prep: err.prep ?? [] }));
        probes.push(redact(probe));
        probeByStart.set(startKey, id);
      }
      journeys.push(redact({ ...base, status, error, probe: probeByStart.get(startKey), prep, steps }));
    }
  } finally {
    phase = 'done';
    try { await driver.stop(); } catch (err) { cleanupErrors.push(`stop ${driver.label}: ${firstLine(err)}`); }
    await browser.close().catch((err) => cleanupErrors.push(`close browser: ${firstLine(err)}`));
  }
  return { journeys, probes, browserVersion, cleanupErrors };
}

async function runProbe({ contextFor, driver, plan, key, id, exec, shoot, settle, real }) {
  const context = await contextFor(plan.viewport);
  const page = await context.newPage();
  try {
    await page.addInitScript(installPageHelpers);
    await driver.attach(page);
    for (const st of plan.startPlan) await exec(page, st);
    const prep = real ? await driver.align(page) : [];
    if (real) await ensureContentFocus(page, driver, [], []);
    await driver.take();
    const dom = await page.evaluate(() => {
      const H = window.__a11ySr;
      return { url: location.href, title: document.title, headings: H.headings(), landmarks: H.landmarks() };
    });
    // Browse-mode sweeps are meaningless in focus mode: establish browse mode first (confirmed,
    // never blind), and discard/retry any sweep that ended in focus mode.
    const gate = driver.ensureBrowseMode ? await driver.ensureBrowseMode(page) : { mode: 'browse' };
    const sweep = async (kind) => {
      if (gate.mode !== 'browse') return { spoken: [], termination: 'unsupported', commands: [], reason: 'mode-unverified' };
      let r = await driver.probe(page, kind);
      if (driver.readerMode && (await driver.readerMode(page)).mode === 'focus') {
        const again = await driver.ensureBrowseMode(page);
        if (again.mode === 'browse') r = await driver.probe(page, kind);
        if (again.mode !== 'browse' || (await driver.readerMode(page)).mode === 'focus') {
          return { spoken: [], termination: 'invalid-focus-mode', commands: [], discarded: true };
        }
      }
      return {
        spoken: r.items.map((x) => ({ text: x.text, ...(x.box ? { box: x.box } : {}), ...(x.selector ? { selector: x.selector } : {}) })),
        termination: r.termination,
        commands: r.commands ?? [],
        ...(r.error ? { error: r.error } : {}),
      };
    };
    const headings = await sweep('headings');
    const landmarks = await sweep('landmarks');
    const reading = await sweep('reading');
    if (real) {
      // Place each spoken item on the page (best effort) so reading order can be compared.
      const hits = await page.evaluate((texts) => window.__a11ySr.locateTexts(texts), reading.spoken.map((r) => r.text));
      reading.spoken = reading.spoken.map((r, i) => ({ ...r, ...(hits[i] ?? {}) }));
    }
    const screenshot = await shoot(page, `shots/${id}.png`, true);
    return {
      id, journey: key, url: dom.url, title: dom.title, viewport: plan.viewport, startPlan: plan.startPlan, screenshot, prep,
      headings: { ...headings, dom: dom.headings }, landmarks: { ...landmarks, dom: dom.landmarks }, reading,
    };
  } finally {
    await context.close().catch(() => {});
  }
}
