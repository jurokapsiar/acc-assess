// Live exploration (§6.4): one bounded Playwright probe per call. Headless by default. Builds
// a plan either from the inventory (`--screen`/`--state`, via the sibling's `resolveTargets` +
// the session draft overlay) or from `--url` + `--steps` (a raw step list, policy-checked
// below), runs it with the sibling's `runPlan`, then records an aria snapshot, a screenshot,
// the URL and the focused element's role/name. Only browser code in this skill besides replay.
import fs from 'node:fs';
import path from 'node:path';
import { loadInventoryLib, loadStepsLib, openBrowserSession, importSiblingLib } from './deps.mjs';
import { applyDraftOverlay } from './journeys.mjs';
import { claimSeq } from './session.mjs';

const DESTRUCTIVE_DEFAULT_FORBID = ['submit', 'delete', 'remove', 'purchase', 'buy', 'pay', 'send', 'sign out', 'log out', 'logout', 'unsubscribe', 'deactivate', 'destroy', 'erase', 'wipe', 'archive', 'publish', 'checkout', 'cancel'];

/** Un-clamped locator for ambiguity counting: same source selection as `steps.mjs locate()`,
 * but never calls `.first()`/`.nth()` so `count()` reflects the raw match set. */
function rawLocator(page, t) {
  if (!t) return null;
  const base = t.within ? rawLocator(page, t.within) : page;
  const exact = t.exact ?? false;
  const toMatcher = (v) => {
    const m = typeof v === 'string' && v.match(/^\/(.+)\/([a-z]*)$/);
    return m ? new RegExp(m[1], m[2]) : v;
  };
  if (t.role) return base.getByRole(t.role, { ...(t.name !== undefined ? { name: toMatcher(t.name), exact } : {}), ...(t.level ? { level: t.level } : {}) });
  if (t.label) return base.getByLabel(toMatcher(t.label), { exact });
  if (t.text) return base.getByText(toMatcher(t.text), { exact });
  if (t.placeholder) return base.getByPlaceholder(toMatcher(t.placeholder), { exact });
  if (t.testId) return base.getByTestId(t.testId);
  if (t.selector) return base.locator(t.selector);
  throw new Error(`Cannot build locator from ${JSON.stringify(t)}`);
}

function targetName(t) {
  if (!t) return '';
  return String(t.name ?? t.text ?? t.label ?? t.placeholder ?? t.testId ?? t.selector ?? '').toLowerCase();
}

/** Enforces the action policy on a raw `--steps` list (§6.4): allowed actions are the
 * inventory's allowlist minus `evaluate`/`localStorage` unless `policy` allows them; a step
 * whose target name matches a forbidden verb is refused; `goto` outside `baseUrl`'s origin is
 * refused. Throws on the first violation (nothing in `--steps` runs partially). */
export function enforceActionPolicy(steps, { policy = {}, baseUrl } = {}) {
  const forbid = (policy.forbid ?? DESTRUCTIVE_DEFAULT_FORBID).map((v) => String(v).toLowerCase());
  const baseOrigin = baseUrl ? new URL(baseUrl).origin : null;
  for (const st of steps) {
    if (st.action === 'evaluate' && !policy.allowEvaluate) throw new Error(`Step "evaluate" is not allowed by the action policy (pass --allow-evaluate if this session truly needs it).`);
    if (st.action === 'localStorage' && !policy.allowStorage) throw new Error(`Step "localStorage" is not allowed by the action policy.`);
    const name = targetName(st.target);
    if (name && forbid.some((f) => name.includes(f))) throw new Error(`Step target "${name}" matches a forbidden action verb ("${forbid.find((f) => name.includes(f))}"); this session's intent excludes destructive actions.`);
    if (st.action === 'goto' && baseOrigin) {
      const origin = new URL(st.url, baseUrl).origin;
      if (origin !== baseOrigin) throw new Error(`Step navigates outside the app origin (${origin} != ${baseOrigin}); refused.`);
    }
  }
}

async function snapshotBody(page) {
  // Feature-detect the newer `page.ariaSnapshot({mode:'ai'})` API; fall back to the locator
  // form available in older Playwright.
  if (typeof page.ariaSnapshot === 'function') {
    try {
      return await page.ariaSnapshot({ mode: 'ai' });
    } catch {
      /* fall through */
    }
  }
  return page.locator('body').ariaSnapshot();
}

async function focusedRoleName(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const name = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 80) || null;
    return { role, name };
  });
}

