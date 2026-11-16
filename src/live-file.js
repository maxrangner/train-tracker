// The format of the fetcher's files (public-plan step 2), in one place: the fetcher writes with these (fetcher/files.mjs)
// and the page reads with them. Plain JavaScript, no page parts. Rows are short arrays to keep the files small; they
// turn back into exactly the shapes the page already uses (src/trains-source.js toRecord, src/trafikverket.js
// passingsOf / fetchPlannedRoutes), positions rounded to 5 decimals (about 1 m).
export const FORMAT = 1;
const r5 = x => Math.round(x * 1e5) / 1e5;

// A position record -> [id, number, lon, lat, speed, bearing, ms before t of the report, gone]; t: the file's time.
export const trainRow = (r, t) => [r.id, r.number, r5(r.lon), r5(r.lat), r.speed, r.bearing, t - r.time, r.gone ? 1 : 0];
export function trainOf(row, t) {
  const [id, number, lon, lat, speed, bearing, ago, gone] = row;
  const cut = id.lastIndexOf('/');
  return { id, operational: id.slice(0, cut), date: id.slice(cut + 1), number, lon, lat, speed, bearing, time: t - ago, gone: gone === 1 };
}

// A passing -> [key, minutes late, station, time, company, activity].
export const passingRow = p => [p.key, p.minutes, p.station, p.time, p.brand, p.activity];
export const passingOf = ([key, minutes, station, time, brand, activity]) => ({ key, minutes, station, time, brand, activity });

// A planned row -> [key, station, 'A' arrival / 'D' departure, planned]; the company comes per train (brands).
export const plannedRow = r => [r.key, r.sig, r.activity === 'Ankomst' ? 'A' : 'D', r.planned];
export const plannedOf = ([key, sig, a, planned], brands = {}) =>
  ({ key, sig, activity: a === 'A' ? 'Ankomst' : 'Avgang', planned, brand: brands[key] ?? null });

// The live file's name for moment t (a new one every 5 s): a page asks for the newest finished one.
export const LIVE_MS = 5000;
export const liveName = t => `live-${Math.floor(t / LIVE_MS)}.json`;
