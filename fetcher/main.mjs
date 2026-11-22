// Spårat's fetcher: the one program that talks to Trafikverket for the public version. It follows the two live
// streams (positions, passings), asks the slower lists itself (planned routes, disruptions, stats, stations) once for
// everyone, keeps it all in memory, and every 5 s makes a small file for the pages (fetcher/files.mjs). The files go to
// one.com (--upload, fetcher/upload.mjs) and/or are handed out on this computer (--serve). Nothing is written to disk.
// It uses the page's own Trafikverket code (src/trafikverket.js, src/trains-source.js), so both ask the same things.
//
// Run (Node 22 or newer, Windows or Linux):
//   node fetcher/main.mjs --env <settings file> [--serve 8090] [--status 8091] [--upload] [--minutes N] [--replay <recording>]
// --replay: plays a recording from data/ instead of the two streams, times moved to now (fetcher/replay.mjs), for
// checking the page that reads the files; no key needed (with one, stations, disruptions and stats are still asked).
// Settings file (KEY=value lines, never in git; fetcher/example.env shows them): TRV_KEY (or VITE_TRV_KEY), and for
// --upload SFTP_HOST, SFTP_PORT, SFTP_USER, SFTP_PASS, SFTP_DIR, SFTP_HOSTKEY. On Linux it runs as a service:
// fetcher/sparat-fetcher.service. Logs go to the console (the service's journal): errors, changes, a status line
// every 10 minutes.
import { readFileSync, existsSync } from 'node:fs';
import { NodeEventSource } from './event-source.mjs';
import { setKey, followPassings, fetchPlannedRoutes, fetchDisruptions, fetchCancelledToday, fetchDayArrivals, fetchStations } from '../src/trafikverket.js';
import { followPositions } from '../src/trains-source.js';
import { swedishDay } from '../src/clock.js';
import { createState } from './state.mjs';
import { createShelf, buildLive, buildPassings, buildPlanned, buildArrivals, LIVE_MS } from './files.mjs';
import { serve, serveStatus } from './serve.mjs';
import { startReplay } from './replay.mjs';
import { createTimetable } from './timetable.mjs';
import { askRoutes as askRoutesOnce, MAX_BACK_MS } from './ask-routes.mjs';
import { GROUPS } from '../src/tap-files.js';
import { FORMAT } from '../src/live-file.js';

globalThis.EventSource ??= NodeEventSource;
const MIN = 60000;

// ---------- settings ----------
const args = process.argv.slice(2);
const arg = (name, dflt = null) => { const i = args.indexOf(name); return i < 0 ? dflt : args[i + 1]; };
const envPath = arg('--env', process.env.SPARAT_ENV ?? 'fetcher.env');
function readEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
const cfg = { ...readEnv(envPath), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(TRV_|SFTP_)/.test(k))) };
// The self-check (fetcher/self-check.mjs) runs first and alone: nothing else starts, then it exits (78 or 79).
//   --self-check outside|inside, or --self-check-file <path> (the service: inside, when that file exists)
{
  const where = args.includes('--self-check') ? arg('--self-check') : arg('--self-check-file') && existsSync(arg('--self-check-file')) ? 'inside' : null;
  if (where) {
    const { selfCheck } = await import('./self-check.mjs');
    process.exit(await selfCheck(where === 'inside' ? 'inside' : 'outside', cfg, args));
  }
}
const KEY = cfg.TRV_KEY ?? cfg.VITE_TRV_KEY;
const replayName = arg('--replay');
if (!KEY && !replayName) { console.error(`no key: put TRV_KEY=... in ${envPath} (or give --env <file>)`); process.exit(2); }
if (KEY) setKey(KEY);
const servePort = arg('--serve') ? Number(arg('--serve')) : null;
const minutes = arg('--minutes') ? Number(arg('--minutes')) : null;

// Times in the log are this computer's local time (as the Linux journal shows them).
const log = (...a) => console.log(new Date().toLocaleString('sv-SE'), ...a);

