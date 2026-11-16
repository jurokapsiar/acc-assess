#!/usr/bin/env node
// Scope-definition CLI dispatcher (§14). Turns a text prompt (or an existing session) into a
// confirmed, replay-verified `scope.json` + `journeys.json` that `assess.mjs --scope` and
// `verify.mjs` can consume. Every command reads/writes `work/session.json` (the state machine)
// under `<app>/.a11y/scopes/<id>/`; writes are confined to `.a11y/` (§3.1/§12). This skill never
// edits application source and never auto-applies fixes.
//
//   node scripts/scope.mjs init      --prompt "…" [--url] [--source-root] [--inventory]
//                                    [--base][--changed][--diff] [--viewport][--storage-state][--id]
//   node scripts/scope.mjs preflight --session <s> [--insecure] [--channel]
//   node scripts/scope.mjs intent    --session <s> (--template | --from <intent.json>)
//   node scripts/scope.mjs ground    --session <s> [--no-source] [--no-diff] [--limit 8]
//   node scripts/scope.mjs explore   --session <s> (--screen id [--state id] | --url p)
//                                    [--steps f] [--viewport v] [--headed] [--channel]
//   node scripts/scope.mjs step      --session <s> --journey <jid> [--title][--feature][--feature-name]
//                                    [--start-screen|--start-url] [--action a --target '<json>'
//                                    [--value][--key][--evidence][--reason]]
//                                    [--checkpoint screen|state --id <id> [--name][--type][--ready '<json>']
//                                     [--scope-css][--parent][--requires a,b][--emulate '<json>']]
//   node scripts/scope.mjs propose   --session <s>
//   node scripts/scope.mjs confirm   --session <s> --approved-by <name> [--yes]
//   node scripts/scope.mjs verify    --scope <f> [--viewport all|v1,v2] [--headed] [--channel]
//   node scripts/scope.mjs replay    --scope <f> --target <key> [--headed] [--channel]
//   node scripts/scope.mjs merge     --scope <f> [--inventory f] [--dry-run]
//   node scripts/scope.mjs login     --save <file> --url <loginUrl> [--channel]
//   node scripts/scope.mjs status    --session <s> | --scope <f>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadInventoryLib, loadScopeLib, loadStepsLib, launchChromium, assertSiblingInstalled, requireFromSibling } from './lib/deps.mjs';
import { scopeDir, workDir, sessionFile, initSession, loadSession, saveSession, transitionPhase, resolveContained, writeJsonAtomic } from './lib/session.mjs';
import { validateIntent, intentTemplate } from './lib/intent.mjs';
import { groundInventory } from './lib/ground-inventory.mjs';
import { groundSource, hasRipgrep } from './lib/ground-source.mjs';
import { changedFilesFromGit, changedFilesFromPatch, groundDiff } from './lib/diff.mjs';
import { explore as runExplore } from './lib/explore.mjs';
import { buildStep, addStep, addCheckpoint, renderProposal, proposalSha256 } from './lib/journeys.mjs';
import { verifyTargets, replayTarget } from './lib/replay.mjs';
import { runProducer } from './lib/producers/index.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[i + 1] !== undefined && !rest[i + 1].startsWith('--') ? rest[++i] : true;
}
const appRoot = path.resolve(args['app-root'] ?? process.cwd());
const csv = (v) => (v === undefined || v === true ? null : String(v).split(',').map((s) => s.trim()).filter(Boolean));

