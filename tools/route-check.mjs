// How close does an opened train's green route (src/path.js) lie to where the train really ran? For every train in a
// recording's timetable, its route is built three ways, and each recorded position (new places only) is measured
// against each: on the route's own track (within ON_M), on a track beside it (ON_M-NEAR_M), or further off.
//   plain:    the shortest way (the page before 2026-11-14)
//   costed:   main tracks first and the right track of a double track (src/rail-net.js costs)
//   + passed: costed, and a place the train only passes may also use the fast tracks near it (today's page)
// Only positions alongside the plain route are counted (not before it starts, after it ends, or over 250 m off it), so
// the three are measured on the same positions. Night of 2026-11-14: plain 59 %, costed 83 % on the own track.
// Run: node tools/route-check.mjs [data/timetable-<name>.jsonl ...] [--json]   (no file: every recording in data/)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { netFromJSON } from '../src/rail-net.js';
import { pathOf } from '../src/path.js';

const argv = process.argv.slice(2);
const files = argv.filter(a => a.endsWith('.jsonl'));
const list = files.length ? files : readdirSync('data').filter(f => f.startsWith('timetable-')).sort().map(f => `data/${f}`);
const net = netFromJSON(JSON.parse(readFileSync('public/rail-net.json', 'utf8')));
if (!net.costed) console.log('note: public/rail-net.json has no track costs (node tools/rail-trv.mjs --props, then node tools/rail-net.mjs)');
const stations = new Map(JSON.parse(readFileSync('data/stations.json', 'utf8')).map((s) => {
  const m = s.Geometry?.WGS84?.match(/POINT \(([\d.-]+) ([\d.-]+)\)/);
  return [s.LocationSignature, m ? { lon: +m[1], lat: +m[2] } : null];
}));
const R = Math.PI / 180, M = R * 6371000;
const ON_M = 2.5, NEAR_M = 30;
const WAYS = { plain: { costed: false, passFast: false }, costed: { costed: true, passFast: false }, '+ passed': { costed: true, passFast: true } };

// A route's pieces in a grid, and a place's distance to it (and whether the nearest point is inside, not an end).
const CELL = 0.004;
function indexOf(coords) {
  const grid = new Map();
  for (let i = 0; i + 1 < coords.length; i++) {
    const [ax, ay] = coords[i], [bx, by] = coords[i + 1];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / (CELL / 2)));
    let lastKey = '';
    for (let k = 0; k <= steps; k++) {
      const gk = `${Math.floor((ax + (bx - ax) * k / steps) / CELL)}:${Math.floor((ay + (by - ay) * k / steps) / CELL)}`;
      if (gk === lastKey) continue;
      lastKey = gk;
      (grid.get(gk) ?? grid.set(gk, []).get(gk)).push(i);
    }
  }
  return grid;
}
function distTo(coords, grid, p) {
  const cx = Math.floor(p.lon / CELL), cy = Math.floor(p.lat / CELL), kx = Math.cos(p.lat * R);
  let best = Infinity, bi = -1, bt = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
    const ax = (coords[i][0] - p.lon) * kx * M, ay = (coords[i][1] - p.lat) * M;
    const vx = (coords[i + 1][0] - coords[i][0]) * kx * M, vy = (coords[i + 1][1] - coords[i][1]) * M, LL = vx * vx + vy * vy;
    const t = LL ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / LL)) : 0;
    const d = Math.hypot(ax + vx * t, ay + vy * t);
    if (d < best) { best = d; bi = i; bt = t; }
  }
  return { d: best, inside: bi >= 0 && !(bi === 0 && bt === 0) && !(bi === coords.length - 2 && bt === 1) };
}

