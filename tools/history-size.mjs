// How big the day's history files are, and how well the trains drawn from them match what they really did (build plan
// part 4, 2026-11-22). Plays recordings through the fetcher's memory (fetcher/state.mjs) at the recording's own times
// with no timers (as tools/fetcher-check.mjs), samples every train every 30 s and every 60 s (state.sampleHistory), and
// packs each 15-minute slot two ways:
//   plain: one row per point [id, number, lon, lat, speed, bearing, time, late, company] (positions to 1e-5);
//   steps: src/live-file.js historyRow (per train, small steps in columns): the format the fetcher writes.
// Prints the packed (gzip) size per whole 15-minute slot, and a day for one viewer, from the slots' sizes: rush hour
// 6 h (06:00-09:00, 15:00-18:00), the day 11 h, the night 7 h (each from its recording's slots).
// Drawn: every real report between two points against the train placed at that report's time by src/day-trains.js,
// straight and along the rails (src/rail-net.js); trains moving (over 100 m between the points). Also how long a
// frame of every train takes (day.at(T)), at x60 and x600 (60 frames a second).
// Run: node tools/history-size.mjs [recording names...] [--no-draw]
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { toRecord } from '../src/trains-source.js';
import { passingsOf, trainKey } from '../src/trafikverket.js';
import { historyRow, historySlot, HISTORY_MS, FORMAT } from '../src/live-file.js';
import { netFromJSON } from '../src/rail-net.js';
import { createDayTrains } from '../src/day-trains.js';
import { createState } from '../fetcher/state.mjs';

const args = process.argv.slice(2);
const DRAW = !args.includes('--no-draw');
const given = args.filter(a => !a.startsWith('--'));
const RECS = given.length ? given.map(n => [n, null]) : [
  ['2026-11-17T15-00-00-001Z', 'rush'], ['2026-11-19T10-30-00-013Z', 'day'], ['2026-11-19T22-28-02-750Z', 'night']];
const HOURS = { rush: 6, day: 11, night: 7 };
const lines = f => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const gz = o => gzipSync(JSON.stringify(o), { level: 6 }).length;
const kb = n => (n / 1024).toFixed(0);
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const R = Math.PI / 180;
const metres = (a, b) => { const kx = Math.cos(((a.lat + b.lat) / 2) * R); return Math.hypot((b.lon - a.lon) * kx, b.lat - a.lat) * R * 6371000; };
const net = DRAW ? netFromJSON(JSON.parse(readFileSync('public/rail-net.json', 'utf8'))) : null;

const plainOf = (trs, t, slot, every) => ({ v: FORMAT, t, kind: 'history', slot, every,
  rows: trs.flatMap(tr => tr.points.map(p => [tr.id, tr.number, p.lon, p.lat, p.speed, p.bearing, p.time, p.late, tr.brand])) });
const stepsOf = (trs, t, slot, every) => ({ v: FORMAT, t, kind: 'history', slot, every, trains: trs.map(tr => historyRow(tr, t)) });

