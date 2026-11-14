import { createGuidepupDriver, sleep } from './guidepup.mjs';
import { activateWindowByTitle } from './win-foreground.mjs';
// NVDA (Windows) through Guidepup. Guidepup drives the portable NVDA it downloads to
// %LOCALAPPDATA%\guidepup\nvda (or GUIDEPUP_SCREEN_READERS_PATH) and reads the speech through
// its NVDA add-on. One session at a time: the reader is system-wide and needs an unlocked,
// interactive desktop and a headed browser window in the foreground.

const APP_NAMES = { chromium: 'Google Chrome For Testing', chrome: 'Google Chrome', 'chrome-beta': 'Google Chrome Beta', msedge: 'Microsoft Edge' };

export function createNvdaDriver({ channel, guidepup } = {}) {
  const appName = APP_NAMES[channel || 'chromium'] ?? APP_NAMES.chromium;
  return createGuidepupDriver({
    name: 'nvda',
    label: 'NVDA (Windows)',
    settleMs: 1200,
    platform: 'win32',
    guidepup,
    pick: (g) => g.nvda,
    // Verified foreground check (fails closed with `code: 'foreground-not-verified'`): the browser
    // window must report the page title (or, for an untitled page, the browser name). Keys are
    // never sent to "fix" the foreground (no Alt+Escape cycling) and the reader mode is not
    // toggled here: browse mode is established only where reader navigation needs it
    // (`ensureBrowseMode`), never blindly, because NVDA+Space toggles. Never resets app focus.
    async align(ctx, page) {
      const prep = [];
      await page.bringToFront().catch(() => {});
      const title = await page.title().catch(() => '');
      let ok = false;
      for (let i = 0; i < 5 && !ok; i++) {
        if (i < 3) activateWindowByTitle(title);
        await sleep(i ? 600 : 300);
        await ctx.perform('reportTitle');
        const said = await ctx.last();
        prep.push(said);
        ok = title ? said.includes(title) : said.includes(appName);
      }
      if (!ok) {
        prep.push(...await ctx.drain());
        throw Object.assign(new Error(`Could not verify that the browser ("${title || appName}") is the foreground window for NVDA (heard: ${prep.filter(Boolean).slice(-2).join(' | ') || 'nothing'}); not sending keys to another window. Bring the browser to the front and retry`), { prep, code: 'foreground-not-verified' });
      }
      prep.push(...await ctx.drain());
      return prep.filter(Boolean);
    },
    async top(ctx) {
      if (ctx.kc.moveToTop) { await ctx.sr.perform(ctx.kc.moveToTop, ctx.full); return 'moveToTop'; }
      await ctx.sr.press('Control+Home', ctx.full);
      return 'Control+Home';
    },
    nav: {
      headings: (ctx) => ({ label: 'nextHeading (H)', run: () => ctx.sr.nextHeading(ctx.full) }),
      landmarks: (ctx) => ({ label: 'nextLandmark (D)', run: () => ctx.sr.nextLandmark(ctx.full) }),
      reading: (ctx) => ({ label: 'next (Down Arrow)', run: () => ctx.sr.next(ctx.full) }),
    },
  });
}
