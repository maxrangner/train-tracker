// What a recording holds, so recordings can be chosen on numbers (tools/recordings.json): when it was, how many
// trains, how they report (no speed, silences, frozen positions, jumps), the real stops, cancellations and lateness.
// Run: node tools/profile.mjs <recording> [--json]
//   <recording>: data/positions-<name>.jsonl, or just <name>; its timetable (data/timetable-<name>.jsonl) when there is one.
//   --json: the numbers as one JSON line.
import { readFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = argv.find(a => !a.startsWith('--'));
if (!arg) { console.log('usage: node tools/profile.mjs <recording> [--json]'); process.exit(1); }
const file = arg.endsWith('.jsonl') ? arg : `data/positions-${arg}.jsonl`;
const ttFile = file.replace('positions-', 'timetable-');

const R = Math.PI / 180;
const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * R), b.lat - a.lat) * R * 6371000;
const q = (arr, f) => { if (!arr.length) return null; const x = Float64Array.from(arr).sort(); return x[Math.floor(f * (x.length - 1))]; };
const r1 = v => (v === null || !Number.isFinite(v) ? null : Number(v.toFixed(1)));

// ---- Positions (read as tools/motion-check.mjs does) ----
const recs = [];
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line) continue;
  const p = JSON.parse(line);
  const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(p?.Position?.WGS84 ?? '');
  if (!m || !p.Train) continue;
  recs.push({ id: `${p.Train.OperationalTrainNumber}/${p.Train.OperationalTrainDepartureDate.slice(0, 10)}`,
    lon: Number(m[1]), lat: Number(m[2]), speed: p.Speed ?? null, time: Date.parse(p.TimeStamp), got: Date.parse(p.got) });
}
recs.sort((a, b) => a.got - b.got);
const first = recs[0].got, last = recs.at(-1).got;
const minutes = (last - first) / 60000;

// Swedish time (the recordings' clock is UTC).
const sweTime = ms => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' });
const sweDay = ms => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'Europe/Stockholm', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

// Trains at once: those with a report in the last 10 minutes, every minute (the first 10 minutes need a run-up).
const byTrain = new Map();
for (const r of recs) (byTrain.get(r.id) ?? byTrain.set(r.id, []).get(r.id)).push(r);
const atOnce = [];
for (let t = first + 10 * 60000; t <= last; t += 60000) {
  let n = 0;
  for (const list of byTrain.values()) if (list.some(r => r.got <= t && r.got > t - 10 * 60000)) n++;
  atOnce.push(n);
}

// Per train, its own reports in the order measured (TimeStamp).
let repeats = 0, reports = 0, jumps = 0, gaps30 = 0, gaps120 = 0, gaps300 = 0, silentMs = 0, trainMs = 0, noSpeed = 0;
const region = { stockholm: 0, goteborg: 0, malmo: 0, north: 0, other: 0 };
for (const list of byTrain.values()) {
  list.sort((a, b) => a.time - b.time);
  if (list.every(r => r.speed === null)) noSpeed++;
  let lastNew = null;
  for (const r of list) {
    reports++;
    if (r.lat > 59.1 && r.lat < 59.6 && r.lon > 17.6 && r.lon < 18.5) region.stockholm++;
    else if (r.lat > 57.5 && r.lat < 58.0 && r.lon > 11.7 && r.lon < 12.3) region.goteborg++;
    else if (r.lat > 55.3 && r.lat < 56.1 && r.lon > 12.7 && r.lon < 13.6) region.malmo++;
    else if (r.lat > 61) region.north++;
    else region.other++;
    if (lastNew && r.lon === lastNew.lon && r.lat === lastNew.lat) { repeats++; continue; }
    if (lastNew && r.time > lastNew.time) {
      const gap = r.time - lastNew.time;
      trainMs += gap;
      if (gap >= 30000) { gaps30++; silentMs += gap; }
      if (gap >= 120000) gaps120++;
      if (gap >= 300000) gaps300++;
      const d = metres(lastNew, r);
      if (d > 2000 && d / (gap / 1000) * 3.6 > 300) jumps++;
    }
    lastNew = r;
  }
}

