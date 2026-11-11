// The trains on the map: the last few reports per train, and where to draw each one at a given moment.
//
// The map runs DELAY_MS behind real time. A report reaches us a median 8 s after it was measured (90 % within 13 s),
// so at "now - 15 s" most trains have a report on each side, and the dot glides between two real positions at the
// train's real speed. A train with no newer report stays at its last one (it may be standing, or late to report).

export const DELAY_MS = 15 * 1000;
const MAX_AGE_MS = 10 * 60 * 1000;   // a report older than this is not shown; a train silent this long is removed
const KEEP_MS = 3 * 60 * 1000;       // history kept per train
const MAX_GLIDE_KMH = 300;           // faster than this between two reports is a position jump: jump, don't glide

// Distance in metres between two reports (flat approximation, fine over a few km).
function metres(a, b) {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371000;
}

export function createTrains() {
  const byId = new Map();   // id -> { latest: report, history: [reports, oldest first] }
  let lastReport = 0;       // time of the newest report we have, from Trafikverket's clock

  function placeAt(t, h) {
    // Before the first report we have: the first. After the last: the last.
    if (t <= h[0].time) return { lon: h[0].lon, lat: h[0].lat, moving: false };
    const last = h[h.length - 1];
    if (t >= last.time) return { lon: last.lon, lat: last.lat, moving: false };
    let i = h.length - 1;
    while (h[i - 1].time > t) i--;
    const a = h[i - 1], b = h[i];
    const kmh = metres(a, b) / ((b.time - a.time) / 1000) * 3.6;
    if (kmh > MAX_GLIDE_KMH) return { lon: a.lon, lat: a.lat, moving: false };   // a jump: stay, then jump
    const f = (t - a.time) / (b.time - a.time);
    return { lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f, moving: kmh > 1 };
  }

  return {
    // Take in a batch of records. Returns true if anything changed.
    update(records, now = Date.now()) {
      let changed = false;
      for (const r of records) {
        if (r.gone) { changed = byId.delete(r.id) || changed; continue; }
        if (!(r.time > now - MAX_AGE_MS)) continue;            // too old (the stream has sent 2-day-old ones)
        let t = byId.get(r.id);
        if (t && t.latest.time >= r.time) continue;              // not newer than what we have
        if (!t) { t = { latest: r, history: [] }; byId.set(r.id, t); }
        t.latest = r;
        t.history.push(r);
        while (t.history.length > 2 && t.history[1].time < now - KEEP_MS) t.history.shift();
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
    // Where train id is drawn at time t.
    placeOf(id, t) { const tr = byId.get(id); return tr ? placeAt(t, tr.history) : null; },
    get count() { return byId.size; },
    get lastReport() { return lastReport; },
    // All trains as map features, placed at time t. propsFor(latestReport) adds the label and colour.
    toGeoJSON(t, propsFor) {
      const features = [];
      for (const tr of byId.values()) {
        const p = placeAt(t, tr.history);
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: { id: tr.latest.id, ...propsFor(tr.latest) },
        });
      }
      return { type: 'FeatureCollection', features };
    },
  };
}
