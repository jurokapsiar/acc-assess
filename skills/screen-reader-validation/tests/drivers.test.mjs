// Contract tests for the Guidepup-backed drivers against a fake Guidepup that models the real
// library's semantics: speech is only recorded while a command runs through Guidepup's queue
// (capture/press/perform/next...), VoiceOver's keyboardCommands throws before start(), and the
// spoken phrase log keeps entries until it is cleared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNvdaDriver } from '../scripts/lib/drivers/nvda.mjs';
import { createVoiceOverDriver } from '../scripts/lib/drivers/voiceover.mjs';
import { createMockDriver } from '../scripts/lib/drivers/mock.mjs';

const COMMANDS = ['exitFocusMode', 'reportTitle', 'readNextFocusableItem', 'toggleBetweenBrowseAndFocusMode', 'moveToTop', 'openItemChooser', 'moveToAreaTop'];

function fakeReader({ voiceOver = false, script = {}, nav = {}, withCapture = true, withLandmarks = true } = {}) {
  const r = {
    started: false, recording: false, log: [], calls: [], dropped: [],
    // Speech produced by the screen reader: only kept while a Guidepup command is running.
    say(...phrases) { for (const p of phrases) (r.recording ? r.log : r.dropped).push(p); },
    async run(name, arg, opts, fn) {
      r.calls.push({ name, arg, opts });
      if (!r.started && name !== 'start') throw new Error(`${name} before start`);
      r.recording = !!opts?.capture;
      try { await fn?.(); } finally { r.recording = false; }
    },
    get keyboardCommands() {
      if (voiceOver && !r.started) throw new Error('VoiceOver keyboardCommands accessed before start');
      return Object.fromEntries(COMMANDS.map((c) => [c, c]));
    },
    async start(opts) { await r.run('start', null, opts); r.started = true; },
    async stop() { r.calls.push({ name: 'stop' }); r.started = false; },
    async press(key, opts) { await r.run('press', key, opts, () => r.say(...(script[key] ?? []))); },
    async type(text, opts) { await r.run('type', text, opts); },
    async interact(opts) { await r.run('interact', null, opts); },
    async perform(cmd, opts) { await r.run('perform', cmd, opts, () => r.say(...(script[cmd] ?? []))); },
    async spokenPhraseLog() { return [...r.log]; },
    async clearSpokenPhraseLog() { r.log.length = 0; },
    async lastSpokenPhrase() { return r.log.at(-1) ?? ''; },
  };
  if (withCapture) r.capture = (fn, opts) => r.run('capture', null, opts, fn);
  const navCmd = (name) => async (opts) => r.run(name, null, opts, () => {
    const queue = nav[name];
    if (queue instanceof Error) throw queue;
    const next = Array.isArray(queue) ? queue.shift() : queue;
    if (next !== undefined && next !== null) r.say(next);
  });
  r.nextHeading = navCmd('nextHeading');
  r.next = navCmd('next');
  if (withLandmarks) r.nextLandmark = navCmd('nextLandmark');
  return r;
}

const fakePage = (title = 'Fixture shop') => ({ title: async () => title, bringToFront: async () => {}, isClosed: () => false });

async function nvdaWith(opts) {
  const sr = fakeReader(opts);
  const driver = createNvdaDriver({ guidepup: { nvda: sr } });
  await driver.start();
  return { sr, driver };
}

test('Playwright actions run inside Guidepup capture, so their speech is recorded', async () => {
  const { sr, driver } = await nvdaWith();
  const res = await driver.capture(async () => sr.say('Saved', 'Close button'), { settle: 0 });
  assert.deepEqual(res.phrases, ['Saved', 'Close button']);
  assert.equal(res.health, 'captured');
  assert.deepEqual(sr.dropped, []);
  assert.deepEqual(sr.calls.at(-1).opts, { capture: true });
});

test('without Guidepup capture() the step is flagged as unreliable, not silently "nothing spoken"', async () => {
  const sr = fakeReader({ withCapture: false });
  const driver = createNvdaDriver({ guidepup: { nvda: sr } });
  await driver.start();
  const res = await driver.capture(async () => sr.say('Saved'), { settle: 0 });
  assert.equal(res.health, 'unavailable');
  assert.deepEqual(res.phrases, []);
});

test('phrases already in the log are returned as "pre", never cleared unread', async () => {
  const { sr, driver } = await nvdaWith({ script: { Tab: ['Search edit'] } });
  sr.log.push('late phrase of the previous step');
  const res = await driver.capture(async () => sr.say('Menu button'), { settle: 0 });
  assert.deepEqual(res.pre, ['late phrase of the previous step']);
  assert.deepEqual(res.phrases, ['Menu button']);
  sr.log.push('trailing');
  assert.deepEqual(await driver.take(), ['trailing']);
  assert.deepEqual(await driver.take(), []);
});

test('a failing action keeps the speech it caused and returns the error', async () => {
  const { sr, driver } = await nvdaWith();
  const res = await driver.capture(async () => { sr.say('Submit button'); throw new Error('click timed out'); }, { settle: 0 });
  assert.deepEqual(res.phrases, ['Submit button']);
  assert.match(res.error.message, /timed out/);
});

