// The rail network (public/rail-net.json, built by tools/rail-net.mjs from Trafikverket's lines): find the track
// under a place, a way along the tracks between two places, and the track ahead of a train.
// Plain JavaScript with no page parts, so the Node tools use the same code.
//
// A line runs between two line ends ("nodes"); where lines meet is a switch or a join. A train only turns from one
// line onto another that leaves within MAX_TURN of the way it came, so it never reverses through a switch.
// Paths come back as polylines: { lon: [], lat: [], cum: [] } (cum = metres from the start).

const MAX_TURN = 60;       // degrees
const CELL = 0.005;        // grid cells, in degrees (about 280 x 550 m in Sweden)
const R = Math.PI / 180;

const angle = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export async function loadNet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`rail network: ${res.status}`);
  return netFromJSON(await res.json());
}

export function netFromJSON({ scale, n, d }) {
  // ---- Points and lines ----
  const P = d.length / 2, L = n.length;
  const lon = new Float64Array(P), lat = new Float64Array(P), cum = new Float64Array(P);
  const start = new Int32Array(L + 1);
  const ix = new Int32Array(P), iy = new Int32Array(P);
  let x = 0, y = 0;
  for (let i = 0; i < P; i++) {
    x += d[2 * i]; y += d[2 * i + 1];
    ix[i] = x; iy[i] = y;
    lon[i] = x / scale; lat[i] = y / scale;
  }
  for (let li = 0; li < L; li++) start[li + 1] = start[li] + n[li];
  const len = new Float64Array(L);
  for (let li = 0; li < L; li++) {
    cum[start[li]] = 0;
    for (let i = start[li] + 1; i < start[li + 1]; i++) cum[i] = cum[i - 1] + metres(i - 1, i);
    len[li] = cum[start[li + 1] - 1];
  }
  function metres(i, j) {
    const kx = Math.cos((lat[i] + lat[j]) / 2 * R);
    return Math.hypot((lon[j] - lon[i]) * kx, lat[j] - lat[i]) * R * 6371000;
  }
  const headingIJ = (i, j) => (Math.atan2((lon[j] - lon[i]) * Math.cos(lat[i] * R), lat[j] - lat[i]) / R + 360) % 360;

  // ---- Nodes: line ends meeting at the same point ----
  const nodeOf = new Int32Array(2 * L);   // line end (li*2 + 0 start / 1 end) -> node
  const nodeIds = new Map(), nodeEnds = [];
  for (let li = 0; li < L; li++) for (const e of [0, 1]) {
    const p = e ? start[li + 1] - 1 : start[li];
    const k = `${ix[p]},${iy[p]}`;
    let id = nodeIds.get(k);
    if (id === undefined) { id = nodeEnds.length; nodeIds.set(k, id); nodeEnds.push([]); }
    nodeOf[2 * li + e] = id;
    nodeEnds[id].push(2 * li + e);
  }
  // Heading leaving the node into line li from end e; heading arriving at the far end when running li in dir.
  const leaveHeading = (li, e) => e ? headingIJ(start[li + 1] - 1, start[li + 1] - 2) : headingIJ(start[li], start[li] + 1);
  const arriveHeading = (li, dir) => dir > 0 ? headingIJ(start[li + 1] - 2, start[li + 1] - 1) : headingIJ(start[li] + 1, start[li]);

  // ---- Grid of line pieces (piece i runs from point i to i + 1 of the same line) ----
  const grid = new Map();
  const lineOf = new Int32Array(P);
  for (let li = 0; li < L; li++) for (let i = start[li]; i < start[li + 1]; i++) lineOf[i] = li;
  for (let li = 0; li < L; li++) for (let i = start[li]; i < start[li + 1] - 1; i++) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(lon[i + 1] - lon[i]), Math.abs(lat[i + 1] - lat[i])) / (CELL / 2)));
    let lastKey = '';
    for (let k = 0; k <= steps; k++) {
      const gk = `${Math.floor((lon[i] + (lon[i + 1] - lon[i]) * k / steps) / CELL)}:${Math.floor((lat[i] + (lat[i + 1] - lat[i]) * k / steps) / CELL)}`;
      if (gk === lastKey) continue;
      lastKey = gk;
      const list = grid.get(gk);
      if (!list) grid.set(gk, [i]); else if (list[list.length - 1] !== i) list.push(i);
    }
  }

  // ---- The track under a place ----
  // place { lon, lat }; heading (optional): the train's direction, preferred among lines crossing at an angle.
  // Returns { li, along (metres from the line's start), lon, lat, dist, heading (of the line, towards its end) }.
  function snap(place, heading = null, maxM = 100) {
    const cx = Math.floor(place.lon / CELL), cy = Math.floor(place.lat / CELL);
    const kx = Math.cos(place.lat * R), m = R * 6371000;
    let best = null, bestScore = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const i of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
        const ax = (lon[i] - place.lon) * kx * m, ay = (lat[i] - place.lat) * m;
        const vx = (lon[i + 1] - lon[i]) * kx * m, vy = (lat[i + 1] - lat[i]) * m, LL = vx * vx + vy * vy;
        const t = LL ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / LL)) : 0;
        const dist = Math.hypot(ax + vx * t, ay + vy * t);
        if (dist > maxM) continue;
        let score = dist;
        if (heading !== null && heading !== undefined) {
          const h = headingIJ(i, i + 1);
          if (Math.min(angle(h, heading), angle(h + 180, heading)) > 30) score += 30;
        }
        if (score < bestScore) {
          bestScore = score;
          best = { li: lineOf[i], i, t, dist, along: cum[i] + (cum[i + 1] - cum[i]) * t,
            lon: lon[i] + (lon[i + 1] - lon[i]) * t, lat: lat[i] + (lat[i + 1] - lat[i]) * t, heading: headingIJ(i, i + 1) };
        }
      }
    }
    return best;
  }

  // ---- Polylines ----
  // The points of line li from metres `from` to metres `to` (either way), appended to poly.
  function addPiece(poly, li, from, to) {
    const a = start[li], b = start[li + 1] - 1;
    const at = (s) => {   // the place s metres along li
      let lo = a, hi = b;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
      const f = cum[hi] > cum[lo] ? Math.max(0, Math.min(1, (s - cum[lo]) / (cum[hi] - cum[lo]))) : 0;
      return { lo, lon: lon[lo] + (lon[hi] - lon[lo]) * f, lat: lat[lo] + (lat[hi] - lat[lo]) * f };
    };
    const push = (x, y) => {
      const k = poly.lon.length;
      if (k) {
        const kx = Math.cos(y * R), d = Math.hypot((x - poly.lon[k - 1]) * kx, y - poly.lat[k - 1]) * R * 6371000;
        if (d < 0.01) return;
        poly.cum.push(poly.cum[k - 1] + d);
      } else poly.cum.push(0);
      poly.lon.push(x); poly.lat.push(y);
    };
    const p = at(from), q = at(to);
    push(p.lon, p.lat);
    if (to >= from) for (let i = p.lo + 1; i <= q.lo; i++) push(lon[i], lat[i]);
    else for (let i = p.lo; i > q.lo; i--) push(lon[i], lat[i]);
    push(q.lon, q.lat);
  }
  const newPoly = () => ({ lon: [], lat: [], cum: [] });

  // ---- A way along the tracks from snapped place a to snapped place b ----
  // dir: +1 / -1 to leave a only towards its line's end / start; 0 either. Null if none within maxM metres.
  function route(a, b, maxM, dir = 0) {
    if (a.li === b.li && (dir === 0 || Math.sign(b.along - a.along) === dir || Math.abs(b.along - a.along) < 1)) {
      const poly = newPoly();
      addPiece(poly, a.li, a.along, b.along);
      return poly;
    }
    // Dijkstra over "line li run in direction d, now at its far end".
    const best = new Map(), from = new Map();
    const heap = [];
    const push = (cost, li, d, prev) => {
      const k = li * 2 + (d > 0 ? 1 : 0);
      if (cost > maxM || (best.has(k) && best.get(k) <= cost)) return;
      best.set(k, cost); from.set(k, prev);
      heap.push([cost, li, d]);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    if (dir >= 0) push(len[a.li] - a.along, a.li, +1, null);
    if (dir <= 0) push(a.along, a.li, -1, null);
    let done = null, doneCost = Infinity;
    while (heap.length) {
      const [cost, li, d] = pop();
      if (cost >= doneCost) break;
      if (best.get(li * 2 + (d > 0 ? 1 : 0)) < cost) continue;
      const node = nodeOf[2 * li + (d > 0 ? 1 : 0)], hin = arriveHeading(li, d);
      for (const end of nodeEnds[node]) {
        const m = end >> 1, e = end & 1;
        if (m === li && e === (d > 0 ? 1 : 0)) continue;   // back the way it came
        if (angle(hin, leaveHeading(m, e)) > MAX_TURN) continue;
        const nd = e === 0 ? +1 : -1;
        if (m === b.li) {
          const c = cost + (nd > 0 ? b.along : len[m] - b.along);
          if (c < doneCost) { doneCost = c; done = { li, d, last: m, lastDir: nd }; }
        }
        push(cost + len[m], m, nd, [li, d]);
      }
    }
    if (!done) return null;
    // Back from the end to the start: the lines in order.
    const chain = [];
    for (let s = [done.li, done.d]; s; s = from.get(s[0] * 2 + (s[1] > 0 ? 1 : 0))) chain.unshift(s);
    const poly = newPoly();
    chain.forEach(([li, d], k) => {
      const enter = k === 0 ? a.along : (d > 0 ? 0 : len[li]);
      addPiece(poly, li, enter, d > 0 ? len[li] : 0);
    });
    addPiece(poly, done.last, done.lastDir > 0 ? 0 : len[done.last], b.along);
    return poly;
  }

  // ---- The track ahead of a train ----
  // From snapped place a, heading (the direction of travel), for `metres`. toward (a snapped place, optional): the
  // next place on the train's planned route; the way there is taken at junctions. Elsewhere, the straightest line.
  function ahead(a, heading, metres, toward = null) {
    const dir = angle(a.heading, heading) <= 90 ? +1 : -1;
    let poly = toward ? route(a, toward, 20000, dir) : null;
    let li, d, at;
    if (poly) {
      if (poly.cum[poly.cum.length - 1] >= metres) return poly;
      // Past the planned place: carry on from there, the way the train arrives.
      const h = poly.lon.length > 1 ? (Math.atan2((poly.lon.at(-1) - poly.lon.at(-2)) * Math.cos(poly.lat.at(-1) * R), poly.lat.at(-1) - poly.lat.at(-2)) / R + 360) % 360 : heading;
      ({ li } = toward); d = angle(toward.heading, h) <= 90 ? +1 : -1; at = toward.along;
    } else {
      poly = newPoly();
      li = a.li; d = dir; at = a.along;
    }
    for (let guard = 0; guard < 200; guard++) {
      addPiece(poly, li, at, d > 0 ? len[li] : 0);
      if (poly.cum[poly.cum.length - 1] >= metres) break;
      const node = nodeOf[2 * li + (d > 0 ? 1 : 0)], hin = arriveHeading(li, d);
      let next = null, nextTurn = MAX_TURN;
      for (const end of nodeEnds[node]) {
        const m = end >> 1, e = end & 1;
        if (m === li && e === (d > 0 ? 1 : 0)) continue;
        const turn = angle(hin, leaveHeading(m, e));
        if (turn <= nextTurn) { nextTurn = turn; next = [m, e === 0 ? +1 : -1]; }
      }
      if (!next) break;   // the end of the track
      [li, d] = next;
      at = d > 0 ? 0 : len[li];
    }
    return poly;
  }

  return {
    snap, route, ahead,
    get lines() { return L; },
    // All lines as one GeoJSON feature, for drawing.
    toGeoJSON() {
      const coordinates = [];
      for (let li = 0; li < L; li++) {
        const c = [];
        for (let i = start[li]; i < start[li + 1]; i++) c.push([lon[i], lat[i]]);
        coordinates.push(c);
      }
      return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates } }] };
    },
  };
}

// The place d metres along polyline poly, and its direction there: { lon, lat, heading }.
export function polyAt(poly, d) {
  const c = poly.cum, n = c.length;
  if (n === 1 || d <= 0) return { lon: poly.lon[0], lat: poly.lat[0], heading: n > 1 ? headingOf(poly, 0) : null };
  if (d >= c[n - 1]) return { lon: poly.lon[n - 1], lat: poly.lat[n - 1], heading: headingOf(poly, n - 2) };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= d) lo = mid; else hi = mid; }
  const f = (d - c[lo]) / (c[hi] - c[lo]);
  return { lon: poly.lon[lo] + (poly.lon[hi] - poly.lon[lo]) * f, lat: poly.lat[lo] + (poly.lat[hi] - poly.lat[lo]) * f, heading: headingOf(poly, lo) };
}
const headingOf = (poly, i) =>
  (Math.atan2((poly.lon[i + 1] - poly.lon[i]) * Math.cos(poly.lat[i] * R), poly.lat[i + 1] - poly.lat[i]) / R + 360) % 360;
