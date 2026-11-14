// Where trains really stand at each passenger station, from the recordings: the map draws a station's ring and name
// there instead of at Trafikverket's station point, which is often not at the platform (Bohus: 1.3 km off; over
// 200 m at 22 of 258 measured stations). Night of 2026-11-14 (docs: night-1114/stops.md), Max: "looks like they miss
// the station".
// - A real stop: one train at one station with an actual arrival and an actual departure (whole minutes, early: the
//   stand is looked for from the arrival time to 75 s after the departure time), announced to passengers.
// - Measured from GPS reports only: a run of reports under 2 km/h that stay within 25 m, the one overlapping the stop
//   most. Fixed-place reports are left out (no speed; or speed 0-1 exactly on a place some train sent without a speed).
//   A stand nearer another stop of the same train belongs to that one.
// - A station whose "GPS" stands sit on 5 or fewer coordinates over 10 or more stops is left out (fixed places sent
//   with a speed: the tunnel stations).
// - Per station with MIN_STOPS or more: the median of the stands.
// -> public/stop-places.json { about, made, places: { signature: [lon, lat, stops] } }. Prints the stations whose
// place moved over 50 m since the last file. Run again when recordings are added (a place moves only when a platform
// is rebuilt). Made from Trafikverket's data only (CC0).
// Run: node tools/stop-places.mjs
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';

const MIN_STOPS = 5;
const OUT = 'public/stop-places.json';
const R = Math.PI / 180;
const metres = (a, b) => Math.hypot((b.lon - a.lon) * R * Math.cos((a.lat + b.lat) / 2 * R), (b.lat - a.lat) * R) * 6371000;
const stations = new Map(JSON.parse(readFileSync('data/stations.json', 'utf8')).map(st => {
  const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(st.Geometry?.WGS84 ?? '');
  return [st.LocationSignature, m ? { lon: Number(m[1]), lat: Number(m[2]), name: st.AdvertisedLocationName } : null];
}).filter(([, v]) => v));
const names = readdirSync('data').filter(f => f.startsWith('timetable-') && existsSync(`data/positions-${f.slice(10)}`)).map(f => f.slice(10, -6)).sort();

// Every coordinate ever sent without a speed: the fixed places.
const fixed = new Set();
for (const name of names) for (const line of readFileSync(`data/positions-${name}.jsonl`, 'utf8').split('\n')) {
  if (!line.includes('"WGS84"') || line.includes('"Speed"')) continue;
  const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(line);
  if (m) fixed.add(`${m[1]},${m[2]}`);
}

const stands = [];   // { sig, lon, lat }
const seen = new Set();
for (const name of names) {
  const acts = new Map();
  for (const line of readFileSync(`data/timetable-${name}.jsonl`, 'utf8').split('\n')) {
    if (!line) continue;
    const a = JSON.parse(line);
    if (a.Deleted || !a.OperationalTrainNumber || !stations.has(a.LocationSignature)) continue;
    const k = `${a.OperationalTrainNumber}/${a.ScheduledDepartureDateTime.slice(0, 10)}|${a.LocationSignature}`;
    const e = acts.get(k) ?? acts.set(k, { adv: false }).get(k);
    if (a.TimeAtLocation) e[a.ActivityType] = Date.parse(a.TimeAtLocation);
    if (a.Advertised) e.adv = true;
  }
  const reps = new Map();
  let recFrom = Infinity, recTo = -Infinity;
  for (const line of readFileSync(`data/positions-${name}.jsonl`, 'utf8').split('\n')) {
    if (!line) continue;
    const p = JSON.parse(line);
    const got = Date.parse(p.got);
    if (got < recFrom) recFrom = got;
    if (got > recTo) recTo = got;
    const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(p?.Position?.WGS84 ?? '');
    if (!m || !p.Train || p.Deleted) continue;
    const id = `${p.Train.OperationalTrainNumber}/${p.Train.OperationalTrainDepartureDate.slice(0, 10)}`;
    const speed = p.Speed ?? null, c = `${m[1]},${m[2]}`;
    (reps.get(id) ?? reps.set(id, []).get(id)).push({ lon: Number(m[1]), lat: Number(m[2]), speed, time: Date.parse(p.TimeStamp),
      fixed: speed === null || (speed < 2 && fixed.has(c)) });
  }
  for (const list of reps.values()) {
    list.sort((a, b) => a.time - b.time);
    for (let i = list.length - 1; i > 0; i--) if (list[i].time === list[i - 1].time) list.splice(i, 1);
  }
  const trainStops = new Map();
  for (const [k] of acts) { const [key, sig] = k.split('|'); (trainStops.get(key) ?? trainStops.set(key, []).get(key)).push(sig); }
  for (const [k, e] of acts) {
    if (e.Ankomst === undefined || e.Avgang === undefined || !e.adv || seen.has(k)) continue;
    const [key, sig] = k.split('|');
    const st = stations.get(sig), list = reps.get(key) ?? [];
    const from = e.Ankomst, to = e.Avgang + 75000;
    if (from < recFrom || to > recTo) continue;
    const near = list.filter(r => r.time >= from - 120000 && r.time <= to + 60000 && metres(r, st) < 2500);
    const runs = [];
    let run = [];
    for (const r of near) {
      if (r.fixed) continue;
      const still = r.speed < 2;
      if (still && (!run.length || metres(run[0], r) <= 25)) run.push(r);
      else { if (run.length) runs.push(run); run = still ? [r] : []; }
    }
    if (run.length) runs.push(run);
    const overlap = rr => Math.min(to, rr.at(-1).time) - Math.max(from, rr[0].time);
    let best = null;
    for (const rr of runs) if (overlap(rr) >= 0 && (!best || overlap(rr) > overlap(best))) best = rr;
    if (!best) continue;
    if ((trainStops.get(key) ?? []).some(o => o !== sig && metres(best[0], stations.get(o)) < metres(best[0], st) - 50)) continue;
    const med = arr => { const x = [...arr].sort((a, b) => a - b); return x[x.length >> 1]; };
    seen.add(k);
    stands.push({ sig, lon: med(best.map(r => r.lon)), lat: med(best.map(r => r.lat)) });
  }
}

