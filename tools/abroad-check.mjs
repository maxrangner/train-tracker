// Trains to and from abroad (src/abroad.js, 2026-11-18): the card's extra row and the map's leg to the foreign end.
// 1. abroadEnds on made-up routes: to Oslo, from Köpenhamn (stations without a country: the code's prefix), the stop
//    at the border cancelled, a trip inside Sweden, a Swedish code with a dot ("Gä.").
// 2. In the test browser on the evening-rush replay (CARD_HOUR, its routes saved): a train to abroad, one from abroad
//    and one inside Sweden opened from the map, light and dark: the row is there with the foreign name and its flag,
//    the map's leg ends at the foreign station; none for the Swedish one; no page errors.
// node tools/abroad-check.mjs (with npm run dev; PAGE= for another port). Not seen here: how smooth the motion is.
import { readFileSync, mkdirSync } from 'node:fs';
import { abroadEnds, isAbroad, flagSvg } from '../src/abroad.js';
import { launch, address, sleep, PHONE, CARD_HOUR } from './lib/browser.mjs';
mkdirSync('shots/abroad', { recursive: true });

const fails = [], notes = [];
const expect = (ok, what) => { (ok ? notes : fails).push(what); };

// ---- 1. abroadEnds ----
const ST = { Ar: { name: 'Arvika', country: 'SE', lon: 12.59, lat: 59.65 }, 'No.osl': { name: 'Oslo', country: 'NO', lon: 10.75, lat: 59.91 },
  Hie: { name: 'Hyllie' }, 'Dk.kh': { name: 'Köpenhamn H', lon: 12.56, lat: 55.67 }, Cst: { name: 'Stockholm C', country: 'SE' }, 'Gä.x': { name: 'Gällivare spår' } };
const station = sig => ST[sig];
const row = (s, extra = {}) => ({ station: s, advertised: true, activity: 'Avgang', canceled: false, problems: [], ...extra });
const toOslo = abroadEnds({ to: 'No.osl', from: 'Cst', stops: [row('Cst'), row('Ar', { activity: 'Ankomst' })] }, station);
expect(toOslo.to?.name === 'Oslo' && toOslo.to.country === 'NO' && !toOslo.to.cut && toOslo.from === null, `to Oslo: ${JSON.stringify(toOslo.to && { name: toOslo.to.name, country: toOslo.to.country })}, from ${toOslo.from}`);
const fromKh = abroadEnds({ to: 'Cst', from: 'Dk.kh', stops: [row('Hie'), row('Cst', { activity: 'Ankomst' })] }, station);
expect(fromKh.from?.country === 'DK' && fromKh.to === null, `from Köpenhamn (no country given, the prefix): ${fromKh.from?.country}`);
const cut = abroadEnds({ to: 'No.osl', from: 'Cst', stops: [row('Cst'), row('Ar', { activity: 'Ankomst', canceled: true, problems: ['Buss ersätter'] })] }, station);
expect(cut.to?.cut === true && cut.to.texts[0] === 'Buss ersätter', `the border stop cancelled: cut ${cut.to?.cut}, "${cut.to?.texts.join('; ')}"`);
const home = abroadEnds({ to: 'Ar', from: 'Cst', stops: [row('Cst'), row('Ar')] }, station);
expect(!home.to && !home.from, 'a trip inside Sweden: no end abroad');
expect(!isAbroad('Gä.x', ST['Gä.x']) && isAbroad('No.osl') && !isAbroad(null), 'codes: "Gä." Swedish, "No." abroad, none: not');
expect(flagSvg('NO').startsWith('<svg') && flagSvg('XX') === '', 'flags: Norway drawn, an unknown country none');

