// Plausibility check for fix `changes`: do the replaced source lines mention the target node?
// Tokens come from the node's selector (last compound), html opening tag and short visible text.
// A node with no distinctive token (`html`, `img`) falls back to its tag name as `<tag`.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function nodeTokens(n) {
  const tokens = new Set();
  const sel = String(n?.selector ?? '').trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean).at(-1) ?? '';
  const tag = (n?.identity?.tag ?? sel.match(/^[a-zA-Z][\w-]*/)?.[0] ?? n?.html?.match(/^<([a-zA-Z][\w-]*)/)?.[1] ?? '').toLowerCase();
  for (const m of sel.matchAll(/#([\w-]+)|\.([\w-]+)|\[[\w:-]+(?:[~|^$*]?=["']?([^\]"']+)["']?)?\]/g)) {
    for (const t of [m[1], m[2], m[3]]) if (t) tokens.add(t);
  }
  const open = String(n?.html ?? '').match(/^<[^>]*>/)?.[0] ?? '';
  const id = open.match(/\sid="([^"]+)"/)?.[1];
  if (id) tokens.add(id);
  for (const c of open.match(/\sclass="([^"]*)"/)?.[1]?.split(/\s+/) ?? []) if (c) tokens.add(c);
  const text = String(n?.identity?.text ?? n?.identity?.name ?? '').split('\n')[0].trim();
  if (text && text.length <= 60 && tokens.size) tokens.add(text);
  return { tag, tokens: [...tokens] };
}

export function textContainsNode(text, n) {
  const { tag, tokens } = nodeTokens(n);
  if (!tag && !tokens.length) return true; // nothing to judge by
  if (tokens.length) return tokens.some((t) => new RegExp(`(^|[^\\w-])${esc(t)}($|[^\\w-])`, 'i').test(text));
  return new RegExp(`<${esc(tag)}([\\s/>]|$)`, 'i').test(text);
}
