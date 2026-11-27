// The day's history files (build plan part 4, 2026-11-22), offline, a few seconds:
//   - a recording (19 Nov, late evening) through the fetcher's memory (fetcher/state.mjs sampleHistory) and files
//     (fetcher/files.mjs buildHistory), packed as JSON and read back (src/live-file.js historyOf): every train's every
//     point unchanged, every train the recording had on the map in the files;
//   - slot names, and how long the files are kept (a day after the slot ends, 2026-11-27: a rolling day): around
//     midnight, the 23- and 25-hour days, in Swedish time and with the computer in UTC and in New York; the shelf
//     (fetcher/files.mjs) lets go of a file only then;
//   - a train's trip ends (start, end: fetcher/timetable.mjs ends, sampled by fetcher/state.mjs) read back; an older
//     row without them reads as null; the day's overview (daysum) counts each slot as the page's bars do; Rewind's
//     timeline labels (src/day-ticks.js): Yesterday, the hours, Today at Swedish midnight, now;
//   - the page's reader (src/files-source.js history()) on a pretend site: every slot asked by its name, a missing one
//     a gap (rows null), the slot running now not asked;
//   - src/day-trains.js: a train between its two points (half-way at half time), standing at its last point, gone after
//     its slot, nothing in a gap; on the recording's files every train placed within its two points.
// Run: node tools/history-check.mjs     exit code 0: all hold; 1: one failed
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { historyOf, historyRow, historyName, historySlot, historyUntil, historyCounts, daySumOf, HISTORY_MS, HISTORY_EVERY_MS, FORMAT } from '../src/live-file.js';
import { createState } from '../fetcher/state.mjs';
import { buildHistory, buildDaySum, createShelf } from '../fetcher/files.mjs';
import { createTimetable } from '../fetcher/timetable.mjs';
import { ticksFor } from '../src/day-ticks.js';
import { startFilesSource } from '../src/files-source.js';
import { createDayTrains } from '../src/day-trains.js';
import { eventsOf, play } from './lib/history-play.mjs';

let failed = 0;
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();

// ---------- 1. a recording through the fetcher's memory and files, read back ----------
const REC = '2026-11-19T22-28-02-750Z';
const events = eventsOf(REC);
const files = [];
if (!events.length) ok(false, `the recording data/positions-${REC}.jsonl is here`);
else {
  const state = createState();
  const shown = new Set();   // trains on the map at some sample (not gone)
  let back = 0, differ = 0, points = 0, bytes = 0;
  play(state, events, {
    every: HISTORY_EVERY_MS,
    // Every train the live file shows at a sample (fetcher/state.mjs trains, not gone) must be in a file.
    onSample(t) { for (const r of state.trains(t)) if (!r.gone) shown.add(r.id); },
    onSlot(slot, list) {
      if (!list.length) return;
      const f = buildHistory(slot, list);
      const json = JSON.stringify(f), read = JSON.parse(json);
      bytes += gzipSync(json).length;
      files.push(read);
      read.trains.forEach((row, i) => {
        back++; points += list[i].points.length;
        if (!isDeepStrictEqual(historyOf(row, read.t), list[i])) { if (differ++ < 3) console.log('  differs:', JSON.stringify(list[i]).slice(0, 200), JSON.stringify(historyOf(row, read.t)).slice(0, 200)); }
      });
      if (read.t !== slot * HISTORY_MS || read.slot !== slot || read.v !== FORMAT || read.kind !== 'history') differ++;
    },
  });
  const inFiles = new Set(files.flatMap(f => f.trains.map(r => r[0])));
  const missing = [...shown].filter(id => !inFiles.has(id));
  ok(back > 0 && differ === 0, `a recording's slots read back unchanged: ${back - differ}/${back} trains, ${points} points, ${files.length} files, ${(bytes / 1024).toFixed(0)} kB packed`);
  ok(missing.length === 0 && shown.size > 100, `every train on the map is in the files: ${shown.size - missing.length}/${shown.size}${missing.length ? ` (missing ${missing.slice(0, 5).join(', ')})` : ''}`);
  const companies = files.flatMap(f => f.trains).filter(r => r[2]).length, lates = files.flatMap(f => f.trains.flatMap(r => r[10])).filter(x => x !== null).length;
  ok(companies > 0.8 * back && lates > 0, `company and lateness kept: company on ${companies}/${back} rows, ${lates} points with lateness`);
}

