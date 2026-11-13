// A quick check of the screens, in a phone-sized headless browser, on the rush-hour replay (or live, when that
// recording isn't in data/). Run by tools/check.mjs; or alone: node tools/ui-check.mjs
// Needs `npm run dev` going. Exit code 0: all good; 1: something failed (it says what); 2: the page isn't running.
// Checked: the page starts without errors in English/light and Swedish/dark; a tap opens a train's card; every
// "N trains" label lists exactly N; a search lists every matching train and scrolls; a setting changes without the
// page reloading; no model has surfaces on top of each other (tools/models-check.mjs).
// Not checkable here: a pinch (never zooms the page in this browser), the phone's keyboard, flicker, speed.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, openMap, sleep, PAGE, RUSH_HOUR } from './lib/browser.mjs';

try { await fetch(PAGE); } catch { console.log(`UI check skipped: nothing answers at ${PAGE} (start it with npm run dev)`); process.exit(2); }

const replay = existsSync(`data/positions-${RUSH_HOUR}.jsonl`) ? RUSH_HOUR : null;
const base = { ...(replay ? { replay } : {}), view: '12/59.33/18.06', train: 'toy' };
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };

const browser = await launch();
try {
  // ---- Both languages and looks start clean ----
  for (const [lang, theme, word] of [['en', 'light', 'Settings'], ['sv', 'dark', 'Inställningar']]) {
    const page = await openMap(browser, { ...base, lang, theme });
    const s = await page.evaluate(() => ({ title: document.title, lang: document.documentElement.lang, theme: document.documentElement.dataset.theme,
      word: document.querySelector('#open-settings b').textContent, trains: window.__trains.count, status: document.getElementById('status').textContent }));
    expect(s.trains > 0, `${lang}/${theme}: no trains on the map (${s.status})`);
    expect(s.title === 'Spårad', `${lang}/${theme}: the title is "${s.title}"`);
    expect(s.lang === lang && s.theme === theme && s.word === word, `${lang}/${theme}: shows lang ${s.lang}, look ${s.theme}, menu "${s.word}"`);
    expect(!page.errors.length, `${lang}/${theme}: page errors: ${page.errors.slice(0, 2).join(' | ')}`);
    await page.close();
  }

  const page = await openMap(browser, { ...base, lang: 'en', theme: 'light' });
  await page.evaluate(() => { window.__samePage = true; });

  // ---- A tap on a train opens its card ----
  const tapped = await page.evaluate(() => {
    const m = window.__map, c = m.project(m.getCenter());
    const d = f => { const q = m.project(f.geometry.coordinates); return Math.hypot(q.x - c.x, q.y - c.y); };
    const lone = new Set(m.queryRenderedFeatures({ layers: ['train-labels-near', 'train-labels'] }).map(f => f.properties.id));
    const f = m.queryRenderedFeatures({ layers: ['train-dots'] }).filter(f => lone.has(f.properties.id)).sort((a, b) => d(a) - d(b))[0];
    if (!f) return null;
    const q = m.project(f.geometry.coordinates);
    m.fire('click', { point: q, lngLat: m.unproject(q), originalEvent: new MouseEvent('click') });
    return String(window.__trains.get(f.properties.id).number);
  });
  await sleep(1500);
  const head = await page.evaluate(() => (document.getElementById('panel').hidden ? null : document.querySelector('#panel .panel-head strong')?.textContent));
  expect(tapped && head?.startsWith(tapped), `tapping train ${tapped} opened ${head ? `"${head}"` : 'nothing'}`);
  await page.evaluate(() => document.querySelector('#panel .panel-close')?.click());
  await sleep(500);

  // ---- Every "N trains" label lists exactly N ----
  let groups = 0;
  for (const zoom of [11, 12, 13]) {
    await page.evaluate(z => window.__map.jumpTo({ center: [18.06, 59.33], zoom: z }), zoom);
    await sleep(1200);
    const labels = await page.evaluate(() => window.__map.queryRenderedFeatures({ layers: ['train-group-labels'] }).map((g) => {
      const q = window.__map.project(g.geometry.coordinates);
      return { x: q.x, y: q.y + 12, n: g.properties.point_count };
    }).filter(q => q.x > 20 && q.x < innerWidth - 20 && q.y > 70 && q.y < innerHeight - 30));
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
  await page.evaluate(() => localStorage.removeItem('settings'));
  expect(!page.errors.length, `page errors: ${page.errors.slice(0, 2).join(' | ')}`);

  // ---- Models ----
  let models;
  try { models = JSON.parse(execFileSync('node', ['tools/models-check.mjs', '--json'], { encoding: 'utf8' })); }
  catch (e) { models = JSON.parse(String(e.stdout || '{"compact":-1,"realistic":-1}')); }
  expect(models.compact === 0 && models.realistic === 0, `model surfaces on top of each other: compact ${models.compact}, realistic ${models.realistic}`);

  console.log(problems.length ? `UI check FAILED (${replay ? 'rush-hour replay' : 'live'}):` : `UI check ok (${replay ? 'rush-hour replay' : 'live'}): ` +
    `both languages and looks start clean, a tap opens train ${tapped}, ${groups} group labels match their lists, ` +
    `search "2" lists ${search.rows} (${search.onMap} on the map), Dark without reloading, model surfaces 0`);
  for (const p of problems) console.log('  -', p);
} finally {
  await browser.close();
}
process.exit(problems.length ? 1 : 0);