/**
 * Runs one exploration (§6.4). `opts`:
 * - `screen`/`state` (+ `inv`, `session.draft` overlay) to build the plan from the inventory, or
 * - `url` (+ optional `steps`) for a raw probe.
 * Returns the recorded exploration `{ n, plan, url, snapshot, shot, focused, ambiguous }` and
 * writes `snapshots/<n>.yml` + `shots/<n>.png` under `workDir`.
 */
export async function explore({ appRoot, workDir, session, screen, state, url, steps, viewport, headed, channel, setup, cdp }) {
  const { loadInventory, resolveTargets } = await loadInventoryLib();
  const { runStep } = await loadStepsLib();

  let plan;
  let baseUrl = null;
  let vp = viewport ? { width: 1280, height: 800 } : { width: 1280, height: 800 };
  if (screen) {
    const inv = loadInventory(path.resolve(appRoot, session.inventory));
    baseUrl = inv.app?.baseUrl ?? null;
    const overlaid = await applyDraftOverlay(inv, session.draft);
    const vpName = viewport || Object.keys(inv.viewports ?? { desktop: 1 })[0];
    const targets = resolveTargets(overlaid, { screens: [screen], states: state ? [state] : ['default'], viewports: [vpName] });
    if (!targets.length) throw new Error(`No resolvable target for screen "${screen}"${state ? ` state "${state}"` : ''} viewport "${vpName}"`);
    plan = targets[0].plan;
    vp = targets[0].viewport;
  } else if (url) {
    const stepList = steps ? JSON.parse(fs.readFileSync(steps, 'utf8')) : [];
    try {
      const inv = loadInventory(path.resolve(appRoot, session.inventory));
      baseUrl = inv.app?.baseUrl ?? session.baseUrl ?? null;
    } catch {
      baseUrl = session.baseUrl ?? null;
    }
    const gotoUrl = baseUrl ? new URL(url, baseUrl).href : url;
    enforceActionPolicy([{ action: 'goto', url: gotoUrl }, ...stepList], { policy: session.actionPolicy, baseUrl });
    plan = [{ action: 'goto', url: gotoUrl }, ...stepList];
  } else {
    throw new Error('explore needs --screen (with optional --state) or --url');
  }

  const browserSession = await openBrowserSession({ channel, headed, setup, cdp });
  const { appendStep, probeFocus, STEPS_FILE } = await importSiblingLib('steps-log.mjs');
  const stepsFile = path.join(workDir, STEPS_FILE);
  fs.mkdirSync(workDir, { recursive: true });
  const ambiguous = [];
  let page;
  try {
    const context = await browserSession.newContext({ viewport: vp.width ? { width: vp.width, height: vp.height } : vp }, { key: `explore:${screen ?? url}` });
    page = await context.newPage();
    for (const [i, st] of plan.entries()) {
      if (st.target) {
        // Counted right before this step runs (not up-front against the plan's starting page),
        // so earlier navigation/clicks have already happened.
        const count = await rawLocator(page, st.target).count().catch(() => -1);
        if (count !== 1) ambiguous.push({ step: st, count });
      }
      let outcome = 'ok';
      try {
        await runStep(page, st);
      } catch (err) {
        outcome = 'error';
        appendStep(stepsFile, { target: `explore:${screen ?? url}`, step: i, action: st.action, pageUrl: page.url(), focused: 'none', outcome, note: String(err.message).split('\n')[0] });
        throw err;
      }
      const fp = await probeFocus(page);
      appendStep(stepsFile, { target: `explore:${screen ?? url}`, step: i, action: st.action, key: st.key ?? null, pageUrl: page.url(), focused: fp.focused, outcome: fp.outcome === 'ok' ? outcome : fp.outcome });
    }
    const snapshot = await snapshotBody(page);
    const focused = await focusedRoleName(page);
    const n = claimSeq(workDir, 'n');
    const snapDir = path.join(workDir, 'snapshots');
    const shotDir = path.join(workDir, 'shots');
    fs.mkdirSync(snapDir, { recursive: true });
    fs.mkdirSync(shotDir, { recursive: true });
    const snapFile = path.join(snapDir, `${n}.yml`);
    const shotFile = path.join(shotDir, `${n}.png`);
    fs.writeFileSync(snapFile, typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot, null, 2));
    await page.screenshot({ path: shotFile });
    const record = { n, plan, url: page.url(), snapshot: path.relative(appRoot, snapFile).split(path.sep).join('/'), shot: path.relative(appRoot, shotFile).split(path.sep).join('/'), focused, ambiguous, stepsLog: path.relative(appRoot, stepsFile).split(path.sep).join('/') };
    return record;
  } finally {
    await browserSession.close();
  }
}