// ---------- load on Trafikverket, counted ----------
// Counted from the start (the monitor, monitor/main.mjs, takes the differences): questions, streams opened, bytes
// received (questions' answers unpacked + the streams), "too many requests" answers, failed questions.
const load = { asks: 0, streams: 0, since: Date.now(), askBytes: 0, refused: 0, failed: 0 };
const realFetch = globalThis.fetch;
let offlineUntil = 0;   // --test-breaks: a pretend lost internet
globalThis.fetch = (url, opts) => {
  if (!String(url).includes('trafikverket.se')) return realFetch(url, opts);
  if (Date.now() < offlineUntil) { load.failed++; return Promise.reject(new Error('test break: no internet')); }
  const isAsk = opts?.method === 'POST';
  if (isAsk) load.asks++; else load.streams++;
  return realFetch(url, opts).then(res => {
    if (res.status === 429) load.refused++;
    else if (!res.ok) load.failed++;
    // A question's answer is counted from a copy (a stream is counted as it is read: NodeEventSource.bytes).
    if (isAsk) res.clone().arrayBuffer().then(b => { load.askBytes += b.byteLength; }, () => {});
    return res;
  }, e => { load.failed++; throw e; });
};

// ---------- memory, files, outputs ----------
const state = createState();
let uploader = null;
const shelf = createShelf({ onAdd: (name, f) => uploader?.add(name, f), onRemove: (name, f) => uploader?.remove(name, f) });
if (args.includes('--upload')) {
  const { createUploader } = await import('./upload.mjs');
  uploader = createUploader(cfg, log, { keep: name => Boolean(shelf.get(name)) });
}
const feeds = { positions: { mode: 'starting', since: Date.now() }, passings: { mode: 'starting', since: Date.now() }, lastRecordAt: null,
  newestReport: null };   // the newest position report's own time
const startedAt = Date.now();
// The newest file of each kind: its name and size (as uploaded, and gzip as a viewer gets it).
const sizes = () => Object.fromEntries(Object.entries(shelf.names()).map(([kind, name]) => {
  const f = shelf.get(name);
  return [kind, { name, bytes: f?.json.length ?? 0, gz: f?.gz.length ?? 0 }];
}));
const status = () => ({ now: Date.now(), up: Math.round(process.uptime()), pid: process.pid, startedAt, feeds, state: state.sizes(),
  load: { ...load, streamBytes: NodeEventSource.bytes }, files: shelf.names(), sizes: sizes(), upload: uploader?.stats() ?? null,
  memoryMB: Math.round(process.memoryUsage().rss / 1e6), cpu: process.cpuUsage(), taps: timetable?.stats() ?? null });
const server = servePort ? serve(shelf, servePort, status) : null;
if (server) log(`files on http://localhost:${servePort}/ (status: /status)`);
// --status 8091: only the status, only on this computer (127.0.0.1), for the monitor (monitor/main.mjs).
// --status-socket <path>: the same on a local socket file instead (the Linux service: /run/sparat/status.sock).
const statusAt = arg('--status-socket') ?? (arg('--status') ? Number(arg('--status')) : null);
const statusServer = statusAt ? serveStatus(statusAt, status) : null;
if (statusServer) log(typeof statusAt === 'number' ? `status on http://127.0.0.1:${statusAt}/status (this computer only)` : `status on the local socket ${statusAt}`);

