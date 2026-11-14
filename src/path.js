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

const R = Math.PI / 180;
const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * R), b.lat - a.lat) * R * 6371000;

const NEAR_M = 300;       // tracks this close to a station's point count as its tracks
const SHARP_TURN = 120;   // degrees, the fallback where the trains' own rule finds no way
// First up to 6 tracks per place (points 60 m apart round it); next to a piece still straight, up to 30 (points
// 30 m apart, four rings: big stations such as Stockholm C have dozens of tracks).
const QUICK = { step: 60, rings: 1, max: 6 }, WIDE = { step: 30, rings: 4, max: 30 };
const FAR_M = 600, FAR_MAX = 40, FAR_COST = 2;

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

// The different tracks near place p, nearest first.
function candidates(net, p, { step, rings, max }) {
  const seen = new Map();
  const k = 111320 * Math.cos(p.lat * R);
  for (let rx = -rings; rx <= rings; rx++) for (let ry = -rings; ry <= rings; ry++) {
    const s = net.snap({ lon: p.lon + rx * step / k, lat: p.lat + ry * step / 110540 }, null, NEAR_M);
    if (s && !seen.has(s.li)) seen.set(s.li, s);
  }
  return [...seen.values()].sort((a, b) => a.dist - b.dist).slice(0, max);
}

// places: [{ lon, lat, stop }] in the train's order; net: the rail network, or null.
// Returns { coords: [[lon, lat], ...], at: [index in coords of each place], stops: [[lon, lat], ...] (the passenger
// stops), stopAt: [index in coords of each stop] }.
export function pathOf(places, net) {
  // Per place, its candidate tracks (a place with none is itself the one candidate: null).
  const C = places.map(p => (net ? candidates(net, p, QUICK) : []));
  for (let i = 0; i < C.length; i++) if (!C[i].length) C[i] = [null];
  let chosen = choose(places, net, C);
  // Pieces still straight: try again with more tracks at their two places; then with tracks further away.
  const straightAt = () => { const w = new Set(); chosen.forEach((c, i) => { if (i > 0 && !c.poly && net) { w.add(i - 1); w.add(i); } }); return w; };
  let wider = straightAt();
  if (wider.size) {
    for (const i of wider) { const w = candidates(net, places[i], WIDE); if (w.length) C[i] = w; }
    chosen = choose(places, net, C);
    wider = straightAt();
    if (wider.size) {
      for (const i of wider) { const w = farCandidates(net, places[i], FAR_M, FAR_MAX); if (w.length) C[i] = w; }
      chosen = choose(places, net, C);
    }
  }

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
  const stopIdx = places.map((p, i) => (p.stop ? at[i] : null)).filter(i => i !== null);
  return { coords, at, stops: stopIdx.map(i => coords[i]), stopAt: stopIdx };
}

// The track per place (an index into C[i]) and the way from the place before: [{ j, poly (null: straight) }].
function choose(places, net, C) {
  // best[i][j]: the cheapest way to reach candidate j of place i: { cost, prev, poly }. A straight piece costs a
  // lot more than its length, so a way along the rails is always preferred.
  // A track found in the third round costs FAR_COST metres per metre from its place.
  const pen = q => (q?.far ? FAR_COST * q.dist : 0);
  const best = [C[0].map(q => ({ cost: pen(q), prev: -1, poly: null }))];
  for (let i = 1; i < places.length; i++) {
    const a = places[i - 1], b = places[i], dist = metres(a, b);
    const maxM = dist * 3 + 3000, straightCost = dist * 4 + 5000;
    best.push(C[i].map((q) => {
      let pick = { cost: Infinity, prev: 0, poly: null };
      C[i - 1].forEach((p, k) => {
        const before = best[i - 1][k].cost;
        if (before + Math.min(dist, straightCost) >= pick.cost) return;
        let poly = p && q ? net.route(p, q, maxM) : null;
        let cost = poly ? poly.cum[poly.cum.length - 1] : Infinity;
        if (!poly && p && q) {
          poly = net.route(p, q, maxM, 0, SHARP_TURN);
          if (poly) cost = poly.cum[poly.cum.length - 1] * 1.5;   // allowed, but a normal way wins
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
