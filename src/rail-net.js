// The rail network (public/rail-net.json, built by tools/rail-net.mjs from Trafikverket's lines): find the track
// under a place, a way along the tracks between two places, and the track ahead of a train.
// Plain JavaScript with no page parts, so the Node tools use the same code.
//
// A line runs between two line ends ("nodes"); where lines meet is a switch or a join. A train only turns from one
// line onto another that leaves within MAX_TURN of the way it came, so it never reverses through a switch.
// Paths come back as polylines: { lon: [], lat: [], cum: [] } (cum = metres from the start).
//
// Main tracks first (night of 2026-11-14, docs: night-1114/yard.md and branch.md): with the network's per-line digit
// (`c`, tools/rail-net.mjs), a way can be "costed": a metre of slow (40 km/h or less) or not public track counts SLOW_W
// metres, and a metre of a one-way track run against its direction counts AGAINST_W. Only the green route of an opened
// train (src/path.js) and the track ahead of a train towards its next planned place (ahead) ask for it; the way between
// two reports stays the plain shortest one. Measured: positions on their train's green-route track 59 -> 83 %; trains
// drawn onto a wrong branch before their next report 70 -> 27 in five hours (with the passing limit, src/trains.js).

const MAX_TURN = 60;       // degrees
const SLOW_W = 3, AGAINST_W = 1.5;   // what a metre of slow or private track, and of a one-way track run against its direction, counts
const CELL = 0.005;        // grid cells, in degrees (about 280 x 550 m in Sweden)
const R = Math.PI / 180;

const angle = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export async function loadNet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`rail network: ${res.status}`);
  return netFromJSON(await res.json());
}

// Tiny line pieces in Trafikverket's data cut through tracks: on Södermalm between Stockholm C and Stockholms S a
// 1 m piece points backwards, so passing it looked like a 166° turn and there was no way through (Max, 2026-11-12:
// paths cut straight from Stockholm C). Pieces shorter than TINY_M are taken out and their two ends joined into one,
// so the lines on either side meet. First a trial round Stockholm C (under 2 m); since 2026-11-12 everywhere and
// under 5 m (the bug hunt: 399 of 31,588 lines; station pairs with no route between them 214 -> 188 of 2,856).
// Done when the network file is built (tools/rail-net.mjs, which marks the file `joined`), so the page doesn't do it
// at every start (about 100 ms on a fast PC); a file from before that is still joined here on loading.
const TINY_M = 5;
export function joinTinyPieces({ scale, n, d }) {
  const lines = [];
  let x = 0, y = 0, k = 0;
  for (const cnt of n) { const pts = []; for (let i = 0; i < cnt; i++) { x += d[2 * k]; y += d[2 * k + 1]; k++; pts.push([x, y]); } lines.push(pts); }
  const m = (a, b) => Math.hypot((b[0] - a[0]) / scale * Math.cos(a[1] / scale * R), (b[1] - a[1]) / scale) * R * 6371000;
  const length = l => { let s = 0; for (let i = 1; i < l.length; i++) s += m(l[i - 1], l[i]); return s; };
  // Line ends by place, so moving the ends at one point is a lookup, not a scan of every line (nationwide the scan
  // cost about 170 ms at every page load).
  const key = p => `${p[0]},${p[1]}`;
  const ends = new Map();   // place -> [[line, 0 start / 1 end]]
  lines.forEach((l, li) => { for (const e of [0, 1]) { const k = key(e ? l[l.length - 1] : l[0]); (ends.get(k) ?? ends.set(k, []).get(k)).push([li, e]); } });
  let removed = 0;
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li];
    if (!l || length(l) >= TINY_M) continue;
    const a = l[0], b = l[l.length - 1], ka = key(a), kb = key(b);
    // every line end at b moves to a: the lines on either side now meet at a
    if (ka !== kb) {
      const atA = ends.get(ka) ?? ends.set(ka, []).get(ka);
      for (const [lj, e] of ends.get(kb) ?? []) {
        const o = lines[lj];
        if (!o || lj === li) continue;
        if (e) o[o.length - 1] = [...a]; else o[0] = [...a];
        atA.push([lj, e]);
      }
      ends.delete(kb);
    }
    lines[li] = null;
    removed++;
  }
  if (!removed) return { scale, n, d, kept: lines.map((_, i) => i) };
  const n2 = [], d2 = [];
  let px = 0, py = 0;
  const kept = [];
  lines.forEach((l, i) => { if (!l) return; kept.push(i); n2.push(l.length); for (const [qx, qy] of l) { d2.push(qx - px, qy - py); px = qx; py = qy; } });
  return { scale, n: n2, d: d2, kept };
}

