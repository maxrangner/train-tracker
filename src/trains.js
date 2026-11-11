// The list of trains on the map: the newest report per train.

const MAX_AGE_MS = 10 * 60 * 1000;   // a report older than this is not shown; a train silent this long is removed

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
    get count() { return byId.size; },
    get lastReport() { return lastReport; },
    toGeoJSON() {
      return {
        type: 'FeatureCollection',
        features: [...byId.values()].map(r => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
          properties: { id: r.id, number: r.number, speed: r.speed, bearing: r.bearing },
        })),
      };
    },
  };
}
