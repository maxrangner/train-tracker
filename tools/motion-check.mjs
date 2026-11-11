// How smoothly are the trains drawn? Replays a recording (tools/collect.mjs) through the page's own src/trains.js,
// feeding each report in when it arrived, and steps the drawing clock like the page does. Counts, for trains that
// are really moving (worked out afterwards from all their reports):
//   - frozen: drawn standing still (waiting for a report that hasn't arrived, or held before a jump)
//   - backwards: the drawn movement turns more than 120° from one moment to the next
//   - nose off: the 3D model's heading (the latest report's Bearing) more than 45° from the drawn movement
// Run: node tools/motion-check.mjs [recording.jsonl] [--delay 15]
import { readFileSync, readdirSync } from 'node:fs';
import { createTrains } from '../src/trains.js';

const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? Number(argv[i + 1]) : def; };
const DELAY = flag('delay', 15) * 1000;
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

const metres = (a, b) => {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371000;
};
const heading = (a, b) => (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI + 360) % 360;
const angle = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// The truth, from every report a train sent: its real speed at time t (km/h), from the two reports around t.
const all = new Map();
for (const r of recs) if (!r.gone) (all.get(r.id) ?? all.set(r.id, []).get(r.id)).push(r);
for (const h of all.values()) h.sort((a, b) => a.time - b.time);
function realKmh(id, t) {
  const h = all.get(id);
  let i = h.findIndex(r => r.time > t);
  if (i <= 0) return null;
  const a = h[i - 1], b = h[i];
  const kmh = metres(a, b) / ((b.time - a.time) / 1000) * 3.6;
  return kmh > 300 ? null : kmh;   // a position jump: not counted
}

const trains = createTrains();
const start = recs.find(r => r.got - recs[0].got > 60_000).got;   // skip the first minute (the start batch)
const end = recs.at(-1).got;
let k = 0;
while (recs[k].got < start) k++;
trains.update(recs.slice(0, k), start);

const prev = new Map();   // id -> { p, dir }
const s = { moving: 0, frozen: 0, backwards: 0, noseFrames: 0, noseOff: 0, noseFlip: 0, freezes: 0, freezeLens: [], why: {}, turns: [] };
const frozenRun = new Map();
for (let T = start; T < end; T += STEP) {
  const batch = [];
  while (k < recs.length && recs[k].got <= T) batch.push(recs[k++]);
  if (batch.length) trains.update(batch, T);
  const t = T - DELAY;
  for (const tr of trains.placedAt(t)) {
    const kmh = realKmh(tr.id, t);
    const last = prev.get(tr.id);
    const now = { p: tr, dir: null, bearing: tr.bearing, lastDir: last?.lastDir ?? null };
    if (last) {
      const d = metres(last.p, tr);
      if (d > 0.05) now.dir = now.lastDir = heading(last.p, tr);
      if (kmh !== null && kmh > 15) {
        s.moving++;
        if (d < 0.05) {
          s.frozen++;
          // Why: no report after t has arrived yet (waiting), or the two reports around t are a jump, or the same place.
          const h = all.get(tr.id);
          const nextArrived = h.find(r => r.time > t && r.got <= T);
          const why = !nextArrived ? 'waiting' : (() => {
            const a = h.filter(r => r.time <= t).at(-1);
            if (!a) return 'before first';
            const dd = metres(a, nextArrived);
            return dd < 1 ? 'same place' : dd / ((nextArrived.time - a.time) / 1000) * 3.6 > 300 ? 'jump' : 'other';
          })();
          s.why[why] = (s.why[why] ?? 0) + 1;
          frozenRun.set(tr.id, (frozenRun.get(tr.id) ?? 0) + 1);
        } else {
          const run = frozenRun.get(tr.id);
          if (run >= 5) { s.freezes++; s.freezeLens.push(run * STEP / 1000); }   // half a second or more
          frozenRun.delete(tr.id);
          if (last.lastDir !== null) {
            const turn = angle(last.lastDir, now.dir);
            if (turn > 120) s.backwards++;
            if (turn > 30) s.turns.push({ id: tr.id, turn: Math.round(turn), kmh: Math.round(kmh), at: new Date(t).toISOString().slice(11, 19) });
          }
          if (tr.bearing !== null) {
            s.noseFrames++;
            if (angle(tr.bearing, now.dir) > 45) s.noseOff++;
          }
        }
        if (last.bearing !== null && tr.bearing !== null && angle(last.bearing, tr.bearing) > 90) s.noseFlip++;
      }
    }
    prev.set(tr.id, now);
  }
}

const pct = (a, b) => `${(100 * a / b).toFixed(1)} %`;
const q = (arr, f) => { const x = [...arr].sort((a, b) => a - b); return x[Math.floor(f * (x.length - 1))]; };
const minutes = (end - start) / 60000;
console.log(`${file}, ${minutes.toFixed(1)} minutes, drawn ${DELAY / 1000} s behind, every ${STEP} ms`);
console.log(`moving train-moments: ${s.moving}`);
console.log(`frozen while really moving: ${pct(s.frozen, s.moving)}`);
console.log(`stops of 0.5 s or more while really moving: ${s.freezes} (${(s.freezes / minutes).toFixed(0)} a minute across the map); ` +
  `length median ${q(s.freezeLens, 0.5)} s, 90 % ${q(s.freezeLens, 0.9)} s, longest ${q(s.freezeLens, 1)} s`);
console.log('why frozen:', Object.entries(s.why).map(([w, n]) => `${w} ${pct(n, s.frozen)}`).join(', '));
console.log(`drawn movement turning back (>120°): ${s.backwards} times; turning more than 30° in one step: ${s.turns.length} ` +
  `(${new Set(s.turns.map(x => x.id)).size} trains); 60°+: ${s.turns.filter(x => x.turn > 60).length}`);
{
  // Reports that moved more than 20 m against the direction the train itself reports (Bearing): noise.
  let against = 0, pairs = 0;
  for (const h of all.values()) for (let i = 1; i < h.length; i++) {
    const a = h[i - 1], b = h[i];
    if (b.bearing === null || metres(a, b) < 20) continue;
    pairs++;
    if (angle(heading(a, b), b.bearing) > 120) against++;
  }
  console.log(`report pairs moving 20 m or more: ${pairs}; against the train's own bearing: ${against} (${pct(against, pairs)})`);
}
console.log('  e.g.', s.turns.filter(x => x.turn > 60).slice(0, 8).map(x => `${x.id} ${x.turn}° at ${x.kmh} km/h ${x.at}`).join('; '));
console.log(`3D nose more than 45° off the drawn movement: ${pct(s.noseOff, s.noseFrames)}`);
console.log(`3D nose turning more than 90° in one step: ${s.noseFlip}`);
