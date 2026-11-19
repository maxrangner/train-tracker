// The open train's route line follows the train itself (Max, 2026-11-19: "Trains right now mostly do not match their
// painted route"). The timetable's route (src/path.js) chooses its tracks by cost, the drawn train (src/trains.js) is
// on the track nearest its GPS; where tracks lie side by side they disagreed: the drawn train was on its line 63 % of
// the time, within 4 km of Stockholm C 26 % (replay of 19 Nov 11:30, docs/route-match.mjs). Max's main point: "avoid a
// line flipping back and forth. Key to the app is smooth and visually pleasing". So:
//   - behind the train the line is the way the train was drawn on; once there it never changes;
//   - from the train to its last report, the way it will drive (the map is drawn 25 s behind the reports);
//   - beyond, the timetable's route, joined to the train's track along the rails at least JOIN_M on;
//   - the line changes only when the train's way is over ON_M off it, and only from there to that join;
//   - after a change, none for HOLD_MS, unless the train is within NEAR_M of where its way leaves the line;
//   - a change comes with a slide (src/map.js, Max: "Can it be animated?"): the old stretch moves over to the new one;
//   - where no join along the rails is found, the rest is worked out again with the timetable (full(), about 45 ms,
//     so the page runs it in a quiet moment: wantsFull).
// Plain JavaScript, no page parts (tools/route-follow-check.mjs replays it).
import { pathOf, stopsOf, progressAlong } from './path.js';

export const ON_M = 3, HOLD_MS = 30_000, NEAR_M = 300, JOIN_M = 1500, FIND_M = 300, SLIDE_MS = 800;
// Where no join is found (compose): the way is worked out again through the places within FAR_M, or along the track
// ahead for AHEAD_M when there is none that near.
const FAR_M = 40_000, AHEAD_M = 10_000;
const JOIN_LONGER = 1.3, JOIN_SLACK_M = 500;
// The last resort's step across to L at most STEP_M; never two changes within MIN_GAP_MS; a train whose way has left
// its route is looked at again after LOST_MS.
const STEP_M = 50, MIN_GAP_MS = 2000, LOST_MS = 30_000;
// The fallback's tries stop after BUDGET_MS (each try is a timetable way over a few places: up to 200 ms each in the
// morning rush of 12 Nov, 660 ms in all for 910 and 262).
const BUDGET_MS = 40;
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const SAME_M = 0.5;   // closer than this, a point of the line has not moved (no slide for it)
const R = Math.PI / 180, EARTH = R * 6371000;
const metres = (a, b) => Math.hypot((b[0] - a[0]) * Math.cos(a[1] * R), b[1] - a[1]) * EARTH;
const headingOf = (a, b) => (Math.atan2((b[0] - a[0]) * Math.cos(a[1] * R), b[1] - a[1]) / R + 360) % 360;

function cumOf(c) {
  const cum = new Float64Array(c.length);
  for (let i = 1; i < c.length; i++) cum[i] = cum[i - 1] + metres(c[i - 1], c[i]);
  return cum;
}
// The index of the last point at or before metre m along cum (0 at the start).
function indexAt(cum, m) {
  let lo = 0, hi = cum.length - 1;
  if (m >= cum[hi]) return hi;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= m) lo = mid; else hi = mid; }
  return lo;
}
// The index of the first point at or after metre m (the end of a window: the piece that holds metre m is inside).
const upTo = (cum, m) => Math.min(cum.length - 1, indexAt(cum, m) + 1);
// The metre along line L of a nearest() result. Windows are measured from there, not from the start of its piece: a
// timetable route can have a straight piece 5 km long with no points between (4151 east of Hallsberg, 19 Nov 23:32:
// a window from the piece's start missed the way's end, and the line doubled back on itself).
const mOf = (L, n) => L.cum[n.k] + n.f * ((L.cum[n.k + 1] ?? L.cum[n.k]) - L.cum[n.k]);
// The point of coords on the pieces lo..hi nearest to p: { k (the piece's first index), f, point, d (metres) }.
function nearest(c, p, lo = 0, hi = c.length - 1) {
  lo = Math.max(0, Math.min(lo, c.length - 1)); hi = Math.max(lo, Math.min(hi, c.length - 1));
  const kx = Math.cos(p[1] * R);
  let best = { k: lo, f: 0, point: c[lo], d: metres(p, c[lo]) };
  for (let k = lo; k < hi; k++) {
    const ax = (c[k][0] - p[0]) * kx, ay = c[k][1] - p[1], bx = (c[k + 1][0] - p[0]) * kx, by = c[k + 1][1] - p[1];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const f = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    const d = Math.hypot(ax + f * dx, ay + f * dy) * EARTH;
    if (d < best.d) best = { k, f, d, point: [c[k][0] + (c[k + 1][0] - c[k][0]) * f, c[k][1] + (c[k + 1][1] - c[k][1]) * f] };
  }
  return best;
}
// A line resampled to n points evenly along its length.
function resample(c, n) {
  const cum = cumOf(c), total = cum[c.length - 1], out = [];
  for (let i = 0; i < n; i++) {
    const m = total * i / (n - 1), k = Math.min(indexAt(cum, m), c.length - 2);
    const f = cum[k + 1] > cum[k] ? Math.min(1, (m - cum[k]) / (cum[k + 1] - cum[k])) : 0;
    out.push([c[k][0] + (c[k + 1][0] - c[k][0]) * f, c[k][1] + (c[k + 1][1] - c[k][1]) * f]);
  }
  return out;
}
const pushTo = (out, p) => { const l = out[out.length - 1]; if (!l || metres(l, p) > 0.01) out.push(p); };
const polyCoords = poly => poly.lon.map((lon, i) => [lon, poly.lat[i]]);

