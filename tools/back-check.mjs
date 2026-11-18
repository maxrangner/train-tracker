// The Android app's back button (2026-11-17), in the test browser: the app's bridge is stood in for (window.Capacitor
// says "native", the @capacitor/app module is replaced by a stub that keeps the page's back handler), then "back" is
// pressed: search on top of a train card → the search closes; again → the card; again → the app goes to the
// background. node tools/back-check.mjs (with npm run dev; PAGE= for another port). Not the real phone: the press is
// the handler called directly.
import { launch, address, sleep, PHONE, RUSH_HOUR } from './lib/browser.mjs';

const STUB = `export const App = {
  addListener(name, fn) { if (name === 'backButton') window.__back = fn; return Promise.resolve({ remove() {} }); },
  minimizeApp() { window.__minimized = true; return Promise.resolve(); },
};`;

const browser = await launch();
const fails = [];
try {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => { window.Capacitor = { isNativePlatform: () => true }; });
  await page.setRequestInterception(true);
  page.on('request', r => (/capacitor_app\.js|@capacitor\/app/.test(r.url())
    ? r.respond({ status: 200, contentType: 'text/javascript', body: STUB }) : r.continue()));
  await page.goto(address({ replay: RUSH_HOUR, lang: 'en', view: '11/59.33/18.06' }), { waitUntil: 'domcontentloaded' });
  for (let t0 = Date.now(); Date.now() - t0 < 30000; await sleep(300)) {
    if (await page.evaluate(() => (window.__trains?.count ?? 0) > 0 && Boolean(window.__map?.loaded()) && Boolean(window.__back)).catch(() => false)) break;
  }
  const state = () => page.evaluate(() => ({ card: !document.getElementById('panel').hidden, search: !document.getElementById('menu').hidden,
    away: Boolean(window.__minimized) }));
  const back = async () => { await page.evaluate(() => window.__back({ canGoBack: false })); await sleep(500); return state(); };
  if (!(await page.evaluate(() => typeof window.__back === 'function'))) fails.push('the page did not register a back handler');
  else {
    // a train card, opened through the search (type its number, Enter picks the first row)
    const number = await page.evaluate(() => { const f = window.__map.queryRenderedFeatures({ layers: ['train-dots'] })[0];
      return f ? String(window.__trains.get(f.properties.id).number) : null; });
    await page.click('#menu-button');
    await sleep(400);
    await page.type('#search', number ?? '');
    await sleep(600);
    await page.keyboard.press('Enter');
    await sleep(1500);
    await page.evaluate(() => { document.getElementById('menu-button').click(); });
    await sleep(500);
    const s0 = await state();
    if (!s0.card || !s0.search) fails.push(`setup: card ${s0.card}, search ${s0.search} (both should be open)`);
    const s1 = await back();
    if (s1.search || !s1.card || s1.away) fails.push(`1st back: search ${s1.search}, card ${s1.card}, away ${s1.away} (want: search closed, card open)`);
    const s2 = await back();
    if (s2.card || s2.away) fails.push(`2nd back: card ${s2.card}, away ${s2.away} (want: card closed, still here)`);
    const s3 = await back();
    if (!s3.away) fails.push('3rd back on the bare map: the app did not go to the background');

    // The menu (☰, 2026-11-18): back closes it, and only it.
    await page.evaluate(() => { window.__minimized = false; document.getElementById('nav-button').click(); });
    await sleep(400);
    const n0 = await page.evaluate(() => !document.getElementById('nav').hidden);
    await page.evaluate(() => window.__back({ canGoBack: false })); await sleep(500);
    const n1 = await page.evaluate(() => ({ nav: !document.getElementById('nav').hidden, away: Boolean(window.__minimized) }));
    if (!n0 || n1.nav || n1.away) fails.push(`the menu and back: open ${n0}, after back open ${n1.nav}, away ${n1.away} (want: closed, still here)`);

    // With the keyboard open (2026-11-17): a search typed, the page shortened by a keyboard's height (Max's phone:
    // 430 px); back → only the keyboard goes (the field loses focus, the search stays); back again → the search closes.
    await page.evaluate(() => { window.__minimized = false; document.getElementById('menu-button').click(); });
    await sleep(400);
    await page.type('#search', '2');
    await page.setViewport({ ...PHONE, height: PHONE.height - 430 });
    await sleep(500);
    const focused = () => page.evaluate(() => document.activeElement?.id === 'search');
    const k0 = { ...(await state()), typing: await focused() };
    const k1 = { ...(await back()), typing: await focused() };
    if (!k0.search || !k0.typing) fails.push(`keyboard setup: search ${k0.search}, typing ${k0.typing}`);
    if (!k1.search || k1.typing) fails.push(`back with the keyboard up: search ${k1.search} (want open), typing ${k1.typing} (want not)`);
    await page.setViewport(PHONE);   // (the keyboard has gone)
    await sleep(400);
    const k2 = await back();
    if (k2.search || k2.away) fails.push(`back after the keyboard: search ${k2.search} (want closed), away ${k2.away}`);
  }
  if (errors.length) fails.push('page errors: ' + errors.slice(0, 3).join(' | '));
} finally { await browser.close(); }
console.log(fails.length ? `back-check FAILED:\n  ${fails.join('\n  ')}` : 'back-check ok: search → card → background, one per press; with the keyboard up, back hides only the keyboard');
process.exit(fails.length ? 1 : 0);