// ---- 2. In the page ----
// The replay's trips abroad, from its saved routes (the first row's From, the last row's To; as fetchRoute).
const stations = new Map(JSON.parse(readFileSync('data/stations.json', 'utf8')).map(s => [s.LocationSignature, s]));
const rows = readFileSync(`data/routes-${CARD_HOUR}.jsonl`, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const trips = new Map();
for (const a of rows) {
  if (!a.Advertised) continue;
  const t = trips.get(a.AdvertisedTrainIdent) ?? { from: null, to: null, first: null, last: null };
  t.from ??= a.FromLocation?.[0]?.LocationName ?? null;
  t.to = a.ToLocation?.[0]?.LocationName ?? t.to;
  // The first and last passenger rows: cancelled there, the trip doesn't go abroad (no leg; the row says so).
  if (!t.first || a.AdvertisedTimeAtLocation < t.first.AdvertisedTimeAtLocation) t.first = a;
  if (!t.last || a.AdvertisedTimeAtLocation >= t.last.AdvertisedTimeAtLocation) t.last = a;
  trips.set(a.AdvertisedTrainIdent, t);
}
const kind = n => { const t = trips.get(n); return !t ? null : isAbroad(t.to) ? 'to' : isAbroad(t.from) ? 'from' : 'home'; };
const nameOf = sig => stations.get(sig)?.AdvertisedLocationName ?? sig;

const browser = await launch();
try {
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage();
    await page.setViewport(PHONE);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(address({ replay: CARD_HOUR, lang: 'sv', theme, view: '6/57.6/14.5' }), { waitUntil: 'domcontentloaded' });
    for (let t0 = Date.now(); Date.now() - t0 < 40000; await sleep(400)) {
      if (await page.evaluate(() => (window.__trains?.count ?? 0) > 0 && Boolean(window.__map?.loaded())).catch(() => false)) break;
    }
    await sleep(2500);
    // The trains on the screen now (the camera goes back to the start view first: opening a train moves it).
    const onMap = () => page.evaluate(() => { window.__map.jumpTo({ center: [14.5, 57.6], zoom: 6 });
      return window.__map.queryRenderedFeatures({ layers: ['train-dots'] }).map(f => ({ id: f.properties.id, number: String(window.__trains.get(f.properties.id)?.number ?? '') })); });
    for (const k of ['to', 'from', 'home']) {
      await page.evaluate(() => window.__map.jumpTo({ center: [14.5, 57.6], zoom: 6 }));
      await sleep(1200);
      // A dot's number is not always the trip's public one (a dot "1105" opened Pågatåg 1922): the card's own number
      // decides; up to 6 candidates are tried.
      let t = null;
      for (const c of (await onMap()).filter(x => kind(x.number) === k).slice(0, 6)) {
        await page.evaluate(() => window.__map.jumpTo({ center: [14.5, 57.6], zoom: 6 }));
        await sleep(600);
        const opened = await page.evaluate(id => {
          const m = window.__map, f = m.queryRenderedFeatures({ layers: ['train-dots'] }).find(x => x.properties.id === id);
          if (!f) return false;
          const q = m.project(f.geometry.coordinates);
          m.fire('click', { point: q, lngLat: m.unproject(q), originalEvent: new MouseEvent('click') });
          return true;
        }, c.id);
        if (!opened) continue;
        await sleep(3500);   // the route, then the camera and the path
        const head = await page.evaluate(() => document.querySelector('#panel .panel-head strong')?.textContent ?? '');
        if (kind(head) === k) { t = { ...c, number: head }; break; }
        await page.evaluate(() => document.querySelector('#panel .panel-close')?.click());
        await sleep(600);
      }
      if (!t) { fails.push(`${theme}: no train ${k === 'home' ? 'inside Sweden' : `${k} abroad`} on the map to open`); continue; }
      const trip = trips.get(t.number), foreign = k === 'to' ? trip.to : k === 'from' ? trip.from : null;
      await page.evaluate(() => { const p = document.getElementById('panel'); if (!p.classList.contains('full')) p.querySelector('.panel-more')?.click(); });
      await sleep(900);
      const seen = await page.evaluate(() => {
        const r = document.querySelector('#panel .tl-row.abroad');
        const src = window.__map.getSource('abroad')?.serialize().data.features ?? [];
        return { row: r ? { dir: r.classList.contains('to') ? 'to' : 'from', name: r.querySelector('.ab-name')?.textContent, sub: r.querySelector('small')?.textContent,
          flag: Boolean(r.querySelector('.tl-flag svg')), first: r === document.querySelector('#panel .tl-row'), last: r === [...document.querySelectorAll('#panel .tl-row')].at(-1) } : null,
          line: src.find(f => f.geometry.type === 'LineString')?.geometry.coordinates ?? null, flags: src.filter(f => f.geometry.type === 'Point').map(f => f.properties.flag),
          head: document.querySelector('#panel .panel-head strong')?.textContent };
      });
      const label = `${theme}, train ${t.number} (${k === 'home' ? 'inside Sweden' : `${k} ${nameOf(foreign)}`})`;
      if (k === 'home') {
        expect(!seen.row && !seen.line, `${label}: no row abroad, no leg`);
      } else {
        const st = stations.get(foreign), m = st?.Geometry?.WGS84?.match(/POINT \(([-\d.]+) ([-\d.]+)/);
        const endAt = seen.line && (k === 'to' ? seen.line.at(-1) : seen.line[0]);
        const near = m && endAt && Math.abs(endAt[0] - Number(m[1])) < 1e-6 && Math.abs(endAt[1] - Number(m[2])) < 1e-6;
        expect(seen.row?.dir === k && seen.row.name?.includes(nameOf(foreign)) && seen.row.flag && (k === 'to' ? seen.row.last : seen.row.first),
          `${label}: the row "${seen.row?.name}" / "${seen.row?.sub}"${seen.row?.flag ? ', a flag' : ''}, ${k === 'to' ? 'last' : 'first'}`);
        const cut = (k === 'to' ? trip.last : trip.first)?.Canceled === true;
        if (cut) expect(!seen.line && /^(Går inte|Not running)/.test(seen.row?.sub ?? ''), `${label}: cancelled at the border: "${seen.row?.sub}", no leg on the map`);
        else expect(near && seen.flags.length === 1, `${label}: the map's leg ends at ${nameOf(foreign)} (${seen.flags.join(', ')})`);
        await page.screenshot({ path: `shots/abroad/card-${k}-${theme}${cut ? '-cut' : ''}.jpg`, quality: 85 });
        // The map: the card closed, the leg in view.
        if (seen.line) {
          await page.evaluate(() => { const f = document.querySelector('#panel .panel-follow[aria-pressed="true"]'); if (f) f.click(); });   // the camera stops following
          await sleep(400);
          await page.evaluate(line => { const lons = line.map(c => c[0]), lats = line.map(c => c[1]);
            window.__map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: { top: 140, bottom: 140, left: 70, right: 70 }, duration: 0, maxZoom: 9 }); }, seen.line);
          await page.evaluate(() => document.getElementById('panel').classList.remove('full'));
          await sleep(2500);
          await page.screenshot({ path: `shots/abroad/map-${k}-${theme}.jpg`, quality: 85 });
        }
      }
      await page.evaluate(() => document.querySelector('#panel .panel-close')?.click());
      await sleep(800);
      const after = await page.evaluate(() => (window.__map.getSource('abroad')?.serialize().data.features ?? []).length);
      if (k !== 'home') expect(after === 0, `${label}: closing the card takes the leg away (${after} left)`);
    }
    // Stations abroad: shown, not tappable (2026-11-18); a Swedish one still opens its board. Close in, so the names
    // and rings are drawn; each tapped on its ring.
    const tapStation = async (center, abroad) => {
      await page.evaluate(c => window.__map.jumpTo({ center: c, zoom: 12 }), center);
      await sleep(2500);
      return page.evaluate(want => {
        const m = window.__map, fs = m.queryRenderedFeatures({ layers: ['station-dots'] }).filter(f => /^(At|De|Dk|It|Nl|No|Pt)\./.test(f.properties.sig) === want);
        if (!fs.length) return { none: true };
        // One with no train within 24 px (a train next to it takes the tap, rightly).
        const clear = f => { const q = m.project(f.geometry.coordinates);
          return !m.queryRenderedFeatures([[q.x - 24, q.y - 24], [q.x + 24, q.y + 24]], { layers: ['train-dots'] }).length; };
        // None clear here at this moment (a train passing every station on screen): another spot is tried.
        const f = fs.find(clear);
        if (!f) return { busy: true };
        const q = m.project(f.geometry.coordinates);
        document.getElementById('board').hidden = true;
        m.fire('click', { point: q, lngLat: m.unproject(q), originalEvent: new MouseEvent('click') });
        return new Promise(r => setTimeout(() => r({ sig: f.properties.sig, name: f.properties.name, shown: f !== null, board: !document.getElementById('board').hidden }), 1200));
      }, abroad);
    };
    // A few spots each, the first with a station clear of trains (flaky before 2026-11-18: a train passing Triangeln
    // took the tap, rightly). None clear anywhere: said, not failed.
    const firstClear = async (spots, abroad) => {
      for (const c of spots) { const r = await tapStation(c, abroad); if (!r.busy && !r.none) return r; }
      return null;
    };
    const dk = await firstClear([[12.565, 55.672], [12.65, 55.63], [12.52, 55.70]], true);
    if (dk) expect(!dk.board, `${theme}: a station abroad (${dk.name}) is drawn, a tap opens no board`);
    else notes.push(`${theme}: a station abroad not checked (no station clear of trains in 3 spots)`);
    const se = await firstClear([[13.0, 55.609], [13.19, 55.705], [12.70, 56.045], [18.06, 59.33]], false);
    if (se) expect(se.board, `${theme}: a Swedish station (${se.name}) still opens its board`);
    else notes.push(`${theme}: a Swedish station's tap not checked (no station clear of trains in 4 spots)`);
    await page.evaluate(() => document.querySelector('#board .panel-close')?.click());
    expect(!errors.length, `${theme}: page errors: ${errors.slice(0, 3).join(' | ') || 'none'}`);
    await page.close();
  }
} finally { await browser.close(); }

for (const n of notes) console.log(`  ok   ${n}`);
for (const f of fails) console.log(`  FAIL ${f}`);
console.log(fails.length ? `abroad-check: ${fails.length} failed` : `abroad-check ok: ${notes.length} checks (made-up routes; trains to, from and inside Sweden, light and dark)`);
process.exit(fails.length ? 1 : 0);
