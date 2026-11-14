// How many pieces of the trains' paths are drawn straight (no way found along the tracks)?
// Builds, with the page's own code (src/path.js), the path of every train in a recording's timetable: its places in
// order, as far as the recording holds them. A piece between two places over 300 m apart with no track points in
// between is "straight", unless the line between them lies on a track all the way (a dead-straight track has no
// points in between: Arlanda S - Arlanda N; until 2026-11-14 those were counted, 186 of 367). Works offline (no key).
// Run: node tools/path-check.mjs [data/timetable-<name>.jsonl] [--train 2003] [--list] [--json]
//   --train N  only this train (its board number or its operational number), with its straight pieces named
//   --list     name every straight piece
import { readFileSync, readdirSync } from 'node:fs';
import { netFromJSON } from '../src/rail-net.js';
import { pathOf } from '../src/path.js';

const argv = process.argv.slice(2);
const only = argv.includes('--train') ? argv[argv.indexOf('--train') + 1] : null;
const file = argv.find(a => a.endsWith('.jsonl')) ??
  `data/${readdirSync('data').filter(f => f.startsWith('timetable-')).sort((a, b) => a.includes('06-00-00') - b.includes('06-00-00') || a.localeCompare(b)).at(-1)}`;

const net = netFromJSON(JSON.parse(readFileSync('public/rail-net.json', 'utf8')));
const stations = new Map(JSON.parse(readFileSync('data/stations.json', 'utf8')).map((s) => {
  const m = s.Geometry?.WGS84?.match(/POINT \(([\d.-]+) ([\d.-]+)\)/);
  return [s.LocationSignature, m ? { lon: +m[1], lat: +m[2], name: s.AdvertisedLocationName } : null];
}));
const R = Math.PI / 180;
const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * R), b.lat - a.lat) * R * 6371000;

// Each train's rows, the newest version of each (the recording also holds changes).
const trains = new Map();
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line) continue;
  const a = JSON.parse(line);
  if (a.Deleted || !a.OperationalTrainNumber) continue;
  const key = `${a.OperationalTrainNumber}/${String(a.ScheduledDepartureDateTime).slice(0, 10)}`;
  if (!trains.has(key)) trains.set(key, { number: a.AdvertisedTrainIdent ?? a.OperationalTrainNumber, operational: a.OperationalTrainNumber, rows: new Map() });
  trains.get(key).rows.set(`${a.LocationSignature}|${a.ActivityType}|${a.AdvertisedTimeAtLocation}`, a);
}

// A piece drawn as one straight line is really straight (off the rails) when a point a quarter, half or three
// quarters along it is more than 2 m from every track (tested over eight recordings: 0 wrong, 0 missed).
const offTrack = (path, i) => {
  const a = path.coords[path.at[i - 1]], b = path.coords[path.at[i]];
  return [0.25, 0.5, 0.75].some(t => !net.snap({ lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t }, null, 2));
};
let pieces = 0, straight = 0, count = 0;
const named = [], times = [];
for (const [key, tr] of trains) {
  if (only && String(tr.number) !== only && String(tr.operational) !== only) continue;
  const rows = [...tr.rows.values()].sort((a, b) => Date.parse(a.AdvertisedTimeAtLocation) - Date.parse(b.AdvertisedTimeAtLocation) ||
    (a.ActivityType === 'Ankomst' ? -1 : 1));
  const places = [];
  for (const a of rows) {
    const st = stations.get(a.LocationSignature);
    if (!st) continue;
    const last = places.at(-1);
    if (last?.sig === a.LocationSignature) { last.stop ||= a.Advertised === true; continue; }
    places.push({ sig: a.LocationSignature, name: st.name, lon: st.lon, lat: st.lat, stop: a.Advertised === true });
  }
  if (places.length < 2) continue;
  count++;
  const t0 = performance.now();
  const path = pathOf(places, net);
  times.push(performance.now() - t0);
  for (let i = 1; i < places.length; i++) {
    pieces++;
    if (path.at[i] - path.at[i - 1] <= 1 && metres(places[i - 1], places[i]) > 300 && offTrack(path, i)) {
      straight++;
      named.push(`${key}: ${places[i - 1].name} → ${places[i].name}`);
    }
  }
}
times.sort((a, b) => a - b);
const result = { file, trains: count, pieces, straight, straightPct: pieces ? +(100 * straight / pieces).toFixed(2) : 0,
  msMedian: Math.round(times[times.length >> 1] ?? 0), msSlowest: Math.round(times.at(-1) ?? 0) };
if (argv.includes('--json')) console.log(JSON.stringify(result));
else {
  console.log(`${file}: ${count} trains, ${pieces} pieces between places; drawn straight: ${straight} (${result.straightPct} %); ` +
    `time per train: median ${result.msMedian} ms, slowest ${result.msSlowest} ms`);
  if (only || argv.includes('--list')) for (const n of named) console.log('  ', n);
  else {
    // the places that fail most
    const by = new Map();
    for (const n of named) { const k = n.split(': ')[1]; by.set(k, (by.get(k) ?? 0) + 1); }
    for (const [k, v] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`   ${v} × ${k}`);
  }
}