const out = [];
for (const ttFile of list) {
  const posFile = ttFile.replace('timetable-', 'positions-');
  if (!existsSync(posFile)) continue;
  // Each train's places, as tools/path-check.mjs.
  const trains = new Map();
  for (const line of readFileSync(ttFile, 'utf8').split('\n')) {
    if (!line) continue;
    const a = JSON.parse(line);
    if (a.Deleted || !a.OperationalTrainNumber) continue;
    const key = `${a.OperationalTrainNumber}/${String(a.ScheduledDepartureDateTime).slice(0, 10)}`;
    if (!trains.has(key)) trains.set(key, new Map());
    trains.get(key).set(`${a.LocationSignature}|${a.ActivityType}|${a.AdvertisedTimeAtLocation}`, a);
  }
  const placesOf = new Map();
  for (const [key, rowsMap] of trains) {
    const rows = [...rowsMap.values()].sort((a, b) => Date.parse(a.AdvertisedTimeAtLocation) - Date.parse(b.AdvertisedTimeAtLocation) || (a.ActivityType === 'Ankomst' ? -1 : 1));
    const places = [];
    for (const a of rows) {
      const st = stations.get(a.LocationSignature);
      if (!st) continue;
      const last = places.at(-1);
      if (last?.sig === a.LocationSignature) { last.stop ||= a.Advertised === true; continue; }
      places.push({ sig: a.LocationSignature, lon: st.lon, lat: st.lat, stop: a.Advertised === true });
    }
    if (places.length >= 2) placesOf.set(key, places);
  }
  // Each train's recorded positions, new places only.
  const positions = new Map(), lastAt = new Map();
  for (const line of readFileSync(posFile, 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    const m = r.Position?.WGS84?.match(/POINT \(([\d.-]+) ([\d.-]+)\)/);
    if (!m || !r.Train || r.Deleted) continue;
    const key = `${r.Train.OperationalTrainNumber}/${String(r.Train.OperationalTrainDepartureDate).slice(0, 10)}`;
    if (!placesOf.has(key) || lastAt.get(key) === `${m[1]},${m[2]}`) continue;
    lastAt.set(key, `${m[1]},${m[2]}`);
    (positions.get(key) ?? positions.set(key, []).get(key)).push({ lon: +m[1], lat: +m[2] });
  }
  const res = Object.fromEntries(Object.keys(WAYS).map(w => [w, { n: 0, on: 0, near: 0, far: 0, ms: [] }]));
  for (const [key, list2] of positions) {
    const places = placesOf.get(key), P = {};
    for (const [w, o] of Object.entries(WAYS)) {
      const t0 = performance.now();
      const p = pathOf(places, net, o);
      res[w].ms.push(performance.now() - t0);
      P[w] = { coords: p.coords, grid: indexOf(p.coords) };
    }
    for (const p of list2) {
      const base = distTo(P.plain.coords, P.plain.grid, p);
      if (!base.inside || base.d > 250) continue;
      for (const w of Object.keys(WAYS)) {
        const { d } = w === 'plain' ? base : distTo(P[w].coords, P[w].grid, p);
        const g = res[w];
        g.n++;
        if (d <= ON_M) g.on++; else if (d <= NEAR_M) g.near++; else g.far++;
      }
    }
  }
  const name = ttFile.match(/timetable-(.*)\.jsonl/)[1];
  const row = { name };
  for (const [w, g] of Object.entries(res)) {
    g.ms.sort((a, b) => a - b);
    row[w] = { positions: g.n, ownPct: +(100 * g.on / g.n).toFixed(2), besidePct: +(100 * g.near / g.n).toFixed(2), farPct: +(100 * g.far / g.n).toFixed(2),
      msMedian: +(g.ms[g.ms.length >> 1] ?? 0).toFixed(1), msSlowest: Math.round(g.ms.at(-1) ?? 0) };
  }
  out.push(row);
  if (!argv.includes('--json')) console.log(`${name}: ` + Object.keys(WAYS).map(w => `${w} ${row[w].ownPct} % own track, ${row[w].besidePct} % beside, ${row[w].farPct} % over 30 m (${row[w].msMedian} ms, slowest ${row[w].msSlowest})`).join(' | '));
}
if (argv.includes('--json')) console.log(JSON.stringify(out));
else if (out.length > 1) {
  const sum = w => { const n = out.reduce((s, r) => s + r[w].positions, 0); const f = k => (out.reduce((s, r) => s + r[w][k] * r[w].positions, 0) / n).toFixed(2); return `${w} ${f('ownPct')} % own, ${f('besidePct')} % beside, ${f('farPct')} % over 30 m`; };
  console.log(`all ${out.length} recordings: ` + Object.keys(WAYS).map(sum).join(' | '));
}
