// The stations (signature -> { sig, name, lon, lat, advertised }), from Trafikverket or the fetcher's files, and
// where trains really stand at each (public/stop-places.json, tools/stop-places.mjs: Trafikverket's point is often not
// at the platform). The map's rings and names and a flight to a station use that place; everything else Trafikverket's.
//
// createStationList({ routes, map }) -> { all (the Map), get(sig), name(sig), shownAt(st), ready (a Promise: the
//   list is in), reversals() (where a drawn route may turn round), set(map) (the list came) }
export function createStationList({ routes, map }) {
  let all = new Map();
  let stopPlaces = {};
  let loaded;
  const ready = new Promise((resolve) => { loaded = resolve; });
  const stopPlacesReady = fetch('stop-places.json').then(r => (r.ok ? r.json() : null)).then((j) => { stopPlaces = j?.places ?? {}; routes.setStopPlaces(stopPlaces); })
    .catch(e => console.warn('stop places:', e.message));
  const shownAt = (st) => { const p = stopPlaces[st.sig]; return p ? { ...st, lon: p[0], lat: p[1] } : st; };
  // (the advertised stations, worked out again only when the list changes)
  let reversalList = null, reversalFrom = null;
  return {
    get all() { return all; },
    get: sig => all.get(sig),
    name: sig => all.get(sig)?.name ?? sig,
    shownAt,
    ready,
    reversals() {
      if (reversalFrom !== all) { reversalFrom = all; reversalList = [...all.values()].filter(st => st.advertised && st.lon !== null); }
      return reversalList;
    },
    set(m) {
      all = m;
      loaded();
      routes.setStations(new Map([...m].filter(([, st]) => st.lon !== null)));
      stopPlacesReady.then(() => map.setStations([...m.values()].filter(st => st.advertised && st.lon !== null).map(shownAt)));
    },
  };
}
