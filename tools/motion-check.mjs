// How smoothly and how truly are the trains drawn? Replays a recording (tools/collect.mjs) through the page's own
// src/trains.js: each report goes in when it arrived, and the drawing clock steps like the page's.
// The truth to compare with: the same cleaned reports, known two minutes ahead (hindsight), joined along the rail
// network. It is given the planned routes too, on purpose: a platform stop that a train sends only as repeats then
// counts as standing in the truth as well. (Until 2026-11-13 it had them by accident, through settings shared by
// every simulator; without them: frozen 0.07-0.11 points lower by day and 1.47 -> 0.84 % at night.)
// Run: node tools/motion-check.mjs [recording.jsonl] [--delay 25] [--coast 30] [--plain] [--cut 120] [--trace id] [--why]
//   --plain   draw the cleaned reports directly (no simulation): the old way, for comparison
//   --cut N   no data arrives for N seconds from the middle of the replay (a lost connection)
//   --coast N try another coasting limit (seconds)
//   --nonet   don't use the rail network (public/rail-net.json, from tools/rail-net.mjs): straight lines
//   --trace id  print one train's simulation every second;  --why  print the first turn-backs and fast-forwards
//   --json    the main numbers as one JSON line (for tools/check.mjs)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createTrains, DELAY_MS } from '../src/trains.js';
import { netFromJSON } from '../src/rail-net.js';
import { createRoutes } from '../src/routes.js';
import { readPositions } from './lib/records.mjs';
import { branchCounter } from './lib/branch.mjs';

const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? Number(argv[i + 1]) : def; };
const DELAY = flag('delay', DELAY_MS / 1000) * 1000;
const PLAIN = argv.includes('--plain');
const CUT = flag('cut', 0) * 1000;
const STEP = 100;   // ms between drawing moments
const file = argv.find(a => a.endsWith('.jsonl')) ??
  'data/' + readdirSync('data').filter(f => f.startsWith('positions-')).sort().at(-1);