try {
  switch (cmd) {
    case 'init': await cmdInit(); break;
    case 'preflight': await cmdPreflight(); break;
    case 'intent': cmdIntent(); break;
    case 'ground': cmdGround(); break;
    case 'explore': await cmdExplore(); break;
    case 'step': cmdStep(); break;
    case 'propose': await cmdPropose(); break;
    case 'confirm': cmdConfirm(); break;
    case 'verify': await cmdVerify(); break;
    case 'replay': await cmdReplay(); break;
    case 'merge': await cmdMerge(); break;
    case 'login': await cmdLogin(); break;
    case 'status': cmdStatus(); break;
    default:
      console.error(`Unknown command "${cmd}". See the top of scripts/scope.mjs for usage.`);
      process.exit(3);
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(err.code === 'CONFLICT' ? 2 : 1);
}

// ---------------------------------------------------------------------------------------------
async function cmdInit() {
  if (!args.prompt) throw new Error('--prompt is required');
  const session = initSession(appRoot, {
    prompt: args.prompt,
    inventory: args.inventory,
    baseUrl: args.url,
    sourceRoot: args['source-root'],
    viewport: args.viewport,
    storageState: args['storage-state'],
    base: args.base,
    changed: args.changed,
    diff: args.diff,
    insecure: !!args.insecure,
    channel: args.channel,
    id: args.id,
  });
  console.log(`Created session "${session.id}" -> ${sessionFile(appRoot, session.id)}`);
  console.log(`Next: node scripts/scope.mjs preflight --session ${session.id}`);
}

function requireSession() {
  if (!args.session) throw new Error('--session <id> is required');
  return loadSession(appRoot, args.session);
}

async function cmdPreflight() {
  const session = requireSession();
  const checks = [];
  const blockers = [];
  const warnings = [];

  if (process.versions.node.split('.')[0] < 20) blockers.push('Node >= 20 is required');

  try {
    assertSiblingInstalled();
    requireFromSibling('playwright');
    checks.push('sibling skill + playwright resolvable: ok');
  } catch (err) {
    blockers.push(err.message);
  }

  try {
    const browser = await launchChromium({ channel: args.channel ?? session.channel });
    await browser.close();
    checks.push('chromium launchable: ok');
  } catch (err) {
    blockers.push(`Chromium not launchable: ${err.message}`);
  }

  let inv = null;
  const invPath = path.resolve(appRoot, session.inventory);
  if (!fs.existsSync(invPath)) {
    warnings.push(`Inventory not found at ${invPath} (ok for a brand-new scope; MVP-1 text journeys still need existing screens to attach states to).`);
  } else {
    try {
      const { loadInventory, validateInventory } = await loadInventoryLib();
      inv = loadInventory(invPath);
      const { errors } = validateInventory(inv);
      if (errors.length) blockers.push(...errors.map((e) => `inventory: ${e}`));
      else checks.push('inventory valid: ok');
    } catch (err) {
      blockers.push(`inventory: ${err.message}`);
    }
  }

  const baseUrl = session.baseUrl ?? inv?.app?.baseUrl;
  if (baseUrl) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(baseUrl, { signal: ctrl.signal, redirect: 'follow' }).finally(() => clearTimeout(timer));
      if (res.status >= 400) blockers.push(`App not reachable at ${baseUrl} (HTTP ${res.status}). Start it${inv?.app?.start ? ` (${inv.app.start})` : ''}.`);
      else checks.push(`app reachable (${baseUrl}): ok`);
    } catch (err) {
      if (!args.insecure) blockers.push(`App not reachable at ${baseUrl}: ${err.message}. Start it${inv?.app?.start ? ` (${inv.app.start})` : ''}, or pass --insecure for self-signed certs.`);
      else warnings.push(`App reachability check skipped/failed under --insecure: ${err.message}`);
    }
  } else {
    warnings.push('No baseUrl known yet (no --url and no inventory.app.baseUrl); explore/verify will need one.');
  }

  if (session.sourceRoot) {
    if (!fs.existsSync(path.resolve(appRoot, session.sourceRoot))) blockers.push(`--source-root does not exist: ${session.sourceRoot}`);
    else checks.push('source root exists: ok');
    if (!hasRipgrep()) warnings.push('"rg" (ripgrep) not found; ground-source falls back to a slower directory walk.');
  }

  if (session.diffSpec?.base) {
    const r = spawnSync('git', ['rev-parse', '--verify', session.diffSpec.base], { cwd: appRoot, encoding: 'utf8' });
    if (r.status !== 0) blockers.push(`--base ref "${session.diffSpec.base}" does not resolve (git: ${r.stderr?.trim() || 'not available'})`);
    else checks.push('--base ref resolves: ok');
  }

  if (session.storageState) {
    const ssPath = path.resolve(appRoot, session.storageState);
    if (!fs.existsSync(ssPath)) blockers.push(`--storage-state file not found: ${ssPath}`);
    else {
      checks.push('storageState file exists: ok');
      if (!/\.a11y[\\/]auth[\\/]/.test(ssPath)) warnings.push('storageState is not under .a11y/auth/ - make sure it is gitignored.');
    }
  }

  const result = { at: new Date().toISOString(), checks, warnings, blockers };
  writeJsonAtomic(path.join(workDir(appRoot, session.id), 'preflight.json'), result);
  for (const c of checks) console.log(`  ok    ${c}`);
  for (const w of warnings) console.log(`  warn  ${w}`);
  for (const b of blockers) console.log(`  BLOCK ${b}`);
  if (!blockers.length) {
    transitionPhase(session, 'preflighted');
    saveSession(appRoot, session);
  }
  if (blockers.length) process.exit(1);
}

