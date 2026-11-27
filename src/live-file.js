// The format of the fetcher's files (public-plan step 2), in one place: the fetcher writes with these (fetcher/files.mjs)
// and the page reads with them. Plain JavaScript, no page parts. Rows are short arrays to keep the files small; they
// turn back into exactly the shapes the page already uses (src/trains-source.js toRecord, src/trafikverket.js
// passingsOf / fetchPlannedRoutes), positions rounded to 5 decimals (about 1 m).
// HARD RULE (Max, 2026-11-18): from the first app release to others on (until then they may change), these files stay
// backwards compatible: fields, row
// positions and kinds of file may only be ADDED (a new position at a row's end), never renamed, removed, moved, or given
// another type or meaning; released pages and apps read them for years. Readers ignore what they don't know. A change
// that can't keep that is a new set of files beside the old (FORMAT + 1), the old ones made until no released app reads
// them, and Max is told first. tools/format-check.mjs holds the formats as released (tools/file-formats.json).
import { lateClass } from './lateness.js';

export const FORMAT = 1;
const r5 = x => Math.round(x * 1e5) / 1e5;

// A position record -> [id, number, lon, lat, speed, bearing, ms before t of the report, gone]; t: the file's time.
export const trainRow = (r, t) => [r.id, r.number, r5(r.lon), r5(r.lat), r.speed, r.bearing, t - r.time, r.gone ? 1 : 0];
export function trainOf(row, t) {
  const [id, number, lon, lat, speed, bearing, ago, gone] = row;
  const cut = id.lastIndexOf('/');
  return { id, operational: id.slice(0, cut), date: id.slice(cut + 1), number, lon, lat, speed, bearing, time: t - ago, gone: gone === 1 };
}

// A passing -> [key, minutes late, station, time, company, activity].
export const passingRow = p => [p.key, p.minutes, p.station, p.time, p.brand, p.activity];
export const passingOf = ([key, minutes, station, time, brand, activity]) => ({ key, minutes, station, time, brand, activity });

// A planned row -> [key, station, 'A' arrival / 'D' departure, planned]; the company comes per train (brands).
export const plannedRow = r => [r.key, r.sig, r.activity === 'Ankomst' ? 'A' : 'D', r.planned];
export const plannedOf = ([key, sig, a, planned], brands = {}) =>
  ({ key, sig, activity: a === 'A' ? 'Ankomst' : 'Avgang', planned, brand: brands[key] ?? null });

// The live file's name for moment t (a new one every 5 s): a page asks for the newest finished one.
export const LIVE_MS = 5000;
export const liveName = t => `live-${Math.floor(t / LIVE_MS)}.json`;

// ---------- The day (2026-11-22, build plan part 4) ----------
// Trafikverket keeps only each train's latest position, so the fetcher keeps the day: every HISTORY_EVERY_MS it takes
// every train's latest report (fetcher/state.mjs sampleHistory), and when a 15-minute slot ends the slot's points go
// out as one file, history-<slot>.json, slot = floor(time / 15 min). A finished slot never changes, so a page works the
// names out from the clock (a 404: no file for that slot, a gap). Kept 24 hours after its slot ends, so a page can
// always look a whole day back from now (Max, 2026-11-27: "Just constant rolling"; until then until 01:00 the next night,
// and the ribbon started at 04:00).
// The file: { v, t (the slot's start, ms), kind: 'history', slot, every (ms between samples), trains: [row, ...] },
// one row per train seen in the slot:
//   [id, number, company, from, until, times, lons, lats, speeds, bearings, lates, start, end]
//   from, until: seconds after t of the first and the last sample the train was in (it was on the map in between);
//   times: its reports' own times in whole seconds, the first after t (may be negative: a report older than the slot),
//     each next one as the step from the one before; a point is kept only when the report is new (a train standing
//     without reports has its one point and its from/until);
//   lons, lats: 1e-5 degrees (about 1 m) as whole numbers, the first as it is, the next as steps;
//   speeds (km/h), bearings (degrees), lates (minutes late at that point; + late, - early): as they are, null when
//     not known;
//   start, end (added 2026-11-27): the station codes the train's trip starts and ends at (its timetable's FromLocation
//     and ToLocation, the first of each, as src/trip.js takes them), null when not known; older files' rows end before.
// Measured 2026-11-22 (tools/history-size.mjs; docs/data.md "The day"): a day for one viewer is about 3.0 MB packed
// with a point a minute in small steps (4.5 MB as plain rows; every 30 s: 4.6 MB in steps, over the 3 MB aimed at).
export const HISTORY_MS = 15 * 60 * 1000;
export const HISTORY_EVERY_MS = 60 * 1000;
export const historySlot = t => Math.floor(t / HISTORY_MS);
export const historyName = slot => `history-${slot}.json`;
// Until when the file of the slot starting at `start` is kept: a day after the slot's end.
export const HISTORY_KEEP_MS = 24 * 3600 * 1000;
export const historyUntil = start => start + HISTORY_MS + HISTORY_KEEP_MS;

