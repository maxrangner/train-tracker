// The sheet's ideas (build plan parts 3 and 6, 2026-11-23) on the phone-size page, on the replay of 17 Nov 16:00-18:00
// (CARD_HOUR, its routes saved: the boards and cards come from them): My trains (a trip made with the station picker,
// its page with the next train, "If it fails" and a cancelled train crossed out; the line above the bar and its tap; a
// trip with a change; "Save a trip from here" and the Peek tip on the first board), "Why are we standing?" on 531
// (Växelfel), Share (the copied-link way: the browser's share sheet taken away), "Add my change" pinned, Peek (a held
// station, then a plain tap still opens its board), "You seem to be on" (a fake location riding a recorded train:
// offered, the ride page), a #train=531 link (opens it, leaves the address), the shop window in landscape (starts when
// idle, a touch ends it, off in Settings).
// Not checkable here: a real phone's GPS, its share sheet, a charger, the Wake Lock, a real finger's hold.
// Run: PAGE=http://localhost:5181/ node tools/ideas-check.mjs [--shots <folder>] [--theme light|dark]
import { mkdirSync, existsSync } from 'node:fs';
import { launch, CARD_HOUR, sleep, PAGE, PHONE } from './lib/browser.mjs';
import { waitForMap, until, openTrainByNumber, openStationByName, toRest, setLevel } from './lib/screen.mjs';
import { readPositions } from './lib/records.mjs';

const arg = name => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const shotDir = arg('--shots'), theme = arg('--theme') ?? 'light', only = arg('--only');
const part = name => !only || only.split(',').includes(name);   // --only trips,train,peek,seem,link,shop
if (shotDir) mkdirSync(shotDir, { recursive: true });
let failed = 0;
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };
const shot = async (page, name) => { if (shotDir) await page.screenshot({ path: `${shotDir}/${theme}-${name}.png` }); };
if (!existsSync(`data/routes-${CARD_HOUR}.jsonl`)) { console.log(`ideas-check: no data/routes-${CARD_HOUR}.jsonl, nothing checked`); process.exit(0); }

