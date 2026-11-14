// The trains on the map: each train's reports, cleaned, and a small simulation per train that is what gets drawn.
//
// The map runs DELAY_MS behind real time. To glide without stopping, a train's next report must have arrived by
// the time the drawing reaches the one before: its lateness plus the gap, which takes 22 s for 90 % of gaps and
// 27 s for 95 % (measured 2026-11-11, tools/motion-check.mjs). So at "now - 25 s" the next report is usually there,
// and real stops (stations, red signals) are known before the drawn train gets to them.
//
// Each drawn train is a simulation that chases its target: where the reports say the train was at that moment.
// Its speed changes gently; it catches up or slows down to close the gap, and never drives backwards. With no
// newer report it coasts on at the last speed for up to COAST_MS, then stops. A big gap is closed by fast-
// forwarding (shown as "syncing"); a confirmed position jump in the data is jumped.
// Position is a distance along the train's own path: its cleaned reports joined along the rail network
// (src/rail-net.js), or by straight lines where there is no network or no way along it. Past its last report a
// coasting train follows the track ahead.
import { polyAt } from './rail-net.js';

export const DELAY_MS = 25 * 1000;
// A train seen only at fixed places along the track (its last NO_GPS_RUN reports without a speed) is drawn NO_GPS_EXTRA_MS
// further behind: the next place (a median 25 s on) has then usually come in, so the drawing knows where the train went
// instead of guessing, waiting or fast-forwarding (Max, 2026-11-14, changing his "20-30 s behind" for these trains;
// night of 2026-11-14, docs: night-1114/night.md: with the clock and speed-0 fixes, 90 % within 6.1 -> 5.6 s in the
// rush hours, the night 11.0 -> 7.6 s). It slides there and back at NO_GPS_SLIDE (0.5 s per second).
const NO_GPS_RUN = 3;
const NO_GPS_EXTRA_MS = 15 * 1000;
const NO_GPS_SLIDE = 0.5;
const MAX_AGE_MS = 15 * 60 * 1000;   // a report older than this is not shown; a train silent this long is removed
const KEEP_MS = 3 * 60 * 1000;       // history kept per train
const JUMP_KMH = 300;                // a position jump: faster than this between two reports...
const JUMP_FAR_M = 2000;             // ...and further than this (report times are rough: 360 m "in 1 s" happens)
const STILL_M = 5;                   // a report this close to the last place is the train standing (GPS jitter)
const COAST_DEFAULT_MS = 30 * 1000;  // with no new position, coast on at the last speed at most this long
const AHEAD_M = 3000;                // the track ahead worked out for coasting (300 km/h for 30 s is 2.5 km)
const STOP_BEFORE_M = 200;           // a coasting train waits this far before its next planned stop...
// ...except a train seen only at fixed places (NO_GPS_RUN): it may drive up to the stop's measured stopping place
// (src/routes.js stopSnap; public/stop-places.json) and wait there, where trains really stand. Its last fixed place is
// a median 370 m before the platform, and 200 m before the station point is often not where the station is (Bohus:
// the point is 1.3 km from the platform). Max, 2026-11-14 (point 5 B, docs: night-1114/plan-5b.md): "All rules are
// removable if it results in a better experience". Trains with GPS keep the 200 m: their own reports show where they
// stand. STOP_SIDE_M: how far beside the track ahead the stopping place may lie (another platform track) to count.
const STOP_SIDE_M = 30;
const DWELL_UP_S = 15;               // ...and, held at its stop short of that place, drives up when it gets there this soon
// A long silence: no new position for this long (Max, 2026-11-12, changing three earlier rules; measured on 18
// running trains silent 11-29 min: missing from the map 27 % -> 0-1 %, 90 % within 8-9 km -> 4-9 km):
//   - a train moves on past a planned stop by its timetable once the stop's expected time + 1 minute has passed
//     (before: it waited before every unconfirmed stop, however long);
//   - a train that stood still leaves at its planned departure (+ delay) from there (before: it stayed until new
//     data);
//   - a grey train keeps moving by its timetable, and stays on the map until its trip should be over (before:
//     removed after MAX_AGE_MS).
// 5 minutes was tried: late, crawling trains were sent past their station.
const LONG_SILENCE_MS = 10 * 60 * 1000;
const SILENT_MS = 10 * 60 * 1000;    // no position and no passing for this long: the train is shown as stale (grey)...
const SILENT_NO_ROUTE_MS = 2 * 60 * 1000;   // ...or this long, for a train whose timetable is not known
const FINISHED_MS = 2 * 60 * 1000;   // a train that arrived at the end of its trip is removed after this long quiet
const MAX_PACE = 250 / 3.6;          // m/s: the fastest a train is moved by its timetable
const STOOD_M = 30, STOOD_MS = 60000; // positions this close over this long before a silence: it stood still
const PASSING_MAX_M = 80000;         // a reported passing is used when its station is this close ahead on the tracks...
const PASSING_QUIET_MS = 60 * 1000;  // ...and the train's GPS had been quiet this long (passing times are whole minutes)
const GPS_OVER_PASSING_MS = 120 * 1000;   // a position replaces passings used up to this long before it
export const STAND_MS = 0.5;         // m/s: slower than this counts as standing (also on the stats page)

// The chase. Gaps are measured along the path, in metres.
const TAU_S = 8;          // close a gap over about this many seconds
const ACCEL = 1.0;        // m/s², speeding up
const BRAKE = 3.0;        // m/s², slowing down
const STOP_BRAKE = 1.0;   // m/s², the braking curve used to stop at a standing target without passing it
const TURN_SPAN = 15;     // m: a drawn train's direction is the track's over 15 m behind to 15 m ahead
const SYNC_START_M = 1000; // further behind than this, and than SYNC_START_S of travel: fast-forward
const SYNC_START_S = 25;
const SYNC_END_M = 50;    // ...until this close
const JUMP_M = 20000;     // further off than this (either way): jump
const AHEAD_JUMP_M = 3000; // ahead of the target by more than this (the data went somewhere else): jump

const R = Math.PI / 180;
// Distance in metres between two places (flat approximation, fine over a few km).
function metres(a, b) {
  const x = (b.lon - a.lon) * R * Math.cos((a.lat + b.lat) / 2 * R), y = (b.lat - a.lat) * R;
  return Math.hypot(x, y) * 6371000;
}
// Compass direction from a to b (0 = north, clockwise).
const headingOf = (a, b) => (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * R), b.lat - a.lat) / R + 360) % 360;
const angle = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const kmhBetween = (a, b) => b.time > a.time ? metres(a, b) / ((b.time - a.time) / 1000) * 3.6 : Infinity;
// The place d metres from p in compass direction h.
const ahead = (p, h, d) => ({
  lon: p.lon + d * Math.sin(h * R) / (111195 * Math.cos(p.lat * R)),
  lat: p.lat + d * Math.cos(h * R) / 111195,
});

