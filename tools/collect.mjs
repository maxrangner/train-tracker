// Listen to Trafikverket's live streams for a while and save every message, for replays (tools/motion-check.mjs).
// Run: node tools/collect.mjs [minutes=10] [--at 07:00]
//   -> data/positions-<time>.jsonl  every train position (one per line)
//   -> data/timetable-<time>.jsonl  every timetable row (planned stops in the window, and their changes: passings)
//   -> data/stations.json           every station's name and place (once)
//   -> data/routes-<time>.jsonl     at the end: every train's whole route, for the card in a replay (tools/save-routes.mjs)
// --at waits until that time of day (this computer's clock) before starting. Keep the computer awake meanwhile.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { saveRoutes } from './save-routes.mjs';

const argv = process.argv.slice(2);
const at = argv.includes('--at') ? argv[argv.indexOf('--at') + 1] : null;
const minutes = Number(argv.find((a, i) => /^\d+$/.test(a) && argv[i - 1] !== '--at') ?? 10);
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => l.trim().split('=')));
const key = env.VITE_TRV_KEY;
const API = 'https://api.trafikinfo.trafikverket.se/v2/data.json';

if (at) {
  const [h, m] = at.split(':').map(Number);
  const start = new Date(); start.setHours(h, m, 0, 0);
  if (start < new Date()) start.setDate(start.getDate() + 1);
  console.log(`waiting until ${start.toString().slice(0, 21)}`);
  await new Promise(r => setTimeout(r, start - new Date()));
}

