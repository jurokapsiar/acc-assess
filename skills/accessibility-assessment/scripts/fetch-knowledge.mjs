#!/usr/bin/env node
// Scrapes WCAG 2.2 success criteria and WAI-ARIA APG patterns into Markdown files.
// The output is a local cache (default: <skill>/knowledge, gitignored) – never commit it.
//
//   node scripts/fetch-knowledge.mjs [--out <dir>] [--only wcag|apg] [--force]
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { DEFAULT_KNOWLEDGE } from './lib/wcag.mjs';

const WCAG_JSON = 'https://www.w3.org/WAI/WCAG22/wcag.json';
const UNDERSTANDING = 'https://www.w3.org/WAI/WCAG22/Understanding/';
const QUICKREF = 'https://www.w3.org/WAI/WCAG22/quickref/#';
const APG_INDEX = 'https://www.w3.org/WAI/ARIA/apg/patterns/';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
const out = path.resolve(args.out ?? DEFAULT_KNOWLEDGE);
const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
td.remove(['script', 'style']);

const meta = { fetchedAt: new Date().toISOString(), sources: {} };
if (args.only !== 'apg') await fetchWcag();
if (args.only !== 'wcag') await fetchApg();
fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(`Knowledge written to ${out}`);

async function fetchWcag() {
  const dir = path.join(out, 'wcag');
  fs.mkdirSync(dir, { recursive: true });
  const data = await (await get(WCAG_JSON)).json();
  const criteria = [];
  for (const p of data.principles) {
    for (const g of p.guidelines) {
      for (const sc of g.successcriteria) {
        if (!sc.level || !sc.versions?.includes('2.2')) continue;
        const entry = {
          num: sc.num,
          id: sc.id,
          title: sc.handle,
          level: sc.level,
          principle: `${p.num} ${p.handle}`,
          guideline: `${g.num} ${g.handle}`,
          versions: sc.versions,
          url: UNDERSTANDING + sc.id,
          quickref: QUICKREF + sc.id,
          file: `wcag/${sc.num}-${sc.id}.md`,
        };
        criteria.push(entry);
        const tech = (k) => (sc.techniques?.[k] ?? []).flatMap((t) => flattenTechniques(t));
        const md = [
          `# ${sc.num} ${sc.handle} (Level ${sc.level})`,
          '',
          `- Principle: ${entry.principle}`,
          `- Guideline: ${entry.guideline}`,
          `- Introduced in: WCAG ${sc.versions[0]}`,
          `- Understanding: ${entry.url}`,
          `- How to meet: ${entry.quickref}`,
          '',
          '## Normative text',
          '',
          td.turndown(sc.content ?? sc.title ?? ''),
          ...section('Sufficient techniques', tech('sufficient')),
          ...section('Advisory techniques', tech('advisory')),
          ...section('Common failures', tech('failure')),
        ].join('\n');
        fs.writeFileSync(path.join(out, entry.file), md + '\n');
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'criteria.json'), JSON.stringify(criteria, null, 2));
  const rows = criteria.map((c) => `| [${c.num}](${path.basename(c.file)}) | ${c.title} | ${c.level} |`);
  fs.writeFileSync(path.join(dir, 'index.md'), ['# WCAG 2.2 success criteria', '', '| SC | Title | Level |', '|---|---|---|', ...rows, ''].join('\n'));
  meta.sources.wcag = { url: WCAG_JSON, count: criteria.length };
  console.log(`WCAG: ${criteria.length} success criteria`);
}

function flattenTechniques(t, depth = 0) {
  const pad = '  '.repeat(depth);
  const text = t.id ? `${t.id}: ${stripHtml(t.title ?? '')}` : stripHtml(t.title ?? '');
  const self = text ? [`${pad}- ${text}`] : [];
  const children = ['techniques', 'using', 'and', 'groups'].flatMap((k) => (Array.isArray(t[k]) ? t[k] : []));
  return [...self, ...children.flatMap((c) => flattenTechniques(c, text ? depth + 1 : depth))];
}

function section(title, items) {
  return items.length ? ['', `## ${title}`, '', ...items] : [];
}

function stripHtml(s) {
  return cheerio.load(`<div>${s}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}

async function fetchApg() {
  const dir = path.join(out, 'apg');
  fs.mkdirSync(dir, { recursive: true });
  const $ = cheerio.load(await (await get(APG_INDEX)).text());
  const patterns = $('li.pattern').map((_, li) => {
    const a = $(li).find('a[href]').first();
    const url = new URL(a.attr('href'), APG_INDEX).href;
    return {
      slug: url.replace(APG_INDEX, '').replace(/\/$/, ''),
      title: $(li).find('.pattern-name').text().trim() || a.text().trim(),
      summary: $(li).find('.pattern-introduction').text().replace(/\s+/g, ' ').trim(),
      url,
    };
  }).get();
  await pool(patterns, 4, async (p) => {
    const html = await (await get(p.url)).text();
    const $p = cheerio.load(html);
    const main = $p('main').first();
    main.find('img, svg, picture').remove();
    main.find('a[href]').each((_, a) => $p(a).attr('href', new URL($p(a).attr('href'), p.url).href));
    const title = main.find('h1').first().text().trim() || p.title;
    const parts = [`# ${title}`, '', `Source: ${p.url}`, ''];
    main.find('section[id]').each((_, s) => {
      const sec = $p(s);
      const h = sec.find('h2').first();
      const heading = h.text().trim() || sec.attr('id');
      h.remove();
      parts.push(`## ${heading}`, '', td.turndown(sec.html() ?? '').trim(), '');
    });
    fs.writeFileSync(path.join(dir, `${p.slug}.md`), parts.join('\n'));
  });
  const rows = patterns.map((p) => `| [${p.title}](${p.slug}.md) | \`${p.slug}\` | ${p.summary} |`);
  fs.writeFileSync(path.join(dir, 'index.md'), ['# WAI-ARIA APG patterns', '', '| Pattern | Slug | Summary |', '|---|---|---|', ...rows, ''].join('\n'));
  meta.sources.apg = { url: APG_INDEX, count: patterns.length };
  console.log(`APG: ${patterns.length} patterns`);
}

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'accessibility-assessment-skill (knowledge cache)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (i >= tries) throw new Error(`GET ${url} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}
