// The files' MEANING stays the same for released pages and apps (HARD RULE, files backwards compatible; 2026-11-19,
// TODO 37, Codex's beta review point 15). tools/format-check.mjs compares types only: two number fields swapped in a
// row, or a field given another meaning, pass it. This check makes files with today's code from made-up input in
// which every field has its own value, reads them with the readers as RELEASED (src/live-file.js and src/tap-files.js
// taken from the version tag with git, into a temp folder) and with today's, and fails when a field the released
// reader knows reads differently. Covers the row kinds: the live file's trains and passings, passings, planned,
// cards, boards, taps-add. Kinds with named fields (stations, disruptions, stats, taps-index) can't swap by position,
// and a renamed field fails format-check as "gone". Not covered: the arrivals' and the station messages' rows (their
// readers live in src/main.js and src/files-source.js, too big to take from a tag): format-check's types only.
// Which releases: the newest version tag; from the first app release on, every tag from tools/file-formats.json
// releasedFrom on (set at that release).
// Offline, a second or two. Run: node tools/format-read-check.mjs     exit code 0: same meaning (or not enforced
// yet: only a warning); 1: a released reader reads something else.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import * as now from '../src/live-file.js';
import * as tapsNow from '../src/tap-files.js';
import { buildLive, buildPassings, buildPlanned } from '../fetcher/files.mjs';
import { createTimetable } from '../fetcher/timetable.mjs';

