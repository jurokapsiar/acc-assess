// Verify by replay (§6.7) and the read-only `scope.mjs replay` used for manual review (§10).
// For every target key: overlay the scope onto the inventory, resolve it, run the compiled
// plan fresh, then check `ready` is visible, `scope` CSS matches exactly one visible element,
// and every step target's `count()` was 1 when it ran. Writes `work/verify/<key>.png`.
import fs from 'node:fs';
import path from 'node:path';
import { loadInventoryLib, loadStepsLib, loadScopeLib, openBrowserSession } from './deps.mjs';

/** Un-clamped locator for ambiguity counting: same source selection as `steps.mjs locate()`,
 * but never calls `.first()`/`.nth()` so `count()` reflects the raw match set (mirrors
 * explore.mjs's `rawLocator` - `steps.mjs locate()` itself always clamps to `.first()`, so it
 * can never report more than 1 match and must not be used for the ambiguity check). */
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

async function checkReadyAndScope(page, target) {
  const { locate } = await loadStepsLib();
  if (target.screen.ready) {
    const loc = locate(page, target.screen.ready);
    const visible = await loc.isVisible().catch(() => false);
    if (!visible) return { ok: false, reason: `ready target not visible: ${JSON.stringify(target.screen.ready)}` };
  }
  if (target.screen.scope) {
    const count = await page.locator(target.screen.scope).count();
    const visibleCount = await page.locator(target.screen.scope).locator('visible=true').count().catch(() => count);
    if (count === 0) return { ok: false, reason: `scope selector matched no elements: ${target.screen.scope}` };
    if (visibleCount !== 1 && count !== 1) return { ok: false, reason: `scope selector matched ${count} elements, expected exactly 1 visible: ${target.screen.scope}` };
  }
  return { ok: true };
}

/**
 * Verifies every key in `targets` (resolved against `inv` ⊕ `scope`'s overlay). Returns
 * `{ results, status }` where `results[key] = { status, planHash, reason?, failingStep? }` and
 * overall `status` is `"verified"` only when every target is `verified` (else `"partial"`).
 */
export async function verifyTargets({ appRoot, inv, scope, targets, viewportFilter, workDir, headed, channel, setup, cdp }) {
  const { resolveTargets, planHash } = await loadInventoryLib();
  const { runStep, describeStep } = await loadStepsLib();
  const { applyScope } = await loadScopeLib();

  const { inv: overlaid, conflicts } = applyScope(inv, scope);
  if (conflicts.length) {
    return { results: {}, status: 'error', conflicts };
  }
  const resolved = resolveTargets(overlaid, { targets, viewports: viewportFilter });
  const results = {};
  const verifyDir = workDir ? path.join(workDir, 'verify') : null;
  if (verifyDir) fs.mkdirSync(verifyDir, { recursive: true });

  const session = await openBrowserSession({ channel, headed, setup, cdp });
  const execution = session.execution;
  try {
    for (const target of resolved) {
      const result = { planHash: planHash(target) };
      try {
        const storageState = scope.storageState ? path.resolve(path.dirname(scope.__file ?? appRoot), scope.storageState) : undefined;
        const context = await session.newContext({
          viewport: { width: target.viewport.width, height: target.viewport.height },
          ...(storageState && fs.existsSync(storageState) ? { storageState } : {}),
        }, target);
        const page = await context.newPage();
        await session.beforeTarget({ context, page, target });
        const ambiguousSteps = [];
        const done = [];
        try {
          for (const st of target.plan) {
            if (st.target && st.target.nth === undefined) {
              // Checked right before this step runs, once prior steps have navigated/opened
              // whatever the locator needs to be visible in - not against the plan's starting
              // (pre-navigation) page state.
              const count = await rawLocator(page, st.target).count().catch(() => 1);
              if (count !== 1) ambiguousSteps.push({ step: st, count });
            }
            await runStep(page, st);
            done.push(st);
          }
        } catch (err) {
          throw Object.assign(err, { done });
        }
        const check = await checkReadyAndScope(page, target);
        if (verifyDir) await page.screenshot({ path: path.join(verifyDir, `${target.key}.png`) }).catch(() => {});
        await session.afterTarget({ context, page, target, status: check.ok ? 'reached' : 'unreachable' });
        await context.close();
        if (!check.ok) {
          result.status = 'unreachable';
          result.reason = check.reason;
        } else if (ambiguousSteps.length) {
          result.status = 'ambiguous';
          result.reason = `${ambiguousSteps.length} step target(s) matched more than one element`;
          result.failingStep = describeStep(ambiguousSteps[0].step);
        } else if ((execution.isolation !== 'fresh-context' || execution.interventions.length > 0)) {
          result.status = 'partial';
          result.reason = `reached, but the run was not a fresh browser context (isolation: ${execution.isolation}, ${execution.interventions.length} intervention(s)); it cannot count as verified`;
        } else {
          result.status = 'verified';
        }
      } catch (err) {
        result.status = 'unreachable';
        result.reason = err.message;
        if (err.done) result.failingStep = describeStep(target.plan[err.done.length] ?? target.plan.at(-1));
      }
      results[target.key] = result;
    }
  } finally {
    await session.close();
  }

  const status = Object.values(results).every((r) => r.status === 'verified') ? 'verified' : 'partial';
  return { results, status, execution };
}

/** Read-only manual replay (§10): runs the compiled plan for one target, then pauses (headed)
 * so the agent/user can inspect. No writes. */
export async function replayTarget({ appRoot, inv, scope, targetKey, headed = true, channel, setup, cdp }) {
  const { resolveTargets } = await loadInventoryLib();
  const { runPlan } = await loadStepsLib();
  const { applyScope } = await loadScopeLib();
  const { inv: overlaid, conflicts } = applyScope(inv, scope);
  if (conflicts.length) throw new Error(`Scope conflicts with inventory: ${conflicts.join('; ')}`);
  const [target] = resolveTargets(overlaid, { targets: [targetKey] });
  const session = await openBrowserSession({ channel, headed, setup, cdp });
  try {
    const context = await session.newContext({ viewport: { width: target.viewport.width, height: target.viewport.height } }, target);
    const page = await context.newPage();
    await session.beforeTarget({ context, page, target });
    await runPlan(page, target.plan);
    if (headed) await page.pause();
    await session.afterTarget({ context, page, target, status: 'replayed' });
    await context.close();
  } finally {
    await session.close();
  }
}