function defaultActionPolicy() {
  return { forbid: [], allowEvaluate: false, allowStorage: false, requestedDestructive: [] };
}

function cmdIntent() {
  const session = requireSession();
  transitionPhase(session, session.phase, { minPhase: 'preflighted', force: !!args.force });
  if (args.template) {
    console.log(JSON.stringify(intentTemplate(session.prompt), null, 2));
    return;
  }
  if (!args.from) {
    console.error('The agent interprets the prompt: write intent.json yourself, then run again with --from <intent.json>.\nUse --template to print a skeleton with the prompt filled in.');
    process.exit(3);
  }
  const doc = JSON.parse(fs.readFileSync(path.resolve(args.from), 'utf8'));
  const { errors, intent } = validateIntent(doc, { prompt: session.prompt });
  if (errors.length) throw new Error(`Invalid intent file:\n- ${errors.join('\n- ')}`);
  if (session.diffSpec?.base || session.diffSpec?.diff) {
    const files =
      changedFilesFromGit({ cwd: appRoot, base: session.diffSpec.base, changed: session.diffSpec.changed ?? 'HEAD' }) ??
      (session.diffSpec.diff ? changedFilesFromPatch(path.resolve(appRoot, session.diffSpec.diff)) : []);
    intent.changedFiles = files ?? [];
  }
  const file = path.join(workDir(appRoot, session.id), 'intent.json');
  writeJsonAtomic(file, intent);
  session.actionPolicy = intent.actionPolicy;
  session.viewports = intent.viewports?.length ? intent.viewports : session.viewport ? [session.viewport] : [];
  transitionPhase(session, 'intent');
  saveSession(appRoot, session);
  console.log(`Wrote ${file}`);
  console.log(JSON.stringify(intent, null, 2));
  console.log('\nIntent validated (schema only; interpreting the prompt is the agent\'s job). Next: ground.');
}

function cmdGround() {
  const session = requireSession();
  transitionPhase(session, session.phase, { minPhase: 'intent', force: !!args.force });
  const intentFile = path.join(workDir(appRoot, session.id), 'intent.json');
  const intent = JSON.parse(fs.readFileSync(intentFile, 'utf8'));
  const limit = Number(args.limit ?? 8);

  const grounding = { at: new Date().toISOString(), sources: [] };
  const invPath = path.resolve(appRoot, session.inventory);
  if (fs.existsSync(invPath)) {
    const inv = JSON.parse(fs.readFileSync(invPath, 'utf8'));
    const invGround = groundInventory(inv, intent, { existingTargetKeys: [] });
    for (const key of Object.keys(invGround.byPhrase)) invGround.byPhrase[key].candidates = invGround.byPhrase[key].candidates.slice(0, limit);
    grounding.sources.push(invGround);
  } else {
    grounding.sources.push({ source: 'inventory', byPhrase: {}, note: 'no inventory yet' });
  }

  if (session.sourceRoot && args['no-source'] !== true) {
    grounding.sources.push(groundSource({ sourceRoot: path.resolve(appRoot, session.sourceRoot), intent }));
  }

  if (args['no-diff'] !== true && intent.changedFiles?.length) {
    const invPath2 = path.resolve(appRoot, session.inventory);
    const inv2 = fs.existsSync(invPath2) ? JSON.parse(fs.readFileSync(invPath2, 'utf8')) : { features: [] };
    grounding.sources.push(groundDiff({ appRoot, inv: inv2, changedFiles: intent.changedFiles }));
  }

  const file = path.join(workDir(appRoot, session.id), 'grounding.json');
  writeJsonAtomic(file, grounding);
  transitionPhase(session, 'grounded');
  saveSession(appRoot, session);
  console.log(`Wrote ${file}`);
  console.log(JSON.stringify(grounding, null, 2));
}

