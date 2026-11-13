// Are the dots in the right place? For a few moving trains from the newest recording, look up the last
// station the timetable says each passed (TrainAnnouncement) and how far that station is from the train's
// newest position. A train's dot should be a few km past its last station, not hundreds.
// Run: node tools/crosscheck.mjs [how many=3]
import { readFileSync, readdirSync } from 'node:fs';

const n = Number(process.argv[2] ?? 3);
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => l.trim().split('=')));
const KEY = env.VITE_TRV_KEY;
const API = 'https://api.trafikinfo.trafikverket.se/v2/data.json';

async function query(inner) {
  const res = await fetch(API, {
    method: 'POST', headers: { 'Content-Type': 'text/xml' },
    body: `<REQUEST><LOGIN authenticationkey="${KEY}"/>${inner}</REQUEST>`,
  });
  const json = await res.json();
  const r = json.RESPONSE.RESULT[0];
  if (!res.ok || r.ERROR) throw new Error(JSON.stringify(r.ERROR ?? json).slice(0, 300));
  return r;
}

const pt = s => s.match(/POINT \(([-\d.]+) ([-\d.]+)/).slice(1).map(Number);
const km = ([lo1, la1], [lo2, la2]) => {
  const r = Math.PI / 180, x = (lo2 - lo1) * r * Math.cos((la1 + la2) / 2 * r), y = (la2 - la1) * r;
  return Math.hypot(x, y) * 6371;
};

// Newest position per train from the newest recording; keep moving passenger trains (they have a board number).
const dir = new URL('../data/', import.meta.url);
const file = new URL(readdirSync(dir).filter(f => f.startsWith('positions-')).sort().at(-1), dir);
const newest = new Map();
for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
  const p = JSON.parse(line);
  const known = newest.get(p.Train.OperationalTrainNumber);
  if (!known || Date.parse(p.TimeStamp) > Date.parse(known.TimeStamp)) newest.set(p.Train.OperationalTrainNumber, p);
}
const picks = [...newest.values()]
  .filter(p => p.Speed > 40 && p.Train.AdvertisedTrainNumber)
  .sort((a, b) => Date.parse(b.TimeStamp) - Date.parse(a.TimeStamp))
  .slice(0, n);

const today = new Date().toISOString().slice(0, 10);
for (const p of picks) {
  const num = p.Train.AdvertisedTrainNumber;
  const ann = await query(
    `<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9" orderby="TimeAtLocation desc" limit="1">` +
    `<FILTER><EQ name="AdvertisedTrainIdent" value="${num}"/>` +
    `<EQ name="ScheduledDepartureDateTime" value="${today}"/>` +
    `<EXISTS name="TimeAtLocation" value="true"/></FILTER>` +
    `<INCLUDE>LocationSignature</INCLUDE><INCLUDE>TimeAtLocation</INCLUDE><INCLUDE>ActivityType</INCLUDE>` +
    `</QUERY>`);
  const last = ann.TrainAnnouncement?.[0];
  if (!last) { console.log(`${num}: no station passed today in the timetable`); continue; }
  const st = await query(
    `<QUERY objecttype="TrainStation" namespace="rail.infrastructure" schemaversion="1.5" limit="1">` +
    `<FILTER><EQ name="LocationSignature" value="${last.LocationSignature}"/></FILTER></QUERY>`);
  const station = st.TrainStation?.[0];
  const where = pt(p.Position.WGS84);
  const stationAt = pt(station.Geometry.WGS84);
  const minutes = (Date.parse(p.TimeStamp) - Date.parse(last.TimeAtLocation)) / 60000;
  console.log(
    `${num}: at ${where.map(v => v.toFixed(4)).join(', ')} ${p.Speed} km/h (${p.TimeStamp.slice(11, 19)}); ` +
    `last station ${station.AdvertisedLocationName} (${last.ActivityType} ${last.TimeAtLocation.slice(11, 19)}), ` +
    `${km(where, stationAt).toFixed(1)} km away, ${minutes.toFixed(1)} min later`);
}
