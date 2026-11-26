// A quick check of the screens, in a phone-sized headless browser, on a replay (CARD_HOUR, a recording with its
// trains' routes saved; else the rush hour; or live, when neither is in data/). Run by tools/check.mjs; or alone: node tools/ui-check.mjs
// Needs `npm run dev` going. Exit code 0: all good; 1: something failed (it says what); 2: the page isn't running.
// The one sheet (2026-11-22, src/stack.js): every step goes through tools/lib/screen.mjs.
// Checked: the page starts without errors in English/light and Swedish/dark, at rest only the search bar and ☰; ☰ lists
// its four rows; Filter (☰) has the lateness bar; the chip Statistik's card at full shows its parts (Sweden drawn, its
// switch), a company there opens its page and only its
// trains are drawn, "Show only" keeps that after the page closes (the line above the bar says so, its × shows them all
// again); a train tapped on Statistik opens its page; the live mark opens Connection; a tap opens a train's page; the
// compact card (tiles, the stop list, "All stops" raising the sheet, "i"); Settings → All places; every "N trains"
// label lists exactly N; a search lists every matching train and scrolls; a setting changes without the page
// reloading; a train picked with the keyboard up is held above the sheet; no model has surfaces on top of each other.
// Not checkable here: a pinch (never zooms the page in this browser), the phone's keyboard, flicker, speed.
// --files <address>: the same, on the page reading the fetcher's files there (public-plan step 3); tools/check.mjs
// runs it with a fetcher replaying the rush hour (node fetcher/main.mjs --replay ... --serve <a free port>).
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, sleep, PAGE, RUSH_HOUR, CARD_HOUR } from './lib/browser.mjs';
import { waitForMap, until, pageKey, toRest, openSearch, typeSearch, openMenu, openFromMenu, openConnection, back, setLevel, sheetState, openChip, pageSel } from './lib/screen.mjs';

try { await fetch(PAGE); } catch { console.log(`UI check skipped: nothing answers at ${PAGE} (start it with npm run dev)`); process.exit(2); }