const perDay = { 30000: { plain: {}, steps: {} }, 60000: { plain: {}, steps: {} } };
for (const [name, role] of RECS) {
  const pos = lines(`data/positions-${name}.jsonl`), tt = lines(`data/timetable-${name}.jsonl`);
  if (!pos.length) { console.log(`skip ${name}: no recording in data/`); continue; }
  const events = [...pos.map(p => ['p', Date.parse(p.got), p]), ...tt.map(a => ['t', Date.parse(a.got), a])].sort((a, b) => a[1] - b[1]);
  const first = events[0][1], last = events.at(-1)[1];
  // (every 10 s only as a yardstick for the drawing: how far off the trains are when points are close)
  const runs = [30000, 60000, ...(DRAW ? [10000] : [])].map(every => ({ every, state: createState(), next: Math.ceil(first / every) * every + 50, slot: null, files: [] }));
  const truth = new Map();   // train id -> its reports [{ time, lon, lat }] (not the first answer's)
  const sample = (run, t) => {
    const slot = historySlot(t);
    if (run.slot !== null && slot !== run.slot) {
      const trs = run.state.takeHistory(run.slot), st = run.slot * HISTORY_MS;
      const whole = st >= first && st + HISTORY_MS <= last;
      run.files.push({ slot: run.slot, whole, trains: trs.length, points: trs.reduce((n, x) => n + x.points.length, 0),
        plain: gz(plainOf(trs, st, run.slot, run.every)), steps: gz(stepsOf(trs, st, run.slot, run.every)), file: stepsOf(trs, st, run.slot, run.every) });
    }
    run.slot = slot;
    run.state.sampleHistory(t);
  };
  for (const [kind, got, x] of events) {
    for (const run of runs) while (got >= run.next) { sample(run, run.next); run.next += run.every; }
    for (const { state } of runs) {
      if (kind === 'p') {
        const r = toRecord(x);
        if (r) state.addRecords([r], got);
      } else {
        state.addPassings(passingsOf([x]), got, { first: x.via === 'start' });
        if (!x.Deleted && x.AdvertisedTimeAtLocation && x.OperationalTrainNumber)
          state.addPlanned([{ key: trainKey(x.OperationalTrainNumber, x.ScheduledDepartureDateTime), sig: x.LocationSignature,
            activity: x.ActivityType, planned: Date.parse(x.AdvertisedTimeAtLocation), brand: x.ProductInformation?.[0]?.Description ?? null }], got);
      }
    }
    if (kind === 'p' && x.via !== 'start') {
      const r = toRecord(x);
      if (r && !r.gone) (truth.get(r.id) ?? truth.set(r.id, []).get(r.id)).push({ time: r.time, lon: r.lon, lat: r.lat });
    }
  }
  console.log(`\n${name}${role ? ` (${role})` : ''}: ${((last - first) / 3600e3).toFixed(1)} h, ${truth.size} trains reporting`);
  for (const run of runs) {
    const whole = run.files.filter(f => f.whole);
    if (!whole.length) { console.log(`  every ${run.every / 1000} s: no whole 15-minute slot`); continue; }
    const p = whole.map(f => f.plain), s = whole.map(f => f.steps);
    console.log(`  every ${run.every / 1000} s: ${whole.length} whole slots, ${Math.round(mean(whole.map(f => f.trains)))} trains, ${Math.round(mean(whole.map(f => f.points)))} points a slot; ` +
      `packed a slot: plain ${kb(mean(p))} kB (max ${kb(Math.max(...p))}), steps ${kb(mean(s))} kB (max ${kb(Math.max(...s))})`);
    if (role && perDay[run.every]) { perDay[run.every].plain[role] = mean(p); perDay[run.every].steps[role] = mean(s); }
    run.whole = whole;
  }
  if (!DRAW) continue;

  // Drawn against the truth: each report between a train's two points, the place day-trains gives at its time.
  for (const run of runs) {
    if (!run.whole) continue;
    for (const useNet of [false, true]) {
      const day = createDayTrains({ net: useNet ? net : null });
      for (const f of run.files) day.add(f.file);
      const errs = [], errs200 = [];
      const lo = run.whole[0].slot * HISTORY_MS, hi = (run.whole.at(-1).slot + 1) * HISTORY_MS;
      const t0 = Date.now();
      for (const [id, reps] of truth) {
        for (let k = 0; k < reps.length; k += 3) {   // every third report (enough, and three times quicker)
          const r = reps[k];
          if (r.time < lo || r.time >= hi) continue;
          const p = day.placeOf(id, r.time);
          if (!p || p.v * 3.6 < 15) continue;   // standing or crawling: nothing to tell apart
          const e = metres(p, r);
          errs.push(e);
          if (p.v * 3.6 >= 150) errs200.push(e);
        }
      }
      const c = day.counts;
      console.log(`  drawn, every ${run.every / 1000} s, ${useNet ? 'along the rails' : 'straight'}: ${errs.length} reports of moving trains, off by median ${pct(errs, .5).toFixed(0)} m, ` +
        `90 % ${pct(errs, .9).toFixed(0)} m, 99 % ${pct(errs, .99).toFixed(0)} m; at 150+ km/h (${errs200.length}): median ${pct(errs200, .5).toFixed(0)} m, 90 % ${pct(errs200, .9).toFixed(0)} m` +
        (useNet ? `; ${c.ways} ways, ${c.straight} straight (no way found), ${((Date.now() - t0) / 1000).toFixed(1)} s` : ''));
    }
  }
  // A frame of every train: at x60 (1 s a frame) and x600 (10 s a frame), up to 2 minutes of frames, rails, cold
  // (each way worked out as it is first needed) and again over the same stretch (warm).
  const run = runs[0];
  if (!run.whole) continue;
  const day = createDayTrains({ net });
  for (const f of run.files) day.add(f.file);
  const start = run.whole[0].slot * HISTORY_MS + 60000;
  for (const [speed, step] of [['x60', 1000], ['x600', 10000]]) {
    for (const pass of ['cold', 'warm']) {
      const ms = [];
      let n = 0;
      const end = (run.whole.at(-1).slot + 1) * HISTORY_MS;
      for (let i = 0; i < 7200 && start + i * step < end; i++) {
        const a = performance.now();
        n = day.at(start + i * step).length;
        ms.push(performance.now() - a);
      }
      console.log(`  a frame (${n} trains, ${speed}, rails, ${pass}): median ${pct(ms, .5).toFixed(2)} ms, 99 % ${pct(ms, .99).toFixed(2)} ms, max ${Math.max(...ms).toFixed(1)} ms over ${ms.length} frames`);
    }
  }
}
console.log('\na day for one viewer (rush 6 h, day 11 h, night 7 h; 4 slots an hour):');
for (const every of [30000, 60000]) for (const how of ['plain', 'steps']) {
  const s = perDay[every][how];
  if (!s.rush || !s.day || !s.night) continue;
  const total = 4 * (HOURS.rush * s.rush + HOURS.day * s.day + HOURS.night * s.night);
  console.log(`  every ${every / 1000} s, ${how}: ${(total / 1e6).toFixed(1)} MB`);
}
