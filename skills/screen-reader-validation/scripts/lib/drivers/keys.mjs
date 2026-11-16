// Maps Playwright-style key names (used in inventory `press` steps) to the strings Guidepup's
// `press()` accepts on each OS ("Control+Home", "Command+L", "Shift+Tab").
const ALIASES = { Esc: 'Escape', Return: 'Enter', Del: 'Delete', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Ctrl: 'Control', Option: 'Alt', Cmd: 'Meta' };

export function toReaderKey(key, platform = process.platform) {
  return String(key).split('+').map((p) => {
    let k = ALIASES[p] ?? p;
    if (k === 'ControlOrMeta') k = platform === 'darwin' ? 'Meta' : 'Control';
    if (platform === 'darwin' && k === 'Meta') k = 'Command';
    if (platform === 'darwin' && k === 'Alt') k = 'Option';
    return k;
  }).join('+');
}
