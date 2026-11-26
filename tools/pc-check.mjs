// The page on a computer's screen (1500 x 1000, a mouse; Max's PC notes of 2026-11-23), on the replay of 17 Nov
// 16:00 (CARD_HOUR):
// - the map always drags: pulling the sheet with the mouse by a card's text leaves no text selected; a selection left
//   on the page is cleared by a press on the map, which then moves; the browser's own drag of a picture never starts
//   on the map (a press on selected content dragged a ghost picture instead of the map, and "live" showed highlighted);
// - with a card raised (half, full) the map's buttons and the live mark stay shown.
// Since the start chips (Max's pick C, 2026-11-25) Home is the search box alone: what was checked on Home is checked on
// its own page (Statistik, Sparade, Filter), opened as a person does (a chip, ☰).
// Not checkable here: the browser's own drag-and-drop of a selection (this test browser makes none), a real mouse.
// Run: PAGE=http://localhost:5181/ node tools/pc-check.mjs
import { launch, CARD_HOUR, sleep } from './lib/browser.mjs';
import { waitForMap, setLevel, openChip, openMenu, toRest, openFromMenu } from './lib/screen.mjs';

let failed = 0;
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };
const PC = { width: 1500, height: 1000, deviceScaleFactor: 1 };

const browser = await launch();
try {
  const page = await waitForMap(browser, { size: PC, replay: CARD_HOUR, lang: 'en' });
  await sleep(2500);
  const center = () => page.evaluate(() => { const c = window.__map.getCenter(); return `${c.lng.toFixed(4)},${c.lat.toFixed(4)}`; });
  const selected = () => page.evaluate(() => String(getSelection()));
  async function mouseDrag(x, y, dx, dy) {
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 15; i++) { await page.mouse.move(x + dx * i / 15, y + dy * i / 15); await sleep(16); }
    await page.mouse.up(); await sleep(600);
  }

  // 1. A chip's card (Statistik, at half) pulled by its text with the mouse (down and to the right, over the map)
  await openChip(page, 'stats');
  await setLevel(page, 1);   // (it opens at full on a computer since 2026-11-26: step 19)
  const at = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#sheet .pg p, #sheet .pg h2, #sheet .pg h3')].find(e => e.offsetParent && e.getBoundingClientRect().top > 0 && e.textContent.trim());
    const r = el.getBoundingClientRect();
    return { x: r.x + 20, y: r.y + r.height / 2 };
  });
  await mouseDrag(at.x, at.y, 600, 380);   // (down: on a computer the sheet hangs from the top, 2026-11-23)
  ok(await page.evaluate(() => window.__stack.level) > 1, 'a mouse pull by Statistik\'s text raises the sheet');
  const left = await selected();
  ok(!left.trim(), `no text selected after the pull${left.trim() ? ` (selected: "${left.trim().slice(0, 40)}")` : ''}`);

  // 2. a selection left on the page: a press on the map clears it, and the map moves
  await page.evaluate(() => getSelection().selectAllChildren(document.body));
  const c0 = await center();
  await mouseDrag(900, 400, -240, -100);
  ok(!(await selected()).trim(), 'a press on the map clears a selection on the page');
  ok(await center() !== c0, 'the map moves with that drag');

  // 3. the browser's own drag never starts on the map
  const stopped = await page.evaluate(() => {
    const e = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    document.querySelector('#map canvas').dispatchEvent(e);
    return e.defaultPrevented;
  });
  ok(stopped, 'a picture drag starting on the map is stopped');

  // 4. A card raised (Statistik): the map's buttons and the live mark stay (the sheet floats at the left and covers neither)
  if (await page.evaluate(() => window.__stack.top()) !== 'stats') await openChip(page, 'stats');
  for (const level of [1, 2]) {
    await setLevel(page, level);
    await sleep(300);
    // (the buttons' corner box takes no presses by design, its buttons do; the live mark is fixed: no offsetParent)
    const seen = await page.evaluate(() => Object.fromEntries([['the map buttons', '.maplibregl-ctrl-bottom-right'], ['the live mark', '#status']].map(([name, sel]) => {
      const el = document.querySelector(sel), cs = el && getComputedStyle(el);
      const press = el && getComputedStyle(el.querySelector('.maplibregl-ctrl') ?? el).pointerEvents;
      return [name, Boolean(el && el.getClientRects().length && cs.opacity === '1' && cs.visibility !== 'hidden' && press !== 'none')];
    })));
    for (const [name, shown] of Object.entries(seen)) ok(shown, `${name} shown with Statistik at ${level === 2 ? 'full' : 'half'}`);
  }

  // 5. a row's edge pressed at hand speed (Max, 2026-11-24: the › on a saved trip "Still doesn't do anything": a held
  //    press shrank the row, the release was beside it); and pressed, then moved off it: no click
  await page.evaluate(() => localStorage.setItem('favourites', JSON.stringify({ stations: [], trains: [], trips: [{ key: 'Cst>G>Mc', from: 'Cst', via: 'G', to: 'Mc' }], changes: [] })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stack?.top?.() === 'home', { timeout: 30000 });
  await sleep(2000);
  // (the saved trip is on Sparade, a chip's card)
  const edge = async () => {
    await openChip(page, 'saved');
    await page.waitForFunction(() => document.querySelector('#sheet .trip-row'), { timeout: 10000 });
    return page.evaluate(() => { const r = [...document.querySelector('#sheet .trip-row').querySelectorAll('svg')].at(-1).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  };
  let p = await edge();
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(150);
  await page.mouse.down(); await sleep(150); await page.mouse.up(); await sleep(900);
  const opened = await page.evaluate(() => window.__stack.top());
  ok(opened === 'trip:Cst>G>Mc', `the › on a saved trip, held 150 ms: ${opened}`);
  p = await edge();
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await sleep(100);
  await page.mouse.move(p.x + 200, p.y + 120, { steps: 8 }); await page.mouse.up(); await sleep(900);
  const stayed = await page.evaluate(() => window.__stack.top());
  ok(stayed === 'saved', `pressed on the row, moved off it and let go: no click (${stayed})`);

  // 6. ☰: a card under the search bar's box, its right edge in line with the box's (Max, 2026-11-25: "Menu NOT aligned",
  //    his pick: the box's outer edge), an icon before each choice, the search field
  //    still there (Max, 2026-11-25: "revert the hamburger menu. Slide out card like before. Under the hamburger and under
  //    the searchbar, with good padding. Aligned with the right side of the search bar. Add back icons"); the page behind
  //    holds still (a wheel over it moves nothing); a choice opens its page, the menu goes. Since the start chips: Filter
  //    first among its choices; opened over a chip's card, the card closes first and the menu comes under the box.
  await openChip(page, 'stats');
  await page.evaluate(() => document.getElementById('nav-button')?.click()); await sleep(1300);
  const overCard = await page.evaluate(() => ({ top: window.__stack.top(), open: !document.getElementById('nav').hidden, chips: getComputedStyle(document.getElementById('chips')).visibility }));
  ok(overCard.top === 'home' && overCard.open && overCard.chips === 'hidden', `☰ over Statistik's card: the card closed (${overCard.top}), the menu open (${overCard.open}), the chips stepped aside (${overCard.chips})`);
  const menu = await page.evaluate(() => { const n = document.getElementById('nav'), b = document.getElementById('nav-button').getBoundingClientRect(), s = document.getElementById('sheet').getBoundingClientRect(); if (!n || n.hidden) return null;
    const r = n.getBoundingClientRect(); return { at: Math.round(r.right), right: Math.round(r.right - s.right), gap: Math.round(r.top - s.bottom), icons: n.querySelectorAll('.nav-row .nav-ic svg').length,
      field: Boolean(document.querySelector('#sheet .sh-field').offsetParent), rows: n.querySelectorAll('.nav-row').length }; });
  const firstRow = await page.evaluate(() => document.querySelector('#nav .nav-row')?.id);
  ok(menu && menu.rows === 4 && menu.icons === 4 && firstRow === 'open-filter' && Math.abs(menu.right) <= 1 && menu.gap >= 6 && menu.gap <= 16 && menu.field,
    `☰: a card of ${menu?.rows} choices with ${menu?.icons} icons (the first ${firstRow}), ${menu?.gap} px under the box (want 6 to 16), its right edge ${menu?.right} px from the box's, the field ${menu?.field ? 'there' : 'gone'}`);
  const still = await page.evaluate(() => ({ lvl: window.__stack.level, h: Math.round(document.getElementById('sheet').getBoundingClientRect().height) }));
  const over = await page.evaluate(() => { const r = document.getElementById('sheet').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; });
  await page.mouse.move(over.x, over.y); await page.mouse.wheel({ deltaY: 400 }); await sleep(700);
  const still2 = await page.evaluate(() => ({ lvl: window.__stack.level, h: Math.round(document.getElementById('sheet').getBoundingClientRect().height) }));
  ok(still2.lvl === still.lvl && still2.h === still.h, `the menu open, a wheel over the box: height ${still.lvl} -> ${still2.lvl}, ${still.h} -> ${still2.h} px (want nothing)`);
  await page.evaluate(() => document.getElementById('open-settings').click()); await sleep(150);
  // (the card stays where it is, under the sheet, and the page slides over it: no slide back; Max, 2026-11-25 "the hamburger
  // menu clips through the new card. New card should just slide over with menu under")
  const parked = await page.evaluate(() => { const n = document.getElementById('nav'); return { shown: !n.hidden, under: Number(getComputedStyle(document.getElementById('nav-window')).zIndex) < Number(getComputedStyle(document.getElementById('sheet')).zIndex), moving: n.getAnimations().length }; });
  ok(parked.shown && parked.under && !parked.moving, `a choice: the menu stays in place under the sheet as the page comes (shown ${parked.shown}, under ${parked.under}, moving ${parked.moving})`);
  await sleep(1050);
  // (gone from sight: hidden, or parked under the page that covers it, so back finds it there; Max, 2026-11-26: "the menu
  // should not slide up again, it should already be there")
  const after = await page.evaluate(() => {
    const n = document.getElementById('nav'), r = n.getBoundingClientRect(), s = document.getElementById('sheet').getBoundingClientRect();
    const covered = n.classList.contains('under') && r.top >= s.top && r.bottom <= s.bottom && r.left >= s.left && r.right <= s.right;
    return { top: window.__stack.top(), open: !n.hidden && !covered };
  });
  ok(after.top === 'page:settings' && !after.open, `a choice opens its page (${after.top}), the menu goes from sight (${after.open ? 'still shown' : 'hidden or under the page'})`);
  //    back from Settings: the menu open again, placed where the sheet came to rest (src/nav-menu.js reopenOnHome; until
  //    2026-11-25 it was placed while the sheet still had Settings' size, somewhere else): its right edge where it was
  //    before Settings, under the box
  await page.keyboard.press('Escape'); await sleep(1600);
  const again = await page.evaluate(() => { const n = document.getElementById('nav'), s = document.getElementById('sheet').getBoundingClientRect(); if (!n || n.hidden) return null;
    const r = n.getBoundingClientRect(); return { top: window.__stack.top(), at: Math.round(r.right), gap: Math.round(r.top - s.bottom), moving: n.getAnimations().length }; });
  ok(again && again.top === 'home' && Math.abs(again.at - menu?.at) <= 1 && again.gap >= 6 && again.gap <= 16 && !again.moving,
    `back from Settings: the menu ${again ? 'open again' : 'NOT open'} on ${again?.top}, its right edge at ${again?.at} px (before Settings ${menu?.at}), ${again?.gap} px under the box (want 6 to 16)`);
  // 6b. ☰ again shuts it (the bar alone has no arrow under it since the start chips, Max 2026-11-25); Home stays at rest,
  //     the chips come back under the box
  await page.mouse.click(...(await page.evaluate(() => { const b = document.getElementById('nav-button').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }))); await sleep(900);
  const shut = await page.evaluate(() => ({ open: !document.getElementById('nav').hidden, lvl: window.__stack.level, chips: getComputedStyle(document.getElementById('chips')).visibility }));
  ok(!shut.open && shut.lvl === 0 && shut.chips === 'visible', `☰ again: the menu ${shut.open ? 'still open' : 'shut'}, Home at ${shut.lvl}, the chips ${shut.chips}`);

  // 7. A chip's card at full, its arrow clicked: one step down to half, then on (Max, 2026-11-24: "it should compact, not
  //    close it"; Home's until the start chips)
  await openChip(page, 'stats');
  await page.evaluate(() => window.__stack.setLevel(2)); await sleep(1200);
  const arrow = async () => { const r = await page.evaluate(() => { const b = document.querySelector('#sheet .sh-grab').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.click(r.x, r.y); await sleep(900); return page.evaluate(() => window.__stack.level); };
  const l1 = await arrow();
  // (at half the arrow points where a click goes: ⌄ more below shows full again, ⌃ goes to rest)
  const next = await page.evaluate(() => document.getElementById('sheet').dataset.next), l2 = await arrow();
  // (a chip's card has no low: from half, "close" takes it home)
  ok(l1 === 1 && l2 === (next === 'more' ? 2 : 0), `Statistik at full, the arrow clicked: height ${l1} (want half); again, its arrow "${next}": height ${l2}`);

  // 8. The arrow's band at the sheet's bottom: as much room above the arrow as under it, at half and at full (Max,
  //    2026-11-24: "'Mer v' still too close to the edge"); the bar alone has none
  for (const lvl of [1, 2]) {
    if (await page.evaluate(() => window.__stack.top()) !== 'stats') await openChip(page, 'stats');
    await page.evaluate(l => window.__stack.setLevel(l), lvl); await sleep(1300);
    const m = await page.evaluate(() => { const g = document.querySelector('#sheet .sh-grab').getBoundingClientRect(), a = document.querySelector('#sheet .sh-arrow').getBoundingClientRect(), s = document.getElementById('sheet').getBoundingClientRect();
      return { above: Math.round(a.top - g.top), below: Math.round(s.bottom - a.bottom) }; });
    ok(Math.abs(m.above - m.below) <= 2 && m.below >= 5, `Statistik at ${lvl === 1 ? 'half' : 'full'}: the arrow ${m.above} px under its band's top, ${m.below} px over the sheet's bottom`);
  }
  await page.evaluate(() => window.__stack.home(0)); await sleep(900);
  const bare = await page.evaluate(() => ({ band: document.querySelector('#sheet .sh-grab').offsetHeight, h: Math.round(document.getElementById('sheet').getBoundingClientRect().height) }));
  ok(!bare.band, `Home at rest: no arrow band (${bare.band} px), the box ${bare.h} px`);
  await openChip(page, 'stats');
  await page.evaluate(() => window.__stack.setLevel(1)); await sleep(1300);
  // 9. "Mer" and its arrow side by side in one pill, nothing over the word (Max, 2026-11-24: "v-pill background blocks 'mer'")
  const pill = await page.evaluate(() => { const w = document.querySelector('#sheet .sh-grab .sh-word'), a = document.querySelector('#sheet .sh-arrow');
    if (!w?.offsetWidth) return null; const wr = w.getBoundingClientRect(), ar = a.getBoundingClientRect(); return { gap: Math.round(ar.left - wr.right), one: Boolean(w.closest('.sh-pill')?.contains(a)) }; });
  ok(!pill || (pill.gap >= 0 && pill.one), `"Mer" and its arrow: ${pill ? `${pill.gap} px apart, one pill ${pill.one}` : 'no word shown now'}`);
  // 10. A page whose arrow would only close it (its ‹ does that): no arrow (Max, 2026-11-24: "both back arrow and the
  //     collapse arrow that dismisses it. Remove the last one"); a train's card at full: the fade down to its thin band
  await page.evaluate(() => window.__stack.open('page:help', { go: true })); await sleep(1300);
  await page.evaluate(() => window.__stack.setLevel(1)); await sleep(1000);
  const cl = await page.evaluate(() => ({ next: document.getElementById('sheet').dataset.next, shown: getComputedStyle(document.querySelector('#sheet .sh-arrow')).visibility }));
  ok(cl.next !== 'close' || cl.shown === 'hidden', `About at half: the arrow would ${cl.next}, shown: ${cl.shown}`);
  const id = await page.evaluate(() => window.__trains.reports().map(r => r.id)[5]);
  await page.evaluate(i => window.__stack.open(`train:${i}`, { go: true }), id); await sleep(1500);
  await page.evaluate(() => window.__stack.setLevel(2)); await sleep(1300);
  const fb = await page.evaluate(() => { const f = document.querySelector('#sheet .sh-fade').getBoundingClientRect(), g = document.querySelector('#sheet .sh-grab').getBoundingClientRect(); return Math.round(g.top - f.bottom); });
  ok(Math.abs(fb) <= 1, `a train at full: the fade ends ${fb} px above its band (want 0; Max: "A random border clipping the text")`);

  // 11. The empty search: as tall as its line and the usual room under it, no empty band (Max, 2026-11-25: "Empty search
  //     field has too big empty card")
  await page.evaluate(() => window.__stack.home(0)); await sleep(900);
  await page.click('#search'); await sleep(1000);
  const es = await page.evaluate(() => { const s = document.getElementById('sheet').getBoundingClientRect(), last = [...document.querySelectorAll('#search-results > *')].filter(e => e.offsetHeight).at(-1)?.getBoundingClientRect();
    return last ? { under: Math.round(s.bottom - last.bottom), h: Math.round(s.height) } : null; });
  ok(es && es.under >= 8 && es.under <= 20, `the empty search: ${es?.under ?? '?'} px under its line (want 8 to 20), the sheet ${es?.h ?? '?'} px`);
  await page.keyboard.press('Escape'); await sleep(500);

  // 12. A page in the sheet scrolls with our own thin bar, never the browser's (Max, 2026-11-25: grabbed, the browser's
  //     "shows a black background under it ... Also changes width. This was fixed once before. Why back?"): Statistik
  //     at full (Home until the start chips), the browser's bar takes no room, ours shows; dragging it scrolls the page,
  //     the page as wide as before; at half no bar (the page doesn't scroll there)
  await openChip(page, 'stats');
  await page.evaluate(() => window.__stack.setLevel(2)); await sleep(1300);
  const sb = () => page.evaluate(() => { const pg = document.querySelector('#sheet .pg[data-key="stats"]'), bar = document.querySelector('#sheet .sh-pages > .sb'), th = bar?.querySelector('.sb-thumb')?.getBoundingClientRect();
    return { native: pg.offsetWidth - pg.clientWidth, w: pg.clientWidth, can: pg.scrollHeight - pg.clientHeight, top: pg.scrollTop, shown: Boolean(bar && !bar.hidden && bar.offsetHeight),
      th: th ? { x: th.x + th.width / 2, y: th.y + th.height / 2 } : null }; });
  const s0 = await sb();
  if (s0.can > 4) {
    ok(s0.native === 0 && s0.shown && s0.th, `Statistik at full: the browser's bar ${s0.native} px (want 0), ours ${s0.shown ? 'shown' : 'missing'}`);
    if (s0.th) {
      await page.mouse.move(s0.th.x, s0.th.y); await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(s0.th.x, s0.th.y + i * 12); await sleep(16); }
      await page.mouse.up(); await sleep(300);
      const s1 = await sb();
      ok(s1.top > s0.top + 20 && s1.w === s0.w && s1.native === 0, `our bar dragged 120 px: the page scrolled ${s0.top} -> ${s1.top}, its width ${s0.w} -> ${s1.w}, the browser's bar ${s1.native} px`);
    }
  } else console.log(`note Statistik at full doesn't scroll now (${s0.can} px more): the bar not checked`);
  await page.evaluate(() => window.__stack.setLevel(1)); await sleep(1300);
  const s2 = await sb();
  ok(!s2.shown, `Statistik at half: no bar (${s2.shown ? 'shown' : 'none'})`);

  // 13. The filter (☰ → Filter since the start chips; Home's until then): the companies and "N more" on two rows at most
  //     (Max, 2026-11-25: "Filter operators including 'n till' should only be one row"; back to two, 2026-11-26: "a reverse
  //     of something I asked for earlier"); the count says what is left out. Also
  //     after "N more" opened and "Fewer" folded it again, twice (Max, 2026-11-25: after "Färre" they showed on two rows:
  //     the fit was skipped, its own cache said done)
  await page.evaluate(() => window.__stack.home(0)); await sleep(900);
  await openMenu(page);
  await page.click('#open-filter');
  await page.waitForFunction(() => window.__stack.top() === 'filter' && !document.querySelector('#sheet .pg-ghost'), { timeout: 4000 }); await sleep(600);
  const coRow = () => page.evaluate(() => { const box = document.querySelector('#sheet .co-filter'); if (!box) return null;
    const shown = [...box.children].filter(c => !c.hidden && c.offsetHeight), more = box.querySelector('.co-more');
    return { rows: new Set(shown.map(c => c.offsetTop)).size, chips: shown.filter(c => c.matches('.co-f')).length, total: Number(box.dataset.total), more: more && !more.hidden ? more.textContent.trim() : '' }; });
  const oneRow = co => co && co.rows >= 1 && co.rows <= 2 && (co.total - co.chips === 0 ? !co.more : co.more.startsWith(String(co.total - co.chips)));
  const co = await coRow();
  ok(oneRow(co), `the filter's companies: ${co?.rows} row(s), ${co?.chips} of ${co?.total} shown, "${co?.more}"`);
  for (const k of [1, 2]) {
    const more = () => page.evaluate(() => { const b = document.querySelector('#sheet .co-filter .co-more:not([hidden])'); b?.click(); return Boolean(b); });
    const opened = await more(); await sleep(900);
    const open = await coRow();
    const folded = await more(); await sleep(900);
    const again = await coRow();
    ok(opened && folded && open?.rows > 1 && oneRow(again), `"N more" then "Fewer" (${k === 1 ? 'once' : 'twice'}): opened ${open?.rows} rows, folded ${again?.rows} row(s), ${again?.chips} of ${again?.total} shown, "${again?.more}"`);
  }

  // 14. New trip, its To field typed in: the sheet ends under the last real part, the Save button, with only the usual
  //     room (Max, 2026-11-25: on a computer it grew to the screen's full, empty, the room meant for a phone's keyboard)
  await page.evaluate(() => window.__stack.home(0)); await sleep(900);
  await page.evaluate(() => window.__stack.open('newtrip')); await sleep(1500);
  await page.evaluate(() => document.querySelector('.pg[data-key="newtrip"] .nt-stop.to .nt-pill')?.click()); await sleep(1500);
  const nt = await page.evaluate(() => { const save = document.querySelector('.pg[data-key="newtrip"] .nt-save')?.getBoundingClientRect(), band = document.querySelector('#sheet .sh-grab').getBoundingClientRect();
    return save ? { under: Math.round(band.top - save.bottom), typing: Boolean(document.activeElement?.matches('.nt-q')) } : null; });
  ok(nt && nt.typing && nt.under >= 0 && nt.under <= 20, `New trip, To typed in: the page ends ${nt?.under ?? '?'} px under Save (want 0 to 20; the arrow's band under it not counted), the field ${nt?.typing ? 'focused' : 'not focused'}`);

  // 15. The stack says where the sheet is going and when it stands: target, whenSettled() at the glide's end (at once
  //     when nothing moves), onSettled once per rest (from full to half: Home has no height but its rest since the start
  //     chips)
  await openChip(page, 'stats');
  await page.evaluate(() => window.__stack.setLevel(2)); await sleep(1300);
  const se = await page.evaluate(async () => {
    const s = window.__stack, el = document.getElementById('sheet');
    let calls = 0;
    const off = s.onSettled(() => { calls++; });
    const t0 = performance.now();
    s.setLevel(1);
    const target = s.target, half = s.heights[1];
    const done = await s.whenSettled();
    const dt = performance.now() - t0, h = el.getBoundingClientRect().height;
    const t1 = performance.now();
    await s.whenSettled();
    const again = performance.now() - t1;
    await new Promise(r => setTimeout(r, 300));
    off();
    return { target, half, done, dt: Math.round(dt), h: Math.round(h), again: Math.round(again), calls };
  });
  ok(se.target.level === 1 && Math.abs(se.target.height - se.half) <= 1 && se.done.height === se.target.height && Math.abs(se.h - se.target.height) <= 1
    && se.dt >= 200 && se.again < 50 && se.calls === 1,
  `to half: target ${se.target.level}, ${se.target.height} px (half ${se.half}); settled after ${se.dt} ms at ${se.h} px (want the glide's end, ~360 ms), again at once (${se.again} ms); onSettled ${se.calls}x (want 1)`);

  // 16. Hover over a train's drop: its label shows; the mouse away: gone (Max, 2026-11-25: "Hovering over a drop or train
  //     should show it's label"). Further out, where the map leaves many labels out.
  await page.evaluate(() => window.__stack.home(0)); await sleep(600);
  await page.evaluate(() => window.__map.jumpTo({ center: [16, 61], zoom: 5.5, bearing: 0, pitch: 0 })); await sleep(2000);
  const dot = await page.evaluate(() => { const fs = window.__map.queryRenderedFeatures({ layers: ['train-dots'] }).filter(f => !f.properties.point_count);
    for (const f of fs) { const q = window.__map.project(f.geometry.coordinates); if (q.x > 520 && q.x < innerWidth - 80 && q.y > 80 && q.y < innerHeight - 80) return { x: q.x, y: q.y, id: f.properties.id }; } return null; });
  if (dot) {
    await page.mouse.move(dot.x - 40, dot.y - 40); await page.mouse.move(dot.x, dot.y, { steps: 4 }); await sleep(400);
    const on = await page.evaluate(() => { const h = document.querySelector('.near-label.hover'); return h ? h.textContent : null; });
    await page.mouse.move(dot.x + 150, dot.y + 150, { steps: 4 }); await sleep(300);
    const off = await page.evaluate(() => Boolean(document.querySelector('.near-label.hover')));
    ok(on && !off, `hover over a drop: its label "${on}" shows; the mouse away: ${off ? 'still there' : 'gone'}`);
  } else console.log('note no lone drop on screen for the hover step');

  // 17. Pressed and held on the map: the labels go; let go: back (Max, 2026-11-25: "Clicking and holding on map should just
  //     hide all labels when held. Return when released"); a plain click changes nothing
  await page.evaluate(() => window.__map.jumpTo({ center: [18.06, 59.33], zoom: 12 })); await sleep(2000);
  const labelOp = () => page.evaluate(() => ({ held: document.documentElement.classList.contains('labels-held'), text: window.__map.getPaintProperty('station-names', 'text-opacity') }));
  await page.mouse.move(900, 450); await page.mouse.down(); await sleep(400);
  const during = await labelOp();
  await page.mouse.up(); await sleep(200);
  const after2 = await labelOp();
  await page.mouse.click(900, 450); await sleep(100);
  const click = await labelOp();
  ok(during.held && during.text === 0 && !after2.held && after2.text !== 0 && !click.held,
    `held on the map: labels ${during.held ? 'hidden' : 'SHOWN'} (station names' opacity ${JSON.stringify(during.text)}); let go: ${after2.held ? 'still hidden' : 'back'}; a plain click: ${click.held ? 'hid them' : 'nothing'}`);
  // 17b. Two fingers (a pinch) held as long: the labels stay (Max, 2026-11-26: "When zooming with two fingers, dont hide
  //      labels. Only when tapping and holding"); one finger held the same way: they go
  {
    const cdp = await page.createCDPSession();
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    await touch('touchStart', [[860, 450]]); await sleep(30);
    await touch('touchStart', [[860, 450], [960, 450]]);
    await touch('touchMove', [[850, 450], [970, 450]]); await sleep(400);
    const pinch = await labelOp();
    await touch('touchEnd', []); await sleep(200);
    await touch('touchStart', [[900, 450]]); await sleep(400);
    const one = await labelOp();
    await touch('touchEnd', []); await sleep(200);
    await cdp.detach();
    ok(!pinch.held && one.held, `two fingers held: labels ${pinch.held ? 'HIDDEN' : 'kept'}; one finger held: ${one.held ? 'hidden' : 'NOT hidden'}`);
  }

  // 18. A train card with ‹ (opened from a station's board): its top row's buttons end where the boxes under it end (Max,
  //     2026-11-25: "'följer' button not aligned correctly. Maybe bug in whole row?")
  await page.evaluate(() => window.__stack.open('station:Cst', { go: true })); await sleep(2500);
  await page.evaluate(() => document.querySelector('#board .bd-row:not(.gone)')?.click()); await sleep(2500);
  const row = await page.evaluate(() => { const b = document.querySelector('#panel .panel-head > .panel-buttons'), t = document.querySelector('#panel .cd-tiles, #panel .tile');
    return b && t ? { up: Boolean(document.querySelector('#panel .panel-head > .sh-up')?.offsetParent), end: Math.round(b.getBoundingClientRect().right), box: Math.round(t.getBoundingClientRect().right) } : null; });
  ok(row && row.up && Math.abs(row.end - row.box) <= 1, `a train with ‹: its buttons end at ${row?.end} px, the boxes under them at ${row?.box} px`);

  // 19. Settings and the chips' cards open at full, the cards only as tall as they are (Max, 2026-11-26: "Settings should
  //     start expanded on pc"; "clicking stats, saved or disruptions should show them fully expanded. But only as far as
  //     needed. An empty saved should just extend down to the last element")
  const roomUnder = () => page.evaluate(() => {
    const pg = document.querySelector('#sheet .pg:last-child'), g = document.querySelector('#sheet .sh-grab').getBoundingClientRect();
    let end = 0; for (const c of pg.children) if (c.offsetHeight && !c.hasAttribute('data-spacer')) end = Math.max(end, c.getBoundingClientRect().bottom);
    return { level: window.__stack.level, room: Math.round(Math.min(g.top, innerHeight) - end), scrolls: pg.scrollHeight > pg.clientHeight + 1 };
  });
  await toRest(page);
  await openFromMenu(page, 'settings');
  ok(await page.evaluate(() => window.__stack.level) === 2, `Settings opens at ${await page.evaluate(() => window.__stack.level) === 2 ? 'full' : 'half'}`);
  for (const key of ['saved', 'stats']) {
    await toRest(page);
    await openChip(page, key);
    const r = await roomUnder();
    ok(r.level === 2 && (r.scrolls || r.room <= 24), `${key} opens at ${r.level === 2 ? 'full' : `level ${r.level}`}, ${r.scrolls ? 'scrolling (taller than the screen)' : `${r.room} px under its content (want 24 at most)`}`);
  }

  // 20. A group's list ("N trains here", a tap on its label): no more than 24 px under its rows (Max, 2026-11-26:
  //     "Multiple trains card shows too much empty space underneth"; it stood at a page's lowest half, 74 px under 2 rows)
  await toRest(page);
  let group = null;
  for (const zoom of [12, 11, 13]) {
    await page.evaluate(z => window.__map.jumpTo({ center: [18.06, 59.33], zoom: z }), zoom); await sleep(1500);
    const labels = await page.evaluate(() => [...document.querySelectorAll('.near-label.group')].map((e) => { const r = e.getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; })
      .filter(q => q.x > 480 && q.x < innerWidth - 20 && q.y > 70 && q.y < innerHeight - 20));
    for (const g of labels) {
      await toRest(page);
      await page.mouse.click(g.x, g.y); await sleep(1500);
      if (await page.evaluate(() => window.__stack.top().startsWith('pick:'))) { group = await roomUnder(); break; }
    }
    if (group) break;
  }
  if (group) ok(group.room <= 24, `a group's list: ${group.room} px under its rows (want 24 at most)`);
  else console.log('note no group label to tap: not checked');

  // 21. A page closed by ‹ back to Home: the leaving page holds still as it goes (the search bar's row came back above it
  //     and the copy jumped 52 px in one frame) and the search box doesn't move, it fades in where it stands (Max,
  //     2026-11-26: "Dismissing any cards the animation is buggy and jittery with the search pill")
  await toRest(page);
  await page.evaluate(() => window.__stack.open('station:Cst', { go: true })); await sleep(2500);
  await page.evaluate(() => {
    window.__rec = []; const t0 = performance.now();
    const f = () => {
      const g = document.querySelector('#sheet .pg-ghost')?.getBoundingClientRect(), s = document.querySelector('#sheet .sh-search').getBoundingClientRect();
      window.__rec.push({ ghost: g ? Math.round(g.top) : null, search: Math.round(s.top) });
      if (performance.now() - t0 < 600) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await page.click('#sheet .sh-up:not([hidden])'); await sleep(800);
  const rec = await page.evaluate(() => window.__rec);
  const ghostTops = rec.map(r => r.ghost).filter(x => x !== null), searchTops = [...new Set(rec.map(r => r.search))];
  const ghostMove = ghostTops.length ? Math.max(...ghostTops) - Math.min(...ghostTops) : 0;
  ok(ghostTops.length > 0 && ghostMove <= 1 && searchTops.length === 1, `closed by ‹: the leaving page moved ${ghostMove} px (${ghostTops.length} frames seen), the search box stood at ${searchTops.join(', ')} px (want one place)`);

  // 22. A card open, one click on the map's empty ground: closed, Home at rest (Max, 2026-11-26: "a click on the map with a
  //     card open should close it out, not just collapse it in stages"); a station at half and a train's card at full
  for (const [what, open, level] of [['a station at half', () => window.__stack.open('station:Cst', { go: true, fromMap: true }), 1], ['Statistik at full', null, 2]]) {
    await toRest(page);
    if (open) await page.evaluate(open); else await openChip(page, 'stats');
    await sleep(1500);
    await setLevel(page, level);
    const q = await page.evaluate(() => { for (const [x, y] of [[innerWidth - 160, 140], [innerWidth - 260, 220], [innerWidth / 2, 120]]) {
      if (document.elementFromPoint(x, y)?.tagName === 'CANVAS' && !window.__map.queryRenderedFeatures([[x - 20, y - 20], [x + 20, y + 20]]).some(f => f.layer.type === 'symbol' || /train|station/.test(f.layer.id))) return { x, y }; } return null; });
    if (!q) { console.log(`note ${what}: no empty map point to click`); continue; }
    await page.mouse.click(q.x, q.y); await sleep(900);
    const r = await page.evaluate(() => ({ top: window.__stack.top(), level: window.__stack.level }));
    ok(r.top === 'home' && r.level === 0, `${what}, one click on the map: ${r.top} at level ${r.level} (want Home at rest)`);
  }
} finally {
  await browser.close();
}
console.log(failed ? `pc-check: ${failed} failed` : 'pc-check: all ok');
process.exit(failed ? 1 : 0);