const bySig = new Map();
for (const s of stands) (bySig.get(s.sig) ?? bySig.set(s.sig, []).get(s.sig)).push(s);
const q = (arr, f) => { const x = Float64Array.from(arr).sort(); return x[Math.floor(f * (x.length - 1))]; };
const places = {};
let fixedStations = 0;
for (const [sig, l] of bySig) {
  if (l.length >= 10 && new Set(l.map(s => `${s.lon},${s.lat}`)).size <= 5) { fixedStations++; continue; }
  if (l.length < MIN_STOPS) continue;
  places[sig] = [+q(l.map(s => s.lon), 0.5).toFixed(6), +q(l.map(s => s.lat), 0.5).toFixed(6), l.length];
}
const old = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).places : {};
const moved = Object.entries(places).filter(([sig, p]) => old[sig] && metres({ lon: p[0], lat: p[1] }, { lon: old[sig][0], lat: old[sig][1] }) > 50);
writeFileSync(OUT, JSON.stringify({
  about: 'Where trains stand at passenger stations: the median of the GPS stands at real stops (an actual arrival and departure), at least 5 per station. Per station: [lon, lat, stops measured]. Made by tools/stop-places.mjs from Trafikverket\'s data (CC0).',
  made: { recordings: names, when: new Date().toISOString().slice(0, 10) }, places }));

// How far the stands are from the ring: at Trafikverket's point (before) and at the stopping place (now).
const ringBefore = [], ringNow = [];
for (const s of stands) {
  if (!places[s.sig]) continue;
  ringBefore.push(metres(s, stations.get(s.sig)));
  ringNow.push(metres(s, { lon: places[s.sig][0], lat: places[s.sig][1] }));
}
const f = a => `median ${Math.round(q(a, 0.5))} m, 90 % ${Math.round(q(a, 0.9))} m, over 100 m ${(100 * a.filter(x => x > 100).length / a.length).toFixed(1)} %, over 200 m ${(100 * a.filter(x => x > 200).length / a.length).toFixed(1)} %`;
console.log(`${names.length} recordings: ${stands.length} GPS stands at real stops, ${bySig.size} stations; ${Object.keys(places).length} with ${MIN_STOPS} or more stops (left out as fixed places, not GPS: ${fixedStations})`);
console.log(`stands to the ring at the station point: ${f(ringBefore)}`);
console.log(`stands to the ring at the stopping place: ${f(ringNow)}`);
const far = Object.entries(places).map(([sig, p]) => [sig, metres({ lon: p[0], lat: p[1] }, stations.get(sig))]).sort((a, b) => b[1] - a[1]);
console.log(`stopping place over 200 m from the station point: ${far.filter(x => x[1] > 200).length}; furthest: ${far.slice(0, 6).map(([sig, m]) => `${stations.get(sig).name} ${Math.round(m)} m`).join(', ')}`);
console.log(moved.length ? `moved over 50 m since the last file: ${moved.map(([sig]) => stations.get(sig).name).join(', ')}` : 'no place moved over 50 m since the last file');
console.log(`written ${OUT}`);
