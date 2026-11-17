// A train's whole path along the rails, start to finish, from its timetable: every place it passes or stops at, in
// order, joined along the tracks (rail-net.js). Plain JavaScript, no page parts.
//
// A station has many tracks; its nearest one can be a siding with no way onward (Max, 2026-11-12: paths cut
// straight across). So each place tries the different tracks near it, and the tracks are chosen for the whole
// journey at once: the shortest way along the rails through all places. Where no way is found with the trains'
// own turning rule, a sharper turn is allowed (odd junctions in the data); where still none, that piece is a
// straight line. Measured on 80 rush-hour trains: straight pieces 269 of 2,167 before.
// Where a piece is still straight after two rounds, a third tries every track up to FAR_M from its two places, each
// costing FAR_COST metres per metre from the place (the nearest that works wins): some timetable places lie beside the
// trains' way (Lockarp and Kattarp, 255-370 m; night of 2026-11-14, docs: paths.md). With the 3 faulty pieces taken
// out of the network (tools/rail-net.mjs) this left 0 straight pieces of 73,368 in eight recordings (181 before).
// With a network that carries the tracks' costs (src/rail-net.js), the way is the cheapest instead of the shortest: main
// tracks first and the right track of a double track (night of 2026-11-14, docs: night-1114/yard.md; positions on
// their train's own route track 59 -> 83 %). And a place the train only passes may also use up to PASS_FAST fast
// tracks within PASS_M of it: the through tracks of a big station are often not among the nearest few (248 at Älvsjö).

const R = Math.PI / 180;
const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * R), b.lat - a.lat) * R * 6371000;

const NEAR_M = 300;       // tracks this close to a station's point count as its tracks
const SHARP_TURN = 120;   // degrees, the fallback where the trains' own rule finds no way
// First up to 6 tracks per place (points 60 m apart round it); next to a piece still straight, up to 30 (points
// 30 m apart, four rings: big stations such as Stockholm C have dozens of tracks).
const QUICK = { step: 60, rings: 1, max: 6 }, WIDE = { step: 30, rings: 4, max: 30 };
const FAR_M = 600, FAR_MAX = 40, FAR_COST = 2;
const PASS_FAST = 4, PASS_M = 150;
// A reversal at a station (2026-11-17, docs: split-1116/a11-report.md): Skövde C → Borås C was drawn 212 km, the real
// way reverses at Herrljunga (over 150°, which no way-finding inside one piece allows) and those timetables list no
// Herrljunga. When a piece's way is over REV_RATIO times the straight distance (and the stations are over REV_MIN_M
// apart), the way through a station near the straight line (REV_NEAR: the detour via it at most that much longer than
// straight; REV_TRY nearest) is tried too, the train turning there; kept only if under REV_KEEP of the first way.
const REV_RATIO = 1.7, REV_MIN_M = 10000, REV_NEAR = 1.25, REV_TRY = 25, REV_KEEP = 0.75;

// Every track within far metres of place p (the point of each line nearest the place), nearest first: the third round.
function farCandidates(net, p, far, max) {
  const best = new Map();
  const k = 111320 * Math.cos(p.lat * R), step = 150, n = Math.ceil(far / step);
  for (let rx = -n; rx <= n; rx++) for (let ry = -n; ry <= n; ry++) {
    for (const s of net.snapsNear({ lon: p.lon + rx * step / k, lat: p.lat + ry * step / 110540 }, 200)) {
      const d = metres(p, s);
      if (d > far) continue;
      const o = best.get(s.li);
      if (!o || d < o.dist) best.set(s.li, { ...s, dist: d, far: true });
    }
  }
  return [...best.values()].sort((a, b) => a.dist - b.dist).slice(0, max);
}

// The different tracks near place p, nearest first. passFast: a place the train only passes also gets the fast
// tracks near it.
function candidates(net, p, { step, rings, max }, passFast = false) {
  const seen = new Map();
  const k = 111320 * Math.cos(p.lat * R);
  for (let rx = -rings; rx <= rings; rx++) for (let ry = -rings; ry <= rings; ry++) {
    const s = net.snap({ lon: p.lon + rx * step / k, lat: p.lat + ry * step / 110540 }, null, NEAR_M);
    if (s && !seen.has(s.li)) seen.set(s.li, s);
  }
  const base = [...seen.values()].sort((a, b) => a.dist - b.dist).slice(0, max);
  if (!passFast || p.stop || !net.costed) return base;
  const more = net.snapsNear(p, PASS_M).filter(s => !seen.has(s.li) && net.isFast(s.li)).slice(0, PASS_FAST);
  return [...base, ...more];
}

