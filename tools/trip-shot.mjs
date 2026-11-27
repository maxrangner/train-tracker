// Pictures of a saved trip's page (Stockholm C → Sundsvall C by default), phone and computer, dark and light, on the
// fetcher's files (a fetcher on this PC behind the page's /fetcher/). For before/after sheets (Max, 2026-11-27: "Make
// this 'Nästa tåg' more easy to read").
//   node tools/trip-shot.mjs <out prefix> [--trip Cst>Suc] [--files /fetcher/]   (PAGE=<the dev page>)
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { launch, sleep, PAGE } from './lib/browser.mjs';

const args = process.argv.slice(2), opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const OUT = args[0], TRIP = opt('--trip') ?? 'Cst>Suc', FILES = opt('--files') ?? '/fetcher/';
if (!OUT) { console.log('usage: node tools/trip-shot.mjs <out prefix> [--trip Cst>Suc]'); process.exit(1); }
mkdirSync(dirname(OUT), { recursive: true });
const [from, to] = [TRIP.split('>')[0], TRIP.split('>').at(-1)];
const browser = await launch();
try {
  for (const [size, w, h] of [['phone', 390, 844], ['pc', 1400, 900]]) for (const theme of ['dark', 'light']) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: size === 'phone' ? 2 : 1 });
    await page.evaluateOnNewDocument((fav) => { localStorage.setItem('favourites', fav); }, JSON.stringify({ stations: [], trains: [], trips: [{ key: TRIP, from, to, via: null }], changes: [] }));
    await page.goto(`${PAGE}#files=${FILES}&lang=sv&theme=${theme}&shop=false`, { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 60 && !(await page.evaluate(() => Boolean(window.__stack?.top()) && (window.__trains?.count ?? 0) > 0)); i++) await sleep(500);
    await sleep(1500);
    await page.evaluate(k => window.__stack.open(`trip:${k}`), TRIP);
    for (let i = 0; i < 40 && !(await page.evaluate(() => Boolean(document.querySelector('.trip-next')))); i++) await sleep(500);
    // (the sheet raised so the whole card shows; the mouse off the page's buttons)
    await page.evaluate(() => window.__stack.setLevel(window.__stack.heights.length - 1));
    await page.mouse.move(5, 5);
    await sleep(1200);
    await page.screenshot({ path: `${OUT}-${size}-${theme}.png` });
    console.log(`${OUT}-${size}-${theme}.png`, await page.evaluate(() => document.querySelector('.trip-next')?.innerText.replace(/\n/g, ' | ') ?? 'no next train'));
    await page.close();
  }
} finally { await browser.close(); }
