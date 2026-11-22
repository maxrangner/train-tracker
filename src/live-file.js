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
import { swedishDay, midnightOf, addDays } from './clock.js';

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
// names out from the clock (a 404: no file for that slot, a gap). Kept until 01:00 Swedish time the next night.
// The file: { v, t (the slot's start, ms), kind: 'history', slot, every (ms between samples), trains: [row, ...] },
// one row per train seen in the slot:
//   [id, number, company, from, until, times, lons, lats, speeds, bearings, lates]
//   from, until: seconds after t of the first and the last sample the train was in (it was on the map in between);
//   times: its reports' own times in whole seconds, the first after t (may be negative: a report older than the slot),
//     each next one as the step from the one before; a point is kept only when the report is new (a train standing
//     without reports has its one point and its from/until);
//   lons, lats: 1e-5 degrees (about 1 m) as whole numbers, the first as it is, the next as steps;
//   speeds (km/h), bearings (degrees), lates (minutes late at that point; + late, - early): as they are, null when
//     not known.
// Measured 2026-11-22 (tools/history-size.mjs; docs/data.md "The day"): a day for one viewer is about 3.0 MB packed
// with a point a minute in small steps (4.5 MB as plain rows; every 30 s: 4.6 MB in steps, over the 3 MB aimed at).
export const HISTORY_MS = 15 * 60 * 1000;
export const HISTORY_EVERY_MS = 60 * 1000;
export const historySlot = t => Math.floor(t / HISTORY_MS);
export const historyName = slot => `history-${slot}.json`;
// Until when the file of the slot starting at `start` is kept: 01:00 Swedish time the night after its day.
export const historyUntil = start => midnightOf(addDays(swedishDay(start), 1)) + 3600 * 1000;

// A train's points in one slot -> its row. tr: { id, number, brand, from, until (ms), points: [{ time (ms), lon, lat,
// speed, bearing, late }] }; t: the slot's start.
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
    times, lons, lats, speeds, bearings, lates];
}
export function historyOf(row, t) {
  const [id, number, brand, from, until, times, lons, lats, speeds, bearings, lates] = row;
  const points = [];
  let s = 0, x = 0, y = 0;
  for (let i = 0; i < times.length; i++) {
    s += times[i]; x += lons[i]; y += lats[i];
    points.push({ time: t + s * 1000, lon: x / 1e5, lat: y / 1e5, speed: speeds[i], bearing: bearings[i], late: lates[i] });
  }
  return { id, number, brand, from: t + from * 1000, until: t + until * 1000, points };
}
