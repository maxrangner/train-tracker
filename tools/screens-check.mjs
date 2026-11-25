// Max's notes of 2026-11-20 in the test browser (phone size, a replay), on the one sheet (2026-11-22, src/stack.js):
//   - one page on top, in the stack's order: a train, a station from its stops over it; only the top page is in the
//     sheet, no Home chip (since 2026-11-23), back (Esc) steps down the stack to Home and nothing is left;
//   - a page over a train lets its card go; back to it, the card is there again and the train followed (until
//     2026-11-22 Settings → Debug → "Screen over a train" chose this: the stack decides now);
//   - ☰'s menu answers at once after a swipe of the sheet (Settings, opened from it, swiped away: the menu is back by
//     itself and ☰ 30 ms later shuts it; a chip's card swiped away: ☰ 30 ms later opens it);
//   - the start (Max's pick C, 2026-11-25): Home the search bar alone, no handle, a pull on it does nothing; the chips
//     above it open their cards (the chips in the card's head, the lit one marked; another chip replaces the card, the
//     lit one or Esc closes it); a chip's card at half cuts no row and says there is more; the same on a computer
//     (the chips under the search box, no arrow band under the bar alone);
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
import { waitForMap, until, toRest, setLevel, openSearch, typeSearch, openTrainByNumber, openMenu, openFromMenu, openChip, back, sheetState } from './lib/screen.mjs';

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
      card: document.getElementById('panel').closest('.pg')?.dataset.key ?? null,
      cardShown: !document.getElementById('panel').hidden && Boolean(document.getElementById('panel').closest('.pg')) }));
    check(over.keys.join(' > ') === `home > ${tr.key} > station:${sig}` && over.pages.length === 1 && over.pages[0] === `station:${sig}`,
      `a station from ${tr.number}'s stops: ${over.keys.join(' > ')}, in the sheet only ${over.pages.join(', ')}`);
    check(!over.cardShown, `the station over the train: its card let go (shown in ${over.card ?? 'no page'})`);
    const k1 = await back(page);
    await sleep(800);
    const backAt = await page.evaluate(() => ({ title: document.querySelector('#panel .panel-title strong')?.textContent ?? '', in: document.getElementById('panel').closest('.pg')?.dataset.key ?? null,
      follow: document.querySelector('#sheet .sh-follow')?.getAttribute('aria-pressed'), inCard: Boolean(document.querySelector('#panel .panel-head .sh-follow')) }));
    check(k1 === tr.key && backAt.in === tr.key && backAt.title.startsWith(tr.number) && backAt.follow === 'true' && backAt.inCard,
      `back: ${k1}, its card "${backAt.title}" in ${backAt.in}, Follow ${backAt.follow}${backAt.inCard ? ' in the card' : ' NOT in the card'}`);
    const k2 = await back(page);
    const left = await page.evaluate(() => ({ keys: window.__stack.keys(), pages: document.querySelectorAll('#sheet .sh-pages > .pg:not(.res)').length }));
    check(k2 === 'home' && left.keys.length === 1, `back again: ${k2}, ${left.keys.length} page(s) left`);
  }
  await toRest(page);

  // ---- ☰ answers at once after a swipe of the sheet (Max, 2026-11-20: Settings' dimming let taps through as it slid
  // away, and a tap within ~0.4 s of a swipe got no click: src/tap.js onTap acts on the finger lifted) ----
  for (const [name, open] of [['Settings swiped away', () => openFromMenu(page, 'settings')], ['Sparade (a chip) swiped away', () => openChip(page, 'saved')]]) {
    await open();
    await settle();
    const grab = await page.evaluate(() => { const r = document.querySelector('#sheet .sh-grab').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await swipe(grab.x, grab.y, Math.min(400, 830 - grab.y), { after: 30 });
    // (Settings came from the menu: backed out of, the menu opens again by itself (Max, 2026-11-24, src/nav-menu.js
    // reopenOnHome), so ☰ answering is ☰ shutting it; until 2026-11-25 this step expected ☰ to open it and failed)
    const reopened = await page.evaluate(() => document.getElementById('nav-button').getAttribute('aria-expanded') === 'true');
    await touchTap('#nav-button');
    await sleep(300);
    const s = await sheetState(page);
    if (name.startsWith('Settings')) {
      const shut = await page.evaluate(() => document.getElementById('nav-button').getAttribute('aria-expanded') === 'false')
        && await until(page, () => document.getElementById('nav').hidden, 1500);
      check(reopened && shut, `${name} (now ${s.key} at ${s.level}): the menu opened again by itself (${reopened}), ☰ tapped 30 ms later shuts it (${Boolean(shut)})`);
    } else {
      check(await navShown(), `${name} (now ${s.key} at ${s.level}), ☰ tapped 30 ms later: the menu opens`);
      // (shut the way a person does, and waited for: its buttons slide back into ☰ first)
      await page.keyboard.press('Escape');
      await until(page, () => document.getElementById('nav').hidden, 1500);
    }
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

  // ---- a train's page at half: its "More" clear of the screen's bottom (Max's phone, 2026-11-23: under Android's bar) ----
  const t2 = await openTrain();
  if (t2) {
    await setLevel(page, 1);
    await sleep(1600);   // (its half is read again each second)
    const more = await page.evaluate(() => { const b = document.querySelector('#panel .panel-more')?.getBoundingClientRect(); return b ? { bottom: Math.round(b.bottom), h: innerHeight } : null; });
    // (and no empty space under it: Max's phone, 2026-11-23, second and third rounds)
    check(!more || (more.bottom <= more.h - 2 && more.bottom >= more.h - 16), `a train at half: "More" ends ${more ? more.h - more.bottom : '?'} px above the bottom (want 2 to 16)`);
    // the chooser ("to Kallhäll"): the sheet follows the card at once (Max, 2026-11-23: "the card expands after way too long")
    const h0 = await settle();
    await click('#panel .cd-stop');
    // (the list's last stop on screen within 0.6 s: at once to the eye; a busy PC draws a glide later)
    const lastOf = () => page.evaluate(() => Math.round(document.querySelector('#panel .cd-pick .cd-row:last-child')?.getBoundingClientRect().bottom ?? 0));
    let lastRow = 0;
    for (let i = 0; i < 6; i++) { await sleep(100); lastRow = await lastOf(); if (lastRow > 0 && lastRow <= 851 - 20) break; }
    const hOpen = await shownH();
    await click('#panel .cd-stop');
    // shut: back to where it was within a second (a busy PC draws later; 2026-11-23 runs under load read 0.6 s mid-glide)
    let hShut = 0;
    for (let i = 0; i < 10 && Math.abs((hShut = await shownH()) - h0) > 4; i++) await sleep(100);
    // open: the list's last stop on screen at once, the sheet taller for it unless it fit already (the train card with
    // its trip line under the tiles: the list often fits without the sheet growing)
    check(lastRow > 0 && lastRow <= 851 - 20 && Math.abs(hShut - h0) <= 4, `the chooser: the sheet ${h0} → ${hOpen} px 0.3 s after opening (its last stop ends ${851 - lastRow} px above the bottom), ${hShut} px after shutting`);
    // the order at half (Max, 2026-11-23: "lateness and arrival time and disruption reason comes before the progress
    // bar"): the tiles, then why it stands (when it does), then the trip line
    const order = await page.evaluate(() => [...document.querySelectorAll('#panel .cd-tiles, #panel .tr-extras .why, #panel .cd-trip')]
      .map(e => ({ n: e.classList.contains('cd-tiles') ? 'tiles' : e.classList.contains('why') ? 'why' : 'trip', y: Math.round(e.getBoundingClientRect().top) }))
      .sort((a, b) => a.y - b.y).map(x => x.n).join(' → '));
    check(order === 'tiles → trip' || order === 'tiles → why → trip', `the card at half, top to bottom: ${order} (want the tiles, why, then the trip line)`);
    // (Max, 2026-11-25: the compact card smaller: no red line or state line under the number, no Share; a sign beside
    // "More" instead, its words in Läget on the full card)
    const lean = await page.evaluate(() => ({ rows: [...document.querySelectorAll('#panel :is(.panel-alert, .panel-status, .panel-note)')].length,
      share: Boolean(document.querySelector('#panel .sh-act[data-act-id="share"]')?.offsetParent), sign: document.querySelector('#panel .more-sign')?.dataset.k ?? '' }));
    check(!lean.rows && !lean.share, `the card at half: ${lean.rows} lines under the number (want none), Share ${lean.share ? 'SHOWN' : 'hidden'}; the sign by "More": ${lean.sign || 'none'}`);
    // over Home (a train tapped on the map) no ‹ on its card: only when it was opened from another page (Max, 2026-11-24:
    // "only on the situation I mentioned or similar, not always"); its company on a line of its own under the number
    const head = await page.evaluate(() => { const h = document.querySelector('#panel .panel-head'), n = h?.querySelector('.panel-title strong')?.getBoundingClientRect(), c = h?.querySelector('.panel-co')?.getBoundingClientRect();
      return { below: window.__stack.keys().at(-2), up: Boolean(h?.querySelector(':scope > .sh-up')?.offsetParent), coUnder: n && c ? c.top >= n.bottom - 2 : null }; });
    check(head.below === 'home' && !head.up && head.coUnder !== false, `a train over Home: ‹ ${head.up ? 'SHOWN' : 'none'}; its company under its number: ${head.coUnder}`);
    // nor from train to train (Max, 2026-11-24: "Not just tapping between them on the map"): another train opened over it
    const other = await page.evaluate(() => { const cur = window.__stack.top(); return window.__trains.reports().map(r => `train:${r.id}`).find(k => k !== cur); });
    if (other) {
      await page.evaluate(k => window.__stack.open(k, { go: true, fromMap: true }), other); await sleep(1200);
      const t2 = await page.evaluate(() => ({ below: window.__stack.keys().at(-2), up: Boolean(document.querySelector('#panel .panel-head > .sh-up')?.offsetParent) }));
      check(!t2.up, `a train tapped on the map over another train (${t2.below}): ‹ ${t2.up ? 'SHOWN' : 'none'}`);
      await page.evaluate(() => window.__stack.back()); await sleep(1000);
    }
    // ‹ by how a page was opened, not by what was open before (Max, 2026-11-25: "Only arrow back when coming from a click on
    // a previous card or menu etc."): a station tapped on the map over the card: none; a train clicked on its board: ‹
    await page.evaluate(() => window.__stack.open('station:Cst', { fromMap: true })); await sleep(1500);
    const st = await page.evaluate(() => ({ top: window.__stack.top(), up: Boolean(document.querySelector('#sheet .sh-up')?.offsetParent) }));
    await page.evaluate(() => document.querySelector('#board .bd-row:not(.gone)')?.click()); await sleep(2000);
    const fromRow = await page.evaluate(() => ({ top: window.__stack.top(), up: Boolean(document.querySelector('#panel .panel-head > .sh-up')?.offsetParent) }));
    check(st.top === 'station:Cst' && !st.up && /^train:/.test(fromRow.top) && fromRow.up,
      `a station tapped on the map over the card: ‹ ${st.up ? 'SHOWN' : 'none'}; a train clicked on its board (${fromRow.top}): ‹ ${fromRow.up ? 'shown' : 'NONE'}`);
    await page.evaluate(() => window.__stack.back()); await sleep(800);
    await page.evaluate(() => window.__stack.back()); await sleep(1000);
    // low: the condensed card, its last line with room under it (Max's phone, 2026-11-23: no padding under "Kort tåg")
    await setLevel(page, 0);
    // (Max, 2026-11-23: collapsed "only number, operator and destination", nothing below peeking: the rest is hidden)
    await sleep(700);
    const low = await page.evaluate(() => {
      const head = document.querySelector('#panel .panel-head'), to = document.querySelector('#panel .ph-to');
      const shown = [...document.querySelectorAll('#panel > :not(.panel-head):not(.cd), #panel .cd > *')].filter(e => e.offsetParent && getComputedStyle(e).opacity !== '0' && e.getBoundingClientRect().top < innerHeight).map(e => e.className);
      return { h: Math.round(innerHeight - document.getElementById('sheet').getBoundingClientRect().top), gap: Math.round(innerHeight - head.getBoundingClientRect().bottom),
        dest: to && to.offsetParent ? to.textContent : '', shown,
        // (the buttons in the head line: Follow only, the name and the destination whole; Max, 2026-11-23)
        whole: Boolean(to) && to.scrollWidth <= to.clientWidth + 1 && [...head.querySelectorAll('.panel-co')].every(c => c.scrollWidth <= c.clientWidth + 1),
        btns: [...head.querySelectorAll('.sh-btns button')].filter(b => b.offsetParent).map(b => b.className.split(' ')[0]).join(',') };
    });
    check(low.h < 200 && low.gap >= 8 && low.gap <= 30 && /→/.test(low.dest) && !low.shown.length && low.whole && low.btns === 'sh-follow',
      `a train at low: ${low.h} px tall, ${low.gap} px under its head line, "${low.dest}" in it${low.whole ? '' : ' CUT'}, buttons ${low.btns || 'none'}, nothing else showing (${low.shown.join(', ') || 'none'})`);
    // full: never empty room under the card (Max, 2026-11-24: "A full expanded card should never just show empty space"):
    // the sheet ends within 48 px under its last part, or the card is longer than the screen's full (it scrolls)
    await setLevel(page, 2);
    await sleep(1500);
    const full = await page.evaluate(() => {
      const s = document.getElementById('sheet').getBoundingClientRect(), pg = document.querySelector('#panel').closest('.pg');
      let end = 0; for (const c of pg.children) if (c.offsetHeight) end = Math.max(end, c.getBoundingClientRect().bottom);
      return { room: Math.round(Math.min(innerHeight, s.bottom) - end), scrolls: pg.scrollHeight > pg.clientHeight + 2 };
    });
    check(full.scrolls || (full.room >= 0 && full.room <= 48), `a train at full: ${full.scrolls ? 'longer than the screen, it scrolls' : `${full.room} px of room under its card (want 0 to 48)`}`);
    // ("Mindre ⌃" the card's last part at full, under the stops: Max, 2026-11-24 "should always be at the bottom")
    const last = await page.evaluate(() => { const more = document.querySelector('#panel .panel-more'), tl = document.querySelector('#panel .panel-table');
      return more && tl ? Math.round(more.getBoundingClientRect().top - tl.getBoundingClientRect().bottom) : null; });
    check(last !== null && last >= 0, `a train at full: "Mindre" ${last ?? '?'} px under the stops (want under them)`);
    // (at full: Share in the top line; Läget there whenever the compact card had its sign, red with a red sign)
    const atFull = await page.evaluate(() => ({ share: Boolean(document.querySelector('#panel .sh-act[data-act-id="share"]')?.offsetParent),
      sign: document.querySelector('#panel .more-sign')?.dataset.k ?? '', laget: document.querySelector('#panel .tv-box')?.offsetParent ? (document.querySelector('#panel .tv-box.warn') ? 'warn' : 'note') : '' }));
    check(atFull.share && (atFull.sign === '' ? atFull.laget !== 'warn' : atFull.sign === 'warn' ? atFull.laget === 'warn' : Boolean(atFull.laget)),
      `a train at full: Share ${atFull.share ? 'shown' : 'HIDDEN'}; Läget ${atFull.laget || 'none'} (the sign was ${atFull.sign || 'none'})`);
    await setLevel(page, 1);
  }
  // ---- the start (Max's pick C, 2026-11-25: "Search bar strict for searching. Remove its line indicating you can swipe
  // it up"): Home at rest is the search bar alone, the field as far from the sheet's edges as from its sides, no
  // handle; a pull on it does nothing; the chips above it open their cards ----
  // A page at half: no row cut through, a mark that there is more below (Max, 2026-11-23, on Home until 2026-11-25)
  const cutsOf = (p, key) => p.evaluate((k) => {
    // (where the page shows to: a computer's arrow band under it hides what is below)
    const sheet = document.getElementById('sheet'), bottom = Math.min(innerHeight, sheet.querySelector('.sh-pages').getBoundingClientRect().bottom);
    const pg = document.querySelector(`#sheet .pg[data-key="${k}"]`);
    const cut = [...pg.querySelectorAll(':scope > *, :scope > * > *, :scope > * > * > *')].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 220 && r.top < bottom - 20 && r.bottom > bottom + 1; });   // (under the fade's solid lower 20 px nothing shows)
    const more = document.querySelector('#sheet .sh-more').getBoundingClientRect();
    // (its word: "More" when several parts are below; Max, 2026-11-24)
    const word = [...sheet.querySelectorAll('.sh-word')].filter(e => e.offsetParent && getComputedStyle(e).display !== 'none').map(e => e.textContent).join('|');
    // (the pill in a band of its own: 8 px or more under the card above, no card's edge behind it where the fade is not
    // yet solid; Max, 2026-11-24 "Dålig padding på 'mer' pillret")
    const fade = document.querySelector('#sheet .sh-fade').getBoundingClientRect(), solid = innerWidth >= 440 ? fade.top + fade.height * 0.4 : fade.top + 12;
    const secs = [...pg.querySelectorAll(':scope > *, :scope > .sec > *')].map(c => c.getBoundingClientRect()).filter(r => r.height);
    const above = secs.filter(r => r.bottom <= more.top + 1).at(-1);
    const pillGap = above ? Math.round(more.top - above.bottom) : null;
    const behind = secs.some(r => r.top < solid - 1 && r.top > (above?.bottom ?? 0) + 1 && r.top < more.top);
    return { cut: cut.map(e => e.className || e.tagName).slice(0, 3), fade: sheet.classList.contains('more-below'), chevron: more.bottom <= bottom + 1 && more.top >= bottom - 40, word, pillGap, behind };
  }, key);
  const fieldGap = p => p.evaluate(() => { const f = document.querySelector('#sheet .sh-field').getBoundingClientRect(), s = document.getElementById('sheet').getBoundingClientRect();
    return { below: Math.round(Math.min(innerHeight, s.bottom) - f.bottom), above: Math.round(f.top - s.top), side: Math.round(f.left - s.left) }; });
  // the bar alone: no handle row, no grip; the chips over it (Störningar only with live data: a replay has none)
  const bare = p => p.evaluate(() => {
    const g = document.querySelector('#sheet .sh-grab'), grip = document.getElementById('sheet-grip'), c = document.getElementById('chips');
    const s = document.getElementById('sheet').getBoundingClientRect(), r = [...c.querySelectorAll('.sc')].map(b => b.getBoundingClientRect());
    const cs = getComputedStyle(c);
    return { grab: g.offsetHeight, grip: grip?.offsetHeight ?? 0, chips: [...c.querySelectorAll('[data-chip]')].map(b => b.dataset.chip).join(' '),
      shown: cs.visibility === 'visible' && Number(cs.opacity) > 0.9,
      // (a phone: over the sheet's top; a computer: under the box)
      gap: r.length ? Math.round(innerWidth >= 440 ? Math.min(...r.map(x => x.top)) - s.bottom : s.top - Math.max(...r.map(x => x.bottom))) : null,
      inside: r.every(x => x.left >= s.left - 1 && x.right <= s.right + 1) };
  });
  // a chip's card: the keys, the lit chip, the chips in its head and not over the map, no ‹
  const card = p => p.evaluate(() => {
    const head = document.querySelector('#sheet .sh-chips'), hs = getComputedStyle(head), fs = getComputedStyle(document.getElementById('chips'));
    return { keys: window.__stack.keys().join(' > '), level: window.__stack.level, lit: [...head.querySelectorAll('[aria-pressed="true"]')].map(b => b.dataset.chip).join(','),
      head: head.getBoundingClientRect().height > 0 && hs.visibility === 'visible' && Number(hs.opacity) > 0.9, float: fs.visibility !== 'hidden',
      up: Boolean(document.querySelector('#sheet .sh-up')?.offsetParent),
      // (a computer: the search field stays, the chips under it)
      field: Boolean(document.querySelector('#sheet .sh-field')?.offsetParent) && getComputedStyle(document.querySelector('#sheet .sh-search')).visibility === 'visible',
      under: document.querySelector('#sheet .sh-chips .sc').getBoundingClientRect().top >= document.querySelector('#sheet .sh-field').getBoundingClientRect().bottom };
  });
  await toRest(page);
  await sleep(500);   // (the glide down ends)
  const fg = await fieldGap(page);
  check(Math.abs(fg.below - fg.side) <= 2 && Math.abs(fg.above - fg.side) <= 2, `Home at rest: the search field ${fg.above} px from the sheet's top, ${fg.below} px from its bottom, ${fg.side} px from its side`);
  const b0 = await bare(page);
  check(!b0.grab && !b0.grip, `Home at rest: no handle (its row ${b0.grab} px, the grip ${b0.grip} px)`);
  check(b0.shown && b0.chips === 'saved stats' && b0.gap >= 6 && b0.gap <= 14 && b0.inside, `Home at rest: the chips over the bar (${b0.chips}; shown ${b0.shown}, ${b0.gap} px over it, within its width ${b0.inside})`);
  // a pull up from the bar's edge (not the field: its tap searches) moves nothing
  const rest0 = await shownH(), edge = await page.evaluate(() => { const s = document.getElementById('sheet').getBoundingClientRect(), f = document.querySelector('#sheet .sh-field').getBoundingClientRect(); return { x: s.left + 5, y: f.top + f.height / 2 }; });
  await page.touchscreen.touchStart(edge.x, edge.y);
  for (let k = 1; k <= 10; k++) { await page.touchscreen.touchMove(edge.x, edge.y - k * 30); await sleep(16); }
  const mid = await shownH();
  await page.touchscreen.touchEnd();
  await sleep(600);
  const pulled = { mid, end: await shownH(), ...(await sheetState(page)), searching: await page.evaluate(() => window.__stack.searching) };
  check(pulled.mid === rest0 && pulled.end === rest0 && pulled.key === 'home' && pulled.level === 0 && !pulled.searching, `Home: a pull up on the bar moves nothing (${rest0} → ${pulled.mid} → ${pulled.end} px, ${pulled.key} at ${pulled.level}${pulled.searching ? ', SEARCHING' : ''})`);
  // a chip: its card, the chips in its head, the lit one marked; at half no row cut, "More" below
  await openChip(page, 'stats');
  await sleep(600);
  const cs1 = await card(page);
  check(cs1.keys === 'home > stats' && cs1.level === 1 && cs1.lit === 'stats' && cs1.head && !cs1.float && !cs1.up,
    `the chip Statistik: ${cs1.keys} at ${cs1.level}, lit ${cs1.lit || 'none'}, the chips in its head ${cs1.head}, over the map ${cs1.float}, ‹ ${cs1.up ? 'SHOWN' : 'none'}`);
  const hc = await cutsOf(page, 'stats');
  check(!hc.cut.length && hc.fade && hc.chevron && /^(More|Mer)$/.test(hc.word), `Statistik at half: cut through: ${hc.cut.join(', ') || 'nothing'}; the "more below" fade ${hc.fade}, its chevron at the edge ${hc.chevron}, its word "${hc.word}" (want More)`);
  check(hc.pillGap >= 8 && !hc.behind, `Statistik at half: the "More" pill ${hc.pillGap} px under the part above (want 8 or more), a part's edge behind it: ${hc.behind}`);
  // another chip replaces the card (no stack, no ‹); the lit one closes it; Esc too
  await openChip(page, 'saved');
  const cs2 = await card(page);
  check(cs2.keys === 'home > saved' && cs2.lit === 'saved' && !cs2.up, `then Sparade: ${cs2.keys} (want it in Statistik's place), lit ${cs2.lit || 'none'}, ‹ ${cs2.up ? 'SHOWN' : 'none'}`);
  await page.click('#sheet .sh-chips [data-chip="saved"]');
  await until(page, () => window.__stack.top() === 'home' && window.__stack.level === 0, 3000);
  await sleep(500);
  const shut = { ...(await sheetState(page)), ...(await bare(page)) };
  check(shut.key === 'home' && shut.keys.length === 1 && shut.level === 0 && shut.shown, `the lit chip tapped: ${shut.keys.join(' > ')} at ${shut.level}, the chips over the bar again ${shut.shown}`);
  await openChip(page, 'saved');
  const kEsc = await back(page);
  check(kEsc === 'home', `a chip's card, Esc: ${kEsc}`);
  await toRest(page);
  // ---- a computer (Max, 2026-11-23): a train's lowest height is the whole card down to "More", nothing under it; the
  // start mirrored: the chips under the search box, no arrow band under the bar alone, a chip's card under them ----
  if (t2) {
    const pc = await waitForMap(browser, { ...base, size: { width: 1500, height: 1000, deviceScaleFactor: 1 } });
    if (await openTrainByNumber(pc, t2.number)) {
      await sleep(1200);
      await pc.evaluate(() => window.__stack.setLevel(0));
      await sleep(700);
      const m = await pc.evaluate(() => { const b = document.querySelector('#panel .panel-more')?.getBoundingClientRect(), s = document.getElementById('sheet').getBoundingClientRect(); return b ? Math.round(s.bottom - b.bottom) : null; });
      // (the sheet hangs from the top on a computer since 2026-11-23: its arrow's 20 px row is under "More")
      check(m !== null && m >= 2 + 8 && m <= 16 + 8, `a computer, a train at its lowest: "More" ${m ?? '?'} px above the sheet's bottom, its thin handle row included (want 10 to 24)`);
      await pc.evaluate(() => window.__stack.home(0));
      await sleep(600);
      const pfg = await fieldGap(pc);
      check(Math.abs(pfg.above - pfg.side) <= 3 && Math.abs(pfg.below - pfg.side) <= 3, `a computer, Home at rest: the search field ${pfg.above} px from the sheet's top, ${pfg.below} px from its bottom (no arrow band), ${pfg.side} px from its side`);
      const pb = await bare(pc);
      check(pb.shown && pb.chips === 'saved stats' && pb.gap >= 6 && pb.gap <= 14 && pb.inside, `a computer, Home at rest: the chips under the box (${pb.chips}; shown ${pb.shown}, ${pb.gap} px under it, within its width ${pb.inside})`);
      await openChip(pc, 'stats');
      await sleep(900);
      const pcard = await card(pc);
      check(pcard.keys === 'home > stats' && pcard.lit === 'stats' && pcard.head && pcard.field && pcard.under && !pcard.float,
        `a computer, the chip Statistik: ${pcard.keys}, lit ${pcard.lit || 'none'}, the search field kept ${pcard.field}, the chips under it ${pcard.under}`);
      const pcut = await cutsOf(pc, 'stats');
      check(!pcut.cut.length && /^(More|Mer)$/.test(pcut.word), `a computer, Statistik at half: cut through: ${pcut.cut.join(', ') || 'nothing'}; the arrow's word "${pcut.word}" (want More)`);
    } else fails.push(`a computer: train ${t2.number} could not be opened`);
    errors.push(...pc.errors);
    await pc.close();
  }

  // ---- a train's page at full: swipes on the page and on a button ----
  if (!t2) fails.push('swipe: no train with its stops could be opened');
  else {
    const pgSel = `#sheet .pg[data-key="${t2.key}"]`;
    const level = () => page.evaluate(() => window.__stack.level);
    const isFull = () => page.evaluate(() => document.getElementById('panel').classList.contains('full'));
    await page.evaluate(k => window.__stack.open(k), t2.key);   // (again, after Home above)
    await until(page, () => Boolean(document.querySelector('#panel .panel-more')), 8000);
    await settle();
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
    // (from the page's top: at full a page scrolled down scrolls back first, as on the page above)
    await page.evaluate(s => { document.querySelector(s).scrollTop = 0; }, pgSel);
    await sleep(300);
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
    // (clear of a station's name: a name drawn over the dot takes the tap by design, src/map.js; the replay's train drove
    // under "Stockholm C", 2026-11-25: waited for, up to 15 s)
    const dotNow = () => page.evaluate(() => {
      const f = [...window.__map.queryRenderedFeatures({ layers: ['train-dots'] })].find(x => `train:${x.properties.id}` === window.__stack.top());
      if (!f) return null;
      const p = window.__map.project(f.geometry.coordinates);
      // (station names are page elements over the map, src/map.js stationNameAt: their boxes, 3 px round, as it reads them)
      const c = document.getElementById('map').getBoundingClientRect(), x = p.x + c.left, y = p.y + c.top;
      const named = [...document.querySelectorAll('.station-name')].some((el) => { const r = el.getBoundingClientRect(); return r.width && x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6; });
      return { x: p.x, y: p.y, named };
    });
    let dot = await dotNow();
    for (let i = 0; i < 30 && dot?.named; i++) { await sleep(500); dot = await dotNow(); }
    if (!dot) fails.push('tap on the open train: its dot not found on the map');
    else {
      await page.evaluate(() => { window.__emptied = false; const el = document.getElementById('panel');
        new MutationObserver(() => { if (el.querySelector('.state')) window.__emptied = true; }).observe(el, { childList: true, subtree: true }); });
      await page.touchscreen.tap(dot.x, dot.y);
      await sleep(1500);
      const r = await page.evaluate(k => ({ emptied: window.__emptied, open: window.__stack.top() === k, keys: window.__stack.keys().join(' > ') }), t2.key);
      check(r.open && !r.emptied, `a tap on the train already open keeps its card as it is (open ${r.open}, emptied ${r.emptied}; pages ${r.keys}, tapped at ${Math.round(dot.x)},${Math.round(dot.y)})`);
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
