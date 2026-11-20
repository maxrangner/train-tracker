// The start screen's logo drawing on its own thread (Max's pick C, 2026-11-20; index.html, the script after the
// logo): on a phone-size page, with the start-up work a phone does replayed on the page's own thread (JOBS: measured on
// the built app with the processor slowed 4x; CDP's own slowdown can't be used, it slows the worker's thread too, which a
// phone's other core doesn't), the drawing must run on the canvas, draw
// about every frame (the worker counts its own frames and longest pause: window.__splashStats), start soon after the
// page, and end with the start screen still up. Under 80 ms: not busy, the worker's longest pause is 30-60 ms, at 0.9-1.1 s,
// when the map draws its first picture on the graphics chip (measured 2026-11-20; a frame or two); the old CSS drawing on
// the page's thread stopped for 250-370 ms. Also with "reduce motion": the plain CSS logo, no worker.
// node tools/splash-check.mjs (with npm run dev; PAGE= for another port, e.g. a built page on the phone server).
import { launch, sleep, PHONE, PAGE } from './lib/browser.mjs';

const JOBS = [[74, 64], [144, 267], [553, 267], [827, 69], [1071, 360], [1599, 228], [1828, 275]];   // (start ms, length ms)
const fails = [], oks = [];
const check = (ok, what) => (ok ? oks : fails).push(what);
const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE + '#lang=sv', { waitUntil: 'load' });   // once, to warm the cache
  await sleep(2500);
  for (const slow of [1, 4]) {
    await page.goto('about:blank');
    if (slow > 1) await page.evaluateOnNewDocument((jobs) => { for (const [at, len] of jobs) setTimeout(() => { const end = performance.now() + len; while (performance.now() < end) { /* busy */ } }, at); }, JOBS);
    await page.goto(PAGE + '#lang=sv', { waitUntil: 'domcontentloaded' });
    let s = null;
    for (let t0 = Date.now(); Date.now() - t0 < 8000 && !s; await sleep(200)) s = await page.evaluate(() => window.__splashStats ?? null).catch(() => null);
    const info = await page.evaluate(() => ({ canvas: Boolean(document.querySelector('#splash canvas')), origin: performance.timeOrigin,
      svgShown: getComputedStyle(document.querySelector('#splash svg')).display !== 'none' }));
    if (!s) { fails.push(`${slow > 1 ? "busy as a phone" : "not busy"}: the drawing never reported (canvas ${info.canvas})`); continue; }
    const startMs = Math.round(s.start - info.origin);
    check(info.canvas && !info.svgShown, `${slow > 1 ? "busy as a phone" : "not busy"}: drawn on the canvas, on its own thread (the CSS logo hidden)`);
    check(s.frames >= 60 && s.worst < 80, `${slow > 1 ? "busy as a phone" : "not busy"}: ${s.frames} frames in 1.3 s, longest pause ${s.worst} ms, ending at ${s.at} ms (want 60+ frames, under 80 ms)`);
    check(startMs < 1000, `${slow > 1 ? "busy as a phone" : "not busy"}: the drawing started ${startMs} ms after the page began (under 1000)`);
  }
  // reduce motion: no worker, the logo as it is
  await page.goto('about:blank');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(PAGE + '#lang=sv', { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const rm = await page.evaluate(() => ({ canvas: Boolean(document.querySelector('#splash canvas')), svg: getComputedStyle(document.querySelector('#splash svg')).display !== 'none' }));
  check(!rm.canvas && rm.svg, `reduce motion: the plain logo, no drawing thread (${JSON.stringify(rm)})`);
  check(!errors.length, `page errors: ${errors.length ? errors.slice(0, 3).join(' | ') : 'none'}`);
} finally {
  await browser.close();
}
for (const o of oks) console.log(`  ok   ${o}`);
for (const f of fails) console.log(`  FAIL ${f}`);
console.log(fails.length ? `splash-check: ${fails.length} failed` : 'splash-check ok: the logo draws on its own thread, smooth when the phone is busy');
process.exit(fails.length ? 1 : 0);
