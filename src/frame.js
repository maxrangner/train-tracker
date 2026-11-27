// Drawing: one clock per frame. Each frame every train's simulation is brought to one moment (the map's delay ago),
// once; the camera, the 3D trains and the open train's marker all use those same places, so nothing creeps against
// anything else. Every train is worked out only when the dots are due (map.trainsEvery: as often as a movement can be
// seen at this zoom); between, only the open train moves on (trains.placedOne). The dots go through the map's worker,
// only those in or near the view. At an earlier moment (The day, src/day-view.js) the trains come from the day's history.
//
// createFrame({ trains, lateness, map, panel, filter, settings, route, places, reportOf, day, lateOf, drawDelay, now }) ->
//   all (every train), drawn (those drawn: all, or those the filter shows, and the open one), byId,
//   placeNow(id), invalidate(fresh) (the dots at once; fresh: every train worked out again), light(fn) (only these
//   trains, while a group's page or the lateness bar's colour is open), start()
import { label, lateClass } from './lateness.js';
import { minutesText } from './tag.js';
import { sunAt, altitude, HORIZON } from './sun.js';

const DAY_MOVED_MS = 33;      // The day's moment moved: its trains drawn at most 30 times a second
const DAY_STILL_MS = 250;     // ...else as the live map's, at most 4 times a second
const DAY_LIVE_MS = 1000;     // the live trains under The day: worked out once a second (Home, the search)
const DAY_SUN_MS = 150;       // the sun's line with The day's moment

