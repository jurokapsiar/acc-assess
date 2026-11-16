// Driver selection. Interface shared by every driver:
//   name, label, kind ('real' | 'mock'), settleMs
//   start()                 start the screen reader (real drivers; full speech capture)
//   attach(page)            per-page setup before navigation (mock installs its speech synth)
//   align(page)             bring the reader into the page's web content after a navigation;
//                           returns the preparation phrases, throws when it can't be verified
//   capture(fn, {settle})   run an external (Playwright) action inside the reader's capture
//                           window -> { pre, phrases, health: captured|unavailable|simulated }
//   keys(keys, {settle})    OS-level key presses through the reader -> same shape as capture
//   take()                  read-and-clear phrases recorded since the last read (never dropped)
//   probe(page, kind)       headings | landmarks | reading sweep -> { items, termination, commands }
//                           termination: end | cap | repeat | silent | unsupported | error
//   stop()                  throws on cleanup failure (the session records it)
import { createMockDriver } from './mock.mjs';
import { createNvdaDriver } from './nvda.mjs';
import { createVoiceOverDriver } from './voiceover.mjs';

export const READERS = ['nvda', 'voiceover', 'mock'];

export function defaultReader(platform = process.platform) {
  if (platform === 'win32') return 'nvda';
  if (platform === 'darwin') return 'voiceover';
  return 'mock';
}

export function createDriver(reader, opts = {}) {
  switch (reader) {
    case 'nvda': return createNvdaDriver(opts);
    case 'voiceover': return createVoiceOverDriver(opts);
    case 'mock': case 'dry-run': return createMockDriver(opts);
    default: throw new Error(`Unknown --reader "${reader}" (expected ${READERS.join(' | ')})`);
  }
}
