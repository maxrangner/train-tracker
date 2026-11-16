// Spårat's fetcher: the one program that talks to Trafikverket for the public version. It follows the two live
// streams (positions, passings), asks the slower lists itself (planned routes, disruptions, stats, stations) once for
// everyone, keeps it all in memory, and every 5 s makes a small file for the pages (fetcher/files.mjs). The files go to
// one.com (--upload, fetcher/upload.mjs) and/or are handed out on this computer (--serve). Nothing is written to disk.
// It uses the page's own Trafikverket code (src/trafikverket.js, src/trains-source.js), so both ask the same things.
//
// Run (Node 22 or newer, Windows or Linux):
//   node fetcher/main.mjs --env <settings file> [--serve 8090] [--upload] [--minutes N]
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
import { createShelf, buildLive, buildPassings, buildPlanned, LIVE_MS } from './files.mjs';
import { serve } from './serve.mjs';

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
const KEY = cfg.TRV_KEY ?? cfg.VITE_TRV_KEY;
if (!KEY) { console.error(`no key: put TRV_KEY=... in ${envPath} (or give --env <file>)`); process.exit(2); }
setKey(KEY);
const servePort = arg('--serve') ? Number(arg('--serve')) : null;
const minutes = arg('--minutes') ? Number(arg('--minutes')) : null;

// Times in the log are this computer's local time (as the Linux journal shows them).
const log = (...a) => console.log(new Date().toLocaleString('sv-SE'), ...a);

// ---------- load on Trafikverket, counted ----------
const load = { asks: 0, streams: 0, since: Date.now() };
const realFetch = globalThis.fetch;
let offlineUntil = 0;   // --test-breaks: a pretend lost internet
globalThis.fetch = (url, opts) => {
  if (String(url).includes('trafikverket.se')) {
    if (Date.now() < offlineUntil) return Promise.reject(new Error('test break: no internet'));
    if (opts?.method === 'POST') load.asks++; else load.streams++;
  }
  return realFetch(url, opts);
};

// ---------- memory, files, outputs ----------
const state = createState();
let uploader = null;
const shelf = createShelf({ onAdd: (name, f) => uploader?.add(name, f), onRemove: (name, f) => uploader?.remove(name, f) });
if (args.includes('--upload')) {
  const { createUploader } = await import('./upload.mjs');
  uploader = createUploader(cfg, log, { keep: name => Boolean(shelf.get(name)) });
}
const feeds = { positions: { mode: 'starting', since: Date.now() }, passings: { mode: 'starting', since: Date.now() }, lastRecordAt: null };
const status = () => ({ now: Date.now(), up: Math.round(process.uptime()), feeds, state: state.sizes(), load,
  files: shelf.names(), upload: uploader?.stats() ?? null, memoryMB: Math.round(process.memoryUsage().rss / 1e6) });
const server = servePort ? serve(shelf, servePort, status) : null;
if (server) log(`files on http://localhost:${servePort}/ (status: /status)`);

// ---------- the two live streams ----------
const onFeed = name => s => {
  const f = feeds[name];
  if (s.mode !== f.mode || s.error) log(`${name}: ${s.mode}${s.error ? ` (${s.error})` : ''}`);
  if (s.mode !== f.mode) { f.mode = s.mode; f.since = Date.now(); }
};
const stops = [
  followPositions({ onRecords: rs => { state.addRecords(rs, Date.now()); feeds.lastRecordAt = Date.now(); }, onStatus: onFeed('positions'), retryStreamMs: MIN }),
  followPassings({ onPassings: (list, how) => state.addPassings(list, Date.now(), how), onStatus: onFeed('passings'), retryStreamMs: MIN }),
];

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
  const names = shelf.names(); delete names.live;
  const live = buildLive(state, t, names);
  live.feeds = { positions: feeds.positions.mode, passings: feeds.passings.mode, lastRecordAt: feeds.lastRecordAt };
  shelf.put('live', t, live);
  shelf.sweep(t);
  later(LIVE_MS - (Date.now() % LIVE_MS) + 50, liveTick);
}
later(LIVE_MS - (Date.now() % LIVE_MS) + 50, liveTick);

every('passings file', MIN, 15000, () => { shelf.put('passings', Date.now(), buildPassings(state, Date.now())); });

