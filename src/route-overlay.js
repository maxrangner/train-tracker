// The open train's line on the map: its whole route, the part travelled darker, the leg abroad dashed, the stops'
// names in pills. The way over the rail network is searched on a thread of its own (src/path-async.js), the last few
// kept; once drawn the line follows the train itself (src/path-follow.js).
//
// createRouteOverlay({ map, panel, trains, stations, net, netReady, netUrl, placeNow, drawnAt }) ->
//   onSelect(id), onRoute(id, route): the card's (src/panel.js) selection and its route
//   tick(ts, sel): each frame, the open train as drawn (sel): its line follows it, its progress moves on
//   keep(), release(): while a train's page is covered its line stays (the camera may ride it to a station on it)
//   clearUnlessOpen(): no card open: the line goes; pageOnTop(kind): a page came on top (only a train's and a
//   station's keep the line; a trip's keeps its stations' names)
//   ride(trainId, sig, to): the camera rides the train's last line to `to` when it passes sig (a Promise), else null
//   pathOf(id), placesAhead(id, route, stops): for the card's numbers and its "All places"
import { pathOf as straightPath, progressAlong, progressAt } from './path.js';
import { followPath } from './path-follow.js';
import { createPathSearch } from './path-async.js';
import { abroadEnds } from './abroad.js';
import { tripPlaces } from './places-ahead.js';

const PATH_CACHE_N = 5;   // routes kept: reopening a train doesn't search the network again (about 45 ms)
const FOLLOW_MS = 250;    // the line is checked against the train's own way this often
const PROGRESS_MS = 100;  // the travelled part moves on at most this often (it took a fifth of a frame)
const placesKey = places => places.map(p => `${p.sig}${p.stop ? '*' : ''}`).join('>');
const whenIdle = cb => (window.requestIdleCallback ? window.requestIdleCallback(cb, { timeout: 500 }) : setTimeout(cb, 50));

