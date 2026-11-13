// Check the route and station queries used by the page, against one train in the newest recording.
// Run: node tools/route-peek.mjs
import { readFileSync, readdirSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => l.trim().split('=')));
const ask = async (q) => {
  const res = await fetch('https://api.trafikinfo.trafikverket.se/v2/data.json', {
    method: 'POST', headers: { 'Content-Type': 'text/xml' },
    body: `<REQUEST><LOGIN authenticationkey="${env.VITE_TRV_KEY}"/>${q}</REQUEST>`,
  });
  const r = (await res.json()).RESPONSE.RESULT[0];
  if (r.ERROR) throw new Error(JSON.stringify(r.ERROR));
  return r;
};

const dir = new URL('../data/', import.meta.url);
const file = new URL(readdirSync(dir).filter(f => f.startsWith('positions-')).sort().at(-1), dir);
const p = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l)).reverse()
  .find(x => x.Speed > 50 && x.Train.AdvertisedTrainNumber);
const num = p.Train.OperationalTrainNumber, date = p.Train.OperationalTrainDepartureDate.slice(0, 10);

const st = await ask(`<QUERY objecttype="TrainStation" namespace="rail.infrastructure" schemaversion="1.5">` +
  `<INCLUDE>LocationSignature</INCLUDE><INCLUDE>AdvertisedLocationName</INCLUDE></QUERY>`);
const names = new Map(st.TrainStation.map(s => [s.LocationSignature, s.AdvertisedLocationName]));
console.log(`${names.size} stations, e.g. Cst = ${names.get('Cst')}`);

const r = await ask(`<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9" orderby="AdvertisedTimeAtLocation">` +
  `<FILTER><EQ name="OperationalTrainNumber" value="${num}"/><EQ name="ScheduledDepartureDateTime" value="${date}"/></FILTER>` +
  `<INCLUDE>LocationSignature</INCLUDE><INCLUDE>ActivityType</INCLUDE><INCLUDE>Advertised</INCLUDE>` +
  `<INCLUDE>AdvertisedTimeAtLocation</INCLUDE><INCLUDE>EstimatedTimeAtLocation</INCLUDE><INCLUDE>TimeAtLocation</INCLUDE>` +
  `<INCLUDE>Canceled</INCLUDE><INCLUDE>FromLocation</INCLUDE><INCLUDE>ToLocation</INCLUDE><INCLUDE>ProductInformation</INCLUDE></QUERY>`);
const rows = r.TrainAnnouncement;
console.log(`train ${p.Train.AdvertisedTrainNumber} (${num}) on ${date}: ${rows.length} rows; ` +
  `from ${JSON.stringify(rows[0]?.FromLocation)} to ${JSON.stringify(rows[0]?.ToLocation)}; product ${JSON.stringify(rows[0]?.ProductInformation)}`);
for (const a of rows.filter(x => x.Advertised).slice(0, 8))
  console.log(`  ${a.ActivityType.padEnd(7)} ${(names.get(a.LocationSignature) ?? a.LocationSignature).padEnd(20)} ` +
    `${a.AdvertisedTimeAtLocation.slice(11, 16)} actual ${a.TimeAtLocation?.slice(11, 16) ?? '-'} est ${a.EstimatedTimeAtLocation?.slice(11, 16) ?? '-'}`);
