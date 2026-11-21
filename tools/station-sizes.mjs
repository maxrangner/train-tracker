// Which stations are "bigger" (Max, 2026-11-21, option c C: at middle zoom the smaller stations' names are small and
// grey). From every recording's timetable in data/ (the trains with a stop advertised there, counted once per
// recording, summed) and the stations' places (data/stations.json). A station is smaller when another within RADIUS_KM
// has at least RATIO times its trains (unless OTHER regional or long-distance trains stop there), or when no train stops there; the rule compares neighbours, so a lone
// station up north counts as bigger. Writes src/big-stations.json (read by src/map.js). Run again after new recordings:
//   node tools/station-sizes.mjs [--show Cst,Sci,...]   (--show prints those stations' counts and nearest busier one)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

// A station where at least OTHER regional or long-distance trains stop (summed over the recordings) is a place to
// change trains and always bigger (Sundbyberg's Mälartåg; weighting those trains instead made Stockholm C outweigh
// City, Odenplan and Stockholms S).
const RADIUS_KM = 5, RATIO = 1.5, OTHER = 15;
const files = readdirSync('data').filter(f => /^timetable-.*\.jsonl$/.test(f)).sort();
const count = new Map();   // station -> trains stopping, summed over the recordings
const other = new Map();   // station -> of those, the regional and long-distance ones (not commuter trains)
for (const f of files) {
  const per = new Map();
  for (const line of readFileSync(`data/${f}`, 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (!r.Advertised || !r.LocationSignature || r.Deleted) continue;
    const commuter = (r.ProductInformation ?? []).some(p => /pendelt/i.test(p.Description ?? ''));
    (per.get(r.LocationSignature) ?? per.set(r.LocationSignature, new Map()).get(r.LocationSignature)).set(r.OperationalTrainNumber, commuter);
  }
  for (const [s, trains] of per) {
    count.set(s, (count.get(s) ?? 0) + trains.size);
    other.set(s, (other.get(s) ?? 0) + [...trains.values()].filter(c => !c).length);
  }
}
const stations = JSON.parse(readFileSync('data/stations.json', 'utf8')).map((s) => {
  const [lon, lat] = /POINT \(([-\d.]+) ([-\d.]+)\)/.exec(s.Geometry?.WGS84 ?? '')?.slice(1).map(Number) ?? [];
  return { sig: s.LocationSignature, name: s.AdvertisedLocationName, lon, lat, n: count.get(s.LocationSignature) ?? 0, other: other.get(s.LocationSignature) ?? 0 };
}).filter(s => Number.isFinite(s.lon));
const km = (a, b) => Math.hypot((a.lon - b.lon) * 111.32 * Math.cos(a.lat * Math.PI / 180), (a.lat - b.lat) * 110.57);
const busier = s => stations.filter(o => o !== s && o.n >= RATIO * s.n && o.n > 0 && km(s, o) <= RADIUS_KM).sort((a, b) => b.n - a.n)[0];
const big = stations.filter(s => s.other >= OTHER || (s.n > 0 && !busier(s))).map(s => s.sig).sort();
writeFileSync('src/big-stations.json', `${JSON.stringify({
  about: `The bigger stations (tools/station-sizes.mjs): no station within ${RADIUS_KM} km has ${RATIO} times their trains stopping, or ${OTHER}+ regional or long-distance trains stop there; counted from ${files.length} recordings of Trafikverket's timetable (CC0). At middle zoom the other stations' names are small and grey (src/map.js).`,
  big,
})}\n`);
console.log(`station-sizes: ${big.length} bigger of ${stations.filter(s => s.n > 0).length} stations with stops (${stations.length} in all), from ${files.length} recordings -> src/big-stations.json`);
const show = process.argv.includes('--show') ? process.argv[process.argv.indexOf('--show') + 1].split(',') : [];
for (const sig of show) {
  const s = stations.find(x => x.sig === sig);
  if (!s) { console.log(sig, 'not found'); continue; }
  const b = busier(s);
  console.log(`${s.name} (${sig}) ${s.n}: ${big.includes(sig) ? 'bigger' : b ? `smaller, ${b.name} ${b.n} at ${km(s, b).toFixed(1)} km` : 'smaller (no stops)'}`);
}
