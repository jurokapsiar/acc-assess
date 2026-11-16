// Executes inventory steps with Playwright and renders them as human-readable repro steps.

export function locate(page, t) {
  if (!t) return null;
  let base = t.within ? locate(page, t.within) : page;
  let loc;
  const exact = t.exact ?? false;
  if (t.role) loc = base.getByRole(t.role, { ...(t.name !== undefined ? { name: toMatcher(t.name), exact } : {}), ...(t.level ? { level: t.level } : {}) });
  else if (t.label) loc = base.getByLabel(toMatcher(t.label), { exact });
  else if (t.text) loc = base.getByText(toMatcher(t.text), { exact });
  else if (t.placeholder) loc = base.getByPlaceholder(toMatcher(t.placeholder), { exact });
  else if (t.testId) loc = base.getByTestId(t.testId);
  else if (t.selector) loc = base.locator(t.selector);
  else throw new Error(`Cannot build locator from ${JSON.stringify(t)}`);
  return t.nth !== undefined ? loc.nth(t.nth) : loc.first();
}

// "/regex/flags" strings become RegExp so inventories stay JSON.
function toMatcher(v) {
  const m = typeof v === 'string' && v.match(/^\/(.+)\/([a-z]*)$/);
  return m ? new RegExp(m[1], m[2]) : v;
}

// "/^Edit/" reads as "Edit…" in repro steps; complex patterns stay as written.
function humanize(v) {
  const m = typeof v === 'string' && v.match(/^\/(\^?)([^\\^$.*+?()[\]{}|]+)(\$?)\/[a-z]*$/);
  if (!m) return v;
  return `${m[2]}${m[1] && !m[3] ? '…' : ''}`;
}

export function describeTarget(t) {
  if (!t) return 'page';
  const q = (v) => `“${humanize(v)}”`;
  let d;
  if (t.role) d = t.name !== undefined ? `${t.role} ${q(t.name)}` : t.role;
  else if (t.label) d = `field labelled ${q(t.label)}`;
  else if (t.text) d = `text ${q(t.text)}`;
  else if (t.placeholder) d = `field with placeholder ${q(t.placeholder)}`;
  else if (t.testId) d = `test id ${q(t.testId)}`;
  else d = `\`${t.selector}\``;
  if (t.nth !== undefined) d = `#${t.nth + 1} ${d}`;
  if (t.within) d += ` in ${describeTarget(t.within)}`;
  return d;
}

export function describeStep(st) {
  if (st.description) return st.description;
  const tgt = describeTarget(st.target);
  switch (st.action) {
    case 'goto': return `Open ${st.url}`;
    case 'reload': return 'Reload the page';
    case 'click': return `Click ${tgt}`;
    case 'dblclick': return `Double-click ${tgt}`;
    case 'hover': return `Hover ${tgt}`;
    case 'focus': return `Move focus to ${tgt}`;
    case 'fill': return `Enter “${st.value}” in ${tgt}`;
    case 'type': return `Type “${st.value}”${st.target ? ` in ${tgt}` : ''}`;
    case 'press': return `Press ${st.key}${st.times > 1 ? ` ${st.times}×` : ''}${st.target ? ` on ${tgt}` : ''}`;
    case 'check': return `Check ${tgt}`;
    case 'uncheck': return `Uncheck ${tgt}`;
    case 'select': return `Select “${st.value}” in ${tgt}`;
    case 'wait': return `Wait ${st.ms ?? 300} ms`;
    case 'waitFor': return `Wait until ${tgt} is ${st.state ?? 'visible'}`;
    case 'evaluate': return st.description ?? 'Run setup script';
    case 'emulate': return `Emulate ${Object.entries(st).filter(([k]) => !['action', 'origin'].includes(k)).map(([k, v]) => `${k}=${v}`).join(', ')}`;
    case 'localStorage': return `Set localStorage “${st.key}” = “${st.value}”`;
    default: return st.description ?? st.action;
  }
}

// Actions that move/interact with an actual element, as opposed to purely navigational/setup
// ones (goto/reload/wait/waitFor/evaluate/emulate/localStorage) - used by the User journeys
// section (report.mjs/render.mjs) to decide which plan steps belong in its actionable-elements
// list.
export const ACTIONABLE_ACTIONS = ['click', 'dblclick', 'hover', 'focus', 'fill', 'type', 'press', 'check', 'uncheck', 'select'];

