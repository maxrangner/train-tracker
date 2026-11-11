// How smoothly and how truly are the trains drawn? Replays a recording (tools/collect.mjs) through the page's own
// src/trains.js: each report goes in when it arrived, and the drawing clock steps like the page's.
// The truth to compare with: the same cleaned reports, known two minutes ahead (hindsight), joined by straight lines.
// Run: node tools/motion-check.mjs [recording.jsonl] [--delay 25] [--coast 30] [--plain] [--cut 120] [--trace id] [--why]
//   --plain   draw the cleaned reports directly (no simulation): the old way, for comparison
//   --cut N   no data arrives for N seconds from the middle of the replay (a lost connection)
//   --coast N try another coasting limit (seconds)
//   --nonet   don't use the rail network (public/rail-net.json, from tools/rail-net.mjs): straight lines
//   --trace id  print one train's simulation every second;  --why  print the first turn-backs and fast-forwards
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createTrains, DELAY_MS } from '../src/trains.js';
import { netFromJSON } from '../src/rail-net.js';
import { createRoutes } from '../src/routes.js';

const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? Number(argv[i + 1]) : def; };
const DELAY = flag('delay', DELAY_MS / 1000) * 1000;
const PLAIN = argv.includes('--plain');
const CUT = flag('cut', 0) * 1000;
const STEP = 100;   // ms between drawing moments
const file = argv.find(a => a.endsWith('.jsonl')) ??
  'data/' + readdirSync('data').filter(f => f.startsWith('positions-')).sort().at(-1);

// The same reading as src/trains-source.js (not imported: that file needs the page's settings).
const recs = [];
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line) continue;
  const p = JSON.parse(line);
  const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(p?.Position?.WGS84 ?? '');
  if (!m || !p.Train) continue;
  recs.push({
    id: `${p.Train.OperationalTrainNumber}/${p.Train.OperationalTrainDepartureDate.slice(0, 10)}`,
    lon: Number(m[1]), lat: Number(m[2]), speed: p.Speed ?? null, bearing: p.Bearing ?? null,
    time: Date.parse(p.TimeStamp), got: Date.parse(p.got), gone: p.Deleted === true || p.Status?.Active === false,
  });
}
recs.sort((a, b) => a.got - b.got);

const R = Math.PI / 180;
const metres = (a, b) => {
  const x = (b.lon - a.lon) * R * Math.cos((a.lat + b.lat) / 2 * R), y = (b.lat - a.lat) * R;
  return Math.hypot(x, y) * 6371000;
};
const heading = (a, b) => (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * R), b.lat - a.lat) / R + 360) % 360;
const angle = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

