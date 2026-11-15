// Everything that talks to Trafikverket lives here (and in trains-source.js, which uses it).
// Plain JavaScript that runs in the page and in Node: the fetcher (fetcher/) uses these same queries for the public
// version, so the page and the fetcher ask Trafikverket the same things.

const API = 'https://api.trafikinfo.trafikverket.se/v2/data.json';
// In the page the key comes from Vite (.env); the fetcher (fetcher/main.mjs) runs this module in Node, where there is
// no Vite, and hands its key over with setKey().
let KEY = import.meta.env?.VITE_TRV_KEY;

export let hasKey = Boolean(KEY);
export function setKey(key) { KEY = key; hasKey = Boolean(key); }

// One query. `query` is the inside of <QUERY ...>...</QUERY>, written by the caller.
// "Too many requests" (HTTP 429, over 100 a second on the key, data.md "Request limits"): wait as Trafikverket says
// (Retry-After), else 10 s, 30 s, 60 s, and ask again; after that it is an error like any other.
const WAITS_429 = [10000, 30000, 60000];
export async function ask(queryXml) {
  for (let i = 0; ; i++) {
    try {
      return await askOnce(queryXml);
    } catch (e) {
      if (!e.tooMany || i >= WAITS_429.length) throw e;
      await new Promise(r => setTimeout(r, e.retryAfter ?? WAITS_429[i]));
    }
  }
}

