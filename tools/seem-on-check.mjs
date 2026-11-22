// "You seem to be on 231" (src/seem-on.js) on a recording: a phone riding a real train (fixes every 5 s from that
// train's own reports, 40 m of noise) is offered that train within a few minutes; a phone standing beside the track,
// or riding in a car beside it at another speed, is offered nothing; poor fixes are skipped. Offline, seconds.
// Run: node tools/seem-on-check.mjs [recording]
import { createSeemOn, MATCH_MS } from '../src/seem-on.js';
import { readPositions } from './lib/records.mjs';

let failed = 0;
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };
const file = process.argv[2] ?? new URL('../data/positions-2026-11-19T22-28-02-750Z.jsonl', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const recs = readPositions(file).map(r => ({ ...r, number: r.id.split('/')[0] }));
// Each train's reports in time order.
const byTrain = new Map();
for (const r of recs) { if (!byTrain.has(r.id)) byTrain.set(r.id, []); byTrain.get(r.id).push(r); }
for (const list of byTrain.values()) list.sort((a, b) => a.time - b.time);
// Where a train is at moment t (between its reports), with its bearing and speed; null outside its reports.
function at(list, t) {
  let i = list.findIndex(r => r.time > t);
  if (i <= 0) return null;
  const a = list[i - 1], b = list[i]; if (b.time - a.time > 120000) return null;
  const f = (t - a.time) / (b.time - a.time);
  return { lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f, bearing: b.bearing ?? a.bearing, speed: a.speed ?? 0 };
}
const nearAt = (t, p) => [...byTrain].map(([id, list]) => { const q = at(list, t); return q && { id, number: list[0].number, ...q }; })
  .filter(q => q && Math.abs(q.lat - p.lat) < 0.05 && Math.abs(q.lon - p.lon) < 0.1);
const noise = (p, m) => ({ ...p, lon: p.lon + (Math.random() - 0.5) * 2 * m / 111195 / Math.cos(p.lat * Math.PI / 180), lat: p.lat + (Math.random() - 0.5) * 2 * m / 111195 });

// The trains that run fast and steadily for 6 minutes somewhere in the recording.
const riders = [];
for (const [id, list] of byTrain) {
  for (let i = 0; i < list.length; i++) {
    const t0 = list[i].time, run = list.filter(r => r.time >= t0 && r.time <= t0 + 6 * 60000);
    if (run.length >= 10 && run.every(r => (r.speed ?? 0) >= 60)) { riders.push({ id, number: list[0].number, t0 }); break; }
  }
  if (riders.length >= 8) break;
}
ok(riders.length >= 3, `${riders.length} trains running fast for 6 minutes to ride on`);
let found = 0, wrong = 0;
for (const r of riders) {
  const s = createSeemOn(), list = byTrain.get(r.id); let got = null, when = null;
  for (let t = r.t0; t <= r.t0 + 6 * 60000; t += 5000) {
    const p = at(list, t); if (!p) continue;
    const o = s.feed({ t, ...noise(p, 40), accuracy: 30 }, nearAt(t, p));
    if (o && !got) { got = o; when = t - r.t0; }
  }
  if (got?.id === r.id) found++; else if (got) wrong++;
  console.log(`     on ${r.number}: ${got ? `offered ${got.number} after ${Math.round(when / 1000)} s` : 'nothing offered'}`);
}
ok(found >= Math.ceil(riders.length * 0.75) && wrong === 0, `riding: the right train offered on ${found} of ${riders.length}, a wrong one on ${wrong}`);
// Not before MATCH_MS.
{
  const r = riders[0], s = createSeemOn(), list = byTrain.get(r.id); let early = false;
  for (let t = r.t0; t < r.t0 + MATCH_MS - 5000; t += 5000) { const p = at(list, t); if (p && s.feed({ t, ...p, accuracy: 20 }, nearAt(t, p))) early = true; }
  ok(!early, `nothing offered in the first ${MATCH_MS / 1000} s`);
}
// Standing beside the track as the train passes: nothing.
{
  const r = riders[0], s = createSeemOn(), list = byTrain.get(r.id), stand = at(list, r.t0 + 3 * 60000); let any = false;
  for (let t = r.t0; t <= r.t0 + 6 * 60000; t += 5000) if (s.feed({ t, ...noise(stand, 20), accuracy: 20 }, nearAt(t, stand))) any = true;
  ok(!any, 'standing beside the track while it passes: nothing offered');
}
// A car on a road beside it at half its speed: falls behind, nothing.
{
  const r = riders[0], s = createSeemOn(), list = byTrain.get(r.id); let any = false;
  for (let t = r.t0; t <= r.t0 + 6 * 60000; t += 5000) {
    const p = at(list, r.t0 + (t - r.t0) / 2); if (!p) continue;
    if (s.feed({ t, ...p, accuracy: 20 }, nearAt(t, p))?.id === r.id) any = true;
  }
  ok(!any, 'a car beside the line at half the speed: the train not offered');
}
// Poor fixes are skipped.
{
  const r = riders[0], s = createSeemOn(), list = byTrain.get(r.id); let any = false;
  for (let t = r.t0; t <= r.t0 + 6 * 60000; t += 5000) { const p = at(list, t); if (p && s.feed({ t, ...p, accuracy: 900 }, nearAt(t, p))) any = true; }
  ok(!any, 'fixes only good to 900 m: nothing offered');
}
console.log(failed ? `${failed} failed` : 'seem-on-check: all good');
process.exit(failed ? 1 : 0);