const netFile = new URL('../public/rail-net.json', import.meta.url);
const net = !argv.includes('--nonet') && existsSync(netFile) ? netFromJSON(JSON.parse(readFileSync(netFile, 'utf8'))) : null;
// The planned routes: from the recording's timetable (data/timetable-<same time>.jsonl) and data/stations.json,
// when there are both (recordings from 2026-11-11 22:45 on). --noroutes: without them.
const ttFile = file.replace('positions-', 'timetable-');
let routes = null;
if (net && !argv.includes('--noroutes') && existsSync(ttFile) && existsSync('data/stations.json')) {
  const stations = new Map(JSON.parse(readFileSync('data/stations.json', 'utf8')).map(st => {
    const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(st.Geometry?.WGS84 ?? '');
    return [st.LocationSignature, m ? { lon: Number(m[1]), lat: Number(m[2]) } : null];
  }).filter(([, v]) => v));
  routes = createRoutes({ stations, net });
  routes.add(readFileSync(ttFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(a => !a.Deleted && a.OperationalTrainNumber && a.AdvertisedTimeAtLocation)
    .map(a => ({ key: `${a.OperationalTrainNumber}/${a.ScheduledDepartureDateTime.slice(0, 10)}`, sig: a.LocationSignature,
      activity: a.ActivityType, planned: Date.parse(a.AdvertisedTimeAtLocation) })));
}
const drawnTrains = createTrains({ net, routes, ...(argv.includes('--coast') ? { coastMs: flag('coast') * 1000 } : {}) });
const truth = createTrains({ net });
// How far drawn trains are from the nearest track (corner cutting), measured with the network even when not used.
const anyNet = net ?? (existsSync(netFile) ? netFromJSON(JSON.parse(readFileSync(netFile, 'utf8'))) : null);
const offTrack = [];
const t0 = performance.now();
const start = recs.find(r => r.got - recs[0].got > 60_000).got;   // skip the first minute (the start batch)
const end = recs.at(-1).got - 120_000;                             // the truth needs two minutes of hindsight
const cutFrom = start + (end - start) / 2 - CUT / 2, cutTo = cutFrom + CUT;
let k = 0, kt = 0;
const feed = (trains, upTo, i, skip) => {
  const batch = [];
  while (i < recs.length && recs[i].got <= upTo) { if (!skip?.(recs[i])) batch.push(recs[i]); i++; }
  if (batch.length) trains.update(batch, upTo);
  return i;
};

const s = { moving: 0, frozen: 0, freezes: [], back: 0, truthBack: 0, lagM: [], lagS: [], standM: [],
  syncMoments: 0, syncStarts: 0, jumps: 0, all: 0, coastToStop: 0, pastStop: 0, silentMoving: 0, silentFrozen: 0, why: {}, syncWhy: [] };
const prev = new Map();     // id -> { p, dir, synced, frozenRun }
const truthDir = new Map(), drawnDir = new Map();
function turnBack(dirs, id, p) {
  const a = dirs.get(id);
  if (!a) { dirs.set(id, { p, dir: null }); return 0; }
  if (metres(a.p, p) < 5) return 0;
  const dir = heading(a.p, p);
  dirs.set(id, { p, dir });
  return a.dir !== null && angle(a.dir, dir) > 120 ? 1 : 0;
}
const cutLog = [];
const seen = new Set();
for (let T = start; T < end; T += STEP) {
  const k0 = k;
  k = feed(drawnTrains, T, k, r => CUT && r.got >= cutFrom && r.got < cutTo);
  for (let i = k0; i < k; i++) seen.add(recs[i].id);
  kt = feed(truth, T + 120_000, kt);
  const t = T - DELAY;
  const drawn = PLAIN
    ? [...seen].map(id => ({ id, ...drawnTrains.reportedAt(id, t) })).filter(x => x.lon !== undefined)
    : drawnTrains.placedAt(t);
  const traceId = argv.includes('--trace') ? argv[argv.indexOf('--trace') + 1] : null;
  if (traceId && (T - start) % 1000 < STEP) {
    const sim = drawnTrains.simOf(traceId), tru = truth.reportedAt(traceId, t);
    if (sim) console.log(new Date(t).toISOString().slice(11, 19), `sim s ${Math.round(sim.s)} v ${(sim.v * 3.6).toFixed(0)} km/h, target ${sim.target} ${Math.round(sim.gap)} m ahead of it, silent ${Math.round(sim.silentFor)} s${sim.syncing ? ' SYNC' : ''}; truth ${Math.round(tru?.kmh)} km/h`);
  }
  for (const d of drawn) {
    const tru = truth.reportedAt(d.id, t);
    if (!tru) continue;
    s.all++;
    const sim = PLAIN ? null : drawnTrains.simOf(d.id);
    if (sim?.syncing) s.syncMoments++;
    // A coasting train must never pass its next planned stop (it waits 200 m before it).
    if (sim && sim.pastLast > 0 && Number.isFinite(sim.stopAt)) {
      s.coastToStop++;
      if (sim.s > sim.stopAt + 200) {
        s.pastStop++;
        if (argv.includes('--why') && !s.pastShown?.has(d.id) && (s.pastShown ??= new Set()).add(d.id) && s.pastShown.size <= 8)
          console.log('past stop', d.id, new Date(t).toISOString().slice(11, 19), `${Math.round(sim.s - sim.stopAt - 200)} m past the stop's place; ${Math.round(sim.pastLast)} m past the last report; target ${sim.target}, ${Math.round(sim.v * 3.6)} km/h`);
      }
    }
    if (sim?.jumped) s.jumps++;
    const last = prev.get(d.id);
    const now = { p: d, dir: last?.dir ?? null, synced: sim?.syncing ?? false, frozenRun: 0 };
    if (sim?.syncing && !last?.synced) {
      s.syncStarts++;
      const why = sim.lastGap > 30 ? 'after a silence over 30 s' : `gap ${Math.round(sim.gap)} m, target ${sim.target}`;
      s.syncWhy.push(why);
      if (argv.includes('--why') && !why.startsWith('after') && s.syncWhy.filter(w => !w.startsWith('after')).length <= 3)
        console.log('sync start', d.id, new Date(t).toISOString().slice(11, 21), why);
    }
    // Turn-backs, judged over every 5 m moved (so a standing train's jitter doesn't count). The truth's own
    // (a train reversing at a terminus is real) for comparison.
    s.truthBack += turnBack(truthDir, d.id, tru);
    const tb = turnBack(drawnDir, d.id, d);
    s.back += tb;
    if (tb && argv.includes('--why') && s.back <= 12) console.log('turn-back', d.id, new Date(t).toISOString().slice(11, 21), JSON.stringify(sim), 'truth', Math.round(tru.kmh), 'km/h, off', Math.round(metres(d, tru)), 'm');

    const off = metres(d, tru);
    if (anyNet && (T - start) % 2000 < STEP) offTrack.push(anyNet.snap(d, null, 1000)?.dist ?? 1000);
    if (tru.kmh < 1 && tru.gap <= 30) s.standM.push(off);
    if (last) {
      const moved = metres(last.p, d);
      if (moved > 0.05) {
        now.dir = heading(last.p, d);
      }
      // Only where the truth is known: reports at most 30 s apart around this moment. Elsewhere the train was
      // silent (to the page too, if its last report is over 30 s old: it coasts at most that long, then waits).
      if (tru.kmh > 15) {
        if (tru.gap <= 30) {
          s.moving++;
          s.lagM.push(off); s.lagS.push(off / (tru.kmh / 3.6));
          if (moved <= 0.05) {
            s.frozen++; now.frozenRun = last.frozenRun + 1;
            if (sim) { const why = sim.gap < -1 ? `ahead of the target (${sim.target})` : `target ${sim.target}`; s.why[why] = (s.why[why] ?? 0) + 1; }
          }
        } else {
          s.silentMoving++;
          if (moved <= 0.05) s.silentFrozen++;
        }
      }
      if (now.frozenRun === 0 && last.frozenRun >= 5) s.freezes.push(last.frozenRun * STEP / 1000);
    }
    prev.set(d.id, now);
  }
  const tick = Math.floor((T - cutFrom) / 10_000);
  if (CUT && T >= cutFrom - 20_000 && T < cutTo + 60_000 && tick !== s.lastTick && (s.lastTick = tick, true)) {
    const still = drawn.filter(d => { const n = prev.get(d.id); return n && n.frozenRun > 0; }).length;
    const syncing = PLAIN ? 0 : drawn.filter(d => drawnTrains.simOf(d.id)?.syncing).length;
    cutLog.push(`${Math.round((T - cutFrom) / 1000)} s: ${still} of ${drawn.length} drawn standing while really moving, ${syncing} syncing`);
  }
}

const pct = (a, b) => `${(100 * a / b).toFixed(1)} %`;
const q = (arr, f) => { if (!arr.length) return NaN; const x = Float64Array.from(arr).sort(); return x[Math.floor(f * (x.length - 1))]; };
const f1 = v => (Number.isFinite(v) ? v.toFixed(1) : '-');
const minutes = (end - start) / 60000;
console.log(`${file}, ${minutes.toFixed(1)} minutes, drawn ${DELAY / 1000} s behind, ${PLAIN ? 'reports directly (no simulation)' : 'simulated'}, ${net ? 'on the rail network' : 'straight lines'}${routes ? `, with ${routes.count} planned routes` : ''}; ` +
  `replayed in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
console.log(`cleaning: ${JSON.stringify(drawnTrains.counts)}`);
console.log(`(below: only where the truth is known, reports at most 30 s apart; ${pct(s.silentMoving, s.silentMoving + s.moving)} of moving moments are in longer silences, drawn standing ${pct(s.silentFrozen, s.silentMoving)} of those)`);
console.log(`frozen while really moving (over 15 km/h): ${pct(s.frozen, s.moving)}`);
if (!PLAIN) console.log('  why:', Object.entries(s.why).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${pct(n, s.frozen)}`).join(', '));
console.log(`stops of 0.5 s or more while really moving: ${s.freezes.length} (${(s.freezes.length / minutes).toFixed(0)} a minute across the map); ` +
  `length median ${f1(q(s.freezes, 0.5))} s, 90 % ${f1(q(s.freezes, 0.9))} s`);
