// Every brand (ProductInformation) in today's timetable: how many trains, who owns the information, who runs them.
// Run: node tools/brands.mjs   -> prints a table and writes data/brands-today.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const key = readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/VITE_TRV_KEY=(\S+)/)[1];
const today = new Date().toISOString().slice(0, 10);
const res = await fetch('https://api.trafikinfo.trafikverket.se/v2/data.json', {
  method: 'POST', headers: { 'Content-Type': 'text/xml' },
  body: `<REQUEST><LOGIN authenticationkey="${key}"/>` +
    `<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9">` +
    `<FILTER><EQ name="ScheduledDepartureDateTime" value="${today}"/><EQ name="ActivityType" value="Avgang"/></FILTER>` +
    `<INCLUDE>OperationalTrainNumber</INCLUDE><INCLUDE>ProductInformation</INCLUDE>` +
    `<INCLUDE>InformationOwner</INCLUDE><INCLUDE>Operator</INCLUDE><INCLUDE>TypeOfTraffic</INCLUDE>` +
    `</QUERY></REQUEST>`,
});
const rows = (await res.json()).RESPONSE.RESULT[0].TrainAnnouncement;

const trains = new Map();   // train number -> {brand, owner, operator}
for (const r of rows) {
  const t = trains.get(r.OperationalTrainNumber) ?? {};
  const brand = r.ProductInformation?.[0]?.Description;   // the first entry is the brand; a second is a line number
  if (brand) t.brand = brand;
  if (r.InformationOwner) t.owner = r.InformationOwner;
  if (r.Operator) t.operator = r.Operator;
  trains.set(r.OperationalTrainNumber, t);
}

const brands = new Map();
let none = 0;
for (const t of trains.values()) {
  if (!t.brand) { none++; continue; }
  const b = brands.get(t.brand) ?? { brand: t.brand, trains: 0, owners: new Set(), operators: new Set() };
  b.trains++;
  if (t.owner) b.owners.add(t.owner);
  if (t.operator) b.operators.add(t.operator);
  brands.set(t.brand, b);
}
const list = [...brands.values()].sort((a, b) => b.trains - a.trains)
  .map(b => ({ brand: b.brand, trains: b.trains, owners: [...b.owners], operators: [...b.operators] }));

console.log(`${rows.length} departures today, ${trains.size} trains; ${none} without a brand (freight, service)`);
for (const b of list) console.log(`${String(b.trains).padStart(5)}  ${b.brand.padEnd(26)} ${b.owners.join(', ').padEnd(30)} ${b.operators.join(', ')}`);
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/brands-today.json', import.meta.url), JSON.stringify({ date: today, withoutBrand: none, brands: list }, null, 1));
