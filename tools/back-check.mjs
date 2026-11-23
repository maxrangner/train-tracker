// The Android app's back button (2026-11-17), in the test browser: the app's bridge is stood in for (window.Capacitor
// says "native", the @capacitor/app module is replaced by a stub that keeps the page's back handler), then "back" is
// pressed. Since the one sheet (2026-11-22, src/stack.js) one press steps back one thing, in this order: the trail (the
// back chip held) → the search → the page on top → the sheet down to rest → the app to the background. Here: a
// station's board, a train from its rows on top, the trail open: back closes the trail, then the train, then the
// board; Home pulled up goes down; at rest the app goes away. ☰'s menu: back closes it, and only it. The search with
// the keyboard up: back hides only the keyboard, then the search closes (the sheet back where it was).
// node tools/back-check.mjs (with npm run dev; PAGE= for another port). Not the real phone: the press is the handler
// called directly. Also the buzz (2026-11-20): in the app it goes through the haptics plugin, here a stub that counts
// the calls; opening a train must buzz.
import { launch, address, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';
import { until, openStationByName, typeSearch, openMenu, setLevel, toRest } from './lib/screen.mjs';

const STUB = `export const App = {
  addListener(name, fn) { if (name === 'backButton') window.__back = fn; return Promise.resolve({ remove() {} }); },
  minimizeApp() { window.__minimized = true; return Promise.resolve(); },
};`;
const HAPTICS = `export const ImpactStyle = { Light: 'LIGHT' };
export const Haptics = { impact(o) { window.__buzz = (window.__buzz ?? 0) + 1; window.__buzzStyle = o?.style; return Promise.resolve(); } };`;

const browser = await launch();
const fails = [], notes = [];
try {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => { window.Capacitor = { isNativePlatform: () => true }; });
  await page.setRequestInterception(true);
  page.on('request', r => (/capacitor_app\.js|@capacitor\/app/.test(r.url()) ? r.respond({ status: 200, contentType: 'text/javascript', body: STUB })
    : /capacitor_haptics\.js|@capacitor\/haptics/.test(r.url()) ? r.respond({ status: 200, contentType: 'text/javascript', body: HAPTICS })
      : r.continue()));
  await page.goto(address({ replay: CARD_HOUR, lang: 'en', view: '11/59.33/18.06' }), { waitUntil: 'domcontentloaded' });
  for (let t0 = Date.now(); Date.now() - t0 < 30000; await sleep(300)) {
    if (await page.evaluate(() => (window.__trains?.count ?? 0) > 0 && Boolean(window.__map?.loaded()) && Boolean(window.__back) && Boolean(window.__stack?.top())).catch(() => false)) break;
  }
  await sleep(1500);
  const state = () => page.evaluate(() => ({ keys: window.__stack.keys().join(' > '), top: window.__stack.top(), level: window.__stack.level,
    searching: window.__stack.searching, trail: !document.getElementById('trail')?.hidden, nav: !document.getElementById('nav').hidden,
    typing: document.activeElement?.id === 'search', away: Boolean(window.__minimized) }));
  const say = s => `${s.keys} at ${s.level}${s.searching ? ', searching' : ''}${s.trail ? ', trail open' : ''}${s.nav ? ', ☰ open' : ''}${s.away ? ', AWAY' : ''}`;
  const back = async () => { await page.evaluate(() => window.__back({ canGoBack: false })); await sleep(550); return state(); };
  if (!(await page.evaluate(() => typeof window.__back === 'function'))) fails.push('the page did not register a back handler');
  else {
    // ---- the pages: Stockholm C's board, a train from its rows on top ----
    const station = await openStationByName(page, 'Stockholm C');
    if (!station) throw new Error('setup: no Stockholm C in the search');
    await until(page, () => Boolean(document.querySelector('#board .bd-row')), 10000);
    // a train from its rows that is on the map (one that isn't shows its stops only: no follow, no buzz); up to 8 rows
    for (let i = 0; i < 8; i++) {
      const picked = await page.evaluate((k) => { window.__buzz = 0; const b = document.querySelectorAll('#board .bd-row:not(.gone)')[k]; b?.click(); return Boolean(b); }, i);
      if (!picked) break;
      await until(page, () => window.__stack.top()?.startsWith('train:'), 4000);
      await sleep(1200);
      if (await page.evaluate(() => Boolean(window.__trains.get(window.__stack.top().slice(6))))) break;
      await page.evaluate(() => window.__stack.back());
      await sleep(600);
    }
    const buzzes = await page.evaluate(() => ({ n: window.__buzz ?? 0, style: window.__buzzStyle ?? null }));
    const s0 = await state();
    if (!s0.top?.startsWith('train:') || s0.keys.split(' > ').length !== 3) fails.push(`setup: ${say(s0)} (want Home > a station > a train)`);
    else {
      if (buzzes.n < 1 || buzzes.style !== 'LIGHT') fails.push(`opening a train in the app: ${buzzes.n} buzz(es) through the haptics plugin (want at least 1, light)`);
      // the trail: the back chip held (src/stack.js HOLD_MS 480)
      const chip = await page.evaluate(() => { const r = document.querySelector('#sheet .sh-back').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.mouse.move(chip.x, chip.y); await page.mouse.down(); await sleep(700); await page.mouse.up();
      await sleep(200);
      const t0 = await state();
      if (!t0.trail) fails.push(`setup: holding the back chip did not open the trail (${say(t0)})`);
      const s1 = await back();
      if (s1.trail || s1.top !== s0.top || s1.away) fails.push(`1st back: ${say(s1)} (want: the trail closed, the train still on top)`);
      const s2 = await back();
      if (s2.top !== station || s2.away) fails.push(`2nd back: ${say(s2)} (want: the train gone, the board on top)`);
      const s3 = await back();
      if (s3.top !== 'home' || s3.away) fails.push(`3rd back: ${say(s3)} (want: Home)`);
      if (s3.level > 0) {
        const s4 = await back();
        if (s4.level !== 0 || s4.away) fails.push(`4th back: ${say(s4)} (want: Home down at rest)`);
      }
      const s5 = await back();
      if (!s5.away) fails.push(`back at rest: ${say(s5)} (want: the app to the background)`);
      notes.push(`${s0.keys}: trail → ${s1.top} → ${s2.top} → ${s3.top} → at rest → away`);
    }

    // ---- the back chip (Max, 2026-11-23: "should always go home"): it says Home over any page and a tap takes every
    // page away; Android's back above still steps one at a time ----
    await page.evaluate(() => { window.__minimized = false; });
    const st2 = await openStationByName(page, 'Stockholm C');
    await until(page, () => Boolean(document.querySelector('#board .bd-row:not(.gone)')), 10000);
    await page.evaluate(() => document.querySelector('#board .bd-row:not(.gone)')?.click());
    await until(page, () => window.__stack.top()?.startsWith('train:'), 4000);
    await sleep(800);
    const c0 = await state();
    const word = await page.evaluate(() => document.querySelector('#sheet .sh-back span')?.textContent.trim());
    await page.evaluate(() => document.querySelector('#sheet .sh-back').click());
    await sleep(600);
    const c1 = await state();
    if (!st2 || c0.keys.split(' > ').length !== 3) fails.push(`the chip setup: ${say(c0)} (want Home > a station > a train)`);
    else if (!/^(Home|Hem)$/.test(word ?? '') || c1.keys !== 'home' || c1.away) fails.push(`the back chip over ${say(c0)}: said "${word}", after a tap ${say(c1)} (want "Home", only Home left)`);
    else notes.push(`the back chip over ${c0.keys}: "${word}", a tap → ${c1.keys}`);

    // ---- one "N trains here" over another (Max's phone, 2026-11-23: back to "2 trains here" showed an empty page):
    // back shows the first list's rows again ----
    await page.evaluate(() => { window.__minimized = false; });
    await toRest(page);
    await page.evaluate(() => {
      const ids = window.__trains.reports().map(r => r.id).filter(Boolean).slice(0, 5);
      const row = (id, i) => ({ id, label: String(2200 + i), company: 'Test' });
      window.__picker(ids.slice(0, 2).map(row));
      setTimeout(() => window.__picker(ids.slice(2, 5).map(row)), 500);
    });
    await sleep(1300);
    const p0 = await state();
    const p1 = await back();
    const rows = await page.evaluate(() => { const pg = document.querySelector(`#sheet .pg[data-key="${window.__stack.top()}"]`); return { n: pg?.querySelectorAll('.pick-list li').length ?? 0, shown: Boolean(pg?.querySelector('#picker:not([hidden])')) }; });
    if (p0.keys.split(' > ').filter(k => k.startsWith('pick:')).length !== 2) fails.push(`two pickers setup: ${say(p0)}`);
    else if (!p1.top?.startsWith('pick:') || rows.n !== 2 || !rows.shown) fails.push(`back from a picker to the one under: ${say(p1)}, ${rows.n} rows, list shown ${rows.shown} (want the first list's 2 rows)`);
    else notes.push(`two pickers: back shows the first one's ${rows.n} rows`);
    await back();

    // ---- Home pulled up: back takes it down, the next press leaves ----
    await page.evaluate(() => { window.__minimized = false; });
    await toRest(page);
    await setLevel(page, 2);
    const h1 = await back();
    if (h1.level !== 0 || h1.away) fails.push(`Home at full, back: ${say(h1)} (want: down at rest)`);

    // ---- ☰ (2026-11-18): back closes it, and only it ----
    await page.evaluate(() => { window.__minimized = false; });
    await openMenu(page);
    const n0 = await state();
    const n1 = await back();
    if (!n0.nav || n1.nav || n1.away || n1.top !== 'home') fails.push(`☰ and back: open ${n0.nav}, after back ${say(n1)} (want: ☰ closed, still here)`);

    // ---- the search with the keyboard open (2026-11-17): the page shortened by a keyboard's height (Max's phone:
    // 430 px); back → only the keyboard goes (the field loses focus, the search stays); back again → the search closes
    // and the sheet goes back to where it was (here: Home at half) ----
    await page.evaluate(() => { window.__minimized = false; });
    await toRest(page);
    await setLevel(page, 1);
    await page.click('#search');   // (not openSearch: it starts from rest)
    await until(page, () => window.__stack.searching);
    await typeSearch(page, '2');
    await page.setViewport({ ...PHONE, height: PHONE.height - 430 });
    await sleep(500);
    const k0 = await state();
    const k1 = await back();
    if (!k0.searching || !k0.typing) fails.push(`keyboard setup: ${say(k0)}, typing ${k0.typing}`);
    if (!k1.searching || k1.typing || k1.away) fails.push(`back with the keyboard up: ${say(k1)}, typing ${k1.typing} (want: the search open, the keyboard gone)`);
    await page.setViewport(PHONE);   // (the keyboard has gone)
    await sleep(400);
    const k2 = await back();
    if (k2.searching || k2.away || k2.level !== 1) fails.push(`back after the keyboard: ${say(k2)} (want: the search closed, Home at half as before)`);
  }
  if (errors.length) fails.push('page errors: ' + errors.slice(0, 3).join(' | '));
} finally { await browser.close(); }
for (const n of notes) console.log(`  ${n}`);
console.log(fails.length ? `back-check FAILED:\n  ${fails.join('\n  ')}` : 'back-check ok: trail → page → page → Home → down → background, one per press; ☰ alone; with the keyboard up, back hides only the keyboard, then the search');
process.exit(fails.length ? 1 : 0);
