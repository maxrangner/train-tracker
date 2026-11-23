// The sheet's ideas (build plan parts 3 and 6, 2026-11-23) on the phone-size page, on the replay of 17 Nov 16:00-18:00
// (CARD_HOUR, its routes saved: the boards and cards come from them): My trains (a trip made with the station picker,
// its page with the next train, "If it fails" and a cancelled train crossed out; the line above the bar and its tap; a
// trip with a change; Home's Saved and its headings; New/Edit trip as a route (a pill is the search, dragged by its
// dots with a mouse and a finger, at most one change); a trip's and a change's page: pencil and bin, no star; "Save a trip from here" and the Peek tip on the first board), "Why are we standing?" on 531
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
  // Home's "Saved" ("Mine" until 2026-11-23): small headings for what it holds, a heading only when it has something;
  // "New trip" under Trips
  const saved = () => page.evaluate(() => {
    const home = document.querySelector('.pg[data-key="home"]');
    return { lab: [...home.querySelectorAll('h4.lab')].map(h => h.textContent).find(x => /saved|mine/i.test(x)) ?? null,
      heads: [...home.querySelectorAll('[data-saved]')].map(h => h.dataset.saved),
      newTrip: Boolean(home.querySelector('[data-saved="trips"] + .rows [data-go="newtrip"]')) };
  });
  const s0 = await saved();
  ok(s0.lab === 'Saved' && s0.newTrip && !s0.heads.includes('trains') && !s0.heads.includes('stations'), `Home's "${s0.lab}": headings ${s0.heads.join(', ')}; "New trip" under Trips: ${s0.newTrip}`);
  await page.evaluate(() => { window.__ideas.favourites.toggle('station', 'Lu'); window.__ideas.favourites.toggle('train', '1041'); window.__stack.home(1); });
  await until(page, () => document.querySelectorAll('.pg[data-key="home"] [data-saved]').length === 3, 4000);
  const s1 = await saved();
  ok(s1.heads.join(',') === 'trips,trains,stations', `a starred train and station: headings ${s1.heads.join(', ')}`);
  await page.evaluate(() => { window.__ideas.favourites.toggle('station', 'Lu'); window.__ideas.favourites.toggle('train', '1041'); window.__stack.home(1); });
  await page.evaluate(() => document.querySelector('[data-go="newtrip"]').click());
  await until(page, () => window.__stack.top() === 'newtrip');
  // A new trip as a route (Max's pick A, 2026-11-23): From and To pills on a line; the station field is the pill itself,
  // one text field on the page (Max's note 11: "Välj station" plus a second field "Station" was confusing)
  const NT = '.pg[data-kind="newtrip"]';
  const route = () => page.evaluate(nt => ({
    stops: [...document.querySelectorAll(`${nt} .nt-stop`)].map(s => `${[...s.classList].find(c => ['from', 'via', 'to'].includes(c))}:${s.querySelector('.nt-pill b')?.textContent ?? `[${s.querySelector('.nt-q')?.placeholder}]`}`),
    inputs: document.querySelectorAll(`${nt} input`).length, add: Boolean(document.querySelector(`${nt} [data-nt="addvia"]`)),
    editing: [...document.querySelectorAll(`${nt} .nt-stop`)].findIndex(s => Boolean(s.querySelector('.nt-pill .nt-q'))) }), NT);
  const r0 = await route();
  ok(r0.stops.length === 2 && /^from:/.test(r0.stops[0]) && /^to:/.test(r0.stops[1]) && r0.inputs === 1 && r0.editing === 0 && r0.add,
    `New trip: ${r0.stops.join(' | ')}; one text field, in the From pill (${r0.inputs} fields, in pill ${r0.editing}); "Add a change" between`);
  await page.evaluate(nt => document.querySelector(`${nt} .nt-stop.to [data-nt="stop"]`)?.click(), NT);
  const r1 = await route();
  ok(r1.inputs === 1 && r1.editing === 1, `a tap on To makes that pill the search, in place (${r1.inputs} field, in pill ${r1.editing})`);
  await page.evaluate(nt => document.querySelector(`${nt} .nt-stop.from [data-nt="stop"]`)?.click(), NT);
  // The station search (Max's phone, 2026-11-23: a tall pill, and the keyboard covered its results): a pill's height,
  // and while typing with the keyboard up (the page 430 px shorter) the field and its first results are above it.
  const qh = await page.evaluate(() => Math.round(document.querySelector('.nt-pill.on')?.getBoundingClientRect().height ?? 0));
  ok(qh >= 40 && qh <= 80, `the station search is a pill's height (${qh} px)`);
  await page.evaluate(() => document.querySelector('.nt-q').focus());
  await page.setViewport({ ...PHONE, height: PHONE.height - 430 });
  await sleep(800);
  await page.type('.nt-q', 'Lund', { delay: 15 });
  await sleep(600);
  const kb = await page.evaluate(() => {
    const q = document.querySelector('.nt-q').getBoundingClientRect(), rs = [...document.querySelectorAll('.nt-res [data-pick]')].map(r => r.getBoundingClientRect().bottom);
    return { q: [Math.round(q.top), Math.round(q.bottom)], first: rs.length ? Math.round(rs[0]) : null, shown: rs.filter(y => y <= innerHeight).length, h: innerHeight };
  });
  ok(kb.q[0] >= 0 && kb.first !== null && kb.first <= kb.h && kb.shown >= 2, `typing with the keyboard up (${kb.h} px left): the field at ${kb.q.join('-')} px, ${kb.shown} results above the keyboard`);
  await shot(page, '01a-new-trip-typing');
  await page.setViewport(PHONE);
  await sleep(600);
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

  // ---- a saved trip's Edit and Delete (Max's phone, 2026-11-23: "can't be edited or deleted") ----
  await page.evaluate(() => { window.__ideas.favourites.addTrip('Cst', 'U'); });   // (a second trip: the edited one keeps its place before it)
  const tripKeys = () => page.evaluate(() => window.__ideas.favourites.trips.map(x => x.key));
  // Edit and Delete: a pencil and a bin in the sheet's head, no star (Max, 2026-11-23: "star is not relevant here, it's
  // either edit or delete")
  ok(await until(page, () => window.__stack.top() === 'trip:Lu>Mc' && Boolean(document.querySelector('#sheet .sh-acts [data-act-id="edit"]')) &&
    Boolean(document.querySelector('#sheet .sh-acts [data-act-id="del"]')) && document.querySelector('#sheet .sh-star').hidden), 'a saved trip has a pencil and a bin, no star');
  await page.evaluate(() => document.querySelector('#sheet .sh-acts [data-act-id="edit"]').click());
  ok(await until(page, () => window.__stack.top() === 'edittrip:Lu>Mc' && /Lund C/.test(document.querySelector('.nt-stop.from .nt-pill')?.innerText ?? '') && /Malmö C/.test(document.querySelector('.nt-stop.to .nt-pill')?.innerText ?? '')),
    'Edit opens the form filled in (Lund C → Malmö C)');
  await page.evaluate(() => document.querySelector('.nt-stop.to [data-nt="stop"]')?.click());
  await until(page, () => Boolean(document.querySelector('.nt-stop.to .nt-q')));
  await pick('Hässleholm', 'Hm');
  await shot(page, '02a-edit-trip');
  await page.evaluate(() => document.querySelector('[data-nt="save"]').click());
  ok(await until(page, () => window.__stack.top() === 'trip:Lu>Hm'), `saved: its page is Lund C → Hässleholm C (${await top(page)})`);
  const afterEdit = { keys: await tripKeys(), stack: await page.evaluate(() => window.__stack.keys()) };
  ok(afterEdit.keys[0] === 'Lu>Hm' && !afterEdit.keys.includes('Lu>Mc') && !afterEdit.stack.some(k => k === 'trip:Lu>Mc' || k.startsWith('edittrip:')),
    `the edited trip took the old one's place (${afterEdit.keys.join(', ')}; pages ${afterEdit.stack.join(' > ')})`);
  // Delete: the first tap arms it, a double tap doesn't count, a second tap later deletes
  const del = () => page.evaluate(() => document.querySelector('#sheet .sh-acts [data-act-id="del"]')?.click());
  await until(page, () => window.__stack.top() === 'trip:Lu>Hm' && Boolean(document.querySelector('#sheet .sh-acts [data-act-id="del"]')));
  await del();
  await sleep(100);
  await del();
  await sleep(200);
  const armed = await page.evaluate(() => ({ text: document.querySelector('#sheet .sh-acts [data-act-id="del"]')?.innerText ?? '', saved: Boolean(window.__ideas.favourites.trip('Lu>Hm')) }));
  ok(armed.saved && /again/i.test(armed.text), `Delete tapped twice quickly: still saved, it says "${armed.text}"`);
  await shot(page, '02b-delete-armed');
  await sleep(500);
  await del();
  ok(await until(page, () => !window.__ideas.favourites.trip('Lu>Hm') && window.__stack.top() !== 'trip:Lu>Hm'), `a second tap deletes it and closes its page (now ${await top(page)})`);
  await page.evaluate(() => window.__stack.home(1));
  await sleep(600);
  ok(!(await page.evaluate(() => Boolean(document.querySelector('.pg[data-key="home"] [data-go="trip:Lu>Hm"]')))), 'Saved no longer lists it');
  await page.evaluate(() => window.__ideas.favourites.removeTrip('Cst>U'));

  // ---- a trip with a change ----
  await page.evaluate(() => { window.__ideas.favourites.addTrip('Lu', 'Hb', 'Hm'); window.__stack.open('trip:Lu>Hm>Hb'); });
  ok(await until(page, () => Boolean(document.querySelector('.pg[data-key="trip:Lu>Hm>Hb"] .trip-pair, .pg[data-key="trip:Lu>Hm>Hb"] .state.empty')), 15000), 'a trip with a change (Lund C → Helsingborg C via Hässleholm) answers');
  const pairs = await page.evaluate(() => [...document.querySelectorAll('.pg[data-key="trip:Lu>Hm>Hb"] .trip-chg')].map(c => `${c.className.replace('trip-chg ', '')}: ${c.innerText}`));
  ok(pairs.length > 0, `its changes: ${pairs.slice(0, 3).join('; ')}`);
  await setLevel(page, 2);
  await shot(page, '04-trip-change');
  // a trip's page shows it on the map (Max, 2026-11-23): its stations' names, all in view, its next train lit
  const onMap = await page.evaluate(() => {
    const sigs = window.__routeSigs() ?? [], drawn = window.__drawn(), b = window.__map.getBounds();
    const inView = ['Lu', 'Hm', 'Hb'].every(s => { const st = window.__stationAt(s); return st && b.contains([st.lon, st.lat]); });
    return { sigs, drawn, inView };
  });
  ok(onMap.sigs.join(',') === 'Lu,Hm,Hb', `the trip's stations named on the map: ${onMap.sigs.join(', ')}`);
  ok(onMap.drawn.drawn < onMap.drawn.all, `only its next trains lit: ${onMap.drawn.drawn} of ${onMap.drawn.all} drawn`);
  // (the camera may still be gliding there: once the trip's trains are in, it fits again)
  const inView = onMap.inView || await until(page, () => {
    const b = window.__map.getBounds();
    return ['Lu', 'Hm', 'Hb'].every(s => { const st = window.__stationAt(s); return st && b.contains([st.lon, st.lat]); });
  }, 4000);
  ok(inView, `its stations all in view${onMap.inView ? '' : ' (after the camera settled)'}`);
  // the map's labels and "2 trains" follow (2026-11-23: they waited for a lit train to move, and the trip's stood still)
  const labels = () => page.evaluate(() => window.__map.queryRenderedFeatures({ layers: ['train-labels'] }).length);
  const labelled = await until(page, () => window.__map.queryRenderedFeatures({ layers: ['train-labels'] }).length <= window.__drawn().drawn + 1, 5000);
  ok(labelled, `the map's labels only for the lit trains (${await labels()} labels drawn)`);
  // Edit of a trip with a change, as a route (Max's pick A, 2026-11-23): From, the Change with its ×, To; at most one
  // change for now, so no "Add a change" while it has one
  await page.evaluate(() => window.__stack.open('edittrip:Lu>Hm>Hb'));
  await setLevel(page, 2);
  ok(await until(page, () => Boolean(document.querySelector('.pg[data-key="edittrip:Lu>Hm>Hb"] .nt-stop.via .nt-x'))), 'Edit of a trip with a change: the Change pill has a ×');
  const e0 = await route();
  ok(e0.stops.join(' | ') === 'from:Lund C | via:Hässleholm | to:Helsingborg C' && !e0.add, `the route: ${e0.stops.join(' | ')} (no "Add a change" with one already: ${!e0.add})`);
  // A pill dragged by its dots, with the mouse: the Change above From; it lifts, its new place dashed; after it the first
  // is From, the last To, the middle the Change
  const gripAt = i => page.evaluate((nt, i) => { const b = document.querySelector(`${nt} [data-grip="${i}"]`)?.getBoundingClientRect() ?? { x: 0, y: 0, width: 0, height: 0 }; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, NT, i);
  const stopH = await page.evaluate(nt => document.querySelector(`${nt} .nt-stop.from`)?.getBoundingClientRect().height ?? 60, NT);
  let g = await gripAt(1);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) { await page.mouse.move(g.x, g.y - k * stopH / 8); await sleep(20); }
  const lifted = await page.evaluate(nt => ({ lifted: Boolean(document.querySelector(`${nt} .nt-stop.lifted`)), gap: Boolean(document.querySelector(`${nt} .nt-gap`)) }), NT);
  await shot(page, '04a-edit-drag');
  await page.mouse.up();
  await sleep(200);
  const e1 = await route();
  ok(lifted.lifted && lifted.gap && e1.stops.join(' | ') === 'from:Hässleholm | via:Lund C | to:Helsingborg C',
    `dragged with the mouse (lifted: ${lifted.lifted}, new place dashed: ${lifted.gap}): ${e1.stops.join(' | ')}`);
  ok(await page.evaluate(() => window.__ideas.favourites.trips.map(x => x.key).join(',')) === 'Lu>Hm>Hb' && await top(page) === 'edittrip:Lu>Hm>Hb', 'the page stayed, nothing saved before "Save trip"');
  // ... and with a finger: From back below the Change
  g = await gripAt(0);
  const finger = await page.touchscreen.touchStart(g.x, g.y);
  for (let k = 1; k <= 10; k++) { await finger.move(g.x, g.y + k * stopH / 8); await sleep(20); }
  await finger.end();
  await sleep(200);
  const e2 = await route();
  ok(e2.stops.join(' | ') === 'from:Lund C | via:Hässleholm | to:Helsingborg C' && await page.evaluate(() => window.__stack.level) === 2,
    `dragged with a finger: ${e2.stops.join(' | ')} (the sheet stayed at full)`);
  // its change taken away again (Max, 2026-11-23: an added stop couldn't be removed): the × on the Change
  await page.evaluate(() => document.querySelector('.pg[data-key="edittrip:Lu>Hm>Hb"] .nt-x')?.click());
  const noVia = await page.evaluate(() => ({ field: Boolean(document.querySelector('.pg[data-key="edittrip:Lu>Hm>Hb"] .nt-stop.via')), add: Boolean(document.querySelector('.pg[data-key="edittrip:Lu>Hm>Hb"] [data-nt="addvia"]')) }));
  ok(!noVia.field && noVia.add, `the × takes the change away ("Add a change" back: ${noVia.add})`);
  await page.evaluate(() => document.querySelector('.pg[data-key="edittrip:Lu>Hm>Hb"] [data-nt="save"]').click());
  ok(await until(page, () => window.__stack.top() === 'trip:Lu>Hb' && Boolean(window.__ideas.favourites.trip('Lu>Hb')) && !window.__ideas.favourites.trip('Lu>Hm>Hb')),
    `saved without the change: Lund C → Helsingborg C (${await top(page)})`);
  await page.evaluate(() => window.__ideas.favourites.removeTrip('Lu>Hb'));

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
  ok(await until(page, () => window.__stack.top() === 'newtrip:Lu' && /Lund C/.test(document.querySelector('.nt-stop.from .nt-pill')?.innerText ?? '')), '"Save a trip from here" starts a trip from Lund C');
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
  // "All places" on the card, left of "Track" (Max, 2026-11-23): on, the places between stops; off again, gone
  await setLevel(page, 2);
  await sleep(1200);
  const tlRows = () => page.evaluate(() => document.querySelectorAll('#panel .tl-row').length);
  const before = await tlRows();
  await page.evaluate(() => document.querySelector('#panel .tl-places')?.click());
  await until(page, () => document.querySelector('#panel .tl-places')?.getAttribute('aria-pressed') === 'true', 4000);
  await sleep(800);
  const withAll = await tlRows();
  await page.evaluate(() => document.querySelector('#panel .tl-places')?.click());
  await sleep(800);
  ok(withAll > before && (await tlRows()) === before, `"All places" on the card: ${before} rows → ${withAll} → ${await tlRows()} off again`);
  await setLevel(page, 1);
  // at night only the 3D trains' windows glow, not the dots (Max, 2026-11-23)
  ok(!(await page.evaluate(() => Boolean(window.__map.getLayer('train-glow')))), 'no glow round the dots at night (only the 3D windows)');
  // a moving train 8+ minutes late says why it is late (Max, 2026-11-23: "don't see the reason for the delay")
  const lateOne = await page.evaluate(() => {
    const c = (window.__last3d ?? []).find(x => (x.v ?? 0) > 5 && !x.stale && (window.__lateness.get(x.id)?.minutes ?? 0) >= 8);
    return c ? window.__trains.get(c.id)?.number ?? null : null;
  });
  if (!lateOne) ok(false, 'a moving train 8+ min late in the replay to test "Why late?" on');
  else {
    await openTrainByNumber(page, lateOne);
    ok(await until(page, () => /why late\?/i.test(document.querySelector('.tr-extras .why')?.innerText ?? ''), 8000),
      `${lateOne}, moving and late, says why: "${await page.evaluate(() => document.querySelector('.tr-extras .why')?.innerText.replace(/\n/g, ' ') ?? '')}"`);
    await shot(page, '06b-why-late');
    await openTrainByNumber(page, 531);   // (Share below is 531's)
  }

  // ---- 3. Share (the copied-link way) ----
  // (Share beside the star in the sheet's head since 2026-11-23)
  ok(await page.evaluate(() => Boolean(document.querySelector('#sheet .sh-acts [data-act-id="share"]'))), 'Share is beside the star');
  await page.evaluate(() => document.querySelector('#sheet .sh-acts [data-act-id="share"]').click());
  await until(page, () => Boolean(window.__lastShare));
  await until(page, () => Boolean(document.querySelector('.tr-extras .share-note')), 3000);
  const shared = await page.evaluate(() => ({ ...window.__lastShare, note: document.querySelector('.tr-extras .share-note')?.innerText.replace(/\n/g, ' ') ?? '',
    onMap: Boolean(document.querySelector('#map .map-note:not([hidden])')) }));
  ok(shared.url === 'https://sparat.rangner.com/#train=531' && ['copied', 'shown'].includes(shared.how) && shared.note.includes(shared.url), `Share without a share sheet: ${shared.how}, "${shared.note}"`);
  // (Max's phone, 2026-11-23: the note over the map was hard to see beside the slider: now under Share, in the card)
  ok(!shared.onMap, 'the note is in the card, not over the map');
  await shot(page, '07-share');

  // ---- 4. Add my change: a later stop, then a train leaving there; pinned in Saved, its page a trip's ----
  // ("Add a change" only on the expanded card since 2026-11-23: not at half, there at full)
  await setLevel(page, 1);
  const atHalf = await page.evaluate(() => Boolean(document.querySelector('.tr-extras [data-go^="addchange:"]')?.offsetParent));
  await setLevel(page, 2);
  const atFull = await page.evaluate(() => Boolean(document.querySelector('.tr-extras [data-go^="addchange:"]')?.offsetParent));
  ok(!atHalf && atFull, `"Add a change" only on the expanded card (at half ${atHalf}, at full ${atFull})`);
  await page.evaluate(() => document.querySelector('.tr-extras [data-go^="addchange:"]')?.click());
  ok(await until(page, () => window.__stack.top().startsWith('addchange:')), 'Add my change opens its page');
  await until(page, () => Boolean(document.querySelector('#sheet [data-stop]')));
  const stopSig = await page.evaluate(() => { const b = document.querySelector('#sheet [data-stop]'); b.click(); return b.dataset.stop; });
  ok(await until(page, () => Boolean(document.querySelector('#sheet [data-dep]')), 10000), 'a stop picked: the trains leaving there, with the minutes to change');
  // (Max's phone, 2026-11-23: "When clicking a change, the map should show where it is")
  await sleep(2600);
  const shownStop = await page.evaluate(async (sig) => {
    const p = (await (await fetch('/stop-places.json')).json()).places?.[sig];
    if (!p) return null;
    const xy = window.__map.project(p), sheetTop = document.getElementById('sheet').getBoundingClientRect().top;
    return { x: Math.round(xy.x), y: Math.round(xy.y), in: xy.x > 0 && xy.x < innerWidth && xy.y > 0 && xy.y < sheetTop };
  }, stopSig);
  ok(shownStop === null || shownStop.in, `the change's station shown on the map above the sheet${shownStop ? ` (${shownStop.x}, ${shownStop.y})` : ' (no place known: not judged)'}`);
  await shot(page, '08-add-change');
  await page.evaluate(() => document.querySelector('#sheet [data-dep]').click());
  ok(await until(page, () => window.__stack.top().startsWith('change:') && Boolean(document.querySelector('.trip-next')), 10000), 'a train picked: the change is pinned and shown');
  const chg = await page.evaluate(() => document.querySelector('.pg[data-kind="trip"] .trip-next')?.innerText.replace(/\n/g, ' ') ?? '');
  ok(/min|lost/.test(chg), `the pinned change: "${chg}"`);
  // A pinned change is a trip (Max, 2026-11-23: "Shouldn't this be 'My trip' instead of 'mitt byte'? And all info and
  // options of that"; "it's either edit or delete"): "My trip", a pencil and a bin, no star
  const chgKey = (await top(page)).slice(7);
  const chgPage = await page.evaluate(k => ({ ttl: document.querySelector(`.pg[data-key="change:${k}"] .ttl`)?.textContent ?? '',
    acts: [...document.querySelectorAll('#sheet .sh-acts [data-act-id]')].map(b => b.dataset.actId).join(','), star: !document.querySelector('#sheet .sh-star').hidden }), chgKey);
  ok(chgPage.ttl === 'My trip' && chgPage.acts === 'edit,del' && !chgPage.star, `the change's page: "${chgPage.ttl}", buttons ${chgPage.acts || 'none'}, star: ${chgPage.star}`);
  await setLevel(page, 2);
  await shot(page, '09-pinned-change');
  await page.evaluate(() => window.__stack.home(1));
  await sleep(800);
  ok(await page.evaluate(() => Boolean(document.querySelector('.pg[data-key="home"] [data-go^="change:"]'))), 'Saved lists the pinned change');
  await page.evaluate(() => document.querySelector('.pg[data-key="home"] .rows [data-go^="trip:"]')?.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await shot(page, '10-mine');
  // Its pencil: the same two steps again from its first train; the new pair takes its place
  await page.evaluate(k => window.__stack.open(`change:${k}`), chgKey);
  await until(page, k => window.__stack.top() === `change:${k}` && Boolean(document.querySelector('#sheet .sh-acts [data-act-id="edit"]')), 5000, chgKey);
  await page.evaluate(() => document.querySelector('#sheet .sh-acts [data-act-id="edit"]')?.click());
  ok(await until(page, () => window.__stack.top().startsWith('editchange:') && Boolean(document.querySelector('#sheet [data-stop]')), 15000), `its pencil opens the change's steps again (${await top(page)})`);
  await page.evaluate(sig => document.querySelector(`#sheet [data-stop="${sig}"]`)?.click(), stopSig);
  await until(page, () => Boolean(document.querySelector('#sheet [data-dep]')), 10000);
  await page.evaluate(() => { const d = document.querySelectorAll('#sheet [data-dep]'); (d[1] ?? d[0])?.click(); });
  ok(await until(page, () => window.__stack.top().startsWith('change:') && Boolean(document.querySelector('.trip-next')), 10000), "a train picked again: back on the change's page");
  const edited = await page.evaluate(old => ({ top: window.__stack.top(), keys: window.__stack.keys(), old: Boolean(window.__ideas.favourites.change(old)),
    now: Boolean(window.__ideas.favourites.change(window.__stack.top().slice(7))) }), chgKey);
  ok(edited.now && (edited.top === `change:${chgKey}` || !edited.old) && !edited.keys.some(k => k.startsWith('editchange:')) && edited.keys.filter(k => k.startsWith('change:')).length === 1,
    `the edited change took the old one's place (${edited.top}; pages ${edited.keys.join(' > ')})`);
  // Its bin: two taps
  await page.evaluate(() => document.querySelector('#sheet .sh-acts [data-act-id="del"]')?.click());
  await sleep(600);
  await page.evaluate(() => document.querySelector('#sheet .sh-acts [data-act-id="del"]')?.click());
  ok(await until(page, k => !window.__ideas.favourites.change(k) && !window.__stack.top().startsWith('change:'), 5000, edited.top.slice(7)), `its bin, tapped twice, takes it away (now ${await top(page)})`);

  }
  if (part('peek')) {
  // ---- 5. Peek: hold Lund C on the map ----
  await toRest(page);
  await page.evaluate(() => { window.__map.stop(); window.__map.jumpTo({ center: [13.187, 55.69], zoom: 12.5 }); });
  // (until the map has settled: a busy computer still draws it a while)
  await until(page, () => !window.__map.isMoving() && [...document.querySelectorAll('.station-name')].some(e => e.textContent === 'Lund C'), 8000);
  // (a note over the map takes a tap where it sits: 2026-11-23 Share's sat on Lund C, so the plain tap below hit it)
  await until(page, () => [...document.querySelectorAll('.map-note')].every(n => n.hidden), 8000);
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
    const opened = await until(page, () => window.__stack.top() === 'station:Lu');
    // (said when it fails: what is there, and whether the map's own tap there opens it; 2026-11-23 in a whole run it
    // did, the mouse's tap didn't)
    const seen = opened ? null : await page.evaluate(p => ({ keys: window.__stack.keys(), level: window.__stack.level, at: document.elementFromPoint(p.x, p.y)?.className,
      feats: window.__map.queryRenderedFeatures([[p.x - 12, p.y - 12], [p.x + 12, p.y + 12]]).map(f => `${f.layer.id}:${f.properties.sig ?? f.properties.id ?? ''}`).slice(0, 6) }), at);
    if (seen) { seen.mapTapOpens = await page.evaluate(async (q) => { const m = window.__map; m.fire('click', { point: { x: q.x, y: q.y }, lngLat: m.unproject([q.x, q.y]), originalEvent: new MouseEvent('click') }); await new Promise(r => setTimeout(r, 600)); return window.__stack.top(); }, at);
    }
    ok(opened, `a plain tap still opens the board${seen ? ` (${JSON.stringify(seen)})` : ''}`);
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
    const p = await waitForMap(browser, { ...hash, shop: 'true', slider: '1', size: { ...PHONE, width: 843, height: 393 } });
    await toRest(p);
    await p.evaluate(() => window.__ideas.shop.pretendIdle());
    ok(await until(p, () => window.__ideas.shop.running && document.documentElement.classList.contains('shop'), 6000), 'on its side and untouched: the shop window starts, the buttons fade');
    await sleep(4500);
    // (the scale slider stayed on 2026-11-23)
    const shown = await p.evaluate(() => ['#sheet', '.scale', '#status', '.maplibregl-ctrl-bottom-right'].filter(s => { const e = document.querySelector(s); return e && e.getClientRects().length > 0 && Number(getComputedStyle(e).opacity) > 0.05; }));
    ok(shown.length === 0, `everything pressable faded, the scale slider too${shown.length ? ` (still showing: ${shown.join(', ')})` : ''}`);
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