async function cmdExplore() {
  const session = requireSession();
  transitionPhase(session, session.phase, { minPhase: 'grounded', force: !!args.force });
  const record = await runExplore({
    appRoot,
    workDir: workDir(appRoot, session.id),
    session,
    screen: args.screen,
    state: args.state,
    url: args.url,
    steps: args.steps ? path.resolve(args.steps) : null,
    viewport: args.viewport,
    headed: !!args.headed,
    channel: args.channel ?? session.channel,
    setup: args.setup,
    cdp: args.cdp,
  });
  session.explorations = session.explorations ?? [];
  session.explorations.push(record);
  if (session.phase === 'grounded') transitionPhase(session, 'explored');
  saveSession(appRoot, session);
  console.log(`Exploration #${record.n}: ${record.url}`);
  if (record.ambiguous.length) console.log(`  ambiguous step targets: ${record.ambiguous.length}`);
  console.log(`  snapshot: ${record.snapshot}`);
  console.log(`  screenshot: ${record.shot}`);
}

function cmdStep() {
  const session = requireSession();
  transitionPhase(session, session.phase, { minPhase: 'grounded', force: !!args.force });
  session.draft = session.draft ?? { journeys: [] };

  const journeyId = args.journey;
  if (!journeyId) throw new Error('--journey <id> is required');
  const feature = args.feature ? { id: args.feature, name: args['feature-name'] ?? args.feature } : undefined;
  const start = args['start-screen'] ? { screen: args['start-screen'] } : args['start-url'] ? { url: args['start-url'] } : undefined;

  if (args.checkpoint) {
    const kind = args.checkpoint;
    if (kind !== 'screen' && kind !== 'state') throw new Error('--checkpoint must be "screen" or "state"');
    let screen;
    let state;
    if (kind === 'screen') {
      screen = args.name || args.type || args.ready || args['scope-css']
        ? {
            id: args.id,
            name: args.name,
            type: args.type,
            ...(args.ready ? { ready: JSON.parse(args.ready) } : {}),
            ...(args['scope-css'] ? { scope: args['scope-css'] } : {}),
            ...(args.parent ? { parent: args.parent } : {}),
            ...(args.trigger ? { trigger: JSON.parse(args.trigger) } : {}),
          }
        : args.id;
    } else {
      screen = args.screen;
      if (!screen) throw new Error('--checkpoint state needs --screen <id> (the screen this state attaches to)');
      state = { id: args.id, name: args.name ?? args.id, ...(args.requires ? { requires: csv(args.requires) } : {}), ...(args.emulate ? { emulate: JSON.parse(args.emulate) } : {}) };
    }
    addCheckpoint(session.draft, { journeyId, journeyTitle: args.title, feature, start, kind, screen, state, parent: args.parent });
  }

  if (args.modalities !== undefined) {
    const list = String(args.modalities).split(',').map((m) => m.trim()).filter(Boolean);
    const known = ['keyboard', 'mouse', 'sr-keyboard', 'sr-navigation'];
    const bad = list.filter((m) => !known.includes(m));
    if (!list.length || bad.length) throw new Error(`--modalities must be a comma list of ${known.join(', ')}`);
    const j = session.draft.journeys.find((x) => x.id === journeyId);
    if (!j) throw new Error(`--modalities needs an existing journey; pass --checkpoint in the same call or earlier`);
    j.modalities = list;
  }

  if (args.action) {
    const jr = session.draft.journeys.find((x) => x.id === journeyId);
    const intentFile = path.join(workDir(appRoot, session.id), 'intent.json');
    const intentMods = fs.existsSync(intentFile) ? JSON.parse(fs.readFileSync(intentFile, 'utf8')).modalities ?? [] : [];
    const effective = jr?.modalities?.length ? jr.modalities : intentMods;
    const step = buildStep({
      action: args.action,
      target: args.target ? JSON.parse(args.target) : undefined,
      value: args.value,
      key: args.key,
      evidenceRaw: args.evidence,
      nthReason: args.reason,
      selectorReason: args.reason,
      policy: session.actionPolicy ?? defaultActionPolicy(),
      modality: {
        intent: args.intent,
        keys: args.keys,
        modalitySkip: args['modality-skip'],
        skipReason: args.reason,
        reason: args.reason,
        keyboardJourney: effective.some((m) => m !== 'mouse'),
      },
    });
    addStep(session.draft, { journeyId, journeyTitle: args.title, feature, start, step });
  }

  if (!args.checkpoint && !args.action) throw new Error('step needs --checkpoint and/or --action');
  saveSession(appRoot, session);
  console.log(`Journey "${journeyId}": ${session.draft.journeys.find((j) => j.id === journeyId).segments.length} segment(s)`);
}