// A request that gets no answer is given up: ANSWER_MS for the answer to start, then BODY_MS for all of it to
// arrive (the first passings answer is big on a slow connection). Without a limit a request could hang for good,
// and the page said "connecting" with nothing trying again (measured 2026-11-13: 3 minutes, then the test ended).
const ANSWER_MS = 20 * 1000, BODY_MS = 60 * 1000;
async function askOnce(queryXml) {
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), ANSWER_MS);
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: `<REQUEST><LOGIN authenticationkey="${KEY}"/>${queryXml}</REQUEST>`,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(), BODY_MS);
    if (res.status === 429) {
      const e = new Error('Trafikverket: too many requests (429)');
      e.tooMany = true;
      const after = Number(res.headers.get('retry-after'));
      if (after > 0) e.retryAfter = Math.min(after, 120) * 1000;
      throw e;
    }
    if (!res.ok) throw new Error(`Trafikverket answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const result = (await res.json()).RESPONSE.RESULT[0];
    if (result.ERROR) throw new Error(`Trafikverket: ${result.ERROR.MESSAGE}`);
    return result;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('no answer from Trafikverket');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Keep a query live: ask once with a stream address, then follow the stream. If the stream breaks, ask again from
// where it left off; if it keeps breaking, ask every 10 s instead, and try the stream again every 5 minutes.
// makeQuery({changeId, stream}) returns the <QUERY> xml; onResult(result) gets every answer and stream message.
// onResult(result, { first }): first is true for the first answer after starting (every object's latest version).
export function follow({ makeQuery, onResult, onStatus, silentMs = 60000 }) {
  let lastChangeId = null;
  let es = null;
  let silentTimer = null;
  let failures = [];
  let stopped = false;
  let pollingSince = null;   // when it started asking every 10 s (null: following the stream)
  const RETRY_STREAM_MS = 5 * 60 * 1000;

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
      pollingSince = Date.now();
      poll();
    } else {
      onStatus({ mode: 'reconnecting', error: why });
      setTimeout(openStream, 2000);
    }
  };

  async function openStream() {
    if (stopped) return;
    let result;
    const first = lastChangeId === null;
    try {
      result = await ask(makeQuery({ changeId: lastChangeId, stream: true }));
    } catch (e) {
      return stopped ? undefined : streamFailed(e.message);
    }
    if (stopped) return;   // stopped while the answer was on its way: no new stream
    lastChangeId = result.INFO?.LASTCHANGEID ?? lastChangeId;
    onResult(result, { first });
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
      if (stopped) return;
      lastChangeId = result.INFO?.LASTCHANGEID ?? lastChangeId;
      onResult(result);
      onStatus({ mode: 'polling' });
    } catch (e) {
      onStatus({ mode: 'polling', error: e.message });
    }
    // Every 5 minutes, try the live stream again (if it breaks three more times, back to asking every 10 s).
    if (Date.now() - pollingSince >= RETRY_STREAM_MS) {
      pollingSince = null;
      failures = [];
      onStatus({ mode: 'reconnecting' });
      return openStream();
    }
    setTimeout(poll, 10000);
  }

  openStream();
  const stop = () => { stopped = true; closeStream(); };
  // Back from the background (main.js): a phone froze the page, and the stream may have died without a word. Ask
  // again from where it left off at once, rather than when the silence timer runs out (up to silentMs later). While
  // asking every 10 s, or while a stream is being opened, nothing is needed.
  stop.restart = () => {
    if (stopped || !es) return;
    closeStream();
    openStream();
  };
  return stop;
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
      return `<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9" ${changeAttrs(c)}>` +
        `<FILTER><GT name="TimeAtLocation" value="${since}"/></FILTER>` +
        `<INCLUDE>OperationalTrainNumber</INCLUDE><INCLUDE>ScheduledDepartureDateTime</INCLUDE>` +
        `<INCLUDE>LocationSignature</INCLUDE><INCLUDE>AdvertisedTimeAtLocation</INCLUDE>` +
        `<INCLUDE>TimeAtLocation</INCLUDE><INCLUDE>Deleted</INCLUDE><INCLUDE>ProductInformation</INCLUDE>` +
        `<INCLUDE>ActivityType</INCLUDE></QUERY>`;
    },
    onResult: (r, { first = false } = {}) => {
      const list = passingsOf(r.TrainAnnouncement);
      if (list.length) onPassings(list, { first });   // first: the first answer (the last 90 minutes at once)
    },
    onStatus,
    silentMs: 120000,   // passings are rarer than positions at quiet hours
  });
}
// Timetable rows -> the actual passings among them (also used by the fetcher's replay check).
export function passingsOf(rows) {
  const list = [];
  for (const a of rows ?? []) {
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
  return list;
}

// ---------- A train's route for today ----------

// All stops of one train on its date, in order: [{station, activity, advertised, planned, estimated, actual, canceled,
// problems, notes}]. problems: Trafikverket's problem notes at that stop ("Spårändrat", "Kort tåg"); notes: the other
// notes (a bus instead, booking, a bistro, the carriage order). Their texts, in Swedish. In 600 rows (2026-11-13):
// problem notes on 71, other notes on 26, booking 29, bistro or kiosk 11, carriage order 14.
export async function fetchRoute(operationalNumber, departureDate) {
  const r = await ask(
    `<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9" orderby="AdvertisedTimeAtLocation">` +
    `<FILTER><EQ name="OperationalTrainNumber" value="${operationalNumber}"/>` +
    `<EQ name="ScheduledDepartureDateTime" value="${departureDate.slice(0, 10)}"/></FILTER>` +
    `<INCLUDE>LocationSignature</INCLUDE><INCLUDE>ActivityType</INCLUDE><INCLUDE>Advertised</INCLUDE>` +
    `<INCLUDE>AdvertisedTimeAtLocation</INCLUDE><INCLUDE>EstimatedTimeAtLocation</INCLUDE>` +
    `<INCLUDE>TimeAtLocation</INCLUDE><INCLUDE>Canceled</INCLUDE><INCLUDE>TrackAtLocation</INCLUDE>` +
    `<INCLUDE>FromLocation</INCLUDE><INCLUDE>ToLocation</INCLUDE><INCLUDE>ProductInformation</INCLUDE>` +
    `<INCLUDE>Deviation</INCLUDE><INCLUDE>OtherInformation</INCLUDE><INCLUDE>Booking</INCLUDE><INCLUDE>Service</INCLUDE>` +
    `<INCLUDE>TrainComposition</INCLUDE></QUERY>`);
  const texts = list => (list ?? []).map(x => x.Description).filter(Boolean);
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
      track: a.TrackAtLocation ?? '',    // the platform track, e.g. "3" ('' when not given)
      problems: texts(a.Deviation),
      notes: [...texts(a.OtherInformation), ...texts(a.Booking), ...texts(a.Service), ...texts(a.TrainComposition)],
    })),
  };
}

// ---------- Cancelled trains today (the stats page) ----------

// How many trains have at least one cancelled passenger stop on day (Swedish date, "2026-11-13"). A whole
// cancelled trip and a part of one look the same in the data. Measured 2026-11-13: 144 trains, 46 kB, 0.5 s.
export async function fetchCancelledToday(day) {
  const r = await ask(
    `<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9">` +
    `<FILTER><EQ name="Canceled" value="true"/><EQ name="Advertised" value="true"/>` +
    `<EQ name="ScheduledDepartureDateTime" value="${day}"/></FILTER>` +
    `<INCLUDE>OperationalTrainNumber</INCLUDE></QUERY>`);
  return new Set((r.TrainAnnouncement ?? []).map(a => a.OperationalTrainNumber)).size;
}

// ---------- Today's arrivals (the stats page's graph) ----------