// The same reading as src/trains-source.js (tools/lib/records.mjs: the same fields and report time).
const recs = readPositions(file);

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
const passings = [];
// Real stops: an actual arrival and an actual departure at the same station (the train stood there), for the dwell
// measure below (bug hunt 2026-11-12: commuter trains drawn driving through stations they really stopped at).
const realStops = new Map();   // train key -> [{ sig, at: { lon, lat }, arr, dep, near: s, still: s }]
// Where trains really stand at stations (public/stop-places.json): the page's movement uses it (src/routes.js), and the
// "drawn stand to the stopping place" measure below.
const stopFile = new URL('../public/stop-places.json', import.meta.url);
const stopPlaces = existsSync(stopFile) ? JSON.parse(readFileSync(stopFile, 'utf8')).places : {};
if (net && !argv.includes('--noroutes') && existsSync(ttFile) && existsSync('data/stations.json')) {
  const stations = new Map(JSON.parse(readFileSync('data/stations.json', 'utf8')).map(st => {
    const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(st.Geometry?.WGS84 ?? '');
    return [st.LocationSignature, m ? { lon: Number(m[1]), lat: Number(m[2]) } : null];
  }).filter(([, v]) => v));
  routes = createRoutes({ stations, net });
  routes.setStopPlaces?.(stopPlaces);   // as the page (src/main.js); older code (a worktree) has none
  const rows = readFileSync(ttFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  // The actual passings, fed in when they arrived (as the page gets them from its passings stream).
  if (!argv.includes('--nopassings')) for (const a of rows) {
    if (a.Deleted || !a.TimeAtLocation || !a.OperationalTrainNumber || !a.AdvertisedTimeAtLocation) continue;
    passings.push({ got: Date.parse(a.got), p: { key: `${a.OperationalTrainNumber}/${a.ScheduledDepartureDateTime.slice(0, 10)}`,
      station: a.LocationSignature, time: Date.parse(a.TimeAtLocation), activity: a.ActivityType,
      minutes: Math.round((Date.parse(a.TimeAtLocation) - Date.parse(a.AdvertisedTimeAtLocation)) / 60000) } });
  }
  passings.sort((x, y) => x.got - y.got);
  {
    const acts = new Map();
    for (const a of rows) {
      if (a.Deleted || !a.TimeAtLocation || !a.OperationalTrainNumber || !stations.has(a.LocationSignature)) continue;
      const k = `${a.OperationalTrainNumber}/${a.ScheduledDepartureDateTime.slice(0, 10)}|${a.LocationSignature}`;
      const e = acts.get(k) ?? acts.set(k, {}).get(k);
      e[a.ActivityType] = Date.parse(a.TimeAtLocation);
    }
    for (const [k, e] of acts) {
      if (e.Ankomst === undefined || e.Avgang === undefined) continue;
      const [key, sig] = k.split('|');
      const sp = stopPlaces[sig];
      (realStops.get(key) ?? realStops.set(key, []).get(key)).push({ sig, at: stations.get(sig), arr: e.Ankomst, dep: e.Avgang, near: 0, still: 0,
        place: sp ? { lon: sp[0], lat: sp[1] } : null, run: null, best: null });
    }
  }
  routes.add(rows
    .filter(a => !a.Deleted && a.OperationalTrainNumber && a.AdvertisedTimeAtLocation)
    .map(a => ({ key: `${a.OperationalTrainNumber}/${a.ScheduledDepartureDateTime.slice(0, 10)}`, sig: a.LocationSignature,
      activity: a.ActivityType, planned: Date.parse(a.AdvertisedTimeAtLocation) })));
}
// Wrong branches (tools/lib/branch.mjs): judged against an oracle that knows the whole recording.
const oracle = createTrains({ net, keepMs: Infinity });
const branches = branchCounter(oracle);
if (net && !PLAIN) { let ko = 0; for (let T = recs[0].got; ko < recs.length; T += 1000) { const batch = []; while (ko < recs.length && recs[ko].got <= T) batch.push(recs[ko++]); if (batch.length) oracle.update(batch, T); } }
const drawnTrains = createTrains({ net, routes, onWayChange: branches.onWayChange, ...(argv.includes('--coast') ? { coastMs: flag('coast') * 1000 } : {}) });
const truth = createTrains({ net, routes });   // with the routes, on purpose: the truth then knows a platform stop sent only as repeats
// How far drawn trains are from the nearest track (corner cutting), measured with the network even when not used.
const anyNet = net ?? (existsSync(netFile) ? netFromJSON(JSON.parse(readFileSync(netFile, 'utf8'))) : null);
const offTrack = [];
const t0 = performance.now();
const start = recs.find(r => r.got - recs[0].got > 60_000).got;   // skip the first minute (the start batch)
const end = recs.at(-1).got - 120_000;                             // the truth needs two minutes of hindsight
const cutFrom = start + (end - start) / 2 - CUT / 2, cutTo = cutFrom + CUT;
let k = 0, kt = 0, lastArrival = start, kp = 0;
const feed = (trains, upTo, i, skip) => {
  const batch = [];
  while (i < recs.length && recs[i].got <= upTo) { if (!skip?.(recs[i])) batch.push(recs[i]); i++; }
  if (batch.length) trains.update(batch, upTo);
  return i;
};

const s = { pastStopBounced: 0, wrongWay: 0, moving: 0, frozen: 0, freezes: [], back: 0, truthBack: 0, lagM: [], lagS: [], standM: [],
  syncMoments: 0, syncStarts: 0, jumps: 0, all: 0, stale: 0, coastToStop: 0, earlyAtPlace: 0, silentLagS: [], returnAheadM: [], stoodMoved: 0, pastStop: 0, silentMoving: 0, silentFrozen: 0, why: {}, syncWhy: [] };
const prev = new Map();     // id -> { p, dir, synced, frozenRun }
const truthDir = new Map(), drawnDir = new Map();
const truthTurnAt = new Map(), wrongRun = new Map();   // wrong-way episodes (below)
const capWas = new Map();   // id -> the drawn train's s at the moment before (has it moved?)
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
  // As the page does (src/main.js): no data for 60 s, every train brakes to a stop; data again, back to normal.
  const fed = recs.slice(k0, k).some(r => !(CUT && r.got >= cutFrom && r.got < cutTo));
  if (fed) { lastArrival = T; drawnTrains.setHalted(false); } else if (T - lastArrival > 60_000) drawnTrains.setHalted(true);
  for (let i = k0; i < k; i++) seen.add(recs[i].id);
  const newPassings = [];
  while (kp < passings.length && passings[kp].got <= T) {
    const x = passings[kp++];
    if (!(CUT && x.got >= cutFrom && x.got < cutTo)) newPassings.push(x.p);
  }
  if (newPassings.length) { routes.addPassings(newPassings); drawnTrains.addPassings(newPassings); }
  kt = feed(truth, T + 120_000, kt);
  const t = T - DELAY;
  if ((T - start) % 1000 < STEP) drawnTrains.prune(T);   // as the page does every second
  const drawn = PLAIN
    ? [...seen].map(id => ({ id, ...drawnTrains.reportedAt(id, t) })).filter(x => x.lon !== undefined)
    : drawnTrains.placedAt(t);
  const traceId = argv.includes('--trace') ? argv[argv.indexOf('--trace') + 1] : null;
  if (traceId && (T - start) % 1000 < STEP) {
    const sim = drawnTrains.simOf(traceId), tru = truth.reportedAt(traceId, t);
    if (sim) console.log(new Date(t).toISOString().slice(11, 19), `sim s ${Math.round(sim.s)} v ${(sim.v * 3.6).toFixed(0)} km/h, target ${sim.target} ${Math.round(sim.gap)} m ahead of it, silent ${Math.round(sim.silentFor)} s${sim.syncing ? ' SYNC' : ''}; truth ${Math.round(tru?.kmh)} km/h`);
  }
  for (const d of drawn) {
    // (a train drawn further behind, src/trains.js NO_GPS_EXTRA_MS, is compared at the moment it is drawn for)
    const tru = truth.reportedAt(d.id, t - (d.extra ?? 0));
    if (!tru) continue;
    s.all++;
    if (d.stale) s.stale++;
    const sim = PLAIN ? null : drawnTrains.simOf(d.id);
    if (sim?.syncing) s.syncMoments++;
    // Dwell: around each real stop (from 2 minutes before its arrival to 2 after its departure; the times are whole
    // minutes), how long the drawn train is within 300 m of the station, and how long of that it stands (drawn speed
    // under 0.8 m/s; a standing train's drawn place still shifts by millimetres while a path change fades out).
    for (const st of realStops.get(d.id) ?? []) {
      if (t < st.arr - 120000 || t > st.dep + 120000 || metres(d, st.at) > 300) continue;
      st.near += STEP / 1000;
      if (sim ? sim.v < 0.8 : (prev.get(d.id) && metres(prev.get(d.id).p, d) <= 0.05)) st.still += STEP / 1000;
    }
    // Where the drawn train stands at each real stop at a station with a measured stopping place: its stand (drawn
    // under 0.8 m/s within 2.5 km) that overlaps the stop's time most, and how far that is from the stopping place
    // (point 5 B, 2026-11-14; the night's tools/_stops_replay.mjs). At the moment the train is drawn for.
    if (sim) for (const st of realStops.get(d.id) ?? []) {
      const tt = t - (d.extra ?? 0);
      if (!st.place || tt < st.arr - 60000 || tt > st.dep + 180000) continue;
      if (sim.v >= 0.8 || metres(d, st.place) > 2500) { st.run = null; continue; }
      if (!st.run) st.run = { from: tt, to: tt, lon: d.lon, lat: d.lat, noGps: (d.extra ?? 0) > 0 };
      Object.assign(st.run, { to: tt, lon: d.lon, lat: d.lat });
      const ov = r => Math.min(st.dep + 75000, r.to) - Math.max(st.arr, r.from);
      if (!st.best || st.best === st.run || ov(st.run) > ov(st.best)) st.best = st.run;
    }
    // A train that stood still before its GPS went quiet must not be moved on before new data says so (moving on:
    // speeding up; a train still braking to a stop when it is found to have stood doesn't count, 13644 2026-11-12).
    { const was = prev.get(d.id); if (sim?.mode === 'stood' && sim.silentFor > 30 && sim.pastLast > 1 && was && metres(was.p, d) > 0.05 && sim.v > 0.5 && sim.v > (was.v ?? 0) + 0.01) { s.stoodMoved++; if (argv.includes('--why') && !(s.stoodShown ??= new Set()).has(d.id) && s.stoodShown.add(d.id).size <= 6) console.log('moved after stood', d.id, new Date(t).toISOString().slice(11, 19), JSON.stringify(sim)); } }
    // A coasting train must never pass its next planned stop (it waits 200 m before it). Only while it is drawn
    // without GPS: once a newer position is in, the train follows that (it may pass the stop with it). Counted apart
    // when the train's own data went back on itself within 5 minutes (two position sources taking turns 700 m apart
    // in the Nässjö yard, 2026-11-12: where the train really was isn't known, and a drawn train never goes back).
    // Since 2026-11-12 (Max): after a long silence a train may move on past a stop by its timetable; not counted.
    const wasS = capWas.get(d.id);
    if (sim) capWas.set(d.id, sim.s);
    if (sim && sim.mode !== 'gps' && sim.pastLast > 0 && Number.isFinite(sim.stopAt) && !sim.longSilent && !sim.assumed) {
      s.coastToStop++;
      // stopAt is 200 m before the stop; for a train seen only at fixed places, which waits at the stopping place itself
      // (point 5 B), the place. A moment counts when the drawn train moves while beyond that. Since point 5 B a limit can
      // land behind a train that stands still (2026-11-14): a place set where it already stood a few metres on (1-13 m),
      // new reports moving the place 9 m behind it (11788, 12 Nov 23:33), or its first GPS report bringing back the
      // 200 m rule while it stood at the stopping place 42 m past the old limit (672, 17:17). It stays where it is:
      // not driving past. And a place set right in front of a fast train is braked into with a few metres to spare
      // (17552 at 75 km/h: 1 m; 11900 at 62 km/h: 6 m): up to 20 m past the stopping place is allowed (a platform is
      // 200-300 m long; the 200 m rule hid this inside its 200 m).
      if (sim.s > sim.stopAt + (sim.atPlace ? 20 : 200) && wasS !== undefined && sim.s > wasS + 0.01) {
        if (t - sim.bounced < 300000) { s.pastStopBounced++; } else
        s.pastStop++;
        if (argv.includes('--why') && !s.pastShown?.has(d.id) && (s.pastShown ??= new Set()).add(d.id) && s.pastShown.size <= 8)
          console.log('past stop', d.id, new Date(t).toISOString().slice(11, 19), `${Math.round(sim.s - sim.stopAt - (sim.atPlace ? 0 : 200))} m past the stop's place${sim.atPlace ? ' (the stopping place)' : ''}; ${Math.round(sim.pastLast)} m past the last report; target ${sim.target}, ${Math.round(sim.v * 3.6)} km/h`);
      }
    }
    // When the GPS comes back after the train moved by its timetable: how far ahead of the new GPS it was drawn
    // (negative: behind). The timetable pace guesses; far ahead means it then waits for the real train.
    if (sim && sim.mode === 'gps' && ['timetable', 'waiting'].includes(prev.get(d.id)?.mode)) s.returnAheadM.push(-sim.gap);
    if (sim?.jumped) s.jumps++;
    const last = prev.get(d.id);
    const now = { p: d, v: sim?.v, dir: last?.dir ?? null, synced: sim?.syncing ?? false, frozenRun: 0, mode: sim?.mode };
    if (sim?.syncing && !last?.synced) {
      s.syncStarts++;
      const why = sim.lastGap > 30 ? 'after a silence over 30 s' : `gap ${Math.round(sim.gap)} m, target ${sim.target}`;
      s.syncWhy.push(why);
      if (argv.includes('--why') && !why.startsWith('after') && s.syncWhy.filter(w => !w.startsWith('after')).length <= 3)
        console.log('sync start', d.id, new Date(t).toISOString().slice(11, 21), why);
    }
    // Turn-backs, judged over every 5 m moved (so a standing train's jitter doesn't count). The truth's own
    // (a train reversing at a terminus is real) for comparison.
    const truthTurned = turnBack(truthDir, d.id, tru);
    s.truthBack += truthTurned;
    if (truthTurned) truthTurnAt.set(d.id, t);
    const tb = turnBack(drawnDir, d.id, d);
    // Wrong way (Max, 2026-11-12: "U-turns on the line"): the drawn train moving against the real one, both moving
    // (over 3 m/s drawn, 10 km/h real), for 3 s or more; not within a minute of the real train's own turn (a train
    // reversing at a terminus is drawn turning a few seconds later: that is lag, not a wrong way); only where the real
    // place comes from reports at most 30 s apart (in a longer silence the truth is a straight line, its direction a
    // guess).
    {
      const dd = drawnDir.get(d.id)?.dir, td = truthDir.get(d.id)?.dir, simW = PLAIN ? null : drawnTrains.simOf(d.id);
      const against = dd != null && td != null && (simW ? simW.v > 3 : true) && tru.kmh > 10 && tru.gap <= 30 && angle(dd, td) > 120 &&
        !(t - (truthTurnAt.get(d.id) ?? -Infinity) < 60000);
      const run = wrongRun.get(d.id);
      if (against) {
        if (!run) wrongRun.set(d.id, { from: t, counted: false, lon: d.lon, lat: d.lat, mode: simW?.mode, pastLast: simW?.pastLast });
        else if (!run.counted && t - run.from >= 3000) {
          run.counted = true; s.wrongWay++;
          if (argv.includes('--why') && s.wrongWay <= 12) console.log('wrong way', d.id, new Date(run.from).toISOString().slice(11, 21), `at ${run.lat.toFixed(5)},${run.lon.toFixed(5)}`, run.mode, `past last report ${Math.round(run.pastLast)} m`);
        }
      } else if (run) wrongRun.delete(d.id);
    }
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
            // ...of them, waiting at a stopping place before the real train got there (point 5 B)
            if (sim?.atPlace && sim.target === 'waiting before a stop') s.earlyAtPlace++;
            if (sim) { const why = sim.gap < -1 ? `ahead of the target (${sim.target})` : `target ${sim.target}`; s.why[why] = (s.why[why] ?? 0) + 1; }
          }
        } else {
          s.silentMoving++;
          if (moved <= 0.05) s.silentFrozen++;
          s.silentLagS.push(off / (tru.kmh / 3.6));
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
    const moving = PLAIN ? 0 : drawn.filter(d => drawnTrains.simOf(d.id)?.v > 0.5).length;
    const grey = drawn.filter(d => d.stale).length;
    cutLog.push(`${Math.round((T - cutFrom) / 1000)} s: ${moving} of ${drawn.length} drawn moving, ${grey} grey, ${syncing} fast-forwarding` +
      `${drawnTrains.halted ? ' (halted: no data for 60 s)' : ''}`);
  }
}