// base: the timetable's path (pathOf); places: its places (as given to pathOf); net: the rail network.
// options: what the page gives pathOf (reversals).
export function followPath(base, places, net, options = {}) {
  let line = null;              // the line shown once it follows the train: { coords, cum, at, stops, stopAt, stopF }
  let mTrain = 0;               // where on it the train was last seen (metres along it)
  let changedAt = -Infinity;    // when it last changed
  let wantsFull = false;        // no join along the rails: the rest from the timetable again (full())
  let lostAt = -Infinity;       // when the train's way was last found to leave its route (no way back: LOST_MS)
  const counts = { changes: 0, held: 0, full: 0, noJoin: 0, noWay: 0, lost: 0 };

  // The point of the way at metre s along it.
  const wayPoint = (way, s) => {
    const W = way.coords;
    let j = 1;
    while (j < W.length - 1 && way.s[j] < s) j++;
    if (W.length === 1) return { j: 0, p: W[0] };
    const a = way.s[j - 1], b = way.s[j], f = b > a ? Math.max(0, Math.min(1, (s - a) / (b - a))) : 1;
    return { j, p: [W[j - 1][0] + (W[j][0] - W[j - 1][0]) * f, W[j - 1][1] + (W[j][1] - W[j - 1][1]) * f] };
  };
  const snapAt = (p, heading = null, maxM = 30) => net?.snap({ lon: p[0], lat: p[1] }, heading, maxM) ?? null;

  // The new line: L kept up to where the way (from index j0) comes onto it, the way, then L again from the join on.
  // full: the rest worked out again with the timetable instead of a join. Null when the way is not along L.
  function compose(L, way, j0, full = false) {
    const W = way.coords, last = L.coords.length - 1;
    const wayLen = way.s[W.length - 1] - way.s[j0];
    // Where the way's first point lies on L: near the train, else anywhere.
    let pj = nearest(L.coords, W[j0], indexAt(L.cum, mTrain - 3000), upTo(L.cum, mTrain + 3000 + wayLen));
    if (pj.d > FIND_M) pj = nearest(L.coords, W[j0]);
    if (pj.d > FIND_M) return null;
    // Behind: L as it is; where the way starts beside it, joined along the rails from JOIN_M back.
    const out = [];
    let keep = pj.k;   // L's points 0..keep are kept as they are
    for (let i = 0; i <= keep; i++) out.push(L.coords[i]);
    if (pj.d <= ON_M) pushTo(out, pj.point);
    else {
      const kb = indexAt(L.cum, mOf(L, pj) - JOIN_M);
      const hd = W.length > j0 + 1 ? headingOf(W[j0], W[j0 + 1]) : null;
      const a = snapAt(L.coords[kb], null, 5), b = snapAt(W[j0], hd);
      const r = a && b ? net.route(a, b, 3 * metres(L.coords[kb], W[j0]) + 2000, 0, undefined, true) : null;
      if (r) { out.length = kb + 1; keep = kb; for (const p of polyCoords(r)) pushTo(out, p); }
      else pushTo(out, pj.point);
    }
    const midFrom = out.length;
    // The way up to where L ends: a train going on past its route's end (to a depot, or a route cut short: 287 at
    // Linköping, 7977 past Stockholm C, 19 Nov) is not followed there; the line was drawn kilometres on.
    const endM = L.cum[last], loEnd = indexAt(L.cum, endM - wayLen - 3000);
    let jEnd = W.length - 1;
    if (mOf(L, nearest(L.coords, W[jEnd], loEnd, last)) >= endM - 1) {
      for (let j = j0; j < W.length; j++) if (mOf(L, nearest(L.coords, W[j], loEnd, last)) >= endM - 1) { jEnd = j; break; }
    }
    for (let j = j0; j <= jEnd; j++) pushTo(out, W[j]);
    const end = W[jEnd];
    const hdEnd = jEnd > 0 ? headingOf(W[jEnd - 1], end) : null;
    const pe = nearest(L.coords, end, pj.k, upTo(L.cum, mOf(L, pj) + wayLen + 3000));
    // Ahead: back onto L along the rails, from place p (heading hd) to L's point JOIN_M, 2 or 3 times JOIN_M after
    // metre fromM: { kTarget, tail }, or null.
    // At most JOIN_LONGER times as long as the stretch of L it stands in for (+ JOIN_SLACK_M): a way that goes out
    // and back to turn round was taken (33 km for 1.5 km: 1488 near Lund, 2980 at Södertälje, 19 Nov).
    const joinOnto = (p, hd, fromM) => {
      for (let t = 1; t <= 3; t++) {
        const k = Math.max(pe.k + 1, upTo(L.cum, fromM + JOIN_M * t));
        const a = snapAt(p, hd), b = snapAt(L.coords[k], null, 5);
        const maxM = JOIN_LONGER * Math.max(0, L.cum[k] - fromM) + JOIN_SLACK_M;
        const r = a && b ? net.route(a, b, maxM, 0, undefined, true) : null;
        if (r) return { kTarget: k, tail: polyCoords(r) };
        if (k >= last) break;
      }
      return null;
    };
    let kTarget = -1, tail = null, shift = 0;
    const at = new Array(places.length);
    const peM = mOf(L, pe);
    if (peM >= L.cum[last] - 1) kTarget = last + 1;   // the way runs to L's end
    else if (pe.d <= ON_M) { kTarget = pe.k + 1; tail = [pe.point]; }
    else {
      const j = joinOnto(end, hdEnd, peM);
      if (j) ({ kTarget, tail } = j);
      else if (!full) { counts.noJoin++; return { needFull: true }; }
      else {
        // No join: the way on from the train's own track through the next places, with the timetable, then back onto L. Its own track, not the tracks near its place: the cheapest of those can be
        // another pair of tracks with no way across for kilometres (Älvsjö, 2277 on 19 Nov 23:31). Never the whole
        // rest of the trip, and without pathOf's wider rounds: those took up to 2 s (70 and 451 on 19 Nov). With no
        // place that near, the track ahead towards the next one (rail-net.js ahead).
        counts.full++;
        const own = snapAt(end, hdEnd);
        const aheadAll = places.map((p, i) => i).filter(i => L.at[i] > pe.k);
        // Through the next 1, 2, 4, 8 ... places (as far as FAR_M), back onto L as soon as it can: the less of the line
        // changes the better (through all places within 10 km at once, a whole other way was drawn 20 km on: 11146).
        const near = aheadAll.filter(i => metres(end, [places[i].lon, places[i].lat]) <= FAR_M);
        const tries = [];
        for (let n = 1; n < near.length; n *= 2) tries.push(n);
        if (near.length) tries.push(near.length);
        else tries.push(0);   // no place that near: the track ahead, towards the next one
        const t0 = clock();
        for (const n of tries) {
          if (!own || clock() - t0 > BUDGET_MS) break;
          const ahead = near.slice(0, n);
          let piece;
          if (ahead.length) {
            piece = pathOf([{ lon: end[0], lat: end[1], stop: false, snap: own }, ...ahead.map(i => places[i])], net, { ...options, reversals: null, wide: false });
            if (piece.straight) continue;
          } else {
            const nx = aheadAll[0], toward = nx === undefined ? [] : net.snapsNear(places[nx], 150);
            const poly = net.ahead(own, hdEnd ?? own.heading, AHEAD_M, toward.length ? toward : null);
            if (!poly || poly.lon.length < 2) continue;
            piece = { coords: polyCoords(poly), at: [0] };
          }
          const pEnd = piece.coords[piece.coords.length - 1];
          const toEnd = ahead.length > 0 && ahead.length === aheadAll.length;
          const pe2 = nearest(L.coords, pEnd, pe.k, upTo(L.cum, peM + 2 * FAR_M + 5000));
          const back = toEnd ? null
            : joinOnto(pEnd, piece.coords.length > 1 ? headingOf(piece.coords[piece.coords.length - 2], pEnd) : null, mOf(L, pe2));
          if (!toEnd && !back) continue;
          // Not much longer than the stretch of L it stands in for (as joinOnto): no way out and back.
          const newLen = cumOf(piece.coords).at(-1) + (back ? cumOf(back.tail).at(-1) : 0);
          const oldLen = (back ? L.cum[back.kTarget] : L.cum[last]) - peM;
          if (newLen > JOIN_LONGER * oldLen + JOIN_SLACK_M + pe.d) continue;
          const before = out.length;
          pushTo(out, piece.coords[0]);
          const off = out.length === before ? before - 1 : before;
          for (const c of piece.coords) pushTo(out, c);
          ahead.forEach((i, n) => { at[i] = Math.min(out.length - 1, off + piece.at[n + 1]); });
          if (toEnd) kTarget = Infinity; else ({ kTarget, tail } = back);
          break;
        }
        // Still none: onto L where the way's end is nearest, a short step across (as the line was before 2026-11-19),
        // when L is that near. Further off, the train has left its route (a diversion: 1266 near Eslöv, 19 Nov 11:29,
        // was stepped 13 km across, again each update): the line stays as it is (lost, compose's caller).
        if (kTarget < 0) {
          counts.noWay++;
          if (pe.d > STEP_M) return { lost: true };
          kTarget = pe.k + 1; tail = [pe.point];
        }
      }
    }
    if (!Number.isFinite(kTarget)) {
      // (ran to the end with the timetable)
    } else {
      for (const p of tail ?? []) pushTo(out, p);
      shift = out.length - kTarget;   // L's point kTarget lands here
      for (let k = kTarget; k <= last; k++) out.push(L.coords[k]);
    }
    const joinEnd = Number.isFinite(kTarget) ? kTarget + shift - 1 : out.length - 1;
    // Each place's index on the new line: as before where kept, moved along by the change after it, else the
    // point nearest to it in the changed stretch.
    let prev = 0;
    places.forEach((p, i) => {
      let k;
      if (at[i] !== undefined) k = at[i];
      else if (L.at[i] <= keep) k = L.at[i];
      else if (Number.isFinite(kTarget) && L.at[i] >= kTarget) k = L.at[i] + shift;
      else k = nearest(out, [p.lon, p.lat], Math.max(prev, keep), joinEnd).k;
      at[i] = prev = Math.max(prev, Math.min(out.length - 1, k));
    });
    const next = { coords: out, cum: cumOf(out), at, ...stopsOf(out, at, places) };
    return { line: next, from: Math.min(keep, midFrom - 1), toOld: Number.isFinite(kTarget) ? kTarget : last, toNew: joinEnd };
  }

  // The slide from line L to the new one (null when nothing moved over SAME_M).
  function slideOf(L, c) {
    const N = c.line.coords;
    const oldPiece = L.coords.slice(Math.max(0, c.from - 1), Math.min(L.coords.length, c.toOld + 2));
    if (oldPiece.length < 2) return null;
    let sA = -1, sB = -1;
    for (let i = c.from; i <= c.toNew; i++) if (nearest(oldPiece, N[i]).d > SAME_M) { sA = Math.max(0, i - 1); break; }
    if (sA < 0) return null;
    for (let i = c.toNew; i >= sA; i--) if (nearest(oldPiece, N[i]).d > SAME_M) { sB = Math.min(N.length - 1, i + 1); break; }
    const oA = nearest(oldPiece, N[sA]), oB = nearest(oldPiece, N[sB], oA.k);
    const from = [oA.point, ...oldPiece.slice(oA.k + 1, oB.k + 1), oB.point];
    const to = N.slice(sA, sB + 1);
    const len = Math.max(cumOf(from).at(-1), cumOf(to).at(-1));
    const n = Math.max(16, Math.min(400, Math.ceil(len / 8)));
    const prog = progressAlong(c.line);
    const dots = [];
    c.line.stops.forEach((p, i) => { const o = L.stops?.[i]; if (o && metres(o, p) > SAME_M) dots.push({ i, from: o, to: p }); });
    return { a: prog[sA], b: prog[sB], from: resample(from, n), to: resample(to, n), dots, ms: SLIDE_MS };
  }

  const baseLine = () => ({ ...base, cum: cumOf(base.coords) });
  function apply(c, now, L) {
    const slide = L === null ? null : slideOf(L, c);
    line = c.line;
    changedAt = now;
    counts.changes += L ? 1 : 0;
    return { path: line, slide };
  }

  return {
    // The line to show now: the timetable's until it follows the train.
    get path() { return line ?? base; },
    get following() { return line !== null; },
    get wantsFull() { return wantsFull; },
    counts,
    // The train's way now (trains.wayOf) at time now (ms): { path, slide } when the line changed, else null.
    update(way, now) {
      if (!way?.coords.length || base.coords.length < 2 || !net) return null;
      const W = way.coords, train = wayPoint(way, way.at);
      if (line === null) {
        if (now - lostAt < LOST_MS) return null;
        // First: the way joined into the timetable's route, from its first point along it.
        const L = baseLine();
        mTrain = mOf(L, nearest(L.coords, train.p));
        let j0 = 0;
        while (j0 < W.length - 1 && nearest(L.coords, W[j0], indexAt(L.cum, mTrain - 5000), upTo(L.cum, mTrain + 50)).d > FIND_M) j0++;
        const c = compose(L, way, j0);
        if (!c) return null;
        if (c.needFull) { wantsFull = true; return null; }
        const r = apply(c, now, null);
        mTrain = mOf(line, nearest(line.coords, train.p));
        return r;
      }
      if (wantsFull) return null;   // waiting for full()
      const L = line;
      // Where the train is on the line, then the first point of its way from there on that is off it.
      let n = nearest(L.coords, train.p, indexAt(L.cum, mTrain - 200), upTo(L.cum, mTrain + 2000));
      if (n.d > FIND_M) n = nearest(L.coords, train.p);
      mTrain = mOf(L, n);
      const endM = L.cum[L.coords.length - 1];
      if (mTrain >= endM - 1) return null;   // past its route's end: the line stays as it is
      let off = n.d > ON_M ? train.j : -1, mk = mTrain;
      for (let j = train.j; off < 0 && j < W.length && way.s[j] <= way.report + 0.01; j++) {
        const m = nearest(L.coords, W[j], indexAt(L.cum, mk - 20), upTo(L.cum, mk + 600));
        if (mOf(L, m) >= endM - 1) break;   // the way from here on is past the line's end
        // Past its last report the way is a guess (the track it would coast on): it changes the line only once the
        // train itself is off it (above). Else a report a second later on the other track put the line back (2576 at
        // Sundbyberg, 19 Nov 23:42:24-26).
        if (m.d > ON_M) off = j; else mk = mOf(L, m);
      }
      if (off < 0) return null;
      const aheadM = off === train.j ? 0 : way.s[off] - way.at;
      if (now - changedAt < HOLD_MS && aheadM > NEAR_M) { counts.held++; return null; }
      if (now - changedAt < MIN_GAP_MS || now - lostAt < LOST_MS) { counts.held++; return null; }
      // A train that had left its route: looked at again only once its way comes back near the line (cheap).
      if (lostAt > -Infinity) {
        const back = nearest(L.coords, W[W.length - 1], indexAt(L.cum, mTrain - 500), upTo(L.cum, mTrain + 5000));
        if (back.d > STEP_M) { lostAt = now; counts.held++; return null; }
        lostAt = -Infinity;
      }
      // From the last point of the way on the line before it leaves it (behind the train when the train is off it).
      let j0 = Math.max(0, off - 1);
      while (j0 > 0 && way.s[j0] > way.at - 1000 && nearest(L.coords, W[j0], indexAt(L.cum, mTrain - 1500), upTo(L.cum, mTrain + 3000)).d > ON_M) j0--;
      const c = compose(L, way, j0);
      if (!c) return null;
      if (c.needFull) { wantsFull = true; return null; }
      if (c.lost) { lostAt = now; counts.lost++; return null; }
      const r = apply(c, now, L);
      mTrain = mOf(line, nearest(line.coords, train.p, Math.max(0, c.from - 2)));
      return r;
    },
    // When wantsFull: the rest worked out again with the timetable (about 45 ms: in a quiet moment). { path, slide }.
    full(way, now) {
      wantsFull = false;
      if (!way?.coords.length) return null;
      const L = line ?? baseLine();
      const W = way.coords, train = wayPoint(way, way.at);
      let j0 = 0;
      if (line) {
        j0 = Math.max(0, train.j - 1);
        while (j0 > 0 && way.s[j0] > way.at - 1000 && nearest(L.coords, W[j0]).d > ON_M) j0--;
      }
      const c = compose(L, way, j0, true);
      if (!c) return null;
      if (c.lost) { lostAt = now; counts.lost++; return null; }
      const r = apply(c, now, line);
      mTrain = mOf(line, nearest(line.coords, train.p));
      return r;
    },
  };
}
