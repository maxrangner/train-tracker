// Max's notes of 2026-11-20 in the test browser (phone size, the rush-hour replay):
//   - one screen at a time: Störningar, then Statistik, leaves only Statistik; closed, none is left;
//   - Settings → Debug → Screen over a train: 'card' the train's card is back after the screen, 'follow' the card goes
//     and the train stays open and followed (a tap on it brings the card back), 'clear' the card and train go;
//   - the Train card setting is gone and the default accent is Azurblå (cerulean);
//   - the map works with the menu open (a drag moves it, the menu stays), a plain tap on the map closes the menu;
//   - the compass: "3D" while flat and north up, a tap tilts the view (> 40°), the next tap makes it flat again;
//   - a swipe down on an expanded card's timetable (scrolled to its top) makes the card compact.
// node tools/screens-check.mjs (with npm run dev; PAGE= for another port). Not seen here: the phone's keyboard, the
// real smoothness of the moves.
import { launch, address, sleep, PHONE, RUSH_HOUR } from './lib/browser.mjs';

const browser = await launch();
const fails = [];
const ok = [];
const check = (cond, what) => (cond ? ok : fails).push(what);
try {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch { /* none */ } });
  await page.goto(address({ replay: RUSH_HOUR, lang: 'en', view: '12/59.33/18.06' }), { waitUntil: 'domcontentloaded' });
  for (let t0 = Date.now(); Date.now() - t0 < 30000; await sleep(300)) {
    if (await page.evaluate(() => (window.__trains?.count ?? 0) > 0 && Boolean(window.__map?.loaded())).catch(() => false)) break;
  }
  await sleep(1500);
  const shown = id => page.evaluate(i => !document.getElementById(i).hidden, id);
  const click = sel => page.evaluate(s => document.querySelector(s).click(), sel);
  const setOver = v => page.evaluate((x) => { const s = JSON.parse(localStorage.getItem('settings') ?? '{}'); s.pageOverTrain = x; localStorage.setItem('settings', JSON.stringify(s)); }, v);
  // a train in view, opened the way a tap does (the search: its number, Enter)
  const openTrain = async () => {
    const number = await page.evaluate(() => { const f = window.__map.queryRenderedFeatures({ layers: ['train-dots'] })[0];
      return f ? String(window.__trains.get(f.properties.id).number) : null; });
    await click('#menu-button');
    await sleep(400);
    await page.type('#search', number ?? '');
    await sleep(600);
    await page.keyboard.press('Enter');
    await sleep(1500);
    return number;
  };

  // ---- one screen at a time ----
  await click('#nav-button'); await sleep(300);
  await click('#open-disruptions'); await sleep(300);
  await click('#nav-button'); await sleep(300);
  await click('#open-stats'); await sleep(500);
  check(!(await shown('disruptions-page')) && (await shown('stats-page')), 'Störningar then Statistik: only Statistik open');
  await click('#stats-page .panel-close'); await sleep(300);
  check(!(await shown('disruptions-page')) && !(await shown('stats-page')), 'Statistik closed: no screen left');

  // ---- the three choices for a screen over a train ----
  for (const mode of ['card', 'follow', 'clear']) {
    await setOver(mode);
    await page.goto('about:blank');   // (a new address end alone would not reload the page)
    await page.goto(address({ replay: RUSH_HOUR, lang: 'en', view: '12/59.33/18.06', overtrain: mode }), { waitUntil: 'domcontentloaded' });
    for (let t0 = Date.now(); Date.now() - t0 < 30000; await sleep(300)) {
      if (await page.evaluate(() => (window.__trains?.count ?? 0) > 0 && Boolean(window.__map?.loaded())).catch(() => false)) break;
    }
    await sleep(1500);
    await openTrain();
    const before = await page.evaluate(() => document.querySelector('#panel .panel-head strong, #panel strong')?.textContent ?? '');
    check(await shown('panel'), `${mode}: the train's card opened`);
    await click('#nav-button'); await sleep(300);
    await click('#open-settings'); await sleep(500);
    const under = await shown('panel');
    await click('#settings-page .panel-close'); await sleep(500);
    const after = await page.evaluate(() => ({ card: !document.getElementById('panel').hidden,
      selected: Boolean(document.querySelector('#panel')?.innerHTML) }));
    if (mode === 'card') check(after.card, 'card: the card is back after Settings');
    if (mode === 'follow') {
      check(!under && !after.card, 'follow: the card went with Settings and stays away');
      check(after.selected, 'follow: the train is still open (its card kept up to date, hidden)');
    }
    if (mode === 'clear') check(!under && !after.card && !after.selected, 'clear: card and train let go');
    void before;
  }

  // ---- defaults: no Train card row, Azurblå ----
  check(!(await page.evaluate(() => Boolean(document.querySelector('[data-key="trainCard"]')))), 'no Train card setting');
  await page.evaluate(() => localStorage.clear());
  await page.goto('about:blank');
  await page.goto(address({ replay: RUSH_HOUR, lang: 'en', view: '12/59.33/18.06' }), { waitUntil: 'domcontentloaded' });
  for (let t0 = Date.now(); Date.now() - t0 < 30000; await sleep(300)) {
    if (await page.evaluate(() => (window.__trains?.count ?? 0) > 0 && Boolean(window.__map?.loaded())).catch(() => false)) break;
  }
  await sleep(1000);
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase());
  check(['#0b7a9a', '#77d2f5'].includes(accent), `default accent Azurblå (got ${accent})`);

  // ---- the map with the menu open ----
  await click('#nav-button'); await sleep(400);
  const c0 = await page.evaluate(() => window.__map.getCenter().toArray());
  await page.mouse.move(200, 600); await page.mouse.down(); await page.mouse.move(200, 500, { steps: 8 }); await page.mouse.up();
  await sleep(600);
  const c1 = await page.evaluate(() => window.__map.getCenter().toArray());
  check(Math.abs(c1[1] - c0[1]) > 1e-4 && (await shown('nav')), 'menu open: a drag moves the map, the menu stays');
  await page.mouse.click(120, 650); await sleep(500);
  check(!(await shown('nav')), 'menu open: a tap on the map closes it');
  check(!(await shown('panel')), 'menu open: that tap did nothing else');

  // ---- the compass: 3D when flat ----
  const btn = '.maplibregl-ctrl-compass';
  const flatInfo = await page.evaluate((s) => { const b = document.querySelector(s); const r = b?.getBoundingClientRect();
    return { seen: Boolean(b && r.width > 0 && getComputedStyle(b).display !== 'none'), text: b?.textContent.trim() ?? '' }; }, btn);
  check(flatInfo.seen && /3D/.test(flatInfo.text), `flat: the compass shows "3D" (seen ${flatInfo.seen}, "${flatInfo.text}")`);
  await click(btn); await sleep(1500);
  const p1 = await page.evaluate(() => window.__map.getPitch());
  check(p1 > 40, `"3D" tilts the view (${p1.toFixed(0)}°)`);
  await click(btn); await sleep(1500);
  const p2 = await page.evaluate(() => window.__map.getPitch());
  check(p2 < 1, `the compass makes it flat again (${p2.toFixed(0)}°)`);

  // ---- a swipe down on the expanded card's timetable ----
  await openTrain();
  await page.evaluate(() => document.getElementById('panel').classList.add('full'));
  await sleep(500);
  const list = await page.evaluate(() => { const l = document.querySelector('#panel .panel-table, #panel .cd-list');
    if (!l) return null; l.scrollTop = 0; const r = l.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 40 }; });
  if (!list) fails.push('swipe: no timetable list in the card');
  else {
    await page.touchscreen.touchStart(list.x, list.y);
    for (let i = 1; i <= 10; i++) { await page.touchscreen.touchMove(list.x, list.y + i * 9); await sleep(16); }
    await page.touchscreen.touchEnd();
    await sleep(800);
    const full = await page.evaluate(() => document.getElementById('panel').classList.contains('full'));
    check(!full && (await shown('panel')), 'a swipe down on the timetable (at its top) makes the card compact');
  }
  check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
}
for (const o of ok) console.log(`ok   ${o}`);
for (const f of fails) console.log(`FAIL ${f}`);
console.log(fails.length ? `screens check: ${fails.length} failed` : 'screens check: all passed');
process.exit(fails.length ? 1 : 0);
