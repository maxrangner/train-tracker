// Trips split over several internal numbers (src/trip.js), checked on saved timetable rows: the pieces of one trip
// are joined, different trains with the same public number are not, and VR 2047's diverted path runs via Fristad to Borås.
// The number search's trips too (tripsOf, one row per trip, 2026-11-16), on the rows cut down to what the search asks.
// Works offline (no key). Run by tools/check.mjs.
// Run: node tools/split-check.mjs            the checks
//      node tools/split-check.mjs --save     asks Trafikverket again for the cases' rows (needs .env) into
//                                            tools/split-cases.json (only while the day is still kept there)
//      node tools/split-check.mjs --show N   one case's joined stops, for a closer look
import { readFileSync, writeFileSync } from 'node:fs';
import { joinPieces, tripsOf, NUMBER_FIELDS } from '../src/trip.js';

const FILE = new URL('./split-cases.json', import.meta.url);
const DAY = '2026-11-15';
// Each case: a public number on DAY, the piece tapped, and what must hold.
//   pieces: how many pieces join; first/last: the first and last passenger stop; has / lacks: stations among the rows.
const CASES = [
  { number: '2047', tapped: '12015', why: 'VR, diverted (Elfel): 2047 + 12015 + 12016', pieces: 3, first: 'Cst', last: 'G', has: ['Hrc', 'Fra'], path: true },
  { number: '2047', tapped: '2047', why: 'the same trip, tapped on its first piece', pieces: 3, first: 'Cst', last: 'G' },
  { number: '384', tapped: '10384', why: 'SJ Malmö → Stockholm, not Vy Göteborg → Oslo with the same number', pieces: 1, first: 'Mc', lacks: ['No.osl'] },
  { number: '384', tapped: '384', why: 'Vy Göteborg → Oslo, not SJ', pieces: 1, lacks: ['Mc'] },
  { number: '7960', tapped: '7960', why: 'there and back (7960 / 7961), not one trip', pieces: 1 },
  { number: '1136', tapped: '11136', why: 'Öresundståg over the border, three pieces', pieces: 3, last: 'Vö' },
  { number: '449', tapped: '449', why: 'SJ, Göteborg C moved to its own number much later', pieces: 2, first: 'Cst', last: 'G' },
  { number: '3587', tapped: '3587', why: 'an ordinary trip in one piece', pieces: 1 },
];

const argv = process.argv.slice(2);
if (argv.includes('--save')) {
  const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => l.trim().split('=')));
  // The same question the page asks (src/trafikverket.js routeQuery), written out here (that file needs Vite).
  const fields = ['AdvertisedTrainIdent', 'OperationalTrainNumber', 'LocationSignature', 'ActivityType', 'Advertised',
    'AdvertisedTimeAtLocation', 'EstimatedTimeAtLocation', 'TimeAtLocation', 'Canceled', 'Deleted', 'FromLocation',
    'ToLocation', 'ProductInformation', 'Deviation'];
  const out = {};
  for (const number of new Set(CASES.map(c => c.number))) {
    const res = await fetch('https://api.trafikinfo.trafikverket.se/v2/data.json', {
      method: 'POST', headers: { 'Content-Type': 'text/xml' },
      body: `<REQUEST><LOGIN authenticationkey="${env.VITE_TRV_KEY}"/><QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" ` +
        `schemaversion="1.9" orderby="AdvertisedTimeAtLocation"><FILTER><EQ name="AdvertisedTrainIdent" value="${number}"/>` +
        `<EQ name="ScheduledDepartureDateTime" value="${DAY}"/></FILTER>${fields.map(f => `<INCLUDE>${f}</INCLUDE>`).join('')}</QUERY></REQUEST>`,
    });
    out[number] = (await res.json()).RESPONSE.RESULT[0].TrainAnnouncement ?? [];
    console.log(`${number}: ${out[number].length} rows`);
  }
  writeFileSync(FILE, JSON.stringify({ day: DAY, saved: new Date().toISOString(), rows: out }) + '\n');
  process.exit(0);
}

const saved = JSON.parse(readFileSync(FILE, 'utf8'));
const stopsOf = trip => trip.rows.filter(a => a.Advertised).map(a => a.LocationSignature);

if (argv.includes('--show')) {
  const n = argv[argv.indexOf('--show') + 1];
  const c = CASES.find(x => x.number === n || x.tapped === n);
  const trip = joinPieces(saved.rows[c.number], c.tapped);
  console.log(`${c.number} tapped ${c.tapped}: ${trip.pieces} pieces, ${trip.from} → ${trip.to}`);
  for (const a of trip.rows) console.log(`  ${String(a.OperationalTrainNumber).padEnd(6)} ${a.Advertised ? 'A' : ' '} ${a.ActivityType.padEnd(7)} ` +
    `${a.LocationSignature.padEnd(8)} ${a.AdvertisedTimeAtLocation.slice(11, 16)}${a.Canceled ? ' cancelled' : ''}`);
  process.exit(0);
}

