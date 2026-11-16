#!/usr/bin/env node
// Inventory maintenance.
//   node scripts/inventory.mjs list      [--inventory f] [--scope f]   tree of features/screens/states
//   node scripts/inventory.mjs validate  [--inventory f] [--scope f]   schema + reference checks
//   node scripts/inventory.mjs verify    [--feature a] [--screen x] [--scope f]   run each plan, report reachability, save screenshots
//   node scripts/inventory.mjs snapshot  --screen x [--state s] [--viewport v] | --url u  [--scope css]
//                                                                      print the ARIA snapshot (to discover screens/triggers)
// `--scope <scope.json>` (list/validate/verify only) overlays a scope-definition skill's
// journeys onto the inventory IN MEMORY for this command only (same overlay as assess.mjs
// --scope); a conflict aborts. On `snapshot`, `--scope` keeps its pre-existing, unrelated
// meaning: a CSS selector to print the ARIA snapshot of.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadInventory, validateInventory, resolveTargets, allScreens, DEFAULT_INVENTORY } from './lib/inventory.mjs';
import { loadScope, applyScope } from './lib/scope.mjs';
import { runStep, describeStep } from './lib/steps.mjs';

const [cmd = 'list', ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;

let inv = cmd === 'snapshot' && args.url && !fs.existsSync(args.inventory ?? DEFAULT_INVENTORY) ? null : loadInventory(args.inventory ?? DEFAULT_INVENTORY);
// `--scope <scope.json>` overlay for list/validate/verify. Not supported on `snapshot`: its
// own `--scope` flag already means "CSS selector to snapshot" (pre-existing, unrelated use).
if (inv && args.scope && cmd !== 'snapshot') {
  const scope = loadScope(args.scope);
  const applied = applyScope(inv, scope);
  if (applied.conflicts.length) {
    console.error(`Scope "${scope.id ?? args.scope}" conflicts with the inventory:\n- ${applied.conflicts.join('\n- ')}`);
    process.exit(1);
  }
  inv = applied.inv;
}

function storageStateOpt() {
  const p = args['storage-state'] ?? inv?.app?.storageState ?? null;
  if (!p) return {};
  const abs = path.resolve(path.dirname(inv.__file), p);
  if (!fs.existsSync(abs)) throw new Error(`storageState file not found: ${abs}`);
  return { storageState: abs };
}

switch (cmd) {
  case 'list': list(); break;
  case 'validate': validate(); break;
  case 'verify': await verify(); break;
  case 'snapshot': await snapshot(); break;
  default: console.error(`Unknown command ${cmd}`); process.exit(1);
}

function list() {
  console.log(`${inv.app.name ?? 'app'}  ${inv.app.baseUrl}`);
  for (const f of inv.features) {
    console.log(`\n${f.id}  ${f.name ?? ''}`);
    for (const s of f.states ?? []) console.log(`  ◇ ${f.id}.${s.id}  ${s.name ?? ''}`);
    const screens = f.screens ?? [];
    const print = (s, depth) => {
      const states = (s.states ?? []).map((x) => x.id).join(', ');
      console.log(`${'  '.repeat(depth)}- ${s.id} [${s.type ?? 'page'}] ${s.name ?? ''}${states ? `  states: ${states}` : ''}${s.patterns?.length ? `  patterns: ${s.patterns.join(', ')}` : ''}`);
      for (const c of allScreens(inv).filter((x) => x.parent === s.id)) print(c, depth + 1);
    };
    for (const s of screens.filter((x) => !x.parent || !screens.some((y) => y.id === x.parent))) print(s, 1);
  }
}

function validate() {
  const { errors, warnings } = validateInventory(inv);
  for (const w of warnings) console.log(`warn  ${w}`);
  for (const e of errors) console.log(`error ${e}`);
  const n = allScreens(inv).length;
  console.log(errors.length ? `\n${errors.length} errors` : `\nOK: ${inv.features.length} features, ${n} screens`);
  process.exit(errors.length ? 1 : 0);
}

async function verify() {
  const { errors } = validateInventory(inv);
  if (errors.length) { validate(); return; }
  const targets = resolveTargets(inv, { features: args.feature, screens: args.screen, states: args.state, viewports: args.viewport });
  const outDir = path.join(path.dirname(inv.__file), 'inventory-shots');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: args.channel });
  let failed = 0;
  for (const t of targets) {
    const ctx = await browser.newContext({ viewport: { width: t.viewport.width, height: t.viewport.height }, ...storageStateOpt(), ...(t.state.emulate ?? {}) });
    const page = await ctx.newPage();
    try {
      for (const st of t.plan) await runStep(page, st);
      if (t.screen.scope && !(await page.locator(t.screen.scope).first().isVisible())) throw new Error(`scope ${t.screen.scope} not visible`);
      await page.screenshot({ path: path.join(outDir, `${t.key}.png`) });
      console.log(`✓ ${t.key}`);
    } catch (err) {
      failed++;
      console.log(`✗ ${t.key}: ${err.message.split('\n')[0]}`);
    } finally {
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`\n${targets.length - failed}/${targets.length} reachable. Screenshots: ${outDir}`);
  process.exit(failed ? 1 : 0);
}

async function snapshot() {
  const browser = await chromium.launch({ channel: args.channel });
  let page;
  try {
    if (args.url) {
      page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ...storageStateOpt() })).newPage();
      await page.goto(args.url);
    } else {
      const [t] = resolveTargets(inv, { screens: args.screen, states: args.state ?? 'default', viewports: args.viewport });
      if (!t) throw new Error('Screen not found');
      page = await (await browser.newContext({ viewport: { width: t.viewport.width, height: t.viewport.height }, ...(t.state.emulate ?? {}) })).newPage();
      for (const st of t.plan) {
        console.error(`· ${describeStep(st)}`);
        await runStep(page, st);
      }
      if (args.scope ?? t.screen.scope) {
        console.log(await page.locator(args.scope ?? t.screen.scope).first().ariaSnapshot());
        return;
      }
    }
    await page.waitForTimeout(300);
    console.log(await page.locator('body').ariaSnapshot());
  } finally {
    await browser.close();
  }
}
