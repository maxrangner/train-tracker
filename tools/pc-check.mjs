// The page on a computer's screen (1500 x 1000, a mouse; Max's PC notes of 2026-11-23), on the replay of 17 Nov
// 16:00 (CARD_HOUR):
// - the map always drags: pulling the sheet up with the mouse by Home's text leaves no text selected; a selection left
//   on the page is cleared by a press on the map, which then moves; the browser's own drag of a picture never starts
//   on the map (a press on selected content dragged a ghost picture instead of the map, and "live" showed highlighted);
// - with Home raised (half, full) the map's buttons and the live mark stay shown.
// Not checkable here: the browser's own drag-and-drop of a selection (this test browser makes none), a real mouse.
// Run: PAGE=http://localhost:5181/ node tools/pc-check.mjs
import { launch, CARD_HOUR, sleep } from './lib/browser.mjs';
import { waitForMap, setLevel } from './lib/screen.mjs';

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

  // 1. Home pulled up by its text with the mouse (up and to the right, over the map)
  await setLevel(page, 1);
  const at = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#sheet .pg p, #sheet .pg h2, #sheet .pg h3')].find(e => e.offsetParent && e.getBoundingClientRect().top > 0 && e.textContent.trim());
    const r = el.getBoundingClientRect();
    return { x: r.x + 20, y: r.y + r.height / 2 };
  });
  await mouseDrag(at.x, at.y, 600, 380);   // (down: on a computer the sheet hangs from the top, 2026-11-23)
  ok(await page.evaluate(() => window.__stack.level) > 1, 'a mouse pull by Home\'s text raises the sheet');
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

  // 4. Home raised: the map's buttons and the live mark stay (the sheet floats at the left and covers neither)
  for (const level of [1, 2]) {
    await setLevel(page, level);
    await sleep(300);
    // (the buttons' corner box takes no presses by design, its buttons do; the live mark is fixed: no offsetParent)
    const seen = await page.evaluate(() => Object.fromEntries([['the map buttons', '.maplibregl-ctrl-bottom-right'], ['the live mark', '#status']].map(([name, sel]) => {
      const el = document.querySelector(sel), cs = el && getComputedStyle(el);
      const press = el && getComputedStyle(el.querySelector('.maplibregl-ctrl') ?? el).pointerEvents;
      return [name, Boolean(el && el.getClientRects().length && cs.opacity === '1' && cs.visibility !== 'hidden' && press !== 'none')];
    })));
    for (const [name, shown] of Object.entries(seen)) ok(shown, `${name} shown with Home at ${level === 2 ? 'full' : 'half'}`);
  }

  // 5. a row's edge pressed at hand speed (Max, 2026-11-24: the › on a saved trip "Still doesn't do anything": a held
  //    press shrank the row, the release was beside it); and pressed, then moved off it: no click
  await page.evaluate(() => localStorage.setItem('favourites', JSON.stringify({ stations: [], trains: [], trips: [{ key: 'Cst>G>Mc', from: 'Cst', via: 'G', to: 'Mc' }], changes: [] })));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stack?.top?.() === 'home' && document.querySelector('#sheet .trip-row'), { timeout: 30000 });
  await sleep(2000);
  const edge = async () => {
    await page.evaluate(() => window.__stack.home(1)); await sleep(1200);
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
  ok(stayed === 'home', `pressed on the row, moved off it and let go: no click (${stayed})`);

  // 6. ☰: its choices as buttons where the search field was, on its row (Max, 2026-11-24: "Place the buttons where the
  //    search bar is! And same dismiss rules"); the page behind holds still (a wheel over it moves nothing); a choice
  //    opens its page, the menu goes
  await page.evaluate(() => window.__stack.home(1)); await sleep(1200);
  await page.evaluate(() => document.getElementById('nav-button')?.click()); await sleep(700);
  const menu = await page.evaluate(() => { const n = document.querySelector('.sh-search > .sh-menu'), b = document.getElementById('nav-button').getBoundingClientRect(); if (!n || n.hidden) return null;
    const r = n.getBoundingClientRect(); return { sameRow: Math.abs(r.top - b.top) <= 1, field: Boolean(document.querySelector('#sheet .sh-field').offsetParent), rows: n.querySelectorAll('.nav-row').length }; });
  ok(menu && menu.rows === 3 && menu.sameRow && !menu.field, `☰: ${menu?.rows} buttons on the search bar's row (${menu?.sameRow}), the field away (${menu ? !menu.field : '?'})`);
  const still = await page.evaluate(() => ({ lvl: window.__stack.level, top: document.querySelector('.pg[data-key="home"]').scrollTop }));
  const over = await page.evaluate(() => { const r = document.querySelector('.pg[data-key="home"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 120 }; });
  await page.mouse.move(over.x, over.y); await page.mouse.wheel({ deltaY: 400 }); await sleep(700);
  const still2 = await page.evaluate(() => ({ lvl: window.__stack.level, top: document.querySelector('.pg[data-key="home"]').scrollTop }));
  ok(still2.lvl === still.lvl && still2.top === still.top, `the menu open, a wheel over the page: height ${still.lvl} -> ${still2.lvl}, scrolled ${still.top} -> ${still2.top} (want nothing)`);
  await page.evaluate(() => document.getElementById('open-settings').click()); await sleep(1200);
  const after = await page.evaluate(() => ({ top: window.__stack.top(), open: !document.querySelector('.sh-search > .sh-menu').hidden }));
  ok(after.top === 'page:settings' && !after.open, `a choice opens its page (${after.top}), the menu goes (${after.open ? 'still open' : 'shut'})`);
  await page.evaluate(() => window.__stack.home(0)); await sleep(800);
  await page.keyboard.press('Escape'); await sleep(300);

  // 7. Home at full, its arrow clicked: one step down to half, then rest (Max, 2026-11-24: "it should compact, not close it")
  await page.evaluate(() => window.__stack.home(2)); await sleep(1200);
  const arrow = async () => { const r = await page.evaluate(() => { const b = document.querySelector('#sheet .sh-grab').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    await page.mouse.click(r.x, r.y); await sleep(900); return page.evaluate(() => window.__stack.level); };
  const l1 = await arrow();
  // (at half the arrow points where a click goes: ⌄ more below shows full again, ⌃ goes to rest)
  const next = await page.evaluate(() => document.getElementById('sheet').dataset.next), l2 = await arrow();
  ok(l1 === 1 && l2 === (next === 'more' ? 2 : 0), `Home at full, the arrow clicked: height ${l1} (want half); again, its arrow "${next}": height ${l2}`);

  // 8. The arrow's band at the sheet's bottom: as much room above the arrow as under it, at rest and at half (Max,
  //    2026-11-24: "'Mer v' still too close to the edge")
  for (const lvl of [0, 1]) {
    await page.evaluate(l => window.__stack.home(l), lvl); await sleep(1300);
    const m = await page.evaluate(() => { const g = document.querySelector('#sheet .sh-grab').getBoundingClientRect(), a = document.querySelector('#sheet .sh-arrow').getBoundingClientRect(), s = document.getElementById('sheet').getBoundingClientRect();
      return { above: Math.round(a.top - g.top), below: Math.round(s.bottom - a.bottom) }; });
    ok(Math.abs(m.above - m.below) <= 2 && m.below >= 5, `Home at ${lvl ? 'half' : 'rest'}: the arrow ${m.above} px under its band's top, ${m.below} px over the sheet's bottom`);
  }
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
  //     "shows a black background under it ... Also changes width. This was fixed once before. Why back?"): Home at
  //     full, the browser's bar takes no room, ours shows; dragging it scrolls the page, the page as wide as before;
  //     at half no bar (the page doesn't scroll there)
  await page.evaluate(() => window.__stack.home(2)); await sleep(1300);
  const sb = () => page.evaluate(() => { const pg = document.querySelector('#sheet .pg[data-key="home"]'), bar = document.querySelector('#sheet .sh-pages > .sb'), th = bar?.querySelector('.sb-thumb')?.getBoundingClientRect();
    return { native: pg.offsetWidth - pg.clientWidth, w: pg.clientWidth, can: pg.scrollHeight - pg.clientHeight, top: pg.scrollTop, shown: Boolean(bar && !bar.hidden && bar.offsetHeight),
      th: th ? { x: th.x + th.width / 2, y: th.y + th.height / 2 } : null }; });
  const s0 = await sb();
  if (s0.can > 4) {
    ok(s0.native === 0 && s0.shown && s0.th, `Home at full: the browser's bar ${s0.native} px (want 0), ours ${s0.shown ? 'shown' : 'missing'}`);
    if (s0.th) {
      await page.mouse.move(s0.th.x, s0.th.y); await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(s0.th.x, s0.th.y + i * 12); await sleep(16); }
      await page.mouse.up(); await sleep(300);
      const s1 = await sb();
      ok(s1.top > s0.top + 20 && s1.w === s0.w && s1.native === 0, `our bar dragged 120 px: the page scrolled ${s0.top} -> ${s1.top}, its width ${s0.w} -> ${s1.w}, the browser's bar ${s1.native} px`);
    }
  } else console.log(`note Home at full doesn't scroll now (${s0.can} px more): the bar not checked`);
  await page.evaluate(() => window.__stack.home(1)); await sleep(1300);
  const s2 = await sb();
  ok(!s2.shown, `Home at half: no bar (${s2.shown ? 'shown' : 'none'})`);

  // 13. Home's filter: the companies and "N more" on one row (Max, 2026-11-25: "Filter operators including 'n till' should
  //     only be one row"); the count says what is left out
  const co = await page.evaluate(() => { const box = document.querySelector('#sheet .co-filter'); if (!box) return null;
    const shown = [...box.children].filter(c => !c.hidden && c.offsetHeight), more = box.querySelector('.co-more');
    return { rows: new Set(shown.map(c => c.offsetTop)).size, chips: shown.filter(c => c.matches('.co-f')).length, total: Number(box.dataset.total), more: more && !more.hidden ? more.textContent.trim() : '' }; });
  ok(co && co.rows === 1 && (co.total - co.chips === 0 ? !co.more : co.more.startsWith(String(co.total - co.chips))),
    `the filter's companies: ${co?.rows} row(s), ${co?.chips} of ${co?.total} shown, "${co?.more}"`);
} finally {
  await browser.close();
}
console.log(failed ? `pc-check: ${failed} failed` : 'pc-check: all ok');
process.exit(failed ? 1 : 0);
