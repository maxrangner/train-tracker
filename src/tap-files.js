// Taps from files (plan step 4, 2026-11-17): the fetcher keeps the day's timetable (fetcher/timetable.mjs) and hands
// out what a tap needs as files; the page (src/files-source.js filesTapAsker) turns them back into Trafikverket's own
// answer, so the train card, the station board, the number search and the station messages read them as before.
// This module is the one format both sides use. Pure: no page, no network (node checks it: tools/taps-check.mjs).
//
// A row is one TrainAnnouncement (a train at a place, arriving or leaving), kept as a short array:
//   [op, number, day, sig, act, flags, adv, est, actual, track, from, to, product, deviation, other, booking, service,
//    composition]
// op: OperationalTrainNumber; number: AdvertisedTrainIdent ('' none); day, from .. composition: indexes into the
// file's word list `d` (-1: none; day is ScheduledDepartureDateTime as Trafikverket wrote it, the others its lists as
// JSON); sig: LocationSignature; act: 'A' arrival (Ankomst) / 'D' departure (Avgang); flags: 1 Advertised,
// 2 Canceled, 4 Deleted; adv, est, actual: seconds after the file's base `b` (null: none); track: '' none.
// A file: { v, t, kind, b, d: [words], r: [rows] }.
// Backwards compatible from the first app release on (HARD RULE, src/live-file.js): new fields go at a row's end.
export const TAP_FIELDS = ['OperationalTrainNumber', 'AdvertisedTrainIdent', 'ScheduledDepartureDateTime', 'LocationSignature',
  'ActivityType', 'Advertised', 'Canceled', 'Deleted', 'AdvertisedTimeAtLocation', 'EstimatedTimeAtLocation', 'TimeAtLocation',
  'TrackAtLocation', 'FromLocation', 'ToLocation', 'ProductInformation', 'Deviation', 'OtherInformation', 'Booking', 'Service',
  'TrainComposition', 'ModifiedTime'];
const LISTS = ['FromLocation', 'ToLocation', 'ProductInformation', 'Deviation', 'OtherInformation', 'Booking', 'Service', 'TrainComposition'];
export const GROUPS = 32;   // cards by number, boards by station: 32 files each (measured 2026-11-17: ~23 / 9 kB each)
// How far back a board reaches: a train planned this long ago still shows while it hasn't left (fetcher/timetable.mjs
// keeps such rows in the board files, src/files-source.js reads them). 90 minutes until 2026-11-19: a train later than
// that dropped off its board.
export const BOARD_BACK_MS = 4 * 3600 * 1000;

// The group of a number or a station (the same on both sides).
export function groupOf(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return String(h % GROUPS).padStart(2, '0');
}
// A row's identity: the same train and day, place, activity and planned time (within one word list and base; the
// fetcher's memory uses one of each).
export const rowKey = r => `${r[0]}|${r[2]}|${r[3]}|${r[4]}|${r[6]}`;

// A word list that gives each distinct text one number (shared by all rows of a file).
export function words() {
  const list = [], index = new Map();
  const id = s => { if (s == null) return -1; let i = index.get(s); if (i === undefined) { i = list.length; list.push(s); index.set(s, i); } return i; };
  return { id, list };
}
const secs = (iso, b) => (iso ? Math.round(Date.parse(iso) / 1000) - b : null);
const listWord = v => (Array.isArray(v) && v.length ? JSON.stringify(v) : null);

// Trafikverket's row -> a short row (w: words(), b: the base in seconds).
export function encodeRow(a, w, b) {
  return [String(a.OperationalTrainNumber ?? ''), String(a.AdvertisedTrainIdent ?? ''), w.id(a.ScheduledDepartureDateTime ?? null),
    a.LocationSignature, a.ActivityType === 'Avgang' ? 'D' : 'A',
    (a.Advertised ? 1 : 0) | (a.Canceled ? 2 : 0) | (a.Deleted ? 4 : 0),
    secs(a.AdvertisedTimeAtLocation, b), secs(a.EstimatedTimeAtLocation, b), secs(a.TimeAtLocation, b), a.TrackAtLocation ?? '',
    ...LISTS.map(k => w.id(listWord(a[k])))];
}
// A short row -> Trafikverket's row (only what it had), with times as ISO strings.
export function decodeRow(r, d, b) {
  const time = s => (s === null ? undefined : new Date((b + s) * 1000).toISOString());
  const a = { LocationSignature: r[3], ActivityType: r[4] === 'D' ? 'Avgang' : 'Ankomst',
    Advertised: Boolean(r[5] & 1), Canceled: Boolean(r[5] & 2), Deleted: Boolean(r[5] & 4) };
  if (r[0]) a.OperationalTrainNumber = r[0];
  if (r[1]) a.AdvertisedTrainIdent = r[1];
  if (r[2] >= 0) a.ScheduledDepartureDateTime = d[r[2]];
  for (const [k, s] of [['AdvertisedTimeAtLocation', r[6]], ['EstimatedTimeAtLocation', r[7]], ['TimeAtLocation', r[8]]]) { const v = time(s); if (v) a[k] = v; }
  if (r[9]) a.TrackAtLocation = r[9];
  LISTS.forEach((k, i) => { if (r[10 + i] >= 0) a[k] = JSON.parse(d[r[10 + i]]); });
  return a;
}
// Rows (Trafikverket's) -> a file's body; the base is the earliest time, so the numbers stay small.
export function encodeRows(rows, extra = {}) {
  const w = words();
  const b = Math.floor(Math.min(...rows.map(a => Date.parse(a.AdvertisedTimeAtLocation)).filter(Number.isFinite), Date.now()) / 1000);
  return { ...extra, b, r: rows.map(a => encodeRow(a, w, b)), d: w.list };
}
export const decodeRows = f => (f?.r ?? []).map(r => decodeRow(r, f.d, f.b));

// The rows of a group file with the newest changes put over them (both decoded): a row in `changes` replaces the
// same row (rowKey) in `rows`; new ones are added. Changes are always the row's newest state.
// The two files have their own word lists and bases, so rows are matched on the day's text and the absolute time.
export function withChanges(group, changes, keep = () => true) {
  const out = new Map();
  for (const f of [group, changes]) for (const r of f?.r ?? []) {
    if (!keep(r, f)) continue;
    out.set(`${r[0]}|${f.d[r[2]] ?? ''}|${r[3]}|${r[4]}|${r[6] === null ? '' : f.b + r[6]}`, decodeRow(r, f.d, f.b));
  }
  return [...out.values()];
}
