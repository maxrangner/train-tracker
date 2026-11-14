// Wrong branch: a drawn train that ran ahead of its reports onto another track than the real train took (night of
// 2026-11-14, item 2; docs: night-1114/branch.md, from its tools/_branch_measure.mjs). A drawn train past its last
// report follows "the track ahead"; when the next report comes in, the way under it is worked out again and the drawn
// place slides over to the new way. A WRONG BRANCH is such a slide of 30 m or more that is sideways: the new place is
// 30 m or more from the old track ahead (tracks of one line lie 4.5 m apart, platform tracks 10-25 m). Not counted:
// a slide from a reported passing, a jump, a slide back along the way the train came (the real train went the other
// way), and one where the drawn place was on the real way both before and after (the way only got longer).
// "The real way": an oracle, the same cleaned reports of the whole recording with the whole history kept.
//
// const b = branchCounter(oracle); createTrains({ ..., onWayChange: b.onWayChange }); b.events after the replay.
const R = Math.PI / 180, M = R * 6371000;
const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * R), b.lat - a.lat) * M;
export const WRONG_M = 30;

// The nearest point of polyline poly to place P: { d (metres), x (metres along) }.
function polyNear(P, poly) {
  if (poly.lon.length === 1) return { d: metres(P, { lon: poly.lon[0], lat: poly.lat[0] }), x: 0 };
  const kx = Math.cos(P.lat * R);
  let best = { d: Infinity, x: 0 };
  for (let i = 0; i < poly.lon.length - 1; i++) {
    const px = (poly.lon[i] - P.lon) * kx * M, py = (poly.lat[i] - P.lat) * M, vx = (poly.lon[i + 1] - poly.lon[i]) * kx * M, vy = (poly.lat[i + 1] - poly.lat[i]) * M, LL = vx * vx + vy * vy;
    const t = LL ? Math.max(0, Math.min(1, -(px * vx + py * vy) / LL)) : 0;
    const d = Math.hypot(px + vx * t, py + vy * t);
    if (d < best.d) best = { d, x: poly.cum[i] + (poly.cum[i + 1] - poly.cum[i]) * t };
  }
  return best;
}
// The nearest point of the oracle's way (its entries lo..hi) to place P: { d, end (the known way's start or end) }.
function toPath(P, H, lo, hi) {
  const kx = Math.cos(P.lat * R);
  let best = { d: Infinity, i: -1 };
  const seg = (ax, ay, bx, by, i, jump) => {
    const px = (ax - P.lon) * kx * M, py = (ay - P.lat) * M, vx = (bx - ax) * kx * M, vy = (by - ay) * M, LL = vx * vx + vy * vy;
    const t = LL ? Math.max(0, Math.min(1, -(px * vx + py * vy) / LL)) : 0;
    const d = Math.hypot(px + vx * t, py + vy * t);
    if (d < best.d) best = { d, i, jump, lon: ax + (bx - ax) * t, lat: ay + (by - ay) * t };
  };
  for (let i = Math.max(1, lo); i <= hi; i++) {
    const a = H[i - 1], e = H[i];
    if (!e.jump && e.route && e.route.lon?.length > 1) {
      for (let k = 0; k < e.route.lon.length - 1; k++) seg(e.route.lon[k], e.route.lat[k], e.route.lon[k + 1], e.route.lat[k + 1], i, false);
    } else seg(a.lon, a.lat, e.lon, e.lat, i, Boolean(e.jump));
  }
  if (best.i >= 0) best.end = metres(best, H[hi]) < 1 || metres(best, H[Math.max(0, lo)]) < 1;
  return best;
}
// The oracle's entries from `back` ms before t to `fwd` ms after.
function windowOf(H, t, back = 180000, fwd = 600000) {
  let a = 0, b = H.length - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if (H[m].time < t - back) a = m; else b = m; }
  const lo = a;
  b = H.length - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if (H[m].time < t + fwd) a = m; else b = m; }
  return [lo, b];
}

// oracle: createTrains({ net, keepMs: Infinity }) fed the whole recording beforehand (its trains' histories are read).
export function branchCounter(oracle) {
  const events = [];
  return {
    events,
    // c: { id, e (the new entry), last (the entry before), d (slide, m), passing, jump, before, after, poly (the old track ahead) }
    onWayChange(c) {
      if (c.passing || c.jump || c.d < WRONG_M) return;
      const side = polyNear(c.after, c.poly).d;
      if (side < WRONG_M) return;
      const behind = polyNear(c.after, c.poly).x < 1 && polyNear({ lon: c.e.lon, lat: c.e.lat }, c.poly).x < 1;
      if (behind) return;
      const H = oracle.historyOf(c.id);
      if (H && H.length > 1) {
        const [lo, hi] = windowOf(H, c.e.time);
        const nb = toPath(c.before, H, lo, hi), na = toPath(c.after, H, lo, hi);
        if (!nb.end && !nb.jump && !na.end && !na.jump && nb.d < 15 && na.d < 15) return;   // on the real way both times
      }
      events.push({ id: c.id, time: c.e.time, slide: Math.round(c.d), side: Math.round(side), lon: c.before.lon, lat: c.before.lat });
    },
  };
}