let failed = 0;
for (const c of CASES) {
  const trip = joinPieces(saved.rows[c.number], c.tapped);
  const problems = [];
  if (!trip) problems.push('no rows for the tapped piece');
  else {
    const stops = stopsOf(trip), sigs = new Set(trip.rows.map(a => a.LocationSignature));
    if (c.pieces !== undefined && trip.pieces !== c.pieces) problems.push(`${trip.pieces} pieces, not ${c.pieces}`);
    if (c.first && stops[0] !== c.first) problems.push(`first stop ${stops[0]}, not ${c.first}`);
    if (c.last && stops.at(-1) !== c.last) problems.push(`last stop ${stops.at(-1)}, not ${c.last}`);
    for (const s of c.has ?? []) if (!sigs.has(s)) problems.push(`${s} missing`);
    for (const s of c.lacks ?? []) if (sigs.has(s)) problems.push(`${s} should not be there`);
    // The same station and event twice in a row (where two pieces meet) would show a station twice.
    trip.rows.forEach((a, i) => { const b = trip.rows[i - 1];
      if (b && b.LocationSignature === a.LocationSignature && b.ActivityType === a.ActivityType) problems.push(`${a.LocationSignature} ${a.ActivityType} twice`); });
    if (c.path) problems.push(...await pathProblems(trip));
  }
  if (problems.length) failed++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${c.number} (tapped ${c.tapped}): ${c.why}${problems.length ? ': ' + problems.join('; ') : ''}`);
}

// The number search: one row per trip. Each number's trips (how many, and how many pieces each), from the rows cut
// down to the search's fields; and every trip is what joinPieces gives from each of its pieces (the card shows it).
const TRIPS = { 2047: [3], 384: [1, 1], 7960: [1, 1], 1136: [3], 449: [2], 3587: [1] };
for (const [number, want] of Object.entries(TRIPS)) {
  const rows = saved.rows[number].map(a => Object.fromEntries(NUMBER_FIELDS.filter(f => f in a).map(f => [f, a[f]])));
  const trips = tripsOf(rows);
  const problems = [];
  const got = trips.map(tr => tr.ops.length);
  if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`trips of ${JSON.stringify(got)} pieces, not ${JSON.stringify(want)}`);
  for (const tr of trips) for (const op of tr.ops) {
    const card = joinPieces(saved.rows[number], op)?.ops ?? [];
    if ([...card].sort().join() !== [...tr.ops].sort().join()) problems.push(`tapping ${op} gives ${card.join('+')}, the row ${tr.ops.join('+')}`);
  }
  if (problems.length) failed++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} search ${number}: ${trips.map(tr => `${tr.ops.join('+')} ${tr.from} → ${tr.to}`).join('; ')}` +
    `${problems.length ? ': ' + problems.join('; ') : ''}`);
}

// The path drawn on the map, built as src/main.js builds it (cancelled stops left out of a split trip): it must pass
// Borås C and stay away from Alingsås (the cancelled old way).
async function pathProblems(trip) {
  const { netFromJSON } = await import('../src/rail-net.js');
  const { pathOf } = await import('../src/path.js');
  const net = netFromJSON(JSON.parse(readFileSync(new URL('../public/rail-net.json', import.meta.url), 'utf8')));
  const stations = new Map(JSON.parse(readFileSync(new URL('../data/stations.json', import.meta.url), 'utf8')).map(s => {
    const m = s.Geometry?.WGS84?.match(/POINT \(([\d.-]+) ([\d.-]+)\)/);
    return [s.LocationSignature, m ? { lon: +m[1], lat: +m[2] } : null];
  }));
  const places = [];
  for (const a of trip.rows) {
    if (trip.pieces > 1 && a.Canceled) continue;
    const st = stations.get(a.LocationSignature);
    if (!st) continue;
    if (places.at(-1)?.sig === a.LocationSignature) continue;
    places.push({ sig: a.LocationSignature, lon: st.lon, lat: st.lat, stop: a.Advertised === true });
  }
  const path = pathOf(places, net);
  // The whole way: from Borås C to Göteborg C the saved rows have no place in between; until the straight corner north
  // of Borås C got its curve (tools/rail-net.mjs, 2026-11-16) that one long jump went 122 km back via Herrljunga and
  // Alingsås instead of 71 km via Hindås.
  const at = path.at[places.findIndex(p => p.sig === 'Bsc')];
  if (at === undefined) return ['Borås C is not among the places'];
  const R = Math.PI / 180;
  const nearest = (sig, from, to) => { const s = stations.get(sig);
    return Math.min(...path.coords.slice(from, to).map(([lon, lat]) => Math.hypot((lon - s.lon) * Math.cos(s.lat * R), lat - s.lat) * R * 6371000)); };
  const out = [];
  if (nearest('Fra', 0, at + 1) > 1000) out.push(`the path misses Fristad (${Math.round(nearest('Fra', 0, at + 1))} m)`);
  if (nearest('A', 0, at + 1) < 5000) out.push(`the path goes by Alingsås before Borås C (${Math.round(nearest('A', 0, at + 1))} m)`);
  if (nearest('Hås', at) > 1000) out.push(`the path misses Hindås after Borås C (${Math.round(nearest('Hås', at))} m)`);
  if (nearest('A', at) < 5000) out.push(`the path goes by Alingsås after Borås C (${Math.round(nearest('A', at))} m)`);
  return out;
}

const total = CASES.length + Object.keys(TRIPS).length;
console.log(failed ? `split-check: ${failed} of ${total} failed` : `split-check: all ${total} hold`);
process.exit(failed ? 1 : 0);
