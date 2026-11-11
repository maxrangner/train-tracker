// Which fields do recent timetable rows carry, and what's in the ones that could name the train or vehicle?
// Run: node tools/fields-peek.mjs
import { readFileSync } from 'node:fs';

const key = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/VITE_TRV_KEY=(\S+)/)[1];
const since = new Date(Date.now() - 10 * 60000).toISOString();
const res = await fetch('https://api.trafikinfo.trafikverket.se/v2/data.json', {
  method: 'POST', headers: { 'Content-Type': 'text/xml' },
  body: `<REQUEST><LOGIN authenticationkey="${key}"/><QUERY objecttype="TrainAnnouncement" schemaversion="1.9" limit="600">` +
    `<FILTER><GT name="TimeAtLocation" value="${since}"/></FILTER></QUERY></REQUEST>`,
});
const rows = (await res.json()).RESPONSE.RESULT[0].TrainAnnouncement;
const counts = {};
for (const r of rows) for (const k of Object.keys(r)) counts[k] = (counts[k] ?? 0) + 1;
console.log(`${rows.length} rows; fields (how many rows have them):`);
console.log(counts);
const values = f => [...new Set(rows.map(r => r[f]).filter(v => v !== undefined).map(v => JSON.stringify(v)))];
for (const f of ['TrainComposition', 'NewEquipment', 'ProductInformation', 'TypeOfTraffic', 'InformationOwner', 'Operator', 'TrainOwner', 'OtherInformation', 'Booking', 'Service', 'Deviation']) {
  const v = values(f);
  if (v.length) console.log(`\n${f} (${v.length} different):\n  ${v.slice(0, 15).join('\n  ')}`);
}