// ---------- 2. names and keep times ----------
const Z = s => Date.parse(s);
const keepCases = [
  // [slot start (UTC), kept until (UTC), what]
  ['2026-11-22T22:45:00Z', '2026-11-23T23:00:00Z', '23:45 kept until 00:00 the next night (a day after its end)'],
  ['2026-11-22T23:00:00Z', '2026-11-23T23:15:00Z', 'midnight (00:00) kept until 00:15 the next night'],
  ['2026-11-22T11:00:00Z', '2026-11-23T11:15:00Z', 'midday kept until 12:15 the next day'],
  ['2026-10-24T22:00:00Z', '2026-10-25T22:15:00Z', 'the 25-hour day (25 Oct 2026) from its midnight: 24 real hours after its end'],
  ['2026-10-25T22:45:00Z', '2026-10-26T23:00:00Z', 'the 25-hour day, 23:45'],
  ['2026-03-28T23:00:00Z', '2026-03-29T23:15:00Z', 'the 23-hour day (29 Mar 2026) from its midnight: 24 real hours after its end'],
  ['2026-07-01T21:45:00Z', '2026-07-02T22:00:00Z', 'summer time, 23:45'],
];
for (const tz of [null, 'UTC', 'America/New_York']) {
  const was = process.env.TZ;
  if (tz) process.env.TZ = tz;
  const bad = keepCases.filter(([s, u]) => historyUntil(Z(s)) !== Z(u));
  ok(bad.length === 0, `keep times${tz ? ` (computer in ${tz})` : ''}: ${keepCases.length - bad.length}/${keepCases.length}${bad.length ? ` wrong: ${bad.map(b => `${b[2]} -> ${new Date(historyUntil(Z(b[0]))).toISOString()}`).join('; ')}` : ''}`);
  if (tz) { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
}
{
  const t = Z('2026-11-22T15:07:31Z');
  const slot = historySlot(t);
  ok(slot * HISTORY_MS === Z('2026-11-22T15:00:00Z') && historyName(slot) === `history-${slot}.json` && historySlot(slot * HISTORY_MS) === slot && historySlot(slot * HISTORY_MS - 1) === slot - 1,
    `slot names from the clock: 16:07:31 is ${historyName(slot)}, starting 16:00:00`);
  // The shelf lets go of a history file at its keep time, not before (the newest of a kind is always kept: two made).
  const gone = [];
  const shelf = createShelf({ onRemove: n => gone.push(n) });
  const a = Z('2026-11-22T22:45:00Z'), b = a + HISTORY_MS;
  const na = shelf.put('history', a, { a: 1 }), nb = shelf.put('history', b, { b: 1 });
  shelf.sweep(Z('2026-11-23T23:00:00Z'));
  const keptADay = !gone.length;
  shelf.sweep(Z('2026-11-23T23:00:01Z'));
  ok(na === historyName(historySlot(a)) && nb !== na && keptADay && gone.join() === na && shelf.get(nb), `the shelf keeps 23:45's file a day after its end, then lets go (${gone.join(', ') || 'nothing'})`);
}

// ---------- 2b. a trip's ends, and the day's overview ----------
{
  const loc = sig => [{ LocationName: sig, Priority: 1, Order: 0 }];
  const row = (op, sig, at, from, to) => ({ OperationalTrainNumber: op, AdvertisedTrainIdent: op, ScheduledDepartureDateTime: '2026-11-22T00:00:00.000+01:00',
    LocationSignature: sig, ActivityType: 'Avgang', Advertised: true, AdvertisedTimeAtLocation: at, ...(from ? { FromLocation: loc(from) } : {}), ...(to ? { ToLocation: loc(to) } : {}) });
  const tt = createTimetable({ log() {}, seed: { days: ['2026-11-22'], rows: [
    row('42', 'Mra', '2026-11-22T08:00:00.000+01:00', 'Mra', 'Cst'), row('42', 'Bl', '2026-11-22T09:00:00.000+01:00', 'Mra', 'Cst'),
    row('7', 'G', '2026-11-22T08:00:00.000+01:00', null, null)] } });
  const e42 = tt.ends('42/2026-11-22'), e7 = tt.ends('7/2026-11-22'), none = tt.ends('42/2026-11-21');
  ok(e42?.start === 'Mra' && e42?.end === 'Cst' && e7?.start === null && e7?.end === null && none === null,
    `the timetable's trip ends by train id (42: ${e42?.start} → ${e42?.end}; no ends: null; another day: ${none})`);
  tt.stop();
  // sampled into the history and read back; an older row (11 positions) reads as no ends
  const st = createState(), t = Z('2026-11-22T08:05:00Z');
  st.addRecords([{ id: '42/2026-11-22', number: '42', lon: 18, lat: 59, speed: 80, bearing: 0, time: t - 2000 }], t);
  st.sampleHistory(t, id => tt.ends(id));
  const [tr] = st.takeHistory(historySlot(t)), f = buildHistory(historySlot(t), [tr]);
  const h = historyOf(JSON.parse(JSON.stringify(f)).trains[0], f.t), old = historyOf(f.trains[0].slice(0, 11), f.t);
  ok(tr.start === 'Mra' && tr.end === 'Cst' && h.start === 'Mra' && h.end === 'Cst' && f.trains[0].length === 13 && old.start === null && old.end === null,
    `a train's ends at the row's end (positions 11, 12: ${h.start} → ${h.end}); an older row without them: ${old.start}, ${old.end}`);
  // the overview: every slot's counts as the bars count them, read back by the page's reader
  const rows = [[0, 0, 0, 0, 0, [], [], [], [], [], [1, null]], [0, 0, 0, 0, 0, [], [], [], [], [], [4]], [0, 0, 0, 0, 0, [], [], [], [], [], [9, 12]], [0, 0, 0, 0, 0, [], [], [], [], [], [null]]];
  const c = historyCounts(rows);
  const sum = JSON.parse(JSON.stringify(buildDaySum(t, new Map([[101, c], [100, [2, 1, 1, 0, 0]]])))), back = daySumOf(sum);
  ok(c.join() === '4,1,1,1,1' && sum.kind === 'daysum' && sum.slots[0][0] === 100 && back.get(101)?.n === 4 && back.get(101)?.c.late === 1 && back.get(100)?.c.some === 1,
    `the day's overview: a slot's trains by lateness (${c.join(' ')}), slots in order, read back`);
}

// ---------- 2c. Rewind's timeline labels (src/day-ticks.js) ----------
{
  const words = { yesterday: 'Igår', today: 'Idag', now: 'nu' }, show = r => r.ticks.map(t => t.text).join(' ');
  const day = ticksFor(Z('2026-11-26T11:40:00Z'), Z('2026-11-27T11:40:00Z'), 300, words);   // a phone: 300 px for 24 h
  const mid = (Z('2026-11-26T23:00:00Z') - Z('2026-11-26T11:40:00Z')) / 864e5 * 300;
  ok(show(day) === 'Igår 18 21 Idag 03 06 09 nu' && Math.abs(day.midnight - mid) < 0.01, `24 h on a phone: ${show(day)}, midnight at ${day.midnight?.toFixed(1)} px`);
  const short = ticksFor(Z('2026-11-27T10:15:00Z'), Z('2026-11-27T11:40:00Z'), 300, words);
  ok(short.midnight === null && !show(short).includes('Igår') && show(short).startsWith('12') && show(short).endsWith('nu'), `a morning's hour and a half: ${show(short)}, no midnight`);
  const summer = ticksFor(Z('2026-07-01T10:00:00Z'), Z('2026-07-02T10:00:00Z'), 300, words);
  const at = summer.ticks.find(t => t.kind === 'today');
  ok(at && Math.abs(at.x - (Z('2026-07-01T22:00:00Z') - Z('2026-07-01T10:00:00Z')) / 864e5 * 300) < 0.01, `summer time: "Idag" at Swedish midnight (${at?.x.toFixed(1)} px)`);
}

// ---------- 3. the page's reader ----------
{
  const realFetch = globalThis.fetch;
  const now = Date.now(), done = historySlot(now) - 1;
  const have = new Set([done - 3, done - 1, done]);   // done - 2 missing: a gap
  const asked = [];
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop();
    asked.push(name);
    const m = /^history-(\d+)\.json$/.exec(name);
    const slot = m && Number(m[1]);
    const body = m && have.has(slot) ? { v: FORMAT, t: slot * HISTORY_MS, kind: 'history', slot, every: HISTORY_EVERY_MS,
      trains: [historyRow({ id: '1/2026-11-22', number: '1', brand: 'SJ', from: slot * HISTORY_MS, until: slot * HISTORY_MS + 60000,
        points: [{ time: slot * HISTORY_MS, lon: 18, lat: 59, speed: 0, bearing: 0, late: 0 }] }, slot * HISTORY_MS)] } : null;
    return { ok: Boolean(body), status: body ? 200 : 404, headers: { get: () => null }, json: async () => body };
  };
  const src = startFilesSource('http://site/', { onRecords() {}, onStatus() {}, onPassings() {}, onPlanned() {}, onStations() {}, onFile() {} });
  try {
    const h = await src.history((done - 3) * HISTORY_MS, now);
    const got = h.slots.map(s => `${s.slot - done}:${s.rows ? s.rows.length : 'gap'}`).join(' ');
    ok(got === '-3:1 -2:gap -1:1 0:1' && h.upTo === (done + 1) * HISTORY_MS && !asked.includes(historyName(done + 1)),
      `the reader: three files and a gap, the slot running now not asked (${got})`);
    const histAsked = () => asked.filter(n => n.startsWith('history-')).length, again = histAsked();
    await src.history((done - 3) * HISTORY_MS, now);
    ok(histAsked() === again, `the reader keeps the files it has, and asks a gap again only after a wait (${histAsked() - again} asked again)`);
    ok(src.sizes().history === 3 && src.sizes().cache === 0, `the day's files in their own store (${src.sizes().history} there, ${src.sizes().cache} in the live page's)`);
    const day = createDayTrains();
    for (const s of h.slots) day.add(s);
    ok(day.slots.length === 3, `day-trains takes the reader's slots, skips the gap (${day.slots.length} slots)`);
  } finally { src(); globalThis.fetch = realFetch; }
}