// ---- Timetable: passings, real stops, cancellations, lateness ----
let tt = null;
if (existsSync(ttFile)) {
  const rows = readFileSync(ttFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(a => !a.Deleted && a.OperationalTrainNumber && a.AdvertisedTimeAtLocation);
  // The newest row per train, place and activity (the stream sends a row again when it changes).
  const latest = new Map();
  for (const a of rows) {
    const k = `${a.OperationalTrainNumber}/${a.ScheduledDepartureDateTime?.slice(0, 10)}|${a.LocationSignature}|${a.ActivityType}|${a.AdvertisedTimeAtLocation}`;
    const was = latest.get(k);
    if (!was || (a.got ?? '') >= (was.got ?? '')) latest.set(k, a);
  }
  const rowsNow = [...latest.values()];
  const inside = a => { const t = Date.parse(a.TimeAtLocation); return t >= first && t <= last; };
  const passed = rowsNow.filter(a => a.TimeAtLocation && inside(a));
  const late = passed.map(a => (Date.parse(a.TimeAtLocation) - Date.parse(a.AdvertisedTimeAtLocation)) / 60000);
  const stops = new Map();
  for (const a of passed) {
    const k = `${a.OperationalTrainNumber}|${a.LocationSignature}`;
    (stops.get(k) ?? stops.set(k, new Set()).get(k)).add(a.ActivityType);
  }
  const canceled = new Set(rowsNow.filter(a => a.Canceled && Date.parse(a.AdvertisedTimeAtLocation) >= first && Date.parse(a.AdvertisedTimeAtLocation) <= last)
    .map(a => a.OperationalTrainNumber));
  // Lateness per train: its latest passing in the recording.
  const lastLate = new Map();
  for (const a of passed) {
    const was = lastLate.get(a.OperationalTrainNumber);
    if (!was || a.TimeAtLocation > was.TimeAtLocation) lastLate.set(a.OperationalTrainNumber, a);
  }
  const trainLate = [...lastLate.values()].map(a => (Date.parse(a.TimeAtLocation) - Date.parse(a.AdvertisedTimeAtLocation)) / 60000);
  tt = {
    passings: passed.length,
    realStops: [...stops.values()].filter(s => s.has('Ankomst') && s.has('Avgang')).length,
    canceledTrains: canceled.size,
    lateMedianMin: r1(q(late, 0.5)), late90Min: r1(q(late, 0.9)),
    trainsLate6Pct: trainLate.length ? r1(100 * trainLate.filter(m => m >= 6).length / trainLate.length) : null,
  };
}

const out = {
  file, day: sweDay(first), from: sweTime(first), to: sweTime(last), minutes: r1(minutes),
  trains: byTrain.size, atOnceMedian: q(atOnce, 0.5), atOnceMax: atOnce.length ? Math.max(...atOnce) : null,
  noSpeedPct: r1(100 * noSpeed / byTrain.size), repeatPct: r1(100 * repeats / reports),
  silences30s: gaps30, silences2min: gaps120, silences5min: gaps300, silentTimePct: r1(100 * silentMs / trainMs),
  jumps, regionPct: Object.fromEntries(Object.entries(region).map(([k, v]) => [k, r1(100 * v / reports)])),
  ...(tt ?? { timetable: false }),
};
if (argv.includes('--json')) { console.log(JSON.stringify(out)); process.exit(0); }

console.log(`${file}`);
console.log(`  ${out.day}, ${out.from}–${out.to} Swedish time, ${out.minutes} min`);
console.log(`  trains: ${out.trains} in all; at once (a report in the last 10 min): median ${out.atOnceMedian}, most ${out.atOnceMax}`);
console.log(`  reporting: ${out.noSpeedPct} % of trains never send a speed; ${out.repeatPct} % of reports repeat the last position exactly`);
console.log(`  silences (no new position): 30 s+ ${out.silences30s}, 2 min+ ${out.silences2min}, 5 min+ ${out.silences5min}; ` +
  `${out.silentTimePct} % of train time is in silences of 30 s or more`);
console.log(`  jumps (over 2 km and 300 km/h): ${out.jumps}`);
console.log(`  where the reports are: ${Object.entries(out.regionPct).map(([k, v]) => `${k} ${v} %`).join(', ')}`);
if (tt) console.log(`  timetable: ${tt.passings} passings, ${tt.realStops} real stops (arrival and departure), ${tt.canceledTrains} trains cancelled somewhere; ` +
  `minutes off timetable median ${tt.lateMedianMin}, 90 % ${tt.late90Min}; ${tt.trainsLate6Pct} % of trains 6 min or more late`);
else console.log('  timetable: none recorded');
