// What do the timetable's passings look like? The last 15 minutes of actual passings, and the minutes off timetable.
// Run: node tools/late-peek.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => l.trim().split('=')));

const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
const body = `<REQUEST><LOGIN authenticationkey="${env.VITE_TRV_KEY}"/>
<QUERY objecttype="TrainAnnouncement" schemaversion="1.9" sseurl="true">
  <FILTER><GT name="TimeAtLocation" value="${since}"/></FILTER>
  <INCLUDE>AdvertisedTrainIdent</INCLUDE><INCLUDE>OperationalTrainNumber</INCLUDE>
  <INCLUDE>ScheduledDepartureDateTime</INCLUDE><INCLUDE>LocationSignature</INCLUDE>
  <INCLUDE>ActivityType</INCLUDE><INCLUDE>Advertised</INCLUDE>
  <INCLUDE>AdvertisedTimeAtLocation</INCLUDE><INCLUDE>TimeAtLocation</INCLUDE>
  <INCLUDE>EstimatedTimeAtLocation</INCLUDE><INCLUDE>Canceled</INCLUDE>
</QUERY></REQUEST>`;
const res = await fetch('https://api.trafikinfo.trafikverket.se/v2/data.json', {
  method: 'POST', headers: { 'Content-Type': 'text/xml' }, body,
});
const r = (await res.json()).RESPONSE.RESULT[0];
if (r.ERROR) { console.log(r.ERROR); process.exit(1); }
const a = r.TrainAnnouncement;
const trains = new Set(a.map(x => x.AdvertisedTrainIdent + '/' + x.ScheduledDepartureDateTime));
const off = a.map(x => (Date.parse(x.TimeAtLocation) - Date.parse(x.AdvertisedTimeAtLocation)) / 60000).sort((p, q) => p - q);
const q = f => off[Math.floor(f * off.length)].toFixed(1);
console.log(`HTTP ${res.status}; ${a.length} passings in 15 min, ${trains.size} trains; stream: ${Boolean(r.INFO?.SSEURL)}`);
console.log(`minutes off timetable: 10% ${q(.1)}, median ${q(.5)}, 90% ${q(.9)}; advertised (passenger) stops: ${a.filter(x => x.Advertised).length}`);
console.log('sample:', JSON.stringify(a.slice(0, 2), null, 1));
