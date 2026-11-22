// "You seem to be on 231" (Max's idea 7, 2026-11-22): the app notices the train you sit on. Only while My location is
// already on (the app never asks for it by itself); the place is never stored or sent. Pure: fed each location fix and
// the trains drawn near it at that moment.
//
// A train is offered when, for at least MATCH_MS, every fix moved at train speed (MIN_KMH or more), and that one train
// stood within NEAR_M of the fix going the same way (bearing within BEARING_DEG); where two trains match at the last
// fix (two side by side at a station, or meeting) nothing is offered. A fix with poor accuracy (worse than NEAR_M) is
// skipped. Stopping at a station keeps the match for STOP_GRACE_MS (a train stands there too).

export const MATCH_MS = 60 * 1000, NEAR_M = 400, MIN_KMH = 30, BEARING_DEG = 50, STOP_GRACE_MS = 3 * 60 * 1000;

const metres = (a, b) => {
  const x = (b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180), y = b.lat - a.lat;
  return Math.hypot(x, y) * 111195;
};
const bearingOf = (a, b) => {
  const x = (b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180), y = b.lat - a.lat;
  return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
};
const turn = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export function createSeemOn() {
  let last = null;          // the previous fix used
  let since = null;         // when the current run of matching fixes began
  let train = null;         // the id matched over that run
  let quietSince = null;    // standing still since (a stop on the way)
  let offered = null;

  // fix: { t, lon, lat, accuracy (m) }; near: the trains drawn now, [{ id, number, lon, lat, bearing, speed }].
  // Returns the train's { id, number } to offer, or null.
  function feed(fix, near) {
    if (fix.accuracy > NEAR_M) return offered;
    const prev = last; last = fix;
    if (!prev) return offered;
    const dt = (fix.t - prev.t) / 1000; if (dt <= 0) return offered;
    const kmh = metres(prev, fix) / dt * 3.6, heading = bearingOf(prev, fix);
    const close = near.filter(x => metres(x, fix) <= NEAR_M);
    if (kmh < MIN_KMH) {
      // Standing: keep the run for a while if the matched train stands here too.
      quietSince ??= fix.t;
      if (train && close.some(x => x.id === train) && fix.t - quietSince <= STOP_GRACE_MS) return offered;
      return reset();
    }
    quietSince = null;
    const same = close.filter(x => x.speed >= MIN_KMH * 0.6 && turn(x.bearing, heading) <= BEARING_DEG);
    if (same.length !== 1) return reset();
    if (train !== same[0].id) { train = same[0].id; since = fix.t; offered = null; }
    if (fix.t - since >= MATCH_MS) offered = { id: same[0].id, number: same[0].number };
    return offered;
  }
  function reset() { train = null; since = null; offered = null; return null; }
  // Forget everything (My location turned off, the offer dismissed).
  function clear() { last = null; quietSince = null; reset(); }
  return { feed, clear, get offered() { return offered; } };
}