// ---------- 4. day-trains ----------
{
  const t = Z('2026-11-22T15:00:00Z'), slot = historySlot(t);
  const tr = { id: '42/2026-11-22', number: '42', brand: 'SJ Snabbtåg', start: 'Mra', end: 'Cst', from: t, until: t + 3 * 60000, points: [
    { time: t + 10000, lon: 18.0, lat: 59.0, speed: 100, bearing: 0, late: 2 },
    { time: t + 70000, lon: 18.0, lat: 59.01, speed: 120, bearing: 0, late: 2 },
    { time: t + 130000, lon: 18.02, lat: 59.01, speed: 0, bearing: 90, late: 3 }] };
  const day = createDayTrains();
  day.add(buildHistory(slot, [tr]));
  day.add(buildHistory(slot + 2, [{ ...tr, from: t + 2 * HISTORY_MS, until: t + 2 * HISTORY_MS, points: [{ time: t + 2 * HISTORY_MS, lon: 18.1, lat: 59.1, speed: 0, bearing: 0, late: 1 }] }]));
  const mid = day.placeOf('42/2026-11-22', t + 40000), still = day.placeOf('42/2026-11-22', t + 200000), before = day.placeOf('42/2026-11-22', t + 1000);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ok(mid && near(mid.lat, 59.005) && near(mid.lon, 18) && near(mid.bearing, 0) && mid.v > 18 && mid.v < 19 && mid.number === '42' && mid.brand === 'SJ Snabbtåg' && mid.late === 2 && mid.start === 'Mra' && mid.end === 'Cst',
    `half-way at half time, its number, company, lateness, ends and pace (${mid && `${mid.lat.toFixed(4)}, ${mid.v.toFixed(1)} m/s`})`);
  ok(still && still.lon === 18.02 && still.v === 0 && before?.lat === 59.0, 'standing at its last point after it, at its first before it');
  ok(day.placeOf('42/2026-11-22', t + 3 * 60000 + HISTORY_EVERY_MS + 1000) === null, 'off the map after its slot says it was');
  ok(day.at(t + HISTORY_MS + 300000).length === 0, 'nothing in a gap (no file)');
  const back = day.placeOf('42/2026-11-22', t + 2 * HISTORY_MS + 5000);
  ok(back && back.lon === 18.1, 'back in the slot after the gap, at its new point');
  // its trip so far (Rewind's line): the points up to T, the last piece to its place then
  const trail = day.trailOf('42/2026-11-22', t + 100000), line = trail[0] ?? [], end = line.at(-1);
  ok(trail.length === 1 && line.length === 3 && line[0][1] === 59.0 && line[1][1] === 59.01 && end && Math.abs(end[0] - 18.01) < 1e-9 && end[1] === 59.01,
    `the trip so far at 1:40: ${JSON.stringify(trail)}`);
  const keys = Object.keys(mid).sort().join();
  ok(['id', 'lon', 'lat', 'bearing', 'syncing', 'stale', 'v', 'extra'].every(k => k in mid), `the shape of src/trains.js placedAt (${keys})`);
}
if (files.length) {
  // Every train on the recording's files, at a moment between two of its points: inside their box (straight).
  const day = createDayTrains();
  for (const f of files) day.add(f);
  let n = 0, out = 0;
  for (const f of files) for (const row of f.trains) {
    const h = historyOf(row, f.t);
    for (let i = 0; i + 1 < h.points.length; i++) {
      const a = h.points[i], b = h.points[i + 1];
      if (b.time - a.time > 10 * 60000) continue;
      const p = day.placeOf(h.id, (a.time + b.time) / 2);
      n++;
      const inBox = p && p.lon >= Math.min(a.lon, b.lon) - 1e-9 && p.lon <= Math.max(a.lon, b.lon) + 1e-9 && p.lat >= Math.min(a.lat, b.lat) - 1e-9 && p.lat <= Math.max(a.lat, b.lat) + 1e-9;
      if (!inBox && out++ < 2) console.log(`  outside: ${h.id} between ${new Date(a.time).toISOString()} and ${new Date(b.time).toISOString()}: ${JSON.stringify(p)} (slot from ${new Date(h.from).toISOString()})`);
    }
  }
  const T = files[1]?.t ?? files[0].t, frame = performance.now(), list = day.at(T + 30000), ms = performance.now() - frame;
  ok(n > 1000 && out === 0, `the recording's trains placed between their two points: ${n - out}/${n}; a frame of ${list.length} trains ${ms.toFixed(2)} ms`);
}
console.log(failed ? `history-check FAILED: ${failed} (${((Date.now() - T0) / 1000).toFixed(1)} s)` : `history-check ok (${((Date.now() - T0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