const INPUT_DEVICE = {
  click: 'mouse', dblclick: 'mouse', hover: 'mouse', check: 'mouse', uncheck: 'mouse', select: 'mouse',
  focus: 'programmatic', fill: 'keyboard', type: 'keyboard', press: 'keyboard',
};

function targetLabel(t) {
  if (!t) return null;
  const v = t.name ?? t.label ?? t.text ?? t.placeholder ?? t.testId ?? t.selector ?? null;
  return v === undefined ? null : humanize(v);
}

function inputDetail(st) {
  switch (st.action) {
    case 'click': return `mouse (${st.button ?? 'left'} button) click`;
    case 'dblclick': return `mouse (${st.button ?? 'left'} button) double-click`;
    case 'hover': return 'mouse hover';
    case 'check': case 'uncheck': return 'mouse (left button) click';
    case 'select': return 'mouse (left button) click';
    case 'focus': return 'programmatic focus';
    case 'fill': case 'type': return 'keyboard typing';
    case 'press': return `keyboard ${st.key}${st.times > 1 ? ` ×${st.times}` : ''}`;
    default: return null;
  }
}

/**
 * Structured per-step record for `results.json`'s `target.steps[]` (and, from there, the
 * User journeys section): the input device/key and the action executed, derived purely from
 * the step definition (same source `describeStep()`/`runStep()` use), plus the step's `origin`
 * (which screen/state/feature-state contributed it, set by `inventory.mjs`'s `buildTarget()`).
 */
export function stepTrace(st) {
  return {
    origin: st.origin ?? null,
    action: st.action,
    actionable: ACTIONABLE_ACTIONS.includes(st.action),
    role: st.target?.role ?? null,
    label: targetLabel(st.target),
    device: INPUT_DEVICE[st.action] ?? null,
    input: inputDetail(st),
    ...(st.journey ? { journey: st.journey } : {}),
    ...(st.modalities ? { modalities: st.modalities } : {}),
  };
}

export async function runStep(page, st, { timeout = 10000 } = {}) {
  const loc = st.target ? locate(page, st.target) : null;
  const opt = { timeout };
  switch (st.action) {
    case 'goto': await page.goto(st.url, { waitUntil: st.waitUntil ?? 'load', timeout: timeout * 3 }); break;
    case 'reload': await page.reload({ waitUntil: 'load' }); break;
    case 'click': await loc.click(opt); break;
    case 'dblclick': await loc.dblclick(opt); break;
    case 'hover': await loc.hover(opt); break;
    case 'focus': await loc.focus(opt); break;
    case 'fill': await loc.fill(String(st.value), opt); break;
    case 'type': loc ? await loc.pressSequentially(String(st.value), opt) : await page.keyboard.type(String(st.value)); break;
    case 'press':
      for (let i = 0; i < (st.times ?? 1); i++) loc ? await loc.press(st.key, opt) : await page.keyboard.press(st.key);
      break;
    case 'check': await loc.check(opt); break;
    case 'uncheck': await loc.uncheck(opt); break;
    case 'select': await loc.selectOption(st.value, opt); break;
    case 'wait': await page.waitForTimeout(st.ms ?? 300); break;
    case 'waitFor': await loc.waitFor({ state: st.state ?? 'visible', timeout }); break;
    case 'evaluate': await page.evaluate(st.script); break;
    case 'emulate': {
      const { action, origin, description, settle, timeout: _t, ...media } = st;
      await page.emulateMedia(media);
      break;
    }
    case 'localStorage':
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [st.key, String(st.value)]);
      break;
    default: throw new Error(`Unknown step action ${st.action}`);
  }
  if (st.settle !== 0) await page.waitForTimeout(st.settle ?? 150);
}

export async function runPlan(page, plan, opts) {
  const done = [];
  for (const st of plan) {
    try {
      await runStep(page, st, opts);
      done.push(st);
    } catch (err) {
      const e = new Error(`Step failed: ${describeStep(st)} (${st.origin ?? 'plan'}): ${err.message.split('\n')[0]}`);
      e.done = done;
      throw e;
    }
  }
  return done;
}
