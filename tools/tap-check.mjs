// The tap rules (Max, 2026-11-23: "a lot of FIRST taps did nothing, second closed"; the rules are at the top of
// src/stack.js), on a phone (393 x 851, a finger) and a computer (1500 x 1000, a mouse), on the replay of 17 Nov 16:00
// (CARD_HOUR), with real taps on the map's empty ground, trains and stations:
//   R1  one tap on empty ground always does something visible: the sheet down at least STEP_PX (40 px) to the page's
//       lowest height, or every page closed (Home at rest); never a step back through earlier pages. Max's cases:
//       (a) a train, "to …" picked in its chooser, a tap; (b) the chooser open, a tap (it shuts in that same tap);
//       (c) "Show only" on, a train, a tap; (d) a "2 trains" list, a train from it, taps: never the list again.
//       Also: ☰'s menu open over Home raised, one tap: the menu shut and Home down; the search open, one tap: shut.
//   R2  a tap on a train (☰'s menu open; the chooser open) or a station (a train's page open) opens it at once.
//   R3  "Show only" stays through map taps until its × is tapped; a company under the search's "Show only" sets it.
//   R4  Esc steps back one page (a train from a "2 trains" list: the list); the back chip goes Home.
// And Max's notes of 2026-11-23: 4 a computer's handle is a small ⌃/⌄ arrow (a tap raises the sheet), a phone keeps the
// dash; 5 Home's hint under the lateness colours only with Home at full; 6 rows rounded (hover, focus, press follow
// the corners), their lines between them straight; 7 a train's messages opened at the bottom edge come into view at
// once (the page scrolls), and (live only) the disruptions' "Rail work" fold raises the sheet and lowers it again when
// shut; 8 a tap on the messages row's arrow opens them.
// Not checkable here: a real finger's wobble, a phone's own tap handling (the test browser's taps are exact).
// Run: PAGE=http://localhost:5182/ node tools/tap-check.mjs
import { launch, CARD_HOUR, sleep, PHONE } from './lib/browser.mjs';
import { waitForMap, until, toRest, setLevel, openSearch, openDisruptions } from './lib/screen.mjs';

const PC = { width: 1500, height: 1000, deviceScaleFactor: 1 };
const STEP_PX = 40;
let failed = 0;
const notes = [];
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };

