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
const MAX_AGE_MS = 10 * 60 * 1000;   // a report older than this is not shown; a train silent this long is removed
const KEEP_MS = 3 * 60 * 1000;       // history kept per train
const JUMP_KMH = 300;                // a position jump: faster than this between two reports...
const JUMP_FAR_M = 2000;             // ...and further than this (report times are rough: 360 m "in 1 s" happens)
const STILL_M = 5;                   // a report this close to the last place is the train standing (GPS jitter)
let COAST_MS = 30 * 1000;            // with no new position, coast on at the last speed at most this long
const AHEAD_M = 3000;                // the track ahead worked out for coasting (300 km/h for 30 s is 2.5 km)
let NET = null;                      // the rail network, when given (createTrains({ net }))
let ROUTES = null;                   // the planned routes (src/routes.js), when given
const STOP_BEFORE_M = 200;           // a coasting train waits this far before its next planned stop
const STAND_MS = 0.5;                // m/s: slower than this counts as standing

// The chase. Gaps are measured along the path, in metres.
const TAU_S = 8;          // close a gap over about this many seconds
const ACCEL = 1.0;        // m/s², speeding up
const BRAKE = 3.0;        // m/s², slowing down
const STOP_BRAKE = 1.0;   // m/s², the braking curve used to stop at a standing target without passing it
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

// ---------- One train's path: its accepted reports, each with s = metres along the path from the first ----------

// The direction of travel at the end of the path: the last real movement (along its route, when it has one),
// else the train's own Bearing.
function coastHeading(h) {
  for (let i = h.length - 1; i > 0 && i >= h.length - 6; i--) {
    if (h[i].jump || h[i].s - h[i - 1].s <= 5) continue;
    return h[i].route ? polyAt(h[i].route, h[i].s - h[i - 1].s).heading : headingOf(h[i - 1], h[i]);
  }
  return h.at(-1).bearing;
}