// Planned routes, asked once for everyone the way the page asks for its own trains (src/main.js askRoutes): trains on
// the map whose known route ends within 30 minutes (or isn't known), at most every 5 minutes per train, 30 minutes back
// (the first time 90, more when late) to 90 minutes ahead; the first time with the company.
const BACK_MS = 30 * MIN, FIRST_BACK_MS = 90 * MIN, MAX_BACK_MS = 4 * 60 * MIN, LATE_MIN = 15;
let plannedBaseAt = null;
async function askRoutes() {
  const t = Date.now();
  const want = state.trains(t).filter(r => !r.gone && (state.plannedOf(r.id)?.until ?? 0) < t + 30 * MIN && !(t - (state.plannedOf(r.id)?.asked ?? 0) < 5 * MIN));
  if (!want.length) return;
  const again = want.filter(r => state.plannedOf(r.id)?.asked), first = want.filter(r => !state.plannedOf(r.id)?.asked);
  const late = first.filter(r => state.lateBy(r.id) > LATE_MIN), onTime = first.filter(r => !(state.lateBy(r.id) > LATE_MIN));
  state.markAsked(want.map(r => r.id), t);
  const groups = [[again, BACK_MS, false], [onTime, FIRST_BACK_MS, true],
    [late, Math.min(MAX_BACK_MS, FIRST_BACK_MS + Math.max(0, ...late.map(r => state.lateBy(r.id))) * MIN), true]];
  for (const [list, back, withBrand] of groups) {
    if (!list.length) continue;
    try {
      state.addPlanned(await fetchPlannedRoutes([...new Set(list.map(r => r.operational))], t - back, t + 90 * MIN, { withBrand }), Date.now());
    } catch (e) {
      state.markAsked(list.map(r => r.id), 0);
      throw e;
    }
  }
}
every('planned routes', 30000, 10000, askRoutes);
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

every('disruptions', 5 * MIN, 2000, async () => {
  const t = Date.now();
  shelf.put('disruptions', t, { v: 1, t, kind: 'disruptions', disruptions: await fetchDisruptions(t) });
});
every('stats', 5 * MIN, 4000, async () => {
  const t = Date.now(), day = swedishDay(t);
  shelf.put('stats', t, { v: 1, t, kind: 'stats', day, cancelled: await fetchCancelledToday(day) });
});
every('stations', 24 * 60 * MIN, 1000, async () => {
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
const arrRows = m => [...m].map(([id, [p, a]]) => [id, p, a]);
every('arrivals', 5 * MIN, 6000, async () => {
  const t = Date.now(), day = swedishDay(t);
  if (day !== arr.day) Object.assign(arr, { day, rows: new Map(), asOf: null, changed: new Map(), fullAt: 0 });
  const list = await fetchDayArrivals(swedishMidnight(t), arr.asOf === null ? null : arr.asOf - 5 * MIN);
  for (const r of list) { arr.rows.set(r.id, [r.planned, r.actual]); arr.changed.set(r.id, [r.planned, r.actual]); }
  arr.asOf = t;
  if (t - arr.fullAt >= 60 * MIN) {
    shelf.put('arrivals', t, { v: 1, t, kind: 'arrivals', day, rows: arrRows(arr.rows) });
    arr.fullAt = t; arr.changed = new Map();
  } else shelf.put('arrivals-add', t, { v: 1, t, kind: 'arrivals-add', day, rows: arrRows(arr.changed) });
});

// ---------- a status line every 10 minutes ----------
let lastLoad = { asks: 0, streams: 0, at: Date.now(), cpu: process.cpuUsage() };
every('status', 10 * MIN, 10 * MIN, () => {
  const s = status(), ms = Date.now() - lastLoad.at, cpu = process.cpuUsage(lastLoad.cpu);
  log(`status: ${s.state.trains} trains, ${s.state.passings} passings, ${s.state.planned} routes; Trafikverket ${((load.asks - lastLoad.asks) / (ms / MIN)).toFixed(1)} asks/min, ${load.streams - lastLoad.streams} streams opened; ` +
    `${s.upload ? `uploads ${s.upload.ok} ok, ${s.upload.failed} failed, ${s.upload.reconnects} reconnects, ${s.upload.waiting} waiting; ` : ''}` +
    `memory ${s.memoryMB} MB, CPU ${((cpu.user + cpu.system) / 10 / ms).toFixed(1)} %; feeds ${feeds.positions.mode}/${feeds.passings.mode}`);
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
  await uploader?.close();
  process.exit(0);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
if (minutes) setTimeout(() => stop(`${minutes} minutes`), minutes * MIN);

// --test-breaks A,B,...: at these minutes after the start, pretend the internet is lost for a minute: Trafikverket
// can't be reached, the open streams break, the upload connection drops and can't reconnect (the live test).
const breaks = arg('--test-breaks');
if (breaks) for (const m of breaks.split(',').map(Number)) setTimeout(() => {
  log('test break: no internet for 60 s');
  offlineUntil = Date.now() + MIN;
  for (const es of NodeEventSource.open) es.fail();
  uploader?.breakFor(MIN);
}, m * MIN);
log(`started (${envPath}; Node ${process.version}, ${process.platform}, process ${process.pid})`);
