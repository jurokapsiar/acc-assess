import { execFileSync } from 'node:child_process';

// Informational commit + dirty flag for results.json. The skill's own output (`.a11y/`:
// inventory, reports) doesn't count as a change to the app's source.
export function gitInfo(cwd = process.cwd()) {
  try {
    const opts = { cwd, stdio: ['ignore', 'pipe', 'ignore'] };
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], opts).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', '.', ':(exclude).a11y'], opts).toString().trim().length > 0;
    return { commit, dirty };
  } catch {
    return null; // not a git repo (or git unavailable)
  }
}
