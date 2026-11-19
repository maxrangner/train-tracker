// Is an opened train on its own route line, and does the line keep still? (src/path-follow.js; Max, 2026-11-19:
// "Trains right now mostly do not match their painted route" and "avoid a line flipping back and forth".)
// Replays a recording with the page's code: every train is "opened" when first drawn (after the first 2 minutes) and
// its line follows it as on the page (an update every UPDATE_MS). Every second: is the drawn train (with its small
// glide offset, as seen) within ON_M of its line, and of the timetable's route alone (before this change)? Counted:
// the line's changes, those starting within NEAR_M of the train, flips back (a change that puts back, within 120 s,
// the stretch an earlier change took away), the slides' size, full re-routes, and the time an update takes.
// Run: node tools/route-follow-check.mjs data/positions-<name>.jsonl [--train 7875,2576] [--sthlm] [--json]
//   --train  only these trains (operational numbers); --sthlm  only moments within 4 km of Stockholm C
//   --minutes N  only the first N minutes after the start (check.mjs: a part of each core recording)
//   --min-on X  fail (exit 1) when the share on the line is under X % (check.mjs); --max-flips Y: when flips back
//   per train-hour are over Y
import { readFileSync, existsSync } from 'node:fs';
import { createTrains } from '../src/trains.js';
import { netFromJSON } from '../src/rail-net.js';
import { createRoutes } from '../src/routes.js';
import { pathOf } from '../src/path.js';
import { followPath, ON_M, NEAR_M } from '../src/path-follow.js';
import { readPositions } from './lib/records.mjs';

const argv = process.argv.slice(2);
const flag = n => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
const file = argv.find(a => a.endsWith('.jsonl') && a.includes('positions-'));
const only = flag('--train') ? new Set(flag('--train').split(',')) : null;
const STHLM = argv.includes('--sthlm'), JSON_OUT = argv.includes('--json'), MIN_ON = flag('--min-on') ? Number(flag('--min-on')) : null;
const MAX_FLIPS = flag('--max-flips') ? Number(flag('--max-flips')) : null, MINUTES = flag('--minutes') ? Number(flag('--minutes')) : Infinity;
const UPDATE_MS = 250;   // the replay's step: an update each step, as the page (src/main.js FOLLOW_MS)

