// Measure a recording from collect.mjs.
// Run: node tools/measure.mjs [file]   (default: the newest data/positions-*.jsonl)
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../data/', import.meta.url);
const file = process.argv[2] ?? new URL(readdirSync(dir).filter(f => f.startsWith('positions-')).sort().at(-1), dir);
const rows = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));

const pct = (a, q) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const fmt = (a, unit) => `median ${pct(a, .5).toFixed(1)}${unit}, 90% under ${pct(a, .9).toFixed(1)}${unit}, max ${Math.max(...a).toFixed(1)}${unit} (n=${a.length})`;
const lonlat = p => p.Position.WGS84.match(/POINT \(([-\d.]+) ([-\d.]+)/).slice(1).map(Number);
const metres = ([lo1, la1], [lo2, la2]) => {
  const r = Math.PI / 180, x = (lo2 - lo1) * r * Math.cos((la1 + la2) / 2 * r), y = (la2 - la1) * r;
  return Math.hypot(x, y) * 6371000;
};

const stream = rows.filter(r => r.via === 'stream');
const t0 = Date.parse(rows[0].got), t1 = Date.parse(rows.at(-1).got);
console.log(`file: ${file.pathname ?? file}`);
console.log(`recorded: ${((t1 - t0) / 60000).toFixed(1)} min, ${rows.length} positions (${stream.length} from the stream)`);

// How old a position is when it reaches us.
console.log(`age on arrival (stream): ${fmt(stream.map(r => (Date.parse(r.got) - Date.parse(r.TimeStamp)) / 1000), ' s')}`);

// Per train.
const byTrain = new Map();
for (const r of rows) {
  const id = r.Train.OperationalTrainNumber + '/' + r.Train.OperationalTrainDepartureDate;
  if (!byTrain.has(id)) byTrain.set(id, []);
  byTrain.get(id).push(r);
}
const advertisedDiffers = [...byTrain.values()].filter(rs => rs[0].Train.AdvertisedTrainNumber && rs[0].Train.AdvertisedTrainNumber !== rs[0].Train.OperationalTrainNumber).length;
const noAdvertised = [...byTrain.values()].filter(rs => !rs[0].Train.AdvertisedTrainNumber).length;
console.log(`trains: ${byTrain.size} (no passenger-facing number: ${noAdvertised}; board number differs from internal: ${advertisedDiffers})`);

const gaps = [], jumps = [], speedErr = [], dupes = [];
let stoppedNow = 0, movingNow = 0;
for (const rs of byTrain.values()) {
  rs.sort((a, b) => Date.parse(a.TimeStamp) - Date.parse(b.TimeStamp));
  const last = rs.at(-1);
  (last.Speed > 0 ? movingNow++ : stoppedNow++);
  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1], b = rs[i];
    const dt = (Date.parse(b.TimeStamp) - Date.parse(a.TimeStamp)) / 1000;
    if (dt === 0) { dupes.push(1); continue; }
    const d = metres(lonlat(a), lonlat(b));
    gaps.push(dt);
    jumps.push(d);
    const v = d / dt * 3.6, reported = (a.Speed + b.Speed) / 2;
    if (dt <= 30 && reported > 10) speedErr.push(Math.abs(v - reported));
  }
}
console.log(`time between one train's reports: ${fmt(gaps, ' s')}`);
console.log(`distance between one train's reports: ${fmt(jumps, ' m')}`);
console.log(`reported speed vs speed from the two positions (moving trains, gaps up to 30 s): off by ${fmt(speedErr, ' km/h')}`);
console.log(`repeated reports (same time): ${dupes.length}`);
console.log(`at the end: ${movingNow} moving, ${stoppedNow} standing (speed 0)`);

// Trains that went quiet: last report more than 2 minutes before the recording ended.
const quiet = [...byTrain.values()].filter(rs => t1 - Date.parse(rs.at(-1).TimeStamp) > 120000).length;
console.log(`trains silent for the last 2+ min of the recording: ${quiet}`);
