// Each train's planned route from the timetable: the locations it passes or stops at, in order, with their places
// (Trafikverket's TrainStation list), and what the reported passings say (its delay, where it last passed).
// Used when a train is between position reports: it heads for its next planned stop along the tracks, at the
// timetable's pace (shifted by its delay), and never arrives there before it is confirmed (src/trains.js).
// A planned stop is a location with an arrival row ("Ankomst"); a location with only a departure row is passed (or
// is where the train starts). Plain JavaScript with no page parts, so the Node tools use it too.

const R = Math.PI / 180;
const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * R), b.lat - a.lat) * R * 6371000;
const headingOf = (a, b) => (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * R), b.lat - a.lat) / R + 360) % 360;
const angle = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// stations: Map signature -> { lon, lat }. net: the rail network, to put a station on its track.
export function createRoutes({ stations = new Map(), net = null } = {}) {
  // train key -> { rows: Map, locs (ordered, built on demand), until, delay (minutes), passed: { sig, time, activity } }
  const byKey = new Map();
  const snaps = new Map();   // signature -> the station's place on the track (or null)
  const entry = (key) => {
    let e = byKey.get(key);
    if (!e) byKey.set(key, e = { rows: new Map(), locs: null, until: 0, delay: 0, passed: null });
    return e;
  };

  // The locations in order: { sig, arr, dep (planned ms, or null), stop }.
  function locsOf(e) {
    if (e.locs) return e.locs;
    const rows = [...e.rows.values()].sort((a, b) => a.planned - b.planned);
    const locs = [];
    for (const r of rows) {
      let last = locs[locs.length - 1];
      if (!last || last.sig !== r.sig) locs.push(last = { sig: r.sig, arr: null, dep: null, stop: false });
      if (r.activity === 'Ankomst') { last.arr = r.planned; last.stop = true; } else last.dep = r.planned;
    }
    return (e.locs = locs);
  }
  // Every track within 150 m of a station (rail-net.js snapsNear), for the way to it; its nearest one if none.
  const tracks = new Map();
  function placesOf(sig) {
    if (!tracks.has(sig)) {
      const st = stations.get(sig), near = st && net ? net.snapsNear(st, 150) : [];
      const one = placeOf(sig);
      tracks.set(sig, near.length ? near : one ? [one] : null);
    }
    return tracks.get(sig);
  }
  function placeOf(sig) {
    if (!snaps.has(sig)) {
      const st = stations.get(sig);
      snaps.set(sig, st && net ? net.snap(st, null, 500) : null);
    }
    return snaps.get(sig);
  }

  return {
    setStations(map) { stations = map; snaps.clear(); tracks.clear(); },
    setNet(n) { net = n; snaps.clear(); tracks.clear(); },
    // rows: [{ key (trainKey), sig, activity ('Ankomst' / 'Avgang'), planned (ms) }]
    add(rows) {
      for (const r of rows) {
        const e = entry(r.key);
        e.rows.set(`${r.sig}|${r.activity}|${r.planned}`, r);
        e.locs = null;
        if (r.planned > e.until) e.until = r.planned;
      }
    },
    // Actual passings: [{ key, station, time, minutes, activity }] (src/trafikverket.js followPassings).
    addPassings(list) {
      for (const p of list) {
        const e = entry(p.key);
        if (p.activity === 'Avgang') (e.departed ??= new Set()).add(p.station);
        if (e.passed && e.passed.time > p.time) continue;
        e.passed = { sig: p.station, time: p.time, activity: p.activity ?? null };
        e.delay = p.minutes ?? e.delay;
      }
    },
    // A planned stop (with an arrival and a departure) within 300 m of place (platforms are long: trains measured
    // standing up to 300 m from the station's point) that the train hasn't been reported
    // leaving: { sig, until }, or null. For the dwell rule in trains.js. until: 2 minutes after the later of its
    // planned departure (+ latest delay) and `at` (when the train was there); the reported departure normally ends
    // the dwell first, and the known delay lags (2556 at Stockholms södra 2026-11-12 was a minute later than it).
    dwellAt(key, place, at = 0) {
      const e = byKey.get(key);
      if (!e || !place) return null;
      let best = null, bestD = 300;
      for (const l of locsOf(e)) {
        const st = stations.get(l.sig);
        if (!st || l.arr === null || l.dep === null) continue;
        const d = metres(place, st);
        if (d < bestD) { bestD = d; best = l; }
      }
      return best ? { sig: best.sig, until: Math.max(best.dep + e.delay * 60000, at) + 120000 } : null;
    },
    // The planned departure (+ latest delay) from the timetable location within 300 m of place, or null.
    departureNear(key, place) {
      const e = byKey.get(key);
      if (!e || !place) return null;
      let best = null, bestD = 300;
      for (const l of locsOf(e)) {
        const st = stations.get(l.sig);
        if (!st || l.dep === null) continue;
        const d = metres(place, st);
        if (d < bestD) { bestD = d; best = l; }
      }
      return best ? best.dep + e.delay * 60000 : null;
    },
    // When the trip should end: its last planned time + latest delay (0: not known).
    tripEnd(key) {
      const e = byKey.get(key);
      const locs = e ? locsOf(e) : [];
      const l = locs[locs.length - 1];
      return l ? (l.arr ?? l.dep) + e.delay * 60000 : 0;
    },
    // Has the train been reported leaving this location?
    departed(key, sig) { return Boolean(byKey.get(key)?.departed?.has(sig)); },
    // The planned time of the train's last known location (0: nothing known yet), to know when to ask for more.
    until(key) { return byKey.get(key)?.until ?? 0; },
    // Has the train finished its trip? Its latest reported passing is its arrival where its timetable ends (a
    // location with an arrival and no departure).
    finished(key) {
      const e = byKey.get(key), p = e?.passed;
      if (!p || p.activity !== 'Ankomst') return false;
      const loc = locsOf(e).find(l => l.sig === p.sig);
      return Boolean(loc && loc.arr !== null && loc.dep === null);
    },
    // Whether anything of the train's timetable is known.
    knows(key) { return Boolean(byKey.get(key)?.rows.size); },
    // Where it last passed: { sig, time, activity } or null.
    lastPassing(key) { return byKey.get(key)?.passed ?? null; },
    // A station's place on the track (snapped), or null.
    placeOf, placesOf,
    get count() { return byKey.size; },
    // Where train `key`, at `place` going `heading`, is headed next: its next planned stop ahead, else the next
    // location ahead. { sig, stop, snap, eta (expected arrival, ms: planned + its latest delay; null if not planned) }
    // or null when not known. skip: signatures already confirmed reached (src/trains.js), which count as behind.
    toward(key, place, heading, skip = null) {
      const e = byKey.get(key);
      if (!e || !net || heading === null || heading === undefined) return null;
      const locs = locsOf(e).filter(l => stations.has(l.sig));
      if (!locs.length) return null;
      // The location nearest the train; the next one is it (when it lies ahead) or the one after.
      let near = 0, nearD = Infinity;
      locs.forEach((l, i) => { const d = metres(place, stations.get(l.sig)); if (d < nearD) { nearD = d; near = i; } });
      const ahead = (l) => { const st = stations.get(l.sig); return metres(place, st) > 50 && angle(heading, headingOf(place, st)) < 90; };
      let next = ahead(locs[near]) ? near : near + 1;
      // A location the train was moved to by a reported passing is behind it, whatever its last position says.
      while (next < locs.length && skip?.has(locs[next].sig)) next++;
      if (next >= locs.length) return null;
      const pick = locs.slice(next).find(l => l.stop) ?? locs[next];
      const snap = placeOf(pick.sig);
      if (!snap) return null;
      const planned = pick.arr ?? pick.dep;
      return { sig: pick.sig, stop: pick.stop, snap, snaps: placesOf(pick.sig), eta: planned === null ? null : planned + e.delay * 60000 };
    },
  };
}
