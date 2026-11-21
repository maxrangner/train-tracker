// How well do the places ahead on the card (src/places-ahead.js) match the places a train really passes? Trafikverket
// lists a place a train passes without stopping only once it is passed (docs/data.md), so the card works the ones
// ahead out from the drawn route: every station within NEAR_M of it. Here, for every finished trip in a recording's
// saved routes (data/routes-<name>.jsonl, written after the trips), the route is drawn from its stops alone (as for
// the stretch ahead, where nothing else is known), the stations along it are taken, and they are compared with the
// places it really passed (its rows not shown to passengers, with a time):
//   found: worked out and really passed; missed: passed but not worked out; extra: worked out but never reported;
//   order: of the found ones, the share of neighbours in the same order as really passed.
// Only the places on the list of those Trafikverket reports (src/reported-places.js, as the card); --all: every station.
// The list is made from these same recordings, so here it can only help; measured on days it had not seen:
// tools/reported-places.mjs (its top).
// Run: node tools/places-check.mjs [data/routes-<name>.jsonl ...] [--near 50,100,150,250] [--worst] [--train <op>] [--all]
//   (--train: that trip's places, worked out and passed, side by side)
//   (no file: the two newest recordings with saved routes)
import { readFileSync, readdirSync } from 'node:fs';
import { netFromJSON } from '../src/rail-net.js';
import { pathOf } from '../src/path.js';
import { placesAlong, NEAR_M } from '../src/places-ahead.js';
import { REPORTED } from '../src/reported-places.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const files = argv.filter(a => a.endsWith('.jsonl'));
const list = files.length ? files : readdirSync('data').filter(f => f.startsWith('routes-')).sort().slice(-2).map(f => `data/${f}`);
const nears = opt('--near', `30,${NEAR_M},100,250`).split(',').map(Number);
const listed = argv.includes('--all') ? null : REPORTED;
const net = netFromJSON(JSON.parse(readFileSync('public/rail-net.json', 'utf8')));
const stationList = JSON.parse(readFileSync('data/stations.json', 'utf8')).map((s) => {
  const m = s.Geometry?.WGS84?.match(/POINT \(([\d.-]+) ([\d.-]+)\)/);
  return { sig: s.LocationSignature, name: s.AdvertisedLocationName, lon: m ? +m[1] : null, lat: m ? +m[2] : null };
});
const stations = new Map(stationList.map(s => [s.sig, s]));

const total = Object.fromEntries(nears.map(n => [n, { found: 0, missed: 0, extra: 0, pairs: 0, inOrder: 0 }]));
const missedBy = new Map(), extraBy = new Map();
let trips = 0, real = 0, noPlace = 0, ms = 0, worst = [];
for (const file of list) {
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(a => !a.Deleted);
  // The stations a train may turn round at (the page uses the advertised stations): every station that is a stop here.
  const reversals = [...new Set(rows.filter(a => a.Advertised).map(a => a.LocationSignature))].map(s => stations.get(s)).filter(s => s?.lon != null);
  const byTrip = new Map();
  for (const a of rows) {
    const k = `${a.OperationalTrainNumber}|${a.ScheduledDepartureDateTime}`;
    (byTrip.get(k) ?? byTrip.set(k, []).get(k)).push(a);
  }
  for (const [key, tr] of byTrip) {
    const t = a => Date.parse(a.AdvertisedTimeAtLocation ?? a.TimeAtLocation);
    tr.sort((a, b) => t(a) - t(b) || Date.parse(a.TimeAtLocation ?? 0) - Date.parse(b.TimeAtLocation ?? 0));
    const stopRows = tr.filter(a => a.Advertised);
    if (stopRows.length < 2 || !stopRows.at(-1).TimeAtLocation) continue;   // not finished (or no stops)
    const stopSigs = new Set(stopRows.map(a => a.LocationSignature));
    const places = [];
    for (const a of stopRows) {
      const st = stations.get(a.LocationSignature);
      if (st?.lon == null || places.at(-1)?.sig === st.sig) continue;
      places.push({ sig: st.sig, lon: st.lon, lat: st.lat, stop: true });
    }
    if (places.length < 2) continue;
    const passed = [];
    for (const a of tr) {
      if (a.Advertised || !a.TimeAtLocation || stopSigs.has(a.LocationSignature) || passed.includes(a.LocationSignature)) continue;
      if (stations.get(a.LocationSignature)?.lon == null) { noPlace++; continue; }
      passed.push(a.LocationSignature);
    }
    trips++; real += passed.length;
    const path = pathOf(places, net, { reversals });
    for (const n of nears) {
      const t0 = performance.now();
      const along = placesAlong(path, stationList, n).map(p => p.sig).filter(s => !stopSigs.has(s) && (!listed || listed.has(s)));
      if (n === NEAR_M) ms += performance.now() - t0;
      const got = new Set(along), was = new Set(passed), T = total[n];
      const found = along.filter(s => was.has(s));
      T.found += found.length;
      const missed = passed.filter(s => !got.has(s)), extra = along.filter(s => !was.has(s));
      T.missed += missed.length; T.extra += extra.length;
      const rank = new Map(passed.map((s, i) => [s, i]));
      for (let i = 1; i < found.length; i++) { T.pairs++; if (rank.get(found[i]) > rank.get(found[i - 1])) T.inOrder++; }
      if (n === NEAR_M && opt('--train') === key.split('|')[0]) {
        const name = s => stations.get(s)?.name ?? s;
        console.log(`${key}
  worked out: ${along.map(name).join(', ')}
  passed:     ${passed.map(name).join(', ')}`);
      }
      if (n === NEAR_M) {
        for (const s of missed) missedBy.set(s, (missedBy.get(s) ?? 0) + 1);
        for (const s of extra) extraBy.set(s, (extraBy.get(s) ?? 0) + 1);
        worst.push({ key, from: places[0].sig, to: places.at(-1).sig, passed: passed.length, missed: missed.length, extra: extra.length });
      }
      path._along = null;
    }
  }
}
const pc = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : '-');
console.log(`${list.join(', ')}: ${trips} finished trips, ${real} places really passed (and ${noPlace} with no place in TrainStation);` +
  ` ${listed ? `only the ${listed.size} places on the list` : 'every station'}`);
for (const n of nears) {
  const T = total[n];
  console.log(`within ${String(n).padStart(3)} m: found ${pc(T.found, real)} of the places passed, missed ${pc(T.missed, real)};` +
    ` of those shown, ${pc(T.extra, T.found + T.extra)} never reported; order right ${pc(T.inOrder, T.pairs)}`);
}
console.log(`placesAlong at ${NEAR_M} m: ${(ms / trips).toFixed(1)} ms a trip on average`);
const name = s => stations.get(s)?.name ?? s;
const top = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([s, k]) => `${name(s)} (${s}) ${k}`).join(', ');
console.log(`most often missed at ${NEAR_M} m: ${top(missedBy)}`);
console.log(`most often extra at ${NEAR_M} m: ${top(extraBy)}`);
if (argv.includes('--worst')) {
  worst.sort((a, b) => (b.missed + b.extra) - (a.missed + a.extra));
  for (const w of worst.slice(0, 15)) console.log(`  ${w.key} ${name(w.from)} -> ${name(w.to)}: passed ${w.passed}, missed ${w.missed}, extra ${w.extra}`);
}
