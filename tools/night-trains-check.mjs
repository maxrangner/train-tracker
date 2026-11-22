// Trains still running from the day before keep all their stops in the fetcher's memory (the code review of 2026-11-21,
// finding 2: yesterday's rows were cut to the last 6 hours one by one, so a night train's card and green route started
// mid-trip). The saved day of 17 Nov (data/measure/day-2026-11-17.json, every row of trains that started that day)
// served by a pretend Trafikverket; the fetcher's timetable (fetcher/timetable.mjs) started at 06:00 on 18 Nov and
// on 17 Nov at 23:00, then run past midnight to 06:00 on 18 Nov, on a clock 2000 times faster. Each train of 17 Nov with a
// stop planned after midnight must have every row of the saved day; trains that ended before 00:00 on 18 Nov (6 hours
// before) none. About 20 s, offline. Run: node tools/night-trains-check.mjs     exit code 0: all hold.
import { readFileSync } from 'node:fs';

const SPEED = 2000, MIN = 60000, HOUR = 60 * MIN;
const realNow = Date.now.bind(Date), realSetTimeout = globalThis.setTimeout, realSetInterval = globalThis.setInterval;
let start = Date.parse('2026-11-18T06:00:00+01:00'), t0 = realNow();
Date.now = () => start + (realNow() - t0) * SPEED;
const setClock = (at) => { start = at; t0 = realNow(); };
globalThis.setTimeout = (fn, ms = 0, ...a) => realSetTimeout(fn, ms / SPEED, ...a);
globalThis.setInterval = (fn, ms = 0, ...a) => realSetInterval(fn, ms / SPEED, ...a);
const sleep = ms => new Promise(r => realSetTimeout(r, ms));

const DAY = JSON.parse(readFileSync(new URL('../data/measure/day-2026-11-17.json', import.meta.url), 'utf8'));
const pick = (xml, name) => new RegExp(`name="${name}" value="([^"]+)"`).exec(xml)?.[1];
globalThis.fetch = async (url, opts = {}) => {
  const body = String(opts.body ?? '');
  let result;
  if (body.includes('changeid=')) result = { TrainAnnouncement: [], INFO: { LASTCHANGEID: '1', SSEURL: 'https://api.trafikinfo.trafikverket.se/v2/data.json?ssl=1' } };
  else if (body.includes('TrainStationMessage')) result = { TrainStationMessage: [] };
  else {
    const day = pick(body, 'ScheduledDepartureDateTime'), from = Date.parse(pick(body, 'AdvertisedTimeAtLocation')), to = Date.parse(/<LT name="AdvertisedTimeAtLocation" value="([^"]+)"/.exec(body)?.[1]);
    result = { TrainAnnouncement: day === '2026-11-17' ? DAY.filter(a => { const p = Date.parse(a.AdvertisedTimeAtLocation); return p >= from && p < to; }) : [] };
  }
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ RESPONSE: { RESULT: [result] } }), text: async () => '' };
};
globalThis.EventSource = class { static CLOSED = 2; constructor() { this.readyState = 1; } close() { this.readyState = 2; } };

const { createTimetable } = await import('../fetcher/timetable.mjs');
const { groupOf } = await import('../src/tap-files.js');

// The saved day per public train: its rows, and its last planned time.
// The saved day's rows per train (public number; a number can be used twice in a day, e.g. 1165 at 00:35 and from
// 21:48: judged by the rows' times below).
const byTrain = new Map();
for (const a of DAY) {
  const n = a.AdvertisedTrainIdent || a.OperationalTrainNumber;
  if (!byTrain.has(n)) byTrain.set(n, []);
  byTrain.get(n).push(Date.parse(a.AdvertisedTimeAtLocation));
}

const fails = [], notes = [];
// At the moment judged: a train with a stop planned less than 6 h ago is still running and must have every row of the
// last 24 hours; one whose last stop was more than 6 h 10 min ago must be gone.
function judge(name, tt) {
  const now = Date.now();
  const night = [], ended = [];
  for (const [n, times] of byTrain) {
    const last = Math.max(...times);
    if (last >= now - 6 * HOUR && Math.min(...times) < Date.parse('2026-11-18T00:00:00+01:00')) night.push(n);
    else if (last < now - 6 * HOUR - 10 * MIN) ended.push(n);
  }
  const want = n => byTrain.get(n).filter(p => p >= now - 24 * HOUR).length;
  const cards = new Map();
  const count = n => {
    const g = groupOf(n);
    if (!cards.has(g)) cards.set(g, tt.card(g, now));
    return cards.get(g).r.filter(r => (r[1] || r[0]) === n).length;
  };
  const short = night.filter(n => count(n) < want(n));
  const kept = ended.filter(n => count(n) > 0);
  const at = new Date(now).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' });
  if (short.length) fails.push(`${name} (judged ${at}): ${short.length} of ${night.length} trains still running miss stops (${short.slice(0, 6).map(n => `${n} ${count(n)}/${want(n)}`).join(', ')})`);
  else notes.push(`${name} (judged ${at}): all ${night.length} trains from 17 Nov still running have every stop (${night.slice(0, 6).join(', ')}, …)`);
  if (kept.length) fails.push(`${name}: ${kept.length} trains that ended over 6 h before are still kept (${kept.slice(0, 5).join(', ')})`);
  else notes.push(`${name}: none of the ${ended.length} trains that ended over 6 h before kept`);
}
const log = () => {};

// A. Started at 06:00 on 18 Nov (yesterday loaded at the start).
let tt = createTimetable({ log });
// (today loads first, so the tap files come as soon as before; yesterday next, and every file is made again when it is in)
for (let i = 0; i < 400 && !(tt.ready() && tt.stats().days.includes('2026-11-17')); i++) await sleep(25);
judge('started at 06:00', tt);
tt.stop();

// B. Started at 23:00 on 17 Nov, run to 06:00 on 18 Nov (the day turns while it runs).
setClock(Date.parse('2026-11-17T23:00:00+01:00'));
tt = createTimetable({ log });
for (let i = 0; i < 400 && !tt.ready(); i++) await sleep(25);
while (Date.now() < Date.parse('2026-11-18T06:02:00+01:00')) await sleep(50);
judge('running across midnight, at 06:02', tt);
tt.stop();

for (const n of notes) console.log(`ok   ${n}`);
for (const f of fails) console.log(`FAIL ${f}`);
console.log(fails.length ? `night-trains-check FAILED (${fails.length})` : 'night-trains-check ok');
process.exit(fails.length ? 1 : 0);
