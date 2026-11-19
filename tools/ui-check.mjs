// A quick check of the screens, in a phone-sized headless browser, on a replay (CARD_HOUR, a recording with its
// trains' routes saved; else the rush hour; or live, when neither is in data/). Run by tools/check.mjs; or alone: node tools/ui-check.mjs
// Needs `npm run dev` going. Exit code 0: all good; 1: something failed (it says what); 2: the page isn't running.
// Checked: the page starts without errors in English/light and Swedish/dark; a tap opens a train's card; every
// "N trains" label lists exactly N; a search lists every matching train and scrolls; a setting changes without the
// page reloading; no model has surfaces on top of each other (tools/models-check.mjs); a tap on the banner opens the
// stats page in each language, filled in (Sweden drawn), a train tapped there opens its card, and × closes it; the compact train card (tiles, the stop list, "All stops"); a tap on a company there shows only its trains, and × on
// the bar that appears shows them all again.
// Not checkable here: a pinch (never zooms the page in this browser), the phone's keyboard, flicker, speed.
// --files <address>: the same, on the page reading the fetcher's files there (public-plan step 3); tools/check.mjs
// runs it with a fetcher replaying the rush hour (node fetcher/main.mjs --replay ... --serve 8095).
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, openMap, sleep, PAGE, RUSH_HOUR, CARD_HOUR } from './lib/browser.mjs';

try { await fetch(PAGE); } catch { console.log(`UI check skipped: nothing answers at ${PAGE} (start it with npm run dev)`); process.exit(2); }

const filesAt = process.argv.includes('--files') ? process.argv[process.argv.indexOf('--files') + 1] : null;
// The replay with its trains' routes saved (the card's stops, 2026-11-17), else the rush hour as before, else live.
const has = name => existsSync(`data/positions-${name}.jsonl`);
const replay = filesAt ? null : has(CARD_HOUR) && existsSync(`data/routes-${CARD_HOUR}.jsonl`) ? CARD_HOUR : has(RUSH_HOUR) ? RUSH_HOUR : null;
const base = { ...(replay ? { replay } : {}), ...(filesAt ? { files: filesAt } : {}), view: '12/59.33/18.06', train: 'toy' };
const runName = filesAt ? 'files, rush-hour replay' : replay ? `replay ${replay}` : 'live';
const problems = [];
let stats = 0;   // sections on the stats page
let filtered = '';   // the filter step's result
let cardNote = '';   // said in the ok line when the card's parts couldn't be checked
const expect = (ok, what) => { if (!ok) problems.push(what); };

