// Back from the background: how the trains come back after the page was frozen (a phone in another app; Max,
// 2026-11-14, note 3: "it fast forwards almost all trains"). Replays a recording through src/trains.js; at --at
// minutes the page freezes for --gap seconds: no data, no passings, no drawing. Then the feeds answer with what changed
// meanwhile (each train's latest report, as Trafikverket's changes since the last change id), the page calls
// trains.resume as src/main.js does, and drawing goes on.
// The drawing starts again at once, the data --late seconds after (the old page waited for its stream's silence timer,
// up to 60 s; the new one asks again at once: the answer takes about a second).
// Counts, over the minute after the data came: trains drawn fast-forwarding (sim.syncing at any moment) and how far
// drawn trains are from the truth (the recording known two minutes ahead) 5 s and 30 s after. --old: the page before
// 2026-11-14 (no trains.resume, the "no data" halt counted from the last data before hiding).
// Run: node tools/resume-check.mjs [recording.jsonl] [--at 15] [--gap 180] [--late 5] [--old] [--json]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createTrains, DELAY_MS } from '../src/trains.js';
import { netFromJSON } from '../src/rail-net.js';
import { createRoutes } from '../src/routes.js';
import { readPositions } from './lib/records.mjs';

const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? Number(argv[i + 1]) : def; };
const OLD = argv.includes('--old');
const file = argv.find(a => a.endsWith('.jsonl')) ?? 'data/positions-2026-11-12T06-00-00-005Z.jsonl';
const recs = readPositions(file);
const STEP = 100;
const R = Math.PI / 180;
const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * R), b.lat - a.lat) * R * 6371000;

// The rail network, the planned routes and the passings, as tools/motion-check.mjs reads them.
const net = netFromJSON(JSON.parse(readFileSync('public/rail-net.json', 'utf8')));
const stations = new Map(JSON.parse(readFileSync('data/stations.json', 'utf8')).map(st => {
  const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(st.Geometry?.WGS84 ?? '');
  return [st.LocationSignature, m ? { lon: Number(m[1]), lat: Number(m[2]) } : null];
}).filter(([, v]) => v));
const routes = createRoutes({ stations, net });
if (existsSync('public/stop-places.json')) routes.setStopPlaces?.(JSON.parse(readFileSync('public/stop-places.json', 'utf8')).places);
const ttFile = file.replace('positions-', 'timetable-');
const rows = existsSync(ttFile) ? readFileSync(ttFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const keyOf = a => `${a.OperationalTrainNumber}/${a.ScheduledDepartureDateTime.slice(0, 10)}`;
routes.add(rows.filter(a => !a.Deleted && a.OperationalTrainNumber && a.AdvertisedTimeAtLocation)
  .map(a => ({ key: keyOf(a), sig: a.LocationSignature, activity: a.ActivityType, planned: Date.parse(a.AdvertisedTimeAtLocation) })));
const passings = rows.filter(a => !a.Deleted && a.TimeAtLocation && a.OperationalTrainNumber && a.AdvertisedTimeAtLocation)
  .map(a => ({ got: Date.parse(a.got), p: { key: keyOf(a), station: a.LocationSignature, time: Date.parse(a.TimeAtLocation), activity: a.ActivityType,
    minutes: Math.round((Date.parse(a.TimeAtLocation) - Date.parse(a.AdvertisedTimeAtLocation)) / 60000) } }))
  .sort((x, y) => x.got - y.got);

const drawn = createTrains({ net, routes }), truth = createTrains({ net, routes });
const start = recs.find(r => r.got - recs[0].got > 60_000).got;
const hide = start + flag('at', 15) * 60_000, back = hide + flag('gap', 180) * 1000;
const dataAt = back + flag('late', 5) * 1000, end = dataAt + 60_000;
let k = 0, kt = 0, kp = 0, lastArrival = start, wasBack = false;
const syncing = new Set(), shown = new Set(), off = { 5: [], 30: [] };
for (let T = start; T <= end; T += STEP) {
  if (T >= hide && T < back) continue;   // frozen: nothing runs
  if (T >= back && !wasBack) {
    // Back (src/main.js visibilitychange): resume, and a minute before the "no data" halt.
    wasBack = true;
    if (!OLD) { drawn.resume(hide, T); lastArrival = T; drawn.setHalted(false); }
  }
  const batch = [];
  if (T >= back && T < dataAt) { /* waiting for the feed's answer */ } else if (T >= dataAt && T - STEP < dataAt) {
    // The answer: what changed meanwhile, each train's latest report (the stream's answer from the last change id).
    const latest = new Map();
    while (k < recs.length && recs[k].got <= T) { if (recs[k].got >= hide) latest.set(recs[k].id, recs[k]); else batch.push(recs[k]); k++; }
    batch.push(...latest.values());
  } else while (k < recs.length && recs[k].got <= T) batch.push(recs[k++]);
  if (batch.length) { drawn.update(batch, T); lastArrival = T; drawn.setHalted(false); } else if (T - lastArrival > 60_000) drawn.setHalted(true);
  const now = [];
  while (kp < passings.length && passings[kp].got <= T) now.push(passings[kp++].p);
  if (now.length) { routes.addPassings(now); drawn.addPassings(now); }
  const tb = [];
  while (kt < recs.length && recs[kt].got <= T + 120_000) tb.push(recs[kt++]);
  if (tb.length) truth.update(tb, T + 120_000);
  const t = T - DELAY_MS;
  if (T % 1000 < STEP) drawn.prune(T);
  const placed = drawn.placedAt(t);
  if (T < dataAt) continue;
  for (const d of placed) {
    shown.add(d.id);
    if (drawn.simOf(d.id)?.syncing) syncing.add(d.id);
    for (const after of [5, 30]) {
      if (T - dataAt >= after * 1000 && T - dataAt < after * 1000 + STEP) {
        const tr = truth.reportedAt(d.id, t - (d.extra ?? 0));
        if (tr) off[after].push(metres(d, tr));
      }
    }
  }
}
const med = a => { const x = [...a].sort((p, q) => p - q); return x.length ? Math.round(x[x.length >> 1]) : null; };
const p90 = a => { const x = [...a].sort((p, q) => p - q); return x.length ? Math.round(x[Math.floor(0.9 * (x.length - 1))]) : null; };
const out = { code: OLD ? 'old (no resume)' : 'resume', gapS: (back - hide) / 1000, trains: shown.size, fastForwarding: syncing.size,
  fastForwardingPct: Number((100 * syncing.size / Math.max(1, shown.size)).toFixed(1)),
  offMed5: med(off[5]), off90_5: p90(off[5]), offMed30: med(off[30]), off90_30: p90(off[30]) };
if (argv.includes('--json')) console.log(JSON.stringify(out));
else console.log(`${out.code}: after ${out.gapS} s frozen, in the minute after: ${out.fastForwarding} of ${out.trains} trains fast-forward (${out.fastForwardingPct} %); ` +
  `from the truth 5 s after: median ${out.offMed5} m, 90 % ${out.off90_5} m; 30 s after: median ${out.offMed30} m, 90 % ${out.off90_30} m`);