const origin = new URL(PAGE).origin;
const browser = await launch();
await browser.defaultBrowserContext().overridePermissions(origin, ['geolocation', 'clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
// (the shop window off on the main page: this browser says it is charging, so an idle upright phone would start it)
const hash = { replay: CARD_HOUR, view: '11/55.68/13.1', train: 'toy', lang: 'en', theme, shop: 'false' };
const top = page => page.evaluate(() => window.__stack.top());
try {
  // The browser's own share sheet taken away: the link is copied (or shown), as on a computer without one.
  const page = await waitForMap(browser, hash);
  await page.evaluateOnNewDocument(() => { Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true }); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await until(page, () => (window.__trains?.count ?? 0) > 0 && Boolean(window.__stack?.top()), 30000);
  await sleep(2500);

  if (part('trips')) {
  // ---- 1. My trains: a trip made in the sheet ----
  await toRest(page);
  await setLevel(page, 1);
  await until(page, () => Boolean(document.querySelector('[data-go="newtrip"]')));
  await page.evaluate(() => document.querySelector('[data-go="newtrip"]').click());
  await until(page, () => window.__stack.top() === 'newtrip');
  const pick = async (text, sig) => {
    await page.evaluate(() => { const q = document.querySelector('.nt-q'); q.value = ''; q.focus(); });
    await page.type('.nt-q', text, { delay: 15 });
    await until(page, s => Boolean(document.querySelector(`[data-pick="${s}"]`)), 3000, sig);
    await page.evaluate(s => document.querySelector(`[data-pick="${s}"]`).click(), sig);
    await sleep(200);
  };
  await pick('Lund', 'Lu');
  await pick('Malmö', 'Mc');
  await shot(page, '01-new-trip');
  await page.evaluate(() => document.querySelector('[data-nt="save"]').click());
  ok(await until(page, () => window.__stack.top() === 'trip:Lu>Mc'), 'a new trip Lund C → Malmö C, picked with the station search, opens its page');
  ok(await until(page, () => Boolean(document.querySelector('.trip-next')), 15000), 'its page shows the next train');
  const tripText = await page.evaluate(() => document.querySelector('.pg[data-key="trip:Lu>Mc"]').innerText);
  ok(/If it fails: next is \d\d:\d\d/.test(tripText), `"If it fails: next is …" (${/If it fails[^\n]*/.exec(tripText)?.[0]})`);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.trip-list .bd-row')].map(r => ({ cancelled: r.classList.contains('canceled'), text: r.innerText.replace(/\n/g, ' ') })));
  ok(rows.length >= 5, `today's trains listed: ${rows.length} (${rows[0]?.text})`);
  ok(rows.some(r => r.cancelled), `a cancelled train crossed out: ${rows.find(r => r.cancelled)?.text}`);
  await setLevel(page, 2);
  await shot(page, '02-trip');
  // The line above the bar
  await page.evaluate(() => window.__stack.home(0));
  await sleep(600);
  const line = await page.evaluate(() => ({ id: window.__line.shown, text: document.getElementById('line').innerText }));
  ok(line.id === 'trip' && /→ Malmö C/.test(line.text), `the line above the bar: "${line.text.replace(/\n/g, ' ')}"`);
  await shot(page, '03-line');
  await page.click('#line .line-main');
  ok(await until(page, () => window.__stack.top() === 'trip:Lu>Mc'), 'a tap on the line opens the trip');

  // ---- a trip with a change ----
  await page.evaluate(() => { window.__ideas.favourites.addTrip('Lu', 'Hb', 'Hm'); window.__stack.open('trip:Lu>Hm>Hb'); });
  ok(await until(page, () => Boolean(document.querySelector('.pg[data-key="trip:Lu>Hm>Hb"] .trip-pair, .pg[data-key="trip:Lu>Hm>Hb"] .state.empty')), 15000), 'a trip with a change (Lund C → Helsingborg C via Hässleholm) answers');
  const pairs = await page.evaluate(() => [...document.querySelectorAll('.pg[data-key="trip:Lu>Hm>Hb"] .trip-chg')].map(c => `${c.className.replace('trip-chg ', '')}: ${c.innerText}`));
  ok(pairs.length > 0, `its changes: ${pairs.slice(0, 3).join('; ')}`);
  await setLevel(page, 2);
  await shot(page, '04-trip-change');

  // ---- the first board: "Save a trip from here" and the Peek tip ----
  await openStationByName(page, 'Lund C');
  const st = await page.evaluate(() => ({ tip: document.querySelector('.st-extras .tip')?.innerText ?? '', save: Boolean(document.querySelector('.st-extras [data-go="newtrip:Lu"]')) }));
  ok(/hold a station/.test(st.tip), `the first board says once: "${st.tip}"`);
  ok(st.save, 'a board has "Save a trip from here"');
  await setLevel(page, 2);
  await page.evaluate(() => { const p = document.querySelector('.pg[data-key="station:Lu"]'); p.scrollTop = p.scrollHeight; });
  await sleep(300);
  await shot(page, '05-board');
  await page.evaluate(() => document.querySelector('.st-extras [data-go="newtrip:Lu"]').click());
  ok(await until(page, () => window.__stack.top() === 'newtrip:Lu' && /Lund C/.test(document.querySelector('[data-nt="from"]')?.innerText ?? '')), '"Save a trip from here" starts a trip from Lund C');
  await openStationByName(page, 'Malmö C');
  ok(!(await page.evaluate(() => Boolean(document.querySelector('.st-extras .tip')))), 'the tip is not said again on the next board');

  }
  if (part('train')) {
  // ---- 2. Why are we standing? 531 at Hjärup, "Växelfel" ----
  const key531 = await openTrainByNumber(page, 531);
  ok(await until(page, () => Boolean(document.querySelector('.tr-extras .why')), 8000), '531, standing, says why');
  const why = await page.evaluate(() => document.querySelector('.tr-extras .why')?.innerText.replace(/\n/g, ' ') ?? '');
  ok(/Växelfel/.test(why), `531: "${why}"`);
  await shot(page, '06-why-531');

  // ---- 3. Share (the copied-link way) ----
  await page.evaluate(() => document.querySelector('.tr-extras [data-x="share"]').click());
  await until(page, () => Boolean(window.__lastShare));
  const shared = await page.evaluate(() => ({ ...window.__lastShare, note: document.querySelector('#map .map-note:not([hidden])')?.innerText ?? '' }));
  ok(shared.url === 'https://sparat.rangner.com/#train=531' && ['copied', 'shown'].includes(shared.how) && shared.note.includes(shared.url), `Share without a share sheet: ${shared.how}, "${shared.note}"`);
  await shot(page, '07-share');

  // ---- 4. Add my change: a later stop, then a train leaving there; pinned in Mine ----
  await page.evaluate(() => document.querySelector('.tr-extras [data-go^="addchange:"]')?.click());
  ok(await until(page, () => window.__stack.top().startsWith('addchange:')), 'Add my change opens its page');
  await until(page, () => Boolean(document.querySelector('[data-stop]')));
  await page.evaluate(() => document.querySelector('[data-stop]').click());
  ok(await until(page, () => Boolean(document.querySelector('[data-dep]')), 10000), 'a stop picked: the trains leaving there, with the minutes to change');
  await shot(page, '08-add-change');
  await page.evaluate(() => document.querySelector('[data-dep]').click());
  ok(await until(page, () => window.__stack.top().startsWith('change:') && Boolean(document.querySelector('.trip-next')), 10000), 'a train picked: the change is pinned and shown');
  const chg = await page.evaluate(() => document.querySelector('.pg[data-kind="trip"] .trip-next')?.innerText.replace(/\n/g, ' ') ?? '');
  ok(/min|lost/.test(chg), `the pinned change: "${chg}"`);
  await setLevel(page, 2);
  await shot(page, '09-pinned-change');
  await page.evaluate(() => window.__stack.home(1));
  await sleep(800);
  ok(await page.evaluate(() => Boolean(document.querySelector('.pg[data-key="home"] [data-go^="change:"]'))), 'Mine lists the pinned change');
  await page.evaluate(() => document.querySelector('.pg[data-key="home"] .rows [data-go^="trip:"]')?.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await shot(page, '10-mine');

  }
  if (part('peek')) {
  // ---- 5. Peek: hold Lund C on the map ----
  await toRest(page);
  await page.evaluate(() => { window.__map.stop(); window.__map.jumpTo({ center: [13.187, 55.69], zoom: 12.5 }); });
  // (until the map has settled: a busy computer still draws it a while)
  await until(page, () => !window.__map.isMoving() && [...document.querySelectorAll('.station-name')].some(e => e.textContent === 'Lund C'), 8000);
  await sleep(1200);
  const at = await page.evaluate(() => {
    // its name close in (a tap there opens the board, also with trains standing on its dot), else its dot
    const name = [...document.querySelectorAll('.station-name')].find(e => e.textContent === 'Lund C');
    if (name) { const b = name.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
    const f = window.__map.queryRenderedFeatures({ layers: ['station-dots'] }).find(x => x.properties.sig === 'Lu');
    if (!f) return null;
    const p = window.__map.project(f.geometry.coordinates), r = document.getElementById('map').getBoundingClientRect();
    return { x: p.x + r.left, y: p.y + r.top };
  });
  ok(Boolean(at), 'Lund C on the map');
  if (at) {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    const early = await page.evaluate(() => !document.getElementById('peek').hidden);   // (not at once: only after the hold)
    await until(page, () => Boolean(document.querySelector('#peek:not([hidden]) .pk-row, #peek:not([hidden]) .empty')), 10000);
    const peek = await page.evaluate(() => ({ shown: !document.getElementById('peek').hidden, rows: [...document.querySelectorAll('#peek .pk-row')].map(r => r.innerText.replace(/\s+/g, ' ')) }));
    ok(!early && peek.shown && peek.rows.length > 0 && peek.rows.length <= 3, `holding Lund C: its next departures (${peek.rows.join(' | ')})`);
    await shot(page, '11-peek');
    await page.mouse.up();
    await sleep(700);
    ok(await page.evaluate(() => document.getElementById('peek').hidden) && await top(page) === 'home', 'let go: the bubble is gone, nothing opened');
    await page.mouse.click(at.x, at.y);
    ok(await until(page, () => window.__stack.top() === 'station:Lu'), 'a plain tap still opens the board');
  }
  }

  if (part('seem')) {
  // ---- 6. "You seem to be on": a fake location riding a recorded train ----
  await toRest(page);
  const T0 = await page.evaluate(() => window.__now());
  const recs = readPositions(`data/positions-${CARD_HOUR}.jsonl`);
  const byTrain = new Map();
  for (const r of recs) { if (!byTrain.has(r.id)) byTrain.set(r.id, []); byTrain.get(r.id).push(r); }
  for (const l of byTrain.values()) l.sort((a, b) => a.time - b.time);
  const posAt = (list, t) => {
    const i = list.findIndex(r => r.time > t);
    if (i <= 0) return null;
    const a = list[i - 1], b = list[i];
    if (b.time - a.time > 120000) return null;
    const f = (t - a.time) / (b.time - a.time);
    return { lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f };
  };
  // A train running fast and alone for the next 4 minutes, with a public number.
  const rider = [...byTrain].map(([id, list]) => ({ id, list, run: list.filter(r => r.time >= T0 - 60000 && r.time <= T0 + 4 * 60000) }))
    .filter(x => x.run.length >= 12 && x.run.every(r => (r.speed ?? 0) >= 80) && /^\d{2,5}\//.test(x.id))
    .find(x => ![...byTrain].some(([id2, l2]) => id2 !== x.id && (() => { const p = posAt(l2, T0), q = posAt(x.list, T0); return p && q && Math.hypot(p.lon - q.lon, p.lat - q.lat) < 0.05; })()));
  ok(Boolean(rider), `a train to ride: ${rider?.id}`);
  if (rider) {
    const fixAt = async () => { const t = await page.evaluate(() => window.__now()); const p = posAt(rider.list, t); if (p) await page.setGeolocation({ latitude: p.lat, longitude: p.lon, accuracy: 20 }); return p; };
    await fixAt();
    await page.click('.maplibregl-ctrl-geolocate');
    await until(page, () => Boolean(window.__ideas.ride.watching), 5000);
    let offered = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      await fixAt();
      if (await page.evaluate(() => window.__line.shown === 'seemon')) { offered = true; break; }
      await sleep(1000);
    }
    const seen = await page.evaluate(() => ({ offer: window.__ideas.ride.offer, text: document.getElementById('line').innerText }));
    ok(offered && seen.offer?.id === rider.id, `riding ${rider.id}: offered after ${Math.round((Date.now() - t0) / 1000)} s, "${seen.text.replace(/\n/g, ' ')}"`);
    await shot(page, '12-seem-on');
    if (offered) {
      const hit = await page.evaluate(() => { const b = document.querySelector('#line .line-main').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.outerHTML.slice(0, 80); });
      await page.click('#line .line-main');
      if (await top(page) === 'home') console.log(`     (the tap hit ${hit})`);
      ok(await until(page, id => window.__stack.top() === `ride:${id}` && Boolean(document.querySelector('.ride-next, .ride .state')), 8000, rider.id), 'a tap opens the ride page');
      await until(page, () => Boolean(document.querySelector('.ride-next')), 8000);
      await fixAt();
      await sleep(1500);
      const ride = await page.evaluate(() => document.querySelector('.ride')?.innerText.replace(/\n/g, ' ') ?? '');
      ok(/next stop/i.test(ride), `the ride page: "${ride}"`);
      await shot(page, '13-ride');
      // × on the offer: not offered again
      await toRest(page);
    }
  }
  }
  await page.close();

  // ---- 7. A shared link: #train=531 opens today's run and leaves the address ----
  if (part('link')) {
    const p = await waitForMap(browser, { ...hash, train: '531' });
    ok(await until(p, () => String(window.__stack.top()).startsWith('train:531/'), 20000), 'a #train=531 link opens 531');
    ok(!(await p.evaluate(() => /(^|[#&])train=531/.test(location.hash))), `the link leaves the address (now "${await p.evaluate(() => location.hash)}")`);
    await p.close();
  }

  // ---- 8. The shop window, the phone on its side ----
  if (part('shop')) {
    const p = await waitForMap(browser, { ...hash, shop: 'true', size: { ...PHONE, width: 843, height: 393 } });
    await toRest(p);
    await p.evaluate(() => window.__ideas.shop.pretendIdle());
    ok(await until(p, () => window.__ideas.shop.running && document.documentElement.classList.contains('shop'), 6000), 'on its side and untouched: the shop window starts, the buttons fade');
    await sleep(4500);
    const words = await p.evaluate(() => window.__ideas.shop.line);
    ok(/Fastest|Most late|Disruption|meet|live/.test(words), `its line: "${words}"`);
    await shot(p, '14-shop-window');
    await p.mouse.click(400, 200);
    await sleep(400);
    ok(await p.evaluate(() => !window.__ideas.shop.running && !document.documentElement.classList.contains('shop') && window.__stack.top() === 'home'), 'a touch brings everything back (and opens nothing)');
    // Off in Settings: it doesn't start.
    await p.evaluate(() => window.__stack.open('page:settings'));
    await sleep(500);
    await p.evaluate(() => document.querySelector('[data-key="shopWindow"] [data-v="false"]').click());
    await toRest(p);
    await p.evaluate(() => window.__ideas.shop.pretendIdle());
    await sleep(4500);
    ok(await p.evaluate(() => !window.__ideas.shop.running), 'Settings → Shop window off: it does not start');
    // Upright (a phone held normally): no.
    await p.evaluate(() => document.querySelector('[data-key="shopWindow"] [data-v="true"]')?.click());
    await p.setViewport(PHONE);
    await p.evaluate(() => window.__ideas.shop.pretendIdle());
    await sleep(4500);
    // (this browser's battery says charging, as a computer without one does: then upright counts as on a charger)
    const up = await p.evaluate(() => window.__ideas.shop.state());
    ok(up.charging === true ? up.running : !up.running, `upright, ${up.charging === true ? 'the browser says charging: it starts (a phone on a charger)' : 'not charging: it does not start'}`);
    if (p.errors.length) ok(false, `page errors: ${p.errors.join(' | ')}`);
    await p.close();
  }
  if (page.errors.length) ok(false, `page errors: ${page.errors.join(' | ')}`);
} finally {
  await browser.close();
}
console.log(failed ? `ideas-check: ${failed} failed` : 'ideas-check: all good');
process.exit(failed ? 1 : 0);
