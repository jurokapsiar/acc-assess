// Half-donut charts and bars, plain SVG. Same geometry as the reports' ring charts.
export const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const f = (n) => Math.round(n * 100) / 100;

export function halfDonut(segments, { label, total, caption }) {
  const cx = 110, cy = 104, R = 96, r = 62, gap = 0.012;
  const sum = segments.reduce((s, x) => s + x.value, 0) || 1;
  const pt = (rad, a) => `${f(cx + rad * Math.cos(a))} ${f(cy + rad * Math.sin(a))}`;
  const arc = (a0, a1, fill) => `<path d="M ${pt(R, a0)} A ${R} ${R} 0 0 1 ${pt(R, a1)} L ${pt(r, a1)} A ${r} ${r} 0 0 0 ${pt(r, a0)} Z" fill="${fill}" stroke="rgba(0,0,0,.18)" stroke-width="1"/>`;
  let a = Math.PI, paths = arc(Math.PI, 2 * Math.PI, '#f0f0f0');
  for (const s of segments) {
    if (!s.value) continue;
    const span = (s.value / sum) * Math.PI;
    const a0 = a + (a > Math.PI ? gap / 2 : 0), a1 = a + span - (a + span < 2 * Math.PI - 1e-6 ? gap / 2 : 0);
    paths += arc(a0, Math.max(a0 + 0.001, a1), s.color);
    a += span;
  }
  const desc = segments.map((s) => `${s.label}: ${s.value}`).join(', ');
  return `<svg viewBox="0 0 220 112" role="img" aria-label="${esc(label)}. ${esc(desc)}.">${paths}
<text x="${cx}" y="${cy - 10}" text-anchor="middle" font-size="28" font-weight="700" fill="#1f1f1f" font-family="system-ui,sans-serif">${esc(total)}</text>
<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="11" fill="#555" font-family="system-ui,sans-serif">${esc(caption)}</text></svg>
${legend(segments)}`;
}

export function legend(segments) {
  return `<ul class="legend">${segments.map((s) => `<li><span class="sw" style="background:${s.color}" aria-hidden="true"></span>${esc(s.label)}<span class="n">${s.value}</span></li>`).join('')}</ul>`;
}

export function bars(items, max) {
  const m = max || Math.max(1, ...items.map((i) => i.value));
  return `<ul class="bars">${items.map((i) => `<li><span>${esc(i.label)}</span><span class="track" aria-hidden="true"><span class="fill" style="width:${f((i.value / m) * 100)}%;background:${i.color}"></span></span><span class="n">${i.value}<span class="sr-only"> criteria</span></span></li>`).join('')}</ul>`;
}

export const TOOL_FILL = { 'axe-core': '#9dbde3', AbleDOM: '#bcb3e2', Playwright: '#a6d4b1', Guidepup: '#93cfc4', agent: '#ebc872', manual: '#cfcfc9' };
export const LEVEL_FILL = { A: '#a9c4e6', AA: '#c4b8e6', AAA: '#e7c9a9', 'best practice': '#cfcfc9', unknown: '#e0e0e0' };
export const COVER_FILL = { automated: '#a6d4b1', agent: '#ebc872', manual: '#cfcfc9' };
export const toolFill = (t) => TOOL_FILL[t] || '#d9d9d9';