// Arrivals at passenger stops with an actual time after `since` (ms: Swedish midnight): [{ id, planned, actual }],
// id = train number + station (shorter than ActivityId, 36 characters). changedSince (ms): only rows changed after
// it (ModifiedTime). Measured 2026-11-13 at 23:50: the whole day ~31,900 rows, 5.4 MB, ~285 kB as sent; changes over 10
// minutes ~150 rows, 2.5 kB. Old rows are changed again too (an hour's changes reached back to 01:23).
export async function fetchDayArrivals(since, changedSince = null) {
  const r = await ask(
    `<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9">` +
    `<FILTER><GT name="TimeAtLocation" value="${new Date(since).toISOString()}"/>` +
    `<EQ name="Advertised" value="true"/><EQ name="ActivityType" value="Ankomst"/>` +
    (changedSince ? `<GT name="ModifiedTime" value="${new Date(changedSince).toISOString()}"/>` : '') + `</FILTER>` +
    `<INCLUDE>OperationalTrainNumber</INCLUDE><INCLUDE>LocationSignature</INCLUDE>` +
    `<INCLUDE>AdvertisedTimeAtLocation</INCLUDE><INCLUDE>TimeAtLocation</INCLUDE></QUERY>`);
  const out = [];
  for (const a of r.TrainAnnouncement ?? []) {
    if (!a.TimeAtLocation || !a.AdvertisedTimeAtLocation || !a.OperationalTrainNumber) continue;
    out.push({ id: `${a.OperationalTrainNumber}|${a.LocationSignature}`, planned: Date.parse(a.AdvertisedTimeAtLocation), actual: Date.parse(a.TimeAtLocation) });
  }
  return out;
}

// ---------- Disruptions ----------

// The disruptions in force now that have a text for travellers (OperativeEvent: Trafikverket's traffic messages,
// replacing TrainMessage since Sep 2025; night of 2026-11-14, docs: night-1114/messages.md: about 8 at a time, 6-15 kB).
// An event can have several impacts, each with its own times and its own text: those in force now are kept.
// [{ id, kind, header, text, since, until (ms or null), level (1 green .. 4 red, Trafikverket's OperatingLevel),
//    point { lon, lat }, sections: [[sig, ...], ...] (each: from, via..., to: where the disruption is) }]
// at: the page's clock (ms).
export async function fetchDisruptions(at) {
  const now = new Date(at).toISOString();
  const r = await ask(
    `<QUERY objecttype="OperativeEvent" namespace="ols.open" schemaversion="1">` +
    `<FILTER><EQ name="EventState" value="1"/><EXISTS name="TrafficImpact.PublicMessage.Header" value="true"/>` +
    `<ELEMENTMATCH><GT name="TrafficImpact.EndDateTime" value="${now}"/><LT name="TrafficImpact.StartDateTime" value="${now}"/></ELEMENTMATCH></FILTER>` +
    ['OperativeEventId', 'EventType.Description', 'Geometry.WGS84', 'EventSection', 'TrafficImpact.StartDateTime',
      'TrafficImpact.EndDateTime', 'TrafficImpact.PublicMessage.Header', 'TrafficImpact.PublicMessage.Description',
      'TrafficImpact.PublicMessage.StartDateTime', 'TrafficImpact.PublicMessage.EndDateTime',
      'TrafficImpact.SelectedSection.OperatingLevel'].map(f => `<INCLUDE>${f}</INCLUDE>`).join('') + `</QUERY>`);
  const out = [];
  for (const e of r.OperativeEvent ?? []) {
    const inForce = (from, to) => (!from || Date.parse(from) <= at) && (!to || Date.parse(to) > at);
    const imps = (e.TrafficImpact ?? []).filter(i => i.PublicMessage?.Header && inForce(i.StartDateTime, i.EndDateTime) &&
      inForce(i.PublicMessage.StartDateTime, i.PublicMessage.EndDateTime));
    if (!imps.length) continue;
    // The event's point is written latitude first (the stations' points the other way round).
    const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(e.Geometry?.WGS84 ?? '');
    const sig = l => l?.Signature ?? null;
    const sections = (e.EventSection ?? []).map(s => [sig(s.FromLocation), sig(s.ViaLocation), sig(s.ToLocation)].filter(Boolean)).filter(s => s.length);
    const ends = imps.map(i => (i.EndDateTime ? Date.parse(i.EndDateTime) : null));
    out.push({
      id: e.OperativeEventId, kind: e.EventType?.Description ?? '', header: imps[0].PublicMessage.Header.trim(),
      text: imps.map(i => i.PublicMessage.Description?.trim()).filter((x, k, a) => x && a.indexOf(x) === k).join('\n\n'),
      since: Math.min(...imps.map(i => Date.parse(i.StartDateTime))), until: ends.includes(null) ? null : Math.max(...ends),
      level: Math.max(0, ...imps.flatMap(i => (i.SelectedSection ?? []).map(s => s.OperatingLevel ?? 0))),
      point: m ? { lat: Number(m[1]), lon: Number(m[2]) } : null, sections,
    });
  }
  return out;
}