const filesAt = process.argv.includes('--files') ? process.argv[process.argv.indexOf('--files') + 1] : null;
// The replay with its trains' routes saved (the card's stops, 2026-11-17), else the rush hour as before, else live.
const has = name => existsSync(`data/positions-${name}.jsonl`);
const replay = filesAt ? null : has(CARD_HOUR) && existsSync(`data/routes-${CARD_HOUR}.jsonl`) ? CARD_HOUR : has(RUSH_HOUR) ? RUSH_HOUR : null;
const base = { ...(replay ? { replay } : {}), ...(filesAt ? { files: filesAt } : {}), view: '12/59.33/18.06', train: 'toy' };
const runName = filesAt ? 'files, rush-hour replay' : replay ? `replay ${replay}` : 'live';
const problems = [];
let stats = 0;   // Statistik's parts
let filtered = '';   // the filter step's result
let cardNote = '';   // said in the ok line when the card's parts couldn't be checked
const expect = (ok, what) => { if (!ok) problems.push(what); };
// The map's free part ends above the sheet (src/stack.js sets --sheet-shown).
const freeBottom = page => page.evaluate(() => innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-shown')) || 0) - 12);

const browser = await launch();
try {
  // ---- Both languages and looks start clean ----
  for (const [lang, theme, word, connWord] of [['en', 'light', 'Settings', 'Connection'], ['sv', 'dark', 'Inställningar', 'Anslutning']]) {
    const page = await waitForMap(browser, { ...base, lang, theme });
    const s = await page.evaluate(() => ({ title: document.title, lang: document.documentElement.lang, theme: document.documentElement.dataset.theme,
      word: document.querySelector('#open-settings .nav-t').textContent, trains: window.__trains.count, status: document.getElementById('status').textContent,
      key: window.__stack.top(), level: window.__stack.level, sheet: Math.round(document.getElementById('sheet').getBoundingClientRect().top),
      field: Math.round(document.getElementById('search').getBoundingClientRect().top) }));
    expect(s.trains > 0, `${lang}/${theme}: no trains on the map (${s.status})`);
    expect(s.title === 'Spårat', `${lang}/${theme}: the title is "${s.title}"`);
    expect(s.lang === lang && s.theme === theme && s.word === word, `${lang}/${theme}: shows lang ${s.lang}, look ${s.theme}, menu "${s.word}"`);
    // At rest: Home, low; only the bar shows (the search field in the bottom 90 px).
    expect(s.key === 'home' && s.level === 0 && s.field > 851 - 90, `${lang}/${theme}: at rest the sheet is ${s.key} at height ${s.level}, its field at y ${s.field}`);
    // ---- ☰: its four rows (Filter, Rewind, Settings, About since the start chips, 2026-11-25) ----
    await openMenu(page);
    const navRows = await page.evaluate(() => [...document.querySelectorAll('#nav .nav-row:not([hidden]) .nav-t')].map(b => b.textContent));
    expect(navRows.length === 4 && navRows.includes(word), `${lang}/${theme}: ☰ lists ${JSON.stringify(navRows)}`);
    await page.keyboard.press('Escape');
    // (its buttons slide back into ☰ first, ~0.3 s: waited for, at most 1.5 s)
    expect(await until(page, () => document.getElementById('nav').hidden, 1500), `${lang}/${theme}: Esc left ☰'s menu open`);
    // ---- The lateness bar: on the Filter page (☰) since the start chips (2026-11-25; until then on Home) ----
    await openFromMenu(page, 'filter');
    const legend = await page.evaluate(h => document.querySelectorAll(`${h} .lg-p`).length, pageSel('filter'));
    await toRest(page);
    // ---- Statistik's parts: the chip Statistik's card at full (on Home until 2026-11-25) ----
    expect(await openChip(page, 'stats'), `${lang}/${theme}: the chip Statistik opened ${await pageKey(page)}`);
    await setLevel(page, 2);
    await sleep(1200);
    const home = pageSel('stats');
    // (the number is redrawn each second, the trains' count with each frame: until the two agree, at most 4 s)
    await until(page, (h) => { const n = parseInt(document.querySelector(`${h} .st-big`)?.textContent ?? '', 10); return Math.abs(n - window.__trains.count) <= 0; }, 4000, home);
    const st = await page.evaluate(h => ({ first: document.querySelector(`${h} .st-big`)?.textContent ?? '', bars: document.querySelectorAll(`${h} .st-bar`).length,
      sections: document.querySelectorAll(`${h} .st-sec`).length, trains: window.__trains.count,
      map: document.querySelector(`${h} canvas`)?.width ?? 0 }), home);
    // The page's number is redrawn each second; from the files, trains come in 5-s batches, so the two may differ by
    // a few at the moment they are read (2026-11-16: "319" against 318).
    const sameCount = filesAt ? Math.abs(parseInt(st.first, 10) - st.trains) <= 3 : st.first.startsWith(String(st.trains));
    expect(sameCount && st.bars > 0 && st.sections >= 9 && st.map > 0 && legend > 0,
      `${lang}/${theme}: Statistik shows "${st.first}" (${st.trains} trains on the map), ${st.bars} bars, ${st.sections} of 10 Statistik parts, Sweden ${st.map ? 'drawn' : 'missing'}; Filter's lateness bar ${legend} colours`);
    // The heatmap's switch: Lateness, then back to Trains.
    const heat = await page.evaluate((h) => {
      const late = document.querySelector(`${h} .st-heatseg [data-v="lateness"]`), trains = document.querySelector(`${h} .st-heatseg [data-v="trains"]`);
      if (!late || !trains) return 'no switch';
      late.click(); const a = late.getAttribute('aria-pressed') === 'true' && Boolean(document.querySelector(`${h} .st-heatkey .st-keys`));
      trains.click(); const b = trains.getAttribute('aria-pressed') === 'true' && Boolean(document.querySelector(`${h} .st-heatkey .st-ramp`));
      return a && b ? 'ok' : `lateness ${a}, trains ${b}`;
    }, home);
    expect(heat === 'ok', `${lang}/${theme}: the heatmap's switch: ${heat}`);
    if (lang === 'en') {
      // ---- A company on Statistik opens its page, only its trains are drawn; "Show only" keeps that after it closes
      // (the line above the bar says so); × on the line shows them all again ----
      const drawn = () => page.evaluate(() => ({ n: window.__last3d.length, line: !document.getElementById('line').hidden,
        text: document.getElementById('line').textContent, key: window.__stack.top() }));
      const all = await drawn();
      const company = await page.evaluate(h => { const b = document.querySelector(`${h} [data-filter="brand"]`); b?.click(); return b?.dataset.v ?? null; }, home);
      await sleep(900);
      const open = await drawn();
      // (a company picked on Statistik is a filter at once, its "Show only" already on: Max, 2026-11-23)
      const pressed = await page.evaluate(() => document.querySelector('#sheet .show-only')?.getAttribute('aria-pressed'));
      expect(pressed === 'true', `a company picked on Statistik is a filter at once: its "Show only" pressed (${pressed})`);
      await back(page);
      await sleep(500);
      const only = await drawn();
      await page.evaluate(() => document.querySelector('#line .line-x')?.click());
      await sleep(500);
      const again = await drawn();
      filtered = `${company}: ${open.n} of ${all.n} drawn`;
      expect(open.key === `co:${company}` && open.n > 0 && open.n < all.n && !all.line,
        `a tap on ${company} on Statistik: page ${open.key}, drawn ${all.n} -> ${open.n}`);
      // (back from the company: Statistik, the root page it was opened from)
      expect(only.key === 'stats' && only.line && only.text.includes(company) && Math.abs(only.n - open.n) <= 3 && !again.line && again.n >= all.n - 5,
        `"Show only" ${company}: back on ${only.key}, drawn ${only.n} (line ${only.line ? `"${only.text}"` : 'hidden'}) -> × ${again.n} (line ${again.line ? 'shown' : 'hidden'})`);
      // ---- A train on Statistik (the most late, else the fastest) opens its page ----
      await setLevel(page, 2);
      const tapped = await page.evaluate((h) => {
        const b = document.querySelector(`${h} .st-worst:not([hidden])`) ?? document.querySelector(`${h} .st-fastrow[data-id]`) ?? document.querySelector(`${h} .most-late [data-go]`);
        if (!b) return null;
        const n = b.querySelector('b')?.textContent; b.click(); return n;
      }, home);
      await sleep(1500);
      const card = await page.evaluate(() => ({ key: window.__stack.top(), title: document.querySelector('#panel .panel-title strong')?.textContent ?? '' }));
      expect(tapped && card.key.startsWith('train:') && card.title.startsWith(tapped),
        `a tap on train ${tapped ?? '(none to tap)'} on Statistik: page ${card.key}, card "${card.title}"`);
      await toRest(page);
    }
    // ---- The live mark opens the connection screen (Max's pick Y, 2026-11-18; a page since 2026-11-22) ----
    await toRest(page);
    await openConnection(page);
    await sleep(1200);
    const cn = await page.evaluate(() => ({ key: window.__stack.top(), title: document.getElementById('conn-title').textContent,
      state: document.querySelector('#conn-body .conn-hero')?.dataset.state, map: document.querySelector('#conn-body .conn-map canvas')?.width ?? 0,
      trains: document.querySelector('#conn-body .n-trains')?.textContent }));
    expect(cn.key === 'page:conn' && cn.title === connWord && cn.state && cn.map > 0 && Number(cn.trains) > 0,
      `${lang}/${theme}: the live mark opened ${cn.key} "${cn.title}" (state ${cn.state}, Sweden ${cn.map ? 'drawn' : 'missing'}, ${cn.trains} trains)`);
    const backed = await back(page);
    expect(backed === 'home', `${lang}/${theme}: back from Connection went to ${backed}`);
    stats = st.sections;
    expect(!page.errors.length, `${lang}/${theme}: page errors: ${page.errors.slice(0, 2).join(' | ')}`);
    await page.close();
  }

  const page = await waitForMap(browser, { ...base, lang: 'en', theme: 'light' });
  await page.evaluate(() => { window.__samePage = true; });

  // ---- A tap on a train opens its page ----
  // Up to 3 tries (2026-11-21): the map answers a tap from the picture it last drew; on a busy computer (another check
  // beside this one) and with the files' 5-s batches that can lag the train, so a tap opened its neighbour or nothing
  // (2 of 4 runs). A wrong one is closed and a train picked again; all 3 wrong fails as before.
  let tapped = null, head = null, trainKey = null;
  for (let tries = 0; tries < 3; tries++) {
  if (tries) { await toRest(page); await sleep(400); }
  tapped = await page.evaluate((bottom) => {
    const m = window.__map, c = m.project(m.getCenter());
    const d = f => { const q = m.project(f.geometry.coordinates); return Math.hypot(q.x - c.x, q.y - c.y); };
    // trains with a label of their own: further out the map's, close in page elements (src/map.js placeNearLabels)
    const lone = new Set(m.queryRenderedFeatures({ layers: ['train-labels'] }).map(f => f.properties.id));
    const own = [...document.querySelectorAll('.near-label:not(.group)')].map(e => e.getBoundingClientRect());
    for (const f of m.queryRenderedFeatures({ layers: ['train-dots'] })) {
      const q = m.project(f.geometry.coordinates);
      if (own.some(r => Math.abs((r.left + r.right) / 2 - q.x) < 2 && Math.abs(r.top - q.y - 16) < 3)) lone.add(f.properties.id);   // a bubble starts 16 px below its train (src/map.js LABEL_DY)
    }
    // ...and not under a "3 trains" bubble (a tap there lists the group: right, but not this test; seen with the
    // files' 5-s batches, 2026-11-16).
    const groups = [...document.querySelectorAll('.near-label.group')].map(e => e.getBoundingClientRect());
    // Nor under a station's name (close in a tap there opens the station): the map's names and, close in, the page's
    // (src/map.js placeStationNames; 2026-11-21: with shorter bubbles a train under "Stockholm C" was picked).
    const names = [...document.querySelectorAll('.station-name')].map(e => e.getBoundingClientRect());
    const covered = q => q.y > bottom || q.y < 50 || [...groups, ...names].some(r => q.x > r.left - 4 && q.x < r.right + 4 && q.y > r.top - 4 && q.y < r.bottom + 4)
      || m.queryRenderedFeatures([[q.x - 8, q.y - 8], [q.x + 8, q.y + 8]], { layers: ['station-names'] }).length > 0;
    const f = m.queryRenderedFeatures({ layers: ['train-dots'] }).filter(f => lone.has(f.properties.id) && !covered(m.project(f.geometry.coordinates)))
      .sort((a, b) => d(a) - d(b))[0];
    if (!f) return null;
    const q = m.project(f.geometry.coordinates);
    m.fire('click', { point: q, lngLat: m.unproject(q), originalEvent: new MouseEvent('click') });
    return String(window.__trains.get(f.properties.id).number);
  }, await freeBottom(page));
  await sleep(1500);
  ({ head, trainKey } = await page.evaluate(() => {
    const key = window.__stack.top();
    return { trainKey: key, head: key.startsWith('train:') ? document.querySelector('#panel .panel-head strong')?.textContent
      : key.startsWith('pick:') ? `the group list: ${document.querySelector('#picker strong')?.textContent}`
      : key.startsWith('station:') ? `the board of ${document.querySelector('#board strong')?.textContent}` : null };
  }));
  if (!tapped || head?.startsWith(tapped)) break;
  }
  expect(tapped && head?.startsWith(tapped), `tapping train ${tapped} opened ${head ? `"${head}"` : 'nothing'} (3 tries)`);
  // No Home chip and no bar over a train: its share, star and Follow in its card's top line (2026-11-23).
  const bar = await page.evaluate(() => ({ chip: Boolean(document.querySelector('#sheet .sh-back')), inCard: [...document.querySelectorAll('#panel .panel-head .sh-btns button')].filter(b => !b.hidden).length }));
  expect(!head || (!bar.chip && bar.inCard === 3), `a train's page over Home: ${bar.chip ? 'a Home chip, ' : ''}${bar.inCard} buttons in the card's top line (want no chip, 3)`);

  // ---- The compact card (2026-11-15): two tiles; the stop tile lists the stops ahead and counts down to the one
  // picked; "All stops" raises the sheet and opens it full; no × in the sheet ----
  // Trafikverket gives out a day's timetable only for a few days: the 12 Nov recording's routes were there on 15 Nov,
  // gone on 16 Nov (every train "no stops"). Since 2026-11-17 the replay brings its own (CARD_HOUR's routes file); in
  // the files run, or without that file, the card's parts can't be checked: said so, not failed.
  // The route: until the card has its stops ("All stops") or says it has none, at most 10 s (2026-11-21: a fixed 2 s
  // was too short at times from the fetcher's tap files, slower beside another check: "No element found: .panel-more").
  await until(page, () => Boolean(document.querySelector('#panel .panel-more, #panel .state.empty, #panel .state.error')), 10000);
  await sleep(300);
  // Since plan step 4 (2026-11-17) the files run's taps come from the fetcher's tap files; a replaying fetcher makes
  // them from the recording's timetable since TODO 37 (2026-11-19). A train they don't hold: said so, not failed.
  const noRoute = head && await page.evaluate(() => Boolean(document.querySelector('#panel .state.empty, #panel .state.error')) && !document.querySelector('#panel .tile'));
  if (noRoute) cardNote = filesAt ? ' (card parts not checked: the fetcher\'s tap files had no stops for this train)'
    : ' (card parts not checked: the replay\'s day is no longer at Trafikverket)';
  let placesSeen = '';
  if (head && !noRoute) {
    const card = () => page.evaluate(() => {
      const el = document.getElementById('panel'), stop = el.querySelector('.cd-stop');
      return { tiles: el.querySelectorAll('.tile').length, late: el.querySelector('.cd-late b')?.textContent ?? '', stop: stop?.innerText.replace(/\n/g, ' ') ?? '',
        button: stop?.tagName === 'BUTTON', rows: [...el.querySelectorAll('.cd-row .cd-name b')].map(b => b.textContent),
        full: el.classList.contains('full'), close: el.querySelectorAll('.panel-close').length,
        timeline: el.querySelector('.panel-table')?.getBoundingClientRect().height ?? -1, level: window.__stack.level };
    });
    let c = await card();
    expect(c.tiles === 2 && c.late, `the card shows ${c.tiles} tiles, lateness "${c.late}"`);
    expect(c.close === 0, `the card has ${c.close} × of its own (the sheet's ‹ and a map tap close it)`);
    expect(!c.full && c.timeline === 0 && c.level === 1, `the card opened full (${c.full}), or shows its timeline, or the sheet isn't at half (${c.level})`);
    // With saved routes the replay's card is as at the replay's clock, the stops ahead (as live); a train at its end:
    // "Arrived".
    if (c.button) {
      // Clicked in the page: the card redraws each second, so a handle taken first can be gone by the click.
      await page.evaluate(() => document.querySelector('#panel .cd-stop').click());
      await sleep(300);
      c = await card();
      expect(c.rows.length > 0, 'the stop tile listed no stops');
      if (c.rows.length > 1) {
        await page.evaluate(() => document.querySelectorAll('#panel .cd-row')[0].click());
        await sleep(300);
        const picked = c.rows[0];
        c = await card();
        expect(c.stop.includes(picked) && c.rows.length === 0, `picking ${picked}: the tile says "${c.stop}"`);
      }
    } else expect(/Arrived/.test(c.stop), `the stop tile isn't a button and says "${c.stop}"`);
    // Said as a problem, not a crash, when the card is gone by then (2026-11-21).
    const more = await page.evaluate(() => { const b = document.querySelector('#panel .panel-more'); b?.click(); return Boolean(b); });
    expect(more, `the card of ${tapped} had no "All stops" by then (page ${await pageKey(page)})`);
    await sleep(600);
    c = await card();
    expect(c.full && c.timeline > 0 && c.level === 2, `"More" did not raise the sheet (${c.level}) and open the full card (${c.full}) with its timeline`);
    // "i" (src/train-info.js; Max, 2026-11-20): the train's own numbers instead of the stops, and back.
    await page.evaluate(() => document.querySelector('#panel .panel-info')?.click());
    await sleep(1500);
    const info = await page.evaluate(() => {
      const b = document.querySelector('#panel .panel-info-box'), r = b?.getBoundingClientRect();
      return { shown: Boolean(r && r.height > 0), sections: b?.querySelectorAll('.ti-sec').length ?? 0, wide: b ? b.scrollWidth - b.clientWidth : -1,
        timeline: document.querySelector('#panel .panel-table')?.getBoundingClientRect().height ?? -1 };
    });
    expect(info.shown && info.sections === 5 && info.timeline === 0, `"i" showed ${info.sections} sections (shown ${info.shown}, the stops ${info.timeline} px)`);
    expect(info.wide <= 1, `the train's own numbers are ${info.wide} px wider than the card`);
    await page.evaluate(() => document.querySelector('#panel .panel-info')?.click());
    await sleep(400);
    c = await card();
    expect(c.timeline > 0, '"i" again did not bring the stops back');
    // "All places" (src/places-ahead.js; Max, 2026-11-21; a setting since 2026-11-22): the places between the stops come
    // in, and go again.
    const placeRows = () => page.evaluate(() => {
      const t = document.querySelector('#panel .panel-table');
      return { places: t?.querySelectorAll('.tl-row.place').length ?? -1, stops: t?.querySelectorAll('.tl-row:not(.place)').length ?? -1, wide: t ? t.scrollWidth - t.clientWidth : -1 };
    });
    const allPlaces = async (on) => {
      await openFromMenu(page, 'settings');
      await page.evaluate(v => document.querySelector(`#settings [data-key="allPlaces"] [data-v="${v}"]`).click(), String(on));
      await page.evaluate(k => window.__stack.open(k), trainKey);
      await until(page, () => Boolean(document.querySelector('#panel .panel-more')), 10000);
      await setLevel(page, 2);
      await sleep(1500);
    };
    const off = await placeRows();
    await allPlaces(true);
    const on = await placeRows();
    expect(off.places === 0 && on.places > 0, `"All places": ${off.places} places while off, ${on.places} with Settings → All places on`);
    expect(on.stops === off.stops && on.wide <= 1, `"All places" changed the stops (${off.stops} -> ${on.stops}) or is ${on.wide} px wider than the card`);
    placesSeen = `, All places ${on.places} between ${on.stops} stops`;
    await allPlaces(false);
    expect((await placeRows()).places === 0, '"All places" off again left places in the list');
  }
  await toRest(page);

  // ---- Every "N trains" label lists exactly N (a page in the sheet) ----
  const pickRows = () => page.evaluate(() => (window.__stack.top().startsWith('pick:') ? document.querySelectorAll('#picker [data-i]').length : null));
  let groups = 0;
  for (const zoom of [11, 12, 13]) {
    await page.evaluate(z => window.__map.jumpTo({ center: [18.06, 59.33], zoom: z }), zoom);
    await sleep(1200);
    const bottom = await freeBottom(page);
    const labels = await page.evaluate(b => [...document.querySelectorAll('.near-label.group')].map((e) => { const r = e.getBoundingClientRect();
      return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, n: parseInt(e.textContent, 10) }; })
      .filter(q => q.x > 20 && q.x < innerWidth - 20 && q.y > 70 && q.y < b), bottom);
    for (const g of labels) {
      await toRest(page);
      await page.mouse.click(g.x, g.y);
      await sleep(300);
      const rows = await pickRows();
      if (rows === null) continue;   // the trains moved on and the tap missed the label
      groups++;
      expect(rows === g.n, `a "${g.n} trains" label listed ${rows} (zoom ${zoom})`);
    }
    await toRest(page);
  }
  // Far out the map groups close labels too (2026-11-15): a tap on one lists its trains, as many as it says.
  let farGroups = 0;
  for (const zoom of [8, 9]) {
    await page.evaluate(z => window.__map.jumpTo({ center: [18.0, 59.35], zoom: z }), zoom);
    await sleep(2500);
    const bottom = await freeBottom(page);
    const found = await page.evaluate(b => window.__map.queryRenderedFeatures({ layers: ['train-labels'] })
      .filter(f => f.properties.point_count).map(f => ({ n: f.properties.point_count, q: window.__map.project(f.geometry.coordinates) }))
      .filter(g => g.q.x > 40 && g.q.x < innerWidth - 40 && g.q.y > 90 && g.q.y < b - 20).slice(0, 3), bottom);
    for (const g of found) {
      let rows = null, nAt = g.n, nAfter = g.n;
      // (the group's count read at the tap and again after it: the fetcher's batches regroup trains every few seconds,
      // and one read before toRest saw "2 trains" where the tap then listed 3; round check 2026-11-26)
      const countNear = q => page.evaluate((p) => { const f = window.__map.queryRenderedFeatures({ layers: ['train-labels'] }).filter(x => x.properties.point_count)
        .map(x => ({ n: x.properties.point_count, d: Math.hypot(window.__map.project(x.geometry.coordinates).x - p.x, window.__map.project(x.geometry.coordinates).y - p.y) }))
        .sort((a, b) => a.d - b.d)[0]; return f && f.d < 30 ? f.n : null; }, q);
      for (const dy of [15, 18, -15, 0]) {   // the label is under its point, or moved above it
        await toRest(page);
        nAt = (await countNear(g.q)) ?? g.n;
        await page.evaluate((x, y) => { const m = window.__map; m.fire('click', { point: { x, y }, lngLat: m.unproject([x, y]), originalEvent: new MouseEvent('click') }); }, g.q.x, g.q.y + dy);
        await sleep(300);
        rows = await pickRows();
        nAfter = (await countNear(g.q)) ?? nAt;
        if (rows !== null) break;
      }
      if (rows === null) continue;
      farGroups++;
      expect(rows === nAt || rows === nAfter, `far out (zoom ${zoom}), a "${nAt} trains" label listed ${rows}`);
    }
    await toRest(page);
  }
  expect(farGroups > 0, 'far out, no "N trains" label could be tapped');

  // ---- Tilted far, the trains near the bottom of the free map are drawn (2026-11-15: closer tiles load at a higher
  // zoom, and the drops vanished there below the model zoom). Checked by pixels, since the map counts an invisible
  // drop as placed: a drop is a strong colour, the map round it pale. ----
  await page.evaluate(() => window.__map.jumpTo({ center: [17.99, 59.333], zoom: 11.14, pitch: 70, bearing: 0 }));
  await sleep(3500);
  const low = await page.evaluate((b) => {
    const m = window.__map, W = m.getCanvas().clientWidth, H = m.getCanvas().clientHeight;
    // (only drops the map shows: one under the scale slider's "Trackside" was counted as not drawn, 2026-11-23)
    const open = q => document.elementFromPoint(q.x, q.y)?.classList.contains('maplibregl-canvas');
    return (window.__last3d ?? []).map(x => m.project([x.lon, x.lat])).filter(q => q.x > 30 && q.x < W - 30 && q.y > H * 0.55 && q.y < b - 20 && open(q))
      .slice(0, 4).map(q => ({ x: Math.round(q.x) - 12, y: Math.round(q.y) - 12, width: 24, height: 24 }));
  }, await freeBottom(page));
  let lowSeen = 0;
  const shots = [];
  for (const clip of low) shots.push(Buffer.from(await page.screenshot({ clip })).toString('base64'));
  if (shots.length) {
    lowSeen = await page.evaluate(async list => {
      const strong = await Promise.all(list.map(b => new Promise(r => { const im = new Image(); im.onload = () => {
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
        const d = g.getImageData(0, 0, im.width, im.height).data; let n = 0;
        for (let k = 0; k < d.length; k += 4) if (Math.max(d[k], d[k + 1], d[k + 2]) - Math.min(d[k], d[k + 1], d[k + 2]) > 90) n++;
        r(n); }; im.src = 'data:image/png;base64,' + b; })));
      return strong.filter(n => n >= 6).length;
    }, shots);
  }
  expect(!low.length || lowSeen === low.length, `tilted far, ${low.length - lowSeen} of ${low.length} trains near the bottom of the free map not drawn`);
  await page.evaluate(() => window.__map.jumpTo({ pitch: 0 }));

  // ---- Search lists every matching train, in a list that scrolls ----
  await openSearch(page);
  await typeSearch(page, '2');
  await sleep(1500);
  const search = await page.evaluate(() => ({ rows: document.querySelectorAll('#search-results .search-trains [data-go]').length,
    onMap: window.__trains.reports().filter(r => String(r.number).startsWith('2')).length,
    scrolls: document.getElementById('search-results').scrollHeight > document.getElementById('search-results').clientHeight }));
  expect(search.rows >= Math.min(search.onMap, 200), `search "2": ${search.rows} rows for ${search.onMap} trains on the map`);
  expect(search.onMap < 12 || search.scrolls, 'the search list does not scroll');
  // The empty search: no "Show only" chips since 2026-11-24 (Max: they looked like they filtered the search; they are in
  // the Filter page now, tools/filter-pills-check.mjs).
  await typeSearch(page, '');
  await page.evaluate(() => { const i = document.getElementById('search'); i.value = ''; i.dispatchEvent(new Event('input')); });
  await sleep(300);
  const chips = await page.evaluate(() => document.querySelectorAll('#search-results .scopes .chip').length);
  expect(chips === 0, `the empty search shows no "Show only" chips (${chips})`);

  // ---- A setting changes at once, without reloading the page ----
  await openFromMenu(page, 'settings');
  await page.click('#settings [data-key="theme"] [data-v="dark"]');
  await sleep(4000);
  const after = await page.evaluate(() => ({ same: window.__samePage === true, theme: document.documentElement.dataset.theme,
    layers: ['rail-trv', 'train-dots', 'trains-3d', 'train-labels'].filter(id => window.__map.getLayer(id)).length }));
  expect(after.same, 'changing the look reloaded the page');
  expect(after.theme === 'dark' && after.layers === 4, `after choosing Dark: look ${after.theme}, ${after.layers} of 4 of our map layers`);
  // The accent colour (Settings → Accent colour, 2026-11-15): a swatch sets the page's accent and the route's colour.
  // Since 2026-11-19 the swatches are folded under the row: a tap on it opens them (14), a pick folds them shut and
  // the row shows the colour's name.
  const folded = () => page.evaluate(() => ({ open: document.getElementById('accent-open').getAttribute('aria-expanded'),
    h: Math.round(document.getElementById('accent-pick').getBoundingClientRect().height), inert: document.getElementById('accent-pick').inert,
    n: document.querySelectorAll('#settings [data-key="accent"] button').length, name: document.querySelector('#accent-open .accent-name').textContent }));
  const before = await folded();
  expect(before.open === 'false' && before.h === 0 && before.inert, `accent colours not folded at first: ${JSON.stringify(before)}`);
  await page.evaluate(() => document.getElementById('accent-open').click());
  await sleep(600);
  const opened = await folded();
  expect(opened.open === 'true' && opened.h > 60 && !opened.inert && opened.n === 14, `accent colours didn't fold open: ${JSON.stringify(opened)}`);
  await page.evaluate(() => document.querySelector('#settings [data-key="accent"] [data-v="ocean"]').click());
  await sleep(3000);
  const accent = await page.evaluate(() => ({ css: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    route: JSON.stringify(window.__map.getPaintProperty('path-line', 'line-gradient')), pressed: document.querySelector('#settings [data-key="accent"] [aria-pressed="true"]')?.dataset.v }));
  expect(accent.css === '#5fa8ff' && accent.route.includes('#5fa8ff') && accent.pressed === 'ocean',
    `after choosing Ocean in dark: --accent ${accent.css}, route ${accent.route.slice(0, 60)}, pressed ${accent.pressed}`);
  const picked = await folded();
  expect(picked.open === 'false' && picked.h === 0 && /^(Havsblå|Ocean)$/.test(picked.name), `after a pick the colours didn't fold shut with the name: ${JSON.stringify(picked)}`);
  await page.evaluate(() => localStorage.removeItem('settings'));
  expect(!page.errors.length, `page errors: ${page.errors.slice(0, 2).join(' | ')}`);

  // ---- A train picked in the search with the keyboard up (a short page) is held in the free map above the sheet once
  // the keyboard is gone (Max, 2026-11-15: it stayed too high) ----
  let heldAt = '';
  {
    const phone = { width: 393, height: 851, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
    const kb = await waitForMap(browser, { ...base, size: phone, lang: 'en', view: '9/59.33/18.06' });
    await sleep(2000);
    // A train on the map in this replay (2311 was the rush hour's): the one nearest the middle with a 4-digit number.
    const pick = await kb.evaluate(() => { const m = window.__map, c = m.getCenter();
      return (window.__last3d ?? []).map(x => ({ n: String(window.__trains.get(x.id)?.number ?? ''), d: Math.hypot(x.lon - c.lng, x.lat - c.lat) }))
        .filter(x => /^\d{4}$/.test(x.n)).sort((a, b) => a.d - b.d)[0]?.n ?? '2311'; });
    await openSearch(kb);
    await kb.setViewport({ ...phone, height: 430 });
    await sleep(400);
    await typeSearch(kb, pick);
    await sleep(500);
    await kb.evaluate(() => document.querySelector('#search-results [data-go^="train:"]')?.click());
    await sleep(300);
    await kb.setViewport(phone);
    await sleep(3500);
    const y = await kb.evaluate(() => { const b = document.querySelector('.sel-train')?.getBoundingClientRect(); return b ? Math.round(b.top + b.height / 2) : null; });
    // The middle of the free map: between the live mark's room (48 px) and the sheet at rest (at most its half height).
    const want = await kb.evaluate(() => { const H = window.__stack.heights; return Math.round((48 + innerHeight - Math.min(H[window.__stack.level], H[1])) / 2); });
    heldAt = `${y} (free middle ${want})`;
    expect(y !== null && Math.abs(y - want) < 20, `a train picked with the keyboard up is held at y ${y}, not about ${want}`);
    await kb.close();
  }

  // ---- Models ----
  let models;
  try { models = JSON.parse(execFileSync('node', ['tools/models-check.mjs', '--json'], { encoding: 'utf8' })); }
  catch (e) { models = JSON.parse(String(e.stdout || '{"compact":-1,"realistic":-1}')); }
  expect(models.compact === 0 && models.realistic === 0, `model surfaces on top of each other: compact ${models.compact}, realistic ${models.realistic}`);

  console.log(problems.length ? `UI check FAILED (${runName}):` : `UI check ok (${runName}): ` +
    `both languages and looks start clean at rest, a tap opens train ${tapped}${cardNote}${placesSeen}, ${groups} group labels match their lists (${farGroups} far out), tilted: ${lowSeen} of ${low.length} near trains drawn, ` +
    `search "2" lists ${search.rows} (${search.onMap} on the map), Dark without reloading, Statistik shows ${stats} parts, filter ${filtered}, held at ${heldAt}, model surfaces 0`);
  for (const p of problems) console.log('  -', p);
} finally {
  await browser.close();
}
process.exit(problems.length ? 1 : 0);