async function cmdPropose() {
  const session = requireSession();
  transitionPhase(session, session.phase, { minPhase: 'grounded', force: !!args.force });
  const { loadInventory, resolveTargets } = await loadInventoryLib();
  const { compileJourneys, applyScope } = await loadScopeLib();
  const { describeStep } = await loadStepsLib();

  const invPath = path.resolve(appRoot, session.inventory);
  const inv = loadInventory(invPath);
  const intentFile = path.join(workDir(appRoot, session.id), 'intent.json');
  const intent = fs.existsSync(intentFile) ? JSON.parse(fs.readFileSync(intentFile, 'utf8')) : { prompt: session.prompt, include: [], exclude: [], viewports: [] };

  const produced = await runProducer('text', { session, inventory: inv, intent, app: { baseUrl: inv.app?.baseUrl, storageState: session.storageState }, workDir: workDir(appRoot, session.id) });
  const intentModalities = intent.modalities ?? [];
  const journeysDoc = { schemaVersion: 1, journeys: produced.journeys.map((j) => (j.modalities?.length || !intentModalities.length ? j : { ...j, modalities: intentModalities })) };
  if (!journeysDoc.journeys.length) throw new Error('No journeys drafted yet; run "step"/"checkpoint" before "propose".');

  const dir = scopeDir(appRoot, session.id);
  fs.mkdirSync(dir, { recursive: true });
  const journeysFile = path.join(dir, 'journeys.json');
  fs.writeFileSync(journeysFile, JSON.stringify(journeysDoc, null, 2) + '\n');
  const journeysSha256 = crypto.createHash('sha256').update(fs.readFileSync(journeysFile)).digest('hex');

  const overlay = compileJourneys(journeysDoc);
  const tmpScope = { journeys: 'journeys.json', __file: path.join(dir, 'scope.json') };
  const { inv: overlaid, conflicts } = applyScope(inv, tmpScope);
  if (conflicts.length) throw new Error(`Journeys conflict with the inventory:\n- ${conflicts.join('\n- ')}`);

  const viewports = intent.viewports?.length ? intent.viewports : session.viewports?.length ? session.viewports : Object.keys(inv.viewports ?? { desktop: 1 }).slice(0, 1);
  const pairs = new Set();
  for (const j of journeysDoc.journeys) {
    for (const seg of j.segments ?? []) {
      const screenId = typeof seg.screen === 'string' ? seg.screen : seg.screen.id;
      const stateId = seg.kind === 'state' ? seg.state.id : 'default';
      pairs.add(`${screenId}\u0000${stateId}`);
    }
  }
  const targets = [];
  for (const pair of pairs) {
    const [screenId, stateId] = pair.split('\u0000');
    for (const vp of viewports) targets.push(`${screenId}__${stateId}__${vp}`);
  }
  const resolved = resolveTargets(overlaid, { targets });
  if (resolved.length !== targets.length) throw new Error('Internal error: some drafted targets did not resolve against the compiled overlay.');

  const screens = [...new Set(targets.map((t) => t.split('__')[0]))];
  const states = [...new Set(targets.map((t) => t.split('__')[1]))];
  const excluded = (intent.exclude ?? []).map((e) => ({ ref: e.phrase, reason: e.reason }));

  const unresolved = [];
  const groundingFile = path.join(workDir(appRoot, session.id), 'grounding.json');
  if (fs.existsSync(groundingFile)) {
    const grounding = JSON.parse(fs.readFileSync(groundingFile, 'utf8'));
    const invSource = grounding.sources?.find((s) => s.source === 'inventory');
    for (const [phrase, info] of Object.entries(invSource?.byPhrase ?? {})) {
      const matchedInJourney = journeysDoc.journeys.some((j) => JSON.stringify(j).toLowerCase().includes(phrase.toLowerCase()));
      const excludedAlready = excluded.some((e) => e.ref === phrase);
      if (!matchedInJourney && !excludedAlready) {
        unresolved.push({ phrase, status: info.ambiguous ? 'ambiguous' : 'unmatched', candidates: info.candidates?.map((c) => c.ref) ?? [] });
      }
    }
  }

  const scope = {
    schemaVersion: 1,
    id: session.id,
    status: 'proposed',
    intent: session.prompt,
    producers: [...new Set(journeysDoc.journeys.map((j) => j.producer))],
    inventory: path.relative(dir, invPath).split(path.sep).join('/'),
    inventorySha256: crypto.createHash('sha256').update(fs.readFileSync(invPath)).digest('hex'),
    journeys: 'journeys.json',
    journeysSha256,
    targets,
    ...(intentModalities.length ? { modalities: intentModalities } : {}),
    selection: { features: null, screens, states, viewports },
    excluded,
    unresolved,
    storageState: session.storageState ?? null,
    approval: null,
    verification: null,
  };
  const scopeFile = path.join(dir, 'scope.json');
  writeJsonAtomic(scopeFile, scope);

  const proposalMd = renderProposal({ intent: session.prompt, targets: resolved.map((t) => ({ key: t.key, confidence: 'proposed' })), journeysDoc, excluded, unresolved, describeStep, modalities: intentModalities, unsupportedModalities: intent.unsupportedModalities ?? [], excludedModalities: intent.excludedModalities ?? [], assumptions: intent.assumptions ?? [] });
  fs.writeFileSync(path.join(dir, 'proposal.md'), proposalMd);

  transitionPhase(session, 'proposed');
  session.scopeFile = path.relative(appRoot, scopeFile).split(path.sep).join('/');
  saveSession(appRoot, session);
  console.log(`Wrote ${scopeFile}`);
  console.log(`Wrote ${journeysFile}`);
  console.log(`Wrote ${path.join(dir, 'proposal.md')}`);
  console.log(`Targets: ${targets.join(', ')}`);
}