// A station's own messages valid now: what its monitors show (TrainStationMessage; 94 stations had one in the night
// of 2026-11-14). Test messages are left out, and the same text only once. [{ text, until (ms or null) }]
export async function fetchStationMessages(sig, at) {
  const now = new Date(at).toISOString();
  const r = await ask(
    `<QUERY objecttype="TrainStationMessage" namespace="rail.trafficinfo" schemaversion="1">` +
    `<FILTER><EQ name="LocationCode" value="${sig}"/><EQ name="MediaType" value="Monitor"/>` +
    `<LT name="StartDateTime" value="${now}"/><GT name="EndDateTime" value="${now}"/></FILTER>` +
    ['FreeText', 'EndDateTime', 'Status'].map(f => `<INCLUDE>${f}</INCLUDE>`).join('') + `</QUERY>`);
  const seen = new Set(), out = [];
  for (const m of r.TrainStationMessage ?? []) {
    const text = String(m.FreeText ?? '').trim();
    if (!text || /testmeddelande/i.test(text) || seen.has(text)) continue;
    seen.add(text);
    out.push({ text, until: m.EndDateTime ? Date.parse(m.EndDateTime) : null });
  }
  return out;
}

// ---------- Stations ----------

// Signature -> { sig, name, lon, lat, advertised } for every station, e.g. "Cst" -> Stockholm C and its place.
// advertised: a station passengers use (720 of 1,757 on 2026-11-12; the rest are junctions, sidings and the like).
export async function fetchStations() {
  const r = await ask(
    `<QUERY objecttype="TrainStation" namespace="rail.infrastructure" schemaversion="1.5">` +
    `<INCLUDE>LocationSignature</INCLUDE><INCLUDE>AdvertisedLocationName</INCLUDE><INCLUDE>Geometry.WGS84</INCLUDE>` +
    `<INCLUDE>Advertised</INCLUDE></QUERY>`);
  return new Map((r.TrainStation ?? []).map(s => {
    const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(s.Geometry?.WGS84 ?? '');
    return [s.LocationSignature, { sig: s.LocationSignature, name: s.AdvertisedLocationName,
      lon: m ? Number(m[1]) : null, lat: m ? Number(m[2]) : null, advertised: s.Advertised === true }];
  }));
}

// ---------- A station's board ----------

// The next trains at a station: departures ('Avgang') or arrivals ('Ankomst'), passenger stops only, at most n.
// A train still counts while it hasn't left (or arrived), however late. at: the page's clock (ms).
// [{ key, operational, date, number, planned, estimated, actual, track, canceled, product, from, to }]
export async function fetchBoard(sig, activity, at, n) {
  const r = await ask(
    `<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9" orderby="AdvertisedTimeAtLocation" limit="${n * 4}">` +
    `<FILTER><EQ name="LocationSignature" value="${sig}"/><EQ name="ActivityType" value="${activity}"/>` +
    `<EQ name="Advertised" value="true"/><EQ name="Deleted" value="false"/>` +
    `<GT name="AdvertisedTimeAtLocation" value="${new Date(at - 90 * 60000).toISOString()}"/></FILTER>` +
    `<INCLUDE>AdvertisedTrainIdent</INCLUDE><INCLUDE>OperationalTrainNumber</INCLUDE><INCLUDE>ScheduledDepartureDateTime</INCLUDE>` +
    `<INCLUDE>AdvertisedTimeAtLocation</INCLUDE><INCLUDE>EstimatedTimeAtLocation</INCLUDE><INCLUDE>TimeAtLocation</INCLUDE>` +
    `<INCLUDE>TrackAtLocation</INCLUDE><INCLUDE>Canceled</INCLUDE><INCLUDE>ProductInformation</INCLUDE>` +
    `<INCLUDE>FromLocation</INCLUDE><INCLUDE>ToLocation</INCLUDE></QUERY>`);
  const rows = (r.TrainAnnouncement ?? []).map(a => ({
    key: trainKey(a.OperationalTrainNumber, a.ScheduledDepartureDateTime),
    operational: a.OperationalTrainNumber, date: a.ScheduledDepartureDateTime.slice(0, 10), number: a.AdvertisedTrainIdent,
    planned: Date.parse(a.AdvertisedTimeAtLocation),
    estimated: a.EstimatedTimeAtLocation ? Date.parse(a.EstimatedTimeAtLocation) : null,
    actual: a.TimeAtLocation ? Date.parse(a.TimeAtLocation) : null,
    track: a.TrackAtLocation ?? '', canceled: a.Canceled === true,
    product: a.ProductInformation?.[0]?.Description ?? null,
    from: a.FromLocation?.[0]?.LocationName ?? null, to: a.ToLocation?.[0]?.LocationName ?? null,
  }));
  // Gone: left (or arrived) before now, or cancelled and planned more than 5 minutes ago. Then the next n.
  return rows.filter(x => !(x.actual && x.actual < at) && !(x.canceled && x.planned < at - 5 * 60000)
    && !(!x.actual && !x.estimated && x.planned < at - 30 * 60000)).slice(0, n);
}

