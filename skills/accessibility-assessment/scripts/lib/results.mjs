// The single owner of the results.json contract (see references/results-schema.md).
// assess.mjs builds results through the functions below and validates before writing;
// report.mjs / fixes.mjs / verify.mjs / summary.mjs validate on load and fail closed, so a
// malformed or hand-assembled results.json can never silently render a misleading report.
import fs from 'node:fs';
import path from 'node:path';

export const RESULTS_SCHEMA_VERSION = 1;
export const TARGET_STATUSES = ['ok', 'error', 'blocked', 'not-attempted'];
export const AREA_KINDS = ['finding', 'tabstop', 'scope', 'subscreen', 'cut'];
export const FINDING_KINDS = ['failure', 'review', 'suggestion'];
export const SCOPE_SIGNALS = ['in', 'out', 'unknown'];
export const AGENT_SCOPES = ['in', 'potentially-out'];
export const ISOLATION_LEVELS = ['fresh-context', 'shared-context', 'reused-page'];

export function createResults(base = {}) {
  return { schemaVersion: RESULTS_SCHEMA_VERSION, ...base, targets: [], findings: [], coverage: [] };
}

export function addTarget(results, target) {
  results.targets.push(target);
}

export function addFindings(results, findings) {
  results.findings.push(...findings);
}

/** Orders targets/findings by `order` (Map key -> index), assigns F0001.. ids, resolves
 * `areas[].finding` objects to ids and records the geometry disclosure of every ok target. */
export function finalizeResults(results, order) {
  const rank = (k) => order.get(k) ?? Number.MAX_SAFE_INTEGER;
  results.targets.sort((a, b) => rank(a.key) - rank(b.key));
  results.findings.sort((a, b) => rank(a.target) - rank(b.target));
  results.findings.forEach((f, i) => (f.id = `F${String(i + 1).padStart(4, '0')}`));
  for (const t of results.targets) {
    for (const a of t.areas ?? []) {
      if (a.finding && typeof a.finding === 'object') a.finding = a.finding.id;
    }
  }
  for (const t of results.targets) if (t.status === 'ok') t.geometry = computeGeometry(t, results.findings);
  return results;
}

export function isDrawable(f) {
  return (f.context?.phase ?? 'main') === 'main' && (f.nodes ?? []).some((n) => n.box);
}

function computeGeometry(t, findings) {
  const drawn = new Set((t.areas ?? []).filter((a) => a.kind === 'finding').map((a) => a.finding));
  const findingsWithoutBox = [];
  for (const f of findings) {
    if (f.target !== t.key || drawn.has(f.id)) continue;
    const phase = f.context?.phase ?? 'main';
    const reason = phase === 'reflow' ? 'other-viewport' : phase !== 'main' ? 'other-phase' : (f.nodes ?? []).some((n) => n.box) ? 'offscreen' : 'not-locatable';
    findingsWithoutBox.push({ finding: f.id, reason });
  }
  const hasScopeArea = (t.areas ?? []).some((a) => a.kind === 'scope');
  return {
    findingsWithoutBox,
    tabstopsWithoutBox: (t.tabOrder ?? []).filter((s) => !s.box).length,
    scope: !t.screen?.scope ? 'measured' : hasScopeArea ? 'measured' : `missing:${t.scopeMissingReason ?? 'not-locatable'}`,
  };
}

