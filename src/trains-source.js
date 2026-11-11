// Train positions from Trafikverket: the positions of the last 10 minutes, then every new one live.
import { follow, hasKey, trainKey } from './trafikverket.js';

const RECENT_MS = 10 * 60 * 1000;

// Trafikverket's position object -> our plain record. Null if it has no usable position.
export function toRecord(p) {
  const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(p?.Position?.WGS84 ?? '');
  if (!m || !p.Train) return null;
  return {
    id: trainKey(p.Train.OperationalTrainNumber, p.Train.OperationalTrainDepartureDate),
    operational: p.Train.OperationalTrainNumber,
    date: p.Train.OperationalTrainDepartureDate.slice(0, 10),
    number: p.Train.AdvertisedTrainNumber || p.Train.OperationalTrainNumber,
    lon: Number(m[1]),
    lat: Number(m[2]),
    speed: p.Speed ?? null,
    bearing: p.Bearing ?? null,
    time: Date.parse(p.TimeStamp),
    gone: p.Deleted === true || p.Status?.Active === false,
  };
}

// onRecords(records) gets every batch; onStatus({mode, error}) tells how the connection is.
export function startTrainSource({ onRecords, onStatus }) {
  if (!hasKey) {
    onStatus({ mode: 'stopped', error: 'no key: put VITE_TRV_KEY=... in the .env file' });
    return () => {};
  }
  return follow({
    makeQuery: ({ changeId, stream }) => {
      const since = new Date(Date.now() - RECENT_MS).toISOString();
      return `<QUERY objecttype="TrainPosition" namespace="järnväg.trafikinfo" schemaversion="1.1" ` +
        `${stream ? 'sseurl="true" ' : ''}changeid="${changeId ?? 0}">` +
        `<FILTER><GT name="TimeStamp" value="${since}"/></FILTER></QUERY>`;
    },
    onResult: (r) => {
      const records = (r.TrainPosition ?? []).map(toRecord).filter(Boolean);
      if (records.length) onRecords(records);
    },
    onStatus,
  });
}
