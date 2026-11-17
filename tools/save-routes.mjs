// Saves the whole route of every train in a recording (the train card's question, src/trafikverket.js routeQuery,
// with the public number and the day added) to data/routes-<name>.jsonl, one timetable row per line, so a replay's
// card reads them (src/replay-source.js) instead of asking Trafikverket, which keeps a day's routes only about 4 days
// (2026-11-17: 13 Nov still there, 12 Nov gone; every card in a replay of 12 Nov said "no stops").
// Run: node tools/save-routes.mjs <recording name>...   (tools/collect.mjs runs it at the end of each recording)
// Asked by public number, so a trip split over several internal numbers comes whole (src/trip.js); trains without
// one by their internal number. 40 numbers to a request, one request at a time. Measured 2026-11-17: 194-537 trains,
// 4-12 requests, 3.4-5.8 MB a recording; trains from the day before a night recording may already be gone.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ROUTE_FIELDS } from '../src/trafikverket.js';

const API = 'https://api.trafikinfo.trafikverket.se/v2/data.json';
const FIELDS = ['AdvertisedTrainIdent', 'ScheduledDepartureDateTime', ...ROUTE_FIELDS];
const key = /^VITE_TRV_KEY=(.*)$/m.exec(readFileSync(new URL('../.env', import.meta.url), 'utf8'))?.[1].trim();
const dataDir = new URL('../data/', import.meta.url);

const ask = async (query) => {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/xml' },
    body: `<REQUEST><LOGIN authenticationkey="${key}"/>${query}</REQUEST>` });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).RESPONSE.RESULT[0].TrainAnnouncement ?? [];
};
const query = (field, values, day) =>
  `<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9" orderby="AdvertisedTimeAtLocation">` +
  `<FILTER><EQ name="ScheduledDepartureDateTime" value="${day}"/><OR>${values.map(v => `<EQ name="${field}" value="${v}"/>`).join('')}</OR></FILTER>` +
  FIELDS.map(f => `<INCLUDE>${f}</INCLUDE>`).join('') + `</QUERY>`;

export async function saveRoutes(name) {
  const file = new URL(`positions-${name}.jsonl`, dataDir);
  if (!existsSync(file)) throw new Error(`no recording data/positions-${name}.jsonl`);
  const wanted = new Map();   // day -> { public numbers, internal numbers of trains without one }
  const onMap = new Set();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    const p = JSON.parse(line);
    if (!p.Train?.OperationalTrainDepartureDate) continue;
    const day = p.Train.OperationalTrainDepartureDate.slice(0, 10);
    const w = wanted.get(day) ?? wanted.set(day, { pub: new Set(), op: new Set() }).get(day);
    if (p.Train.AdvertisedTrainNumber) w.pub.add(p.Train.AdvertisedTrainNumber); else w.op.add(p.Train.OperationalTrainNumber);
    onMap.add(`${p.Train.OperationalTrainNumber}/${day}`);
  }
  const rows = [];
  let requests = 0;
  for (const [day, w] of wanted) {
    for (const [field, set] of [['AdvertisedTrainIdent', w.pub], ['OperationalTrainNumber', w.op]]) {
      const list = [...set];
      for (let i = 0; i < list.length; i += 40) {
        rows.push(...await ask(query(field, list.slice(i, i + 40), day)));
        requests++;
      }
    }
  }
  const text = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(new URL(`routes-${name}.jsonl`, dataDir), text);
  const have = new Set(rows.map(a => `${a.OperationalTrainNumber}/${a.ScheduledDepartureDateTime.slice(0, 10)}`));
  const missing = [...onMap].filter(k => !have.has(k));
  return `routes-${name}.jsonl: ${onMap.size - missing.length} of ${onMap.size} trains, ${rows.length} rows, ${requests} requests, ` +
    `${(text.length / 1e6).toFixed(1)} MB${missing.length ? `; no route: ${missing.slice(0, 10).join(' ')}${missing.length > 10 ? ' …' : ''}` : ''}`;
}

if (process.argv[1]?.endsWith('save-routes.mjs')) {   // run, not imported (tools/collect.mjs imports it)
  if (!key) { console.log('no key: VITE_TRV_KEY in .env'); process.exit(1); }
  for (const name of process.argv.slice(2)) console.log(await saveRoutes(name));
}
