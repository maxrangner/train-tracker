// The shop window's tour (src/tour.js) on the rush hour of 17 Nov (the last report of each train at 16:40 Swedish
// time): the fastest train, a meeting of two trains really passing each other a little later, and when it starts.
// Offline, ~20 s (the recording is big). Run: node tools/tour-check.mjs
import { stops, meeting, shouldRun, IDLE_MS } from '../src/tour.js';
import { readPositions } from './lib/records.mjs';

let failed = 0;
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };
const file = new URL('../data/positions-2026-11-17T15-00-00-001Z.jsonl', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const T = Date.parse('2026-11-17T16:40:00+01:00');
const recs = readPositions(file, line => line.includes('"Speed"'));
const latest = new Map();
for (const r of recs) if (r.time <= T && r.time > T - 120000) latest.set(r.id, { ...r, number: r.id.split('/')[0], late: null });
const trains = [...latest.values()];
ok(trains.length > 200, `${trains.length} trains with a report in the 2 minutes before 16:40`);
const s = stops(trains, [{ id: 'x', header: 'Växelfel', place: { lon: 13.1, lat: 55.65 } }]);
const fastest = s.find(x => x.kind === 'fastest');
ok(fastest && fastest.value === Math.max(...trains.map(x => x.speed ?? 0)), `fastest stop: ${fastest?.train.number} at ${fastest?.value} km/h`);
ok(s.some(x => x.kind === 'disruption'), 'a disruption stop');
const m = meeting(trains);
ok(m, m ? `a meeting: ${m.a.number} and ${m.b.number}, in about ${Math.round(m.secs)} s` : 'no meeting found');
// Did they really pass? Their distance over the next minutes from their own later reports.
if (m) {
  const later = id => recs.filter(r => r.id === id && r.time > T && r.time < T + 10 * 60000);
  const A = later(m.a.id), B = later(m.b.id);
  const km = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 111.2;
  let min = Infinity; for (const a of A) for (const b of B) if (Math.abs(a.time - b.time) < 30000) min = Math.min(min, km(a, b));
  ok(min < 2, `they came within ${min.toFixed(2)} km of each other in the next 10 minutes (their own reports)`);
}
ok(!shouldRun({ sideways: true, charging: null, lastTouch: T, now: T + IDLE_MS - 1, enabled: true, busy: false }), 'not before 30 s without a touch');
ok(shouldRun({ sideways: true, charging: null, lastTouch: T, now: T + IDLE_MS, enabled: true, busy: false }), 'sideways, 30 s untouched: runs');
ok(shouldRun({ sideways: false, charging: true, lastTouch: T, now: T + IDLE_MS, enabled: true, busy: false }), 'upright on a charger: runs');
ok(!shouldRun({ sideways: false, charging: null, lastTouch: T, now: T + IDLE_MS * 9, enabled: true, busy: false }), 'upright, charging not known: never');
ok(!shouldRun({ sideways: true, charging: null, lastTouch: T, now: T + IDLE_MS, enabled: false, busy: false }), 'switched off in Settings: never');
ok(!shouldRun({ sideways: true, charging: null, lastTouch: T, now: T + IDLE_MS, enabled: true, busy: true }), 'a sheet up or the search open: not');
console.log(failed ? `${failed} failed` : 'tour-check: all good');
process.exit(failed ? 1 : 0);