// Dwell at real stops the drawn train came by (5 s or more within 300 m), inside the replayed time.
const dwells = [...realStops.values()].flat().filter(st => st.near >= 5 && st.arr > start && st.dep < end);
const dwellThrough = dwells.filter(st => st.still < 5).length;
// Drawn stands at real stops with a stopping place, the whole stop inside the replayed time; a stand counts when it
// overlaps the stop's time (30 s before the arrival to 75 s after the departure: the times are whole minutes).
const placed = [...realStops.values()].flat().filter(st => st.place && st.arr > start + 120000 && st.dep < end - 240000);
const stands = placed.filter(st => st.best && Math.min(st.dep + 75000, st.best.to) - Math.max(st.arr - 30000, st.best.from) >= 0)
  .map(st => ({ m: metres(st.best, st.place), noGps: st.best.noGps }));
const pct = (a, b) => `${(100 * a / b).toFixed(1)} %`;
const q = (arr, f) => { if (!arr.length) return NaN; const x = Float64Array.from(arr).sort(); return x[Math.floor(f * (x.length - 1))]; };
const f1 = v => (Number.isFinite(v) ? v.toFixed(1) : '-');
const minutes = (end - start) / 60000;
// Wrong branches inside the replayed time.
const wrongIn = branches.events.filter(e => e.time >= start - DELAY && e.time < end);
if (argv.includes('--why')) for (const e of wrongIn.slice(0, 12)) console.log('wrong branch', e.id, new Date(e.time).toISOString().slice(11, 19), `slid ${e.slide} m, ${e.side} m sideways, at ${e.lat.toFixed(5)},${e.lon.toFixed(5)}`);
// The stand numbers: all stops, and those of trains drawn as seen only at fixed places (point 5 B).
function standNumbers(r) {
  const ng = stands.filter(x => x.noGps).map(x => x.m), all = stands.map(x => x.m);
  const over = (a, m) => (a.length ? r(100 * a.filter(x => x > m).length / a.length, 1) : null);
  return { standStops: all.length, standPlaceMedM: all.length ? Math.round(q(all, 0.5)) : null, standPlace90M: all.length ? Math.round(q(all, 0.9)) : null,
    standPlaceOver200Pct: over(all, 200), standNoGpsStops: ng.length, standNoGpsMedM: ng.length ? Math.round(q(ng, 0.5)) : null,
    standNoGpsOver200Pct: over(ng, 200), earlyAtPlacePct: r(100 * s.earlyAtPlace / s.moving, 3) };
}
// --json: the main numbers as one JSON line (tools/check.mjs reads it), instead of the text below.
if (argv.includes('--json')) {
  const r = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
  console.log(JSON.stringify({
    file, minutes: r(minutes, 1), routes: routes?.count ?? 0,
    frozenPct: r(100 * s.frozen / s.moving), stopsPerMin: r(s.freezes.length / minutes, 1),
    lagMedianS: r(q(s.lagS, 0.5)), lag90S: r(q(s.lagS, 0.9)), lag99S: r(q(s.lagS, 0.99)),
    offTrack99M: offTrack.length ? r(q(offTrack, 0.99)) : null,
    turnBacks: s.back, truthTurnBacks: s.truthBack, wrongWay: s.wrongWay,
    greyPct: r(100 * s.stale / s.all), timetableReturns: s.returnAheadM.length,
    returnAhead500: s.returnAheadM.filter(m => m > 500).length, returnAhead90M: s.returnAheadM.length ? Math.round(q(s.returnAheadM, 0.9)) : null, silentStandingPct: r(100 * s.silentFrozen / s.silentMoving),
    dwellStops: dwells.length, dwellThroughPct: dwells.length ? r(100 * dwellThrough / dwells.length, 1) : null,
    pastStop: s.pastStop, pastStopBounced: s.pastStopBounced, movedAfterStanding: s.stoodMoved, syncStartsPerMin: r(s.syncStarts / minutes, 1),
    wrongBranch: wrongIn.length, wrongBranch300: wrongIn.filter(e => e.slide >= 300).length,
    ...standNumbers(r),
  }));
  process.exit(0);
}
console.log(`${file}, ${minutes.toFixed(1)} minutes, drawn ${DELAY / 1000} s behind, ${PLAIN ? 'reports directly (no simulation)' : 'simulated'}, ${net ? 'on the rail network' : 'straight lines'}${routes ? `, with ${routes.count} planned routes` : ''}; ` +
  `replayed in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
console.log(`cleaning: ${JSON.stringify(drawnTrains.counts)}`);
console.log(`(below: only where the truth is known, reports at most 30 s apart; ${pct(s.silentMoving, s.silentMoving + s.moving)} of moving moments are in longer silences, drawn standing ${pct(s.silentFrozen, s.silentMoving)} of those)`);
console.log(`frozen while really moving (over 15 km/h): ${pct(s.frozen, s.moving)}`);
if (!PLAIN) console.log('  why:', Object.entries(s.why).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${pct(n, s.frozen)}`).join(', '));
console.log(`stops of 0.5 s or more while really moving: ${s.freezes.length} (${(s.freezes.length / minutes).toFixed(0)} a minute across the map); ` +
  `length median ${f1(q(s.freezes, 0.5))} s, 90 % ${f1(q(s.freezes, 0.9))} s`);
