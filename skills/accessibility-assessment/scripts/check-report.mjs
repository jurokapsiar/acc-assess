#!/usr/bin/env node
// Opens a rendered report in a real browser and checks that it is usable:
//   node scripts/check-report.mjs <run> [--file report.html] [--channel msedge] [--headed]
//
// Checks: no "[object Object]"/"undefined"/"NaN" in the visible text; every Scope rail entry is
// labelled and selects a visible panel; images load; each screenshot overlay draws exactly the
// areas it was rendered for (finite, positive boxes); the full-screen dialog opens and closes
// with Escape; the partial / isolation / out-of-scope banners are present when the run needs
// them. Writes <run>/report-check.json and exits 1 on any problem.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { loadRunInputs } from './lib/results.mjs';
import { mergeAgentInput, isOutOfScope } from './lib/findings.mjs';

/** What the report must show, derived from the run data. */
export function expectationsFor(results, extra = [], annotations = {}) {
  return {
    partial: (results.targets ?? []).some((t) => t.status !== 'ok'),
    isolation: !!results.execution && (results.execution.isolation !== 'fresh-context' || (results.execution.interventions?.length ?? 0) > 0),
    outOfScope: mergeAgentInput(results.findings ?? [], extra, annotations).some(isOutOfScope),
  };
}

export async function checkReport(file, expect, { channel, headed = false } = {}) {
  const browser = await chromium.launch({ headless: !headed, channel });
  const problems = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message ?? e)));
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.querySelectorAll('img[loading]').forEach((i) => { i.loading = 'eager'; }));
    await page.waitForLoadState('load');
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 5000 }).catch(() => {});

    for (const e of pageErrors) problems.push(`page script error: ${e}`);

    const text = await page.evaluate(() => document.body.innerText);
    for (const m of text.matchAll(/\[object Object\]|\bundefined\b|\bNaN\b/g)) {
      const at = Math.max(0, m.index - 30);
      problems.push(`visible text contains "${m[0]}": …${text.slice(at, m.index + 40).replace(/\s+/g, ' ')}…`);
      if (problems.length > 20) break;
    }

    const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
    for (const src of broken) problems.push(`image did not load: ${src}`);

    const svgs = await page.evaluate(() => [...document.querySelectorAll('svg[data-areas]')].map((s) => {
      const rects = [...s.querySelectorAll('rect.area')];
      const bad = rects.filter((r) => ['x', 'y', 'width', 'height'].some((a) => !Number.isFinite(Number(r.getAttribute(a)))) || Number(r.getAttribute('width')) <= 0 || Number(r.getAttribute('height')) <= 0).length;
      return { expected: Number(s.dataset.areas), drawn: rects.length, bad, where: s.closest('[data-panel]')?.dataset.panel ?? s.closest('dialog')?.id ?? '?' };
    }));
    for (const s of svgs) {
      if (s.expected !== s.drawn) problems.push(`overlay ${s.where}: ${s.drawn} rectangles drawn but ${s.expected} areas expected`);
      if (s.bad) problems.push(`overlay ${s.where}: ${s.bad} rectangle(s) with a non-finite or empty box`);
    }

    const entries = await page.evaluate(() => [...document.querySelectorAll('.scope-layout .entry')].map((l) => ({
      id: l.querySelector('input')?.id ?? null,
      label: (l.textContent ?? '').trim(),
      hasPanel: !!l.querySelector('input') && !!document.querySelector(`[data-panel="${l.querySelector('input').id}"]`),
    })));
    for (const e of entries) {
      if (!e.id || !e.label) problems.push('a Scope rail entry has no radio or no label');
      else if (!e.hasPanel) problems.push(`Scope rail entry "${e.label}" has no panel`);
    }
    for (const e of entries.filter((x) => x.id && x.hasPanel).slice(0, 60)) {
      await page.locator(`label[for="${e.id}"]`).first().click();
      const visible = await page.locator(`[data-panel="${e.id}"]`).first().isVisible();
      if (!visible) problems.push(`selecting Scope rail entry "${e.label}" does not show its panel`);
    }

    const expand = page.locator('button.expand').first();
    if (await expand.count()) {
      const radio = await expand.evaluate((b) => b.closest('[data-panel]')?.dataset.panel ?? null);
      if (radio) await page.locator(`label[for="${radio}"]`).first().click();
      await expand.click();
      const dlg = page.locator(`dialog#${await expand.getAttribute('data-dialog')}`);
      if (!(await dlg.evaluate((d) => d.open))) problems.push('the full-screen dialog did not open');
      else {
        await page.keyboard.press('Escape');
        if (await dlg.evaluate((d) => d.open)) problems.push('the full-screen dialog did not close with Escape');
      }
    }

    const has = (sel) => page.locator(sel).count().then((n) => n > 0);
    if (expect.partial && !(await has('#partial-run'))) problems.push('run is partial but the "Partial run" banner is missing');
    if (!expect.partial && (await has('#partial-run'))) problems.push('"Partial run" banner shown for a complete run');
    if (expect.isolation && !(await has('#isolation-note'))) problems.push('run was not fresh-session but the isolation banner is missing');
    if (expect.outOfScope && !(await has('#out-of-scope-note'))) problems.push('findings are potentially out of scope but the banner is missing');
  } finally {
    await browser.close();
  }
  return { ok: problems.length === 0, problems };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const runDir = path.resolve(argv.find((a) => !a.startsWith('--')) ?? '');
  const file = path.join(runDir, opt('file') ?? 'report.html');
  if (!fs.existsSync(file)) {
    console.error(`No ${path.basename(file)} in ${runDir}`);
    process.exit(1);
  }
  const { results, extra, annotations } = loadRunInputs(runDir);
  const out = await checkReport(file, expectationsFor(results, extra, annotations), { channel: opt('channel'), headed: argv.includes('--headed') });
  fs.writeFileSync(path.join(runDir, 'report-check.json'), JSON.stringify(out, null, 2));
  if (!out.ok) {
    console.error(`report check failed:\n- ${out.problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log('report check passed');
}
