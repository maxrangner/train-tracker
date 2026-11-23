// Max's notes of 2026-11-20 in the test browser (phone size, a replay), on the one sheet (2026-11-22, src/stack.js):
//   - one page on top, in the stack's order: a train, a station from its stops over it; only the top page is in the
//     sheet, the back chip names the one under it, back steps down the stack to Home and nothing is left;
//   - a page over a train lets its card go; back to it, the card is there again and the train followed (until
//     2026-11-22 Settings → Debug → "Screen over a train" chose this: the stack decides now);
//   - ☰'s menu answers at once after a swipe of the sheet (a page swiped away, Home swiped down: ☰ 30 ms later opens);
//   - the search closed with the keyboard going: the map keeps its height the whole way;
//   - the Train card setting is gone and the default accent is Azurblå (cerulean);
//   - the map works with ☰'s menu open (a drag moves it, the menu stays), a plain tap on the map closes the menu and
//     does nothing else;
//   - Statistik's lateness map: "Laddar…" and no green before the lateness is known;
//   - zoomed out, Köpenhamn can stand above the sheet;
//   - the compass (since the scale slider, 2026-11-23): hidden while flat and north up; Trackside on the slider tilts
//     the view and shows it; a tap on it makes the view flat again;
//   - a train's page at full: a swipe up scrolls the page, a swipe down at its top lowers the sheet (the card
//     compact); one that starts on a button does too, and a tap on that button still works; a tap on the train already
//     open keeps its card as it is; a long swipe down from a button: the map's buttons end where the sheet is;
//   - a slow drag up of the compact card: the sheet follows the finger, the card turns full only at full height, and
//     back down it is compact again.
// node tools/screens-check.mjs (with npm run dev; PAGE= for another port). Not seen here: the phone's keyboard, the
// real smoothness of the moves.
import { launch, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';
import { waitForMap, until, toRest, setLevel, openSearch, typeSearch, openTrainByNumber, openMenu, openFromMenu, back, sheetState } from './lib/screen.mjs';

const browser = await launch();
const fails = [];
const ok = [];
const check = (cond, what) => (cond ? ok : fails).push(what);
try {
  const base = { replay: CARD_HOUR, lang: 'en', view: '12/59.33/18.06' };
  let page = await waitForMap(browser, base);
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* none */ } });
  await page.goto('about:blank');
  await page.close();
  page = await waitForMap(browser, base);
  const errors = page.errors;
  const click = sel => page.evaluate(s => document.querySelector(s).click(), sel);
  const centre = s => page.evaluate(q => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, s);
  const touchTap = async (s) => { const c = await centre(s); await page.touchscreen.tap(c.x, c.y); };
  const navShown = () => page.evaluate(() => !document.getElementById('nav').hidden);
  const shownH = () => page.evaluate(() => Math.round(innerHeight - document.getElementById('sheet').getBoundingClientRect().top));
  const settle = async () => { let a = await shownH(); for (let i = 0; i < 20; i++) { await sleep(120); const b = await shownH(); if (b === a) return b; a = b; } return a; };
  // A finger from (x, y) by dy in 10 moves of 16 ms.
  const swipe = async (x, y, dy, { n = 10, after = 800 } = {}) => {
    await page.touchscreen.touchStart(x, y);
    for (let i = 1; i <= n; i++) { await page.touchscreen.touchMove(x, y + i * dy / n); await sleep(16); }
    await page.touchscreen.touchEnd();
    await sleep(after);
  };
  // A train in view whose card has its stops (All stops), opened through the search; up to 8 tries.
  const openTrain = async () => {
    const numbers = await page.evaluate(() => [...new Set(window.__map.queryRenderedFeatures({ layers: ['train-dots'] })
      .map(f => String(window.__trains.get(f.properties.id)?.number ?? '')).filter(n => /^\d+$/.test(n)))].slice(0, 8));
    for (const n of numbers) {
      const key = await openTrainByNumber(page, n);
      if (key && await page.evaluate(() => Boolean(document.querySelector('#panel .panel-more')) && document.querySelectorAll('#panel .tl-row[data-sig]').length > 1)) { await settle(); return { key, number: n }; }
    }
    return null;
  };

  // ---- one page on top, the stack's order; a page over a train lets its card go, back brings it ----
  const tr = await openTrain();
  if (!tr) fails.push('no train with its stops could be opened');
  else {
    await click('#panel .panel-more');   // All stops: the sheet at full, the stops shown
    await sleep(800);
    const sig = await page.evaluate(() => { const r = [...document.querySelectorAll('#panel .tl-row[data-sig]')].at(-1); r.click(); return r.dataset.sig; });
    await until(page, s => window.__stack.top() === `station:${s}`, 3000, sig);
    await sleep(900);
    const over = await page.evaluate(() => ({ ...{ keys: window.__stack.keys() }, pages: [...document.querySelectorAll('#sheet .sh-pages > .pg:not(.res)')].filter(p => p.isConnected).map(p => p.dataset.key),
      chip: document.querySelector('#sheet .sh-back span')?.textContent, card: document.getElementById('panel').closest('.pg')?.dataset.key ?? null,
      cardShown: !document.getElementById('panel').hidden && Boolean(document.getElementById('panel').closest('.pg')) }));
    check(over.keys.join(' > ') === `home > ${tr.key} > station:${sig}` && over.pages.length === 1 && over.pages[0] === `station:${sig}` && over.chip === tr.number,
      `a station from ${tr.number}'s stops: ${over.keys.join(' > ')}, in the sheet only ${over.pages.join(', ')}, the back chip "${over.chip}"`);
    check(!over.cardShown, `the station over the train: its card let go (shown in ${over.card ?? 'no page'})`);
    const k1 = await back(page);
    await sleep(800);
    const backAt = await page.evaluate(() => ({ title: document.querySelector('#panel .panel-title strong')?.textContent ?? '', in: document.getElementById('panel').closest('.pg')?.dataset.key ?? null,
      follow: document.querySelector('#sheet .sh-follow')?.getAttribute('aria-pressed'), chip: document.querySelector('#sheet .sh-back span')?.textContent }));
    check(k1 === tr.key && backAt.in === tr.key && backAt.title.startsWith(tr.number) && backAt.follow === 'true' && backAt.chip === 'Home',
      `back: ${k1}, its card "${backAt.title}" in ${backAt.in}, Follow ${backAt.follow}, the back chip "${backAt.chip}"`);
    const k2 = await back(page);
    const left = await page.evaluate(() => ({ keys: window.__stack.keys(), pages: document.querySelectorAll('#sheet .sh-pages > .pg:not(.res)').length }));
    check(k2 === 'home' && left.keys.length === 1, `back again: ${k2}, ${left.keys.length} page(s) left`);
  }
  await toRest(page);

  // ---- ☰ answers at once after a swipe of the sheet (Max, 2026-11-20: Settings' dimming let taps through as it slid
  // away, and a tap within ~0.4 s of a swipe got no click: src/sheet.js onTap acts on the finger lifted) ----
  for (const [name, open] of [['Settings swiped away', () => openFromMenu(page, 'settings')], ['Home swiped down', () => setLevel(page, 2)]]) {
    await open();
    await settle();
    const grab = await page.evaluate(() => { const r = document.querySelector('#sheet .sh-grab').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await swipe(grab.x, grab.y, Math.min(400, 830 - grab.y), { after: 30 });
    await touchTap('#nav-button');
    await sleep(300);
    const s = await sheetState(page);
    check(await navShown(), `${name} (now ${s.key} at ${s.level}), ☰ tapped 30 ms later: the menu opens`);
    await page.evaluate(() => { document.getElementById('nav').hidden = true; });
    await toRest(page);
  }

  // ---- the search closed with a keyboard going (stood in for: the page 430 px shorter while typing, gone 150 ms after
  // Cancel): the map keeps its height the whole way (Max, 2026-11-20: a flicker; it went 851 → 421 → 851 px) ----
  await openSearch(page);
  await typeSearch(page, '1');
  await page.setViewport({ ...PHONE, height: PHONE.height - 430 });
  await sleep(600);
  await page.evaluate(() => { window.__mapHs = new Set(); const m = document.getElementById('map'), t0 = performance.now();
    const step = () => { window.__mapHs.add(m.clientHeight); if (performance.now() - t0 < 900) requestAnimationFrame(step); }; requestAnimationFrame(step); });
  await touchTap('#sheet .sh-cancel');
  await sleep(150);
  await page.setViewport(PHONE);
  await sleep(900);
  const hs = await page.evaluate(() => [...window.__mapHs]);
  check(hs.length === 1 && hs[0] === PHONE.height, `search → Cancel with the keyboard going: the map's height stays (${hs.join(', ')} px)`);
  check(!(await page.evaluate(() => window.__stack.searching)), 'Cancel closed the search');
  await toRest(page);

  // ---- defaults: no Train card row, Azurblå ----
  check(!(await page.evaluate(() => Boolean(document.querySelector('[data-key="trainCard"]')))), 'no Train card setting');
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase());
  check(['#0b7a9a', '#77d2f5'].includes(accent), `default accent Azurblå (got ${accent})`);

  // ---- the map with ☰'s menu open ----
  await openMenu(page);
  const c0 = await page.evaluate(() => window.__map.getCenter().toArray());
  await page.mouse.move(200, 400); await page.mouse.down(); await page.mouse.move(200, 300, { steps: 8 }); await page.mouse.up();
  await sleep(600);
  const c1 = await page.evaluate(() => window.__map.getCenter().toArray());
  check(Math.abs(c1[1] - c0[1]) > 1e-4 && (await navShown()), 'menu open: a drag moves the map, the menu stays');
  // a tap on an empty bit of the map (no train, station or sign there)
  const empty = await page.evaluate(() => { const m = window.__map;
    for (let y = 200; y < 600; y += 23) for (let x = 40; x < 300; x += 31) if (!m.queryRenderedFeatures([[x - 20, y - 20], [x + 20, y + 20]]).some(f => /train|station|disruption/.test(f.layer.id)) && !document.elementsFromPoint(x, y).some(e => e.closest('.near-label, .station-name, #nav'))) return { x, y };
    return { x: 120, y: 300 }; });
  await page.mouse.click(empty.x, empty.y); await sleep(500);
  check(!(await navShown()), 'menu open: a tap on the map closes it');
  const after = await sheetState(page);
  check(after.key === 'home' && after.level === 0, `menu open: that tap did nothing else (${after.key} at ${after.level})`);

  // ---- Statistik's map on Lateness before the lateness has come: grey and "Laddar…", not green ("on time") ----
  const heat = await page.evaluate(async () => {
    const { createSwedenMap } = await import('/src/stats-sweden.js');
    const m = createSwedenMap();
    document.body.append(m.el);
    m.el.style.cssText = 'position:fixed;left:0;top:0;z-index:99';
    const dots = late => Array.from({ length: 40 }, (_, i) => ({ id: String(i), lon: 15 + (i % 8) * 0.3, lat: 58 + Math.floor(i / 8) * 0.3, late }));
    const read = () => { const d = m.el.querySelector('canvas').getContext('2d').getImageData(0, 0, 400, 600).data; let green = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100 && d[i + 1] > d[i] + 40 && d[i + 1] > d[i + 2] + 20) green++;
      return { wait: !m.el.querySelector('.st-se-wait').hidden, green }; };
    m.setMode('lateness');
    m.update({ dots: dots(undefined) });
    await new Promise(r => setTimeout(r, 100));
    const before = read();
    m.update({ dots: dots('ontime') });
    await new Promise(r => setTimeout(r, 100));
    const later = read();
    m.setMode('trains');
    m.el.remove();
    return { before, later };
  });
  check(heat.before.wait && heat.before.green === 0, `Statistik's lateness map, no lateness known: "Laddar…" and no green (${JSON.stringify(heat.before)})`);
  check(!heat.later.wait && heat.later.green > 0, `…and once it is known: the colours, no "Laddar…" (${JSON.stringify(heat.later)})`);

  // ---- the far south above the sheet: zoomed out, the map may go far enough south that Köpenhamn (55.7°) stands
  // above a page at half (until 2026-11-20 it stopped at 52°, with Hyllie and Köpenhamn at the card's edge) ----
  const south = await page.evaluate(async () => {
    window.__map.jumpTo({ zoom: 5, center: [13.5, 53.5] });
    await new Promise(r => setTimeout(r, 300));
    const p = window.__map.project([12.57, 55.68]);
    return { lat: window.__map.getCenter().lat, y: p.y, h: window.innerHeight, half: window.__stack.heights[1] };
  });
  check(south.y < south.h - south.half - 20, `zoomed out, Köpenhamn can stand above a page at half (centre ${south.lat.toFixed(1)}°, at ${Math.round(south.y)} of ${south.h} px, the sheet ${south.half} px)`);
  await page.evaluate(() => window.__map.jumpTo({ zoom: 12, center: [18.06, 59.33], pitch: 0, bearing: 0 }));
  await sleep(800);

  const compass = () => page.evaluate(() => { const b = document.querySelector('.maplibregl-ctrl-compass'), r = b?.getBoundingClientRect();
    return Boolean(b && r.width > 0 && getComputedStyle(b).display !== 'none' && getComputedStyle(b).visibility !== 'hidden' && Number(getComputedStyle(b.closest('.maplibregl-ctrl')).opacity) > 0.5); });
  const sliderShown = () => page.evaluate(() => { const s = document.querySelector('.scale'); return Boolean(s && !s.hidden && s.getBoundingClientRect().width > 0); });
  // ---- the Zoom slider off (the default since Max's phone notes, 2026-11-23): no slider; the compass says 3D while
  // flat, a tap tilts; tilted it is the compass, a tap flattens ----
  check(!(await sliderShown()), 'Zoom slider off (the default): no slider on the map');
  const label3d = await page.evaluate(() => { const s = document.querySelector('.maplibregl-ctrl-compass .ctrl-3d'); return s && getComputedStyle(s).display !== 'none' ? s.textContent : ''; });
  check((await compass()) && label3d === '3D', `slider off, flat: the compass button says 3D ("${label3d}")`);
  await click('.maplibregl-ctrl-compass'); await sleep(1500);
  const q1 = await page.evaluate(() => window.__map.getPitch());
  check(q1 > 40, `slider off: 3D tilts the view (${q1.toFixed(0)}°)`);
  await click('.maplibregl-ctrl-compass'); await sleep(1500);
  const q2 = await page.evaluate(() => window.__map.getPitch());
  check(q2 < 1, `slider off: the compass makes it flat again (${q2.toFixed(0)}°)`);
  // ---- Settings → Zoom slider on: the slider shows; the compass hidden while flat, shown when tilted (Trackside), a
  // tap flattens ----
  await page.evaluate(() => document.querySelector('.seg[data-key="scaleSlider"] [data-v="true"]').click());
  await sleep(600);
  check(await sliderShown(), 'Settings → Zoom slider on: the slider shows');
  check(!(await compass()), 'slider on, flat and north up: no compass');
  await page.evaluate(() => document.querySelector('.scale-name[data-stop="trackside"]').click());
  await sleep(2500);
  const p1 = await page.evaluate(() => window.__map.getPitch());
  check(p1 > 40 && (await compass()), `Trackside tilts the view (${p1.toFixed(0)}°) and the compass shows`);
  await click('.maplibregl-ctrl-compass'); await sleep(1500);
  const p2 = await page.evaluate(() => window.__map.getPitch());
  check(p2 < 1, `the compass makes it flat again (${p2.toFixed(0)}°)`);
  await page.evaluate(() => document.querySelector('.seg[data-key="scaleSlider"] [data-v="false"]').click());
  await sleep(400);
  check(!(await sliderShown()), 'Zoom slider off again: the slider goes');
  await page.evaluate(() => window.__map.jumpTo({ zoom: 12, center: [18.06, 59.33], pitch: 0, bearing: 0 }));
  await sleep(1500);

  // ---- a train's page at full: swipes on the page and on a button ----
  const t2 = await openTrain();
  if (!t2) fails.push('swipe: no train with its stops could be opened');
  else {
    const pgSel = `#sheet .pg[data-key="${t2.key}"]`;
    const level = () => page.evaluate(() => window.__stack.level);
    const isFull = () => page.evaluate(() => document.getElementById('panel').classList.contains('full'));
    await click('#panel .panel-more');   // All stops: full
    await settle();
    const at = () => page.evaluate(s => { const p = document.querySelector(s), r = p.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 60, top: p.scrollTop }; }, pgSel);
    let a = await at();
    // up on the page: it scrolls, the sheet stays at full
    await swipe(a.x, a.y + 250, -180);
    const scrolled = await page.evaluate(s => document.querySelector(s).scrollTop, pgSel);
    check(scrolled > 20 && (await level()) === 2 && (await isFull()), `a swipe up on the train's page scrolls it (${Math.round(scrolled)} px), the sheet stays at full`);
    // (the swipe's own glide of the scroll ends first: on a loaded PC it ran on past a fixed 1.2 s, 2026-11-23)
    for (let i = 0, still = 0; i < 40 && still < 3; i++) {
      await sleep(150);
      still = await page.evaluate(s => { const p = document.querySelector(s); const was = p.scrollTop; p.scrollTop = 0; return was === 0; }, pgSel) ? still + 1 : 0;
    }
    // (pulls of 250 px: the test browser's touches come too slowly for a swipe's speed to count, 2026-11-23, so the
    // sheet goes to the nearest height; a quick swipe's throw is in tools/sheet-check.mjs)
    a = await at();
    await swipe(a.x, a.y, 250);
    await settle();
    check((await level()) === 1 && !(await isFull()), `a swipe down on the page at its top lowers the sheet to half, the card compact (height ${await level()})`);
    // on a button: a swipe down lowers it, a tap is still the button's
    await setLevel(page, 2);
    await settle();
    const more = await centre('#panel .panel-more');
    await swipe(more.x, Math.min(more.y, 560), 250);
    await settle();
    check((await level()) === 1, `a swipe down that starts on a button lowers the sheet (height ${await level()})`);
    await touchTap('#panel .panel-more');
    await settle();
    check((await level()) === 2 && (await isFull()), 'a tap on that button still works (All stops)');
    await click('#panel .panel-more');   // compact again
    await settle();
    // Max, 2026-11-21: a tap on the train already open "reloads the card and flickers it once": the card stays as it is
    const dot = await page.evaluate(() => {
      const f = [...window.__map.queryRenderedFeatures({ layers: ['train-dots'] })].find(x => `train:${x.properties.id}` === window.__stack.top());
      if (!f) return null;
      const p = window.__map.project(f.geometry.coordinates);
      return { x: p.x, y: p.y };
    });
    if (!dot) fails.push('tap on the open train: its dot not found on the map');
    else {
      await page.evaluate(() => { window.__emptied = false; const el = document.getElementById('panel');
        new MutationObserver(() => { if (el.querySelector('.state')) window.__emptied = true; }).observe(el, { childList: true, subtree: true }); });
      await page.touchscreen.tap(dot.x, dot.y);
      await sleep(1500);
      const r = await page.evaluate(k => ({ emptied: window.__emptied, open: window.__stack.top() === k }), t2.key);
      check(r.open && !r.emptied, `a tap on the train already open keeps its card as it is (open ${r.open}, emptied ${r.emptied})`);
    }
    // Max, 2026-11-21: swiped away from a button, the card stayed open below the screen with the map's buttons up where
    // it was: a long swipe down from "All stops" on the compact card: the map's buttons end where the sheet ends up
    if (await page.evaluate(k => window.__stack.top() === k, t2.key)) {
      await setLevel(page, 1);
      await settle();
      const m3 = await centre('#panel .panel-more');
      await swipe(m3.x, m3.y, Math.min(400, 835 - m3.y), { after: 300 });
      await settle();
      const gone = await page.evaluate(() => { const s = getComputedStyle(document.documentElement);
        return { key: window.__stack.top(), level: window.__stack.level, h: s.getPropertyValue('--sheet-h').trim(), shown: s.getPropertyValue('--sheet-shown').trim(),
          real: `${Math.round(innerHeight - document.getElementById('sheet').getBoundingClientRect().top)}px` }; });
      check(gone.h === gone.shown && gone.shown === gone.real, `a long swipe down from a button: ${gone.key} at height ${gone.level}, the map's buttons at ${gone.h} (the sheet ${gone.real})`);
    }
    // Max, 2026-11-21: a slow drag up on the compact card switched it at once ("should be animated and smooth"): the
    // sheet follows the finger, the card turns full only at full height; back down, compact again
    if (!(await page.evaluate(k => window.__stack.top() === k, t2.key))) await page.evaluate(k => window.__stack.open(k), t2.key);
    await setLevel(page, 1);
    const h0 = await settle();
    const g = await page.evaluate(() => { const r = document.querySelector('#sheet .sh-grab').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const look = async () => ({ h: await shownH(), full: await isFull() });
    await page.touchscreen.touchStart(g.x, g.y);
    for (let k = 1; k <= 6; k++) { await page.touchscreen.touchMove(g.x, g.y - k * 10); await sleep(30); }
    const s60 = await look();
    for (let k = 7; k <= 20; k++) { await page.touchscreen.touchMove(g.x, g.y - k * 10); await sleep(30); }
    const s200 = await look();
    for (let k = 19; k >= 3; k--) { await page.touchscreen.touchMove(g.x, g.y - k * 10); await sleep(30); }
    await sleep(300);
    await page.touchscreen.touchEnd();
    const end = { h: await settle(), full: await isFull(), level: await level() };
    check(Math.abs(s60.h - (h0 + 52)) < 14 && !s60.full, `a slow drag up, 60 px: the sheet follows (${h0} → ${s60.h} px), still compact`);
    check(Math.abs(s200.h - (h0 + 192)) < 14 && !s200.full, `200 px: the sheet follows (${s200.h} px), the card turns full only at rest`);
    check(end.level === 1 && !end.full && Math.abs(end.h - h0) < 4, `back down and let go: half again (${end.h} px), compact`);
  }
  check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
}
for (const o of ok) console.log(`ok   ${o}`);
for (const f of fails) console.log(`FAIL ${f}`);
console.log(fails.length ? `screens check: ${fails.length} failed` : 'screens check: all passed');
process.exit(fails.length ? 1 : 0);