export function netFromJSON(json) {
  const { scale, n, d } = json.joined ? json : joinTinyPieces(json);
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

  // ---- Each line's cost per metre, run along (+1) or against (-1) its points (1 without the digits) ----
  const costs = typeof json.c === 'string' && json.c.length === L && json.joined;
  const wAlong = new Float32Array(L).fill(1), wBack = new Float32Array(L).fill(1), fast = new Uint8Array(L).fill(1);
  if (costs) for (let li = 0; li < L; li++) {
    const v = json.c.charCodeAt(li) - 48, slow = v >= 3, flow = v % 3;
    fast[li] = slow ? 0 : 1;
    wAlong[li] = (slow ? SLOW_W : 1) * (flow === 2 ? AGAINST_W : 1);
    wBack[li] = (slow ? SLOW_W : 1) * (flow === 1 ? AGAINST_W : 1);
  }
  const W = (li, d) => (d > 0 ? wAlong[li] : wBack[li]);

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

  // ---- All tracks near a place ----
  // The nearest point of every line within maxM of place, nearest first (a station's tracks: the train arrives on
  // one of them, and the nearest can be a siding with no way there; 2026-11-12: with one track per station 13 % of
  // the hops trains make between planned locations had no route, with all of them 3 %).
  function snapsNear(place, maxM = 150) {
    const cx = Math.floor(place.lon / CELL), cy = Math.floor(place.lat / CELL);
    const kx = Math.cos(place.lat * R), m = R * 6371000, best = new Map();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const i of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
        const ax = (lon[i] - place.lon) * kx * m, ay = (lat[i] - place.lat) * m;
        const vx = (lon[i + 1] - lon[i]) * kx * m, vy = (lat[i + 1] - lat[i]) * m, LL = vx * vx + vy * vy;
        const t = LL ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / LL)) : 0;
        const dist = Math.hypot(ax + vx * t, ay + vy * t);
        if (dist > maxM || best.get(lineOf[i])?.dist <= dist) continue;
        best.set(lineOf[i], { li: lineOf[i], i, t, dist, along: cum[i] + (cum[i + 1] - cum[i]) * t,
          lon: lon[i] + (lon[i + 1] - lon[i]) * t, lat: lat[i] + (lat[i + 1] - lat[i]) * t, heading: headingIJ(i, i + 1) });
      }
    }
    return [...best.values()].sort((a, b) => a.dist - b.dist);
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
  // maxTurn: the sharpest turn allowed where lines meet (a drawn path may allow more where the data is odd).
  // b: one snapped place, or several (e.g. a station's tracks, snapsNear): the way ends at the nearest one reached,
  // and poly.target says which.
  // costed: the cheapest way by the lines' costs (above) instead of the shortest, still at most maxM real metres; when
  // none is found that way, the shortest. poly.cost: the way's cost (its metres, each times its line's cost).
  function route(a, b, maxM, dir = 0, maxTurn = MAX_TURN, costed = false) {
    const F = costed && costs ? W : () => 1;
    const targets = Array.isArray(b) ? b : [b];
    const onLine = new Map();
    for (const t of targets) (onLine.get(t.li) ?? onLine.set(t.li, []).get(t.li)).push(t);
    // On the train's own line: the nearest target that way.
    let own = null, ownCost = Infinity;
    for (const t of onLine.get(a.li) ?? []) {
      if (dir === 0 || Math.sign(t.along - a.along) === dir || Math.abs(t.along - a.along) < 1) {
        const c = Math.abs(t.along - a.along);
        if (c < ownCost) { ownCost = c; own = t; }
      }
    }
    // (within maxM like any other way: the review's F05, 2026-11-17; tools/net-check.mjs)
    if (own && ownCost <= maxM) {
      const poly = newPoly();
      addPiece(poly, a.li, a.along, own.along);
      poly.target = own;
      poly.cost = ownCost * W(a.li, own.along >= a.along ? 1 : -1);
      return poly;
    }
    // Dijkstra over "line li run in direction d, now at its far end", by cost; `real` counts the real metres.
    const best = new Map(), from = new Map();
    const heap = [];
    const push = (cost, li, d, prev, real) => {
      const k = li * 2 + (d > 0 ? 1 : 0);
      if (real > maxM || (best.has(k) && best.get(k) <= cost)) return;
      best.set(k, cost); from.set(k, prev);
      heap.push([cost, li, d, real]);
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
    if (dir >= 0) push((len[a.li] - a.along) * F(a.li, +1), a.li, +1, null, len[a.li] - a.along);
    if (dir <= 0) push(a.along * F(a.li, -1), a.li, -1, null, a.along);
    let done = null, doneCost = Infinity;
    while (heap.length) {
      const [cost, li, d, real] = pop();
      if (cost >= doneCost) break;
      if (best.get(li * 2 + (d > 0 ? 1 : 0)) < cost) continue;
      const node = nodeOf[2 * li + (d > 0 ? 1 : 0)], hin = arriveHeading(li, d);
      for (const end of nodeEnds[node]) {
        const m = end >> 1, e = end & 1;
        if (m === li && e === (d > 0 ? 1 : 0)) continue;   // back the way it came
        if (angle(hin, leaveHeading(m, e)) > maxTurn) continue;
        const nd = e === 0 ? +1 : -1;
        for (const t of onLine.get(m) ?? []) {
          const into = nd > 0 ? t.along : len[m] - t.along;
          if (real + into > maxM) continue;   // (the limit holds into the last line too; found with F05, 2026-11-17)
          const c = cost + into * F(m, nd);
          if (c < doneCost) { doneCost = c; done = { li, d, last: m, lastDir: nd, t }; }
        }
        push(cost + len[m] * F(m, nd), m, nd, [li, d], real + len[m]);
      }
    }
    if (!done) return costed && costs ? route(a, b, maxM, dir, maxTurn, false) : null;
    // Back from the end to the start: the lines in order.
    const chain = [];
    for (let s = [done.li, done.d]; s; s = from.get(s[0] * 2 + (s[1] > 0 ? 1 : 0))) chain.unshift(s);
    const poly = newPoly();
    let cost = 0;   // by the lines' costs, whether or not the way was chosen by them
    chain.forEach(([li, d], k) => {
      const enter = k === 0 ? a.along : (d > 0 ? 0 : len[li]);
      addPiece(poly, li, enter, d > 0 ? len[li] : 0);
      cost += Math.abs((d > 0 ? len[li] : 0) - enter) * W(li, d);
    });
    addPiece(poly, done.last, done.lastDir > 0 ? 0 : len[done.last], done.t.along);
    cost += (done.lastDir > 0 ? done.t.along : len[done.last] - done.t.along) * W(done.last, done.lastDir);
    poly.target = done.t;
    poly.cost = cost;
    return poly;
  }

  // ---- The track ahead of a train ----
  // From snapped place a, heading (the direction of travel), for `metres`. toward (a snapped place, optional, within
  // maxM along the tracks): the
  // next place on the train's planned route; the way there is taken at junctions (and poly.towardAt says how far
  // it is). Elsewhere, the straightest line.
  function ahead(a, heading, metres, toward = null, maxM = 80000) {
    const dir = angle(a.heading, heading) <= 90 ? +1 : -1;
    let poly = toward ? route(a, toward, maxM, dir, MAX_TURN, true) : null;   // main tracks first
    let li, d, at, want = metres;
    if (poly) {
      poly.towardAt = poly.cum[poly.cum.length - 1];   // metres to the planned place
      want = poly.towardAt + metres;                    // and `metres` beyond it
      // Past the planned place: carry on from there, the way the train arrives.
      const h = poly.lon.length > 1 ? (Math.atan2((poly.lon.at(-1) - poly.lon.at(-2)) * Math.cos(poly.lat.at(-1) * R), poly.lat.at(-1) - poly.lat.at(-2)) / R + 360) % 360 : heading;
      toward = poly.target;   // of several (a station's tracks), the one reached
      ({ li } = toward); d = angle(toward.heading, h) <= 90 ? +1 : -1; at = toward.along;
    } else {
      poly = newPoly();
      li = a.li; d = dir; at = a.along;
    }
    for (let guard = 0; guard < 200; guard++) {
      addPiece(poly, li, at, d > 0 ? len[li] : 0);
      if (poly.cum[poly.cum.length - 1] >= want) break;
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
    snap, snapsNear, route, ahead,
    get lines() { return L; },
    // Whether the lines carry costs; the largest cost a metre can have; whether line li is a fast public track.
    costed: costs, maxWeight: costs ? SLOW_W * AGAINST_W : 1, isFast: li => fast[li] === 1,
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
