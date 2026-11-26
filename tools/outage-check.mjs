// The fetcher's timetable stream (fetcher/timetable.mjs on src/trafikverket.js follow) against a pretend Trafikverket,
// on a clock running 100 times faster (batch 2, 2026-11-19): Trafikverket unreachable for 20 minutes, then back.
//   - while every question fails, the fallback asks less and less often (TODO 28: it asked every 10 s);
//   - when answers come again after more than 15 minutes, today is loaded again (TODO 31: only a break at the start
//     reloaded; a later one lost the changes before the last 15 minutes until 03:30).
// About 15 s, offline. Run: node tools/outage-check.mjs     exit code 0: both hold; 1: not.
const SPEED = 100, MIN = 60000;
const realNow = Date.now.bind(Date), realSetTimeout = globalThis.setTimeout, realSetInterval = globalThis.setInterval;
const t0 = realNow();
Date.now = () => t0 + (realNow() - t0) * SPEED;
globalThis.setTimeout = (fn, ms = 0, ...a) => realSetTimeout(fn, ms / SPEED, ...a);
globalThis.setInterval = (fn, ms = 0, ...a) => realSetInterval(fn, ms / SPEED, ...a);
const at = () => (Date.now() - t0) / MIN;   // minutes since the start, on the fast clock

const OUT_FROM = 2, OUT_TO = 22;   // Trafikverket unreachable from minute 2 to minute 22
const asks = [];                   // { min, kind, ok }
let failedOnce = false;
globalThis.fetch = async (url, opts = {}) => {
  const body = String(opts.body ?? '');
  const kind = body.includes('changeid=') ? 'changes' : body.includes('TrainStationMessage') ? 'messages' : 'day';
  // The first day question after the outage fails too (Trafikverket still flaky): it must be asked again (until
  // 2026-11-24 the reload was dropped then until 03:30; the hang review, finding 6).
  const flaky = kind === 'day' && at() >= OUT_TO && !failedOnce;
  if (flaky) failedOnce = true;
  const down = flaky || (at() >= OUT_FROM && at() < OUT_TO);
  asks.push({ min: at(), kind, ok: !down, day: /ScheduledDepartureDateTime" value="([\d-]+)"/.exec(body)?.[1] });
  if (down) throw new TypeError('fetch failed');
  const result = kind === 'changes' ? { TrainAnnouncement: [], INFO: { LASTCHANGEID: String(asks.length), SSEURL: 'https://api.trafikinfo.trafikverket.se/v2/data.json?ssl=1' } }
    : kind === 'messages' ? { TrainStationMessage: [] } : { TrainAnnouncement: [] };
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ RESPONSE: { RESULT: [result] } }), text: async () => '' };
};
// A stream that opens and never sends anything (the fetcher reopens it after 3 minutes of silence); while Trafikverket
// is down it closes at once.
globalThis.EventSource = class {
  static CLOSED = 2;
  constructor() {
    this.readyState = 0;
    realSetTimeout(() => {
      if (at() >= OUT_FROM && at() < OUT_TO) { this.readyState = 2; this.onerror?.(); } else { this.readyState = 1; this.onopen?.(); }
    }, 5);
  }
  close() { this.readyState = 2; }
};

const { createTimetable } = await import('../fetcher/timetable.mjs');
const { setKey } = await import('../src/trafikverket.js');
setKey('pretend');
const logs = [];
const tt = createTimetable({ log: m => logs.push({ min: at(), m }) });
await new Promise(r => realSetTimeout(r, 26 * MIN / SPEED));
tt.stop();

let failed = 0;
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };
const during = asks.filter(a => a.kind === 'changes' && a.min >= OUT_FROM + 1 && a.min < OUT_TO);
ok(during.length <= 40, `20 minutes without Trafikverket: ${during.length} questions from the changes stream (asked every 10 s: about 120)`);
const reload = logs.find(l => /changes missed/.test(l.m) && l.min >= OUT_TO);
ok(Boolean(reload), `back after 20 minutes: today loaded again${reload ? ` ("${reload.m}" at minute ${reload.min.toFixed(1)})` : ' (not done)'}`);
const after = asks.filter(a => a.kind === 'changes' && a.min >= OUT_TO && a.ok);
ok(after.length > 0 && after[0].min - OUT_TO < 1.5, `back to normal soon after: first answered question ${after.length ? `${(after[0].min - OUT_TO).toFixed(1)} min after` : 'never'}`);
const dayAfter = asks.filter(a => a.kind === 'day' && a.min >= OUT_TO), lost = dayAfter[0];
ok(lost && !lost.ok && dayAfter.slice(1).some(a => a.ok && a.day === lost.day), `the reload failing once is tried again: ${lost ? `${lost.day} failed, then ${dayAfter.slice(1).filter(a => a.day === lost.day).map(a => (a.ok ? 'ok' : 'failed')).join(', ') || 'never asked again'}` : 'no day question after the outage'}`);
console.log(failed ? 'outage-check FAILED' : 'outage-check ok');
process.exit(failed ? 1 : 0);