console.log(`turn-backs over 120°: drawn ${s.back}, in the truth itself ${s.truthBack}`);
console.log(`distance from the truth while moving: median ${f1(q(s.lagM, 0.5))} m, 90 % ${f1(q(s.lagM, 0.9))} m, 99 % ${f1(q(s.lagM, 0.99))} m; ` +
  `in seconds of travel: median ${f1(q(s.lagS, 0.5))}, 90 % ${f1(q(s.lagS, 0.9))}, 99 % ${f1(q(s.lagS, 0.99))}`);
console.log(`distance from the truth while it stands: median ${f1(q(s.standM, 0.5))} m, 90 % ${f1(q(s.standM, 0.9))} m, 99 % ${f1(q(s.standM, 0.99))} m`);
if (routes) console.log(`coasting towards a planned stop: ${s.coastToStop} train-moments; past the stop: ${s.pastStop}`);
if (offTrack.length) console.log(`distance from the nearest track: median ${f1(q(offTrack, 0.5))} m, 90 % ${f1(q(offTrack, 0.9))} m, 99 % ${f1(q(offTrack, 0.99))} m`);
if (!PLAIN) console.log(`syncing (fast-forward): ${pct(s.syncMoments, s.all)} of train-moments, ${(s.syncStarts / minutes).toFixed(1)} starts a minute; jumps ${(s.jumps / minutes).toFixed(1)} a minute`);
if (!PLAIN) {
  const silence = s.syncWhy.filter(w => w.startsWith('after')).length;
  console.log(`  of the syncs: ${silence} after a silence over 30 s; others e.g. ${s.syncWhy.filter(w => !w.startsWith('after')).slice(0, 6).join('; ')}`);
}
if (CUT) console.log(`connection cut for ${CUT / 1000} s (0 s = the cut starts):\n  ` + cutLog.join('\n  '));