// places: [{ lon, lat, stop }] in the train's order; net: the rail network, or null.
// A place may carry mark: { lon, lat }, where its station's ring is drawn (the measured stopping place): its stop dot
// goes to the path's point nearest that.
// Returns { coords: [[lon, lat], ...], at: [index in coords of each place], stops: [[lon, lat], ...] (the passenger
// stops' dots), stopAt: [index in coords where each stop's piece starts], stopF: [0 to 1 along that piece] }.
// options (for comparing, tools/route-check.mjs): costed (default: when the network has costs), passFast (default: true).
// reversals: stations where a train may turn round ([{ lon, lat }], the page's advertised stations), or null.
export function pathOf(places, net, { costed = Boolean(net?.costed), passFast = true, reversals = null } = {}) {
  const opts = { costed, maxW: costed ? net.maxWeight : 1 };
  // Per place, its candidate tracks (a place with none is itself the one candidate: null).
  const C = places.map(p => (net ? candidates(net, p, QUICK, passFast && costed) : []));
  for (let i = 0; i < C.length; i++) if (!C[i].length) C[i] = [null];
  let chosen = choose(places, net, C, opts);
  // Pieces still straight: try again with more tracks at their two places; then with tracks further away.
  const straightAt = () => { const w = new Set(); chosen.forEach((c, i) => { if (i > 0 && !c.poly && net) { w.add(i - 1); w.add(i); } }); return w; };
  let wider = straightAt();
  if (wider.size) {
    for (const i of wider) { const w = candidates(net, places[i], WIDE); if (w.length) C[i] = w; }
    chosen = choose(places, net, C, opts);
    wider = straightAt();
    if (wider.size) {
      for (const i of wider) { const w = farCandidates(net, places[i], FAR_M, FAR_MAX); if (w.length) C[i] = w; }
      chosen = choose(places, net, C, opts);
    }
  }
  // A piece whose chosen way is a long way round: turning round at a station on the way (REV_*, above), between the
  // tracks already chosen, kept when much shorter in real metres. (After the choice, not inside it: there a siding's
  // long way could win a turn-round over a normal way elsewhere; Göteborg Sävenäs → Trollhättan, 2026-11-17.)
  if (reversals && net) chosen.forEach((ch, i) => {
    if (i === 0 || !ch.poly) return;
    const a = places[i - 1], b = places[i], dist = metres(a, b);
    if (dist <= REV_MIN_M || realLen(ch.poly) <= REV_RATIO * dist) return;
    const rev = viaReversal(net, reversals, a, b, C[i - 1][chosen[i - 1].j], C[i][ch.j], costed);
    if (rev && realLen(rev) < REV_KEEP * realLen(ch.poly)) ch.poly = rev;
  });

  const coords = [], at = [];
  const add = (lon, lat) => {
    const l = coords[coords.length - 1];
    if (!l || l[0] !== lon || l[1] !== lat) coords.push([lon, lat]);
  };
  places.forEach((p, i) => {
    const s = C[i][chosen[i].j];
    const poly = chosen[i].poly;
    if (poly) for (let k = 0; k < poly.lon.length; k++) add(poly.lon[k], poly.lat[k]);
    else add(s?.lon ?? p.lon, s?.lat ?? p.lat);
    at.push(coords.length - 1);
  });
  // Each stop's dot: the path's point nearest the station's ring (p.mark, else the place itself), looked for between
  // the places before and after it (Max, 2026-11-15, "A": the dots were a median 58 m from the rings, Södra 249 m).
  const stops = [], stopAt = [], stopF = [];
  places.forEach((p, i) => {
    if (!p.stop) return;
    const n = nearestOn(coords, p.mark ?? p, at[Math.max(0, i - 1)], at[Math.min(at.length - 1, i + 1)]);
    stops.push(n.point); stopAt.push(n.k); stopF.push(n.f);
  });
  return { coords, at, stops, stopAt, stopF };
}

// The point of coords between indexes lo and hi nearest to place m: { point: [lon, lat], k (the piece's first
// index), f (0 to 1 along that piece) }. A single point: itself.
function nearestOn(coords, m, lo, hi) {
  const k0 = Math.cos(m.lat * R);
  let best = { point: coords[lo], k: lo, f: 0 }, bestD = Infinity;
  for (let k = lo; k < hi; k++) {
    const [ax, ay] = coords[k], [bx, by] = coords[k + 1];
    const vx = (bx - ax) * k0, vy = by - ay, L2 = vx * vx + vy * vy;
    const f = L2 ? Math.max(0, Math.min(1, (((m.lon - ax) * k0) * vx + (m.lat - ay) * vy) / L2)) : 0;
    const d = ((m.lon - ax) * k0 - vx * f) ** 2 + (m.lat - ay - vy * f) ** 2;
    if (d < bestD) { bestD = d; best = { point: [ax + (bx - ax) * f, ay + (by - ay) * f], k, f }; }
  }
  return best;
}