function pngSize(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(24);
    fs.readSync(fd, b, 0, 24, 0);
    if (b.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** Returns `{ errors: string[] }`. With `runDir`, screenshot files are checked on disk. */
export function validateResults(results, { runDir } = {}) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!isObj(results)) return { errors: ['results must be a JSON object'] };
  if (results.schemaVersion !== RESULTS_SCHEMA_VERSION) err(`schemaVersion must be ${RESULTS_SCHEMA_VERSION} (got ${JSON.stringify(results.schemaVersion)})`);
  if (!Array.isArray(results.targets)) err('targets must be an array');
  if (!Array.isArray(results.findings)) err('findings must be an array');
  if (errors.length) return { errors };

  // inventory: ids are strings, unique, states are string ids
  const states = new Map();
  const seenScreens = new Set();
  const features = results.inventory?.features;
  if (!Array.isArray(features)) err('inventory.features must be an array');
  for (const f of features ?? []) {
    for (const s of f.screens ?? []) {
      if (typeof s.id !== 'string' || !s.id) { err(`inventory screen id must be a non-empty string (got ${JSON.stringify(s.id)})`); continue; }
      if (seenScreens.has(s.id)) err(`inventory screen id "${s.id}" is duplicated`);
      seenScreens.add(s.id);
      if (!Array.isArray(s.states) || s.states.some((x) => typeof x !== 'string')) { err(`inventory screen "${s.id}": states must be an array of string ids`); continue; }
      states.set(s.id, new Set(s.states));
    }
  }

  const targetByKey = new Map();
  for (const t of results.targets) {
    const label = `target ${JSON.stringify(t?.key)}`;
    if (!isObj(t) || typeof t.key !== 'string') { err('every target needs a string key'); continue; }
    if (targetByKey.has(t.key)) err(`${label}: duplicate key`);
    targetByKey.set(t.key, t);
    const sid = t.screen?.id;
    const stid = t.state?.id;
    const vp = t.viewport?.name;
    if (typeof sid !== 'string' || typeof stid !== 'string' || typeof vp !== 'string') {
      err(`${label}: screen.id, state.id and viewport.name must be strings`);
    } else {
      if (t.key !== `${sid}__${stid}__${vp}`) err(`${label}: key must equal screen.id__state.id__viewport.name ("${sid}__${stid}__${vp}")`);
      if (!states.has(sid)) err(`${label}: screen "${sid}" is not in the inventory`);
      else if (!states.get(sid).has(stid)) err(`${label}: state "${stid}" is not a state of screen "${sid}" in the inventory`);
    }
    if (!TARGET_STATUSES.includes(t.status)) { err(`${label}: status must be one of ${TARGET_STATUSES.join(', ')} (got ${JSON.stringify(t.status)})`); continue; }
    if (t.status === 'blocked') {
      if (typeof t.blockedBy !== 'string' || !t.blockedBy) err(`${label}: blocked targets need blockedBy (the prerequisite target key)`);
      if (typeof t.reason !== 'string' || !t.reason) err(`${label}: blocked targets need a reason`);
    }
    if (t.status === 'not-attempted' && (typeof t.reason !== 'string' || !t.reason)) err(`${label}: not-attempted targets need a reason`);
    if (t.status === 'ok') validateOkTarget(t, label, runDir, err);
  }

  for (const t of targetByKey.values()) {
    if (t.status === 'blocked' && t.blockedBy && !targetByKey.has(t.blockedBy)) err(`target "${t.key}": blockedBy "${t.blockedBy}" is not a target in this run`);
  }

  const ids = new Set();
  for (const f of results.findings) {
    const label = `finding ${JSON.stringify(f?.id)}`;
    if (!isObj(f)) { err('every finding must be an object'); continue; }
    if (typeof f.id !== 'string' || !f.id) err('every finding needs a string id');
    else if (ids.has(f.id)) err(`${label}: duplicate id`);
    else ids.add(f.id);
    if (!targetByKey.has(f.target)) err(`${label}: target ${JSON.stringify(f.target)} does not exist`);
    if (!FINDING_KINDS.includes(f.kind)) err(`${label}: kind must be one of ${FINDING_KINDS.join(', ')}`);
    if (!f.rule && !f.title) err(`${label}: needs a rule or a title`);
    if (f.scopeSignal !== undefined && !SCOPE_SIGNALS.includes(f.scopeSignal)) err(`${label}: scopeSignal must be one of ${SCOPE_SIGNALS.join(', ')}`);
  }

  // area -> finding references and geometry disclosure
  for (const t of targetByKey.values()) {
    if (t.status !== 'ok') continue;
    const label = `target "${t.key}"`;
    const mine = results.findings.filter((f) => f.target === t.key);
    const mineIds = new Set(mine.map((f) => f.id));
    for (const a of t.areas ?? []) {
      if (a.kind === 'finding' && (typeof a.finding !== 'string' || !mineIds.has(a.finding))) err(`${label}: finding area references ${JSON.stringify(a.finding)}, which is not a finding on this target`);
    }
    const drawn = new Set((t.areas ?? []).filter((a) => a.kind === 'finding').map((a) => a.finding));
    const disclosed = new Set((t.geometry?.findingsWithoutBox ?? []).map((d) => d.finding));
    for (const f of mine) {
      if (isDrawable(f) && !drawn.has(f.id) && !disclosed.has(f.id)) err(`${label}: finding ${f.id} has located nodes but no area and no geometry.findingsWithoutBox disclosure`);
    }
    const stopsWithBox = (t.tabOrder ?? []).filter((s) => s.box).length;
    if (stopsWithBox && !(t.areas ?? []).some((a) => a.kind === 'tabstop') && !(t.geometry?.tabstopsWithoutBox > 0)) err(`${label}: tabOrder has boxes but no tabstop areas and no disclosure`);
    if (t.screen?.scope && !(t.areas ?? []).some((a) => a.kind === 'scope') && !String(t.geometry?.scope ?? '').startsWith('missing:')) err(`${label}: screen has a scope selector but no scope area and no geometry.scope "missing:<reason>" disclosure`);
  }

  if (results.execution !== undefined) {
    const ex = results.execution;
    if (!isObj(ex) || !ISOLATION_LEVELS.includes(ex.isolation)) err(`execution.isolation must be one of ${ISOLATION_LEVELS.join(', ')}`);
  }
  return { errors };
}