// The camera's ride along a line ([[lon, lat]]) from one place to another: the line's points between them.
const mx = lon => (lon + 180) / 360, my = lat => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
function pieceOf(c, p) {
  const x = mx(p.lon), y = my(p.lat);
  let best = 0, bd = Infinity;
  for (let i = 0; i < c.length - 1; i++) {
    const ax = mx(c[i][0]), ay = my(c[i][1]), dx = mx(c[i + 1][0]) - ax, dy = my(c[i + 1][1]) - ay, l = dx * dx + dy * dy;
    const f = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0, d = (ax + dx * f - x) ** 2 + (ay + dy * f - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function along(c, from, to) {
  const a = pieceOf(c, from), b = pieceOf(c, to), pts = [from];
  if (a < b) for (let k = a + 1; k <= b; k++) pts.push({ lon: c[k][0], lat: c[k][1] });
  else if (a > b) for (let k = a; k > b; k--) pts.push({ lon: c[k][0], lat: c[k][1] });
  pts.push(to);
  return pts;
}
const rideZoom = z => Math.min(14, Math.max(z, 12.5));

export function createRouteOverlay({ map, panel, trains, stations, net, netReady, netUrl, placeNow, drawnAt }) {
  let searchPath = null;
  netReady.then((n) => { if (n) searchPath = createPathSearch(netUrl, net); });
  const cache = new Map();
  let shown = null;   // { id, path, places, key, follow, base }: the open train's line (base: as drawn from the timetable)
  let last = null;    // { id, coords, sigs }: the line as last drawn, kept after its page is covered (the camera's ride)
  let kept = false;   // a train's page is being covered: its line stays
  let lastFollow = 0, lastProgress = 0, fullAsked = false;

  const clear = () => { map.setPath(null); map.setAbroad(null); map.setRouteStations(null); };
  async function cachedPath(places) {
    if (!net()) return straightPath(places, net());   // (no network yet: straight lines, not kept)
    const key = placesKey(places);
    let path = cache.get(key);
    if (path) cache.delete(key);
    else path = await searchPath(places, { reversals: stations.reversals() });
    cache.set(key, path);   // (the newest last)
    if (cache.size > PATH_CACHE_N) cache.delete(cache.keys().next().value);
    return path;
  }
  function showFollowed(r, place) {
    shown.path = r.path;
    map.setPath(r.path, r.slide);
    if (place) map.setPathProgress(progressAt(r.path, place));
  }

  return {
    onSelect(id) {
      if (shown && shown.id !== id) { shown = null; if (!kept) clear(); }
      else if (!kept) map.setRouteStations(null);   // (the new train's come with its route)
    },
    onRoute(id, route) {
      const places = [];
      for (const s of route.stops) {
        // (a trip split over several numbers, a diversion: its cancelled stops are often the old way)
        if (route.pieces > 1 && s.canceled) continue;
        const st = stations.get(s.station);
        if (!st || st.lon === null) continue;
        const prev = places[places.length - 1];
        if (prev && prev.sig === s.station) { prev.stop ||= s.advertised; prev.actual ||= s.actual; continue; }
        places.push({ sig: s.station, lon: st.lon, lat: st.lat, stop: s.advertised, actual: s.actual, mark: stations.shownAt(st) });
      }
      if (places.length < 2) return;
      // Shown once the camera has come to the train (a search on the page's own thread made the glide jump); searched
      // meanwhile on its own thread where there is one.
      const key = placesKey(places);
      const same = () => shown?.id === id && shown.key === key && shown.follow;
      const early = net() && searchPath?.offThread() && !same() ? cachedPath(places) : null;
      map.whenSettled().then(async () => {
        if (panel.openId !== id) return;   // closed, or another train opened meanwhile
        // (the same trip again: the line as it stands, not the timetable's again, which would jump)
        if (!same()) {
          const base = await (early ?? cachedPath(places));
          if (panel.openId !== id) return;
          if (!same()) {
            const follow = net() ? followPath(base, places, net(), { reversals: stations.reversals() }) : null;
            shown = { id, path: follow?.update(trains.wayOf(id), performance.now())?.path ?? base, places, key, follow, base: net() ? base : null };
            last = { id, coords: shown.path.coords, sigs: new Set(places.map(p => p.sig)) };
            panel.placesReady(id);
          }
        }
        const here = placeNow(id);
        let done = 0;
        if (here) done = progressAt(shown.path, here);
        else places.forEach((p, i) => { if (p.actual) done = progressAlong(shown.path)[shown.path.at[i]]; });
        map.setPathProgress(done);
        map.setPath(shown.path);
        map.setRouteStations(places.filter(p => p.stop).map(p => p.sig));
        // The leg abroad: dashed from the path's Swedish end to the foreign station (none when the border stop is cancelled).
        const ends = abroadEnds(route, stations.get), c = shown.path.coords;
        map.setAbroad([ends.from, ends.to].filter(e => e && !e.cut && e.lon !== null && c.length).map(e => ({ ...e,
          coords: e.dir === 'to' ? [c.at(-1), [e.lon, e.lat]] : [[e.lon, e.lat], c[0]] })));
        if (!trains.get(id)) map.fitPath(shown.path);   // not on the map: all of it in view
      });
    },
    tick(ts, sel) {
      const follow = sel && shown?.id === sel.id ? shown.follow : null;
      if (follow && ts - lastFollow >= FOLLOW_MS) {
        lastFollow = ts;
        const r = follow.update(trains.wayOf(sel.id), ts);
        if (r) showFollowed(r, sel);
        else if (follow.wantsFull && !fullAsked) {
          // (the rare full re-route of the way ahead, tens of ms, waits for a quiet moment)
          fullAsked = true;
          whenIdle(() => {
            fullAsked = false;
            if (shown?.follow !== follow) return;
            const r2 = follow.full(trains.wayOf(shown.id), performance.now());
            if (r2) showFollowed(r2, drawnAt(shown.id));
          });
        }
      }
      if (sel && shown?.id === sel.id && ts - lastProgress >= PROGRESS_MS) {
        lastProgress = ts;
        map.setPathProgress(progressAt(shown.path, sel));
      }
    },
    keep() { kept = true; },
    release() { kept = false; },
    clearUnlessOpen() { if (!panel.openId) clear(); },
    pageOnTop(kind) {
      if (panel.openId) return;
      if (kind === 'trip') { map.setPath(null); map.setAbroad(null); }
      else if (kind !== 'train' && kind !== 'station') clear();
    },
    ride(trainId, sig, to) {
      if (!to || last?.id !== trainId || !last.sigs.has(sig)) return null;
      const cam = map.camera();
      return map.ride(along(last.coords, cam, to), rideZoom(cam.z));
    },
    pathOf: id => (shown?.id === id ? shown.path : null),
    placesAhead(id, route, stops) {
      const sp = shown?.id === id && shown.base ? shown : null;
      const here = sp ? placeNow(id) : null;
      return tripPlaces(route, stops, sp?.base ?? null, sp?.places ?? null, stations.all, here ? progressAt(sp.base, here) : null);
    },
  };
}