console.log(`turn-backs over 120°: drawn ${s.back}, in the truth itself ${s.truthBack}`);
console.log(`wrong way (drawn against the real train, both moving, 3 s or more, not at its own turn): ${s.wrongWay}`);
console.log(`wrong branch (drawn onto another track before its next report, slid ${30} m or more sideways): ${wrongIn.length}, of them 300 m or more ${wrongIn.filter(e => e.slide >= 300).length}`);
console.log(`distance from the truth while moving: median ${f1(q(s.lagM, 0.5))} m, 90 % ${f1(q(s.lagM, 0.9))} m, 99 % ${f1(q(s.lagM, 0.99))} m; ` +
  `in seconds of travel: median ${f1(q(s.lagS, 0.5))}, 90 % ${f1(q(s.lagS, 0.9))}, 99 % ${f1(q(s.lagS, 0.99))}`);
console.log(`distance from the truth while it stands: median ${f1(q(s.standM, 0.5))} m, 90 % ${f1(q(s.standM, 0.9))} m, 99 % ${f1(q(s.standM, 0.99))} m`);
if (!PLAIN) console.log(`grey: ${pct(s.stale, s.all)} of train-moments`);
if (!PLAIN && s.returnAheadM.length) console.log(`GPS back after moving by the timetable: ${s.returnAheadM.length} times; drawn ahead of it ` +
  `median ${Math.round(q(s.returnAheadM, 0.5))} m, 90 % ${Math.round(q(s.returnAheadM, 0.9))} m, more than 500 m ahead ${s.returnAheadM.filter(m => m > 500).length}, ` +
  `more than 500 m behind ${s.returnAheadM.filter(m => m < -500).length}`);
