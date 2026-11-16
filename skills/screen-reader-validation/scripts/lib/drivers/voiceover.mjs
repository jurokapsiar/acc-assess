// VoiceOver (macOS) through Guidepup (AppleScript control). Requires "Allow VoiceOver to be
// controlled with AppleScript" plus Accessibility and Automation permission for the terminal
// running Node; see references/drivers.md. This driver never changes those settings.
import { createGuidepupDriver, sleep } from './guidepup.mjs';

const APP_IDS = { chromium: 'com.google.chrome.for.testing', chrome: 'com.google.Chrome', 'chrome-beta': 'com.google.Chrome.beta', msedge: 'com.microsoft.edgemac' };

export function createVoiceOverDriver({ channel, guidepup } = {}) {
  const appId = APP_IDS[channel || 'chromium'] ?? APP_IDS.chromium;
  return createGuidepupDriver({
    name: 'voiceover',
    label: 'VoiceOver (macOS)',
    settleMs: 1500,
    platform: 'darwin',
    guidepup,
    pick: (g) => g.voiceOver,
    // Port of @guidepup/playwright's VoiceOver "navigateToWebContent": activate the browser,
    // open the item chooser (verified by its announcement), choose the web content area and
    // interact with it. Throws when the item chooser never opens.
    async align(ctx, page) {
      const prep = [];
      const activate = ctx.g.macOSActivateId ?? ctx.g.macOSActivate;
      if (typeof activate !== 'function') throw new Error('This Guidepup version has no macOSActivate helper; cannot bring the browser to the foreground for VoiceOver');
      await activate(appId);
      await page.bringToFront();
      await ctx.sr.press('Control', ctx.full);
      await ctx.sr.press('Escape', ctx.full);
      let ok = false;
      for (let i = 0; i < 10 && !ok; i++) {
        await ctx.perform('openItemChooser');
        const said = await ctx.last();
        prep.push(said);
        ok = /item chooser/i.test(said);
        if (!ok) await sleep(500);
      }
      if (!ok) {
        prep.push(...await ctx.drain());
        throw Object.assign(new Error(`Could not open the VoiceOver item chooser to reach the web content (heard: ${prep.filter(Boolean).slice(-2).join(' | ') || 'nothing'})`), { prep });
      }
      await ctx.sr.type('web content', ctx.full);
      await ctx.sr.press('Enter', ctx.full);
      await ctx.sr.interact({ capture: false });
      await sleep(500);
      prep.push(...await ctx.drain());
      return prep.filter(Boolean);
    },
    async top(ctx) {
      await ctx.perform('moveToAreaTop');
      return 'moveToAreaTop (VO-Shift-Home)';
    },
    nav: {
      headings: (ctx) => ({ label: 'nextHeading (findNextHeading)', run: () => ctx.sr.nextHeading(ctx.full) }),
      // nextLandmark() moves to the next "auto web spot"; there is no landmark-only command.
      landmarks: (ctx) => (typeof ctx.sr.nextLandmark === 'function' ? { label: 'nextLandmark (web spots)', run: () => ctx.sr.nextLandmark(ctx.full) } : null),
      reading: (ctx) => ({ label: 'next (VO-Right)', run: () => ctx.sr.next(ctx.full) }),
    },
  });
}