function cmdConfirm() {
  const session = requireSession();
  if (!args['approved-by']) throw new Error('--approved-by <name> is required (agents must never self-approve; this records the human confirm gate, §6.6)');
  if (args.yes && process.env.A11Y_SCOPE_AUTOCONFIRM !== '1') throw new Error('--yes requires A11Y_SCOPE_AUTOCONFIRM=1 (tests/CI only)');
  const dir = scopeDir(appRoot, session.id);
  const scopeFile = path.join(dir, 'scope.json');
  const scope = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
  const proposalMd = fs.readFileSync(path.join(dir, 'proposal.md'), 'utf8');
  scope.approval = { by: args['approved-by'], at: new Date().toISOString(), proposalSha256: proposalSha256(proposalMd) };
  scope.status = 'confirmed';
  writeJsonAtomic(scopeFile, scope);
  transitionPhase(session, 'confirmed');
  saveSession(appRoot, session);
  console.log(`Confirmed by ${args['approved-by']}: ${scopeFile}`);
}

async function cmdVerify() {
  if (!args.scope) throw new Error('--scope <file> is required');
  const scopeFile = path.resolve(args.scope);
  const scope = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
  scope.__file = scopeFile;
  const { loadInventory } = await loadInventoryLib();
  const invPath = path.resolve(path.dirname(scopeFile), scope.inventory);
  const inv = loadInventory(invPath);
  const viewportFilter = args.viewport && args.viewport !== 'all' ? csv(args.viewport) : null;
  const dir = path.dirname(scopeFile);
  const { results, status, conflicts, execution } = await verifyTargets({
    appRoot,
    inv,
    scope,
    targets: scope.targets,
    viewportFilter,
    workDir: path.join(dir, 'work'),
    headed: !!args.headed,
    channel: args.channel,
    setup: args.setup,
    cdp: args.cdp,
  });
  if (conflicts) {
    console.error(`Scope conflicts with inventory:\n- ${conflicts.join('\n- ')}`);
    process.exit(1);
  }
  scope.verification = { at: new Date().toISOString(), results, ...(execution ? { execution } : {}) };
  scope.status = status === 'verified' ? 'verified' : 'partial';
  const unresolvedKeys = Object.entries(results).filter(([, r]) => r.status !== 'verified').map(([k]) => k);
  scope.unresolved = [...(scope.unresolved ?? []).filter((u) => !u.target), ...unresolvedKeys.map((k) => ({ target: k, status: results[k].status, reason: results[k].reason }))];
  writeJsonAtomic(scopeFile, scope);

  try {
    const session = loadSession(appRoot, scope.id);
    transitionPhase(session, scope.status === 'verified' ? 'verified' : session.phase);
    saveSession(appRoot, session);
  } catch {
    /* session may have been cleaned up; scope.json alone is authoritative for verify */
  }

  for (const [key, r] of Object.entries(results)) console.log(`${r.status === 'verified' ? '✓' : '✗'} ${key}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
  console.log(`\n${Object.values(results).filter((r) => r.status === 'verified').length}/${Object.keys(results).length} verified.`);
  process.exit(scope.status === 'verified' ? 0 : 2);
}

async function cmdReplay() {
  if (!args.scope || !args.target) throw new Error('--scope <file> and --target <key> are required');
  const scopeFile = path.resolve(args.scope);
  const scope = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
  scope.__file = scopeFile;
  const { loadInventory } = await loadInventoryLib();
  const inv = loadInventory(path.resolve(path.dirname(scopeFile), scope.inventory));
  await replayTarget({ appRoot, inv, scope, targetKey: args.target, headed: args.headed !== 'false', channel: args.channel, setup: args.setup, cdp: args.cdp });
}

async function cmdMerge() {
  if (!args.scope) throw new Error('--scope <file> is required');
  const scopeFile = path.resolve(args.scope);
  const scope = JSON.parse(fs.readFileSync(scopeFile, 'utf8'));
  scope.__file = scopeFile;
  if (scope.status !== 'verified') throw new Error(`Scope "${scope.id}" is not verified (status: ${scope.status}); run "scope.mjs verify" first.`);
  const { loadInventory, saveInventory } = await loadInventoryLib();
  const { compileJourneys, applyScope } = await loadScopeLib();
  const invPath = args.inventory ? path.resolve(args.inventory) : path.resolve(path.dirname(scopeFile), scope.inventory);
  const lockFile = `${invPath}.lock`;
  const workLock = path.join(path.dirname(scopeFile), 'work', 'merge.lock');
  fs.mkdirSync(path.dirname(workLock), { recursive: true });

  const acquireLock = (file) => {
    const start = Date.now();
    for (;;) {
      try {
        fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
        return;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        const age = Date.now() - fs.statSync(file).mtimeMs;
        if (age > 60000) {
          fs.rmSync(file, { force: true });
          continue;
        }
        if (Date.now() - start > 10000) throw new Error(`Could not acquire lock ${file} (held > 10s)`);
      }
    }
  };
  acquireLock(workLock);
  acquireLock(lockFile);
  try {
    const inv = loadInventory(invPath);
    const { inv: overlaid, conflicts } = applyScope(inv, scope);
    if (conflicts.length) {
      console.error(`Merge conflicts (nothing written):\n- ${conflicts.join('\n- ')}`);
      process.exit(2);
    }
    const overlay = compileJourneys(JSON.parse(fs.readFileSync(path.resolve(path.dirname(scopeFile), scope.journeys), 'utf8')));
    const added = [];
    for (const of_ of overlay.features) {
      const existingF = inv.features.find((f) => f.id === of_.id);
      if (!existingF) added.push(`+ feature ${of_.id}`);
      for (const os of of_.screens) {
        const existingS = existingF?.screens?.find((s) => s.id === os.id);
        if (!existingS) added.push(`+ screen ${os.id}`);
        for (const st of os.states ?? []) {
          if (!existingS?.states?.some((s) => s.id === st.id)) added.push(`+ state ${os.id}.${st.id}`);
        }
      }
    }
    if (args['dry-run']) {
      console.log(added.length ? added.join('\n') : 'No changes (overlay already present, or everything matches - no-op).');
      return;
    }
    const now = new Date().toISOString();
    for (const of_ of overlay.features) {
      const feature = overlaid.features.find((f) => f.id === of_.id);
      for (const os of of_.screens) {
        const screen = feature.screens.find((s) => s.id === os.id);
        if (added.includes(`+ screen ${os.id}`)) screen.provenance = { scope: scope.id, producer: scope.producers?.[0] ?? 'text', at: now };
        for (const st of screen.states ?? []) {
          if (added.includes(`+ state ${os.id}.${st.id}`)) st.provenance = { scope: scope.id, producer: scope.producers?.[0] ?? 'text', at: now };
        }
      }
    }
    saveInventory(overlaid, invPath);
    console.log(added.length ? `Merged:\n${added.join('\n')}` : 'No changes (no-op).');
  } finally {
    fs.rmSync(lockFile, { force: true });
    fs.rmSync(workLock, { force: true });
  }
}

async function cmdLogin() {
  if (!args.save || !args.url) throw new Error('--save <file> and --url <loginUrl> are required');
  const browser = await launchChromium({ channel: args.channel, headed: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(args.url);
  console.log('Log in manually in the opened browser window, then close the Playwright Inspector / resume to save storageState.');
  await page.pause();
  const file = resolveContained(appRoot, args.save, { allowOutsideA11y: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await context.storageState({ path: file });
  await browser.close();
  console.log(`Saved storage state to ${file}`);
}

function cmdStatus() {
  if (args.scope) {
    const scope = JSON.parse(fs.readFileSync(path.resolve(args.scope), 'utf8'));
    console.log(`scope ${scope.id}  status=${scope.status}`);
    console.log(`targets: ${scope.targets.join(', ')}`);
    if (scope.verification) {
      const verified = Object.values(scope.verification.results).filter((r) => r.status === 'verified').length;
      console.log(`verification @ ${scope.verification.at}: ${verified}/${scope.targets.length} verified`);
    }
    return;
  }
  const session = requireSession();
  console.log(`session ${session.id}  phase=${session.phase}`);
  console.log(`prompt: ${session.prompt}`);
  console.log(`journeys drafted: ${session.draft?.journeys?.length ?? 0}`);
  console.log(`explorations: ${session.explorations?.length ?? 0}`);
  if (session.invalidated?.length) console.log(`invalidated phases: ${session.invalidated.join(', ')}`);
}
