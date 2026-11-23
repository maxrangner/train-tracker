// Every move goes in one go and comes back as it was (Max, 2026-11-21: the station card "bounces twice", the search
// "jumps around"; "Feels tedious to click through the whole app and always find some strange edge cases"). A sweep
// through the app at phone size: the one sheet (2026-11-22, src/stack.js), the train card and the board inside it
// (they glide their own height), ☰'s menu, the trail, the line above the bar, the map's buttons and the scale slider
// are read each frame during each step.
//   bounce  a move that turns around (down, up, down) in its top edge or height;
//   step    the sheet reaching its height in one step instead of a glide;
//   state   a height or page that doesn't come back (the sheet raised by hand, after the messages or the search).
// The phone's keyboard is stood in for by the page 430 px shorter (interactive-widget=resizes-content). Big single
// steps are not counted: the test browser drops frames (two at once, a 300 px glide shows a 250 px step), a phone
// doesn't. A drag here is a slow finger held still before it lifts (the test browser's touches come too slowly to be
// a swipe): the sheet goes to the nearest height. KNOWN: bounces found and waiting for Max's word, printed as notes.
//   1. the recorded weekday evening (17 Nov): a train's page and its parts, drags, a station over it and back, the
//      search with the keyboard, a long pull down, ☰'s menu, Home pulled up, a company, Settings, Connection;
//   2. live, Uppsala C (it usually has a message): its message, the handle, the board's search (the keyboard up and
//      down while searching), trains picked from the board, the disruptions, the heights coming back.
// node tools/sheet-moves-check.mjs (with npm run dev; PAGE= for another port).
import { launch, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';
import { waitForMap, until, toRest, setLevel, openSearch, typeSearch, openMenu, openFromMenu, openConnection, openDisruptions, back, HOME, pageSel } from './lib/screen.mjs';

const WATCH = [['the sheet', '#sheet'], ['the card', '#panel'], ['the board', '#board'], ['☰', '#nav'], ['the trail', '#trail'], ['the line', '#line'],
  ['the map buttons', '.maplibregl-ctrl-bottom-right'], ['the slider', '.scale']];
const fails = [], notes = [];
const KNOWN = [   // [the step, the element, what it is]: none now
];
let steps = 0, missed = false;   // missed: a tap on a train missed and the next one was tapped (two moves, not judged)
const browser = await launch();
let page = null;
try {
  const start = async (hash) => {
    if (page) await page.close();
    page = await waitForMap(browser, hash);
    await until(page, () => (window.__trains?.count ?? 0) > 20, 30000);
    await sleep(2500);
    // every frame: each shown element's top and height
    await page.evaluate((watch) => {
      window.__rec = null;
      const loop = () => {
        if (window.__rec) {
          const row = { t: performance.now() };
          for (const [name, sel] of watch) {
            const e = document.querySelector(sel);
            if (!e || e.hidden || !e.isConnected || getComputedStyle(e).visibility === 'hidden' || Number(getComputedStyle(e).opacity) < 0.05) continue;
            const r = e.getBoundingClientRect(); if (r.height) row[name] = [Math.round(r.top), Math.round(r.height)];
          }
          window.__rec.push(row);
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }, WATCH);
  };

  // One step: what it does, then every shown element's frames looked at. Returns the frames.
  async function act(name, fn, ms = 1400) {
    steps++;
    // (the resting place first: the last step's glide ended, so its tail isn't read as this step's turn)
    await page.evaluate(() => new Promise((done) => { let last = null, still = 0, n = 0; const s = document.getElementById('sheet');
      const f = () => { const y = Math.round(s.getBoundingClientRect().top); still = y === last ? still + 1 : 0; last = y; if (still >= 6 || ++n > 120) done(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
    await page.evaluate(() => { window.__rec = []; });
    missed = false;
    await sleep(120);
    try { await fn(); } catch (e) { fails.push(`${name}: ${e.message.split('\n')[0]}`); }
    await sleep(ms);
    const rec = await page.evaluate(() => { const r = window.__rec; window.__rec = null; return r; });
    if (missed) { notes.push(`${name}: the tap missed a moving train, the next one tapped (its moves not judged)`); return rec; }
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
        const what = `${name}: ${k} ${dim === 'top' ? 'top edge' : 'height'}`;
        const known = KNOWN.find(([st, e]) => st.test(name) && e.test(what.slice(name.length)));
        if (known) notes.push(`known (waiting for Max): ${what}, ${known[2]}`);
        else fails.push(`bounce ${what} turned ${turns} times (${path.slice(0, 40).join(' ')})`);
      }
    }
    return rec;
  }
  const state = (cond, what) => { steps++; if (!cond) fails.push(`state ${what}`); };
  const ev = f => () => page.evaluate(f);
  const level = () => page.evaluate(() => window.__stack.level);
  const top = () => page.evaluate(() => window.__stack.top());
  const has = sel => page.evaluate(s => Boolean(document.querySelector(s)), sel);
  // a tap on the handle (a finger: src/stack.js toggles low ↔ half, from full to low; 2026-11-23)
  const tapHandle = async () => { const r = await page.evaluate(() => { const b = document.querySelector('#sheet .sh-grab').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }); await page.touchscreen.tap(r.x, r.y); };
  // a finger on the handle moved by dy, held still, lifted
  const drag = dy => async () => {
    const r = await page.evaluate(() => { const b = document.querySelector('#sheet .sh-grab').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    const to = Math.max(8, Math.min(PHONE.height - 8, r.y + dy)), n = 12;
    await page.touchscreen.touchStart(r.x, r.y);
    for (let k = 1; k <= n; k++) { await page.touchscreen.touchMove(r.x, r.y + (to - r.y) * k / n); await sleep(16); }
    await sleep(200);
    await page.touchscreen.touchEnd();
  };
  const kbUp = () => page.setViewport({ ...PHONE, height: PHONE.height - 430 });
  const kbDown = () => page.setViewport(PHONE);
  // A train on the map (its number over 1000 if one shows: a long-distance or regional one), the k-th one, in the free
  // map above the sheet.
  const tapTrain = async (k = 0, tries = 0) => {
    const p = await page.evaluate((n) => { const all = window.__map.queryRenderedFeatures({ layers: ['train-dots'] }).filter((f) => { const q = window.__map.project(f.geometry.coordinates);
      return q.y > 60 && q.y < innerHeight - window.__stack.heights[window.__stack.level] - 20 && q.x > 20 && q.x < innerWidth - 70; });
      const big = all.filter(x => window.__trains.get(x.properties.id)?.number > 1000), fs = big.length ? big : all;
      if (!fs.length) return null; const q = window.__map.project(fs[n % fs.length].geometry.coordinates); return { x: q.x, y: q.y }; }, k);
    if (!p) throw new Error('no train in view');
    const before = await top();
    await page.touchscreen.tap(p.x, p.y);
    // (the map follows the open train, so a tap can miss: the next train then)
    await sleep(1200);
    const now = await top();
    if ((now.startsWith('train:') && now !== before) || tries > 3) return;
    missed = true;
    await tapTrain(k + 1, tries + 1);
  };
  // The sheet reaches its height in a glide: its last move isn't one step of 16 px or more with the sheet still
  // before and after (a dropped frame or two still shows as a glide's few steps).
  const glides = (rec, what) => {
    const h = rec.filter(r => r['the sheet']).map(r => r['the sheet'][0]);
    let last = -1;
    for (let i = 1; i < h.length; i++) if (h[i] !== h[i - 1]) last = i;
    const d = last > 0 ? Math.abs(h[last] - h[last - 1]) : 0;
    const before = last > 0 ? h.slice(Math.max(0, last - 4), last) : [];
    state(!(d >= 16 && before.length >= 3 && before.every(v => v === h[last - 1])), `${what}: the sheet reached its height in one step of ${d} px (${h.filter((v, i, a) => i === 0 || v !== a[i - 1]).join(' ')})`);
  };

  // ---- 1. the recorded evening ----
  await start({ replay: CARD_HOUR, lang: 'sv', view: '11/59.33/18.06' });
  glides(await act('train: opened by a tap', () => tapTrain(0), 3000), 'train: opened by a tap');
  if (!(await top()).startsWith('train:')) fails.push('the train\'s page did not open');
  else {
    for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(300)) if (await has('#panel .panel-more')) break;
    glides(await act('train: All stops', ev(() => document.querySelector('#panel .panel-more').click())), 'train: All stops');
    await act('train: i', ev(() => document.querySelector('#panel .panel-info')?.click()));
    await act('train: i back', ev(() => document.querySelector('#panel .panel-info')?.click()));
    await act('train: Fewer stops', ev(() => document.querySelector('#panel .panel-more').click()));
    await act('train: the handle to low', tapHandle);
    state((await level()) === 0, `train: a tap on the handle at half left the sheet at ${await level()}`);
    await act('train: the handle back to half', tapHandle);
    state((await level()) === 1, `train: a tap on the handle at low left the sheet at ${await level()}`);
    await act('train: the stops ahead open', ev(() => document.querySelector('#panel .cd-stop')?.click()));
    await act('train: the stops ahead closed', ev(() => document.querySelector('#panel .cd-stop')?.click()));
    await act('train: a drag up of 250 px', drag(-250));
    state((await level()) === 2, `train: a drag up of 250 px left the sheet at ${await level()}`);
    await act('train: a drag down of 250 px', drag(250));
    state((await level()) === 1, `train: a drag down of 250 px from full left the sheet at ${await level()}`);
    await act('train: another train', () => tapTrain(3), 3000);
    // a page over an expanded card, then back
    await act('train: expanded', ev(() => window.__stack.setLevel(2)));
    const was = { key: await top(), level: await level() };
    await act('over a card: a station from its stops', ev(() => [...document.querySelectorAll('#panel .tl-row[data-sig]')].at(-1)?.click()), 2000);
    const over = await top();
    await act('over a card: back', ev(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))), 2000);
    state((await top()) === was.key && (await level()) === was.level, `train: expanded (${was.level}) under ${over}, back as ${await top()} at ${await level()}`);
    // a long pull down: every page closed
    await act('train: a long pull down', async () => { await page.evaluate(() => window.__stack.setLevel(0)); await sleep(500); await drag(200)(); }, 1500);
    state((await top()) === 'home' && (await level()) === 0, `train: a long pull down left ${await top()} at ${await level()}`);
  }
  // the search with the keyboard, from Home at half
  await setLevel(page, 1);
  await act('the search: open', ev(() => document.getElementById('search').focus()), 1000);
  await act('the search: the keyboard up', kbUp, 1200);
  await act('the search: typed', () => page.type('#search', '12'), 1000);
  await act('the search: the keyboard down', kbDown, 1200);
  await act('the search: Cancel', ev(() => document.querySelector('#sheet .sh-cancel').click()), 1200);
  state((await level()) === 1 && !(await page.evaluate(() => window.__stack.searching)), `the search closed: Home at ${await level()} (it was at half)`);
  await toRest(page);
  // ☰'s menu and its pages
  await act('☰: open', ev(() => document.getElementById('nav-button').click()), 700);
  await act('☰: closed by ☰', ev(() => document.getElementById('nav-button').click()), 700);
  await act('Home: pulled up', ev(() => window.__stack.setLevel(2)), 1800);
  await act('Home: a company', ev(() => document.querySelector('#sheet .pg[data-key="home"] [data-filter="brand"]:not([data-v=""])')?.click()), 1800);
  await act('the company: back', ev(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))), 1500);
  await act('Home: a long pull down', drag(700), 1500);
  state((await level()) === 0, `Home: a long pull down left it at ${await level()}`);
  await act('Settings: open', ev(() => { document.getElementById('nav-button').click(); document.getElementById('open-settings').click(); }), 1500);
  await act('Settings: dark', ev(() => document.querySelector('#settings-page [data-key="theme"] [data-v="dark"]')?.click()), 2500);
  await act('Settings: light', ev(() => document.querySelector('#settings-page [data-key="theme"] [data-v="light"]')?.click()), 2500);
  await act('Settings: back', ev(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))), 1200);
  await act('Anslutning: open', ev(() => document.getElementById('status')?.click()), 1500);
  await act('Anslutning: back', ev(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))), 1200);
  state((await top()) === 'home', `Anslutning closed: ${await top()} on top`);

  // ---- 2. live: a station's board ----
  await start({ lang: 'sv', view: '10/59.33/18.06' });
  const openBoard = async () => {   // (through the search, the field typed by hand)
    await openSearch(page);
    await typeSearch(page, 'Uppsala C');
    await sleep(500);
    await page.evaluate(() => [...document.querySelectorAll('#search-results [data-go^="station:"]')].find(b => b.textContent.includes('Uppsala C'))?.click());
    for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(300)) if (await has('#board .bd-row')) break;
    await sleep(800);
  };
  await act('the search: open', ev(() => document.getElementById('search').focus()), 800);
  await act('the search: the keyboard up', kbUp, 800);
  await page.type('#search', 'Uppsala C');
  await sleep(800);
  await act('the search: the keyboard down', kbDown, 800);
  await act('board: opened from the search', ev(() => [...document.querySelectorAll('#search-results [data-go^="station:"]')].find(b => b.textContent.includes('Uppsala C'))?.click()), 2500);
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
    state((await level()) === 1, `board: at half, its message open and closed: left at ${await level()}`);
    await act('board: Avgångar', ev(() => document.querySelector('#board [data-act="Avgang"]').click()), 2000);
    await act('board: pulled to full', drag(-320));
    await act('board: at full, its message open', msgClick);
    await act('board: at full, its message closed', msgClick);
    state((await level()) === 2, `board: raised to full by hand, its message open and closed: came back at ${await level()}`);
    await act('board: down to half', ev(() => window.__stack.setLevel(1)));
  } else notes.push('the board\'s message not checked: Uppsala C has none now');
  // the board's search, from half
  await act('board: the search from half', find, 2500);
  await act('board: the keyboard up while searching', kbUp, 1200);
  await act('board: typed while searching', () => page.type('#board .board-q', 'sto'), 800);
  await act('board: the keyboard down while searching', kbDown, 1200);
  await act('board: the search closed', find, 2500);
  state((await level()) === 1, `board: at half, the search opened and closed: left at ${await level()}`);
  // the board's search, from full
  await act('board: pulled to full', drag(-320));
  await act('board: the search at full', find, 2500);
  await act('board: the keyboard up (full)', kbUp, 1200);
  await act('board: the keyboard down (full)', kbDown, 1200);
  await act('board: that search closed', find, 2500);
  state((await level()) === 2, `board: raised to full by hand, the search opened and closed: came back at ${await level()}`);
  await act('board: down to half', ev(() => window.__stack.setLevel(1)));
  if (message) {   // the search folds the message (the field above the keyboard); closed, the sheet back at half
    await act('board: its message open again', msgClick);
    await act('board: the search with its message open', find, 2500);
    state(await has('#board .board-msg-list[hidden]'), 'board: the search did not fold the message');
    await act('board: that search closed', find, 2500);
    state((await level()) === 1, `board: at half, message, search, closed: left at ${await level()}`);
  }
  // a train picked from the board's rows: a page over it; back
  await act('board: a train from its rows', ev(() => document.querySelector('#board .bd-row')?.click()), 3000);
  state((await top()).startsWith('train:'), `a train from the board's rows: ${await top()} on top`);
  await act('that train: back', ev(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))), 1500);
  state((await top()).startsWith('station:'), `back from the train: ${await top()} on top`);
  // a train picked from the board's search
  await act('board: the search again', find, 2500);
  await act('board: Ankomster while searching', ev(() => document.querySelector('#board [data-act="Ankomst"]').click()), 2500);
  await act('board: a train from the search', ev(() => document.querySelector('#board .board-found .bd-row:not(.gone)')?.click()), 3000);
  await act('that train: back', ev(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))), 1500);
  await act('board: a long pull down', async () => { await page.evaluate(() => window.__stack.setLevel(0)); await sleep(500); await drag(200)(); }, 1500);
  state((await top()) === 'home', `board: a long pull down left ${await top()} on top`);
  // the disruptions (live only)
  if (await openDisruptions(page)) {
    await toRest(page);
    await act('Störningar: open', ev(() => document.querySelector('#sheet .pg[data-key="home"] [data-go="dislist"]')?.click()), 1500);
    await act('Störningar: a fold', ev(() => document.querySelector('#sheet .pg[data-key="dislist"] .dis-fold')?.click()), 1200);
    await act('Störningar: a disruption', ev(() => [...document.querySelectorAll('#sheet .pg[data-key="dislist"] .dis-row')].find(r => !r.closest('.dis-works:not(.open)'))?.click()), 2000);
    await act('the disruption: back', ev(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))), 1500);
    await act('Störningar: a long pull down', async () => { await page.evaluate(() => window.__stack.setLevel(0)); await sleep(500); await drag(200)(); }, 1500);
    state((await top()) === 'home', `Störningar: a long pull down left ${await top()} on top`);
  } else notes.push('Störningar not checked: no disruption in force now');
  // the map's buttons where the sheet says: a train, a station from its stops over it, back
  await toRest(page);
  await page.evaluate(() => window.__map.jumpTo({ center: [18.06, 59.33], zoom: 10 }));
  await sleep(1500);
  // (live at night few trains run near Stockholm: further out then)
  for (const z of [9, 8, 7]) {
    if (await page.evaluate(() => window.__map.queryRenderedFeatures({ layers: ['train-dots'] }).length >= 2)) break;
    await page.evaluate(zz => window.__map.jumpTo({ center: [16.5, 59.3], zoom: zz }), z);
    await sleep(1500);
  }
  await act('a station over a train: a train', () => tapTrain(1), 3000);
  await act('a station over a train: a station from its stops', async () => {
    for (let t0 = Date.now(); Date.now() - t0 < 8000; await sleep(300)) if (await has('#panel .tl-row[data-sig]')) break;
    await page.evaluate(() => [...document.querySelectorAll('#panel .tl-row[data-sig]')].at(-1)?.click());
  }, 2500);
  await act('a station over a train: back', ev(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))), 1500);
  const h = await page.evaluate(() => { const s = getComputedStyle(document.documentElement);
    return [s.getPropertyValue('--sheet-h').trim(), `${Math.round(innerHeight - document.getElementById('sheet').getBoundingClientRect().top)}px`, window.__stack.top()]; });
  state(h[0] === h[1], `the map's buttons at ${h[0]}, the sheet (${h[2]}) ${h[1]} tall`);
  state(!page.errors.length, `page errors: ${page.errors.slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
}
for (const n of notes) console.log(`note ${n}`);
for (const f of fails) console.log(`FAIL ${f}`);
console.log(fails.length ? `sheet-moves-check: ${fails.length} failed` : `sheet-moves-check ok: ${steps} steps through the app, every move goes in one go and comes back as it was`);
process.exit(fails.length ? 1 : 0);
