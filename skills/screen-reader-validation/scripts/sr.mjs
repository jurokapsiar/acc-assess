#!/usr/bin/env node
// Screen-reader-validation CLI. Replays scope-definition journeys (scope.json + journeys.json)
// with a real screen reader through Guidepup (NVDA on Windows, VoiceOver on macOS; or the
// `mock` driver for tests), records action / narration / screenshot per step, analyses the
// narration with deterministic heuristics and renders sr-report.html. Writes only under
// `<app-root>/.a11y/sr-runs/`. Never edits application source, never applies fixes, never
// installs software or changes system settings (preflight prints instructions instead).
//
//   node scripts/sr.mjs preflight [--reader nvda|voiceover|mock] [--channel c] [--json]
//   node scripts/sr.mjs run       --scope <scope.json> [--app-root d] [--journey a,b]
//                                 [--reader r] [--viewport v] [--out <runDir>] [--headed]
//                                 [--channel c] [--settle ms] [--timeout ms] [--skip-preflight]
//                                 [--storage-state <file>]  (a path only; never credentials)
//                                 [--modality sr-keyboard|sr-navigation|all]  (default: each journey's declared
//                                  sr-* modalities, else the legacy unspecified run)
//                                 [--max-presses n] [--max-escalations n] [--no-escalate]
//   node scripts/sr.mjs analyse   <runDir>      re-run the heuristics + re-render
//   node scripts/sr.mjs report    <runDir>      re-render sr-report.html only
//
// Exit codes: 0 ok · 1 error / preflight failed · 2 run finished with blocked or partial journeys · 3 usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { preflight, formatPreflight, guidepupVersion } from './lib/preflight.mjs';
import { READERS, defaultReader, createDriver } from './lib/drivers/index.mjs';
import { loadContext, buildJourneyPlans, parseModalities } from './lib/journeys.mjs';
import { runSession } from './lib/session.mjs';
import { analyse, summarise } from './lib/analyse.mjs';
import { renderReport } from './lib/report.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const args = { _: [] };
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[i + 1] !== undefined && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  else args._.push(rest[i]);
}
const csv = (v) => (v === undefined || v === true ? null : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const num = (v, d) => (v === undefined || v === true ? d : Number(v));
const reader = String(args.reader ?? defaultReader()).toLowerCase().replace('dry-run', 'mock');
const channel = typeof args.channel === 'string' ? args.channel : undefined;

try {
  switch (cmd) {
    case 'preflight': process.exitCode = await cmdPreflight(); break;
    case 'run': process.exitCode = await cmdRun(); break;
    case 'analyse': case 'analyze': await cmdAnalyse(); break;
    case 'report': await cmdReport(); break;
    default:
      console.error(`Unknown command "${cmd ?? ''}". Commands: preflight | run | analyse | report (see the top of scripts/sr.mjs).`);
      process.exitCode = 3;
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = err.usage ? 3 : 1;
}

function usage(message) {
  return Object.assign(new Error(message), { usage: true });
}

function assertReader() {
  if (!READERS.includes(reader)) throw usage(`Unknown --reader "${reader}" (expected ${READERS.join(' | ')})`);
}

async function cmdPreflight() {
  assertReader();
  const r = await preflight({ reader, channel });
  console.log(args.json ? JSON.stringify(r, null, 2) : formatPreflight(r));
  return r.ready ? 0 : 1;
}

function stamp(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
}

async function cmdRun() {
  assertReader();
  if (!args.scope || args.scope === true) throw usage('--scope <scope.json> is required');
  const appRoot = path.resolve(args['app-root'] ?? process.cwd());
  const driver = createDriver(reader, { channel });
  if (driver.kind === 'real' && !args['skip-preflight']) {
    const pf = await preflight({ reader, channel });
    if (!pf.ready) {
      console.error(formatPreflight(pf));
      return 1;
    }
  }
  const storageOverride = typeof args['storage-state'] === 'string' ? path.resolve(args['storage-state']) : null;
  if (storageOverride && !fs.existsSync(storageOverride)) throw usage(`--storage-state file not found: ${args['storage-state']}`);
  const ctx = await loadContext({ scopeFile: path.resolve(args.scope), appRoot, storageOverride });
  const modalities = parseModalities(typeof args.modality === 'string' ? args.modality : null);
  const plans = await buildJourneyPlans(ctx, { filter: csv(args.journey), viewportName: typeof args.viewport === 'string' ? args.viewport : null, modalities });
  if (!plans.length) throw new Error('The scope has no journeys or targets to replay.');

  const startedAt = new Date();
  const runDir = path.resolve(typeof args.out === 'string' ? args.out : path.join(appRoot, '.a11y', 'sr-runs', `${stamp(startedAt)}-${reader}`));
  fs.mkdirSync(runDir, { recursive: true });
  console.log(`Replaying ${plans.length} journey(s) with ${driver.label} -> ${runDir}`);
  if (driver.kind === 'real') console.log('Do not touch mouse or keyboard until the run finishes; keep the desktop unlocked.');

  const timeout = num(args.timeout, 10000);
  const settleMs = args.settle === undefined ? undefined : num(args.settle);
  const { journeys, probes, browserVersion, cleanupErrors } = await runSession({
    plans, driver, runDir, headed: !!args.headed, channel, storageState: storageOverride ?? ctx.storageState,
    timeout, settleMs, log: (m) => console.log(m),
    maxPresses: num(args['max-presses'], 120), maxEscalations: num(args['max-escalations'], 3), noEscalate: !!args['no-escalate'],
  });
  const results = {
    schemaVersion: 2,
    tool: 'screen-reader-validation',
    reader: { name: driver.name, label: driver.label, kind: driver.kind },
    simulated: driver.kind !== 'real',
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    env: {
      os: process.platform, osRelease: os.release(), node: process.version, browser: browserVersion ?? null,
      channel: channel ?? null, guidepup: driver.kind === 'real' ? guidepupVersion() : null,
      locale: Intl.DateTimeFormat().resolvedOptions().locale, settle: settleMs ?? driver.settleMs ?? null, timeout,
    },
    app: { baseUrl: ctx.inv.app?.baseUrl ?? null, name: ctx.inv.app?.name ?? null },
    scope: { id: ctx.scope.id ?? null, file: path.relative(runDir, ctx.scope.__file).replaceAll('\\', '/'), intent: ctx.scope.intent ?? null },
    journeys,
    probes,
    cleanupErrors: cleanupErrors ?? [],
  };
  results.findings = analyse(results);
  results.summary = summarise(results, results.findings);
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(results, null, 2));
  const html = await renderReport(runDir);
  const s = results.summary;
  console.log(`${s.journeysComplete}/${s.journeys} journeys complete${s.journeysBlocked ? `, ${s.journeysBlocked} blocked` : ''}${s.journeysPartial ? `, ${s.journeysPartial} partial` : ''}, ${s.steps} steps (${s.silent} silent), ${s.findings} finding(s).`);
  console.log(`Results: ${path.join(runDir, 'results.json')}`);
  console.log(`Report:  ${html}`);
  return s.journeysComplete < s.journeys ? 2 : 0;
}

function runDirArg() {
  const dir = path.resolve(args._[0] ?? args.run ?? '');
  if (!fs.existsSync(path.join(dir, 'results.json'))) throw new Error(`No results.json in ${dir}`);
  return dir;
}

async function cmdAnalyse() {
  const dir = runDirArg();
  const file = path.join(dir, 'results.json');
  const results = JSON.parse(fs.readFileSync(file, 'utf8'));
  results.findings = analyse(results);
  results.summary = summarise(results, results.findings);
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`${results.findings.length} finding(s). Report: ${await renderReport(dir)}`);
}

async function cmdReport() {
  console.log(await renderReport(runDirArg()));
}