// How far along polyline poly ({ lon, lat, cum }) the point nearest p lies, when that point is within maxSide metres of
// p; else null.
function alongPoly(poly, p, maxSide) {
  const k = Math.cos(p.lat * R) * 111195, m = 111195;
  let best = null, bestD = maxSide;
  for (let i = 1; i < poly.lon.length; i++) {
    const ax = (poly.lon[i - 1] - p.lon) * k, ay = (poly.lat[i - 1] - p.lat) * m;
    const bx = (poly.lon[i] - p.lon) * k, by = (poly.lat[i] - p.lat) * m;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const f = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    const d = Math.hypot(ax + f * dx, ay + f * dy);
    if (d <= bestD) { bestD = d; best = poly.cum[i - 1] + f * (poly.cum[i] - poly.cum[i - 1]); }
  }
  return best;
}

// ---------- One train's path: its accepted reports, each with s = metres along the path from the first ----------

// The direction of travel at the end of the path: the last real movement (along its route, when it has one),
// else the train's own Bearing.
// A movement must be over TURN_EVIDENCE_M to count: a standing train's GPS wobbles 5-10 m either way, and taken as its
// direction it turned the track ahead round and the drawn train slid back 100 m or more (Max, 2026-11-12: U-turns on
// the line; 2857 at Kallhäll).
const TURN_EVIDENCE_M = 20;
function coastHeading(h) {
  for (let i = h.length - 1; i > 0 && i >= h.length - 6; i--) {
    if (h[i].jump || h[i].s - h[i - 1].s <= TURN_EVIDENCE_M) continue;
    return h[i].route ? polyAt(h[i].route, h[i].s - h[i - 1].s).heading : headingOf(h[i - 1], h[i]);
  }
  return h.at(-1).bearing;
}

// The train's speed around time t (m/s): its average over about 30 s of reports, or the speed it reported when
// that roughly agrees (it is smoother; but some trains report 1 km/h while moving). Report times are rough (a
// 150 km/h train can show 360 m between reports 1 s apart), so the movement between two single reports is not a
// good speed.
function speedAround(h, i, t) {
  let lo = i - 1, hi = i;
  while (lo > 0 && t - h[lo].time < 15000 && !h[lo].jump) lo--;
  while (hi < h.length - 1 && h[hi].time - t < 15000 && !h[hi + 1].jump) hi++;
  const avg = (h[hi].s - h[lo].s) / ((h[hi].time - h[lo].time) / 1000);
  const a = h[i - 1], b = h[i];
  if (a.speed === null || a.speed === undefined || b.speed === null || b.speed === undefined) return avg;
  const said = (a.speed + (b.speed - a.speed) * (t - a.time) / (b.time - a.time)) / 3.6;
  return Math.abs(said - avg) < Math.max(5, 0.3 * avg) ? said : avg;
}

// The speed to coast at past the last report (m/s): the reported speed, else the recent movement's.
function coastSpeed(h) {
  const last = h[h.length - 1], prev = h[h.length - 2];
  let v = 0;
  if (last.speed !== null && last.speed !== undefined) v = last.speed / 3.6;
  else if (prev && !last.jump && last.time - prev.time < 60000) {
    v = speedAround(h, h.length - 1, last.time);
    // Not much faster than the speeds it reported just before: after a frozen position jumps on, the average over
    // the jump is far too high (2556 at Stockholms södra 2026-11-12: 600 m "in 8 s" after standing; it left at
    // 145 km/h). Trains that never report a speed keep the average.
    const said = h.slice(-4, -1).map(e => e.speed).filter(x => x !== null && x !== undefined);
    if (said.length) v = Math.min(v, Math.max(...said) / 3.6 + 5);
  }
  return v < STAND_MS ? 0 : v;
}

// Did train tr stand still at its last report? Its reported speed is under 2 km/h; or, sending no speed, its
// positions over the last minute or more (at least two different ones) all stayed within STOOD_M. An exact repeat
// alone does not count: it usually means the position froze while the train kept going.
function stoodStill(tr) {
  const r = tr.raw, h = tr.hist, last = h[h.length - 1];
  if (r?.speed !== null && r?.speed !== undefined) return r.speed < 2;
  let j = h.length - 1;
  while (j > 0 && h[j].time > last.time - STOOD_MS) j--;
  if (last.time - h[j].time < STOOD_MS || j === h.length - 1) return false;
  for (let k = j; k < h.length; k++) if (metres(h[k], last) > STOOD_M) return false;
  return true;
}

// ---------- The trains ----------