const browser = await launch();
try {
  for (const [dev, size] of [['phone', PHONE], ['pc', PC]]) {
    const p = await waitForMap(browser, { size, replay: CARD_HOUR, lang: 'sv', view: '11/59.33/18.06' });
    await sleep(2000);
    const say = s => `${s.keys}@${s.level} shown ${s.shown}${s.picking ? ' chooser open' : ''}${s.nav ? ' ☰ open' : ''}${s.searching ? ' searching' : ''}`;
    const state = () => p.evaluate(() => ({ keys: window.__stack.keys().join('>'), top: window.__stack.top(), level: window.__stack.level,
      shown: Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-shown'))),
      picking: Boolean(document.querySelector('#panel .cd-pick')), nav: !document.getElementById('nav').hidden, searching: window.__stack.searching,
      filter: document.getElementById('line').dataset.id === 'filter' && !document.getElementById('line').hidden }));
    // a place on the map with nothing to tap within 40 px, clear of the sheet, the line and the map's buttons
    const emptySpot = () => p.evaluate(() => {
      const m = window.__map, wide = innerWidth >= 440, shown = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-shown'));
      const yMax = wide ? innerHeight - 60 : innerHeight - shown - 70;
      for (let y = 110; y < yMax; y += 21) for (let x = wide ? 480 : 30; x < innerWidth - 90; x += 27) {
        const f = m.queryRenderedFeatures([[x - 40, y - 40], [x + 40, y + 40]]).filter(g => /train|station|disruption/.test(g.layer.id));
        if (f.length) continue;
        const ok = [[0, 0], [-30, -30], [30, 30], [-30, 30], [30, -30]].every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy)?.tagName === 'CANVAS');
        if (ok) return { x, y };
      }
      return null;
    });
    const tap = async (pt) => { if (dev === 'phone') await p.touchscreen.tap(pt.x, pt.y); else await p.mouse.click(pt.x, pt.y); await sleep(800); };
    const tapEmpty = async () => { const pt = await emptySpot(); if (!pt) throw new Error('no empty ground on the map to tap'); await tap(pt); };
    // what one map tap did: 'home' (every page closed, Home at rest), 'down' (same page, the sheet 40 px or more lower), else null
    const did = (a, b) => (b.keys === 'home' && b.level === 0 && (a.keys !== 'home' || a.shown - b.shown >= STEP_PX) ? 'home'
      : b.top === a.top && a.shown - b.shown >= STEP_PX ? 'down' : null);
    // taps until Home at rest (at most 3): the pages on top after each
    async function tapsHome() {
      const tops = [];
      for (let i = 0; i < 3; i++) { const s = await state(); if (s.keys === 'home' && s.level === 0) break; await tapEmpty(); tops.push((await state()).top); }
      return tops;
    }
    // a train on the map whose card has the "to …" chooser with another stop to pick (brand: of that company)
    async function openChooserTrain(brand = null) {
      const ids = await p.evaluate(b => window.__trains.reports().map(r => r.id).filter(id => !b || window.__lateness.brand(id) === b), brand);
      for (const id of ids.slice(0, 25)) {
        await p.evaluate(i => window.__stack.open(`train:${i}`), id);
        await until(p, () => Boolean(document.querySelector('#panel .panel-more, #panel .state')), 6000);
        await sleep(400);
        if (await p.evaluate(() => Boolean(document.querySelector('#panel button.cd-stop')))) { await sleep(900); return id; }
      }
      return null;
    }
    const openChooser = async () => { await p.evaluate(() => { if (!document.querySelector('#panel .cd-pick')) document.querySelector('#panel button.cd-stop')?.click(); }); await sleep(700); };

    // ---- R1 (a): a stop picked in the chooser, then one tap ----
    await toRest(p);
    const ta = await openChooserTrain();
    if (!ta) ok(false, `${dev} R1a: no train with a "to …" chooser found`);
    else {
      await openChooser();
      const picked = await p.evaluate(() => { const r = document.querySelector('#panel .cd-row:not(.on)'); r?.click(); return r?.querySelector('b')?.textContent ?? null; });
      await sleep(1200);
      const a0 = await state();
      await tapEmpty();
      const a1 = await state();
      // (a computer's card rests whole, its low is its half: nothing to lower, the tap closes it)
      ok(dev === 'pc' ? did(a0, a1) === 'home' : Boolean(did(a0, a1)) && a1.level === 0, `${dev} R1a: "till ${picked}" picked, one map tap: ${say(a0)} -> ${say(a1)} (want ${dev === 'pc' ? 'it closed' : `the card down ${STEP_PX} px or more to its lowest, or closed`})`);
      const rest = await tapsHome();
      ok(rest.length <= 1 && (await state()).keys === 'home', `${dev} R1a: then Home at rest in ${rest.length} more tap(s) (${rest.join(', ') || '-'})`);
    }

    // ---- R1 (b): the chooser open, one tap: it shuts in the same tap, and the sheet moves or closes ----
    await toRest(p);
    if (await openChooserTrain()) {
      await openChooser();
      const b0 = await state();
      await tapEmpty();
      const b1 = await state();
      ok(b0.picking && !b1.picking && Boolean(did(b0, b1)), `${dev} R1b: the chooser open, one map tap: ${say(b0)} -> ${say(b1)} (want the chooser shut and the card down or closed)`);
      await tapsHome();
    }

    // ---- R3 + R1 (c): "Show only" from the search's chips, a train of that company, taps ----
    await toRest(p);
    await openSearch(p);
    const chips = await p.evaluate(() => [...document.querySelectorAll('#search-results .scopes .chip')].map(c => c.dataset.go));
    ok(chips.length > 0 && chips.every(k => k.startsWith('co:')), `${dev} R3: the search's "Show only" lists only companies (${chips.length}: ${chips.filter(k => !k.startsWith('co:')).join(', ') || 'no other'})`);
    const co = chips[0]?.slice(3);
    await p.evaluate(() => document.querySelector('#search-results .scopes .chip')?.click());
    await sleep(900);
    const c0 = await state();
    ok(c0.filter && c0.top === `co:${co}`, `${dev} R3: the chip "${co}" sets its filter (line above the bar ${c0.filter ? 'shown' : 'not shown'}) and opens its page (${c0.top})`);
    await toRest(p);
    const tc = await openChooserTrain(co);
    if (!tc) notes.push(`${dev} R1c: no ${co} train with a chooser (not checked)`);
    else {
      const c1 = await state();
      await tapEmpty();
      const c2 = await state();
      ok(dev === 'pc' ? did(c1, c2) === 'home' : Boolean(did(c1, c2)) && c2.level === 0, `${dev} R1c: "Show only" ${co} on, its train open, one map tap: ${say(c1)} -> ${say(c2)}`);
      await tapsHome();
    }
    const c3 = await state();
    ok(c3.filter, `${dev} R3: "Show only" still on after the map taps (line ${c3.filter ? 'shown' : 'gone'})`);
    await p.evaluate(() => document.querySelector('#line .line-x')?.click());
    await sleep(400);
    ok(!(await state()).filter, `${dev} R3: its × clears it`);

    // ---- R1 (d): a "2 trains" list, a train from it, taps: the card closes, never back to the list ----
    await toRest(p);
    const openPickTrain = async () => {
      await p.evaluate(() => { const ids = window.__trains.reports().map(r => r.id).slice(0, 2); window.__picker(ids.map((id, i) => ({ id, label: String(2200 + i), company: 'Test' }))); });
      await sleep(900);
      await p.evaluate(() => document.querySelector('#picker [data-i]')?.click());
      await until(p, () => window.__stack.top()?.startsWith('train:'), 4000);
      await sleep(1500);
    };
    await openPickTrain();
    const d0 = await state();
    const dTops = await tapsHome();
    const d1 = await state();
    ok(d0.keys.includes('pick:') && d0.top.startsWith('train:') && !dTops.some(k => k?.startsWith('pick:')) && d1.keys === 'home' && (dev === 'phone' || dTops.length === 1),
      `${dev} R1d: ${d0.keys}, map taps: ${dTops.join(' -> ')} (want Home${dev === 'pc' ? ' in one tap' : ''}, never the list again)`);

    // ---- R4: Esc one page back (the list), the chip home ----
    await toRest(p);
    await openPickTrain();
    await p.keyboard.press('Escape');
    await sleep(600);
    const e1 = await state();
    ok(e1.top?.startsWith('pick:'), `${dev} R4: Esc over a train from a list: ${e1.keys} (want the list)`);
    await p.evaluate(() => document.querySelector('#picker [data-i]')?.click());
    await sleep(1200);
    await p.evaluate(() => document.querySelector('#sheet .sh-back').click());
    await sleep(600);
    ok((await state()).keys === 'home', `${dev} R4: the back chip: ${(await state()).keys} (want Home)`);

    // ---- R1 with ☰'s menu open, and with the search open (a computer: the map is free beside the sheet) ----
    await toRest(p);
    await setLevel(p, 1);
    await p.click('#nav-button');
    await sleep(400);
    const n0 = await state();
    await tapEmpty();
    const n1 = await state();
    ok(n0.nav && !n1.nav && n1.level === 0, `${dev} R1: ☰ open over Home raised, one map tap: ${say(n0)} -> ${say(n1)} (want the menu shut and Home down)`);
    if (dev === 'pc') {
      await openSearch(p);
      const s0 = await state();
      await tapEmpty();
      const s1 = await state();
      ok(s0.searching && !s1.searching && s1.level === 0, `${dev} R1: the search open, one map tap: ${say(s0)} -> ${say(s1)}`);
    }

    // ---- R2: a train tapped with ☰ open; a station and a train tapped with a card's chooser open ----
    const resetView = async () => { await p.evaluate(() => window.__map.jumpTo({ center: [18.06, 59.33], zoom: 11 })); await sleep(1200); };
    // a train dot with no other train near, clear of the sheet (not: exclude); its tap opens it, or its "N trains" list
    const loneTrain = exclude => p.evaluate((ex) => {
      const m = window.__map, wide = innerWidth >= 440, shown = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-shown'));
      for (const f of m.queryRenderedFeatures({ layers: ['train-dots'] })) {
        if (f.properties.id === ex) continue;
        const q = m.project(f.geometry.coordinates);
        if (q.y < 90 || q.x < (wide ? 480 : 20) || q.x > innerWidth - 90 || q.y > (wide ? innerHeight - 40 : innerHeight - shown - 50)) continue;
        if (m.queryRenderedFeatures([[q.x - 30, q.y - 30], [q.x + 30, q.y + 30]], { layers: ['train-dots'] }).length !== 1) continue;
        if (m.queryRenderedFeatures([[q.x - 20, q.y - 20], [q.x + 20, q.y + 20]], { layers: ['station-dots', 'station-names'] }).length) continue;
        if (document.elementFromPoint(q.x, q.y)?.tagName !== 'CANVAS') continue;
        return { id: f.properties.id, x: q.x, y: q.y };
      }
      return null;
    }, exclude ?? null);
    await toRest(p);
    await resetView();
    await p.click('#nav-button');
    await sleep(400);
    const lt = await loneTrain();
    if (!lt) notes.push(`${dev} R2: no lone train to tap with ☰ open (not checked)`);
    else {
      await tap(lt);
      const r1 = await state();
      ok(/^(train|pick):/.test(r1.top ?? ''), `${dev} R2: ☰ open, one tap on a train: ${say(r1)} (want its page at once)`);
    }
    await toRest(p);
    await resetView();
    const tr2 = await openChooserTrain();
    if (tr2) {
      await openChooser();
      await sleep(600);
      // a station (zoom 11: drawn), clear of trains and the sheet
      const st = await p.evaluate(() => {
        const m = window.__map, wide = innerWidth >= 440, shown = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-shown'));
        for (const f of m.queryRenderedFeatures({ layers: ['station-dots'] })) {
          const q = m.project(f.geometry.coordinates);
          if (q.y < 90 || q.x < (wide ? 480 : 20) || q.x > innerWidth - 90 || q.y > (wide ? innerHeight - 40 : innerHeight - shown - 50)) continue;
          if (m.queryRenderedFeatures([[q.x - 18, q.y - 18], [q.x + 18, q.y + 18]], { layers: ['train-dots'] }).length) continue;
          if (m.queryRenderedFeatures([[q.x - 5, q.y - 5], [q.x + 5, q.y + 5]], { layers: ['train-labels'] }).length) continue;
          if (document.elementFromPoint(q.x, q.y)?.tagName !== 'CANVAS') continue;
          return { sig: f.properties.sig, x: q.x, y: q.y };
        }
        return null;
      });
      if (!st) notes.push(`${dev} R2: no station clear of trains to tap (not checked; ${await p.evaluate(() => window.__map.queryRenderedFeatures({ layers: ['station-dots'] }).length)} station dots drawn)`);
      else {
        const before = await state();
        await tap(st);
        const r2 = await state();
        ok(r2.top === `station:${st.sig}`, `${dev} R2: ${say(before)}, one tap on station ${st.sig}: ${say(r2)} (want its board at once)`);
      }
      await toRest(p);
      await openChooserTrain();
      await openChooser();
      const other = await loneTrain(await p.evaluate(() => window.__stack.top().slice(6)));
      if (other) {
        await tap(other);
        const r3 = await state();
        ok(r3.top === `train:${other.id}` || Boolean(r3.top?.startsWith('pick:')), `${dev} R2: the chooser open, one tap on another train: ${say(r3)} (want its page at once)`);
      } else notes.push(`${dev} R2: no other lone train to tap (not checked)`);
    }

    // ---- 4: the handle on a computer is an arrow; a phone keeps the dash ----
    await toRest(p);
    await sleep(500);   // (the arrow's turn ended)
    const grab = () => p.evaluate(() => {
      const g = document.querySelector('#sheet .sh-grab'), i = g.querySelector('i'), a = g.querySelector('.sh-arrow');
      const r = (a && a.offsetParent ? a : g).getBoundingClientRect();
      return { dash: Boolean(i?.offsetParent), arrow: Boolean(a?.offsetParent), turn: a ? getComputedStyle(a).transform : 'none', x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const g0 = await grab();
    if (dev === 'pc') {
      ok(!g0.dash && g0.arrow && g0.turn !== 'none' && !/matrix(1, 0, 0, 1/.test(g0.turn), `pc 4: at rest the handle is an arrow pointing down: the sheet hangs from the top (dash ${g0.dash}, arrow ${g0.arrow}, ${g0.turn})`);
      await p.mouse.click(g0.x, g0.y);
      await sleep(700);
      const g1 = await grab(), l1 = (await state()).level;
      ok(l1 > 0 && (g1.turn === 'none' || /matrix(1, 0, 0, 1/.test(g1.turn)), `pc 4: a click on the arrow lowers the sheet's edge (level ${l1}) and it points up (${g1.turn})`);
    } else ok(g0.dash && !g0.arrow, `phone 4: the handle is the dash (dash ${g0.dash}, arrow ${g0.arrow})`);

    // ---- 5: Home's hint only at full ----
    const hint = [];
    for (const l of [0, 1, 2]) { await setLevel(p, l); await sleep(300); hint.push(await p.evaluate(() => Boolean(document.querySelector('#sheet .pg[data-key="home"] .lg-hint')?.offsetParent))); }
    ok(!hint[0] && !hint[1] && hint[2], `${dev} 5: Home's hint shown at rest/half/full: ${hint.join('/')} (want false/false/true)`);

    // ---- 6: rows rounded, the lines between them straight ----
    await setLevel(p, 2);
    const shape = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('#sheet .pg[data-key="home"] .rows > .row')].filter(r => r.offsetParent);
      const two = rows.find(r => r.previousElementSibling?.classList.contains('row'));
      return { n: rows.length, radius: rows.map(r => parseFloat(getComputedStyle(r).borderTopLeftRadius)), border: rows.map(r => getComputedStyle(r).borderTopColor),
        line: two ? getComputedStyle(two, '::before').borderTopWidth : null };
    });
    ok(shape.n > 0 && shape.radius.every(r => r >= 8), `${dev} 6: Home's rows rounded (${shape.n} rows, radii ${[...new Set(shape.radius)].join(', ')} px)`);
    ok(shape.line === null || shape.line === '1px', `${dev} 6: the line between two rows still drawn (${shape.line ?? 'no two rows'})`);
    await p.evaluate(() => { const ids = window.__trains.reports().map(r => r.id).slice(0, 2); window.__picker(ids.map((id, i) => ({ id, label: String(2200 + i), company: 'Test' }))); });
    await sleep(800);
    const pr = await p.evaluate(() => [...document.querySelectorAll('#picker .pick-list button')].map(b => parseFloat(getComputedStyle(b).borderTopLeftRadius)));
    ok(pr.length > 0 && pr.every(r => r >= 8), `${dev} 6: the "2 trains" list's rows rounded (${pr.join(', ')} px)`);

    // ---- 7, 8: a train's messages, opened by a tap on the row's arrow at the bottom edge of the page at full ----
    await toRest(p);
    let nt = null;
    for (const id of (await p.evaluate(() => window.__trains.reports().map(r => r.id))).slice(0, 60)) {
      await p.evaluate(i => window.__stack.open(`train:${i}`), id);
      await until(p, () => Boolean(document.querySelector('#panel .panel-more, #panel .state')), 6000);
      await sleep(250);
      if (await p.evaluate(() => Boolean(document.querySelector('#panel .tv-box')))) { nt = id; break; }
    }
    if (!nt) notes.push(`${dev} 7/8: no train with messages (not checked)`);
    else {
      // (a short screen: the messages' row near the bottom edge of the page at full)
      await p.setViewport({ ...size, height: dev === 'pc' ? 470 : 560 });
      await sleep(800);
      await setLevel(p, 2);
      await sleep(600);
      // (folded first: open or folded is remembered on the device)
      if (await p.evaluate(() => document.querySelector('#panel .tv-box')?.classList.contains('open'))) { await p.evaluate(() => document.querySelector('#panel .tv-fold').click()); await sleep(500); }
      // the messages' row at the bottom of what is shown
      const row = await p.evaluate(() => {
        const pg = document.querySelector('#panel').closest('.pg'), b = document.querySelector('#panel .tv-toggle');
        const view = pg.getBoundingClientRect(), shownBottom = Math.min(view.bottom, innerHeight);
        pg.scrollTop += b.getBoundingClientRect().bottom - (shownBottom - 44);
        const r = b.getBoundingClientRect(), a = [...b.querySelectorAll('.icon')].at(-1).getBoundingClientRect();
        return { open: b.getAttribute('aria-expanded'), x: a.x + a.width / 2, y: a.y + a.height / 2, bottom: r.bottom, scroll: pg.scrollTop };
      });
      await sleep(300);
      await tap(row);
      await sleep(600);
      const after = await p.evaluate(() => {
        const pg = document.querySelector('#panel').closest('.pg'), box = document.querySelector('#panel .tv-box');
        const view = pg.getBoundingClientRect(), r = box?.getBoundingClientRect();
        return { open: box?.classList.contains('open'), start: r ? Math.round(r.top) : null, end: r ? Math.round(r.bottom) : null, top: Math.round(view.top), view: Math.round(Math.min(view.bottom, innerHeight)) };
      });
      ok(row.open === 'false' && after.open, `${dev} 8: a tap on the messages row's arrow opens them (${row.open} -> ${after.open})`);
      // all of them in view, or (more than the page shows) scrolled up to their start
      ok(after.open && after.end !== null && (after.end <= after.view - 10 || after.start <= after.top + 40), `${dev} 7: the opened messages come into view at once (${after.start}-${after.end}, the page shows ${after.top}-${after.view})`);
      await p.evaluate(() => { const b = document.querySelector('#panel .tv-fold'); b?.click(); });
      await sleep(400);
      await p.setViewport(size);
      await sleep(800);
    }
    await toRest(p);
    if (p.errors.length) ok(false, `${dev} page errors: ${p.errors.slice(0, 3).join(' | ')}`);
    await p.close();
  }

  // ---- 7 (live only): the disruptions' "Rail work" fold at half: the sheet rises to show it, and goes back when shut ----
  const live = await waitForMap(browser, { size: PHONE, lang: 'sv', wait: 20000 });
  await live.evaluate(() => { try { localStorage.setItem('railWorksOpen', 'false'); } catch { /* */ } });
  if (!(await openDisruptions(live, { wait: 30000 }))) notes.push('7: no disruptions live (the Rail work fold not checked)');
  else {
    const L = '#sheet .pg[data-key="dislist"]';
    await live.evaluate(L => { const f = document.querySelector(`${L} .dis-fold`); if (f?.getAttribute('aria-expanded') === 'true') f.click(); }, L);
    await setLevel(live, 1);
    await sleep(500);
    const has = await live.evaluate(L => Boolean(document.querySelector(`${L} .dis-fold`)), L);
    if (!has) notes.push('7: no rail work live (the fold not checked)');
    else {
      const l0 = await live.evaluate(() => window.__stack.level);
      await live.evaluate(L => document.querySelector(`${L} .dis-fold`).click(), L);
      await sleep(900);
      const shownOpen = await live.evaluate((L) => {
        const rows = [...document.querySelectorAll(`${L} .dis-works .dis-row`)];
        const sheetTop = document.getElementById('sheet').getBoundingClientRect().top;
        return { level: window.__stack.level, firstEnd: rows[0] ? Math.round(rows[0].getBoundingClientRect().bottom) : null, screen: innerHeight, sheetTop: Math.round(sheetTop) };
      }, L);
      ok(shownOpen.firstEnd !== null && shownOpen.firstEnd <= shownOpen.screen - 30, `phone 7: "Banarbeten" opened at half: its first row ends at ${shownOpen.firstEnd} of ${shownOpen.screen} (level ${l0} -> ${shownOpen.level})`);
      await live.evaluate(L => document.querySelector(`${L} .dis-fold`).click(), L);
      await sleep(900);
      const l2 = await live.evaluate(() => window.__stack.level);
      ok(l2 === l0, `phone 7: shut again, the sheet back to level ${l0} (now ${l2})`);
    }
  }
  await live.close();
} finally { await browser.close(); }
for (const n of notes) console.log(`note ${n}`);
console.log(failed ? `tap-check FAILED: ${failed}` : 'tap-check ok');
process.exit(failed ? 1 : 0);
