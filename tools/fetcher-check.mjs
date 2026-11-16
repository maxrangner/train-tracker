// Replays recordings through the fetcher's memory and files (fetcher/state.mjs, fetcher/files.mjs) and checks that
// what a page reads back from the files is what Trafikverket sent: every train, every passing, nearly every position
// report (a file every 5 s keeps a train's latest report only), and the rows unchanged (positions to ~1 m).
// Needs no key and no internet, so it runs anywhere the fetcher will (also on Linux, public-plan step 2).
// Run: node tools/fetcher-check.mjs [recording names...]   (default: the core recordings, tools/recordings.json)
// Exit code 0: all good; 1: something failed.
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { toRecord } from '../src/trains-source.js';
import { passingsOf, trainKey } from '../src/trafikverket.js';
import { trainOf, passingOf } from '../src/live-file.js';
import { swedishDay } from '../src/clock.js';
import { createState } from '../fetcher/state.mjs';
import { buildLive, buildPassings, buildPlanned, LIVE_MS } from '../fetcher/files.mjs';

const MIN = 60000;
const given = process.argv.slice(2).filter(a => !a.startsWith('--'));
const names = given.length ? given : JSON.parse(readFileSync('tools/recordings.json', 'utf8')).slots.map(s => s.core).filter(Boolean);
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const kb = n => (n / 1024).toFixed(1);
const gz = o => gzipSync(JSON.stringify(o), { level: 6 }).length;
const lines = f => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

let failed = false;
// This computer's time zone data: Swedish days must come out right (Node built without full ICU would not).
const icu = swedishDay(Date.UTC(2026, 10, 15, 23, 30)) === '2026-11-16' && swedishDay(Date.UTC(2026, 6, 1, 21, 30)) === '2026-07-01';
console.log(`${icu ? 'ok  ' : 'FAIL'} Swedish dates (time zone data in this Node: ${process.version}, ${process.platform})`);
if (!icu) failed = true;

for (const name of names) {
  const pos = lines(`data/positions-${name}.jsonl`), tt = lines(`data/timetable-${name}.jsonl`);
  if (!pos.length) { console.log(`skip ${name}: no recording in data/`); continue; }
  const events = [...pos.map(p => ['p', Date.parse(p.got), p]), ...tt.map(a => ['t', Date.parse(a.got), a])].sort((a, b) => a[1] - b[1]);
  const state = createState();
  const sent = new Map(), shown = new Set(), trainsSent = new Set(), trainsShown = new Set();
  const passSent = new Set(), passShown = new Set();
  const size = { live: [], passings: [], planned: [] };
  let roundTripBad = 0, roundTripChecked = 0, next = null, nextMin = null, nextPlanned = null;

  const fileTime = t => {
    const live = buildLive(state, t, {});
    size.live.push(gz(live));
    for (const row of live.trains) {
      const r = trainOf(row, t);
      shown.add(`${r.id}|${r.time}`); trainsShown.add(r.id);
      const orig = sent.get(`${r.id}|${r.time}`);
      if (orig) {
        roundTripChecked++;
        const same = ['id', 'operational', 'date', 'number', 'speed', 'bearing', 'time', 'gone'].every(k => r[k] === orig[k])
          && Math.abs(r.lon - orig.lon) <= 5.1e-6 && Math.abs(r.lat - orig.lat) <= 5.1e-6;
        if (!same) { if (roundTripBad < 3) console.log('  differs:', JSON.stringify(orig), JSON.stringify(r)); roundTripBad++; }
      }
    }
    for (const row of live.passings) { const p = passingOf(row); passShown.add(`${p.key}|${p.station}|${p.activity}|${p.time}`); }
    if (t >= nextMin) { size.passings.push(gz(buildPassings(state, t))); nextMin += MIN; }
    if (t >= nextPlanned) { size.planned.push(gz(buildPlanned(state, t, state.trains(t).map(r => r.id), t - 4 * 60 * MIN))); nextPlanned += 10 * MIN; }
  };

  for (const [kind, got, x] of events) {
    if (next === null) { next = (Math.floor(got / LIVE_MS) + 1) * LIVE_MS + 50; nextMin = got + MIN; nextPlanned = got + 2 * MIN; }
    while (got >= next) { fileTime(next); next += LIVE_MS; }
    if (kind === 'p') {
      const r = toRecord(x);
      if (!r) continue;
      state.addRecords([r], got);
      if (x.via !== 'start') { sent.set(`${r.id}|${r.time}`, r); trainsSent.add(r.id); }
    } else {
      const list = passingsOf([x]);
      state.addPassings(list, got, { first: x.via === 'start' });
      if (x.via !== 'start') for (const p of list) passSent.add(`${p.key}|${p.station}|${p.activity}|${p.time}`);
      if (!x.Deleted && x.AdvertisedTimeAtLocation && x.OperationalTrainNumber)
        state.addPlanned([{ key: trainKey(x.OperationalTrainNumber, x.ScheduledDepartureDateTime), sig: x.LocationSignature,
          activity: x.ActivityType, planned: Date.parse(x.AdvertisedTimeAtLocation), brand: x.ProductInformation?.[0]?.Description ?? null }], got);
    }
  }
  fileTime(next);   // the last reports get their file too

  const share = (a, b) => b.size ? [...b.keys()].filter(k => a.has(k)).length / b.size : 1;
  const reports = share(shown, sent), trains = share(trainsShown, trainsSent), pass = share(passShown, passSent);
  const ok = trains === 1 && pass === 1 && reports >= 0.995 && roundTripBad === 0;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: trains ${(100 * trains).toFixed(1)} % of ${trainsSent.size}, position reports ${(100 * reports).toFixed(2)} % of ${sent.size}, ` +
    `passings ${(100 * pass).toFixed(1)} % of ${passSent.size}, rows read back unchanged ${roundTripChecked - roundTripBad}/${roundTripChecked}`);
  console.log(`     sizes (gzip): live median ${kb(pct(size.live, .5))} kB, max ${kb(Math.max(...size.live))} kB; ` +
    `passings median ${kb(pct(size.passings, .5))} kB, max ${kb(Math.max(0, ...size.passings))} kB; planned median ${kb(pct(size.planned, .5))} kB, max ${kb(Math.max(0, ...size.planned))} kB`);
}
console.log(failed ? 'fetcher check FAILED' : 'fetcher check ok');
process.exit(failed ? 1 : 0);
