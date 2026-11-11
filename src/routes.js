// Each train's planned route from the timetable: the locations it passes or stops at, in order, with their places
// (Trafikverket's TrainStation list). Used for coasting: at junctions a coasting train takes the way to its next
// planned stop, and it never coasts to that stop (it waits STOP_BEFORE_M before it).
// A planned stop is a location with an arrival row ("Ankomst"); a location with only a departure row is passed (or
// is where the train starts). Plain JavaScript with no page parts, so the Node tools use it too.

const R = Math.PI / 180;
const NEXT_STOP_WITHIN_M = 20000;   // look for the next planned stop this far ahead (straight); else the next location

const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * R), b.lat - a.lat) * R * 6371000;
const headingOf = (a, b) => (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * R), b.lat - a.lat) / R + 360) % 360;
const angle = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// stations: Map signature -> { lon, lat }. net: the rail network, to put a station on its track.
export function createRoutes({ stations = new Map(), net = null } = {}) {
  const byKey = new Map();   // train key -> { rows: Map(sig|activity|time -> row), locs (ordered, built on demand), until }
  const snaps = new Map();   // signature -> the station's place on the track (or null)

  function locsOf(entry) {
    if (entry.locs) return entry.locs;
    const rows = [...entry.rows.values()].sort((a, b) => a.planned - b.planned);
    const locs = [];
    for (const r of rows) {
      const last = locs[locs.length - 1];
      if (last && last.sig === r.sig) { if (r.activity === 'Ankomst') last.stop = true; continue; }
      locs.push({ sig: r.sig, planned: r.planned, stop: r.activity === 'Ankomst' });
    }
    return (entry.locs = locs);
  }
  function placeOf(sig) {
    if (!snaps.has(sig)) {
      const st = stations.get(sig);
      snaps.set(sig, st && net ? net.snap(st, null, 500) : null);
    }
    return snaps.get(sig);
  }

  return {
    setStations(map) { stations = map; snaps.clear(); },
    setNet(n) { net = n; snaps.clear(); },
    // rows: [{ key (trainKey), sig, activity ('Ankomst' / 'Avgang'), planned (ms) }]
    add(rows) {
      for (const r of rows) {
        let e = byKey.get(r.key);
        if (!e) byKey.set(r.key, e = { rows: new Map(), locs: null, until: 0 });
        e.rows.set(`${r.sig}|${r.activity}|${r.planned}`, r);
        e.locs = null;
        if (r.planned > e.until) e.until = r.planned;
      }
    },
    // The planned time of the train's last known location (0: nothing known yet), to know when to ask for more.
    until(key) { return byKey.get(key)?.until ?? 0; },
    get count() { return byKey.size; },
    // Where train `key`, at `place` going `heading`, is headed next: its next planned stop ahead when one is within
    // NEXT_STOP_WITHIN_M, else the next location ahead. { sig, stop, snap } or null when not known.
    toward(key, place, heading) {
      const e = byKey.get(key);
      if (!e || !net || heading === null || heading === undefined) return null;
      const locs = locsOf(e).filter(l => stations.has(l.sig));
      if (!locs.length) return null;
      // The location nearest the train; the next one is it (when it lies ahead) or the one after.
      let near = 0, nearD = Infinity;
      locs.forEach((l, i) => { const d = metres(place, stations.get(l.sig)); if (d < nearD) { nearD = d; near = i; } });
      const ahead = (l) => { const st = stations.get(l.sig); return metres(place, st) > 50 && angle(heading, headingOf(place, st)) < 90; };
      const next = ahead(locs[near]) ? near : near + 1;
      if (next >= locs.length) return null;
      let pick = locs[next];
      for (let i = next; i < locs.length; i++) {
        if (metres(place, stations.get(locs[i].sig)) > NEXT_STOP_WITHIN_M) break;
        if (locs[i].stop) { pick = locs[i]; break; }
      }
      const snap = placeOf(pick.sig);
      return snap ? { sig: pick.sig, stop: pick.stop, snap } : null;
    },
  };
}
