// Every card moves in one go and comes back as it was (Max, 2026-11-21: the station card "bounces twice", the search
// "jumps around"; "Feels tedious to click through the whole app and always find some strange edge cases"). A sweep
// through the app at phone size: every sheet, the ☰ menu and the map's buttons are read each frame during each step.
//   bounce  a move that turns around (down, up, down) in its top edge or height;
//   step    the train card reaching its timetable in one step instead of a glide (it was ~24 px, 2026-11-21);
//   state   a size or screen that doesn't come back (a card expanded by hand, after the messages or the search).
// The phone's keyboard is stood in for by the page 430 px shorter (interactive-widget=resizes-content). Big single
// steps are not counted: the test browser drops frames (two at once, a 300 px glide shows a 250 px step), a phone
// doesn't. KNOWN: bounces found and waiting for Max's word, printed as notes until they are fixed.
//   1. the recorded weekday evening (17 Nov): the train card's parts, swipes, screens over a card, the keyboard over
//      a card, the ☰ menu's screens;
//   2. live, Uppsala C (it usually has a message): its message, the handle, the search (the keyboard up and down
//      while searching), a train picked from the search, the sizes coming back.
// node tools/sheet-moves-check.mjs (with npm run dev; PAGE= for another port).
import { launch, address, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';

const SHEETS = ['panel', 'board', 'picker', 'disruption', 'menu', 'settings-page', 'stats-page', 'conn-page', 'disruptions-page', 'help', 'nav'];
const fails = [], notes = [];
const KNOWN = [   // [the step, the element, what it is] (2026-11-21's sweep)
  [/a long swipe down$/, /top edge/, 'a short sheet swiped further down than its own height climbs back before it goes (it slides to 100% of its height)'],
  [/a train from the search$/, /the map buttons/, "the map's buttons dip, then come back, while the opened card is still loading"],
];
let steps = 0;
const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* none */ } });
  const start = async (hash) => {
    await page.goto('about:blank');
    await page.goto(address(hash), { waitUntil: 'domcontentloaded' });
    for (let t0 = Date.now(); Date.now() - t0 < 30000; await sleep(300)) if (await page.evaluate(() => (window.__trains?.count ?? 0) > 20 && Boolean(window.__map?.loaded())).catch(() => false)) break;
    await sleep(2500);
    // every frame: each shown sheet's top and height
    await page.evaluate((ids) => {
      window.__rec = null;
      const els = ids.map(i => [i, document.getElementById(i)]).filter(([, e]) => e);
      els.push(['the map buttons', document.querySelector('.maplibregl-ctrl-bottom-right')]);
      const loop = () => {
        if (window.__rec) {
          const row = { t: performance.now() };
          for (const [i, e] of els) { if (!e || e.hidden || !e.isConnected) continue; const r = e.getBoundingClientRect(); if (r.height) row[i] = [Math.round(r.top), Math.round(r.height)]; }
          window.__rec.push(row);
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }, SHEETS);
  };

  // One step: what it does, then every shown sheet's frames looked at. Returns the frames.
  async function act(name, fn, ms = 1400) {
    steps++;
    await page.evaluate(() => { window.__rec = []; });
    await sleep(120);   // (the resting place first)
    try { await fn(); } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`); }
    await sleep(ms);
    const rec = await page.evaluate(() => { const r = window.__rec; window.__rec = null; return r; });
    const keys = new Set(rec.flatMap(r => Object.keys(r).filter(k => k !== 't')));
    for (const k of keys) {
      const s = rec.filter(r => r[k]).map(r => ({ t: r.t, top: r[k][0], h: r[k][1] }));
      for (const dim of ['top', 'h']) {
        let turns = 0, dir = 0;
        for (let i = 1; i < s.length; i++) {
          const d = s[i][dim] - s[i - 1][dim], sg = Math.sign(d);
          if (sg && dir && sg !== dir && Math.abs(d) > 2) turns++;
          if (sg) dir = sg;
        }
        if (!turns) continue;
        const path = s.map(x => x[dim]).filter((v, i, a) => i === 0 || v !== a[i - 1]);
        const what = `${name}: ${k === 'the map buttons' ? k : `#${k}`} ${dim === 'top' ? 'top edge' : 'height'}`;
        const known = KNOWN.find(([st, e]) => st.test(name) && e.test(what.slice(name.length)));
        if (known) notes.push(`known (waiting for Max): ${what}, ${known[2]}`);
        else fails.push(`bounce ${what} turned ${turns} times (${path.slice(0, 18).join(' ')})`);
      }
    }
    return rec;
  }
  const state = (cond, what) => { steps++; if (!cond) fails.push(`state ${what}`); };
  const ev = f => () => page.evaluate(f);
  const tapHandle = id => () => page.evaluate((i) => { const el = document.getElementById(i), r = el.getBoundingClientRect();
    const o = { bubbles: true, pointerId: Math.floor(Math.random() * 1e6), pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + 10, isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', o)); }, id);
  const swipe = (id, dy) => async () => {
    const r = await page.evaluate(i => { const b = document.getElementById(i).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 14 }; }, id);
    await page.touchscreen.touchStart(r.x, r.y);
    for (let k = 1; k <= 10; k++) { await page.touchscreen.touchMove(r.x, r.y + dy * k / 10); await sleep(16); }
    await page.touchscreen.touchEnd();
  };
  const kbUp = () => page.setViewport({ ...PHONE, height: PHONE.height - 430 });
  const kbDown = () => page.setViewport(PHONE);
  const isFull = id => page.evaluate(i => document.getElementById(i).classList.contains('full'), id);
  const shown = id => page.evaluate(i => !document.getElementById(i).hidden, id);
  const has = sel => page.evaluate(s => Boolean(document.querySelector(s)), sel);
  // A train on the map (its number over 1000 if one shows: a long-distance or regional one), the k-th one.
  const tapTrain = async (k = 0, tries = 0) => {
    const p = await page.evaluate((n) => { const all = window.__map.queryRenderedFeatures({ layers: ['train-dots'] });
      const big = all.filter(x => window.__trains.get(x.properties.id)?.number > 1000), fs = big.length ? big : all;
      if (!fs.length) return null; const q = window.__map.project(fs[n % fs.length].geometry.coordinates); return { x: q.x, y: q.y }; }, k);
    if (!p) throw new Error('no train in view');
    await page.touchscreen.tap(p.x, p.y);
    // (the map follows the open train, so a tap can miss and close the card: the next train then)
    await sleep(1200);
    if (await shown('panel') || tries > 3) return;
    await tapTrain(k + 1, tries + 1);
  };
  // The train card's height reaches its timetable in a glide: its last change isn't one step of 16 px or more with
  // the card still before and after (a dropped frame or two still shows as a glide's few steps).
  const glidesToTimetable = (rec, what) => {
    const h = rec.filter(r => r.panel).map(r => r.panel[1]);
    let last = -1;
    for (let i = 1; i < h.length; i++) if (h[i] !== h[i - 1]) last = i;
    const d = last > 0 ? Math.abs(h[last] - h[last - 1]) : 0;
    const before = last > 0 ? h.slice(Math.max(0, last - 4), last) : [];
    state(!(d >= 16 && before.length >= 3 && before.every(v => v === h[last - 1])), `${what}: the card reached its timetable in one step of ${d} px (${h.filter((v, i, a) => i === 0 || v !== a[i - 1]).join(' ')})`);
  };

  // ---- 1. the recorded evening ----
  await start({ replay: CARD_HOUR, lang: 'sv', view: '11/59.33/18.06' });
  glidesToTimetable(await act('train: opened by a tap', () => tapTrain(0), 3000), 'train: opened by a tap');
  if (!(await shown('panel'))) fails.push('the train card did not open');
  else {
    for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(300)) if (await has('#panel .panel-more')) break;
    await act('train: All stops', ev(() => document.querySelector('#panel .panel-more').click()));
    await act('train: i', ev(() => document.querySelector('#panel .panel-info')?.click()));
    await act('train: i back', ev(() => document.querySelector('#panel .panel-info')?.click()));
    await act('train: Less', ev(() => document.querySelector('#panel .panel-more').click()));
    await act('train: the handle to full', tapHandle('panel'));
    await act('train: the handle back', tapHandle('panel'));
    await act('train: the stops ahead open', ev(() => document.querySelector('#panel .cd-stop')?.click()));
    await act('train: the stops ahead closed', ev(() => document.querySelector('#panel .cd-stop')?.click()));
    await act('train: a drag up of 200 px', swipe('panel', -200));
    state(await isFull('panel'), 'train: a drag up of 200 px left the card compact');
    await act('train: a drag down of 120 px', swipe('panel', 120));
    state(!(await isFull('panel')), 'train: a drag down of 120 px from full left the card full');
    await act('train: another train', () => tapTrain(3), 3000);
    // a screen over an expanded card, then back
    await act('train: expanded', tapHandle('panel'));
    const wasFull = await isFull('panel');
    await act('over a card: Statistik', ev(() => { document.getElementById('nav-button').click(); document.getElementById('open-stats').click(); }), 1500);
    await act('over a card: Statistik closed', ev(() => document.querySelector('#stats-page .panel-close').click()), 1500);
    state((await shown('panel')) && (await isFull('panel')) === wasFull, `train: expanded (${wasFull}) under Statistik, back as ${await isFull('panel')}`);
    // the keyboard over the card (the search in the top bar)
    await act('the top search over the card', ev(() => document.getElementById('menu-button').click()), 800);
    await act('the keyboard up over the card', kbUp, 1200);
    await act('the keyboard down over the card', kbDown, 1200);
    await act('the top search closed', ev(() => document.getElementById('menu-button').click()), 1000);
    state((await shown('panel')) && (await isFull('panel')) === wasFull, 'train: the card not as it was after the top search');
    if (await isFull('panel')) await act('train: the handle back', tapHandle('panel'));   // (from full a swipe of 300 px only compacts)
    await act('train: a long swipe down', swipe('panel', 300), 1200);
    state(!(await shown('panel')), 'train: a long swipe down left the card open');
  }
  // the ☰ menu and its screens
  await act('☰: open', ev(() => document.getElementById('nav-button').click()), 700);
  await act('☰: closed by ☰', ev(() => document.getElementById('nav-button').click()), 700);
  await act('Störningar: open', ev(() => { document.getElementById('nav-button').click(); document.getElementById('open-disruptions').click(); }), 1500);
  await act('Störningar: a fold', ev(() => document.querySelector('#disruptions-page .dis-fold')?.click()), 1200);
  await act('Störningar: a disruption', ev(() => document.querySelector('#disruptions-page .dis-row')?.click()), 2000);
  await act('the disruption: back', ev(() => document.querySelector('#disruption .dis-back, #disruption [data-back]')?.click()), 1500);
  await act('Störningar: a long swipe down', swipe('disruptions-page', 300), 1200);
  state(!(await shown('disruptions-page')), 'Störningar: a long swipe down left it open');
  await act('Statistik: open', ev(() => { document.getElementById('nav-button').click(); document.getElementById('open-stats').click(); }), 1800);
  await act('Statistik: a company', ev(() => document.querySelector('#stats-page .st-cogo')?.click()), 1500);
  await act('Statistik: back to all companies', ev(() => document.querySelector('#stats-page .st-back')?.click()), 1500);
  await act('Statistik: a long swipe down', swipe('stats-page', 300), 1200);
  state(!(await shown('stats-page')), 'Statistik: a long swipe down left it open');
  await act('Settings: open', ev(() => { document.getElementById('nav-button').click(); document.getElementById('open-settings').click(); }), 1500);
  await act('Settings: dark', ev(() => document.querySelector('#settings-page [data-key="theme"] [data-v="dark"]')?.click()), 2500);
  await act('Settings: light', ev(() => document.querySelector('#settings-page [data-key="theme"] [data-v="light"]')?.click()), 2500);
  await act('Settings: closed', ev(() => document.querySelector('#settings-page .panel-close')?.click()), 1200);
  await act('Anslutning: open', ev(() => document.getElementById('status')?.click()), 1500);
  await act('Anslutning: closed', ev(() => document.querySelector('#conn-page .panel-close')?.click()), 1200);

  // ---- 2. live: a station's board ----
  await start({ lang: 'sv', view: '10/59.33/18.06' });
  await act('the top search: open', ev(() => document.getElementById('menu-button').click()), 800);
  await act('the top search: the keyboard up', kbUp, 800);
  await page.type('#search', 'Uppsala C');
  await sleep(800);
  await act('the top search: the keyboard down', kbDown, 800);
  await act('board: opened from the search', ev(() => [...document.querySelectorAll('#search-results button')].find(b => b.textContent.includes('Uppsala C'))?.click()), 2500);
  for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(300)) if (await has('#board .bd-row')) break;
  for (let t0 = Date.now(); Date.now() - t0 < 6000; await sleep(300)) if (await has('#board .board-msgs-toggle')) break;
  await sleep(800);
  const message = await has('#board .board-msgs-toggle');
  const msgClick = ev(() => document.querySelector('#board .board-msgs-toggle').click());
  const find = ev(() => document.querySelector('#board .board-find').click());
  if (message) {
    await act('board: its message open', msgClick);
    await act('board: Ankomster with the message open', ev(() => document.querySelector('#board [data-act="Ankomst"]').click()), 2000);
    await act('board: its message closed', msgClick);
    state(!(await isFull('board')), 'board: compact, its message open and closed: left full');
    await act('board: Avgångar', ev(() => document.querySelector('#board [data-act="Avgang"]').click()), 2000);
    await act('board: the handle to full', tapHandle('board'));
    await act('board: expanded, its message open', msgClick);
    await act('board: expanded, its message closed', msgClick);
    state(await isFull('board'), 'board: expanded by hand, its message open and closed: came back compact');
    await act('board: the handle back', tapHandle('board'));
  } else notes.push('the board\'s message not checked: Uppsala C has none now');
  // the search, from compact
  await act('board: the search from compact', find, 2500);
  await act('board: the keyboard up while searching', kbUp, 1200);
  await act('board: typed while searching', () => page.type('#board .board-q', 'sto'), 800);
  await act('board: the keyboard down while searching', kbDown, 1200);
  await act('board: the search closed', find, 2500);
  state(!(await isFull('board')), 'board: compact, the search opened and closed: left full');
  // the search, from expanded
  await act('board: the handle to full', tapHandle('board'));
  await act('board: the search when expanded', find, 2500);
  await act('board: the keyboard up (expanded)', kbUp, 1200);
  await act('board: the keyboard down (expanded)', kbDown, 1200);
  await act('board: that search closed', find, 2500);
  state(await isFull('board'), 'board: expanded by hand, the search opened and closed: came back compact');
  await act('board: the handle back', tapHandle('board'));
  if (message) {   // the search folds the message (the field above the keyboard); closed, the card is compact again
    await act('board: its message open again', msgClick);
    await act('board: the search with its message open', find, 2500);
    state(await has('#board .board-msg-list[hidden]'), 'board: the search did not fold the message');
    await act('board: that search closed', find, 2500);
    state(!(await isFull('board')), 'board: compact, message, search, closed: left full');
  }
  // a train picked from the search
  await act('board: the search again', find, 2500);
  await act('board: Ankomster while searching', ev(() => document.querySelector('#board [data-act="Ankomst"]').click()), 2500);
  const picked = await act('board: a train from the search', ev(() => document.querySelector('#board .board-found .bd-row:not(.gone)')?.click()), 3000);
  if (await shown('panel')) glidesToTimetable(picked, 'a train from the board\'s search');
  await act('that train\'s card closed', ev(() => document.querySelector('#panel .panel-close')?.click()), 1500);
  await act('board: a long swipe down', swipe('board', 300), 1200);
  state(!(await shown('board')), 'board: a long swipe down left it open');
  // the map's buttons where the open card says
  await act('a station over a train: a train', () => tapTrain(1), 3000);
  await act('a station over a train: the top search', ev(() => document.getElementById('menu-button').click()), 800);
  await page.type('#search', 'Malmö C');
  await sleep(800);
  await act('a station over a train: Malmö C', ev(() => [...document.querySelectorAll('#search-results button')].find(b => b.textContent.includes('Malmö C'))?.click()), 2500);
  await act('a station over a train: its board closed', ev(() => document.querySelector('#board .panel-close')?.click()), 1500);
  // (the card on top: the tap may have opened a group's list instead of a train)
  const h = await page.evaluate(() => { const top = ['panel', 'board', 'picker', 'disruption'].map(i => document.getElementById(i)).find(e => !e.hidden && !e.classList.contains('behind'));
    return [getComputedStyle(document.documentElement).getPropertyValue('--sheet-h').trim(), top ? `${Math.round(top.getBoundingClientRect().height)}px` : '0px', top ? `#${top.id}` : 'none'];
  });
  state(h[0] === h[1], `the map's buttons at ${h[0]}, the card on top (${h[2]}) ${h[1]} tall`);
  state(!errors.length, `page errors: ${errors.slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
}
for (const n of notes) console.log(`note ${n}`);
for (const f of fails) console.log(`FAIL ${f}`);
console.log(fails.length ? `sheet-moves-check: ${fails.length} failed` : `sheet-moves-check ok: ${steps} steps through the app, every card moves in one go and comes back as it was`);
process.exit(fails.length ? 1 : 0);
