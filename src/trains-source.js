// Train positions from Trafikverket: the positions of the last 10 minutes, then every new one live.
import { follow, hasKey, trainKey } from './trafikverket.js';
import { reportTime } from './report-time.js';

const RECENT_MS = 10 * 60 * 1000;
// Only the fields toRecord reads are asked for. The stream is not compressed, and a whole position object is
// 517 bytes against 316 with these (measured live 2026-11-13: the same 1,083 reports in a minute, 39 % fewer
// bytes; about 62 -> 38 MB an hour at rush hour). The recorder (tools/collect.mjs) still saves everything.
// ModifiedTime (Trafikverket's receive time) tells a report stamped by a clock running behind (src/report-time.js);
// it adds about 13 % (night of 2026-11-14).
// Train.JourneyPlanDepartureDate (2026-11-22, TODO 62): the trip's day, as the timetable's ScheduledDepartureDateTime.
const FIELDS = ['Train.OperationalTrainNumber', 'Train.OperationalTrainDepartureDate', 'Train.JourneyPlanDepartureDate', 'Train.AdvertisedTrainNumber',
  'Position.WGS84', 'TimeStamp', 'Status.Active', 'Bearing', 'Speed', 'Deleted', 'ModifiedTime'].map(f => `<INCLUDE>${f}</INCLUDE>`).join('');

// Trafikverket's position object -> our plain record. Null if it has no usable position. first: it came in the
// first answer after starting (a recording says so itself: via 'start').
export function toRecord(p, first = p?.via === 'start') {
  const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(p?.Position?.WGS84 ?? '');
  if (!m || !p.Train?.OperationalTrainNumber || !p.Train.OperationalTrainDepartureDate) return null;   // (a row without them: skipped, 2026-11-22)
  // The train's day is its trip's (JourneyPlanDepartureDate), as in the timetable. OperationalTrainDepartureDate is the
  // day of this internal number's piece: a trip that takes a new number after midnight (3 a night: 989 as 991, 1738 as
  // 21738, 8777 as 18778) got the next day's date until 2026-11-22, so it had no lateness, company or planned route,
  // its card showed that evening's run, and both pieces were on the map for 8-14 minutes (TODO 62). Matched the
  // timetable for 145 of 145 trains in the midnight recording; the piece's own date only when it is missing.
  const day = p.Train.JourneyPlanDepartureDate ?? p.Train.OperationalTrainDepartureDate;
  return {
    id: trainKey(p.Train.OperationalTrainNumber, day),
    operational: p.Train.OperationalTrainNumber,
    date: day.slice(0, 10),
    number: p.Train.AdvertisedTrainNumber || p.Train.OperationalTrainNumber,
    lon: Number(m[1]),
    lat: Number(m[2]),
    speed: p.Speed ?? null,
    bearing: p.Bearing ?? null,
    time: reportTime(p, first),
    gone: p.Deleted === true || p.Status?.Active === false,
  };
}

// onRecords(records) gets every batch; onStatus({mode, error}) tells how the connection is.
export function startTrainSource({ onRecords, onStatus }) {
  if (!hasKey) {
    onStatus({ mode: 'stopped', error: 'no key: put VITE_TRV_KEY=... in the .env file' });
    return () => {};
  }
  return followPositions({ onRecords, onStatus });
}

// The position stream itself, without the page's key check: the fetcher (fetcher/) follows it the same way.
export const positionsQuery = ({ changeId, stream }) => {
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  return `<QUERY objecttype="TrainPosition" namespace="järnväg.trafikinfo" schemaversion="1.1" ` +
    `${stream ? 'sseurl="true" ' : ''}changeid="${changeId ?? 0}">` +
    `<FILTER><GT name="TimeStamp" value="${since}"/></FILTER>${FIELDS}</QUERY>`;
};
export function followPositions({ onRecords, onStatus, retryStreamMs }) {
  return follow({
    makeQuery: positionsQuery,
    onResult: (r, { first = false } = {}) => {
      const records = (r.TrainPosition ?? []).map(p => toRecord(p, first)).filter(Boolean);
      if (records.length) onRecords(records);
    },
    onStatus,
    retryStreamMs,
  });
}
