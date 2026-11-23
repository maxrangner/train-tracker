// The sheet on a phone (Max's phone test of 0.2.0, 2026-11-17; the one sheet since 2026-11-22, src/stack.js), in the
// test browser at phone size with the touch screen as the finger (a mouse drag of the sheet was cancelled by the
// browser once in four tries on 2026-11-23, pointercancel: not what a finger does):
//   1 the empty search with the keyboard up (the viewport shortened): the field stays above the keyboard and the hint
//     shows whole; the results scroll;
//   2 the sheet dragged: up and back below its start, held still, comes back to the height it started at (the nearest
//     height); pulled up and held: full; a pull down held: half; a short quick swipe down from full: half (a swipe goes
//     on to the next height); a long pull down below its lowest height closes every page (back to Home);
//   3 every height change glides (heights in between, sampled each frame): All stops, Fewer stops, the handle tap,
//     a short drag down from full.
// node tools/sheet-check.mjs (with npm run dev; PAGE= for another port). Not the phone: the feel and the real keyboard.
import { mkdirSync } from 'node:fs';
import { launch, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';
import { waitForMap, until, openSearch, toRest, openTrainByNumber, setLevel, sheetState } from './lib/screen.mjs';
mkdirSync('shots/test-0117', { recursive: true });   // (pictures aren't in git: a fresh working folder has no such folder)

const KEYBOARD_PX = 430;   // the phone keyboard's height in CSS pixels (Max's screenshot, 2026-11-17: 1120 of 2340 device pixels, 2.625 each)
const browser = await launch();
const fails = [], notes = [];
try {
  const page = await waitForMap(browser, { replay: CARD_HOUR, lang: 'sv', view: '11/59.33/18.06' });

  // ---- 1. The empty search with the keyboard up ----
  await page.evaluate(() => { try { localStorage.removeItem('favourites'); } catch { /* none */ } });
  await openSearch(page);
  // the keyboard's height, and 90 px more (Max's screenshot)
  for (const extra of [0, 90]) {
    await page.setViewport({ ...PHONE, height: PHONE.height - KEYBOARD_PX - extra });
    await sleep(600);
    const s1 = await page.evaluate(() => {
      const res = document.getElementById('search-results'), field = document.getElementById('search').getBoundingClientRect();
      const hint = res.querySelector('p.empty, .lab'), r = hint?.getBoundingClientRect();
      return { field: [Math.round(field.top), Math.round(field.bottom)], hint: hint?.textContent?.slice(0, 30) ?? null, hintIn: Boolean(r && r.top >= 0 && r.bottom <= innerHeight),
        scrolls: res.scrollHeight > res.clientHeight + 2, canScroll: /auto|scroll/.test(getComputedStyle(res).overflowY), h: innerHeight };
    });
    if (s1.field[0] < 0 || s1.field[1] > s1.h) fails.push(`1 search, ${s1.h} px left: the field at ${s1.field.join('-')} is not above the keyboard`);
    if (!s1.hintIn) fails.push(`1 search, ${s1.h} px left: the hint "${s1.hint}" is not shown whole`);
    if (s1.scrolls && !s1.canScroll) fails.push(`1 search, ${s1.h} px left: the results don't fit and don't scroll`);
    notes.push(`1 search, keyboard up, ${s1.h} px left: the field at ${s1.field.join('-')}, hint "${s1.hint}…", the results scroll: ${s1.scrolls}`);
    await page.screenshot({ path: `shots/test-0117/search-keyboard-${s1.h}.jpg`, quality: 85 });
  }
  await page.setViewport(PHONE);
  await sleep(400);
  await toRest(page);

  // ---- a train's page (through the search), one whose card has its stops (All stops); up to 8 tries ----
  async function openCard() {
    const numbers = await page.evaluate(() => [...new Set(window.__map.queryRenderedFeatures({ layers: ['train-dots'] })
      .map(f => String(window.__trains.get(f.properties.id)?.number ?? '')).filter(Boolean))].slice(0, 8));
    for (const number of numbers) {
      const key = await openTrainByNumber(page, number);
      if (key && await page.evaluate(() => Boolean(document.querySelector('#panel .panel-more')))) { await settle(); return key; }
    }
    return null;
  }
  // the sheet's shown height (a phone: it is slid down, its bottom at the screen's)
  const sheet = () => page.evaluate(() => { const r = document.getElementById('sheet').getBoundingClientRect();
    return { h: Math.round(innerHeight - r.top), top: Math.round(r.top), level: window.__stack.level, key: window.__stack.top(), keys: window.__stack.keys().length,
      full: document.getElementById('panel').classList.contains('full') }; });
  // the height each frame for ms (during a glide)
  const sample = ms => page.evaluate(ms => new Promise((done) => { const out = [], t0 = performance.now();
    const step = () => { out.push(Math.round(innerHeight - document.getElementById('sheet').getBoundingClientRect().top));
      if (performance.now() - t0 < ms) requestAnimationFrame(step); else done(out); }; requestAnimationFrame(step); }), ms);
  const between = (hs, a, b) => hs.filter(h => h > Math.min(a, b) + 3 && h < Math.max(a, b) - 3).length;
  // From the sheet's handle, through dy points, then let go: held still first (hold ms), or a quick swipe (fast). A
  // quick swipe is played inside the page, a finger's move each 16 ms: the test browser's own touches came 60-90 ms
  // apart on a loaded PC (2026-11-23), too slow to be a swipe.
  async function drag(points, { hold = 0, fast = false } = {}) {
    if (fast) {
      await page.evaluate(pts => new Promise((done) => {
        const s = document.getElementById('sheet'), r = s.getBoundingClientRect(), x = r.left + r.width / 2, y0 = r.top + 10, id = 7000 + Math.floor(Math.random() * 1000);
        const ev = (type, y) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0 });
        s.querySelector('.sh-grab').dispatchEvent(ev('pointerdown', y0));
        const ys = [];
        let last = 0;
        for (const dy of pts) { for (let k = 1; k <= 3; k++) ys.push(y0 + last + (dy - last) * k / 3); last = dy; }
        const step = () => { const y = ys.shift(); if (y === undefined) { document.dispatchEvent(ev('pointerup', y0 + last)); done(); return; } document.dispatchEvent(ev('pointermove', y)); setTimeout(step, 16); };
        setTimeout(step, 16);
      }), points);
      await sleep(600);
      return;
    }
    const c = await sheet();
    const x = PHONE.width / 2, y0 = c.top + 10, ts = page.touchscreen;
    await ts.touchStart(x, y0);
    let last = 0;
    for (const dy of points) {   // in steps of a finger's frames (16 ms)
      for (let k = 1; k <= 6; k++) { await ts.touchMove(x, y0 + last + (dy - last) * k / 6); await sleep(16); }
      last = dy;
    }
    if (hold) await sleep(hold);
    await ts.touchEnd();
    await sleep(600);
  }
  // until the sheet's height stops changing (a glide ends)
  const settle = async () => { let a = await sheet(); for (let i = 0; i < 20; i++) { await sleep(120); const b = await sheet(); if (b.h === a.h) return b; a = b; } return a; };

  const key = await openCard();
  if (!key) fails.push('setup: no train page with its stops opened');
  else {
    // ---- 2. Dragged ----
    const half = await sheet();
    if (half.level !== 1) fails.push(`2 setup: the train's page opened at height ${half.level}, not half`);
    await drag([-60, -150, -100, 0, 60], { hold: 200 });
    const s2 = await sheet();
    if (s2.key !== key || s2.level !== 1 || Math.abs(s2.h - half.h) > 4) fails.push(`2 up then 60 px below the start: ${s2.key} at height ${s2.level}, ${s2.h} px (it started at ${half.h})`);
    notes.push(`2 up then 60 px below the start: back at ${s2.h} px (started ${half.h})`);
    await drag([-80, -200, -260], { hold: 200 });
    const up = await sheet();
    if (up.level !== 2 || !up.full) fails.push(`2 a pull up of 260 px, held: height ${up.level}, the card full ${up.full}`);
    await drag([40, 120, 250], { hold: 200 });
    const down = await sheet();
    if (down.level !== 1 || down.full) fails.push(`2 a pull down of 250 px from full, held: height ${down.level}, the card full ${down.full}`);
    await setLevel(page, 2);
    await settle();
    await drag([80, 160], { fast: true });
    const swiped = await sheet();
    if (swiped.level !== 1) fails.push(`2 a quick swipe of 160 px down from full: height ${swiped.level}`);
    await drag([-60, -130], { fast: true });
    const swipedUp = await sheet();
    if (swipedUp.level !== 2) fails.push(`2 a quick swipe of 130 px up from half: height ${swipedUp.level}`);
    // a long pull down below the lowest height: every page closes
    await page.evaluate(() => window.__stack.open('page:settings'));   // (two pages over Home)
    await sleep(500);
    await setLevel(page, 0);
    await settle();
    const before = await sheetState(page);
    await drag([40, 80, 110], { hold: 200 });
    const gone = await sheet();
    if (gone.key !== 'home' || gone.keys !== 1 || gone.level !== 0) fails.push(`2 a long pull down from ${before.keys.join(' > ')}: ${gone.key} (${gone.keys} pages) at height ${gone.level} (want Home alone, at rest)`);
    else notes.push(`2 a long pull down: ${before.keys.join(' > ')} → Home at rest`);

    // ---- 3. Glides: All stops, Fewer stops, the handle tap, a short drag down from full ----
    if (!(await openCard())) fails.push('setup: no train page reopened');
    else {
      const glide = async (name, act, want) => {
        const a = await sheet();
        const [hs] = await Promise.all([sample(900), act()]);
        await sleep(200);
        const b = await sheet();
        const mid = between(hs, a.h, b.h);
        if (b.level !== want) fails.push(`3 ${name}: height ${b.level}, wanted ${want}`);
        if (mid < 3) fails.push(`3 ${name}: jumped ${a.h} → ${b.h} px (${mid} frames in between)`);
        notes.push(`3 ${name}: ${a.h} → ${b.h} px, ${mid} frames in between`);
      };
      const tapHandle = async () => { const c = await sheet(); await page.touchscreen.tap(PHONE.width / 2, c.top + 8); };
      await glide('All stops', () => page.evaluate(() => document.querySelector('#panel .panel-more')?.click()), 2);
      await glide('Fewer stops', () => page.evaluate(() => document.querySelector('#panel .panel-more')?.click()), 1);
      await glide('handle tap up', tapHandle, 2);
      await glide('a quick swipe down from full', () => drag([80, 160], { fast: true }), 1);
      await glide('handle tap up again', tapHandle, 2);
      await glide('handle tap: round to low', tapHandle, 0);
    }
  }
  if (page.errors.length) fails.push('page errors: ' + page.errors.slice(0, 3).join(' | '));
} finally { await browser.close(); }
for (const n of notes) console.log('  ' + n);
console.log(fails.length ? `sheet-check FAILED:\n  ${fails.join('\n  ')}` : 'sheet-check ok: the search fits with the keyboard up, the sheet comes back, pulls to its heights and home, every height change glides');
process.exit(fails.length ? 1 : 0);