function validateOkTarget(t, label, runDir, err) {
  if (typeof t.screenshot !== 'string' || !t.screenshot) err(`${label}: ok targets need a screenshot`);
  if (!isObj(t.shot) || typeof t.shot.file !== 'string' || !finite(t.shot.width) || !finite(t.shot.height)) err(`${label}: ok targets need shot {file,width,height}`);
  else {
    if (t.shot.file !== t.screenshot) err(`${label}: shot.file must equal screenshot`);
    if (runDir && t.screenshot) {
      const abs = path.join(runDir, t.screenshot);
      if (!fs.existsSync(abs)) err(`${label}: screenshot file missing: ${t.screenshot}`);
      else {
        const size = pngSize(abs);
        if (!size) err(`${label}: screenshot is not a PNG: ${t.screenshot}`);
        else if (size.width !== t.shot.width || size.height !== t.shot.height) err(`${label}: shot is ${t.shot.width}x${t.shot.height} but the PNG is ${size.width}x${size.height}`);
      }
    }
  }
  const allowedShots = new Set([t.shot?.file, ...Object.values(t.shots ?? {})]);
  for (const [i, a] of (t.areas ?? []).entries()) {
    const al = `${label} areas[${i}]`;
    if (!AREA_KINDS.includes(a.kind)) err(`${al}: kind must be one of ${AREA_KINDS.join(', ')}`);
    const b = a.box;
    if (!isObj(b) || !finite(b.x) || !finite(b.y) || !finite(b.width) || !finite(b.height) || b.width <= 0 || b.height <= 0) err(`${al}: box needs finite x,y and positive width,height`);
    if (a.shot !== undefined && !allowedShots.has(a.shot)) err(`${al}: shot ${JSON.stringify(a.shot)} differs from the target shot ${JSON.stringify(t.shot?.file)}`);
  }
}

/** Validates the agent-supplied files that report/fixes merge into the run. */
export function validateAgentFiles({ agentFindings, annotations }) {
  const errors = [];
  if (agentFindings !== undefined) {
    if (!Array.isArray(agentFindings)) errors.push('agent-findings.json must be an array');
    else agentFindings.forEach((f, i) => {
      if (!isObj(f)) return errors.push(`agent-findings.json[${i}] must be an object`);
      if (!FINDING_KINDS.includes(f.kind)) errors.push(`agent-findings.json[${i}]: kind must be one of ${FINDING_KINDS.join(', ')}`);
      if (!f.rule && !f.title) errors.push(`agent-findings.json[${i}]: needs a rule or a title`);
      if (!AGENT_SCOPES.includes(f.scope)) errors.push(`agent-findings.json[${i}]: scope is required and must be one of ${AGENT_SCOPES.join(', ')} (check the finding against the requested scope)`);
    });
  }
  if (annotations !== undefined) {
    if (!isObj(annotations)) errors.push('annotations.json must be an object keyed by rule or finding id');
    else for (const [k, v] of Object.entries(annotations)) {
      if (!isObj(v)) { errors.push(`annotations.json["${k}"] must be an object`); continue; }
      if (v.kind !== undefined && ![...FINDING_KINDS, 'dismissed'].includes(v.kind)) errors.push(`annotations.json["${k}"].kind must be failure|review|suggestion|dismissed`);
      if (v.scope !== undefined && !AGENT_SCOPES.includes(v.scope)) errors.push(`annotations.json["${k}"].scope must be one of ${AGENT_SCOPES.join(', ')}`);
    }
  }
  return { errors };
}

/** Loads `<runDir>/results.json` and validates it. Returns `{ results, errors }`. */
export function loadResults(runDir, { validate = true } = {}) {
  const file = path.join(runDir, 'results.json');
  const results = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { results, errors: validate ? validateResults(results, { runDir }).errors : [] };
}

export function failOnInvalid(errors, what = 'results.json') {
  if (!errors.length) return;
  console.error(`${what} is invalid:\n- ${errors.slice(0, 40).join('\n- ')}${errors.length > 40 ? `\n… and ${errors.length - 40} more` : ''}`);
  process.exit(1);
}

/** Shared loader for report/fixes/summary: results + agent files, validated, fail closed. */
export function loadRunInputs(runDir) {
  const read = (name) => {
    const file = path.join(runDir, name);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
  };
  const results = JSON.parse(fs.readFileSync(path.join(runDir, 'results.json'), 'utf8'));
  const agentFindings = read('agent-findings.json');
  const annotations = read('annotations.json');
  const errors = [...validateResults(results, { runDir }).errors, ...validateAgentFiles({ agentFindings, annotations }).errors];
  failOnInvalid(errors, `${path.basename(runDir)}/results.json (or agent input)`);
  return { results, extra: agentFindings ?? [], annotations: annotations ?? {} };
}
