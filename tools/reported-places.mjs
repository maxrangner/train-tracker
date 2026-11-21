// The places Trafikverket reports passenger trains passing (Max, 2026-11-21: his B, "hide places Trafikverket never
// reports for passenger trains"): every station that has, in a recording, a row not shown to passengers with a time,
// for a trip with passenger stops or a product. The card's "All places" shows a place worked out ahead of a train
// only if it is on this list (src/places-ahead.js): measured on days the list had not seen (2026-11-21, 18 and
// 19 Nov), the places shown that never got a time went 12 % -> 2-3 %, the places found stayed 92-94 %, none really
// passed was hidden. Writes src/reported-places.js. Run again when new recordings have come (TODO: before a release):
// a place Trafikverket starts reporting later is hidden until then.
// Run: node tools/reported-places.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const files = readdirSync('data').filter(f => /^(timetable|routes)-.*\.jsonl$/.test(f)).sort();
const reported = new Set();
let trips = 0;
for (const f of files) {
  const byTrip = new Map();
  for (const line of readFileSync(`data/${f}`, 'utf8').split('\n')) {
    if (!line) continue;
    const a = JSON.parse(line);
    if (a.Deleted) continue;
    const k = `${a.OperationalTrainNumber}|${a.ScheduledDepartureDateTime}`;
    let t = byTrip.get(k);
    if (!t) byTrip.set(k, t = { passenger: false, passed: new Set() });
    if (a.Advertised || a.ProductInformation?.length) t.passenger = true;
    if (!a.Advertised && a.TimeAtLocation && a.LocationSignature) t.passed.add(a.LocationSignature);
  }
  for (const t of byTrip.values()) if (t.passenger) { trips++; for (const s of t.passed) reported.add(s); }
}
const sigs = [...reported].sort();
if (sigs.some(s => /\s/.test(s))) throw new Error('a station code with a space: the list is written space-separated');
const days = [...new Set(files.map(f => f.replace(/^\w+-/, '').slice(0, 10)))].sort();
const out = `// Made by tools/reported-places.mjs from ${files.length} recordings (${days[0]} to ${days.at(-1)}, ${trips} passenger trips): the ${sigs.length}\n` +
  `// places Trafikverket has reported a passenger train passing. Don't edit by hand; run the tool again.\n` +
  `export const REPORTED = new Set(${JSON.stringify(sigs.join(' '))}.split(' '));\n`;
writeFileSync('src/reported-places.js', out);
console.log(`src/reported-places.js: ${sigs.length} places from ${files.length} recordings, ${trips} passenger trips (${out.length} bytes)`);