const browser = await launch();
try {
  // ---- Both languages and looks start clean ----
  for (const [lang, theme, word, statsWord, connWord] of [['en', 'light', 'Settings', 'Live statistics', 'Connection'], ['sv', 'dark', 'Inställningar', 'Statistik just nu', 'Anslutning']]) {
    const page = await openMap(browser, { ...base, lang, theme });
    const s = await page.evaluate(() => ({ title: document.title, lang: document.documentElement.lang, theme: document.documentElement.dataset.theme,
      word: document.querySelector('#open-settings .nav-t').textContent, trains: window.__trains.count, status: document.getElementById('status').textContent }));
    expect(s.trains > 0, `${lang}/${theme}: no trains on the map (${s.status})`);
    expect(s.title === 'Spårat', `${lang}/${theme}: the title is "${s.title}"`);
    expect(s.lang === lang && s.theme === theme && s.word === word, `${lang}/${theme}: shows lang ${s.lang}, look ${s.theme}, menu "${s.word}"`);
    // ---- ☰ → Statistik opens the stats page (2026-11-18; the live pill opened it before); × closes it ----
    await page.evaluate(() => document.getElementById('nav-button').click());
    await sleep(500);
    const navRows = await page.evaluate(() => [...document.querySelectorAll('#nav .nav-row:not([hidden]) .nav-t')].map(b => b.textContent));
    expect(navRows.length >= 3 && navRows.includes(word), `${lang}/${theme}: the menu lists ${JSON.stringify(navRows)}`);
    await page.evaluate(() => document.getElementById('open-stats').click());
    await sleep(1200);
    expect(await page.evaluate(() => document.getElementById('nav').hidden), `${lang}/${theme}: the menu stayed open over the stats page`);
    const st = await page.evaluate(() => ({ open: !document.getElementById('stats-page').hidden, title: document.getElementById('stats-title').textContent,
      first: document.querySelector('#stats-body .st-big')?.textContent ?? '', bars: document.querySelectorAll('#stats-body .st-bar').length,
      sections: document.querySelectorAll('#stats-body .st-sec').length, trains: window.__trains.count,
      map: document.querySelector('#stats-body canvas')?.width ?? 0 }));
    expect(st.open && st.title === statsWord, `${lang}/${theme}: ☰ → Statistik opened ${st.open ? `"${st.title}"` : 'nothing'}`);
    // The page's number is redrawn each second; from the files, trains come in 5-s batches, so the two may differ by
    // a few at the moment they are read (2026-11-16: "319" against 318).
    const sameCount = filesAt ? Math.abs(parseInt(st.first, 10) - st.trains) <= 3 : st.first.startsWith(String(st.trains));
    expect(sameCount && st.bars > 0 && st.sections === 9 && st.map > 0,
      `${lang}/${theme}: the stats page shows "${st.first}", ${st.bars} company bars, ${st.sections} of 9 sections, Sweden ${st.map ? 'drawn' : 'missing'}`);
    // The heatmap's switch: Lateness, then back to Trains.
    const heat = await page.evaluate(() => {
      const late = document.querySelector('#stats-body .st-heatseg [data-v="lateness"]'), trains = document.querySelector('#stats-body .st-heatseg [data-v="trains"]');
      if (!late || !trains) return 'no switch';
      late.click(); const a = late.getAttribute('aria-pressed') === 'true' && Boolean(document.querySelector('#stats-body .st-heatkey .st-keys'));
      trains.click(); const b = trains.getAttribute('aria-pressed') === 'true' && Boolean(document.querySelector('#stats-body .st-heatkey .st-ramp'));
      return a && b ? 'ok' : `lateness ${a}, trains ${b}`;
    });
    expect(heat === 'ok', `${lang}/${theme}: the heatmap's switch: ${heat}`);
    // ---- A tap on a company shows only its trains on the map; × on the bar shows them all again ----
    if (lang === 'en') {
      const drawn = () => page.evaluate(() => ({ n: window.__last3d.length, bar: !document.getElementById('filter-bar').hidden,
        text: document.getElementById('filter-text').textContent }));
      const all = await drawn();
      const company = await page.evaluate(() => { const b = document.querySelector('#stats-body [data-filter="brand"]'); b.click(); return b.dataset.v; });
      await sleep(400);
      const only = await drawn();
      await page.evaluate(() => document.getElementById('filter-clear').click());
      await sleep(400);
      const again = await drawn();
      filtered = `${company}: ${only.n} of ${all.n} drawn`;
      expect(!all.bar && only.bar && only.n > 0 && only.n < all.n && only.text.includes(company) && !again.bar && again.n >= all.n - 5,
        `filter on ${company}: drawn ${all.n} -> ${only.n} (bar ${only.bar ? `"${only.text}"` : 'hidden'}) -> × ${again.n} (bar ${again.bar ? 'shown' : 'hidden'})`);
      // ---- A tap on a train there (the most late, else the fastest) closes the page and opens its card ----
      const tapped = await page.evaluate(() => {
        const b = document.querySelector('#stats-body .st-worst:not([hidden])') ?? document.querySelector('#stats-body .st-fastrow[data-id]');
        if (!b) return null;
        const n = b.querySelector('b')?.textContent; b.click(); return n;
      });
      await sleep(1200);
      const card = await page.evaluate(() => ({ stats: !document.getElementById('stats-page').hidden, panel: !document.getElementById('panel').hidden,
        title: document.querySelector('#panel .panel-title strong')?.textContent ?? '' }));
      expect(tapped && !card.stats && card.panel && card.title.startsWith(tapped),
        `a tap on train ${tapped ?? '(none to tap)'} on the stats page: page ${card.stats ? 'still open' : 'closed'}, card ${card.panel ? `"${card.title}"` : 'not open'}`);
      await page.evaluate(() => { document.getElementById('nav-button').click(); document.getElementById('open-stats').click(); });
      await sleep(800);
    }
    await page.click('#stats-page .panel-close');
    await sleep(300);
    expect(await page.evaluate(() => document.getElementById('stats-page').hidden), `${lang}/${theme}: × did not close the stats page`);
    // ---- The live pill opens the connection screen (Max's pick Y, 2026-11-18): the state, Sweden drawn, the numbers ----
    await page.click('#status');
    await sleep(1500);
    const cn = await page.evaluate(() => ({ open: !document.getElementById('conn-page').hidden, title: document.getElementById('conn-title').textContent,
      state: document.querySelector('#conn-body .conn-hero')?.dataset.state, map: document.querySelector('#conn-body .conn-map canvas')?.width ?? 0,
      trains: document.querySelector('#conn-body .n-trains')?.textContent }));
    expect(cn.open && cn.title === connWord && cn.state && cn.map > 0 && Number(cn.trains) > 0,
      `${lang}/${theme}: the live pill opened ${cn.open ? `"${cn.title}" (state ${cn.state}, Sweden ${cn.map ? 'drawn' : 'missing'}, ${cn.trains} trains)` : 'nothing'}`);
    await page.click('#conn-page .panel-close');
    await sleep(300);
    stats = st.sections;
    expect(!page.errors.length, `${lang}/${theme}: page errors: ${page.errors.slice(0, 2).join(' | ')}`);
    await page.close();
  }

  const page = await openMap(browser, { ...base, lang: 'en', theme: 'light' });
  await page.evaluate(() => { window.__samePage = true; });

  // ---- A tap on a train opens its card ----
  const tapped = await page.evaluate(() => {
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
    // Nor under a station's name (close in a tap there opens the station).
    const covered = q => groups.some(r => q.x > r.left - 4 && q.x < r.right + 4 && q.y > r.top - 4 && q.y < r.bottom + 4)
      || m.queryRenderedFeatures([[q.x - 8, q.y - 8], [q.x + 8, q.y + 8]], { layers: ['station-names'] }).length > 0;
    const f = m.queryRenderedFeatures({ layers: ['train-dots'] }).filter(f => lone.has(f.properties.id) && !covered(m.project(f.geometry.coordinates)))
      .sort((a, b) => d(a) - d(b))[0];
    if (!f) return null;
    const q = m.project(f.geometry.coordinates);
    m.fire('click', { point: q, lngLat: m.unproject(q), originalEvent: new MouseEvent('click') });
    return String(window.__trains.get(f.properties.id).number);
  });
  await sleep(1500);
  const head = await page.evaluate(() => (!document.getElementById('panel').hidden ? document.querySelector('#panel .panel-head strong')?.textContent
    : !document.getElementById('picker').hidden ? `the group list: ${document.querySelector('#picker strong')?.textContent}`
    : !document.getElementById('board').hidden ? `the board of ${document.querySelector('#board strong, #board h2')?.textContent}` : null));
  expect(tapped && head?.startsWith(tapped), `tapping train ${tapped} opened ${head ? `"${head}"` : 'nothing'}`);

  // ---- The compact card (2026-11-15): two tiles; the stop tile lists the stops ahead and counts down to the one
  // picked; "All stops" opens it full; no × on a phone; Settings → Train card: Expanded opens it full ----
  // Trafikverket gives out a day's timetable only for a few days: the 12 Nov recording's routes were there on 15 Nov,
  // gone on 16 Nov (every train "no stops"). Since 2026-11-17 the replay brings its own (CARD_HOUR's routes file); in
  // the files run, or without that file, the card's parts can't be checked: said so, not failed.
  await sleep(2000);   // the route
  // Since plan step 4 (2026-11-17) the files run's taps come from the fetcher's tap files, which a replaying fetcher
  // doesn't make (no timetable): the card says so (an error state), checked live by tools/taps-check.mjs instead.
  const noRoute = head && await page.evaluate(() => Boolean(document.querySelector('#panel .state.empty, #panel .state.error')) && !document.querySelector('#panel .tile'));
  if (noRoute) cardNote = filesAt ? ' (card parts not checked: a replaying fetcher makes no tap files; tools/taps-check.mjs checks them live)'
    : ' (card parts not checked: the replay\'s day is no longer at Trafikverket)';
  if (head && !noRoute) {
    const card = () => page.evaluate(() => {
      const el = document.getElementById('panel'), stop = el.querySelector('.cd-stop');
      return { tiles: el.querySelectorAll('.tile').length, late: el.querySelector('.cd-late b')?.textContent ?? '', stop: stop?.innerText.replace(/\n/g, ' ') ?? '',
        button: stop?.tagName === 'BUTTON', rows: [...el.querySelectorAll('.cd-row .cd-name b')].map(b => b.textContent),
        full: el.classList.contains('full'), close: el.querySelector('.panel-close')?.getBoundingClientRect().width ?? -1,
        timeline: el.querySelector('.panel-table')?.getBoundingClientRect().height ?? -1 };
    });
    let c = await card();
    expect(c.tiles === 2 && c.late, `the card shows ${c.tiles} tiles, lateness "${c.late}"`);
    expect(c.close === 0, 'the card shows a × on a phone');
    expect(!c.full && c.timeline === 0, 'the card opened full, or shows its timeline, though Compact is the default');
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
    await page.click('#panel .panel-more');
    await sleep(500);
    c = await card();
    expect(c.full && c.timeline > 0, '"More" did not open the full card with its timeline');
  }
  await page.evaluate(() => document.querySelector('#panel .panel-close')?.click());
  await sleep(500);

  // ---- Every "N trains" label lists exactly N ----
  let groups = 0;
  for (const zoom of [11, 12, 13]) {
    await page.evaluate(z => window.__map.jumpTo({ center: [18.06, 59.33], zoom: z }), zoom);
    await sleep(1200);
    const labels = await page.evaluate(() => [...document.querySelectorAll('.near-label.group')].map((e) => { const r = e.getBoundingClientRect();
      return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, n: parseInt(e.textContent, 10) }; })
      .filter(q => q.x > 20 && q.x < innerWidth - 20 && q.y > 70 && q.y < innerHeight - 30));
    for (const g of labels) {
      await page.evaluate(() => { document.getElementById('picker').hidden = true; });
      await page.mouse.click(g.x, g.y);
      await sleep(250);
      const rows = await page.evaluate(() => (document.getElementById('picker').hidden ? null : document.querySelectorAll('#picker [data-i]').length));
      if (rows === null) continue;   // the trains moved on and the tap missed the label
      groups++;
      expect(rows === g.n, `a "${g.n} trains" label listed ${rows} (zoom ${zoom})`);
      await page.evaluate(() => { document.getElementById('picker').hidden = true; document.querySelector('#panel .panel-close')?.click(); });
    }
  }
  // Far out the map groups close labels too (2026-11-15): a tap on one lists its trains, as many as it says.
  let farGroups = 0;
  for (const zoom of [8, 9]) {
    await page.evaluate(z => window.__map.jumpTo({ center: [18.0, 59.35], zoom: z }), zoom);
    await sleep(2500);
    const found = await page.evaluate(() => window.__map.queryRenderedFeatures({ layers: ['train-labels'] })
      .filter(f => f.properties.point_count).map(f => ({ n: f.properties.point_count, q: window.__map.project(f.geometry.coordinates) }))
      .filter(g => g.q.x > 40 && g.q.x < innerWidth - 40 && g.q.y > 90 && g.q.y < innerHeight - 60).slice(0, 3));
    for (const g of found) {
      let rows = null;
      for (const dy of [15, 18, -15, 0]) {   // the label is under its point, or moved above it
        await page.evaluate(() => { document.getElementById('picker').hidden = true; });
        await page.evaluate((x, y) => { const m = window.__map; m.fire('click', { point: { x, y }, lngLat: m.unproject([x, y]), originalEvent: new MouseEvent('click') }); }, g.q.x, g.q.y + dy);
        await sleep(300);
        rows = await page.evaluate(() => (document.getElementById('picker').hidden ? null : document.querySelectorAll('#picker [data-i]').length));
        if (rows !== null) break;
      }
      if (rows === null) continue;
      farGroups++;
      expect(rows === g.n, `far out (zoom ${zoom}), a "${g.n} trains" label listed ${rows}`);
    }
    await page.evaluate(() => { document.getElementById('picker').hidden = true; document.querySelector('#panel .panel-close')?.click(); });
  }
  expect(farGroups > 0, 'far out, no "N trains" label could be tapped');

  // ---- Tilted far, the trains near the bottom of the screen are drawn (2026-11-15: closer tiles load at a higher
  // zoom, and the drops vanished there below the model zoom). Checked by pixels, since the map counts an invisible
  // drop as placed: a drop is a strong colour, the map round it pale. ----
  await page.evaluate(() => window.__map.jumpTo({ center: [17.99, 59.333], zoom: 11.14, pitch: 70, bearing: 0 }));
  await sleep(3500);
  const low = await page.evaluate(() => {
    const m = window.__map, W = m.getCanvas().clientWidth, H = m.getCanvas().clientHeight;
    return (window.__last3d ?? []).map(x => m.project([x.lon, x.lat])).filter(q => q.x > 30 && q.x < W - 30 && q.y > H * 0.6 && q.y < H - 40)
      .slice(0, 4).map(q => ({ x: Math.round(q.x) - 12, y: Math.round(q.y) - 12, width: 24, height: 24 }));
  });
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
  expect(!low.length || lowSeen === low.length, `tilted far, ${low.length - lowSeen} of ${low.length} trains near the bottom of the screen not drawn`);
  await page.evaluate(() => window.__map.jumpTo({ pitch: 0 }));

  // ---- Search lists every matching train, in a list that scrolls ----
  await page.click('#menu-button');
  await sleep(400);
  await page.keyboard.type('2');
  await sleep(1500);
  const search = await page.evaluate(() => ({ rows: document.querySelectorAll('#search-results button').length,
    onMap: window.__trains.reports().filter(r => String(r.number).startsWith('2')).length,
    scrolls: document.getElementById('search-results').scrollHeight > document.getElementById('search-results').clientHeight }));
  expect(search.rows >= Math.min(search.onMap, 200), `search "2": ${search.rows} rows for ${search.onMap} trains on the map`);
  expect(search.onMap < 12 || search.scrolls, 'the search list does not scroll');

  // ---- A setting changes at once, without reloading the page ----
  await page.evaluate(() => { document.getElementById('search').value = ''; document.querySelector('#menu .menu-close').click(); });
  await sleep(300);
  await page.evaluate(() => { document.getElementById('nav-button').click(); document.getElementById('open-settings').click(); });
  await sleep(400);
  await page.click('#settings [data-key="theme"] [data-v="dark"]');
  await sleep(4000);
  const after = await page.evaluate(() => ({ same: window.__samePage === true, theme: document.documentElement.dataset.theme,
    layers: ['rail-trv', 'train-dots', 'trains-3d', 'train-labels'].filter(id => window.__map.getLayer(id)).length }));
  expect(after.same, 'changing the look reloaded the page');
  expect(after.theme === 'dark' && after.layers === 4, `after choosing Dark: look ${after.theme}, ${after.layers} of 4 of our map layers`);
  // The accent colour (Settings → Accent colour, 2026-11-15): a swatch sets the page's accent and the route's colour.
  await page.click('#settings [data-key="accent"] [data-v="ocean"]');
  await sleep(3000);
  const accent = await page.evaluate(() => ({ css: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    route: JSON.stringify(window.__map.getPaintProperty('path-line', 'line-gradient')), pressed: document.querySelector('#settings [data-key="accent"] [aria-pressed="true"]')?.dataset.v }));
  expect(accent.css === '#5fa8ff' && accent.route.includes('#5fa8ff') && accent.pressed === 'ocean',
    `after choosing Ocean in dark: --accent ${accent.css}, route ${accent.route.slice(0, 60)}, pressed ${accent.pressed}`);
  await page.evaluate(() => localStorage.removeItem('settings'));
  expect(!page.errors.length, `page errors: ${page.errors.slice(0, 2).join(' | ')}`);

  // ---- A train picked in the search with the keyboard up (a short page) is held mid-map once the keyboard is gone
  // (Max, 2026-11-15: it stayed too high) ----
  {
    const phone = { width: 393, height: 851, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
    const kb = await openMap(browser, { ...base, size: phone, lang: 'en', view: '9/59.33/18.06' });
    await sleep(3000);
    await kb.setViewport({ ...phone, height: 430 });
    await sleep(400);
    // A train on the map in this replay (2311 was the rush hour's): the one nearest the middle with a 4-digit number.
    const pick = await kb.evaluate(() => { const m = window.__map, c = m.getCenter();
      return (window.__last3d ?? []).map(x => ({ n: String(window.__trains.get(x.id)?.number ?? ''), d: Math.hypot(x.lon - c.lng, x.lat - c.lat) }))
        .filter(x => /^\d{4}$/.test(x.n)).sort((a, b) => a.d - b.d)[0]?.n ?? '2311'; });
    await kb.click('#menu-button'); await sleep(300);
    await kb.keyboard.type(pick, { delay: 30 }); await sleep(700);
    await kb.click('#search-results button');
    await sleep(300);
    await kb.setViewport(phone);
    await sleep(3500);
    const y = await kb.evaluate(() => { const b = document.querySelector('.sel-train')?.getBoundingClientRect(); return b ? Math.round(b.top + b.height / 2) : null; });
    const want = Math.round((phone.height - (Math.round(phone.height * 0.45) + 20)) / 2);
    expect(y !== null && Math.abs(y - want) < 20, `a train picked with the keyboard up is held at y ${y}, not about ${want}`);
    await kb.close();
  }

  // ---- Models ----
  let models;
  try { models = JSON.parse(execFileSync('node', ['tools/models-check.mjs', '--json'], { encoding: 'utf8' })); }
  catch (e) { models = JSON.parse(String(e.stdout || '{"compact":-1,"realistic":-1}')); }
  expect(models.compact === 0 && models.realistic === 0, `model surfaces on top of each other: compact ${models.compact}, realistic ${models.realistic}`);

  console.log(problems.length ? `UI check FAILED (${runName}):` : `UI check ok (${runName}): ` +
    `both languages and looks start clean, a tap opens train ${tapped}${cardNote}, ${groups} group labels match their lists (${farGroups} far out), tilted: ${lowSeen} of ${low.length} near trains drawn, ` +
    `search "2" lists ${search.rows} (${search.onMap} on the map), Dark without reloading, the stats page opens (${stats} sections), filter ${filtered}, model surfaces 0`);
  for (const p of problems) console.log('  -', p);
} finally {
  await browser.close();
}
process.exit(problems.length ? 1 : 0);