// options.net: the rail network (src/rail-net.js), to follow the tracks. options.routes: the planned routes
// (src/routes.js), for junctions and stops. options.coastMs: try another coasting limit (tools/motion-check.mjs).
export function createTrains(options = {}) {
  // This simulator's own rail network, planned routes and coasting limit. (They were kept once for the whole file, so
  // a second simulator made without routes still used the first one's: the check's "truth" did, 2026-11-13.)
  let NET = options.net ?? null;         // the rail network, when given (or later: useNet)
  let ROUTES = options.routes ?? null;   // the planned routes (src/routes.js), when given (or later: useRoutes)
  const COAST_MS = options.coastMs ?? COAST_DEFAULT_MS;
  // For the checks (tools/lib/branch.mjs): keepMs, a longer history (the "real way" keeps all of it); onWayChange(c),
  // called when a new report changes the way under a train drawn past its last report.
  const KEEP = options.keepMs ?? KEEP_MS;

  // The track ahead of train tr's last report: { poly, stopAt (s where coasting must stop: before the next planned
  // stop) }, or null without a network. Worked out again when the last report changes, and every 10 s (the planned
  // route can arrive later).
  function trackAhead(tr, now = 0) {
    const h = tr.hist, last = h[h.length - 1];
    if (!NET || !last.snap) return null;
    const noGps = tr.nullRun >= NO_GPS_RUN;
    if (tr.ext?.last !== last || now - tr.ext.at > 10000 || tr.ext.noGps !== noGps) {
      const hd = coastHeading(h);
      const toward = ROUTES && hd !== null && hd !== undefined ? ROUTES.toward(tr.latest.id, last, hd, tr.assumed ? new Set([...(tr.reached ?? []), ...tr.assumed]) : tr.reached) : null;
      if (tr.ext?.last !== last || tr.ext.sig !== toward?.sig || tr.ext.noGps !== noGps) {
        // The way to the next planned location ends on any of its tracks, and may be at most a little longer than the
        // straight distance (a far detour to a track that only happens to lie near the station is not the way).
        const straight = toward?.snap ? metres(last, toward.snap) : 0;
        const poly = hd === null || hd === undefined ? null
          : NET.ahead(last.snap, hd, AHEAD_M, toward?.snaps ?? toward?.snap ?? null, Math.min(PASSING_MAX_M, 1.5 * straight + 2000));
        const reached = poly?.towardAt !== undefined;
        // Seen only at fixed places: wait at the stop's stopping place, when the track ahead runs by it.
        const place = noGps && toward?.stop && toward.stopSnap && poly ? alongPoly(poly, toward.stopSnap, STOP_SIDE_M) : null;
        const stopAt = place !== null ? last.s + place
          : toward?.stop && reached ? last.s + Math.max(0, poly.towardAt - STOP_BEFORE_M) : Infinity;
        // towardS / eta: where that next location is along the path, and when it is expected there (for the pace).
        tr.ext = { last, sig: toward?.sig, poly, stopAt, atPlace: place !== null, noGps, towardS: reached ? last.s + poly.towardAt : null,
          eta: reached ? toward.eta : null, at: now };
      } else tr.ext.at = now;
    }
    return tr.ext;
  }

  // The place s metres along train tr's path, and the path's direction there.
  function pointAt(tr, s) {
    const h = tr.hist, last = h[h.length - 1];
    if (s >= last.s) {
      const track = s - last.s >= 0.01 ? trackAhead(tr)?.poly : null;
      if (track) return polyAt(track, s - last.s);
      const hd = coastHeading(h);
      if (s - last.s < 0.01 || hd === null || hd === undefined) return { lon: last.lon, lat: last.lat, heading: hd ?? null };
      return { ...ahead(last, hd, s - last.s), heading: hd };
    }
    if (s <= h[0].s) return { lon: h[0].lon, lat: h[0].lat, heading: null };
    let lo = 0, hi = h.length - 1;   // h[lo].s <= s < h[hi].s
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (h[mid].s <= s) lo = mid; else hi = mid; }
    const a = h[lo], b = h[hi];
    if (b.route) return polyAt(b.route, s - a.s);
    const f = (s - a.s) / (b.s - a.s);
    return { lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f, heading: b.s - a.s > 5 ? headingOf(a, b) : null };
  }

  // Where the reports say the train was at time t: { s, v (m/s), mode, coasting, capped, inJump }.
  // Past its last report (a quiet GPS) a train:
  //   - stays where it is if it stood still before going quiet (o.stood), or once it is stale (o.frozen);
  //   - coasts at its last speed for up to COAST_MS (none if that speed is not known);
  //   - then moves on by its timetable: towards its next planned location (o.towardS, metres along the path) to arrive
  //     at the expected time (o.eta), at most MAX_PACE; past that time at its last pace;
  //   - and never past `cap`: 200 m before its next planned stop, until that stop is confirmed.
  // (Tried 2026-11-11: letting a train that still sends reports, repeating its last position, coast up to 2 minutes:
  // barely fewer standing trains in silences, 47 % -> 44 %, and a little less true elsewhere. Not kept; the timetable
  // pace replaced it.)
  function targetAt(h, t, cap = Infinity, o = {}) {
    if (t <= h[0].time) return { s: h[0].s, v: 0, mode: 'gps' };
    const last = h[h.length - 1];
    if (t >= last.time) {
      if (o.stood || o.frozen) return { s: last.s, v: 0, coasting: true, mode: o.stood ? 'stood' : 'stale' };
      // A train seen only at fixed places, held at its stop from a report short of the platform, stands at the stop's
      // stopping place instead (o.dwellS; Max, 2026-11-14, point 5 B question 1: 53 of 229 such stops in the morning
      // rush were held about 100 m short of where trains stand).
      if (o.dwell) return { s: Math.max(last.s, o.dwellS ?? last.s), v: 0, coasting: true, mode: 'dwell' };
      const since = (t - last.time) / 1000, v = coastSpeed(h);
      const C = v > 0 ? COAST_MS / 1000 : 0;
      let s, sv, mode;
      if (since <= C || !o.eta) {
        s = last.s + v * Math.min(since, C); sv = since < C ? v : 0; mode = since < C ? 'coasting' : 'coasted out';
      } else {
        const startT = last.time + C * 1000, startS = last.s + v * C;
        let pace = o.eta > startT && o.towardS > startS ? (o.towardS - startS) / ((o.eta - startT) / 1000) : v;
        pace = Math.max(0, Math.min(MAX_PACE, pace));
        s = startS + pace * (since - C); sv = pace; mode = 'timetable';
      }
      if (s >= cap) return { s: Math.max(last.s, cap), v: 0, coasting: true, capped: true, mode: 'waiting' };
      return { s, v: sv, coasting: true, mode };
    }
    let i = h.length - 1;
    while (h[i - 1].time > t) i--;
    const a = h[i - 1], b = h[i];
    if (b.jump) return { s: a.s, v: 0, inJump: true, mode: 'gps' };   // wait at the start of a jump; jumped once passed
    const f = (t - a.time) / (b.time - a.time);
    return { s: a.s + (b.s - a.s) * f, v: speedAround(h, i, t), mode: 'gps' };
  }

  const byId = new Map();   // id -> { latest, hist, pending, against, sim }
  let lastReport = 0;       // time of the newest report we have, from Trafikverket's clock
  let simTime = null;       // the moment the simulations have reached
  let halted = false;       // no data arriving at all: every train brakes to a stop (setHalted)
  // Stale: shown grey. The connection is lost, or this train has sent nothing for SILENT_MS (a repeat of its last
  // position counts as something: it is still talking). t is the drawing moment (DELAY_MS behind).
  const silentLimit = tr => (ROUTES?.knows(tr.latest.id) ? SILENT_MS : SILENT_NO_ROUTE_MS);
  // (t is the common drawing moment; a train drawn further behind is judged at its own moment, t - tr.extra.)
  const staleAt = (tr, t) => halted || t - (tr.extra ?? 0) + DELAY_MS - tr.heard > silentLimit(tr);
  // What the target needs past the last report: whether it stood still, is stale, and its timetable (trackAhead).
  // Dwell: a train whose last report is at a planned stop (within 300 m), and not moving fast there, stands until it
  // is reported leaving, a new position shows it moved, or 2 minutes after its planned departure (+ delay) or its
  // arrival, whichever is later (routes.dwellAt).
  // Trains at platforms often send only exact repeats with no speed (taken as "no new position"), and were drawn
  // driving through (bug hunt 2026-11-12: at Stockholms södra 16 of 26 that really stopped).
  const dwellOf = (tr, t) => {
    const last = tr.hist[tr.hist.length - 1];
    if (!ROUTES || last.passing) return null;
    if (tr.dwellFor !== last) {
      tr.dwellFor = last;
      tr.dwellInfo = last.speed !== null && last.speed !== undefined && last.speed > 10 ? null : ROUTES.dwellAt(tr.latest.id, last, last.time);
    }
    const dw = tr.dwellInfo;
    return dw && t < dw.until && !ROUTES.departed(tr.latest.id, dw.sig) ? dw : null;
  };
  const longSilent = (tr, t) => t - tr.hist[tr.hist.length - 1].time > LONG_SILENCE_MS;
  // A train that stood still, silent for long, leaves at its planned departure (+ delay) from where it stood.
  const stoodReleased = (tr, t) => {
    if (!ROUTES || !longSilent(tr, t)) return false;
    const last = tr.hist[tr.hist.length - 1];
    if (tr.depFor !== last) { tr.depFor = last; tr.depAt = ROUTES.departureNear(tr.latest.id, last); }
    return tr.depAt !== null && t > tr.depAt + 30000;
  };
  const aheadOf = (tr, t) => {
    const ext = trackAhead(tr, t), dw = dwellOf(tr, t);
    // Up to the stopping place only when the drawn train is still rolling in as the dwell begins and gets there within
    // DWELL_UP_S at that speed: one already drawn standing stays, and so does one far from it (driving up then used up
    // the stop: 2581 at Årstaberg, 12 Nov 23:12, standing, crept 87 m at 18 km/h; 2583 at Jakobsberg, rolling in at
    // 19 km/h 165 m short; both left without standing; 14 stops in the night and Saturday hours, measured 2026-11-14).
    // (Decided when the drawn train reaches the dwell's report, not when the report arrives, some 25 s earlier.)
    if (dw && tr.dwellUp?.dw !== dw && t >= tr.hist[tr.hist.length - 1].time) {
      const v = tr.sim?.v ?? 0;
      tr.dwellUp = { dw, up: v >= 0.8 && ext?.atPlace && ext.stopAt - (tr.sim?.s ?? 0) <= DWELL_UP_S * v };
    }
    const dwellS = dw && tr.dwellUp?.dw === dw && tr.dwellUp.up && ext?.atPlace && dw.sig === ext.sig ? ext.stopAt : null;
    return { cap: ext?.stopAt ?? Infinity,
      o: { stood: tr.stood && !stoodReleased(tr, t), dwell: Boolean(dw), dwellS,
        frozen: t + DELAY_MS - tr.heard > silentLimit(tr) && !(longSilent(tr, t) && ext?.eta), towardS: ext?.towardS ?? null, eta: ext?.eta ?? null } };
  };
  const counts = { speedAtFixed: 0, repeats: 0, resent: 0, dwellRepeats: 0, spikes: 0, leapsHeld: 0, leapsKept: 0, against: 0, jumpsHeld: 0, jumpsDropped: 0, jumpsKept: 0, routed: 0, unrouted: 0, passingsUsed: 0, passingsReplaced: 0 };

  // Add a report to the path. If the train is being drawn past its last report (coasting), the path ahead of it
  // changes: keep the drawn place still and let the difference fade, so nothing jumps sideways.
  // given: { snap, route, passing } for a reported station passing (its place and the way there already worked out).
  function append(tr, r, jump = false, given = null) {
    const h = tr.hist, last = h[h.length - 1];
    const before = tr.sim && h.length ? pointAt(tr, tr.sim.s) : null;
    const oldAhead = before && options.onWayChange && tr.ext?.last === last ? tr.ext.poly : null, pastBefore = before ? tr.sim.s - last.s : 0;
    const e = { time: r.time, lon: r.lon, lat: r.lat, speed: r.speed, bearing: r.bearing, s: 0, jump, route: null, snap: null,
      passing: given?.passing ?? null };
    // On the network: the report moved onto its track (they sit within 1 m of it), and the way there from the last
    // report along the tracks (when one exists within 3 times the straight distance + 500 m).
    if (given) { e.snap = given.snap; e.route = given.route; e.lon = given.snap.lon; e.lat = given.snap.lat; }
    else if (NET && !jump) {
      e.snap = last?.snap && last.lon === r.lon && last.lat === r.lat ? last.snap : NET.snap(r, r.bearing);
      if (e.snap) { e.lon = e.snap.lon; e.lat = e.snap.lat; }
    }
    if (last) {
      const straight = metres(last, e);
      if (!given && e.snap && last.snap && straight > 0.01) {
        e.route = NET.route(last.snap, e.snap, 3 * straight + 500);
        counts[e.route ? 'routed' : 'unrouted']++;
      }
      e.s = last.s + (e.route ? e.route.cum[e.route.cum.length - 1] : straight);
      if (given && !e.route) e.s = last.s + straight;
    }
    h.push(e);
    if (before) {
      const after = pointAt(tr, tr.sim.s);
      tr.sim.off.lon += before.lon - after.lon;
      tr.sim.off.lat += before.lat - after.lat;
      if (oldAhead && pastBefore > 0.01) options.onWayChange({ id: tr.latest.id, e, last, d: metres(before, after), passing: Boolean(given), jump, before, after, poly: oldAhead });
    }
  }

  // Clean the data before it reaches the path:
  // - an exact repeat of the last position (23 % of reports; many from moving trains, which send some positions
  //   twice or only every minute or two) says nothing new, unless the train reports standing (under 2 km/h).
  //   With no new position the drawn train coasts (at most COAST_MS) and then waits;
  // - a report within STILL_M of the last place is the train standing: same place, new time (no GPS zigzag);
  // - a report that moved against the train's own direction (its Bearing, else its last movement) is noise (often
  //   220 m back and forth while standing), unless three in a row agree (then the train really goes that way);
  // - a jump over JUMP_FAR_M and faster than JUMP_KMH is held until the next report says which place is right.
  function take(tr, r) {
    const h = tr.hist, last = h[h.length - 1];
    const repeat = tr.raw && tr.raw.lon === r.lon && tr.raw.lat === r.lat;
    const rawBefore = tr.raw;
    tr.raw = r;
    if (!last) return append(tr, r);
    // An exact repeat says nothing new (often a frozen GPS on a moving train), unless the train reports standing,
    // or it is at a planned stop it hasn't been reported leaving: then it is standing at the platform (commuter
    // trains send their dwell only as repeats with no speed; dropped, they were drawn driving through, 2026-11-12).
    if (repeat && !(r.speed !== null && r.speed !== undefined && r.speed < 2)) {
      const dw = ROUTES && !last.passing ? ROUTES.dwellAt(r.id, last, last.time) : null;
      if (!dw || ROUTES.departed(r.id, dw.sig) || r.time > dw.until) { counts.repeats++; return; }
      counts.dwellRepeats++;
    }
    // An earlier position sent again (exactly the same coordinates as one this train sent within 10 minutes, but
    // not where it is now): an old fix re-sent, often with Speed 1 between new ones. Taken in, the drawn train
    // turned back to it (e.g. 2713 at Stockholms S, 2026-11-12 07:05: three re-sends of a place 400 m back; Max saw
    // U-turns). A new fix never lands on exactly the same coordinates.
    const key = `${r.lon},${r.lat}`;
    tr.seen ??= new Map();
    const sentAt = tr.seen.get(key);
    if (!repeat) tr.seen.set(key, r.time);
    if (tr.seen.size > 300) for (const [k, t] of tr.seen) if (r.time - t > 10 * 60000) tr.seen.delete(k);
    if (sentAt !== undefined && !repeat && r.time - sentAt < 10 * 60000 && metres(last, r) >= STILL_M) {
      // Its speed is as old as its place (often 1 km/h on a train at full speed): it says nothing about standing now, so
      // the report before it stays the latest word (stoodStill reads tr.raw). Tried 2026-11-13; see docs/movement.md.
      counts.resent++; tr.raw = rawBefore; return;
    }
    // A held leap (faster than any train over a shorter distance than a jump, see below): kept when this report
    // carries on from it, dropped as a spike when this one comes back between.
    if (tr.pending?.leap) {
      const p = tr.pending;
      tr.pending = null;
      if (metres(last, r) >= metres(last, p) - 50 && !isJump(p, r)) { counts.leapsKept++; append(tr, p); }
      else { counts.spikes++; tr.bounced = r.time; }
      tr.raw = null; tr.seen.delete(key);   // so this report isn't taken for a repeat of itself
      return take(tr, r);
    }
    if (tr.pending) {
      const p = tr.pending;
      // A held jump that the next report comes back from (it lands between the last kept place and the jump) was a
      // bad fix too (550 and 17614 at Nässjö, 2026-11-12: reports without a speed 2-5 km north, then back).
      if (metres(last, r) < metres(last, p) - 50) { tr.pending = null; counts.jumpsDropped++; tr.bounced = r.time; tr.raw = null; tr.seen.delete(key); return take(tr, r); }
      if (!isJump(p, r)) { tr.pending = null; counts.jumpsKept++; append(tr, p, true); return take(tr, r); }
      if (!isJump(last, r)) { tr.pending = null; counts.jumpsDropped++; tr.bounced = r.time; }
      else { tr.pending = r; return; }
    }
    // A spike: the last kept report leapt ahead faster than any train (JUMP_KMH, but under JUMP_FAR_M, so it wasn't
    // held), and this one comes back between the two. The leap was a bad fix: take it out and go on from here
    // (e.g. 590, 2026-11-12 07:07:08: 900 m in 2 s, back 470 m 14 s later; the drawn train had chased it).
    const prev = h[h.length - 2];
    if (prev && !last.passing && !last.jump && metres(prev, last) > 300 && kmhBetween(prev, last) > JUMP_KMH &&
        metres(prev, r) < metres(prev, last) - 50 && angle(headingOf(last, r), headingOf(prev, last)) > 120) {
      h.pop();
      counts.spikes++; tr.bounced = r.time;
      tr.raw = null; tr.seen.delete(key);   // so this report isn't taken for a repeat of itself
      return take(tr, r);
    }
    const d = metres(last, r);
    if (d < STILL_M) return append(tr, { ...r, lon: last.lon, lat: last.lat });
    // The train's direction: its own Bearing while it moves; standing or crawling (under 5 km/h) its Bearing swings
    // about, so its last real movement says more (U-turns drawn from GPS wobble at stations, Max 2026-11-12).
    const moving = r.speed !== null && r.speed !== undefined && r.speed >= 5;
    const dir = (moving ? r.bearing : null) ?? coastHeading(h) ?? r.bearing;
    if (dir !== null && dir !== undefined && angle(headingOf(last, r), dir) > 120 && tr.against < 2) {
      tr.against++;
      counts.against++; tr.bounced = r.time;
      return;
    }
    tr.against = 0;
    if (isJump(last, r)) { tr.pending = r; counts.jumpsHeld++; return; }
    // A leap: faster than any train (JUMP_KMH) but shorter than a jump, and over 500 m further than the train's own
    // recent speed takes it (with 15 s to spare: report times are rough, 360 m "in 1 s" happens with good reports).
    // Held until the next report says whether the train is really there; a drawn train fast-forwarding to a bad fix
    // ran past stations (17614, 2026-11-12 15:47: 1.6 km ahead while crawling; 590 at 07:07: 900 m in 2 s).
    // Kept, it is taken in as a normal report (no jump).
    if (d > 300 && kmhBetween(last, r) > JUMP_KMH && d > coastSpeed(h) * ((r.time - last.time) / 1000 + 15) + 500) {
      tr.pending = { ...r, leap: true }; counts.leapsHeld++; return;
    }
    append(tr, r);
  }
  const isJump = (a, b) => metres(a, b) > JUMP_FAR_M && kmhBetween(a, b) > JUMP_KMH;

  // Move one train's simulation on by dt seconds, to time t.
  function step(tr, t, dt) {
    const h = tr.hist;
    // No data at all for a while (the connection is lost): every train slows to a stop where it is.
    if (halted && tr.sim) {
      const sim = tr.sim;
      sim.syncing = false;
      sim.v = Math.max(0, sim.v - BRAKE * dt);
      sim.s += sim.v * dt;
      return;
    }
    // Past the last report in time (a quiet GPS) the target runs on by itself; the stop limit (cap) also holds while
    // the drawn train is ahead of its last report on the track (e.g. its timetable put it further than where the GPS
    // came back): it may slow down rather than stop for the train behind it, but not drive past an unconfirmed stop.
    const last = h[h.length - 1];
    const past = t >= last.time ? aheadOf(tr, t)
      : tr.sim && tr.sim.s > last.s ? { cap: aheadOf(tr, t).cap, o: {} } : { cap: Infinity, o: {} };
    const cap = past.cap;
    let T = targetAt(h, t, cap, past.o);
    // A train turning grey (stale) stops where it is drawn: its target is its last report, which a train moved on
    // by its timetable has long passed, and going back there was a jump backwards (about 15 an hour, 2026-11-12).
    if (T.mode === 'stale' && tr.sim && T.s < tr.sim.s) T = { ...T, s: tr.sim.s };
    // Long silent and waiting before a planned stop past its expected time + 1 minute: take it as passed, and move
    // on by the timetable towards the next one.
    if (T.capped && tr.ext?.eta && tr.ext.sig && t > tr.ext.eta + 60000 && longSilent(tr, t)) {
      (tr.assumed ??= new Set()).add(tr.ext.sig);
      tr.ext.at = -Infinity;   // work out the way ahead again
    }
    let sim = tr.sim;
    if (!sim) {
      tr.sim = { s: T.s, v: T.v, syncing: false, off: { lon: 0, lat: 0 }, heading: pointAt(tr, T.s).heading ?? null, jumped: false };
      return;
    }
    const e = T.s - sim.s;
    // A confirmed jump in the data that the target has passed, a far-off target, or a long pause (a hidden tab):
    // jump there.
    const passedJump = h.some((r, i) => r.jump && i > 0 && h[i - 1].s >= sim.s - 1 && r.s <= T.s + 1);
    if (passedJump || e > JUMP_M || e < -AHEAD_JUMP_M || dt > 5) {
      Object.assign(sim, { s: dt > 5 ? Math.max(T.s, sim.s) : T.s, v: T.v, syncing: false, off: { lon: 0, lat: 0 }, jumped: true });
      return;
    }
    if (!sim.syncing && e > SYNC_START_M && e > SYNC_START_S * T.v) sim.syncing = true;
    if (sim.syncing && e < SYNC_END_M) sim.syncing = false;

    // Fast-forward speeds up and slows down hard; so does a train still far over normal speed after one.
    const overSpeed = sim.v > T.v * 1.3 + 10;
    const up = sim.syncing ? 40 : ACCEL;
    let down = sim.syncing || overSpeed ? 40 : BRAKE;
    // Near the place where it must stop (before its next planned stop), brake as hard as it takes to stop there.
    if (Number.isFinite(cap)) down = Math.max(down, Math.min(40, sim.v * sim.v / (2 * Math.max(0.5, cap - sim.s))));
    let want;
    if (sim.syncing) want = T.v + e / 2;
    // Catching up a moving target stays gentle (far behind syncs). A standing target (a stop, a train standing) is
    // braked into like a real train: keep the speed and let the braking curve below bring it to a stop there. It was
    // crept up to at 18 km/h at most, which ate a short stop (2556 at Stockholms södra, 2026-11-12: 170 m behind when
    // the stop began, drawn standing 7 s of ~40; now 31 s).
    else if (e >= 0) want = T.v > 0 ? Math.min(T.v + e / TAU_S, T.v * 1.3 + 5) : e < 2 ? e / TAU_S : Math.max(5, sim.v);
    else {
      // Ahead of the target. Report times are rough, so a moving target lurches; slow down (to 40 % at most, 10 s
      // ahead: half speed) rather than stop, however far ahead: the real train is moving, so the drawn one does too
      // (2026-11-12: waiting for it, when more than 30 s ahead after moving by the timetable, was 70-75 % of all
      // moving trains drawn standing). Only when the target stands, wait for it.
      const aheadS = -e / Math.max(T.v, 0.1);
      want = T.v > 0 ? T.v * Math.max(0.4, 1 - aheadS / 20) : Math.max(0, T.v + e / TAU_S);
    }
    // Never faster than lets it slow to the target's speed by the time it gets there (with braking to spare), so
    // it doesn't shoot past: into a stop, or after a fast-forward.
    want = Math.min(want, T.v + Math.sqrt(2 * (sim.syncing ? down / 2 : STOP_BRAKE) * Math.max(0, e)));
    // Never past the place where coasting must stop (before the next planned stop), whatever the target does.
    if (Number.isFinite(cap)) want = Math.min(want, Math.sqrt(2 * STOP_BRAKE * Math.max(0, cap - sim.s)));
    want = Math.max(0, want);                                       // never backwards
    sim.v = Math.max(0, sim.v + Math.max(-down * dt, Math.min(up * dt, want - sim.v)));
    sim.s += sim.v * dt;
    const k = Math.exp(-dt / 0.8);
    sim.off.lon *= k; sim.off.lat *= k;
    // The nose follows the path's direction, turning at most 120° a second. The direction is taken over a stretch
    // of track, from TURN_SPAN metres behind to TURN_SPAN ahead: a bend is short straight pieces (corners a median
    // 48 m apart, 3.3° each), and the piece the train is on made it swing at every corner (Max, 2026-11-12: "clicking"
    // round a bend). Over a stretch it turns a little every frame instead.
    const back = pointAt(tr, Math.max(tr.hist[0].s, sim.s - TURN_SPAN)), fwd = pointAt(tr, sim.s + TURN_SPAN);
    const hd = metres(back, fwd) > 2 ? headingOf(back, fwd) : pointAt(tr, sim.s).heading;
    if (hd !== null && hd !== undefined) {
      if (sim.heading === null) sim.heading = hd;
      else {
        const turn = ((hd - sim.heading + 540) % 360) - 180;
        sim.heading = (sim.heading + Math.max(-120 * dt, Math.min(120 * dt, turn)) + 360) % 360;
      }
    }
  }

  // Bring every simulation to time t (called with each drawing moment; earlier moments are ignored), in steps of
  // at most 0.1 s.
  function advance(t) {
    const from = simTime ?? t;
    if (t < from - 5000) { simTime = t; return; }   // the clock was set back (a replay starting): start from there
    if (t < from) return;
    simTime = t;
    const dt = (t - from) / 1000, n = Math.max(1, Math.ceil(dt / 0.1));
    for (const tr of byId.values()) {
      if (!tr.hist.length) continue;
      // A train seen only at fixed places is drawn further behind (NO_GPS_EXTRA_MS), sliding there and back.
      const goal = tr.nullRun >= NO_GPS_RUN ? NO_GPS_EXTRA_MS : 0;
      tr.extra = tr.extra === undefined || dt > 5 ? goal : tr.extra + Math.max(-1000 * NO_GPS_SLIDE * dt, Math.min(1000 * NO_GPS_SLIDE * dt, goal - tr.extra));
      const ex = tr.extra;
      if (!tr.sim || dt > 5) { step(tr, t - ex, dt); continue; }
      if (dt === 0) continue;
      for (let i = 1; i <= n; i++) step(tr, from + (t - from) * i / n - ex, dt / n);
    }
  }

  // Whether the way behind train tr doubles back toward its front, so its cars behind would be laid over its cars ahead
  // (a train that turned round at the end of its line, or GPS wobble while standing: 976 at Stockholm C folded up,
  // Max 2026-11-13; 6 trains in 3 minutes of the rush-hour replay, mostly standing at line ends). Tested once per
  // drawing moment: 20 to 80 m behind, the place is less than 60 % of that away, or lies on the front's side.
  function foldsBack(tr) {
    if (tr.foldAt === simTime) return tr.folded;
    const s = tr.sim.s, m = pointAt(tr, s), k = Math.cos(m.lat * R);
    let folded = false;
    for (const d of [20, 40, 60, 80]) {
      if (s - d < tr.hist[0].s) break;
      const b = pointAt(tr, s - d), f = pointAt(tr, s + d);
      const toBack = [(b.lon - m.lon) * k, b.lat - m.lat], toFront = [(f.lon - m.lon) * k, f.lat - m.lat];
      if (metres(m, b) < 0.6 * d || toBack[0] * toFront[0] + toBack[1] * toFront[1] > 0) { folded = true; break; }
    }
    tr.foldAt = simTime;
    tr.folded = folded;
    return folded;
  }

  // How far ahead of train tr the known track runs, in metres (Infinity: further than 400 m), and the place and
  // direction where it ends: past its end every place is the end itself (a buffer stop). Once per drawing moment.
  function trackEnd(tr) {
    if (tr.endAt === simTime) return tr.end;
    const s = tr.sim.s;
    let end = { at: Infinity };
    for (let e = 10; e <= 400; e += 10) {
      if (metres(pointAt(tr, s + e), pointAt(tr, s + e - 1)) > 0.3) continue;
      let lo = e - 10, hi = e;   // the end lies between: halve down to 0.5 m
      while (hi - lo > 0.5) { const mid = (lo + hi) / 2; if (metres(pointAt(tr, s + mid), pointAt(tr, s + mid - 0.25)) > 0.1) lo = mid; else hi = mid; }
      const p = pointAt(tr, s + lo), q = pointAt(tr, s + Math.max(0, lo - 10));
      end = { at: lo, place: p, heading: metres(p, q) > 2 ? headingOf(q, p) : tr.sim.heading ?? tr.latest.bearing ?? 0 };
      break;
    }
    tr.endAt = simTime;
    tr.end = end;
    return end;
  }

  // Where train tr is drawn now, with its heading.
  function drawn(tr) {
    const sim = tr.sim, p = pointAt(tr, sim.s);
    return { lon: p.lon + sim.off.lon, lat: p.lat + sim.off.lat, heading: sim.heading ?? tr.latest.bearing ?? 0 };
  }

  return {
    DELAY_MS,
    // Follow the tracks of this rail network from now on (src/rail-net.js).
    useNet(net) { NET = net; },
    // No data arriving at all (true): every train brakes to a stop and is shown stale. false: back to normal (the
    // trains fast-forward to where their data now says).
    setHalted(on) { halted = on; },
    get halted() { return halted; },
    // How it stands with train id at drawing moment t: { stale, silentFor (s since its last position or passing),
    // gpsSilentFor (s since its last position), syncing, mode ('gps' between reports, 'coasting', 'coasted out',
    // 'timetable', 'waiting' before a stop, 'stood', 'stale'), waitingFor (signature), lastPassing ({ sig, time }) }.
    stateOf(id, t) {
      const tr = byId.get(id);
      if (!tr?.hist.length) return null;
      const own = t - (tr.extra ?? 0);   // the moment this train is drawn for
      const h = tr.hist, past = own >= h[h.length - 1].time ? aheadOf(tr, own) : { cap: Infinity, o: {} };
      const T = targetAt(h, own, past.cap, past.o);
      return { stale: staleAt(tr, t), silentFor: (t + DELAY_MS - tr.heard) / 1000,
        gpsSilentFor: (t + DELAY_MS - tr.latest.time) / 1000, syncing: tr.sim?.syncing ?? false, mode: T.mode,
        waitingFor: T.mode === 'waiting' ? tr.ext?.sig ?? null : null, waitingAt: T.mode === 'waiting' && Boolean(tr.ext?.atPlace),
        lastPassing: ROUTES?.lastPassing(id) ?? null };
    },
    // Reported station passings [{ key, station, time, activity }]: one at a station ahead of the train, newer than
    // its last report, is used as a report at that station's place (the train really got there). An arrival at a
    // stop means it stands there until it is reported leaving (or a position says it moved).
    addPassings(list) {
      if (!NET || !ROUTES) return;
      for (const p of list) {
        const tr = byId.get(p.key), h = tr?.hist, last = h?.[h.length - 1];
        if (!last?.snap || p.time <= last.time || p.time < tr.latest.time + PASSING_QUIET_MS) continue;
        // A train seen only at fixed places, at one of its planned stops: at the stopping place, where it waits for this
        // passing (see STOP_SIDE_M), not at Trafikverket's point (up to 1.3 km off).
        const at = (tr.nullRun >= NO_GPS_RUN && ROUTES.stopsAt(p.key, p.station) ? ROUTES.stopSnap(p.station) : null) ?? ROUTES.placeOf(p.station);
        if (!at) continue;
        const hd = coastHeading(h);
        const dir = hd === null || hd === undefined ? 0 : angle(last.snap.heading, hd) <= 90 ? +1 : -1;
        const way = NET.route(last.snap, at, PASSING_MAX_M, dir);
        // Not reached only the long way round (night of 2026-11-14: 24 of 1,009 passings, e.g. Triangeln 21.8 km round
        // Malmö for 77 m, fast-forwarded at about 1,000 km/h): at most the track ahead's own limit.
        if (!way || way.cum[way.cum.length - 1] > 1.5 * metres(last, at) + 2000) continue;   // behind the train, not on its way, or the long way round
        append(tr, { time: p.time, lon: at.lon, lat: at.lat, speed: null, bearing: null }, false,
          { snap: at, route: way, passing: p.station });
        counts.passingsUsed++;
        (tr.reached ??= new Set()).add(p.station);   // reached: never waited for again
        tr.heard = Math.max(tr.heard, p.time);
        tr.stood = p.activity === 'Ankomst';
      }
    },
    // Follow these planned routes at junctions, and wait before planned stops (src/routes.js).
    useRoutes(routes) { ROUTES = routes; },
    // Take in a batch of records. Returns true if anything changed.
    update(records, now = Date.now()) {
      let changed = false;
      for (let r of records) {
        if (r.gone) { changed = byId.delete(r.id) || changed; continue; }
        if (!(r.time > now - MAX_AGE_MS)) continue;            // too old (the stream has sent 2-day-old ones)
        let tr = byId.get(r.id);
        if (tr && tr.latest.time >= r.time) continue;           // not newer than what we have
        // A report without a speed is a fixed place along the track, not GPS (about 1 report in 4; a third of the
        // trains send only these). Such a place is often sent again with Speed 0 or 1 while the train runs at full
        // speed, and that was taken for "it stands": the train was drawn standing, then fast-forwarded at the next
        // place (20153 near Falkenberg: 250 of 1,800 s fast-forwarding). A speed under 2 km/h at exactly the train's
        // last no-speed place is no speed (night of 2026-11-14, docs: night-1114/nassjo.md; morning rush: frozen
        // 0.82 -> 0.61 %, 90 % within 7.36 -> 6.67 s).
        if (tr?.lastFixed && r.speed !== null && r.speed !== undefined && r.speed < 2 && tr.lastFixed.lon === r.lon && tr.lastFixed.lat === r.lat) {
          r = { ...r, speed: null };
          counts.speedAtFixed++;
        }
        if (tr && (r.speed === null || r.speed === undefined)) tr.lastFixed = r;
        // The GPS is back: it replaces the passings used shortly before it (their times are only whole minutes).
        // Not an exact repeat of its last position, though: that is a frozen GPS, not a new place (take ignores it),
        // and replacing the passings with nothing would leave the train drawn past where it should wait.
        const frozen = tr?.raw && tr.raw.lon === r.lon && tr.raw.lat === r.lat && !(r.speed !== null && r.speed !== undefined && r.speed < 2);
        while (!frozen && tr?.hist.length > 1 && tr.hist[tr.hist.length - 1].passing && tr.hist[tr.hist.length - 1].time > r.time - GPS_OVER_PASSING_MS) {
          tr.hist.pop();
          counts.passingsReplaced++;
        }
        if (tr?.hist.length && tr.hist[tr.hist.length - 1].time >= r.time) continue;   // older than a passing kept
        if (!tr) {
          tr = { latest: r, hist: [], pending: null, against: 0, raw: null, sim: null, heard: 0, stood: false };
          byId.set(r.id, tr);
        }
        tr.latest = r;
        tr.nullRun = r.speed === null || r.speed === undefined ? (tr.nullRun ?? 0) + 1 : 0;   // reports in a row without a speed
        tr.heard = Math.max(tr.heard, r.time);
        const before = tr.hist.length;
        take(tr, r);
        if (tr.hist.length !== before) tr.assumed = null;   // a new position: only confirmed stops count as passed
        if (tr.hist.length) tr.stood = stoodStill(tr);
        while (tr.hist.length > 2 && tr.hist[1].time < now - KEEP) tr.hist.shift();
        if (r.time > lastReport) lastReport = r.time;
        changed = true;
      }
      return changed;
    },
    // Drop trains that have been silent too long. Returns true if any were dropped.
    prune(now = Date.now()) {
      let changed = false;
      for (const [id, t] of byId) {
        // Gone after MAX_AGE_MS with nothing from it; sooner (FINISHED_MS) when it has arrived at the end of its trip.
        // A silent train still on its trip by the timetable stays (grey) until the trip should be over.
        const onTrip = ROUTES && ROUTES.tripEnd(id) > now && !ROUTES.finished(id);
        if ((t.heard < now - MAX_AGE_MS && !onTrip) || (t.heard < now - FINISHED_MS && ROUTES?.finished(id))) { byId.delete(id); changed = true; }
      }
      return changed;
    },
    get(id) { return byId.get(id)?.latest ?? null; },
    // A train's kept history (for the checks' "real way", tools/lib/branch.mjs).
    historyOf(id) { return byId.get(id)?.hist ?? null; },
    // Every train's latest report.
    reports() { return [...byId.values()].map(tr => tr.latest); },
    // Where train id is drawn at time t.
    placeOf(id, t) {
      advance(t);
      const tr = byId.get(id);
      return tr?.sim ? drawn(tr) : null;
    },
    // The place d metres along train id's path from where it is drawn now (+ ahead, - behind), with the same small
    // offset as the train; null when the path doesn't reach that far back (a train that has only just appeared).
    // For the 3D layer, so each car of a model sits on the track (Max, 2026-11-12: cars bend along the track).
    // Two cases where the track gives no room, both seen with the compact models (up to a few hundred metres long
    // on the screen; Max, 2026-11-13: 976 folded up at Stockholm C): where the known track ahead ends (a buffer stop
    // at the end of the line: 3177 at Kungsbacka, 57 m ahead), the cars further on go straight on in the train's
    // direction instead of piling up at the end; where the way behind doubles back (foldsBack), the cars behind go
    // straight on from the front, through the middle.
    along(id, d) {
      const tr = byId.get(id), sim = tr?.sim;
      if (!sim || !tr.hist.length) return null;
      const m = pointAt(tr, sim.s);
      const front = (dd) => {
        const end = dd > 0 ? trackEnd(tr) : { at: Infinity };
        return dd <= end.at ? pointAt(tr, sim.s + dd) : ahead(end.place, end.heading, dd - end.at);
      };
      let p;
      if (d >= 0) p = front(d);
      else if (foldsBack(tr)) { const f = front(-d); p = { lon: 2 * m.lon - f.lon, lat: 2 * m.lat - f.lat }; }
      else if (sim.s + d < tr.hist[0].s) return null;
      else p = pointAt(tr, sim.s + d);
      return { lon: p.lon + sim.off.lon, lat: p.lat + sim.off.lat };
    },
    get count() { return byId.size; },
    get lastReport() { return lastReport; },
    get counts() { return counts; },
    // All trains as drawn at time t: { id, lon, lat, bearing (compass degrees: the path's direction), syncing, stale,
    // v (the drawn speed, m/s: for the stats page) }.
    placedAt(t) {
      advance(t);
      const out = [];
      for (const tr of byId.values()) {
        if (!tr.sim) continue;
        const p = drawn(tr);
        out.push({ id: tr.latest.id, lon: p.lon, lat: p.lat, bearing: p.heading, syncing: tr.sim.syncing, stale: staleAt(tr, t), v: tr.sim.v,
          extra: tr.extra ?? 0 });
      }
      return out;
    },
    // Where the cleaned reports put train id at time t (no simulation): { lon, lat, kmh }, for checks.
    reportedAt(id, t) {
      const h = byId.get(id)?.hist;
      if (!h?.length) return null;
      const tt = Math.min(t, h[h.length - 1].time);
      const T = targetAt(h, tt);
      const p = pointAt(byId.get(id), T.s);
      // gap: seconds between the two reports around t (a long gap means the place in between is a guess).
      const i = h.findIndex(r => r.time > tt);
      const gap = i > 0 ? (h[i].time - h[i - 1].time) / 1000 : Infinity;
      return { lon: p.lon, lat: p.lat, kmh: T.v * 3.6, s: T.s, gap };
    },
    // The simulation's own state, for checks: { s, v, syncing, jumped } (jumped is cleared when read).
    simOf(id) {
      const tr = byId.get(id), sim = tr?.sim;
      if (!sim) return null;
      const simT = simTime === null ? null : simTime - (tr.extra ?? 0);   // the moment this train is drawn for
      const silentFor = simT === null ? 0 : (simT - tr.hist[tr.hist.length - 1].time) / 1000;
      const ext = tr.ext?.last === tr.hist[tr.hist.length - 1] ? tr.ext : null;
      const past = simT >= tr.hist[tr.hist.length - 1].time ? aheadOf(tr, simT) : { cap: Infinity, o: {} };
      const T = targetAt(tr.hist, simT, past.cap, past.o);
      // bounced: when this train's data last went back on itself (a report against its way, a spike, a dropped jump).
      const out = { stopAt: ext?.stopAt ?? Infinity, atPlace: Boolean(ext?.atPlace), noGps: tr.nullRun >= NO_GPS_RUN, assumed: tr.assumed?.size ?? 0, longSilent: longSilent(tr, simT), bounced: tr.bounced ?? -Infinity, pastLast: sim.s - tr.hist[tr.hist.length - 1].s, s: sim.s, v: sim.v, syncing: sim.syncing, jumped: sim.jumped, silentFor, gap: T.s - sim.s,
        lastGap: tr.hist.length > 1 ? (tr.hist[tr.hist.length - 1].time - tr.hist[tr.hist.length - 2].time) / 1000 : null,
        mode: T.mode, stood: tr.stood,
        // for checks: the fading offset (m) and the direction the track ahead is laid in
        offM: Math.hypot(sim.off.lon * Math.cos(tr.hist[0].lat * R), sim.off.lat) * 111195, ahead: coastHeading(tr.hist),
        target: T.inJump ? 'jump' : T.capped ? 'waiting before a stop' : T.coasting ? T.mode : T.v > 0 ? 'moving' : 'standing' };
      sim.jumped = false;
      return out;
    },
  };
}