const dir = new URL('../data/', import.meta.url);
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
// A question gives up after ASK_MS, answer and all (2026-11-19, TODO 45: on 18 Nov at 15:16 both streams broke with the
// network gone, the new question never answered nor failed, and 15 of the 30 minutes were lost); then again in 5 s.
const ASK_MS = 30 * 1000, SILENT_MS = 3 * 60 * 1000;
const ask = async (query) => {
  const res = await fetch(API, {
    method: 'POST', headers: { 'Content-Type': 'text/xml' },
    body: `<REQUEST><LOGIN authenticationkey="${key}"/>${query}</REQUEST>`,
    signal: AbortSignal.timeout(ASK_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).RESPONSE.RESULT[0];
};

// Stations: names and places, for the timetable step.
const stationsFile = new URL('stations.json', dir);
if (!existsSync(stationsFile)) {
  const r = await ask(`<QUERY objecttype="TrainStation" namespace="rail.infrastructure" schemaversion="1.5">` +
    `<INCLUDE>LocationSignature</INCLUDE><INCLUDE>AdvertisedLocationName</INCLUDE><INCLUDE>Geometry.WGS84</INCLUDE></QUERY>`);
  writeFileSync(stationsFile, JSON.stringify(r.TrainStation ?? []));
  console.log(`stations: ${r.TrainStation?.length ?? 0}`);
}

// Ask once with a stream address, save the answer, then save everything the stream sends until the end.
// If the stream breaks, ask again from the last change and go on.
const end = Date.now() + minutes * 60 * 1000;
async function record(name, objectType, makeQuery) {
  const out = new URL(`${name}-${stamp}.jsonl`, dir);
  const save = (p, via) => appendFileSync(out, JSON.stringify({ got: new Date().toISOString(), via, ...p }) + '\n');
  let changeId = null, count = 0, first = true;
  while (Date.now() < end) {
    let result;
    try {
      result = await ask(makeQuery(changeId));
    } catch (e) {
      console.log(`${name}: ${e.message}; again in 5 s`);
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    changeId = result.INFO?.LASTCHANGEID ?? changeId;
    for (const p of result[objectType] ?? []) save(p, first ? 'start' : 'catchup');
    if (first) console.log(`${name}: ${result[objectType]?.length ?? 0} at the start -> ${out.pathname}`);
    first = false;
    const ctrl = new AbortController();
    const stop = setTimeout(() => ctrl.abort(), end - Date.now());
    // A stream silent for SILENT_MS is given up and asked for again (one that stops without closing was never noticed;
    // 3 minutes as the fetcher's timetable stream, src/trafikverket.js follow silentMs).
    let silent = null, wasSilent = false;
    const arm = () => { clearTimeout(silent); silent = setTimeout(() => { wasSilent = true; ctrl.abort(); }, SILENT_MS); };
    try {
      arm();
      const stream = await fetch(result.INFO.SSEURL, { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of stream.body) {
        arm();
        // Trafikverket sends \r\n. Replaced after joining: a \r\n split between two chunks, replaced per chunk, glued
        // two messages into one (a JSON error and a lost stream about once an hour, 2026-11-12).
        buf = (buf + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const event = buf.slice(0, i); buf = buf.slice(i + 2);
          const id = /^id:\s*(.+)$/m.exec(event)?.[1];
          if (id) changeId = id.trim();
          const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('');
          if (!data) continue;
          for (const r of JSON.parse(data).RESPONSE.RESULT)
            for (const p of r[objectType] ?? []) { save(p, 'stream'); count++; }
        }
      }
      if (Date.now() < end) console.log(`${name}: the stream ended; asking again`);
    } catch (e) {
      if (wasSilent) console.log(`${name}: nothing for ${SILENT_MS / 60000} min; asking again`);
      else if (e.name !== 'AbortError') console.log(`${name}: stream broke (${e.message}); asking again`);
    } finally {
      clearTimeout(stop);
      clearTimeout(silent);
    }
  }
  console.log(`${name}: done, ${count} from the stream`);
}

const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
// Timetable rows planned from an hour before the start to two hours after the end: the stops ahead of every train
// on the map, and every passing (TimeAtLocation) as it happens.
// Both streams are asked for deleted objects too (includedeletedobjects): Trafikverket leaves them out otherwise, so
// a recording could not show a row or a position being taken away. The tools skip rows marked Deleted.
const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const to = new Date(end + 2 * 60 * 60 * 1000).toISOString();
await Promise.all([
  record('positions', 'TrainPosition', (changeId) =>
    `<QUERY objecttype="TrainPosition" namespace="järnväg.trafikinfo" schemaversion="1.1" sseurl="true" includedeletedobjects="true" changeid="${changeId ?? 0}">` +
    `<FILTER><GT name="TimeStamp" value="${since}"/></FILTER></QUERY>`),
  record('timetable', 'TrainAnnouncement', (changeId) =>
    `<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9" sseurl="true" includedeletedobjects="true" changeid="${changeId ?? 0}">` +
    `<FILTER><GT name="AdvertisedTimeAtLocation" value="${from}"/><LT name="AdvertisedTimeAtLocation" value="${to}"/></FILTER>` +
    `<INCLUDE>OperationalTrainNumber</INCLUDE><INCLUDE>ScheduledDepartureDateTime</INCLUDE>` +
    `<INCLUDE>LocationSignature</INCLUDE><INCLUDE>ActivityType</INCLUDE><INCLUDE>Advertised</INCLUDE>` +
    `<INCLUDE>AdvertisedTimeAtLocation</INCLUDE><INCLUDE>EstimatedTimeAtLocation</INCLUDE>` +
    `<INCLUDE>TimeAtLocation</INCLUDE><INCLUDE>Canceled</INCLUDE><INCLUDE>Deleted</INCLUDE>` +
    `<INCLUDE>ProductInformation</INCLUDE><INCLUDE>ModifiedTime</INCLUDE></QUERY>`),
]);
// Every train's whole route, for the card in a replay (Trafikverket keeps them only about 4 days; tools/save-routes.mjs).
try {
  console.log(await saveRoutes(stamp));
} catch (e) {
  console.log(`routes not saved (${e.message}): node tools/save-routes.mjs ${stamp} within 4 days`);
}
