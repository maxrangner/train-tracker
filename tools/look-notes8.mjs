// Pictures for Max's notes of 2026-11-25 (round 8): ☰'s menu, Home's filter card, the empty search, a page's scrollbar,
// on a computer (1400×900) and a phone. Not a check.
// node tools/look-notes8.mjs <out-folder> [PAGE=...]
import { mkdirSync } from 'node:fs';
import { launch, openMap, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';
import { until } from './lib/screen.mjs';

const out = (process.argv[2] ?? 'shots/notes8').replace(/\/$/, '');
mkdirSync(out, { recursive: true });
const PC = { width: 1400, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const browser = await launch();
try {
  for (const [tag, size] of [['pc', PC], ['phone', PHONE]]) {
    const page = await openMap(browser, { size, replay: CARD_HOUR, lang: 'sv' });
    await until(page, () => Boolean(window.__stack?.top()), 15000);
    await sleep(2500);
    const clip = async (name, sel = '#sheet', pad = 16) => {
      const r = await page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, sel);
      const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
      await page.screenshot({ path: `${out}/${tag}-${name}.jpg`, quality: 88, clip: { x, y, width: Math.min(size.width - x, r.w + 2 * pad), height: Math.min(size.height - y, r.h + 2 * pad + (name === 'menu' ? 200 : 0)) } });
    };
    // ☰ open
    await page.click('#nav-button');
    await sleep(700);
    await page.screenshot({ path: `${out}/${tag}-menu-full.jpg`, quality: 85 });
    await clip('menu');
    await page.click('#nav-button');
    await sleep(700);
    // Home at half: the filter card
    await page.evaluate(() => window.__stack.setLevel(1));
    await sleep(900);
    await clip('home-half');
    await page.evaluate(() => window.__stack.setLevel(2));
    await sleep(900);
    await clip('home-full');
    await page.evaluate(() => window.__stack.setLevel(0));
    await sleep(700);
    // the empty search
    await page.click('#search');
    await sleep(900);
    await clip('search-empty');
    await page.evaluate(() => window.__stack.back());
    await sleep(700);
    await page.close();
  }
} finally { await browser.close(); }
console.log(`pictures in ${out}`);