// The track ahead of train tr's last report: { poly, stopAt (s where coasting must stop: before the next planned
// stop) }, or null without a network. Worked out again when the last report changes, and every 10 s (the planned
// route can arrive later).
function trackAhead(tr, now = 0) {
  const h = tr.hist, last = h[h.length - 1];
  if (!NET || !last.snap) return null;
  if (tr.ext?.last !== last || now - tr.ext.at > 10000) {
    const hd = coastHeading(h);
    const toward = ROUTES && hd !== null && hd !== undefined ? ROUTES.toward(tr.latest.id, last, hd) : null;
    if (tr.ext?.last !== last || tr.ext.sig !== toward?.sig) {
      const poly = hd === null || hd === undefined ? null : NET.ahead(last.snap, hd, AHEAD_M, toward?.snap ?? null);
      const stopAt = toward?.stop && poly?.towardAt !== undefined ? last.s + Math.max(0, poly.towardAt - STOP_BEFORE_M) : Infinity;
      tr.ext = { last, sig: toward?.sig, poly, stopAt, at: now };
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
  else if (prev && !last.jump && last.time - prev.time < 60000) v = speedAround(h, h.length - 1, last.time);
  return v < STAND_MS ? 0 : v;
}

// Where the reports say the train was at time t: { s, v (m/s), coasting, inJump }.
// (Tried 2026-11-11: letting a train that still sends reports, repeating its last position, coast up to 2 minutes:
// barely fewer standing trains in silences, 47 % -> 44 %, and a little less true elsewhere. Not kept.)
// cap: where coasting must stop (before the next planned stop).
function targetAt(h, t, cap = Infinity) {
  if (t <= h[0].time) return { s: h[0].s, v: 0 };
  const last = h[h.length - 1];
  if (t >= last.time) {
    const since = (t - last.time) / 1000, v = coastSpeed(h);
    const s = last.s + v * Math.min(since, COAST_MS / 1000);
    if (s >= cap) return { s: Math.max(last.s, cap), v: 0, coasting: true, capped: true };
    return { s, v: since < COAST_MS / 1000 ? v : 0, coasting: true };
  }
  let i = h.length - 1;
  while (h[i - 1].time > t) i--;
  const a = h[i - 1], b = h[i];
  if (b.jump) return { s: a.s, v: 0, inJump: true };   // wait at the start of a jump; it is jumped once passed
  const f = (t - a.time) / (b.time - a.time);
  return { s: a.s + (b.s - a.s) * f, v: speedAround(h, i, t) };
}

// ---------- The trains ----------

// options.net: the rail network (src/rail-net.js), to follow the tracks. options.routes: the planned routes
// (src/routes.js), for junctions and stops. options.coastMs: try another coasting limit (tools/motion-check.mjs).
export function createTrains(options = {}) {
  if (options.coastMs) COAST_MS = options.coastMs;
  if (options.net) NET = options.net;
  if (options.routes) ROUTES = options.routes;
  const byId = new Map();   // id -> { latest, hist, pending, against, sim }
  let lastReport = 0;       // time of the newest report we have, from Trafikverket's clock
  let simTime = null;       // the moment the simulations have reached
  const counts = { repeats: 0, against: 0, jumpsHeld: 0, jumpsDropped: 0, jumpsKept: 0, routed: 0, unrouted: 0 };

  // Add a report to the path. If the train is being drawn past its last report (coasting), the path ahead of it
  // changes: keep the drawn place still and let the difference fade, so nothing jumps sideways.
  function append(tr, r, jump = false) {
    const h = tr.hist, last = h[h.length - 1];
    const before = tr.sim && h.length ? pointAt(tr, tr.sim.s) : null;
    const e = { time: r.time, lon: r.lon, lat: r.lat, speed: r.speed, bearing: r.bearing, s: 0, jump, route: null, snap: null };
    // On the network: the report moved onto its track (they sit within 1 m of it), and the way there from the last
    // report along the tracks (when one exists within 3 times the straight distance + 500 m).
    if (NET && !jump) {
      e.snap = last?.snap && last.lon === r.lon && last.lat === r.lat ? last.snap : NET.snap(r, r.bearing);
      if (e.snap) { e.lon = e.snap.lon; e.lat = e.snap.lat; }
    }
    if (last) {
      const straight = metres(last, e);
      if (e.snap && last.snap && straight > 0.01) {
        e.route = NET.route(last.snap, e.snap, 3 * straight + 500);
        counts[e.route ? 'routed' : 'unrouted']++;
      }
      e.s = last.s + (e.route ? e.route.cum[e.route.cum.length - 1] : straight);
    }
    h.push(e);
    if (before) {
      const after = pointAt(tr, tr.sim.s);
      tr.sim.off.lon += before.lon - after.lon;
      tr.sim.off.lat += before.lat - after.lat;
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
    tr.raw = r;
    if (!last) return append(tr, r);
    if (repeat && !(r.speed !== null && r.speed !== undefined && r.speed < 2)) { counts.repeats++; return; }
    if (tr.pending) {
      const p = tr.pending;
      if (!isJump(p, r)) { tr.pending = null; counts.jumpsKept++; append(tr, p, true); return take(tr, r); }
      if (!isJump(last, r)) { tr.pending = null; counts.jumpsDropped++; }
      else { tr.pending = r; return; }
    }
    const d = metres(last, r);
    if (d < STILL_M) return append(tr, { ...r, lon: last.lon, lat: last.lat });
    const dir = r.bearing ?? coastHeading(h);
    if (dir !== null && dir !== undefined && angle(headingOf(last, r), dir) > 120 && tr.against < 2) {
      tr.against++;
      counts.against++;
      return;
    }
    tr.against = 0;
    if (isJump(last, r)) { tr.pending = r; counts.jumpsHeld++; return; }
    append(tr, r);
  }
  const isJump = (a, b) => metres(a, b) > JUMP_FAR_M && kmhBetween(a, b) > JUMP_KMH;

  // Move one train's simulation on by dt seconds, to time t.
  function step(tr, t, dt) {
    const h = tr.hist;
    const cap = t >= h[h.length - 1].time ? trackAhead(tr, t)?.stopAt ?? Infinity : Infinity;
    const T = targetAt(h, t, cap);
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
    const up = sim.syncing ? 40 : ACCEL, down = sim.syncing || overSpeed ? 40 : BRAKE;
    let want;
    if (sim.syncing) want = T.v + e / 2;
    else if (e >= 0) want = Math.min(T.v + e / TAU_S, T.v * 1.3 + 5);   // catching up stays gentle; far behind syncs
    else {
      // Ahead of the target. Report times are rough, so a moving target lurches; slow down (to 40 % at most, 10 s
      // ahead: half speed) rather than stop. Only when more than 30 s ahead, or the target stands, wait for it.
      const aheadS = -e / Math.max(T.v, 0.1);
      want = T.v > 0 && aheadS < 30 ? T.v * Math.max(0.4, 1 - aheadS / 20) : Math.max(0, T.v + e / TAU_S);
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
    // The nose follows the path's direction, turning at most 120° a second.
    const hd = pointAt(tr, sim.s).heading;
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
    if (t < from) return;
    simTime = t;
    const dt = (t - from) / 1000, n = Math.max(1, Math.ceil(dt / 0.1));
    for (const tr of byId.values()) {
      if (!tr.hist.length) continue;
      if (!tr.sim || dt > 5) { step(tr, t, dt); continue; }
      if (dt === 0) continue;
      for (let i = 1; i <= n; i++) step(tr, from + (t - from) * i / n, dt / n);
    }
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
    // Follow these planned routes at junctions, and wait before planned stops (src/routes.js).
    useRoutes(routes) { ROUTES = routes; },
    // Take in a batch of records. Returns true if anything changed.
    update(records, now = Date.now()) {
      let changed = false;
      for (const r of records) {
        if (r.gone) { changed = byId.delete(r.id) || changed; continue; }
        if (!(r.time > now - MAX_AGE_MS)) continue;            // too old (the stream has sent 2-day-old ones)
        let tr = byId.get(r.id);
        if (tr && tr.latest.time >= r.time) continue;           // not newer than what we have
        if (!tr) { tr = { latest: r, hist: [], pending: null, against: 0, raw: null, sim: null }; byId.set(r.id, tr); }
        tr.latest = r;
        take(tr, r);
        while (tr.hist.length > 2 && tr.hist[1].time < now - KEEP_MS) tr.hist.shift();
        if (r.time > lastReport) lastReport = r.time;
        changed = true;
      }
      return changed;
    },
    // Drop trains that have been silent too long. Returns true if any were dropped.
    prune(now = Date.now()) {
      let changed = false;
      for (const [id, t] of byId) if (t.latest.time < now - MAX_AGE_MS) { byId.delete(id); changed = true; }
      return changed;
    },
    get(id) { return byId.get(id)?.latest ?? null; },
    // Every train's latest report.
    reports() { return [...byId.values()].map(tr => tr.latest); },
    // Where train id is drawn at time t.
    placeOf(id, t) {
      advance(t);
      const tr = byId.get(id);
      return tr?.sim ? drawn(tr) : null;
    },
    get count() { return byId.size; },
    get lastReport() { return lastReport; },
    get counts() { return counts; },
    // All trains as drawn at time t: { id, lon, lat, bearing (compass degrees: the path's direction), syncing }.
    placedAt(t) {
      advance(t);
      const out = [];
      for (const tr of byId.values()) {
        if (!tr.sim) continue;
        const p = drawn(tr);
        out.push({ id: tr.latest.id, lon: p.lon, lat: p.lat, bearing: p.heading, syncing: tr.sim.syncing });
      }
      return out;
    },
    // All trains as map features at time t. propsFor(latestReport, { syncing }) adds the label and colour.
    toGeoJSON(t, propsFor) {
      advance(t);
      const features = [];
      for (const tr of byId.values()) {
        if (!tr.sim) continue;
        const p = drawn(tr);
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: { id: tr.latest.id, bearing: p.heading, ...propsFor(tr.latest, { syncing: tr.sim.syncing }) },
        });
      }
      return { type: 'FeatureCollection', features };
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
      const silentFor = simTime === null ? 0 : (simTime - tr.hist[tr.hist.length - 1].time) / 1000;
      const ext = tr.ext?.last === tr.hist[tr.hist.length - 1] ? tr.ext : null;
      const T = targetAt(tr.hist, simTime, simTime >= tr.hist[tr.hist.length - 1].time ? ext?.stopAt ?? Infinity : Infinity);
      const out = { stopAt: ext?.stopAt ?? Infinity, pastLast: sim.s - tr.hist[tr.hist.length - 1].s, s: sim.s, v: sim.v, syncing: sim.syncing, jumped: sim.jumped, silentFor, gap: T.s - sim.s,
        lastGap: tr.hist.length > 1 ? (tr.hist[tr.hist.length - 1].time - tr.hist[tr.hist.length - 2].time) / 1000 : null,
        target: T.inJump ? 'jump' : T.capped ? 'waiting before a stop' : T.coasting ? (T.v > 0 ? 'coasting' : 'coasted out') : T.v > 0 ? 'moving' : 'standing' };
      sim.jumped = false;
      return out;
    },
  };
}