// ---------- A train number in today's timetable ----------

// The trains with this public number running on this day (YYYY-MM-DD, Swedish time):
// [{ key, operational, date, number, from, to, product }] (from/to are station signatures).
export async function fetchTrainsByNumber(number, day) {
  const r = await ask(
    `<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9" limit="200">` +
    `<FILTER><EQ name="AdvertisedTrainIdent" value="${String(number).replace(/\D/g, '')}"/>` +
    `<EQ name="ScheduledDepartureDateTime" value="${day}"/></FILTER>` +
    `<INCLUDE>AdvertisedTrainIdent</INCLUDE><INCLUDE>OperationalTrainNumber</INCLUDE><INCLUDE>ScheduledDepartureDateTime</INCLUDE>` +
    `<INCLUDE>FromLocation</INCLUDE><INCLUDE>ToLocation</INCLUDE><INCLUDE>ProductInformation</INCLUDE></QUERY>`);
  const byKey = new Map();
  for (const a of r.TrainAnnouncement ?? []) {
    const key = trainKey(a.OperationalTrainNumber, a.ScheduledDepartureDateTime);
    if (byKey.has(key)) continue;
    byKey.set(key, { key, operational: a.OperationalTrainNumber, date: a.ScheduledDepartureDateTime.slice(0, 10),
      number: a.AdvertisedTrainIdent, from: a.FromLocation?.[0]?.LocationName ?? null, to: a.ToLocation?.[0]?.LocationName ?? null,
      product: a.ProductInformation?.[0]?.Description ?? null });
  }
  return [...byKey.values()];
}

// ---------- Planned routes ----------

// The timetable rows of these trains (internal numbers) planned between from and to (ms): every location they pass
// or stop at. [{ key (trainKey), sig, activity ('Ankomst' arrival / 'Avgang' departure), planned (ms) }].
// Asked in groups of 100 numbers.
// withBrand: also each row's company (brand). It makes the answer about 29 % bigger (100 trains, 2026-11-13), so it is
// asked only the first time about a train: a company doesn't change.
export async function fetchPlannedRoutes(numbers, from, to, { withBrand = false } = {}) {
  const out = [];
  for (let i = 0; i < numbers.length; i += 100) {
    const r = await ask(
      `<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9">` +
      `<FILTER><IN name="OperationalTrainNumber" value="${numbers.slice(i, i + 100).join(',')}"/>` +
      `<GT name="AdvertisedTimeAtLocation" value="${new Date(from).toISOString()}"/>` +
      `<LT name="AdvertisedTimeAtLocation" value="${new Date(to).toISOString()}"/></FILTER>` +
      `<INCLUDE>OperationalTrainNumber</INCLUDE><INCLUDE>ScheduledDepartureDateTime</INCLUDE>` +
      `<INCLUDE>LocationSignature</INCLUDE><INCLUDE>ActivityType</INCLUDE><INCLUDE>AdvertisedTimeAtLocation</INCLUDE>` +
      `<INCLUDE>Deleted</INCLUDE>${withBrand ? '<INCLUDE>ProductInformation</INCLUDE>' : ''}</QUERY>`);
    for (const a of r.TrainAnnouncement ?? []) {
      if (a.Deleted || !a.AdvertisedTimeAtLocation) continue;
      out.push({ key: trainKey(a.OperationalTrainNumber, a.ScheduledDepartureDateTime), sig: a.LocationSignature,
        activity: a.ActivityType, planned: Date.parse(a.AdvertisedTimeAtLocation),
        brand: a.ProductInformation?.[0]?.Description ?? null });
    }
  }
  return out;
}
