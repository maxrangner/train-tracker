// The day (build plan part 4, 2026-11-22): every train's place at an earlier moment today, from the fetcher's history
// files (src/live-file.js historyRow; read by src/files-source.js history()). Plain JavaScript, no page parts, so Node
// measures it (tools/history-size.mjs) and checks it (tools/history-check.mjs).
//   const day = createDayTrains({ net });   // net: the rail network (src/rail-net.js), or null: straight lines
//   day.add(file)                           // a history file, or a slot of files-source's history() (any order; the
//                                           // same slot twice is ignored)
//   day.at(T)                               // every train on the map at moment T, in the shape src/trains.js placedAt
//                                           // gives, plus what the map shows about it (below)
// Between two points a train moves at an even pace from the one to the next: along the rails when the network finds
// a way between them no longer than 1.5 times the straight line + 300 m (else straight). Each way is worked out once,
// when a train first needs it, and kept. Before its first point and after its last a train stands at that point; it is
// on the map while a slot says it was (from its first report or sample .. its last sample + one), so a gap with no
// file shows no trains.
import { polyAt } from './rail-net.js';
import { historyOf, HISTORY_EVERY_MS } from './live-file.js';

const R = Math.PI / 180;
const MAX_GAP_MS = 10 * 60 * 1000;   // points further apart: the train stands at the first until the second (no report)
const SNAP_M = 60;
const metres = (a, b) => { const kx = Math.cos(((a.lat + b.lat) / 2) * R); return Math.hypot((b.lon - a.lon) * kx, b.lat - a.lat) * R * 6371000; };
const bearingOf = (a, b) => (Math.atan2((b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * R), b.lat - a.lat) / R + 360) % 360;
// The last index i with list[i][key] <= t (-1: none).
function lastAtOrBefore(list, t, key) {
  let lo = -1, hi = list.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (list[mid][key] <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

export function createDayTrains({ net = null } = {}) {
  const trains = new Map();   // id -> { id, number, brand, start, end, spans: [{ from, until }], points: [...], way: Map(i -> poly | null) }
  const slots = new Set();
  const counts = { ways: 0, straight: 0 };

  // file: a history file ({ t, slot, every, trains }) or one of src/files-source.js history()'s slots ({ slot, t,
  // every, rows }; rows null: a gap, nothing added).
  function add(file) {
    const rows = file?.trains ?? file?.rows;
    if (!rows || slots.has(file.slot)) return;
    slots.add(file.slot);
    for (const row of rows) {
      const h = historyOf(row, file.t);
      let tr = trains.get(h.id);
      if (!tr) trains.set(h.id, tr = { id: h.id, number: h.number, brand: h.brand, start: null, end: null, spans: [], points: [], way: new Map() });
      if (h.brand) tr.brand = h.brand;
      tr.start ??= h.start; tr.end ??= h.end;   // (its trip's ends: from files since 2026-11-27)
      // From its first report on (a train is first sampled up to a minute after its report came), until the next sample.
      tr.spans.push({ from: Math.min(h.from, h.points[0]?.time ?? h.from), until: h.until + (file.every ?? HISTORY_EVERY_MS) });
      const last = tr.points.at(-1)?.time ?? -Infinity;
      tr.points.push(...h.points);
      if (h.points.length && h.points[0].time <= last) {   // a slot that came out of order: sorted again, repeats out
        tr.points.sort((a, b) => a.time - b.time);
        tr.points = tr.points.filter((p, i, l) => !i || p.time !== l[i - 1].time);
        tr.way.clear();
      }
      tr.spans.sort((a, b) => a.from - b.from);
    }
  }

  // The way along the rails from point a to point b (kept per train and point), or null: straight.
  function wayOf(tr, i, a, b) {
    if (tr.way.has(i)) return tr.way.get(i);
    let poly = null;
    const d = metres(a, b);
    if (net && d > 30) {
      a.snap ??= net.snap(a, a.bearing, SNAP_M) ?? false;
      b.snap ??= net.snap(b, b.bearing, SNAP_M) ?? false;
      const limit = 1.5 * d + 300;
      if (a.snap && b.snap) poly = net.route(a.snap, b.snap, limit);
      if (poly && poly.cum.at(-1) > limit) poly = null;
      counts.ways++;
      if (!poly) counts.straight++;
    }
    tr.way.set(i, poly);
    return poly;
  }

  // route: false for a train far outside the view (src/day-view.js): straight between its points unless its way along
  // the rails is known already (working out every train's way in a fast play cost a frame each time).
  let deadline = Infinity;   // (at(): the time this call may spend working out ways)
  function placeOf(tr, T, route = true) {
    const k = lastAtOrBefore(tr.spans, T, 'from');
    if (k < 0 || T > tr.spans[k].until) return null;
    const pts = tr.points;
    if (!pts.length) return null;
    const i = lastAtOrBefore(pts, T, 'time');
    const a = pts[Math.max(0, i)], b = i >= 0 ? pts[i + 1] : null;
    const base = { id: tr.id, syncing: false, stale: false, extra: 0, number: tr.number, brand: tr.brand ?? null,
      start: tr.start, end: tr.end, speed: a.speed, late: a.late, time: a.time };
    if (!b || i < 0 || b.time - a.time > MAX_GAP_MS) {
      return { ...base, lon: a.lon, lat: a.lat, bearing: a.bearing ?? 0, v: 0 };
    }
    const f = (T - a.time) / (b.time - a.time), d = metres(a, b);
    const v = d / ((b.time - a.time) / 1000);
    // (a way not worked out yet waits for a later frame when this one has spent its time: straight meanwhile)
    const poly = tr.way.has(i) ? tr.way.get(i) : route && performance.now() < deadline ? wayOf(tr, i, a, b) : null;
    if (poly) {
      const p = polyAt(poly, f * poly.cum.at(-1));
      return { ...base, lon: p.lon, lat: p.lat, bearing: p.heading ?? a.bearing ?? 0, v: poly.cum.at(-1) / ((b.time - a.time) / 1000) };
    }
    return { ...base, lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f,
      bearing: d > 5 ? bearingOf(a, b) : a.bearing ?? 0, v };
  }

  // Is the train's point before T near the view?
  function nearAt(tr, T, near) {
    const i = lastAtOrBefore(tr.points, T, 'time'), p = tr.points[Math.max(0, i)];
    return !p || near(p.lon, p.lat);
  }

  return {
    add,
    // Every train on the map at T: { id, lon, lat, bearing, syncing: false, stale: false, v (m/s), extra: 0 } as
    // src/trains.js placedAt, and number, brand (company), speed (km/h, its report's), late (minutes), time (its
    // report's time). near(lon, lat): only the trains it says yes to are routed along the rails (the others straight,
    // until they come near). budgetMs: at most this long working out new ways along the rails (a fast play reaches a
    // new point of every train in view at once, each minute: 45 ms in one frame at x600); the rest are straight until
    // a later call has the time.
    at(T, { near = null, budgetMs = Infinity } = {}) {
      deadline = performance.now() + budgetMs;
      const out = [];
      for (const tr of trains.values()) {
        const p = placeOf(tr, T, !near || nearAt(tr, T, near));
        if (p) out.push(p);
      }
      return out;
    },
    placeOf: (id, T) => (trains.has(id) ? placeOf(trains.get(id), T) : null),
    has: slot => slots.has(slot),
    get slots() { return [...slots].sort((a, b) => a - b); },
    get size() { return trains.size; },
    counts,
  };
}