const net = netFromJSON(JSON.parse(readFileSync('public/rail-net.json', 'utf8')));
const stations = new Map(JSON.parse(readFileSync('data/stations.json', 'utf8')).map(st => {
  const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(st.Geometry?.WGS84 ?? '');
  return [st.LocationSignature, m ? { lon: +m[1], lat: +m[2], advertised: st.Advertised } : null];
}).filter(([, v]) => v));
const stopPlaces = existsSync('public/stop-places.json') ? JSON.parse(readFileSync('public/stop-places.json', 'utf8')).places : {};
const routes = createRoutes({ stations, net });
routes.setStopPlaces?.(stopPlaces);
const rows = readFileSync(file.replace('positions-', 'timetable-'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
routes.add(rows.filter(a => !a.Deleted && a.OperationalTrainNumber && a.AdvertisedTimeAtLocation)
  .map(a => ({ key: `${a.OperationalTrainNumber}/${a.ScheduledDepartureDateTime.slice(0, 10)}`, sig: a.LocationSignature,
    activity: a.ActivityType, planned: Date.parse(a.AdvertisedTimeAtLocation) })));

// Each train's whole route as the page gets it (the recording's routes file; older recordings: the timetable's window).
const rtFile = file.replace('positions-', 'routes-');
const routeRows = existsSync(rtFile) ? readFileSync(rtFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : rows;
const byKey = new Map();
for (const a of routeRows) {
  if (a.Deleted || !a.OperationalTrainNumber || !a.AdvertisedTimeAtLocation) continue;
  const key = `${a.OperationalTrainNumber}/${a.ScheduledDepartureDateTime.slice(0, 10)}`;
  (byKey.get(key) ?? byKey.set(key, new Map()).get(key)).set(`${a.LocationSignature}|${a.ActivityType}`, a);
}
const reversals = [...stations.values()].filter(s => s.advertised);
// The places as src/main.js gives them to pathOf.
function placesOf(key) {
  const m = byKey.get(key);
  if (!m) return null;
  const list = [...m.values()]
    .sort((a, b) => Date.parse(a.AdvertisedTimeAtLocation) - Date.parse(b.AdvertisedTimeAtLocation) || (a.ActivityType === 'Ankomst' ? -1 : 1));
  const places = [];
  for (const a of list) {
    const st = stations.get(a.LocationSignature);
    if (!st) continue;
    const last = places.at(-1);
    if (last && last.sig === a.LocationSignature) { last.stop ||= a.Advertised; continue; }
    const sp = stopPlaces[a.LocationSignature];
    places.push({ sig: a.LocationSignature, lon: st.lon, lat: st.lat, stop: a.Advertised, mark: sp ? { ...st, lon: sp[0], lat: sp[1] } : st });
  }
  return places.length >= 2 ? places : null;
}

const R = Math.PI / 180;
const metres = (a, b) => Math.hypot((b[0] - a[0]) * Math.cos(a[1] * R), b[1] - a[1]) * R * 6371000;
// Whether place p lies beyond an end of line c (its nearest point is an end, and not within ON_M of it).
function pastEnd(c, p) {
  const n = c.length, near = (a, b, x) => { const k = Math.cos(x[1] * R); return ((x[0] - a[0]) * (b[0] - a[0]) * k * k + (x[1] - a[1]) * (b[1] - a[1])) < 0; };
  return (n > 1 && near(c[n - 1], c[n - 2], p) && metres(c[n - 1], p) > ON_M) || (n > 1 && near(c[0], c[1], p) && metres(c[0], p) > ON_M);
}
function distTo(c, p) {
  const k = Math.cos(p[1] * R) * 111320, kl = 110540;
  let best = Infinity;
  for (let i = 1; i < c.length; i++) {
    const ax = (c[i - 1][0] - p[0]) * k, ay = (c[i - 1][1] - p[1]) * kl, bx = (c[i][0] - p[0]) * k, by = (c[i][1] - p[1]) * kl;
    if (Math.min(ax, bx) > best || Math.max(ax, bx) < -best || Math.min(ay, by) > best || Math.max(ay, by) < -best) continue;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, f = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + f * dx, ay + f * dy));
  }
  return best;
}
const SC = [18.0586, 59.3303];

const recs = readPositions(file);
const trains = createTrains({ net, routes });
const t0 = recs[0].got, start = t0 + 120_000, end = Math.min(recs.at(-1).got, start + MINUTES * 60_000);
const open = new Map();   // id -> { f, base, lastSlide, slides: [{ at, from }] }
const s = { moments: 0, onLine: 0, onBase: 0, changes: 0, nearChanges: 0, flipBacks: 0, full: 0, sizes: [], ms: [], trainSeconds: 0 };
const per = new Map();
let i = 0;
for (let T = t0; T <= end; T += UPDATE_MS) {
  const batch = [];
  while (i < recs.length && recs[i].got <= T) batch.push(recs[i++]);
  if (batch.length) trains.update(batch, T);
  if (T < start) continue;
  const drawT = T - trains.DELAY_MS;
  for (const r of T - 250 < start ? trains.reports() : batch) {   // at the start every train known, then the new ones
    if (open.has(r.id) || (only && !only.has(r.id.split('/')[0]))) continue;
    const places = placesOf(r.id);
    if (!places || !trains.placeOf(r.id, drawT)) { open.set(r.id, null); continue; }
    const base = pathOf(places, net, { reversals });
    open.set(r.id, { f: followPath(base, places, net, { reversals }), base, slides: [] });
  }
  const second = (T - t0) % 1000 === 0;
  for (const [id, o] of open) {
    if (!o) continue;
    const at = trains.placeOf(id, drawT);
    if (!at) continue;
    {
      const w = trains.wayOf(id);
      const q0 = performance.now();
      let r = o.f.update(w, T);
      if (o.f.wantsFull) { r = o.f.full(w, T); s.full++; }
      s.ms.push(performance.now() - q0);
      if (r?.slide) {
        s.changes++;
        const p = [at.lon, at.lat], sl = r.slide;
        let size = 0; for (const x of sl.to) size = Math.max(size, distTo(sl.from, x));   // how far sideways the line moves
        s.sizes.push(size);
        if (argv.includes('--big') && size > 200) console.log(`  big slide ${id} ${new Date(T).toISOString().slice(11, 19)}: ${size.toFixed(0)} m sideways, ${sl.to.length} points, from ${sl.to[0].map(x => x.toFixed(5)).join(',')} to ${sl.to.at(-1).map(x => x.toFixed(5)).join(',')}, train ${p.map(x => x.toFixed(5)).join(',')} ${JSON.stringify(o.f.counts)}`);
        if (argv.includes('--big') && size > 200 && argv.includes('--detail')) { const len = c => c.slice(1).reduce((m, x, k) => m + metres(c[k], x), 0); console.log(`    old ${len(sl.from).toFixed(0)} m: ${sl.from.filter((x, k) => k % 50 === 0).map(x => x.map(v => v.toFixed(4)).join(',')).join(' ')}
    new ${len(sl.to).toFixed(0)} m: ${sl.to.filter((x, k) => k % 50 === 0).map(x => x.map(v => v.toFixed(4)).join(',')).join(' ')}`); }
        if (Math.min(...sl.to.map(x => metres(x, p))) <= NEAR_M) s.nearChanges++;
        // A flip back: the new stretch lies where an earlier change (within 120 s) took the line away from.
        const back = o.slides.find(e => T - e.at <= 120_000 && sl.to.filter(x => distTo(e.from, x) <= ON_M).length >= 0.8 * sl.to.length && size > ON_M);
        if (back) { s.flipBacks++; if (argv.includes('--flips')) console.log(`  flip back ${id} ${new Date(T).toISOString().slice(11, 19)}: ${size.toFixed(0)} m, ${((T - back.at) / 1000).toFixed(0)} s after the change it undoes, at ${sl.to[0].map(x => x.toFixed(5)).join(',')}`); }
        o.slides.push({ at: T, from: sl.from });
        const pt = per.get(id) ?? per.set(id, { n: 0, on: 0, changes: 0 }).get(id);
        pt.changes++;
      }
    }
    if (!second) continue;
    const p = [at.lon, at.lat];
    if (STHLM && metres(p, SC) > 4000) continue;
    const dLine = distTo(o.f.path.coords, p), dBase = distTo(o.base.coords, p);
    if ((dBase > 250 && dLine > 250) || pastEnd(o.f.path.coords, p)) continue;   // outside its route (before its start, past its end)
    s.moments++; s.trainSeconds++;
    if (dLine <= ON_M) s.onLine++;
    if (dBase <= ON_M) s.onBase++;
    const pt = per.get(id) ?? per.set(id, { n: 0, on: 0, changes: 0 }).get(id);
    pt.n++; if (dLine <= ON_M) pt.on++;
  }
}
const q = (a, f) => { const x = [...a].sort((m, n) => m - n); return x.length ? x[Math.floor(f * (x.length - 1))] : 0; };
const hours = s.trainSeconds / 3600;
const out = {
  file: file.split('positions-')[1].replace('.jsonl', ''), trains: per.size, moments: s.moments,
  onLine: +(100 * s.onLine / (s.moments || 1)).toFixed(2), onBase: +(100 * s.onBase / (s.moments || 1)).toFixed(2),
  changesPerTrainHour: +(s.changes / (hours || 1)).toFixed(2), nearChanges: s.nearChanges, flipBacks: s.flipBacks,
  flipsPerTrainHour: +(s.flipBacks / (hours || 1)).toFixed(2), bigSlides: s.sizes.filter(x => x > 200).length, full: s.full,
  slideMedianM: +q(s.sizes, 0.5).toFixed(1), slide90M: +q(s.sizes, 0.9).toFixed(1),
  updateMsMedian: +q(s.ms, 0.5).toFixed(3), updateMs99: +q(s.ms, 0.99).toFixed(2), updateMsMax: +q(s.ms, 1).toFixed(1),
};
if (JSON_OUT) console.log(JSON.stringify(out));
else {
  console.log(`${out.file}${STHLM ? ' (within 4 km of Stockholm C)' : ''}${only ? ` trains ${[...only].join(', ')}` : ''}: ${out.trains} trains, ${out.moments} train-seconds`);
  console.log(`  drawn train on its line (<= ${ON_M} m): ${out.onLine} %   (on the timetable's route alone, as before: ${out.onBase} %)`);
  console.log(`  line changes: ${s.changes} (${out.changesPerTrainHour} per train-hour), ${out.nearChanges} starting within ${NEAR_M} m of the train; flips back: ${out.flipBacks}; full re-routes: ${out.full}`);
  console.log(`  slide size: median ${out.slideMedianM} m, 90 % ${out.slide90M} m; an update: median ${out.updateMsMedian} ms, 99 % ${out.updateMs99} ms, slowest ${out.updateMsMax} ms`);
  if (argv.includes('--list')) for (const [id, t] of [...per].sort((a, b) => b[1].changes - a[1].changes || a[1].on / a[1].n - b[1].on / b[1].n).slice(0, 15))
    console.log(`  ${id}: ${(100 * t.on / t.n).toFixed(0)} % of ${t.n} s, ${t.changes} changes`);
}
let bad = 0;
if (MIN_ON !== null && out.onLine < MIN_ON) { console.log(`FAIL on the line ${out.onLine} % < ${MIN_ON} %`); bad++; }
if (MAX_FLIPS !== null && out.flipsPerTrainHour > MAX_FLIPS) { console.log(`FAIL flips back ${out.flipsPerTrainHour} per train-hour > ${MAX_FLIPS}`); bad++; }
if (bad) process.exit(1);
