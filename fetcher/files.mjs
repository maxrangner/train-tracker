// The files the fetcher hands out, built from its memory (fetcher/state.mjs), and the in-memory shelf that holds them.
// Every update gets a NEW name made from the time (one.com, measured 2026-11-15: a file replaced under the same name
// was sometimes served minutes old; a new name never). A page finds the newest live file from the clock: name =
// live-<slot>.json, slot = floor(time / 5 s); the live file names the current version of every other file.
// Each file is kept a while after a newer one exists (KEEP), then removed (from the shelf, and from one.com).
import { gzipSync } from 'node:zlib';
import { FORMAT, trainRow, passingRow, plannedRow, LIVE_MS, liveName } from '../src/live-file.js';

export { LIVE_MS };
const MIN = 60000;
// kind -> [how often a new one is made (ms), how long one is kept after it was made (ms)]
export const KINDS = {
  live: [LIVE_MS, MIN],                    // positions now, passings of the last minute, the other files' names
  passings: [MIN, 3 * MIN],                // the last 90 minutes of passings (a page opening, or back after > 1 min)
  planned: [10 * MIN, 15 * MIN],           // planned rows of the trains on the map
  'planned-add': [MIN, 3 * MIN],           // planned rows added since that planned file
  disruptions: [5 * MIN, 10 * MIN],
  stats: [5 * MIN, 10 * MIN],              // today's cancelled trains
  arrivals: [60 * MIN, 75 * MIN],          // today's arrivals (the stats page's graph)
  'arrivals-add': [5 * MIN, 15 * MIN],     // arrivals changed since that arrivals file
  stations: [24 * 60 * MIN, 48 * 60 * MIN],
};
// The live file's name comes from its 5-s slot (a page works it out from the clock); every other file is named by
// the moment it was made (the live file tells its name), so even a file made twice in one period gets a new name.
export const nameOf = (kind, t) => kind === 'live' ? liveName(t) : `${kind}-${t}.json`;

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

export const buildPassings = (state, t) => ({ v: FORMAT, t, kind: 'passings', passings: state.passings(t).map(passingRow) });

// Planned rows of these trains; brands: key -> company.
export function buildPlanned(state, t, ids, from, since = null) {
  const { rows, brands } = state.plannedRows(t, ids, from, since);
  return { v: FORMAT, t, kind: since === null ? 'planned' : 'planned-add', since, rows: rows.map(plannedRow), brands };
}

// The shelf: name -> { kind, at, json, gz }. onAdd/onRemove let the uploader follow it.
export function createShelf({ onAdd = () => {}, onRemove = () => {} } = {}) {
  const files = new Map();
  const current = {};   // kind -> newest name
  return {
    put(kind, t, obj) {
      const name = nameOf(kind, t);
      const json = Buffer.from(JSON.stringify(obj));
      const f = { kind, at: t, json, gz: gzipSync(json, { level: 6 }) };
      files.set(name, f);
      current[kind] = name;
      onAdd(name, f);
      return name;
    },
    // Remove what is past its keep time (never the newest of a kind).
    sweep(t) {
      for (const [name, f] of files) {
        if (current[f.kind] === name || t - f.at <= KINDS[f.kind][1]) continue;
        files.delete(name);
        onRemove(name, f);
      }
    },
    get: name => files.get(name) ?? null,
    names: () => ({ ...current }),
    all: () => [...files.entries()],
  };
}