const list = JSON.parse(readFileSync('tools/file-formats.json', 'utf8'));
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const ver = tag => tag.slice(1).split('.').map(Number);
const newer = (a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
const tags = git('tag', '--list', 'v*').split('\n').filter(t => /^v\d+\.\d+\.\d+$/.test(t)).sort((a, b) => (newer(a, b) ? 1 : -1));
if (!tags.length) { console.log('format-read-check: no version tag: skipped'); process.exit(0); }
const from = list.releasedFrom ?? tags.at(-1);
const released = tags.filter(t => !newer(from, t));

// ---------- made-up input: every field its own value ----------
const T = Date.parse('2026-11-19T12:00:00Z');
const day = '2026-11-19T00:00:00.000+01:00';
const trains = [
  { id: '1234/2026-11-19', number: '5678', lon: 18.12345, lat: 59.54321, speed: 87, bearing: 213, time: T - 4321, gone: false },
  { id: '8765/2026-11-19', number: '', lon: 11.98765, lat: 57.70123, speed: null, bearing: null, time: T - 61000, gone: true },
];
const passings = [
  { key: '1234/2026-11-19', minutes: 3, station: 'Cst', time: T - 20000, brand: 'SJ Regional', activity: 'Avgang' },
  { key: '8765/2026-11-19', minutes: -1, station: 'G', time: T - 9000, brand: 'Västtågen', activity: 'Ankomst' },
];
const planned = [
  { key: '1234/2026-11-19', sig: 'U', activity: 'Ankomst', planned: T + 1800000 },
  { key: '1234/2026-11-19', sig: 'Cst', activity: 'Avgang', planned: T - 600000 },
];
const brands = { '1234/2026-11-19': 'SJ Regional' };
const state = {
  trains: () => trains,
  passings: () => passings,
  plannedRows: () => ({ rows: planned, brands }),
};
const iso = ms => new Date(ms).toISOString();
const ann = (n, extra) => ({
  OperationalTrainNumber: '1234', AdvertisedTrainIdent: '91', ScheduledDepartureDateTime: day, LocationSignature: 'Cst',
  ActivityType: 'Avgang', Advertised: true, Canceled: false, Deleted: false,
  AdvertisedTimeAtLocation: iso(T + n * 600000), EstimatedTimeAtLocation: iso(T + n * 600000 + 120000), TimeAtLocation: undefined,
  TrackAtLocation: '7b', FromLocation: [{ LocationName: 'Cst', Order: 0, Priority: 1 }], ToLocation: [{ LocationName: 'U', Order: 0, Priority: 1 }],
  ProductInformation: [{ Code: 'PNA001', Description: 'SJ Regional' }], Deviation: [{ Code: 'ANA027', Description: 'Spårändrat' }],
  OtherInformation: [{ Code: 'ONA001', Description: 'Ej påstigning' }], Booking: [{ Code: 'BNA001', Description: 'Platsbokning' }],
  Service: [{ Code: 'SNA001', Description: 'Bistro' }], TrainComposition: [{ Code: 'KNA001', Description: 'Vagnsordning 1-6' }],
  ModifiedTime: iso(T - 1000), ...extra,
});
const anns = [ann(1), ann(2, { ActivityType: 'Ankomst', LocationSignature: 'U', TrackAtLocation: '3', Canceled: true }),
  ann(-1, { TimeAtLocation: iso(T - 590000), LocationSignature: 'Sci', AdvertisedTrainIdent: '' })];
const tt = createTimetable({ log: () => {}, seed: { days: ['2026-11-19'], rows: anns } });

// ---------- the files, made by today's code ----------
const live = buildLive(state, T, {});
const files = [
  ['live trains', live.trains.map(r => [r, live.t]), 'trainOf'],
  ['live passings', live.passings.map(r => [r]), 'passingOf'],
  ['passings', buildPassings(state, T).passings.map(r => [r]), 'passingOf'],
  ['planned', (f => f.rows.map(r => [r, f.brands]))(buildPlanned(state, T, [], 0)), 'plannedOf'],
];
const tapFiles = [['card', tt.card(tapsNow.groupOf('91'), T)], ['board', tt.board(tapsNow.groupOf('Cst'), T)], ['taps-add', tt.changes(0, T)]];
for (const [k, f] of tapFiles) if (!f.r.length) { console.log(`format-read-check: the made-up ${k} file is empty (the check itself is broken)`); process.exit(1); }

// ---------- read with the released readers and today's ----------
const dir = join(tmpdir(), `sparat-readers-${process.pid}`);
let differ = 0, compared = 0;
const say = (tag, what, i, k, a, b) => { if (differ++ < 12) console.log(`FAIL ${tag} ${what} row ${i}: "${k}" reads ${JSON.stringify(a)} with the released reader, ${JSON.stringify(b)} with today's`); };
const same = (tag, what, i, old, cur) => {
  compared++;
  if (old && typeof old === 'object') { for (const k of Object.keys(old)) if (!isDeepStrictEqual(old[k], cur?.[k])) say(tag, what, i, k, old[k], cur?.[k]); }
  else if (!isDeepStrictEqual(old, cur)) say(tag, what, i, '(row)', old, cur);
};
try {
  for (const tag of released) {
    const at = join(dir, tag);
    mkdirSync(at, { recursive: true });
    const take = async name => {
      let src;
      try { src = execFileSync('git', ['show', `${tag}:src/${name}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
      writeFileSync(join(at, name.replace(/\.js$/, '.mjs')), src);
      return import(pathToFileURL(join(at, name.replace(/\.js$/, '.mjs'))).href);
    };
    const old = await take('live-file.js'), oldTaps = await take('tap-files.js');
    if (old) for (const [what, rows, fn] of files) {
      if (!old[fn]) continue;
      rows.forEach((args, i) => same(tag, what, i, old[fn](...args), now[fn](...args)));
    }
    if (oldTaps?.decodeRows) for (const [what, f] of tapFiles) {
      const a = oldTaps.decodeRows(f), b = tapsNow.decodeRows(f);
      a.forEach((x, i) => same(tag, what, i, x, b[i]));
    }
  }
} finally { rmSync(dir, { recursive: true, force: true }); }

console.log(`${differ ? 'format-read-check FAILED' : 'format-read-check ok'}: today's files read by the released readers of ${released.join(', ')}: ${compared} rows compared${differ ? `, ${differ} field(s) read differently` : ', every field reads the same'}`);
if (differ && !list.enforced) { console.log('note: not enforced yet (until the first app release, tools/file-formats.json enforced: false): only a warning'); process.exit(0); }
process.exit(differ ? 1 : 0);