// ---------- the two live streams ----------
const onFeed = name => s => {
  const f = feeds[name];
  if (s.mode !== f.mode || s.error) log(`${name}: ${s.mode}${s.error ? ` (${s.error})` : ''}`);
  if (s.mode !== f.mode) { f.mode = s.mode; f.since = Date.now(); }
};
const onPositionRecords = rs => {
  state.addRecords(rs, Date.now()); feeds.lastRecordAt = Date.now();
  for (const r of rs) if (r.time > (feeds.newestReport ?? 0) && r.time <= Date.now() + MIN) feeds.newestReport = r.time;
};
const onPassingList = (list, how) => state.addPassings(list, Date.now(), how);
let replayTimetable = null;   // a replay's timetable rows, for its tap files (below)
const stops = replayName
  ? [startReplay(replayName, { onRecords: onPositionRecords, onPassings: onPassingList, onPlanned: rows => state.addPlanned(rows, Date.now()),
      onStatus: s => { onFeed('positions')(s); onFeed('passings')(s); }, onTimetable: rows => { replayTimetable = rows; } })]
  : [
    followPositions({ onRecords: onPositionRecords, onStatus: onFeed('positions'), retryStreamMs: MIN }),
    followPassings({ onPassings: onPassingList, onStatus: onFeed('passings'), retryStreamMs: MIN }),
  ];
if (replayName) log(`replaying data/positions-${replayName}.jsonl (times moved to now)${KEY ? '' : '; no key: no stations, disruptions or stats'}`);

// ---------- timers ----------
const timers = new Set();   // pending timeouts (a fired one leaves the set, so it doesn't grow over days)
const later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
// Run fn now-ish (after `first` ms) and then every `ms`; a failed run is tried again after a minute.
function every(name, ms, first, fn) {
  const run = async () => {
    let wait = ms;
    try { await fn(); } catch (e) { log(`${name}: ${e.message}; again in 1 min`); wait = Math.min(ms, MIN); }
    later(wait, run);
  };
  later(first, run);
}

// The live file, at the start of every 5-s slot.
function liveTick() {
  const t = Date.now();
  // Uploading: only what is on one.com (fetcher/upload.mjs names()); else (--serve) everything on the shelf.
  const names = uploader ? uploader.names() : shelf.names(); delete names.live;
  const live = buildLive(state, t, names);
  live.feeds = { positions: feeds.positions.mode, passings: feeds.passings.mode, lastRecordAt: feeds.lastRecordAt };
  shelf.put('live', t, live);
  shelf.sweep(t);
  later(LIVE_MS - (Date.now() % LIVE_MS) + 50, liveTick);
}
later(LIVE_MS - (Date.now() % LIVE_MS) + 50, liveTick);

// Passings: the whole 90 minutes every 10 minutes, and every minute only what came since (fetcher/files.mjs KINDS).
let passingsBaseAt = null;
every('passings file', 10 * MIN, 15000, () => { const t = Date.now(); shelf.put('passings', t, buildPassings(state, t)); passingsBaseAt = t; });
every('passings-add file', MIN, 75000, () => {
  const t = Date.now();
  if (passingsBaseAt !== null) shelf.put('passings-add', t, buildPassings(state, t, passingsBaseAt));
});

// Planned routes for the trains on the map: fetcher/ask-routes.mjs.
let plannedBaseAt = null;
const askRoutes = () => askRoutesOnce(state, fetchPlannedRoutes);
if (!replayName) every('planned routes', 30000, 10000, askRoutes);   // a replay brings its own
const shownIds = t => state.trains(t).map(r => r.id);
every('planned file', 10 * MIN, 40000, () => {
  const t = Date.now();
  shelf.put('planned', t, buildPlanned(state, t, shownIds(t), t - MAX_BACK_MS));
  plannedBaseAt = t;
});
every('planned-add file', MIN, 100000, () => {
  const t = Date.now();
  if (plannedBaseAt !== null) shelf.put('planned-add', t, buildPlanned(state, t, shownIds(t), t - MAX_BACK_MS, plannedBaseAt));
});

