// The list of trains on the map: the newest report per train.

const MAX_AGE_MS = 10 * 60 * 1000;   // a report older than this is not shown; a train silent this long is removed

// Distance in metres between two records (flat approximation, fine over a few km).
function metres(a, b) {
  const r = Math.PI / 180;
  const x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371000;
}

export function createTrains() {
  const byId = new Map();
  let lastReport = 0;   // time of the newest report we have, from Trafikverket's clock

  return {
    // Take in a batch of records. Returns true if anything on the map changed.
    update(records, now = Date.now()) {
      let changed = false;
      for (const r of records) {
        if (r.gone) { changed = byId.delete(r.id) || changed; continue; }
        if (!(r.time > now - MAX_AGE_MS)) continue;            // too old (the stream has sent 2-day-old ones)
        const known = byId.get(r.id);
        if (known && known.time >= r.time) continue;            // not newer than what we have
        // A third of trains never send a speed: then work it out from the distance since the previous report.
        if (r.speed === null && known) {
          const m = metres(known, r), s = (r.time - known.time) / 1000;
          r.speed = Math.round(m / s * 3.6);
          r.speedWorkedOut = true;
        }
        byId.set(r.id, r);
        if (r.time > lastReport) lastReport = r.time;
        changed = true;
      }
      return changed;
    },
    // Drop trains that have been silent too long. Returns true if any were dropped.
    prune(now = Date.now()) {
      let changed = false;
      for (const [id, r] of byId) if (r.time < now - MAX_AGE_MS) { byId.delete(id); changed = true; }
      return changed;
    },
    get(id) { return byId.get(id) ?? null; },
    get count() { return byId.size; },
    get lastReport() { return lastReport; },
    // labelFor(record) gives the text under the dot.
    toGeoJSON(labelFor) {
      return {
        type: 'FeatureCollection',
        features: [...byId.values()].map(r => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
          // moving: 1 moving, 0 standing, -1 not known yet (no speed sent and no earlier report to compare with)
          properties: { id: r.id, label: labelFor(r), moving: r.speed === null ? -1 : r.speed > 0 ? 1 : 0, bearing: r.bearing },
        })),
      };
    },
  };
}
