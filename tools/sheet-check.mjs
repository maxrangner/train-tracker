// The sheet on a phone (Max's phone test of 0.2.0, 2026-11-17; the one sheet since 2026-11-22, src/stack.js), in the
// test browser at phone size with the touch screen as the finger (a mouse drag of the sheet was cancelled by the
// browser once in four tries on 2026-11-23, pointercancel: not what a finger does):
//   1 the empty search with the keyboard up (the viewport shortened): the field stays above the keyboard and the hint
//     shows whole; the results scroll;
//   2 the sheet dragged: up and back below its start, held still, comes back to the height it started at (the nearest
//     height); pulled up and held: full; a pull down held: half; a short quick swipe down from full: half (a swipe goes
//     on to the next height); a long pull down below its lowest height closes every page (back to Home);
//   3 every height change glides (heights in between, sampled each frame): All stops, Fewer stops, the handle tap
//     (low ↔ half, from full to low), a short drag down from full;
//   4 the head (2026-11-23): the handle's target 44 px tall (the grip over the map and the handle), a finger's tap that
//     wanders 11 px still toggles, a tap on the head between its buttons toggles, a pull down of 110 px from the head
//     at full lowers it, Home's field pulled up raises the sheet (no search); a group's list ("2 trains here", and a
//     big one) opens at half showing all its rows, or as tall as half the screen.
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
      await glide('handle tap: half to low', tapHandle, 0);
      await glide('handle tap: low to half', tapHandle, 1);
      await setLevel(page, 2);
      await settle();
      await glide('a quick swipe down from full', () => drag([80, 160], { fast: true }), 1);
      await setLevel(page, 2);
      await settle();
      await glide('handle tap: full to low', tapHandle, 0);
    }

    // ---- 4. The head (Max's phone, 2026-11-23: the handle "seems to hit it but doesn't respond", the sheet hard to
    // lower) and a group's list opening tall enough for its rows ----
    if (!(await openCard())) fails.push('setup: no train page for the head');
    else {
      await setLevel(page, 0);
      await settle();
      // the handle's target: the grip over the map and the handle, top to bottom, at the middle
      const hit = await page.evaluate(() => {
        const top = document.getElementById('sheet').getBoundingClientRect().top, x = innerWidth / 2;
        const ok = y => { const e = document.elementFromPoint(x, y); return Boolean(e && (e.id === 'sheet-grip' || e.closest('.sh-grab'))); };
        let a = top, b = top;
        while (ok(a - 1)) a--;
        while (ok(b + 1)) b++;
        return { tall: b - a + 1, from: Math.round(a - top), to: Math.round(b - top) };
      });
      if (hit.tall < 44) fails.push(`4 the handle's target is ${hit.tall} px tall (${hit.from} to ${hit.to} px from the sheet's top), want 44`);
      notes.push(`4 the handle's target: ${hit.tall} px tall (${hit.from} to ${hit.to} px from the sheet's top)`);
      // a finger's tap that wanders 11 px (no click comes then): on the grip above the sheet, low → half
      const wander = async (x, y) => { const ts = page.touchscreen; await ts.touchStart(x, y); await sleep(30); await ts.touchMove(x, y + 6); await sleep(30); await ts.touchMove(x + 3, y + 11); await sleep(40); await ts.touchEnd(); await sleep(600); };
      let c = await sheet();
      await wander(PHONE.width / 2, c.top - 14);
      c = await sheet();
      if (c.level !== 1) fails.push(`4 a wandering tap on the grip above the sheet at low: height ${c.level}, wanted 1`);
      // a tap on the head's empty part (between the back chip and the bar's buttons): half → low
      const gap = await page.evaluate(() => {
        const back = document.querySelector('#sheet .sh-back').getBoundingClientRect();
        const next = [...document.querySelectorAll('#sheet .sh-bar button')].filter(b => !b.hidden && b.getBoundingClientRect().left > back.right).map(b => b.getBoundingClientRect().left);
        return { x: (back.right + Math.min(innerWidth - 12, ...next)) / 2, y: back.top + back.height / 2 };
      });
      await page.touchscreen.tap(gap.x, gap.y);
      await sleep(600);
      c = await sheet();
      if (c.level !== 0) fails.push(`4 a tap on the head between its buttons at half: height ${c.level}, wanted 0`);
      // a pull down of 110 px from the head at full, held still: lowered (it came back up to full, the nearest height)
      await setLevel(page, 2);
      await settle();
      await drag([30, 70, 110], { hold: 200 });
      c = await sheet();
      if (c.level !== 1) fails.push(`4 a pull down of 110 px from the head at full: height ${c.level}, wanted 1`);
      else notes.push('4 a pull down of 110 px from the head at full: half');
      // Home's search field pulled up by a finger: the sheet rises, the search doesn't open
      await toRest(page);
      const f = await page.evaluate(() => { const r = document.getElementById('search').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.touchscreen.touchStart(f.x, f.y);
      for (let k = 1; k <= 12; k++) { await page.touchscreen.touchMove(f.x, f.y - k * 25); await sleep(16); }
      await sleep(200);
      await page.touchscreen.touchEnd();
      await sleep(600);
      const s4 = await sheetState(page), searching = await page.evaluate(() => window.__stack.searching);
      if (s4.level < 1 || searching) fails.push(`4 Home's field pulled up 300 px: height ${s4.level}, the search ${searching ? 'opened' : 'closed'}`);
      await toRest(page);
      // a group's list ("N trains here"): opens at half showing all its rows, or as tall as half when they don't fit
      await page.evaluate(() => window.__map.jumpTo({ center: [17.9, 59.3], zoom: 7 }));
      await sleep(2500);
      for (const want of [2, 6]) {
        const n = await page.evaluate(async (want) => {
          const m = window.__map, gs = m.queryRenderedFeatures({ layers: ['train-labels'] }).filter(g => g.properties.cluster_id !== undefined && (want === 2 ? g.properties.point_count === 2 : g.properties.point_count >= want));
          for (const g of gs) {
            const leaves = await m.getSource('train-groups').getClusterLeaves(g.properties.cluster_id, 200, 0);
            const ids = new Set(leaves.map(l => l.properties.id));
            const dot = m.queryRenderedFeatures({ layers: ['train-dots'] }).find(d => ids.has(d.properties.id));
            if (!dot) continue;
            const q = m.project(dot.geometry.coordinates);
            m.fire('click', { point: q, lngLat: m.unproject(q), originalEvent: new MouseEvent('click') });
            return leaves.length;
          }
          return 0;
        }, want);
        if (!n) { notes.push(`4 no group of ${want === 2 ? '2' : `${want}+`} trains on screen: its list not checked`); continue; }
        await until(page, () => String(window.__stack.top()).startsWith('pick:'), 3000);
        await sleep(700);
        const p = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('#picker [data-i]')].map(b => b.getBoundingClientRect().bottom);
          return { level: window.__stack.level, h: Math.round(innerHeight - document.getElementById('sheet').getBoundingClientRect().top), half: Math.round(innerHeight * 0.5),
            rows: rows.length, shown: rows.filter(y => y <= innerHeight).length };
        });
        const good = p.level === 1 && (p.shown === p.rows || p.h >= p.half - 10);
        if (!good) fails.push(`4 "${n} trains here": height ${p.level}, ${p.h} px, ${p.shown} of ${p.rows} rows shown`);
        notes.push(`4 "${n} trains here" opens at ${p.h} px: ${p.shown} of ${p.rows} rows shown`);
        await page.screenshot({ path: `shots/test-0117/picker-${n}.jpg`, quality: 85 });
        await toRest(page);
      }
    }
  }
  if (page.errors.length) fails.push('page errors: ' + page.errors.slice(0, 3).join(' | '));
} finally { await browser.close(); }
for (const n of notes) console.log('  ' + n);
console.log(fails.length ? `sheet-check FAILED:\n  ${fails.join('\n  ')}` : 'sheet-check ok: the search fits with the keyboard up, the sheet comes back, pulls to its heights and home, every height change glides');
process.exit(fails.length ? 1 : 0);
