// A train's whole path along the rails, start to finish, from its timetable: every place it passes or stops at, in
// order, joined along the tracks (rail-net.js). Plain JavaScript, no page parts.
//
// A station has many tracks; its nearest one can be a siding with no way onward (Max, 2026-11-12: paths cut
// straight across). So each place tries the different tracks near it, and the tracks are chosen for the whole
// journey at once: the shortest way along the rails through all places. Where no way is found with the trains'
// own turning rule, a sharper turn is allowed (odd junctions in the data); where still none, that piece is a
// straight line. Measured on 80 rush-hour trains: straight pieces 269 of 2,167 before.

const R = Math.PI / 180;
const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * R), b.lat - a.lat) * R * 6371000;

const NEAR_M = 300;       // tracks this close to a station's point count as its tracks
const SHARP_TURN = 120;   // degrees, the fallback where the trains' own rule finds no way
// First up to 6 tracks per place (points 60 m apart round it); next to a piece still straight, up to 30 (points
// 30 m apart, four rings: big stations such as Stockholm C have dozens of tracks).
const QUICK = { step: 60, rings: 1, max: 6 }, WIDE = { step: 30, rings: 4, max: 30 };

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
  // Pieces still straight: try again with more tracks at their two places.
  const wider = new Set();
  chosen.forEach((c, i) => { if (i > 0 && !c.poly && net) { wider.add(i - 1); wider.add(i); } });
  if (wider.size) {
    for (const i of wider) { const w = candidates(net, places[i], WIDE); if (w.length) C[i] = w; }
    chosen = choose(places, net, C);
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
  const best = [C[0].map(() => ({ cost: 0, prev: -1, poly: null }))];
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
