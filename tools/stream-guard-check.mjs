// An answer with an odd row must not stop a feed (the code review of 2026-11-21, finding 9): against a pretend
// Trafikverket, offline, under a second.
//   1. positions: a first answer with one row missing its departure date: the other rows come, nothing crashes.
//   2. passings: the same with a row missing ScheduledDepartureDateTime.
//   3. a reader that throws on the first answer: skipped, the stream still opens and its next message is read.
// Before 2026-11-22 case 3 was an unhandled rejection (the fetcher exited; the page's feed stopped until a reload).
// Run: node tools/stream-guard-check.mjs     exit code 0: all hold.
const fails = [], notes = [];
let unhandled = null;
process.on('unhandledRejection', e => { unhandled = e; });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let answer = null;                  // what the next question gets: { ...RESULT }
const streams = [];
globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '',
  json: async () => ({ RESPONSE: { RESULT: [{ ...answer, INFO: { LASTCHANGEID: '1', SSEURL: 'https://api.trafikinfo.trafikverket.se/v2/data.json?ssl=1' } }] } }) });
globalThis.EventSource = class {
  static CLOSED = 2;
  constructor() { this.readyState = 1; streams.push(this); setTimeout(() => this.onopen?.(), 1); }
  close() { this.readyState = 2; }
};
const quiet = console.error;
const said = [];
console.error = (...a) => said.push(a.join(' '));

const { follow, followPassings } = await import('../src/trafikverket.js');
const { followPositions } = await import('../src/trains-source.js');
const now = new Date().toISOString(), day = now.slice(0, 10);

// 1. positions
answer = { TrainPosition: [
  { Train: { OperationalTrainNumber: '1', OperationalTrainDepartureDate: `${day}T00:00:00` }, Position: { WGS84: 'POINT (18 59)' }, TimeStamp: now, Status: { Active: true } },
  { Train: { OperationalTrainNumber: '2' }, Position: { WGS84: 'POINT (18 59)' }, TimeStamp: now, Status: { Active: true } },
  { Train: { OperationalTrainNumber: '3', OperationalTrainDepartureDate: `${day}T00:00:00` }, Position: { WGS84: 'POINT (17 58)' }, TimeStamp: now, Status: { Active: true } },
] };
let got = [];
let stop = followPositions({ onRecords: r => got.push(...r), onStatus: () => {} });
await sleep(50); stop();
if (got.map(r => r.operational).join() === '1,3') notes.push('positions: the row without a date skipped, the other two read');
else fails.push(`positions: read ${JSON.stringify(got.map(r => r.operational))} (want 1,3)`);

// 2. passings
answer = { TrainAnnouncement: [
  { OperationalTrainNumber: '1', ScheduledDepartureDateTime: `${day}T00:00:00`, LocationSignature: 'Cst', AdvertisedTimeAtLocation: now, TimeAtLocation: now, ActivityType: 'Avgang' },
  { OperationalTrainNumber: '2', LocationSignature: 'Cst', AdvertisedTimeAtLocation: now, TimeAtLocation: now, ActivityType: 'Avgang' },
] };
got = [];
stop = followPassings({ onPassings: l => got.push(...l), onStatus: () => {} });
await sleep(50); stop();
if (got.length === 1) notes.push('passings: the row without a date skipped, the other read');
else fails.push(`passings: read ${got.length} (want 1)`);

// 3. a reader that throws on the first answer
answer = { TrainAnnouncement: [] };
const seen = [];
const before = streams.length;
stop = follow({ makeQuery: () => '<QUERY/>', onStatus: () => {},
  onResult: (r, { first = false } = {}) => { if (first) throw new Error('an odd row'); seen.push(r); } });
await sleep(50);
const es = streams[before];
es?.onmessage?.({ data: JSON.stringify({ RESPONSE: { RESULT: [{ TrainAnnouncement: [{}] }] } }), lastEventId: '2' });
await sleep(10); stop();
if (unhandled) fails.push(`a reader that throws: unhandled (${unhandled.message})`);
else if (!es) fails.push('a reader that throws: the stream was never opened');
else if (seen.length !== 1) fails.push(`a reader that throws: the stream's next message was not read (${seen.length})`);
else notes.push('a reader that throws on the first answer: skipped and said, the stream opened and its next message read');
if (!said.some(s => s.includes('an odd row'))) fails.push('the skipped answer was not said in the console');

console.error = quiet;
for (const n of notes) console.log(`ok   ${n}`);
for (const f of fails) console.log(`FAIL ${f}`);
console.log(fails.length ? `stream-guard-check FAILED (${fails.length})` : 'stream-guard-check ok: an odd row stops no feed');
process.exit(fails.length ? 1 : 0);
