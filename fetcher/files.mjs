// The files the fetcher hands out, built from its memory (fetcher/state.mjs), and the in-memory shelf that holds them.
// Every update gets a NEW name made from the time (one.com, measured 2026-11-15: a file replaced under the same name
// was sometimes served minutes old; a new name never). A page finds the newest live file from the clock: name =
// live-<slot>.json, slot = floor(time / 5 s); the live file names the current version of every other file.
// Each file is kept a while after a newer one exists (KEEP), then removed (from the shelf, and from one.com).
import { gzipSync } from 'node:zlib';
import { FORMAT, trainRow, passingRow, plannedRow, LIVE_MS, liveName, historyRow, historyName, historySlot, historyUntil,
  HISTORY_MS, HISTORY_EVERY_MS } from '../src/live-file.js';

export { LIVE_MS };
const MIN = 60000;
// kind -> [how often a new one is made (ms), how long one is kept after it was made (ms)]
export const KINDS = {
  live: [LIVE_MS, MIN],                    // positions now, passings of the last minute, the other files' names
  passings: [10 * MIN, 15 * MIN],          // the last 90 minutes of passings (a page opening, or back after > 30 s)
  'passings-add': [MIN, 3 * MIN],          // passings received since that passings file (2026-11-16: resending all
                                           // 90 minutes every minute was 63 % of the upload volume)
  planned: [10 * MIN, 15 * MIN],           // planned rows of the trains on the map
  'planned-add': [MIN, 3 * MIN],           // planned rows added since that planned file
  disruptions: [5 * MIN, 10 * MIN],
  stats: [5 * MIN, 10 * MIN],              // today's cancelled trains
  arrivals: [60 * MIN, 75 * MIN],          // today's arrivals (the stats page's graph)
  'arrivals-add': [5 * MIN, 15 * MIN],     // arrivals changed since that arrivals file
  stations: [24 * 60 * MIN, 48 * 60 * MIN],
  // Taps from files (plan step 4; fetcher/timetable.mjs): card-NN and board-NN (in turns, each about every 16 min),
  // the changes since the oldest of them, the internal -> public number index, the station messages.
  'taps-add': [30000, 3 * MIN],
  'taps-index': [10 * MIN, 15 * MIN],
  messages: [2 * MIN, 5 * MIN],
  // The day (build plan part 4, 2026-11-22): one file per 15-minute slot, made when the slot ends, kept until 01:00
  // Swedish time the night after its day (keptUntil below, not this number: the longest it can be is about 25 h).
  history: [HISTORY_MS, 25 * 60 * MIN],
};
const GROUP_KEEP = 25 * MIN;   // card-NN, board-NN, day-NN: kept 25 minutes after made (a newer one comes within ~16)
export const keepOf = kind => KINDS[kind]?.[1] ?? (/^(card|board|day)-\d+$/.test(kind) ? GROUP_KEEP : 15 * MIN);
// Until when a file of `kind` made at `at` is kept (a history file: its slot's start; src/live-file.js historyUntil).
export const keptUntil = (kind, at) => kind === 'history' ? historyUntil(at) : at + keepOf(kind);
// The live file's name comes from its 5-s slot (a page works it out from the clock); every other file is named by
// the moment it was made (the live file tells its name), so even a file made twice in one period gets a new name.
// A history file is named by its 15-minute slot (the page works the names out too).
export const nameOf = (kind, t) => kind === 'live' ? liveName(t) : kind === 'history' ? historyName(historySlot(t)) : `${kind}-${t}.json`;

// The live file: every train's latest position, the passings received in the last 30 s (a page asking every 5 s
// may miss a few files and still get every passing; back after longer, it reads the passings file), the other
// files' names. Row formats: src/live-file.js.
export const LIVE_PASSINGS_MS = 30000;
export function buildLive(state, t, names) {
  return {
    v: FORMAT, t, kind: 'live',
    trains: state.trains(t).map(r => trainRow(r, t)),
    passings: state.passings(t, t - LIVE_PASSINGS_MS).map(passingRow),
    files: names,
  };
}

// The last 90 minutes of passings; with `since`, only those received after it (the -add file: a page reads the newest
// passings file and the newest -add file, and keys passings, so a newer row replaces an older one).
export const buildPassings = (state, t, since = null) => ({ v: FORMAT, t, kind: since === null ? 'passings' : 'passings-add',
  ...(since === null ? {} : { since }), passings: state.passings(t, since).map(passingRow) });

// Planned rows of these trains; brands: key -> company.
// inBase (planned-add only): the ids the base file was made for; a train on the map not among them gets all its rows.
export function buildPlanned(state, t, ids, from, since = null, inBase = null) {
  const { rows, brands } = state.plannedRows(t, ids, from, since, inBase ? new Set(ids.filter(id => !inBase.has(id))) : null);
  return { v: FORMAT, t, kind: since === null ? 'planned' : 'planned-add', since, rows: rows.map(plannedRow), brands };
}

// Today's arrivals (the stats page's graph; fetcher/main.mjs): kind 'arrivals' (the whole day) or 'arrivals-add'
// (changed since); rows: Map train id -> [planned, actual, company]. A row: [id, planned, actual, company] (the company
// at the row's end since 2026-11-21: Statistik's company page). Read by src/main.js filesArrivals.
export const buildArrivals = (kind, t, day, rows) => ({ v: 1, t, kind, day, rows: [...rows].map(([id, [p, a, b]]) => [id, p, a, b ?? null]) });

// The day: a finished 15-minute slot's trains (fetcher/state.mjs takeHistory) as its file; t: the slot's start.
// Format: src/live-file.js historyRow.
export const buildHistory = (slot, trains) => {
  const t = slot * HISTORY_MS;
  return { v: FORMAT, t, kind: 'history', slot, every: HISTORY_EVERY_MS, trains: trains.map(tr => historyRow(tr, t)) };
};

// The shelf: name -> { kind, at, until (kept until), json, gz }. onAdd/onRemove let the uploader follow it.
export function createShelf({ onAdd = () => {}, onRemove = () => {} } = {}) {
  const files = new Map();
  const current = {};   // kind -> newest name
  return {
    put(kind, t, obj) {
      const name = nameOf(kind, t);
      const json = Buffer.from(JSON.stringify(obj));
      const f = { kind, at: t, until: keptUntil(kind, t), json, gz: gzipSync(json, { level: 6 }) };   // (until worked out once: a history file's needs the Swedish date)
      files.set(name, f);
      current[kind] = name;
      onAdd(name, f);
      return name;
    },
    // Remove what is past its keep time (never the newest of a kind).
    sweep(t) {
      for (const [name, f] of files) {
        if (current[f.kind] === name || t <= f.until) continue;
        files.delete(name);
        onRemove(name, f);
      }
    },
    get: name => files.get(name) ?? null,
    names: () => ({ ...current }),
    all: () => [...files.entries()],
  };
}
