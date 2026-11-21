// The places a train passes without stopping, worked out from its drawn route (src/path.js). Max, 2026-11-21: every
// place between the stops on the card, "Ahead is important. No times." Trafikverket lists such a place only once the
// train has passed it (docs/data.md: ahead of the trains 175 passing rows against 10,029 stop rows), so the ones ahead
// are the stations (TrainStation, every driftplats) whose point lies within NEAR_M metres of the route, in the
// route's order, and only those Trafikverket reports passenger trains passing (src/reported-places.js; Max's B,
// 2026-11-21: freight yards beside the line and the like left out). How often that matches the places really passed:
// tools/places-check.mjs. Plain JavaScript, no page parts.

import { progressAlong } from './path.js';
import { REPORTED } from './reported-places.js';

export const NEAR_M = 50;   // (tools/places-check.mjs, 17-19 Nov: 94 % of the places passed found, 12 % of those shown never reported; wider finds no more)
const R = Math.PI / 180, M = R * 6371000;
const CELL = 0.01;   // degrees: the grid the stations are kept in (about 1.1 km north-south)

// The stations in a grid, once per list (stations: an iterable of { sig, lon, lat }).
const grids = new WeakMap();
function gridOf(stations) {
  let g = grids.get(stations);
  if (g) return g;
  g = new Map();
  for (const s of stations.values ? stations.values() : stations) {
    if (s?.lon == null || s.lat == null) continue;
    const k = `${Math.floor(s.lon / CELL)}:${Math.floor(s.lat / CELL)}`;
    (g.get(k) ?? g.set(k, []).get(k)).push(s);
  }
  grids.set(stations, g);
  return g;
}

// The stations along a path ({ coords }): [{ sig, f, d }], f the share of the path's length (0 to 1, as
// progressAlong in src/path.js) at the point nearest the station, d metres from it; in the path's order. A station
// whose nearest point is the path's very start or end (beyond its ends) is left out. Kept on the path per list.
export function placesAlong(path, stations, nearM = NEAR_M) {
  const key = `${nearM}`;
  if (path._along?.stations === stations && path._along.key === key) return path._along.list;
  const c = path.coords, g = gridOf(stations), n = c.length;
  const cum = progressAlong(path);   // (the share of the length at each point, in the units progressAt uses)
  const best = new Map();   // sig -> { sig, f, d }
  const padLat = nearM / M;   // (degrees)
  for (let i = 0; i + 1 < n; i++) {
    const [ax, ay] = c[i], [bx, by] = c[i + 1], padLon = padLat / Math.cos(Math.max(Math.abs(ay), Math.abs(by)) * R);
    const x0 = Math.floor((Math.min(ax, bx) - padLon) / CELL), x1 = Math.floor((Math.max(ax, bx) + padLon) / CELL);
    const y0 = Math.floor((Math.min(ay, by) - padLat) / CELL), y1 = Math.floor((Math.max(ay, by) + padLat) / CELL);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const s of g.get(`${x}:${y}`) ?? []) {
      const kx = Math.cos(s.lat * R);
      const px = (ax - s.lon) * kx * M, py = (ay - s.lat) * M, vx = (bx - ax) * kx * M, vy = (by - ay) * M, L2 = vx * vx + vy * vy;
      const t = L2 ? Math.max(0, Math.min(1, -(px * vx + py * vy) / L2)) : 0;
      const d = Math.hypot(px + vx * t, py + vy * t);
      if (d > nearM) continue;
      const was = best.get(s.sig);
      if (!was || d < was.d) best.set(s.sig, { sig: s.sig, f: cum[i] + (cum[i + 1] - cum[i]) * t, d, end: (i === 0 && t === 0) || (i === n - 2 && t === 1) });
    }
  }
  const list = [...best.values()].filter(p => !p.end).map(({ sig, f, d }) => ({ sig, f, d })).sort((a, b) => a.f - b.f);
  path._along = { stations, key, list };
  return list;
}

// Every place the trip passes without stopping, for the card's "All places" (src/panel.js; Max, 2026-11-21, sketch C),
// put between the card's stops. route: fetchRoute's ({ stops: Trafikverket's rows in order, { station, advertised,
// actual, ... } }); stops: the card's stops (panel.js stopsOf: [{ station, arr, dep }]); path: the route drawn from
// pathPlaces (src/main.js: the trip's stations in order, path.at[k] the point of pathPlaces[k]), or null (not drawn
// yet: Trafikverket's own rows only); stations: sig -> { lon, lat }; trainF: the share of the path the train has
// come (progressAt), or null.
// Returns between: between[i] the places after stop i (the last: after the end), each { sig, row (Trafikverket's row,
// or null: worked out from the route), passed }. Passed: it has a time, or lies before the train (or before the last
// place with a time): Trafikverket reports only some places (docs/data.md), so a place behind the train may have none.
// listed: the places a worked-out one must be among (REPORTED; null: every station, for tools/places-check.mjs --all).
export function tripPlaces(route, stops, path, pathPlaces, stations, trainF = null, listed = REPORTED) {
  const between = stops.map(() => []);
  if (!stops.length) return between;
  const stopSigs = new Set(stops.map(s => s.station));
  // Trafikverket's rows for the places passed (one per place: the one with a time), and the stop each comes after.
  const known = new Map();
  let k = 0;
  for (const s of route.stops) {
    if (s.advertised) { if (stops[k + 1]?.station === s.station) k++; continue; }
    if (stopSigs.has(s.station)) continue;
    const was = known.get(s.station);
    if (!was) known.set(s.station, { sig: s.station, row: s, after: k });
    else if (s.actual && !was.row.actual) was.row = s;
  }
  if (!path || !pathPlaces) {
    for (const p of known.values()) between[p.after].push({ sig: p.sig, row: p.row, passed: Boolean(p.row.actual) });
    return between;
  }
  // The share along the path of each stop and each known place (their first place in pathPlaces, in order).
  const prog = progressAlong(path);
  const fOf = new Map();
  pathPlaces.forEach((p, j) => { if (!fOf.has(p.sig)) fOf.set(p.sig, prog[path.at[j]]); });
  const stopF = stops.map(s => fOf.get(s.station) ?? null);
  for (let i = 1; i < stopF.length; i++) if (stopF[i] === null || stopF[i] < (stopF[i - 1] ?? 0)) stopF[i] = stopF[i - 1];
  let passedF = trainF ?? -1;
  stops.forEach((s, i) => { if ((s.dep ?? s.arr)?.actual && stopF[i] !== null) passedF = Math.max(passedF, stopF[i]); });
  const all = [];
  for (const p of known.values()) {
    const f = fOf.get(p.sig) ?? null;
    if (p.row.actual && f !== null) passedF = Math.max(passedF, f);
    all.push({ sig: p.sig, row: p.row, f, after: p.after });
  }
  for (const p of placesAlong(path, stations)) {
    if ((listed && !listed.has(p.sig)) || stopSigs.has(p.sig) || known.has(p.sig) || p.f < (stopF[0] ?? 0)) continue;
    all.push({ sig: p.sig, row: null, f: p.f, after: null });
  }
  for (const p of all) {
    let gap = p.after ?? 0;
    if (p.f !== null) { gap = 0; for (let i = 0; i < stopF.length; i++) if (stopF[i] !== null && stopF[i] <= p.f) gap = i; }
    between[gap].push({ sig: p.sig, row: p.row, passed: Boolean(p.row?.actual) || (p.f !== null && p.f <= passedF), f: p.f ?? stopF[gap] ?? 0 });
  }
  for (const g of between) g.sort((a, b) => a.f - b.f);
  return between;
}