test('key presses go through the reader with full capture and OS key names', async () => {
  const sr = fakeReader({ voiceOver: true, script: { Tab: ['Search, edit text'], 'Command+L': ['Address'] } });
  const driver = createVoiceOverDriver({ guidepup: { voiceOver: sr } });
  await driver.start();
  const res = await driver.keys(['Tab', 'ControlOrMeta+L'], { settle: 0 });
  assert.deepEqual(res.phrases, ['Search, edit text', 'Address']);
  assert.deepEqual(sr.calls.filter((c) => c.name === 'press').map((c) => [c.arg, c.opts]), [['Tab', { capture: true }], ['Command+L', { capture: true }]]);
});

test('VoiceOver is started before its keyboard commands are read, with full capture', async () => {
  const sr = fakeReader({ voiceOver: true });
  const driver = createVoiceOverDriver({ guidepup: { voiceOver: sr } });
  await driver.start();
  assert.deepEqual(sr.calls[0], { name: 'start', arg: null, opts: { capture: true } });
  const res = await driver.probe(fakePage(), 'headings', { cap: 1 }).catch((e) => e);
  assert.ok(!(res instanceof Error), 'moveToAreaTop resolved from keyboardCommands');
  await driver.stop();
  assert.equal(sr.calls.at(-1).name, 'stop');
});

test('NVDA alignment is verified by the window title and fails loudly otherwise', async () => {
  const ok = await nvdaWith({ script: { reportTitle: ['Fixture shop - Google Chrome For Testing'] } });
  const prep = await ok.driver.align(fakePage());
  assert.ok(prep.some((p) => p.includes('Fixture shop')));
  const bad = await nvdaWith({ script: { reportTitle: ['Terminal'] } });
  const t0 = Date.now();
  const err = await bad.driver.align(fakePage()).catch((e) => e);
  assert.ok(err instanceof Error && /foreground/.test(err.message), String(err));
  assert.ok(err.prep.includes('Terminal'), 'alignment phrases are kept as evidence');
  assert.ok(Date.now() - t0 < 15000);
});

test('alignment never sends keys or toggles the mode; browse mode is confirmed by announcement', async () => {
  const bad = await nvdaWith({ script: { reportTitle: ['Terminal'] } });
  const err = await bad.driver.align(fakePage()).catch((e) => e);
  assert.equal(err.code, 'foreground-not-verified');
  assert.ok(!bad.sr.calls.some((c) => c.arg === 'Alt+Escape' || c.arg === 'toggleBetweenBrowseAndFocusMode' || c.arg === 'exitFocusMode'));
  // Mode unknown (no announcement, no DOM evaluate): never blind-toggles.
  const unk = await nvdaWith({});
  const r = await unk.driver.ensureBrowseMode(fakePage());
  assert.equal(r.mode, 'unknown');
  assert.ok(!unk.sr.calls.some((c) => c.arg === 'toggleBetweenBrowseAndFocusMode'));
  // Focus mode announced -> exactly one toggle, accepted only when "browse mode" is then spoken.
  const fm = await nvdaWith({ script: { toggleBetweenBrowseAndFocusMode: ['Browse mode'] } });
  fm.driver.keys && await fm.driver.keys([], {}).catch(() => {});
  fm.sr.log.push('Focus mode');
  const got = await fm.driver.ensureBrowseMode(fakePage());
  assert.equal(got.mode, 'browse');
  assert.equal(fm.sr.calls.filter((c) => c.arg === 'toggleBetweenBrowseAndFocusMode').length, 1);
});

test('probe sweeps report how they ended', async () => {
  const sweep = async (nav, kind, opts = {}) => {
    const { driver } = await nvdaWith({ nav, ...opts });
    return driver.probe(fakePage(), kind, { cap: 3 });
  };
  const end = await sweep({ nextHeading: ['Shop heading level 1', 'no next heading'] }, 'headings');
  assert.equal(end.termination, 'end');
  assert.deepEqual(end.items.map((x) => x.text), ['Shop heading level 1']);
  assert.deepEqual(end.commands, ['moveToTop', 'nextHeading (H)']);
  assert.equal((await sweep({ nextHeading: 'Same heading' }, 'headings')).termination, 'repeat');
  assert.equal((await sweep({ next: ['a', 'b', 'c', 'd'] }, 'reading')).termination, 'cap');
  assert.equal((await sweep({}, 'landmarks')).termination, 'silent');
  const failed = await sweep({ nextLandmark: new Error('NVDA crashed') }, 'landmarks');
  assert.equal(failed.termination, 'error');
  assert.match(failed.error, /crashed/);
  const vo = fakeReader({ voiceOver: true, withLandmarks: false });
  const voDriver = createVoiceOverDriver({ guidepup: { voiceOver: vo } });
  await voDriver.start();
  assert.equal((await voDriver.probe(fakePage(), 'landmarks', { cap: 3 })).termination, 'unsupported');
});

test('the mock driver keeps the same contract (pre, phrases, error, health)', async () => {
  const driver = createMockDriver();
  const said = [['before'], ['after']];
  const page = { isClosed: () => false, evaluate: async () => said.shift() ?? [], waitForTimeout: async () => {}, addInitScript: async () => {} };
  await driver.attach(page);
  const res = await driver.capture(async () => { throw new Error('boom'); }, { settle: 0 });
  assert.deepEqual(res.pre, ['before']);
  assert.deepEqual(res.phrases, ['after']);
  assert.equal(res.health, 'simulated');
  assert.match(res.error.message, /boom/);
});
