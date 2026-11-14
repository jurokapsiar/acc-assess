import { spawnSync } from 'node:child_process';
// Windows only: Playwright's bringToFront() does not win the foreground lock when another window
// (e.g. the terminal that started the run) is active, so NVDA keeps reading that window.
// Activates the visible top-level window whose title contains `title` (restores it if minimised).
// Only moves window focus; sends no keys to any application beyond a bare Alt tap that lifts
// the foreground lock. Returns true when that window is foreground afterwards.

const SCRIPT = `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class Fg {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  public static IntPtr Find(string t) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.Length > 0 && sb.ToString().Contains(t)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$h = [Fg]::Find($env:SR_FG_TITLE)
if ($h -eq [IntPtr]::Zero) { 'notfound'; exit 0 }
if ([Fg]::IsIconic($h)) { [void][Fg]::ShowWindow($h, 9) }
[Fg]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [Fg]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
[void][Fg]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 250
if ([Fg]::GetForegroundWindow() -eq $h) { 'ok' } else { 'denied' }
`;

export function activateWindowByTitle(title, { platform = process.platform } = {}) {
  if (platform !== 'win32' || !title) return false;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], {
    env: { ...process.env, SR_FG_TITLE: title }, encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  return (r.stdout || '').trim() === 'ok';
}