if (!PLAIN) console.log(`in longer silences, off from the (straight-line) truth: median ${f1(q(s.silentLagS, 0.5))} s of travel, ` +
  `90 % ${f1(q(s.silentLagS, 0.9))} s; moving on past where it stood, 30 s or more after its GPS went quiet (must be 0): ${s.stoodMoved}`);
if (routes) console.log(`DWELL at real stops (an actual arrival and departure), drawn within 300 m: ${dwells.length}; drawn standing under 5 s (driving through): ${dwellThrough} = ${dwells.length ? (100 * dwellThrough / dwells.length).toFixed(1) : '-'} %; drawn standing median ${f1(q(dwells.map(st => st.still), 0.5))} s`);
if (routes) {
  const n = standNumbers((v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null));
  console.log(`STANDS at real stops with a measured stopping place: ${n.standStops} drawn standing; to the stopping place median ${n.standPlaceMedM} m, 90 % ${n.standPlace90M} m, over 200 m ${n.standPlaceOver200Pct} %; ` +
    `trains seen only at fixed places ${n.standNoGpsStops}: median ${n.standNoGpsMedM} m, over 200 m ${n.standNoGpsOver200Pct} %; moving trains drawn waiting at a stopping place: ${n.earlyAtPlacePct} % of moments`);
}
if (routes) console.log(`coasting towards a planned stop: ${s.coastToStop} train-moments; past the stop: ${s.pastStop} (and ${s.pastStopBounced} where the train's own data went back on itself)`);
if (offTrack.length) console.log(`distance from the nearest track: median ${f1(q(offTrack, 0.5))} m, 90 % ${f1(q(offTrack, 0.9))} m, 99 % ${f1(q(offTrack, 0.99))} m`);
if (!PLAIN) console.log(`syncing (fast-forward): ${pct(s.syncMoments, s.all)} of train-moments, ${(s.syncStarts / minutes).toFixed(1)} starts a minute; jumps ${(s.jumps / minutes).toFixed(1)} a minute`);
if (!PLAIN) {
  const silence = s.syncWhy.filter(w => w.startsWith('after')).length;
  console.log(`  of the syncs: ${silence} after a silence over 30 s; others e.g. ${s.syncWhy.filter(w => !w.startsWith('after')).slice(0, 6).join('; ')}`);
}
if (CUT) console.log(`connection cut for ${CUT / 1000} s (0 s = the cut starts):\n  ` + cutLog.join('\n  '));
