// The station boards made from files, end to end and offline (batch 2, 2026-11-19; Codex's beta review point 2): a saved
// day's timetable (data/measure/day-*.json) goes into the fetcher's own timetable (fetcher/timetable.mjs, seeded, no
// network); its board files are made every 15 minutes from 05:00 to 22:00 and read back by the page's own code
// (src/files-source.js filesTapAsker + src/trafikverket.js fetchBoard) 25 minutes later (a file's usual age at most),
// for every station-direction with 150 trains or more that day, at 4, 12 and 40 rows. Each board must get as many trains as there
// are to show (up to n), counted from the whole day with the same rule (boardGone).
// The saved day holds each row as it was when saved: a time still to come at the moment checked counts as an
// estimate, as a page would have had one.
// Run: node tools/board-check.mjs     exit code 0: every board full; 1: some short; skipped without a saved day.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createTimetable } from '../fetcher/timetable.mjs';
import { setTapAsker, fetchBoard, boardGone } from '../src/trafikverket.js';
import { filesTapAsker } from '../src/files-source.js';
import { groupOf, BOARD_BACK_MS } from '../src/tap-files.js';

const file = existsSync('data/measure') && readdirSync('data/measure').filter(n => /^day-.*\.json$/.test(n)).sort().at(-1);
if (!file) { console.log('board-check: no saved day (data/measure/day-*.json): skipped'); process.exit(0); }
const raw = JSON.parse(readFileSync(`data/measure/${file}`, 'utf8')).filter(a => a.AdvertisedTimeAtLocation && a.LocationSignature);
const day = file.slice(4, 14);
const days = [...new Set(raw.map(a => (a.ScheduledDepartureDateTime ?? '').slice(0, 10)))];
const tt = createTimetable({ log: () => {}, seed: { days, rows: raw } });

// Every station-direction with at least 150 advertised rows that day (the old rule fell short at e.g. Norrköping, Linköping
// and Hallsberg in the evening rush, not at the busiest).
const P = a => Date.parse(a.AdvertisedTimeAtLocation);
const count = new Map();
for (const a of raw) if (a.Advertised && !a.Deleted) { const k = `${a.LocationSignature}|${a.ActivityType}`; count.set(k, (count.get(k) ?? 0) + 1); }
const busiest = [...count].filter(([, n]) => n >= 150).map(([k]) => k.split('|'));
const plain = a => ({ planned: P(a), estimated: a.EstimatedTimeAtLocation ? Date.parse(a.EstimatedTimeAtLocation) : null,
  actual: a.TimeAtLocation ? Date.parse(a.TimeAtLocation) : null, canceled: a.Canceled === true });

const start = Date.parse(`${day}T00:00:00+01:00`);
let boards = 0, short = 0;
const examples = [];
for (let h = 5; h < 22; h += 0.25) {
  const made = start + h * 3600e3, read = made + 25 * 60000;
  const files = new Map();   // board-NN -> the file made at `made`
  setTapAsker(filesTapAsker(async (kind) => {
    if (!kind.startsWith('board-')) return null;
    if (!files.has(kind)) files.set(kind, { v: 1, ...tt.board(kind.slice(6), made) });
    return files.get(kind);
  }, () => read));
  for (const [sig, act] of busiest) {
    const there = raw.filter(a => a.LocationSignature === sig && a.ActivityType === act && a.Advertised && !a.Deleted
      && P(a) > read - BOARD_BACK_MS && !boardGone(plain(a), read)).length;
    for (const n of [4, 12, 40]) {
      const got = (await fetchBoard(sig, act, read, n)).length;
      boards++;
      if (got < Math.min(n, there)) { short++; if (examples.length < 6) examples.push(`${sig} ${act} ${new Date(made).toISOString().slice(11, 16)}Z n=${n}: ${got} of ${Math.min(n, there)}`); }
    }
  }
}
void groupOf;
console.log(`${short ? 'board-check FAILED' : 'board-check ok'}: ${boards} boards (${busiest.length} station-directions of ${day}, every 15 min 05-22, read 25 min after the file, 4/12/40 rows): ${short} short${examples.length ? `: ${examples.join('; ')}` : ''}`);
tt.stop();
process.exit(short ? 1 : 0);