if (KEY) every('disruptions', 5 * MIN, 2000, async () => {
  const t = Date.now();
  shelf.put('disruptions', t, { v: 1, t, kind: 'disruptions', disruptions: await fetchDisruptions(t) });
});
if (KEY) every('stats', 5 * MIN, 4000, async () => {
  const t = Date.now(), day = swedishDay(t);
  const c = await fetchCancelledToday(day);
  // cancelledBy (added 2026-11-21): [[company, trains], ...] (a list, so the format's fields stay the same whatever the companies)
  shelf.put('stats', t, { v: 1, t, kind: 'stats', day, cancelled: c.count, cancelledBy: Object.entries(c.byBrand) });
});
if (KEY) every('stations', 24 * 60 * MIN, 1000, async () => {
  const t = Date.now();
  shelf.put('stations', t, { v: 1, t, kind: 'stations', stations: [...(await fetchStations()).values()] });
});

// Today's arrivals (the stats page's graph): the whole day once, then only what changed every 5 minutes (as
// src/day-stats.js asks); a whole-day file is made from memory every hour, a changes file every 5 minutes.
// Swedish midnight of moment t (src/day-stats.js swedishMidnight).
function swedishMidnight(t) {
  const utc = Date.parse(`${swedishDay(t)}T00:00:00Z`);
  const h = Number(new Date(utc).toLocaleString('sv-SE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Stockholm' }));
  return utc - h * 3600000;
}
const arr = { day: null, rows: new Map(), asOf: null, changed: new Map(), fullAt: 0 };
// (its rows: fetcher/files.mjs buildArrivals)
if (KEY) every('arrivals', 5 * MIN, 6000, async () => {
  const t = Date.now(), day = swedishDay(t);
  if (day !== arr.day) Object.assign(arr, { day, rows: new Map(), asOf: null, changed: new Map(), fullAt: 0 });
  const list = await fetchDayArrivals(swedishMidnight(t), arr.asOf === null ? null : arr.asOf - 5 * MIN);
  for (const r of list) { arr.rows.set(r.id, [r.planned, r.actual, r.brand]); arr.changed.set(r.id, [r.planned, r.actual, r.brand]); }
  arr.asOf = t;
  if (t - arr.fullAt >= 60 * MIN) {
    shelf.put('arrivals', t, buildArrivals('arrivals', t, day, arr.rows));
    arr.fullAt = t; arr.changed = new Map();
  } else shelf.put('arrivals-add', t, buildArrivals('arrivals-add', t, day, arr.changed));
});

// ---------- taps from files (plan step 4, 2026-11-17: fetcher/timetable.mjs, src/tap-files.js) ----------
// The card and board files in groups, made in turns: all at the first round (a page opening needs them), then the
// oldest card and the oldest board every 30 s (each one about every 16 minutes), with a changes file every 30 s that brings every row changed
// since the oldest of them, so a tap is at most ~30 s behind Trafikverket. The index every 10 minutes, the station
// messages every 2 minutes. A replay uses its recording's timetable (seeded, nothing asked; since 2026-11-19, TODO 37:
// the format check on this computer then sees the tap files of the code about to be released; no station messages).
const groupAt = {};   // card-NN / board-NN / day-NN -> when its file in use was made
const timetable = replayName
  ? createTimetable({ log, seed: { days: [...new Set((replayTimetable ?? []).map(a => (a.ScheduledDepartureDateTime ?? '').slice(0, 10)))], rows: replayTimetable ?? [] } })
  : KEY ? createTimetable({ log, onLoaded: () => { for (const k in groupAt) delete groupAt[k]; } }) : null;
