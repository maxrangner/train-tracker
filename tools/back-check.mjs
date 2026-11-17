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
  }
  if (errors.length) fails.push('page errors: ' + errors.slice(0, 3).join(' | '));
} finally { await browser.close(); }
console.log(fails.length ? `back-check FAILED:\n  ${fails.join('\n  ')}` : 'back-check ok: search → card → background, one per press');
process.exit(fails.length ? 1 : 0);
