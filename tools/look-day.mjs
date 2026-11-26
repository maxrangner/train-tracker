// A look at The day on the local live fetcher's files (not a check): the ribbon open, then an earlier moment.
// Run: PAGE=http://localhost:5181/ node tools/look-day.mjs <out folder> [fetcher address]
import { launch, sleep, PHONE, PAGE } from './lib/browser.mjs';
const out = process.argv[2] ?? '.', files = process.argv[3] ?? 'http://localhost:8097/';
const browser = await launch();
const page = await browser.newPage();
await page.setViewport(PHONE);
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`${PAGE}#files=${files}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__map?.loaded?.(), { timeout: 60000 });
await sleep(9000);
await page.screenshot({ path: `${out}/day-0-live.png` });
await page.evaluate(() => document.getElementById('nav-button')?.click() ?? document.querySelector('[data-act="nav"], .sh-nav, button[aria-label*="enu"]')?.click());
await sleep(800);
await page.evaluate(() => document.getElementById('open-day')?.click());
await sleep(6000);
await page.screenshot({ path: `${out}/day-1-open.png` });
const st = await page.evaluate(() => window.__day?.state?.() ?? null);
console.log('state:', JSON.stringify(st)?.slice(0, 400));
// Drag the handle back a third of the ribbon.
const box = await page.evaluate(() => { const r = document.querySelector('.day-track')?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height }; });
console.log('ribbon:', JSON.stringify(box));
if (box) { await page.mouse.click(box.x + box.w * 0.45, box.y + box.h / 2); await sleep(7000); }
await page.screenshot({ path: `${out}/day-2-earlier.png` });
console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
await browser.close();
