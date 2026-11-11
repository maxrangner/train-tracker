// Everything that talks to Trafikverket lives here (and in trains-source.js, which uses it).
// For the public version these are swapped for calls to our own helper.

const API = 'https://api.trafikinfo.trafikverket.se/v2/data.json';
const KEY = import.meta.env.VITE_TRV_KEY;

export const hasKey = Boolean(KEY);

// One query. `query` is the inside of <QUERY ...>...</QUERY>, written by the caller.
export async function ask(queryXml) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: `<REQUEST><LOGIN authenticationkey="${KEY}"/>${queryXml}</REQUEST>`,
  });
  if (!res.ok) throw new Error(`Trafikverket answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const result = (await res.json()).RESPONSE.RESULT[0];
  if (result.ERROR) throw new Error(`Trafikverket: ${result.ERROR.MESSAGE}`);
  return result;
}

// Keep a query live: ask once with a stream address, then follow the stream. If the stream breaks, ask again from
// where it left off; if it keeps breaking, ask every 10 s instead.
// makeQuery({changeId, stream}) returns the <QUERY> xml; onResult(result) gets every answer and stream message.
export function follow({ makeQuery, onResult, onStatus, silentMs = 60000 }) {
  let lastChangeId = null;
  let es = null;
  let silentTimer = null;
  let failures = [];
  let stopped = false;

  const closeStream = () => {
    clearTimeout(silentTimer);
    if (es) { es.close(); es = null; }
  };

  const streamFailed = (why) => {
    closeStream();
    const now = Date.now();
    failures = failures.filter(t => now - t < 120000).concat(now);
    if (failures.length >= 3) {
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
      result = await ask(makeQuery({ changeId: lastChangeId, stream: true }));
    } catch (e) {
      return streamFailed(e.message);
    }
    lastChangeId = result.INFO?.LASTCHANGEID ?? lastChangeId;
    onResult(result);
    const url = result.INFO?.SSEURL;
    if (!url) return streamFailed('no stream address in the answer');

    es = new EventSource(url);
    const arm = () => {
      clearTimeout(silentTimer);
      silentTimer = setTimeout(() => streamFailed(`no data for ${silentMs / 1000} s`), silentMs);
    };
    arm();
    es.onopen = () => onStatus({ mode: 'stream' });
    es.onmessage = (e) => {
      arm();
      if (e.lastEventId) lastChangeId = e.lastEventId;
      try {
        for (const r of JSON.parse(e.data).RESPONSE.RESULT) onResult(r);
      } catch { /* a message we can't read is skipped */ }
    };
    // EventSource retries by itself after a network blip; only a closed stream (e.g. the address expired) needs us.
    es.onerror = () => { if (es && es.readyState === EventSource.CLOSED) streamFailed('the stream closed'); };
  }

  async function poll() {
    if (stopped) return;
    try {
      const result = await ask(makeQuery({ changeId: lastChangeId, stream: false }));
      lastChangeId = result.INFO?.LASTCHANGEID ?? lastChangeId;
      onResult(result);
      onStatus({ mode: 'polling' });
    } catch (e) {
      onStatus({ mode: 'polling', error: e.message });
    }
    setTimeout(poll, 10000);
  }

  openStream();
  return () => { stopped = true; closeStream(); };
}

const changeAttrs = ({ changeId, stream }) =>
  `${stream ? 'sseurl="true" ' : ''}changeid="${changeId ?? 0}"`;

// ---------- Lateness: the latest actual passing of each train ----------

// A train's key in both feeds: internal number + the date it started.
export const trainKey = (operationalNumber, departureDate) => `${operationalNumber}/${departureDate.slice(0, 10)}`;

// Follow actual passings at stations (the timetable feed). onPassings(list) gets
// [{key, minutes, station, time, brand, activity}] where minutes = actual - planned, rounded (+ late, - early).
export function followPassings({ onPassings, onStatus, sinceMinutes = 90 }) {
  return follow({
    makeQuery: (c) => {
      const since = new Date(Date.now() - sinceMinutes * 60000).toISOString();
      return `<QUERY objecttype="TrainAnnouncement" schemaversion="1.9" ${changeAttrs(c)}>` +
        `<FILTER><GT name="TimeAtLocation" value="${since}"/></FILTER>` +
        `<INCLUDE>OperationalTrainNumber</INCLUDE><INCLUDE>ScheduledDepartureDateTime</INCLUDE>` +
        `<INCLUDE>LocationSignature</INCLUDE><INCLUDE>AdvertisedTimeAtLocation</INCLUDE>` +
        `<INCLUDE>TimeAtLocation</INCLUDE><INCLUDE>Deleted</INCLUDE><INCLUDE>ProductInformation</INCLUDE>` +
        `<INCLUDE>ActivityType</INCLUDE></QUERY>`;
    },
    onResult: (r) => {
      const list = [];
      for (const a of r.TrainAnnouncement ?? []) {
        if (a.Deleted || !a.TimeAtLocation || !a.AdvertisedTimeAtLocation || !a.OperationalTrainNumber) continue;
        list.push({
          key: trainKey(a.OperationalTrainNumber, a.ScheduledDepartureDateTime),
          minutes: Math.round((Date.parse(a.TimeAtLocation) - Date.parse(a.AdvertisedTimeAtLocation)) / 60000),
          station: a.LocationSignature,
          time: Date.parse(a.TimeAtLocation),
          brand: a.ProductInformation?.[0]?.Description ?? null,   // e.g. "Pågatågen"; a second entry is a line
          activity: a.ActivityType ?? null,                         // "Ankomst" arrival / "Avgang" departure
        });
      }
      if (list.length) onPassings(list);
    },
    onStatus,
    silentMs: 120000,   // passings are rarer than positions at quiet hours
  });
}

// ---------- A train's route for today ----------

// All stops of one train on its date, in order: [{station, activity, advertised, planned, estimated, actual, canceled}].
export async function fetchRoute(operationalNumber, departureDate) {
  const r = await ask(
    `<QUERY objecttype="TrainAnnouncement" schemaversion="1.9" orderby="AdvertisedTimeAtLocation">` +
    `<FILTER><EQ name="OperationalTrainNumber" value="${operationalNumber}"/>` +
    `<EQ name="ScheduledDepartureDateTime" value="${departureDate.slice(0, 10)}"/></FILTER>` +
    `<INCLUDE>LocationSignature</INCLUDE><INCLUDE>ActivityType</INCLUDE><INCLUDE>Advertised</INCLUDE>` +
    `<INCLUDE>AdvertisedTimeAtLocation</INCLUDE><INCLUDE>EstimatedTimeAtLocation</INCLUDE>` +
    `<INCLUDE>TimeAtLocation</INCLUDE><INCLUDE>Canceled</INCLUDE>` +
    `<INCLUDE>FromLocation</INCLUDE><INCLUDE>ToLocation</INCLUDE><INCLUDE>ProductInformation</INCLUDE>` +
    `</QUERY>`);
  const rows = r.TrainAnnouncement ?? [];
  return {
    from: rows[0]?.FromLocation?.[0]?.LocationName ?? null,
    to: rows[0]?.ToLocation?.[0]?.LocationName ?? null,
    product: rows[0]?.ProductInformation?.[0]?.Description ?? null,
    stops: rows.map(a => ({
      station: a.LocationSignature,
      activity: a.ActivityType,          // "Ankomst" (arrival) or "Avgang" (departure)
      advertised: a.Advertised === true, // a stop shown to passengers
      planned: Date.parse(a.AdvertisedTimeAtLocation),
      estimated: a.EstimatedTimeAtLocation ? Date.parse(a.EstimatedTimeAtLocation) : null,
      actual: a.TimeAtLocation ? Date.parse(a.TimeAtLocation) : null,
      canceled: a.Canceled === true,
    })),
  };
}

// ---------- Stations ----------

// Signature -> { name, lon, lat } for every station, e.g. "Cst" -> Stockholm C and its place.
export async function fetchStations() {
  const r = await ask(
    `<QUERY objecttype="TrainStation" namespace="rail.infrastructure" schemaversion="1.5">` +
    `<INCLUDE>LocationSignature</INCLUDE><INCLUDE>AdvertisedLocationName</INCLUDE><INCLUDE>Geometry.WGS84</INCLUDE></QUERY>`);
  return new Map((r.TrainStation ?? []).map(s => {
    const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(s.Geometry?.WGS84 ?? '');
    return [s.LocationSignature, { name: s.AdvertisedLocationName, lon: m ? Number(m[1]) : null, lat: m ? Number(m[2]) : null }];
  }));
}

// ---------- Planned routes ----------

// The timetable rows of these trains (internal numbers) planned between from and to (ms): every location they pass
// or stop at. [{ key (trainKey), sig, activity ('Ankomst' arrival / 'Avgang' departure), planned (ms) }].
// Asked in groups of 100 numbers.
export async function fetchPlannedRoutes(numbers, from, to) {
  const out = [];
  for (let i = 0; i < numbers.length; i += 100) {
    const r = await ask(
      `<QUERY objecttype="TrainAnnouncement" schemaversion="1.9">` +
      `<FILTER><IN name="OperationalTrainNumber" value="${numbers.slice(i, i + 100).join(',')}"/>` +
      `<GT name="AdvertisedTimeAtLocation" value="${new Date(from).toISOString()}"/>` +
      `<LT name="AdvertisedTimeAtLocation" value="${new Date(to).toISOString()}"/></FILTER>` +
      `<INCLUDE>OperationalTrainNumber</INCLUDE><INCLUDE>ScheduledDepartureDateTime</INCLUDE>` +
      `<INCLUDE>LocationSignature</INCLUDE><INCLUDE>ActivityType</INCLUDE><INCLUDE>AdvertisedTimeAtLocation</INCLUDE>` +
      `<INCLUDE>Deleted</INCLUDE></QUERY>`);
    for (const a of r.TrainAnnouncement ?? []) {
      if (a.Deleted || !a.AdvertisedTimeAtLocation) continue;
      out.push({ key: trainKey(a.OperationalTrainNumber, a.ScheduledDepartureDateTime), sig: a.LocationSignature,
        activity: a.ActivityType, planned: Date.parse(a.AdvertisedTimeAtLocation) });
    }
  }
  return out;
}