// A train's points in one slot -> its row. tr: { id, number, brand, from, until (ms), points: [{ time (ms), lon, lat,
// speed, bearing, late }], start, end }; t: the slot's start.
export function historyRow(tr, t) {
  const times = [], lons = [], lats = [], speeds = [], bearings = [], lates = [];
  let pt = 0, px = 0, py = 0;
  tr.points.forEach((p, i) => {
    const s = Math.round((p.time - t) / 1000), x = Math.round(p.lon * 1e5), y = Math.round(p.lat * 1e5);
    times.push(i ? s - pt : s); lons.push(i ? x - px : x); lats.push(i ? y - py : y);
    pt = s; px = x; py = y;
    speeds.push(p.speed ?? null); bearings.push(p.bearing ?? null); lates.push(p.late ?? null);
  });
  return [tr.id, tr.number, tr.brand ?? null, Math.round((tr.from - t) / 1000), Math.round((tr.until - t) / 1000),
    times, lons, lats, speeds, bearings, lates, tr.start ?? null, tr.end ?? null];
}
export function historyOf(row, t) {
  const [id, number, brand, from, until, times, lons, lats, speeds, bearings, lates, start, end] = row;
  const points = [];
  let s = 0, x = 0, y = 0;
  for (let i = 0; i < times.length; i++) {
    s += times[i]; x += lons[i]; y += lats[i];
    points.push({ time: t + s * 1000, lon: x / 1e5, lat: y / 1e5, speed: speeds[i], bearing: bearings[i], late: lates[i] });
  }
  return { id, number, brand, from: t + from * 1000, until: t + until * 1000, points, start: start ?? null, end: end ?? null };
}

// A slot's bar on the ribbon (src/day-view.js): its trains, by their lateness at their last point in it (lateClass).
// rows: a history file's train rows. -> [trains, on time, a little late, late, unknown]
export function historyCounts(rows) {
  const c = { ontime: 0, some: 0, late: 0, unknown: 0 };
  for (const row of rows) {
    const lates = row[10] ?? [];
    let m = null;
    for (let i = lates.length - 1; i >= 0; i--) if (lates[i] !== null && lates[i] !== undefined) { m = lates[i]; break; }
    c[lateClass(m)]++;
  }
  return [rows.length, c.ontime, c.some, c.late, c.unknown];
}

// The day's overview (2026-11-27): every slot of the last day that has a history file, its bar's counts, so the page
// draws the whole ribbon at once and fetches only the slots it shows (a day of history files is ~3 MB, this ~2 kB).
// Made by the fetcher with each history file; the live file names the newest (kind 'daysum').
// The file: { v, t (made), kind: 'daysum', every (the slots' length, ms), slots: [[slot, ...historyCounts], ...] }
export const daySumOf = f => new Map((f?.slots ?? []).map(([slot, n, ontime, some, late, unknown]) => [slot, { n, c: { ontime, some, late, unknown } }]));
