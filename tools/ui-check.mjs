// A quick check of the screens, in a phone-sized headless browser, on the rush-hour replay (or live, when that
// recording isn't in data/). Run by tools/check.mjs; or alone: node tools/ui-check.mjs
// Needs `npm run dev` going. Exit code 0: all good; 1: something failed (it says what); 2: the page isn't running.
// Checked: the page starts without errors in English/light and Swedish/dark; a tap opens a train's card; every
// "N trains" label lists exactly N; a search lists every matching train and scrolls; a setting changes without the
// page reloading; no model has surfaces on top of each other (tools/models-check.mjs); a tap on the banner opens the
// stats page in each language, filled in (Sweden drawn), a train tapped there opens its card, and × closes it; the compact train card (tiles, the stop list, "All stops"); a tap on a company there shows only its trains, and × on
// the bar that appears shows them all again.
// Not checkable here: a pinch (never zooms the page in this browser), the phone's keyboard, flicker, speed.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, openMap, sleep, PAGE, RUSH_HOUR } from './lib/browser.mjs';

try { await fetch(PAGE); } catch { console.log(`UI check skipped: nothing answers at ${PAGE} (start it with npm run dev)`); process.exit(2); }

const replay = existsSync(`data/positions-${RUSH_HOUR}.jsonl`) ? RUSH_HOUR : null;
const base = { ...(replay ? { replay } : {}), view: '12/59.33/18.06', train: 'toy' };
const problems = [];
let stats = 0;   // sections on the stats page
let filtered = '';   // the filter step's result
let cardNote = '';   // said in the ok line when the card's parts couldn't be checked
const expect = (ok, what) => { if (!ok) problems.push(what); };

const browser = await launch();
try {
  // ---- Both languages and looks start clean ----
  for (const [lang, theme, word, statsWord] of [['en', 'light', 'Settings', 'Live statistics'], ['sv', 'dark', 'Inställningar', 'Statistik just nu']]) {
    const page = await openMap(browser, { ...base, lang, theme });
    const s = await page.evaluate(() => ({ title: document.title, lang: document.documentElement.lang, theme: document.documentElement.dataset.theme,
      word: document.querySelector('#open-settings b').textContent, trains: window.__trains.count, status: document.getElementById('status').textContent }));
    expect(s.trains > 0, `${lang}/${theme}: no trains on the map (${s.status})`);
    expect(s.title === 'Spårat', `${lang}/${theme}: the title is "${s.title}"`);
    expect(s.lang === lang && s.theme === theme && s.word === word, `${lang}/${theme}: shows lang ${s.lang}, look ${s.theme}, menu "${s.word}"`);
    // ---- The banner opens the stats page; × closes it ----
    await page.click('#status');
    await sleep(1200);
    const st = await page.evaluate(() => ({ open: !document.getElementById('stats-page').hidden, title: document.getElementById('stats-title').textContent,
      first: document.querySelector('#stats-body .st-big')?.textContent ?? '', bars: document.querySelectorAll('#stats-body .st-bar').length,
      sections: document.querySelectorAll('#stats-body .st-sec').length, trains: window.__trains.count,
      map: document.querySelector('#stats-body canvas')?.width ?? 0 }));
    expect(st.open && st.title === statsWord, `${lang}/${theme}: the banner opened ${st.open ? `"${st.title}"` : 'nothing'}`);
    expect(st.first.startsWith(String(st.trains)) && st.bars > 0 && st.sections === 9 && st.map > 0,
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
      await page.click('#status');
      await sleep(800);
    }
    await page.click('#stats-page .panel-close');
    await sleep(300);
    expect(await page.evaluate(() => document.getElementById('stats-page').hidden), `${lang}/${theme}: × did not close the stats page`);
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
    const f = m.queryRenderedFeatures({ layers: ['train-dots'] }).filter(f => lone.has(f.properties.id)).sort((a, b) => d(a) - d(b))[0];
    if (!f) return null;
    const q = m.project(f.geometry.coordinates);
    m.fire('click', { point: q, lngLat: m.unproject(q), originalEvent: new MouseEvent('click') });
    return String(window.__trains.get(f.properties.id).number);
  });
  await sleep(1500);
  const head = await page.evaluate(() => (document.getElementById('panel').hidden ? null : document.querySelector('#panel .panel-head strong')?.textContent));
  expect(tapped && head?.startsWith(tapped), `tapping train ${tapped} opened ${head ? `"${head}"` : 'nothing'}`);

  // ---- The compact card (2026-11-15): two tiles; the stop tile lists the stops ahead and counts down to the one
  // picked; "All stops" opens it full; no × on a phone; Settings → Train card: Expanded opens it full ----
  // Trafikverket gives out a day's timetable only for a few days: the 12 Nov recording's routes were there on 15 Nov,
  // gone on 16 Nov (every train "no stops"). Then the card's parts can't be checked in the replay: said so, not failed.
  await sleep(2000);   // the route
  const noRoute = head && await page.evaluate(() => Boolean(document.querySelector('#panel .state.empty')) && !document.querySelector('#panel .tile'));
  if (noRoute) cardNote = ' (card parts not checked: the replay\'s day is no longer at Trafikverket)';
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
    // In the replay a train's route is a past day's, every stop passed: "Arrived". Live, the stops ahead.
    if (c.button) {
      await page.click('#panel .cd-stop');
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
    expect(c.full && c.timeline > 0, '"All stops" did not open the full card with its timeline');
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
  await page.evaluate(() => { document.getElementById('search').value = ''; });
  await page.click('#open-settings');
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
    await kb.click('#menu-button'); await sleep(300);
    await kb.keyboard.type('2311', { delay: 30 }); await sleep(700);
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

  console.log(problems.length ? `UI check FAILED (${replay ? 'rush-hour replay' : 'live'}):` : `UI check ok (${replay ? 'rush-hour replay' : 'live'}): ` +
    `both languages and looks start clean, a tap opens train ${tapped}${cardNote}, ${groups} group labels match their lists (${farGroups} far out), tilted: ${lowSeen} of ${low.length} near trains drawn, ` +
    `search "2" lists ${search.rows} (${search.onMap} on the map), Dark without reloading, the stats page opens (${stats} sections), filter ${filtered}, model surfaces 0`);
  for (const p of problems) console.log('  -', p);
} finally {
  await browser.close();
}
process.exit(problems.length ? 1 : 0);