// The track per place (an index into C[i]) and the way from the place before: [{ j, poly (null: straight) }].
// The way from track p to track q turning round at a station near the straight line between places a and b (the
// shortest of REV_TRY tries, in real metres), or null.
const realLen = w => w.cum[w.cum.length - 1];
function viaReversal(net, reversals, a, b, p, q, costed) {
  const dist = metres(a, b), maxM = dist * 3 + 3000;
  const mids = reversals.map(s => ({ s, d: metres(a, s) + metres(s, b) }))
    .filter(x => x.d < REV_NEAR * dist && metres(a, x.s) > 1000 && metres(x.s, b) > 1000)
    .sort((x, y) => x.d - y.d).slice(0, REV_TRY);
  let best = null;
  for (const { s } of mids) {
    const turn = net.snapsNear(s, 150);
    if (!turn.length) continue;
    const one = net.route(p, turn, maxM, 0, undefined, costed);
    const two = one && net.route(one.target, q, maxM, 0, undefined, costed);
    if (!two) continue;
    const m = realLen(one) + realLen(two);
    if (!best || m < best.m) best = { m, one, two };
  }
  if (!best) return null;
  const { one, two } = best, end = realLen(one);
  const poly = { lon: [...one.lon], lat: [...one.lat], cum: [...one.cum], target: two.target, cost: (one.cost ?? 0) + (two.cost ?? 0) };
  for (let k = 1; k < two.lon.length; k++) { poly.lon.push(two.lon[k]); poly.lat.push(two.lat[k]); poly.cum.push(end + two.cum[k]); }
  return poly;
}

function choose(places, net, C, { costed = false, maxW = 1 } = {}) {
  // best[i][j]: the cheapest way to reach candidate j of place i: { cost, prev, poly }. A straight piece costs a
  // lot more than its length, so a way along the rails is always preferred.
  // A track found in the third round costs FAR_COST metres per metre from its place.
  const pen = q => (q?.far ? FAR_COST * q.dist : 0);
  const best = [C[0].map(q => ({ cost: pen(q), prev: -1, poly: null }))];
  for (let i = 1; i < places.length; i++) {
    const a = places[i - 1], b = places[i], dist = metres(a, b);
    const maxM = dist * 3 + 3000, straightCost = (dist * 4 + 5000) * maxW;   // dearer than any way on rails
    best.push(C[i].map((q) => {
      let pick = { cost: Infinity, prev: 0, poly: null };
      C[i - 1].forEach((p, k) => {
        const before = best[i - 1][k].cost;
        if (before + Math.min(dist, straightCost) >= pick.cost) return;
        const len = w => (costed ? w.cost : w.cum[w.cum.length - 1]);
        let poly = p && q ? net.route(p, q, maxM, 0, undefined, costed) : null;
        let cost = poly ? len(poly) : Infinity;
        if (!poly && p && q) {
          poly = net.route(p, q, maxM, 0, SHARP_TURN, costed);
          if (poly) cost = len(poly) * 1.5;   // allowed, but a normal way wins
        }
        if (!poly) cost = straightCost;
        if (before + cost < pick.cost) pick = { cost: before + cost, prev: k, poly };
      });
      pick.cost += pen(q);
      return pick;
    }));
  }

  // Back from the cheapest last candidate: the chosen track per place and the way between.
  const last = best[best.length - 1];
  let j = last.reduce((m, x, i) => (x.cost < last[m].cost ? i : m), 0);
  const chosen = new Array(places.length);
  for (let i = places.length - 1; i >= 0; i--) { chosen[i] = { j, poly: best[i][j].poly }; j = best[i][j].prev; }
  return chosen;
}

// ---- How far along its path a train is, as the map measures it ----
// The map colours the travelled part of a line by "line progress": the share of the line's length up to a point,
// measured on the flat (Web Mercator) map, not in metres. These work in the same units, so the colour changes
// exactly at the train.
const mercX = lon => lon * R;
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + (lat * R) / 2));

// The share of the path's length (0 to 1, map units) at each of its points; worked out once per path.
export function progressAlong(path) {
  if (path.progress) return path.progress;
  const c = path.coords, cum = new Float64Array(c.length);
  for (let i = 1; i < c.length; i++)
    cum[i] = cum[i - 1] + Math.hypot(mercX(c[i][0]) - mercX(c[i - 1][0]), mercY(c[i][1]) - mercY(c[i - 1][1]));
  const total = cum[c.length - 1] || 1;
  for (let i = 0; i < c.length; i++) cum[i] /= total;
  path.progress = cum;
  return cum;
}

// The share of the path's length at the point of the path nearest to a place ({ lon, lat }), 0 to 1.
export function progressAt(path, place) {
  const c = path.coords, cum = progressAlong(path);
  const px = mercX(place.lon), py = mercY(place.lat);
  let best = 0, bestD = Infinity;
  for (let i = 1; i < c.length; i++) {
    const ax = mercX(c[i - 1][0]), ay = mercY(c[i - 1][1]), vx = mercX(c[i][0]) - ax, vy = mercY(c[i][1]) - ay;
    const L2 = vx * vx + vy * vy;
    const f = L2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
    const d = (px - ax - vx * f) ** 2 + (py - ay - vy * f) ** 2;
    if (d < bestD) { bestD = d; best = cum[i - 1] + (cum[i] - cum[i - 1]) * f; }
  }
  return best;
}
