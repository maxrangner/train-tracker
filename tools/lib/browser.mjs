// The headless browser the tools use, in one place.
// The browser is Edge at its usual Windows place; set BROWSER_PATH to use another Chromium-based browser, e.g.
//   BROWSER_PATH="/usr/bin/chromium" node tools/shot.mjs
// The page must be running: `npm run dev` (http://localhost:5173/), or set PAGE to another address (every tool
// reads it, e.g. a second working folder's page: PAGE=http://localhost:5180/).
import puppeteer from 'puppeteer-core';

export const BROWSER_PATH = process.env.BROWSER_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
export const PAGE = (process.env.PAGE ?? 'http://localhost:5173/').replace(/\/?$/, '/');
// A phone's screen. An odd width on purpose, like real phones: the middle of the screen falls on a half pixel
// (400 wide hid a one-pixel flicker of the selected train's ring).
export const PHONE = { width: 393, height: 851, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
// The recording most pictures and checks use: the morning rush of 2026-11-12 (the status line says "replay 07:01").
export const RUSH_HOUR = '2026-11-12T06-00-00-005Z';
// The recording the screens check (tools/ui-check.mjs) replays: one with its trains' routes saved
// (data/routes-<name>.jsonl, tools/save-routes.mjs), so the train card has its stops (the rush hour's are gone).
// A weekday evening rush with SL's GPS on (Tue 17 Nov 16:00-18:00); the page starts at its first minute.
export const CARD_HOUR = '2026-11-17T15-00-00-001Z';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function launch(options = {}) {
  return puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...options,
  });
}

// The page's address with these settings after the #, e.g. address({ view: '12/59.33/18.06', train: 'toy', lang: 'sv' }).
// replay: true plays the rush-hour recording (or give a recording's name).
export function address({ replay, ...hash } = {}) {
  const parts = Object.entries({ ...(replay ? { replay: replay === true ? RUSH_HOUR : replay } : {}), ...hash })
    .map(([k, v]) => `${k}=${v}`);
  return PAGE + (parts.length ? `#${parts.join('&')}` : '');
}

// A new page of this size on the map, with its errors collected in page.errors. It returns once trains are on the
// map (or after `wait` ms, 30 s unless given).
export async function openMap(browser, { size = PHONE, wait = 30000, ...hash } = {}) {
  const page = await browser.newPage();
  await page.setViewport(size);
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/highway-shield|road_shield|Failed to load resource/.test(m.text())) page.errors.push(m.text().slice(0, 200));
  });
  await page.goto(address(hash), { waitUntil: 'domcontentloaded' });
  const t0 = Date.now();
  while (Date.now() - t0 < wait) {
    if (await page.evaluate(() => (window.__trains?.count ?? 0) > 0 && Boolean(window.__map?.loaded())).catch(() => false)) break;
    await sleep(300);
  }
  await sleep(1500);   // the first frames, labels and 3D trains
  return page;
}

// Tap the map's own way at a place on the screen (what a finger tap does, without waiting for the browser).
export const tapAt = (page, x, y) => page.mouse.click(x, y);

// A finger swipe from (x, y) by (dx, dy).
export async function swipe(page, x, y, dx, dy) {
  await page.touchscreen.touchStart(x, y);
  for (let i = 1; i <= 10; i++) { await page.touchscreen.touchMove(x + dx * i / 10, y + dy * i / 10); await sleep(16); }
  await page.touchscreen.touchEnd();
}
