// The only part of the page that talks to Trafikverket.
// For the public version this file is swapped for one that talks to our own helper instead.
//
// How it works:
// 1. One query for the positions reported in the last 10 minutes, asking for a stream address too.
// 2. The live stream (Server-Sent Events, read with the browser's EventSource) pushes every new position.
// 3. If the stream breaks, a new query picks up where the stream left off (changeid).
//    If it keeps breaking, we ask for changes every 10 seconds instead.

const API = 'https://api.trafikinfo.trafikverket.se/v2/data.json';
const KEY = import.meta.env.VITE_TRV_KEY;

const RECENT_MS = 10 * 60 * 1000;   // positions older than this are not wanted
const SILENT_MS = 60 * 1000;         // a stream silent this long is treated as broken
const POLL_MS = 10 * 1000;
const MAX_FAILURES = 3;              // stream failures within FAILURE_WINDOW_MS before we fall back to polling
const FAILURE_WINDOW_MS = 2 * 60 * 1000;

function request({ changeId, stream }) {
  const since = new Date(Date.now() - RECENT_MS).toISOString();
  const attrs = [
    'objecttype="TrainPosition"', 'namespace="järnväg.trafikinfo"', 'schemaversion="1.1"',
    stream ? 'sseurl="true"' : '',
    changeId ? `changeid="${changeId}"` : 'changeid="0"',
  ].join(' ');
  return `<REQUEST><LOGIN authenticationkey="${KEY}"/>` +
    `<QUERY ${attrs}><FILTER><GT name="TimeStamp" value="${since}"/></FILTER></QUERY></REQUEST>`;
}

async function query(opts) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: request(opts) });
  if (!res.ok) throw new Error(`Trafikverket answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const result = (await res.json()).RESPONSE.RESULT[0];
  if (result.ERROR) throw new Error(`Trafikverket: ${result.ERROR.MESSAGE}`);
  return result;
}

// Trafikverket's position object -> our plain record. Null if it has no usable position.
export function toRecord(p) {
  const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(p?.Position?.WGS84 ?? '');
  if (!m || !p.Train) return null;
  return {
    id: `${p.Train.OperationalTrainNumber}/${p.Train.OperationalTrainDepartureDate}`,
    number: p.Train.AdvertisedTrainNumber || p.Train.OperationalTrainNumber,
    lon: Number(m[1]),
    lat: Number(m[2]),
    speed: p.Speed ?? null,
    bearing: p.Bearing ?? null,
    time: Date.parse(p.TimeStamp),
    gone: p.Deleted === true || p.Status?.Active === false,
  };
}

// Start listening. onRecords(records) gets every batch; onStatus({mode, error}) tells how the connection is.
export function startTrainSource({ onRecords, onStatus }) {
  let lastChangeId = null;
  let es = null;
  let silentTimer = null;
  let failures = [];
  let stopped = false;

  const deliver = (positions) => {
    const records = (positions ?? []).map(toRecord).filter(Boolean);
    if (records.length) onRecords(records);
  };

  const closeStream = () => {
    clearTimeout(silentTimer);
    if (es) { es.close(); es = null; }
  };

  const streamFailed = (why) => {
    closeStream();
    const now = Date.now();
    failures = failures.filter(t => now - t < FAILURE_WINDOW_MS).concat(now);
    if (failures.length >= MAX_FAILURES) {
      onStatus({ mode: 'polling', error: `the live stream kept breaking (${why}); asking every 10 s instead` });
      poll();
    } else {
      onStatus({ mode: 'reconnecting', error: why });
      setTimeout(openStream, 2000);
    }
  };

  async function openStream() {
    if (stopped) return;
    let result;
    try {
      result = await query({ changeId: lastChangeId, stream: true });
    } catch (e) {
      return streamFailed(e.message);
    }
    lastChangeId = result.INFO?.LASTCHANGEID ?? lastChangeId;
    deliver(result.TrainPosition);
    const url = result.INFO?.SSEURL;
    if (!url) return streamFailed('no stream address in the answer');

    es = new EventSource(url);
    const armSilentTimer = () => {
      clearTimeout(silentTimer);
      silentTimer = setTimeout(() => streamFailed('no data for 60 s'), SILENT_MS);
    };
    armSilentTimer();
    es.onopen = () => onStatus({ mode: 'stream' });
    es.onmessage = (e) => {
      armSilentTimer();
      if (e.lastEventId) lastChangeId = e.lastEventId;
      try {
        for (const r of JSON.parse(e.data).RESPONSE.RESULT) deliver(r.TrainPosition);
      } catch { /* a message we can't read is skipped */ }
    };
    // EventSource retries by itself after a network blip; only a closed stream (e.g. the address expired) needs us.
    es.onerror = () => { if (es && es.readyState === EventSource.CLOSED) streamFailed('the stream closed'); };
  }

  async function poll() {
    if (stopped) return;
    try {
      const result = await query({ changeId: lastChangeId, stream: false });
      lastChangeId = result.INFO?.LASTCHANGEID ?? lastChangeId;
      deliver(result.TrainPosition);
      onStatus({ mode: 'polling' });
    } catch (e) {
      onStatus({ mode: 'polling', error: e.message });
    }
    setTimeout(poll, POLL_MS);
  }

  if (!KEY) {
    onStatus({ mode: 'stopped', error: 'no key: put VITE_TRV_KEY=... in the .env file' });
  } else {
    openStream();
  }
  return () => { stopped = true; closeStream(); };
}
