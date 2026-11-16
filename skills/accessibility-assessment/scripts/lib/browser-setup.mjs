// Browser/setup extension point shared by assess.mjs and scope-definition's verify/replay/explore.
//
//   --setup <module.mjs>   optional hooks: launch, newContext, beforeTarget, afterTarget, teardown,
//                          and `export const isolation = 'fresh-context' | 'shared-context' | 'reused-page'`
//   --cdp <endpoint>       attach to an already running Chromium (loopback hosts only)
//
// A run that is not `fresh-context` is disclosed in results.execution and can never be verified.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SETUP_ISOLATIONS = ['fresh-context', 'shared-context', 'reused-page'];

export function assertLoopback(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { throw new Error(`--cdp: not a valid URL: ${endpoint}`); }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) throw new Error(`--cdp: unsupported protocol ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error(`--cdp: only loopback endpoints are accepted (got host "${host}")`);
  return endpoint;
}

const msg = (err) => String(err?.message ?? err).split('\n')[0];

/** Creates the run's browser session. `setupPath`/`cdp` are CLI values (or undefined). */
export async function createBrowserSession({ chromium, headed, channel, setupPath, cdp }) {
  let mod = null;
  if (setupPath) {
    try { mod = await import(pathToFileURL(path.resolve(setupPath)).href); } catch (err) { throw new Error(`--setup: cannot load ${path.basename(setupPath)}: ${msg(err)}`); }
  }
  if (cdp) assertLoopback(cdp);
  if (mod?.isolation !== undefined && !SETUP_ISOLATIONS.includes(mod.isolation)) throw new Error(`--setup: exported isolation must be one of ${SETUP_ISOLATIONS.join(', ')}`);

  const execution = {
    isolation: mod?.isolation ?? (cdp ? 'shared-context' : 'fresh-context'),
    setupModule: setupPath ? path.basename(setupPath) : null,
    cdp: !!cdp,
    interventions: [],
  };
  const hook = async (name, fn) => {
    try { return await fn(); } catch (err) { throw new Error(`--setup ${name} hook failed: ${msg(err)}`); }
  };

  let browser;
  let owned = true;
  if (mod?.launch) {
    browser = await hook('launch', () => mod.launch({ chromium, headed, channel }));
    owned = false;
  } else if (cdp) {
    browser = await chromium.connectOverCDP(cdp);
    owned = false;
  } else {
    browser = await chromium.launch({ headless: !headed, ...(channel ? { channel } : {}) });
  }

  const addIntervention = (target, { step = null, kind, reason }) => {
    const rec = { target: target?.key ?? null, step, kind: String(kind ?? 'setup'), reason: String(reason ?? '') };
    execution.interventions.push(rec);
    return rec;
  };

  return {
    browser,
    execution,
    hasNewContext: !!mod?.newContext,
    /** Opens a context (hook or default) with the supplied Playwright options. */
    async newContext(options, target) {
      if (mod?.newContext) return hook('newContext', () => mod.newContext({ browser, options, target }));
      return browser.newContext(options);
    },
    async beforeTarget(ctx) {
      if (mod?.beforeTarget) await hook('beforeTarget', () => mod.beforeTarget({ ...ctx, target: wrapTarget(ctx.target, addIntervention) }));
    },
    async afterTarget(ctx) {
      if (mod?.afterTarget) await hook('afterTarget', () => mod.afterTarget({ ...ctx, target: wrapTarget(ctx.target, addIntervention) }));
    },
    /** Closes what the run created; a browser the run did not launch is left running. */
    async close() {
      try {
        if (mod?.teardown) await hook('teardown', () => mod.teardown({ browser }));
      } finally {
        if (owned) await browser.close();
      }
    },
  };
}

function wrapTarget(target, addIntervention) {
  const t = { ...(target ?? {}) };
  t.addIntervention = (info) => {
    const rec = addIntervention(target, info);
    (target.interventions ??= []).push(rec);
    return rec;
  };
  return t;
}

/** At most `partial` when the session is not a fresh context or had interventions. */
export function isolationCapsStatus(execution) {
  return !!execution && (execution.isolation !== 'fresh-context' || (execution.interventions?.length ?? 0) > 0);
}
