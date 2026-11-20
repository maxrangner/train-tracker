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
import { launch, address, sleep, PHONE, RUSH_HOUR, CARD_HOUR } from './lib/browser.mjs';

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

  // ---- ☰ answers at once after a screen is swiped away (Max, 2026-11-20): Settings' dimming let taps through as it
  // slid away, and a tap within ~0.4 s of a swipe got no click (sheet.js onTap acts on the finger lifted) ----
  const centre = s => page.evaluate(q => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, s);
  const touchTap = async (s) => { const c = await centre(s); await page.touchscreen.tap(c.x, c.y); };
  for (const [name, button, id] of [['Settings', 'open-settings', 'settings-page'], ['Statistics', 'open-stats', 'stats-page']]) {
    await touchTap('#nav-button'); await sleep(400);
    await touchTap(`#${button}`); await sleep(700);
    const top = await page.evaluate(i => { const b = document.getElementById(i).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 12 }; }, id);
    await page.touchscreen.touchStart(top.x, top.y);
    for (let k = 1; k <= 8; k++) { await page.touchscreen.touchMove(top.x, top.y + k * 25); await sleep(16); }
    await page.touchscreen.touchEnd();
    await sleep(30);
    await touchTap('#nav-button');
    await sleep(300);
    check(await shown('nav'), `${name} swiped away, ☰ tapped 30 ms later: the menu opens`);
    await click('#nav-button'); await sleep(300);
    await page.evaluate(i => { document.getElementById(i).hidden = true; }, id);
  }

  // ---- search → ☰ with a keyboard (stood in for: the page 430 px shorter while typing, gone 150 ms after ☰): the map
  // keeps its height the whole way (Max, 2026-11-20: a flicker; it went 851 → 421 → 851 px) ----
  await click('#menu-button'); await sleep(300);
  await page.type('#search', '1');
  await page.setViewport({ ...PHONE, height: PHONE.height - 430 });
  await sleep(600);
  await page.evaluate(() => { window.__mapHs = new Set(); const m = document.getElementById('map'), t0 = performance.now();
    const step = () => { window.__mapHs.add(m.clientHeight); if (performance.now() - t0 < 900) requestAnimationFrame(step); }; requestAnimationFrame(step); });
  await touchTap('#nav-button');
  await sleep(150);
  await page.setViewport(PHONE);
  await sleep(900);
  const hs = await page.evaluate(() => [...window.__mapHs]);
  check(hs.length === 1 && hs[0] === PHONE.height, `search → ☰ with the keyboard going: the map's height stays (${hs.join(', ')} px)`);
  await click('#nav-button'); await sleep(300);

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

  // ---- Statistik's map on Lateness before the lateness has come: grey and "Laddar…", not green ("on time") ----
  const heat = await page.evaluate(async () => {
    const { createSwedenMap } = await import('/src/stats-sweden.js');
    const m = createSwedenMap();
    document.body.append(m.el);
    m.el.style.cssText = 'position:fixed;left:0;top:0;z-index:99';
    const dots = late => Array.from({ length: 40 }, (_, i) => ({ id: String(i), lon: 15 + (i % 8) * 0.3, lat: 58 + Math.floor(i / 8) * 0.3, late }));
    const read = () => { const d = m.el.querySelector('canvas').getContext('2d').getImageData(0, 0, 400, 600).data; let green = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100 && d[i + 1] > d[i] + 40 && d[i + 1] > d[i + 2] + 20) green++;
      return { wait: !m.el.querySelector('.st-se-wait').hidden, green }; };
    m.setMode('lateness');
    m.update({ dots: dots(undefined) });
    await new Promise(r => setTimeout(r, 100));
    const before = read();
    m.update({ dots: dots('ontime') });
    await new Promise(r => setTimeout(r, 100));
    const after = read();
    m.setMode('trains');
    m.el.remove();
    return { before, after };
  });
  check(heat.before.wait && heat.before.green === 0, `Statistik's lateness map, no lateness known: "Laddar…" and no green (${JSON.stringify(heat.before)})`);
  check(!heat.after.wait && heat.after.green > 0, `…and once it is known: the colours, no "Laddar…" (${JSON.stringify(heat.after)})`);

  // ---- the far south above a phone's card: zoomed out, the map may go far enough south that Köpenhamn (55.7°)
  // stands above the card (until 2026-11-20 it stopped at 52°, with Hyllie and Köpenhamn at the card's edge) ----
  const south = await page.evaluate(async () => {
    window.__map.jumpTo({ zoom: 5, center: [13.5, 53.5] });
    await new Promise(r => setTimeout(r, 300));
    const p = window.__map.project([12.57, 55.68]);
    return { lat: window.__map.getCenter().lat, y: p.y, h: window.innerHeight };
  });
  check(south.y < south.h * 0.55 - 20, `zoomed out, Köpenhamn can stand above a card (centre ${south.lat.toFixed(1)}°, at ${Math.round(south.y)} of ${south.h} px)`);
  await page.evaluate(() => window.__map.jumpTo({ zoom: 12, center: [18.06, 59.33] }));
  await sleep(800);

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

  // ---- a swipe down on the expanded card's timetable (the evening recording: its trains' timetables are saved) ----
  await page.goto('about:blank');
  await page.goto(address({ replay: CARD_HOUR, lang: 'en', view: '12/59.33/18.06' }), { waitUntil: 'domcontentloaded' });
  for (let t0 = Date.now(); Date.now() - t0 < 30000; await sleep(300)) {
    if (await page.evaluate(() => (window.__trains?.count ?? 0) > 0 && Boolean(window.__map?.loaded())).catch(() => false)) break;
  }
  await sleep(1500);
  await openTrain();
  for (let t0 = Date.now(); Date.now() - t0 < 15000; await sleep(300)) {
    if (await page.evaluate(() => Boolean(document.querySelector('#panel .panel-more')))) break;
  }
  await page.evaluate(() => document.querySelector('#panel .panel-more')?.click());   // "All stops": the expanded card
  await sleep(800);
  const swipe = async (x, y, dy) => {
    await page.touchscreen.touchStart(x, y);
    for (let i = 1; i <= 10; i++) { await page.touchscreen.touchMove(x, y + i * dy / 10); await sleep(16); }
    await page.touchscreen.touchEnd();
    await sleep(800);
  };
  const isFull = () => page.evaluate(() => document.getElementById('panel').classList.contains('full'));
  const listAt = () => page.evaluate(() => { const l = document.querySelector('#panel .panel-table');
    if (!l) return null; l.scrollTop = 0; const r = l.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 40 }; });
  let list = await listAt();
  if (!list) fails.push('swipe: no timetable list in the card');
  else {
    // up in the list: it scrolls, the card stays expanded
    await swipe(list.x, list.y + 200, -150);
    const top = await page.evaluate(() => document.querySelector('#panel .panel-table').scrollTop);
    check(top > 20 && (await isFull()), `a swipe up on the timetable scrolls it (${Math.round(top)} px), the card stays expanded`);
    list = await listAt();
    await swipe(list.x, list.y, 90);
    check(!(await isFull()) && (await shown('panel')), 'a swipe down on the timetable (at its top) makes the card compact');
    // on a button: a swipe down makes it compact, a tap is still the button's
    await page.evaluate(() => document.querySelector('#panel .panel-more')?.click());
    await sleep(800);
    const more = await page.evaluate(() => { const r = document.querySelector('#panel .panel-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await swipe(more.x, more.y, 90);
    check(!(await isFull()), 'a swipe down that starts on a button makes the card compact');
    const more2 = await page.evaluate(() => { const r = document.querySelector('#panel .panel-more').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.touchscreen.tap(more2.x, more2.y);
    await sleep(800);
    check(await isFull(), 'a tap on that button still works (All stops)');
  }
  check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
}
for (const o of ok) console.log(`ok   ${o}`);
for (const f of fails) console.log(`FAIL ${f}`);
console.log(fails.length ? `screens check: ${fails.length} failed` : 'screens check: all passed');
process.exit(fails.length ? 1 : 0);