export function createFrame({ trains, lateness, map, panel, filter, settings, route, places, reportOf, day, lateOf, drawDelay, now }) {
  let all = [], drawn = [], byId = new Map();
  let lastDraw = 0, lightTest = null;
  let dayDrawn = null, liveAllAt = 0, sunDrawnAt = 0;
  let dayById = new Map();   // The day's trains as last drawn (id -> place)
  let trailShown = null;     // the picked train's trip so far as on the map (Rewind)

  // The sun's line (Settings → Day and night): night where the sun is below the horizon; its place once a minute.
  let sunMinute = null, sunPlace = null;
  const sunFor = (T) => { const m = Math.floor(T / 60000); if (m !== sunMinute) { sunMinute = m; sunPlace = sunAt(T); } return sunPlace; };
  const nightAt = (x, sun) => (sun && altitude(x.lat, x.lon, sun) < HORIZON ? 1 : 0);
  const legendKey = x => (x.stale ? 'unknown' : lateClass(lateOf(x.id)));   // a train's lateness as the filter knows it

  // A dot's label: catching up with its data »» (the map's font has no ⏩); silent for 2 minutes, grey and faded.
  const propsFor = (r, sim) => {
    const m = lateness.get(r.id)?.minutes, syncing = sim?.syncing && !sim.stale;
    return { label: label(r.number, m) + (syncing ? ' »»' : ''), late: lateClass(m), stale: Boolean(sim?.stale),
      company: lateness.brand(r.id) ?? '',
      // (the far-out labels' parts, written like the bubbles: "2311 +1 min"; on time just "2311")
      num: String(r.number), mins: m === null || m === undefined || m === 0 ? '' : minutesText(m),
      rest: syncing ? ' »»' : '', night: sim?.night ? 1 : 0 };
  };
  // A train at an earlier moment (src/day-trains.js): its own number, company and lateness then.
  const pastProps = x => ({ label: label(x.number, x.late ?? undefined), late: lateClass(x.late), stale: false, company: x.brand ?? '',
    num: String(x.number), mins: x.late === null || x.late === undefined || x.late === 0 ? '' : minutesText(x.late), rest: '', night: x.night ? 1 : 0 });
  const point = (x, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lon, x.lat] }, properties: { id: x.id, bearing: x.bearing, ...properties } });

  function dayFrame(ts, view) {
    view.tick(ts);
    const T = view.moment;
    if (T === null) return;   // (a play just came to its end: live from the next frame)
    if (ts - liveAllAt > DAY_LIVE_MS) {
      liveAllAt = ts;
      all = places(now() - drawDelay).map(x => ({ ...x, brand: lateness.brand(x.id) }));
      byId = new Map(all.map(x => [x.id, x]));
    }
    if (T !== dayDrawn ? ts - lastDraw >= DAY_MOVED_MS : ts - lastDraw >= Math.max(DAY_STILL_MS, map.trainsEvery())) {
      lastDraw = ts;
      dayDrawn = T;
      const near = map.nearView(), sun = settings.dayNight ? sunFor(T) : null, features = [];
      drawn = [];
      dayById = new Map();
      for (const x of view.at(T, near)) {
        dayById.set(x.id, x);
        if (filter.active && !filter.shows(x.brand, x.late === null || x.late === undefined ? 'unknown' : lateClass(x.late))) continue;
        x.night = nightAt(x, sun);
        drawn.push(x);
        if (near(x.lon, x.lat)) features.push(point(x, pastProps(x)));
      }
      map.setTrains({ type: 'FeatureCollection', features });
      if (import.meta.env.DEV) window.__last3d = drawn;
    }
    // The picked train (src/day.js): its place in every frame, so the camera following it glides (as the open train live)
    const pk = view.picked, old = pk && dayById.get(pk), one = pk && view.placeOf(pk);
    if (one) {
      one.night = old?.night ?? 0;
      dayById.set(pk, one);
      const i = drawn.indexOf(old);
      if (i >= 0) drawn[i] = one;
    }
    map.tick(ts);
    map.setSelectedPlace(one || null, one ? pastProps(one) : null);
    if (one) map.drawIfMoved(one);
    view.placeBubble((...a) => map.labelAt(...a));
    const trail = view.trail();
    if (trail !== trailShown) { trailShown = trail; map.setTrail(trail); }
    if (ts - sunDrawnAt > DAY_SUN_MS) { sunDrawnAt = ts; map.sunUpdate(); }   // (it draws itself again only a minute on)
  }

  function frame(ts) {
    const view = day();
    if (view?.past) { dayFrame(ts, view); requestAnimationFrame(frame); return; }
    if (trailShown) { trailShown = null; map.setTrail(null); }   // (back to live: the Rewind train's line goes)
    const t = now() - drawDelay;
    const openId = panel.openId;
    const due = ts - lastDraw >= map.trainsEvery(Boolean(openId && map.following));
    if (due || !all.length) {
      const sun = settings.dayNight ? sunFor(t) : null;
      all = places(t).map(x => ({ ...x, brand: lateness.brand(x.id), night: nightAt(x, sun) }));
      drawn = lightTest ? all.filter(x => x.id === openId || (lightTest(x) && filter.lateShows(legendKey(x))))
        : filter.active ? all.filter(x => x.id === openId || filter.shows(x.brand, legendKey(x))) : all;
      byId = new Map(all.map(x => [x.id, x]));
    } else if (openId && byId.has(openId)) {
      const x = trains.placedOne(openId, t);
      if (x) {
        const old = byId.get(openId), one = { ...x, brand: lateness.brand(x.id), night: old.night };
        byId.set(openId, one);
        for (const list of [all, drawn]) { const i = list.indexOf(old); if (i >= 0) list[i] = one; }
      }
    }
    if (import.meta.env.DEV) window.__last3d = drawn;   // what the 3D layer draws (tools/follow-check.mjs)
    if (due) {
      lastDraw = ts;
      const near = map.nearView(), features = [];
      for (const x of drawn) {
        const r = near(x.lon, x.lat) && reportOf(x.id);
        if (r) features.push(point(x, propsFor(r, x)));
      }
      map.setTrains({ type: 'FeatureCollection', features });
    }
    map.tick(ts);
    const sel = openId && byId.get(openId);
    const r = sel && reportOf(sel.id);
    map.setSelectedPlace(sel || null, r ? propsFor(r, sel) : null);
    route.tick(ts, sel);
    // (drawn in this frame only when the open train moved a tenth of a pixel or more)
    if (sel) map.drawIfMoved(sel);
    requestAnimationFrame(frame);
  }

  if (import.meta.env.DEV) window.__drawn = () => ({ all: all.length, drawn: drawn.length });   // (tools/back-check.mjs)
  return {
    get all() { return all; },
    get drawn() { return drawn; },
    get byId() { return byId; },
    placeNow: id => (day()?.past ? dayById.get(id) ?? null : byId.get(id) ?? trains.placeOf(id, now() - drawDelay)),
    invalidate(fresh = false) { lastDraw = 0; if (fresh) { all = []; dayDrawn = null; } },
    light(fn) { lightTest = fn; lastDraw = 0; },
    start() { requestAnimationFrame(frame); },
  };
}