if (timetable) {
  stops.push(() => timetable.stop());
  const GROUP_KINDS = Array.from({ length: GROUPS }, (_, i) => String(i).padStart(2, '0')).flatMap(g => [`card-${g}`, `board-${g}`, `day-${g}`]);
  every('tap files', 30000, 30000, () => {
    if (!timetable.ready()) return;
    const t = Date.now();
    const due = GROUP_KINDS.some(k => !groupAt[k]) ? GROUP_KINDS.filter(k => !groupAt[k])
      : ['card', 'board', 'day'].map(w => GROUP_KINDS.filter(k => k.startsWith(w)).sort((a, b) => groupAt[a] - groupAt[b])[0]);
    for (const k of due) {
      const [what, g] = k.split('-');
      shelf.put(k, t, { v: FORMAT, ...timetable[what](g, t) });
      groupAt[k] = t;
    }
    const oldest = Math.min(...Object.values(groupAt));
    shelf.put('taps-add', t, { v: FORMAT, ...timetable.changes(oldest - MIN, t) });
  });
  const notReady = () => { throw new Error('the timetable is still loading'); };   // every() tries again in a minute
  every('taps index', 10 * MIN, 45000, () => { if (!timetable.ready()) notReady(); const t = Date.now(); shelf.put('taps-index', t, { v: FORMAT, ...timetable.index(t) }); });
  every('messages file', 2 * MIN, 50000, () => { const t = Date.now(); shelf.put('messages', t, { v: FORMAT, ...timetable.messages(t) }); });
}

// ---------- a status line every 10 minutes ----------
let lastLoad = { asks: 0, streams: 0, at: Date.now(), cpu: process.cpuUsage() };
every('status', 10 * MIN, 10 * MIN, () => {
  const s = status(), ms = Date.now() - lastLoad.at, cpu = process.cpuUsage(lastLoad.cpu);
  log(`status: ${s.state.trains} trains, ${s.state.passings} passings, ${s.state.planned} routes; Trafikverket ${((load.asks - lastLoad.asks) / (ms / MIN)).toFixed(1)} asks/min, ${load.streams - lastLoad.streams} streams opened; ` +
    `${s.upload ? `uploads ${s.upload.ok} ok, ${s.upload.failed} failed, ${s.upload.reconnects} reconnects, ${s.upload.waiting} waiting; ` : ''}` +
    `memory ${s.memoryMB} MB, CPU ${((cpu.user + cpu.system) / 10 / ms).toFixed(1)} %; feeds ${feeds.positions.mode}/${feeds.passings.mode}` +
    (s.taps ? `; timetable ${s.taps.rows} rows (${s.taps.days.join(', ')}), ${s.taps.changes} changes, last ${s.taps.lastChangeAgo} s ago, ${s.taps.messages} messages` : ''));
  lastLoad = { asks: load.asks, streams: load.streams, at: Date.now(), cpu: process.cpuUsage() };
});

// ---------- stopping ----------
async function stop(why) {
  const s = status(), mins = (Date.now() - load.since) / MIN;
  log(`stopping (${why}) after ${mins.toFixed(1)} min: ${s.state.trains} trains, ${s.state.passings} passings, ${s.state.planned} routes, ` +
    `${Object.keys(s.files).length} kinds of files; Trafikverket ${(load.asks / mins).toFixed(1)} asks/min, ${load.streams} streams opened; ` +
    `${s.upload ? `uploads ${s.upload.ok} ok, ${s.upload.failed} failed; ` : ''}memory ${s.memoryMB} MB; feeds ${feeds.positions.mode}/${feeds.passings.mode}`);
  for (const s of stops) s();
  for (const t of timers) clearTimeout(t);
  server?.close();
  statusServer?.close();
  await uploader?.close();
  process.exit(0);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
if (minutes) setTimeout(() => stop(`${minutes} minutes`), minutes * MIN);

// --test-breaks A,B,...: at these minutes after the start, pretend the internet is lost for a minute (or for L minutes
// with AxL, e.g. 30x5): Trafikverket can't be reached, the open streams break, the upload connection drops and can't
// reconnect (the live tests).
const breaks = arg('--test-breaks');
if (breaks) for (const part of breaks.split(',')) {
  const [m, len = 1] = part.split('x').map(Number);
  setTimeout(() => {
    log(`test break: no internet for ${len * 60} s`);
    offlineUntil = Date.now() + len * MIN;
    for (const es of NodeEventSource.open) es.fail();
    uploader?.breakFor(len * MIN);
  }, m * MIN);
}
log(`started (${envPath}; Node ${process.version}, ${process.platform}, process ${process.pid})`);
