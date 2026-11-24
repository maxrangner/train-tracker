import { startTrainSource } from './trains-source.js';
import { icon } from './icons.js';
import { splitLabel, tagHtml, minutesText } from './tag.js';
import { createTrains } from './trains.js';
import { createLateness, label, lateClass } from './lateness.js';
import { createMap, ownMap } from './map.js';
import { createPanel } from './panel.js';
import { drawInfo } from './train-info.js';
import { tripPlaces } from './places-ahead.js';
import { createSpeedLog } from './speed-log.js';
import { createMenu } from './menu.js';
import { createBoard } from './board.js';
import { pathOf, progressAlong, progressAt } from './path.js';
import { followPath } from './path-follow.js';
import { createPathSearch } from './path-async.js';
import { favourites } from './favourites.js';
import { settings, setSetting, onSettingChange } from './settings.js';
import { t, translatePage, lang } from './i18n.js';
import { ACCENTS, DEFAULT_ACCENT } from './colours.js';
import { onTap } from './sheet.js';
import { createStack, hooks } from './stack.js';
import { createLine } from './line.js';
import { homePage, groupPage, groupOf, trainRow, stationRow, groupRow } from './home.js';
import { STAND_MS } from './trains.js';
import { logoSvg } from './logo.js';
import { stateHtml } from './state.js';
import { followPassings, fetchStations, fetchPlannedRoutes, fetchBoard, fetchStationDay, fetchCancelledToday, fetchDisruptions, fetchStationMessages, fetchDayArrivals, setTapAsker, hasKey, fetchRunsByNumber, pickRun } from './trafikverket.js';
import { startFilesSource, filesTapAsker } from './files-source.js';
import { createDisruptions, rowHtml, cardHtml, isWork, placesText } from './disruptions.js';
import { loadNet } from './rail-net.js';
import { createRoutes } from './routes.js';
import { now, hhmm, swedishDay } from './clock.js';
import { startReplaySource } from './replay-source.js';
import { createStats } from './stats.js';
import { createConnection, pillText } from './connection.js';
import { createDayStats } from './day-stats.js';
import { createFilter } from './filter.js';
import { kindOf } from './train-kinds.js';
import kofiCup from './kofi-cup.png';
import { abroadEnds } from './abroad.js';
import { esc } from './html.js';
import { addScrollbar } from './scrollbar.js';
import { roll, arrive, reduceMotion } from './motion.js';
// The sheet's ideas (build plan parts 3 and 6, 2026-11-23): My trains and the change, "You seem to be on", Peek, the
// shop window, Share, "Why are we standing?".
import { createMyTrains } from './my-trains.js';
import { createRide } from './ride.js';
import { createPeek } from './peek.js';
import { createShopWindow } from './shop-window.js';
import { shareTrain, sharedNumber, dropShared } from './share.js';
import { whyStanding, whyLate, LATE_MIN, STAND_MS as STOOD_MS } from './why-standing.js';
import { createDayView, DAY_CSS } from './day-view.js';
import { sunAt, altitude, HORIZON } from './sun.js';

// #replay=<name> in the address plays a recording (data/positions-<name>.jsonl, from tools/collect.mjs) instead of
// the live data, e.g. #view=11/59.33/18.06&replay=2026-11-11T16-46-20-921Z. The page's clock then runs from the
// recording's start (src/clock.js).
const replay = new URLSearchParams(location.hash.slice(1)).get('replay');
// The public page reads the fetcher's files instead (public-plan step 3, src/files-source.js): VITE_DATA_URL in the
// build; taps too come from its files (plan step 4, 2026-11-17: filesTapAsker); no key in the page. On the dev page
// also #files=<address> for tests (only there: a link can't point the public page elsewhere). Otherwise the key, as
// before (the dev page, the Android dev app).
const hashOpt = new URLSearchParams(location.hash.slice(1));
const filesBase = replay ? null : (import.meta.env.DEV && hashOpt.get('files')) || import.meta.env.VITE_DATA_URL || null;
const fromFiles = Boolean(filesBase);
if (fromFiles) setTapAsker(filesTapAsker(kind => positionsFeed?.latestNow?.(kind) ?? Promise.resolve(null), now));   // (asked at once: 2026-11-22)
const live = !replay && (hasKey || fromFiles);   // live data of some kind: stations, disruptions, stats, messages
// A shared train (src/share.js; #train=531): opened once the trains are in (openShared, below); out of the address at
// once, as #view.
const sharedAt = sharedNumber();
if (sharedAt) dropShared();
// The files come every 5 s, a few seconds after the reports: drawn 30 s behind instead of 25, the movement is as
// good as today's (tools/motion-check.mjs --files, 5 recordings, 2026-11-16).
const FILES_DELAY_MS = 30 * 1000;

window.__started = true;
document.documentElement.dataset.motion = settings.pageMotion;   // how a page comes in (index.html :root[data-motion]; Debug)
document.documentElement.dataset.mspeed = settings.motionSpeed;   // and how fast (Debug)   // index.html reports it on screen if this line is never reached
translatePage();           // the page's own words in the chosen language (Settings → Language)
// The rail network: the tracks the trains follow, and Trafikverket's rail lines on the map. Positions start once it
// has loaded (or failed: then trains move in straight lines between reports).
const netReady = loadNet(new URL('rail-net.json', location.href).href).catch((e) => {
  console.warn(`rail network: ${e.message} (run node tools/rail-net.mjs)`);
  return null;
});
const trains = createTrains(fromFiles ? { delayMs: FILES_DELAY_MS } : {});
const DRAW_DELAY_MS = trains.DELAY_MS;   // how far behind real time the map is drawn
let net = null;
// The open train's route is searched on a thread of its own (src/path-async.js, 2026-11-21): it held the map up to
// 300 ms on the PC, over a second on a 4 times slower processor. Started once the page's own network is there (the
// worker loads the same file again, then from the browser's cache).
let searchPath = null;
netReady.then((n) => { net = n; if (n) searchPath = createPathSearch(new URL('rail-net.json', location.href).href, () => net); });
let shownPath = null;   // { id, path, places, key, follow, base }: the open train's path (follow: src/path-follow.js; base: as drawn from the timetable)
// The open train's line as last drawn ({ id, coords, sigs: its stations }): kept after its page is covered, so the camera
// can ride it to a station on it and back (src/map.js ride). holdPath: a train's page is being covered; its line stays.
let lastPath = null, holdPath = false;
const clearPath = () => { map.setPath(null); map.setAbroad(null); map.setRouteStations(null); };
const placesKey = places => places.map(p => `${p.sig}${p.stop ? '*' : ''}`).join('>');
const pathCache = new Map(), PATH_CACHE_N = 5;   // the last drawn routes (onRoute's cachedPath)
// The stations where a drawn route may turn round (src/path.js): the advertised ones, worked out again when the list changes.
let reversalList = null, reversalFrom = null;
const reversalPlaces = () => { if (reversalFrom !== stations) { reversalFrom = stations; reversalList = [...stations.values()].filter(st => st.advertised && st.lon !== null); } return reversalList; };
if (import.meta.env.DEV) Object.assign(window, { __trains: trains, __now: now });   // for the tools in tools/; not in a build
// Each train's planned route (timetable): at junctions a coasting train takes the way to its next planned stop,
// and it waits before that stop rather than arriving in the drawing.
const routes = createRoutes();
trains.useRoutes(routes);
netReady.then(net => { if (net) routes.setNet(net); });
const lateness = createLateness();
if (import.meta.env.DEV) window.__lateness = lateness;   // (tools/ui-motion-check.mjs changes a train's minutes)
const stats = createStats({ keep: !replay });   // the stats page's running numbers (src/stats.js)
// Which trains the map shows (src/filter.js): chosen by tapping companies and kinds on the stats page.
const filter = createFilter();
// Today's arrivals for the stats page's graph: asked for only while that page is open (live: with the key, or from
// the fetcher's arrivals files).
const dayStats = live ? createDayStats({ now, loadArrivals: fromFiles ? filesArrivals : fetchDayArrivals }) : null;
let stations = new Map();   // signature -> { sig, name, lon, lat, advertised }
const stationName = sig => stations.get(sig)?.name ?? sig;
// Where trains really stand at a station (public/stop-places.json, tools/stop-places.mjs; 280 stations measured from the
// recordings): the map draws its ring and name there, and a flight to it lands there (Max, 2026-11-14; Trafikverket's
// point is often not at the platform: Bohus 1.3 km off). The movement uses it too (src/routes.js setStopPlaces, Max
// 2026-11-14, point 5 B): a train seen only at fixed places waits there for its stop, and the dwell rule looks there at
// the stations where it is over 200 m from the point. Everything else keeps Trafikverket's point.
let stopPlaces = {};
const stopPlacesReady = fetch('stop-places.json').then(r => (r.ok ? r.json() : null)).then((j) => { stopPlaces = j?.places ?? {}; routes.setStopPlaces(stopPlaces); })
  .catch(e => console.warn('stop places:', e.message));
const shownAt = (st) => { const p = stopPlaces[st.sig]; return p ? { ...st, lon: p[0], lat: p[1] } : st; };

const minutesOf = r => lateness.get(r.id)?.minutes;
const labelFor = r => label(r.number, minutesOf(r));
// While a train fast-forwards to catch up with its data, its label gets »» (the map's font has no ⏩). A stale train
// (silent for 2 minutes, or no data at all) is drawn grey and faded.
const propsFor = (r, sim) => ({
  label: labelFor(r) + (sim?.syncing && !sim.stale ? ' »»' : ''), late: lateClass(minutesOf(r)), stale: Boolean(sim?.stale),
  company: lateness.brand(r.id) ?? '',
  // The far-out labels' parts, written like the bubbles: "2311 +1 min", the minutes in their colour (round 4); on
  // time just "2311" (Max, 2026-11-21, option i B).
  num: String(r.number), mins: minutesOf(r) === null || minutesOf(r) === undefined || minutesOf(r) === 0 ? '' : minutesText(minutesOf(r)),
  rest: sim?.syncing && !sim.stale ? ' »»' : '',
  night: sim?.night ? 1 : 0,   // (on the night side of the sun's line: its dot's glow)
});
// A train at an earlier moment (The day, src/day-trains.js): its own number, company and lateness then.
const pastProps = x => ({ label: label(x.number, x.late ?? undefined), late: lateClass(x.late), stale: false, company: x.brand ?? '',
  num: String(x.number), mins: x.late === null || x.late === undefined || x.late === 0 ? '' : minutesText(x.late), rest: '', night: x.night ? 1 : 0 });
// The sun's line (src/sun.js; Settings → Day and night): night where the sun is below the horizon at the moment drawn;
// its place worked out once a minute. A train there has lit windows (3D) or a glow round its dot.
let sunMinute = null, sunPlace = null;
const sunFor = (T) => { const m = Math.floor(T / 60000); if (m !== sunMinute) { sunMinute = m; sunPlace = sunAt(T); } return sunPlace; };
const nightAt = (x, sun) => (sun && altitude(x.lat, x.lon, sun) < HORIZON ? 1 : 0);
// The day (build plan part 4; src/day-view.js): made the first time ☰ → The day is opened (the page reading files only).
let dayView = null;

// Where a train is drawn in this frame (the camera follows exactly this place).
// A short buzz when a train is opened or followed (round 4). In the app through Capacitor's haptics plugin (Max,
// 2026-11-20: "No haptics in app": the app never had Android's permission to vibrate, so the page's vibrate did
// nothing; the plugin brings it, and works on iPhones too); on the web page navigator.vibrate (Android browsers only).
const native = Boolean(window.Capacitor?.isNativePlatform?.());
const haptics = native ? import('@capacitor/haptics').catch(() => null) : null;
const buzz = () => {
  if (haptics) { haptics.then(h => h?.Haptics.impact({ style: h.ImpactStyle.Light })).catch(() => { /* not here */ }); return; }
  try { navigator.vibrate?.(8); } catch { /* not allowed here */ }
};
const placeNow = id => frameById.get(id) ?? trains.placeOf(id, now() - DRAW_DELAY_MS);
// Gone, or dragged off the screen or behind the panel: following stops, the card stays open (map.js).
const follow = id => map.follow(() => placeNow(id), () => panel.setFollowing(false));
const speedLog = createSpeedLog();   // every train's speeds of the last 10 minutes (the card's own numbers, "i")
// The pages of the one sheet (src/stack.js): made at the end of this file, used by everything that opens something.
let stack = null;
let myTrains = null, ride = null, peek = null, shop = null;   // the sheet's ideas (made after the stack, at the end)
const panelEl = document.getElementById('panel');
const panel = createPanel(panelEl, {
  stationName,
  // In the sheet: its × takes its page away, "All stops" raises the sheet, a stop opens its station's page.
  onCloseTap: id => stack.close(`train:${id}`),
  onMore: full => stack.setLevel(full ? 2 : 1),
  // its messages opened (shown at once: the sheet rises or the page scrolls to them; Max, 2026-11-23) or shut
  onFold: (open, box) => (open ? stack.reveal(box) : stack.unreveal()),
  onStop: sig => openStation(sig),
  // under its tiles: why it stands, Share, Add my change (trainExtras, below)
  extra: id => trainExtras(id),
  // the card's head line drawn again: its share, star and Follow back in it (the train page's barIn)
  onHead: () => stack?.refreshBar(),
  // the line on how its place is known (also each second, below), for a card just opened
  statusOf: id => statusLine(trains.stateOf(id, now() - DRAW_DELAY_MS), lastDataAt !== null && now() - lastDataAt > NO_DATA_MS),
  station: sig => stations.get(sig),   // a trip's end abroad (src/abroad.js)
  lateOf: id => { const r = trains.get(id); return r ? minutesOf(r) : undefined; },   // the card's lateness tile, as on the map
  // The train's own numbers ("i" on the full card; src/train-info.js), each second while shown.
  info: (box, c) => {
    const r = trains.get(c.id);
    drawInfo(box, { ...c, t: now() - DRAW_DELAY_MS, now: now(), log: speedLog, net, stationName, station: sig => stations.get(sig),
      path: shownPath?.id === c.id ? shownPath.path : null, place: frameById.get(c.id) ?? null, late: r ? minutesOf(r) : null });
  },
  // "All places" on the full card (src/places-ahead.js): the places between the stops, those ahead worked out from the
  // route as drawn from the timetable (shownPath.base: its places are the trip's stations, path.at where each is).
  places: (id, route, stops) => {
    const sp = shownPath?.id === id && shownPath.base ? shownPath : null;
    const here = sp ? placeNow(id) : null;
    return tripPlaces(route, stops, sp?.base ?? null, sp?.places ?? null, stations, here ? progressAt(sp.base, here) : null);
  },
  onSelect(id) {
    map.select(id);
    if (!id) map.unfollow();   // the map stays exactly as it is
    // (a train's page covered by a station on its route: its line stays while the camera rides it there; holdPath)
    if (shownPath && shownPath.id !== id) { shownPath = null; if (!holdPath) clearPath(); }
    else if (!holdPath) map.setRouteStations(null);   // the new train's come with its route
  },
  // The open train's whole path, start to finish (Max, 2026-11-12): green, the part travelled darker (Max,
  // 2026-11-13). On the map the darker part ends at the train (each frame, below); a train not on the map has
  // travelled up to the last place it was reported at.
  onRoute(id, route) {
    // The last few drawn routes are kept (the review's F09, 2026-11-17): reopening a train doesn't search the rail
    // network again (about 45 ms). Keyed by the stations in order and which are stops (all the way's search uses).
    const cachedPath = async (places) => {
      if (!net) return pathOf(places, net);   // (the network not loaded yet: straight lines, not kept)
      const key = placesKey(places);
      let path = pathCache.get(key);
      if (path) pathCache.delete(key);
      else path = await searchPath(places, { reversals: reversalPlaces() });   // (a train may turn round at a station: src/path.js REV_*)
      pathCache.set(key, path);   // (the newest last)
      if (pathCache.size > PATH_CACHE_N) pathCache.delete(pathCache.keys().next().value);
      return path;
    };
    const places = [];
    for (const s of route.stops) {
      // A trip split over several internal numbers (a diversion): its cancelled stops are often the old way (VR 2047,
      // 2026-11-15: Alingsås cancelled, the train went Herrljunga → Fristad → Göteborg), so the path leaves them out.
      if (route.pieces > 1 && s.canceled) continue;
      const st = stations.get(s.station);
      if (!st || st.lon === null) continue;
      const last = places[places.length - 1];
      if (last && last.sig === s.station) { last.stop ||= s.advertised; last.actual ||= s.actual; continue; }
      // mark: where the station's ring is (shownAt), so the route's stop dot sits next to it (Max, 2026-11-15).
      places.push({ sig: s.station, lon: st.lon, lat: st.lat, stop: s.advertised, actual: s.actual, mark: shownAt(st) });
    }
    if (places.length < 2) return;
    // Shown once the camera has come to the train: finding the way over the rail network on the page's own thread
    // (45-300 ms) made the glide jump (Max, 2026-11-15: "camera is very jerky"). Since 2026-11-21 it is searched on a
    // thread of its own (src/path-async.js), started at once, during the glide; where no such thread runs, after it.
    const key = placesKey(places);
    const kept = () => shownPath?.id === id && shownPath.key === key && shownPath.follow;
    const early = net && searchPath?.offThread() && !kept() ? cachedPath(places) : null;
    map.whenSettled().then(async () => {
      if (panel.openId !== id) return;   // closed, or another train opened meanwhile
      // The line follows the train itself (src/path-follow.js; Max, 2026-11-19: trains drawn beside their route). The
      // same trip again (its stations unchanged): the line as it stands, not the timetable's again (that would jump).
      if (!kept()) {
        const base = await (early ?? cachedPath(places));
        // Searched on its own thread meanwhile: closed, or another train opened, or this trip drawn already.
        if (panel.openId !== id) return;
        if (!kept()) {
          const follow = net ? followPath(base, places, net, { reversals: reversalPlaces() }) : null;
          shownPath = { id, path: follow?.update(trains.wayOf(id), performance.now())?.path ?? base, places, key, follow, base: net ? base : null };
          lastPath = { id, coords: shownPath.path.coords, sigs: new Set(places.map(p => p.sig)) };
          panel.placesReady(id);
        }
      }
      const here = placeNow(id);
      let done = 0;
      if (here) done = progressAt(shownPath.path, here);
      else places.forEach((p, i) => { if (p.actual) done = progressAlong(shownPath.path)[shownPath.path.at[i]]; });
      map.setPathProgress(done);
      map.setPath(shownPath.path);
      map.setRouteStations(places.filter(p => p.stop).map(p => p.sig));   // their names in pills (Max, 2026-11-15)
      // The leg abroad (src/abroad.js; Max, 2026-11-17: "only when that train is selected"): from the path's Swedish
      // end to the foreign station, dashed, marching the way the train goes; none when the stop at the border is
      // cancelled (the trip doesn't go there).
      const ends = abroadEnds(route, sig => stations.get(sig)), c = shownPath.path.coords;
      map.setAbroad([ends.from, ends.to].filter(e => e && !e.cut && e.lon !== null && c.length).map(e => ({ ...e,
        coords: e.dir === 'to' ? [c.at(-1), [e.lon, e.lat]] : [[e.lon, e.lat], c[0]] })));
      if (!trains.get(id)) map.fitPath(shownPath.path);   // not on the map: show all of it
    });
  },
  onFollow(id, on) {
    buzz();
    if (on) follow(id); else map.unfollow();
  },
});
const map = createMap('map', {
  // A plain tap on the map (not a drag): ☰'s menu closes in the same tap, and the tap goes on to what is under it (the
  // tap rules R1, R2: src/stack.js; until 2026-11-23 a tap with the menu open only closed the menu).
  onMapTap() {
    if (peek?.ate()) return true;   // (the finger lifted after a peek: src/peek.js)
    closeNav();
    return false;
  },
  railData: { trv: () => netReady.then(net => { if (!net) throw new Error('no rail network'); return net.toGeoJSON(); }) },
  // The 3D trains are drawn where this frame put them (see frame below), the same places the camera uses.
  getTrains3d: () => frameTrains,
  // Each car of a model sits on the track: a place d metres along a train's track from where it is drawn. (The day's
  // trains at an earlier moment are drawn straight: the live train's track is somewhere else by now.)
  alongTrack: (id, d) => (dayView?.past ? null : trains.along(id, d)),
  // The sun's line shows the moment drawn: the live map's, or The day's.
  sunTime: () => (dayView?.past ? dayView.moment : now() - DRAW_DELAY_MS),
  // Tapping a train opens its page and the camera follows it, whatever is open (R2). A tap on nothing: the tap rules'
  // R1 (src/stack.js mapTap): the sheet down to the page's lowest height, or, already there, every page closes.
  // At an earlier moment (The day): a small bubble over the train instead (number, company, lateness then).
  onTrainTap(id) {
    if (dayView?.past && (id || dayView.bubbleShown)) { if (id) dayView.bubble([id]); else dayView.hideBubble(); return; }
    if (openTrain(id)) return;
    stack.mapTap();
  },
  onStationTap(sig) { openStation(sig); },
  onDisruptionTap(id) { openDisruption(id); },
  onGroupTap(list) { if (dayView?.past) dayView.bubble(list.map(x => x.id)); else showPicker(list); },
});

// Buttons press in while held (index.html "Motion"; Max's pick 1, 2026-11-20). An iPhone shows :active on a touch
// only when the page listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true });

// The start screen (index.html) fades once the map shows only Sweden (map.shown), and is then taken away.
const splash = document.getElementById('splash');
// The start screen's logo draws itself in about 1.3 s (index.html): the screen stays at least that long.
const SPLASH_MIN_MS = 1300;
// (and the drawing on its own thread has finished: index.html window.__splashDrawn)
Promise.all([map.shown, window.__splashDrawn]).then(() => setTimeout(() => { splash.classList.add('gone'); setTimeout(() => { splash.hidden = true; }, 500); },
  Math.max(0, SPLASH_MIN_MS - performance.now())));

// The map credit (index.html #credit; Max, 2026-11-17): shown once the start screen has gone, faded on the first touch
// of the map (or a wheel) or after 5 s, then taken away; the full credits stay in About.
const CREDIT_MS = 5000;
const creditEl = Object.assign(document.createElement('div'), { id: 'credit' });
const creditLink = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
creditEl.innerHTML = `© ${creditLink('https://www.openstreetmap.org/copyright', 'OpenStreetMap')} © ${creditLink('https://openmaptiles.org/', 'OpenMapTiles')}` +
  (ownMap ? '' : ` · ${creditLink('https://openfreemap.org/', 'OpenFreeMap')}`);
const mapEl = document.getElementById('map');
mapEl.appendChild(creditEl);
// The phone's keyboard shrinks the page (interactive-widget=resizes-content, so the search list ends above it), and the
// map shrank with it: its middle moved up, and back down when the keyboard went (Max, 2026-11-19). While a text field
// has focus and the page is clearly lower than before, the map keeps its last full height and runs on behind the
// keyboard, so it doesn't move; everything else still fits above the keyboard.
// The field let go (the search closed, ☰ tapped), the keyboard takes a moment to go: the map keeps its full height
// until the page is tall again (or KEYBOARD_GONE_MS has passed), not shrinking to the short page first and growing
// back a moment later (Max, 2026-11-20: "a flicker on both menu and map going from search to menu"; measured with a
// stand-in keyboard: the map went 851 -> 421 -> 851 px within 0.2 s).
{
  const KEYBOARD_GONE_MS = 1000;
  let full = { w: innerWidth, h: innerHeight }, letGoAt = -Infinity;
  const fit = () => {
    const typing = Boolean(document.activeElement?.matches?.('input, textarea'));
    if (innerWidth !== full.w) { full = { w: innerWidth, h: innerHeight }; letGoAt = -Infinity; }
    const going = !typing && performance.now() - letGoAt < KEYBOARD_GONE_MS;   // the keyboard on its way down
    if ((typing || going) && innerHeight < full.h - 150) {
      mapEl.style.bottom = 'auto'; mapEl.style.height = `${full.h}px`;
    } else {
      full.h = innerHeight; mapEl.style.bottom = ''; mapEl.style.height = '';
    }
  };
  addEventListener('resize', fit);
  addEventListener('focusout', () => {
    letGoAt = performance.now();
    setTimeout(fit, 0);
    setTimeout(fit, KEYBOARD_GONE_MS + 50);   // (it never went: the page's own height again)
  });
}
map.shown.then(() => {
  const fade = (e) => {
    if (e?.target && creditEl.contains(e.target)) return;   // (a tap on one of its links opens it first)
    if (creditEl.classList.contains('gone')) return;
    creditEl.classList.add('gone');
    setTimeout(() => { creditEl.hidden = true; }, 700);
    for (const type of ['pointerdown', 'wheel']) mapEl.removeEventListener(type, fade);
  };
  setTimeout(fade, Math.max(SPLASH_MIN_MS - performance.now(), 0) + 500 + CREDIT_MS);   // 5 s seen, after the start screen
  for (const type of ['pointerdown', 'wheel']) mapEl.addEventListener(type, fade, { passive: true });
});

// ---- The one sheet (Max's pick A, 2026-11-22; src/stack.js): everything opened is a page in it, on a stack. These
// are the pages a key names; the stack itself is made at the end of this file. ----
for (const sel of ['#settings', '.help-body', '#conn-body']) addScrollbar(document.querySelector(sel));
const holder = document.getElementById('page-holder');   // where Settings, About and Connection wait while not shown
const trainMeta = new Map();   // trains opened that aren't on the map (the timetable search, a board): id -> { operational, date, number }
let lightTest = null;          // only these trains on the map (a group's page, the lateness bar's colour): x -> true
const light = (fn) => { lightTest = fn; lastDraw = 0; };
const lateOf = id => { const m = lateness.get(id)?.minutes; return m === undefined ? null : m; };
const legendKey = x => (x.stale ? 'unknown' : lateClass(lateOf(x.id)));   // a train's lateness as the filter knows it

// The camera rides the rails (A's ride): the places along a line ([[lon, lat]]) from one place to another.
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
let lastCardHalf = 0;
// The open card's height: its first fit once it is in exactly (the sheet then moves once, up or down: no bounce); after
// that only taller as parts come in, or either way within 1.5 s of the person touching the card (the chooser shut).
function refitCard() {
  const def = stack.pageDef(stack.top());
  const done = Boolean(panelEl.querySelector('.panel-more, .state.empty, .state.error'));
  if (done && def?.fitted?.() === false) { stack.refit(); return; }
  stack.refit({ grow: performance.now() - cardTouched > 1500 });
}   // the last train card's half, measured (px from its page's top): a new card's until its own is in

// ---- A train ----
function trainPage(id) {
  const meta = () => {
    const r = trains.get(id);
    if (r) return { id: r.id, operational: r.operational, date: r.date, number: r.number, label: labelFor(r), onMap: true };
    const m = trainMeta.get(id);
    return m ? { ...m, id, label: String(m.number), onMap: false } : null;
  };
  const m0 = meta();
  if (!m0) return null;
  let myEl = null;   // this train's page (show): the card goes back to the holder only from here
  let wantHalf = 0, wantLow = 0;   // the card's half and low, last measured while compact (half(), low() below)
  let fitted = false;              // its whole card measured once (its first fit: stack.refit's settle)
  const number = () => String(meta()?.number ?? m0.number);
  // How far down the card goes (px from the page's top edge): whole, to "More", or condensed (its head and the line
  // under it). Still coming in (no "More" yet, no empty or error state): the last train card's (the sheet waits where
  // it is instead of fitting what is half drawn and moving again when the rest comes: a bounce, sheet-moves-check).
  const CARD_GAP = 4;   // (under "More": 20, then 10 were too much on Max's phone, 2026-11-23)
  function cardTo(whole) {
    const pg = panelEl.parentElement;
    if (panel.openId !== id || !pg?.classList.contains('pg') || panelEl.classList.contains('full')) return whole ? wantHalf : wantLow;
    const top = pg.getBoundingClientRect().top - pg.scrollTop;
    const below = el => el && el.offsetParent ? el.getBoundingClientRect().bottom - top : 0;
    // Still coming in (the last card's parts may still be in it): the sheet waits where it is; once the card is in, it
    // moves once to fit it exactly, up or down (refitCard). Until 2026-11-23 it took the last card's height and, only
    // ever growing, kept that empty space under a shorter card (Max's phone: "too much empty space down").
    if (whole && !panelEl.querySelector('.panel-more, .state.empty, .state.error')) {
      // (at most half the screen: from Home at full a loading card covered it all until its stops came; the handle is
      // its head since the bar went, 20 px, 30 on a computer, as src/stack.js counts it)
      return Math.max(1, Math.round(Math.min(stack.shown, innerHeight * 0.5) - stack.headPx()));
    }
    if (!whole) {
      // collapsed: the head line alone (number, operator, destination; the rest is hidden at low: index.html)
      const b = below(panelEl.querySelector('.panel-head'));
      if (b > 0) wantLow = Math.ceil(b + 12);
      return wantLow;
    }
    const b = below(panelEl.querySelector('.panel-more')) || below(panelEl);
    if (b > 0) { lastCardHalf = wantHalf = Math.ceil((b + CARD_GAP) / 4) * 4; fitted = true; }
    return wantHalf;
  }
  return {
    name: number, kind: 'train',
    show(el, { prev, dir, go = false, again = false }) {
      myEl = el;
      el.append(panelEl);
      const m = meta() ?? m0;
      const fresh = panel.openId !== id;
      if (fresh) panel.open(m, { follow: m.onMap });
      else if (panel.hidden) panel.show();
      // (a train just opened starts compact, whatever height the sheet had: from the search at full it took that height
      // and measured itself full, then dropped, 2026-11-23)
      panelEl.classList.toggle('full', dir <= 0 && stack.level === 2);
      if (!m.onMap) { map.unfollow(); return; }
      buzz();
      panel.setFollowing(true);
      // Back from (or over from) a station on its route: the camera rides its line there, then follows it.
      const p = placeNow(id);
      if (!again && prev?.kind === 'station' && lastPath?.id === id && lastPath.sigs.has(prev.key.slice(8)) && p) {
        const cam = map.camera();
        map.ride(along(lastPath.coords, cam, p), rideZoom(cam.z)).then((ok) => { if (ok && stack.top() === `train:${id}`) follow(id); });
        return;
      }
      const following = follow(id);
      if ((go || dir < 0) && p) following.then(() => map.goTo(p, go ? 13 : map.camera().z, true));
    },
    // (its card goes back to the holder: an element taken off the page with its page couldn't be found by its id)
    // (the card leaves only this page: going back to a train opened earlier, another train's page closing between it
    // and the top took the card from that train's page, which then showed empty; Max's PC and phone, 2026-11-23)
    hide() { if (shareNote?.id === id) shareNote = null; if (panel.openId === id) { holdPath = true; panel.close(); holdPath = false; } if (panelEl.parentElement === myEl) holder.append(panelEl); },
    unmount() { if (panel.openId === id) panel.close(); if (panelEl.parentElement === myEl && myEl) holder.append(panelEl); },
    level(i) { if (panel.openId === id) panelEl.classList.toggle('full', i === 2); },
    // (its content at full, measured with its full look on for that moment: the sheet's full stops under it; src/stack.js
    // fullOf)
    atFull(measure) {
      if (panel.openId !== id || panelEl.classList.contains('full')) return measure();
      panelEl.classList.add('full');
      const end = measure();
      panelEl.classList.remove('full');
      return end;
    },
    // Half: down to the card's "More" with room under it and nothing more (Max, 2026-11-23: "More" lay under Android's
    // own bar at the bottom of a short screen; then "empty space under More", on the phone and the computer). Measured
    // only while the card is compact and the sheet not at full (with all stops open "More" is elsewhere: the last
    // measure is kept). No "More" yet (its stops still coming): down to what the card shows, so it only grows.
    half: () => cardTo(true),
    // Low: on a computer the whole card down to "More" (Max, 2026-11-23: "the most compact view should be including all
    // the way to 'mer'"), so low and half are one; on a phone the condensed card, its number and the line under it, with
    // room under them (his phone: "nice where there is less screen"; "no padding under 'Kort tåg'").
    low: () => (innerWidth >= 440 ? cardTo(true) : cardTo(false)),
    every() { if (panel.openId === id) { drawExtras(id); refitCard(); } },
    fitted: () => fitted,
    // a map tap: the "to …" chooser shuts with it (the tap rules' R1, src/stack.js)
    dismiss() { if (panel.openId === id) panel.closePick(); },
    star: { on: () => favourites.has('train', number()), toggle: () => favourites.toggle('train', number()) },
    // Share beside the star (Max, 2026-11-23)
    acts: () => [{ id: 'share', icon: 'share', label: t('share') }],
    act: (what) => { if (what === 'share') shareOpen(); },
    // share, star and Follow in the card's top line beside the number, as before the sheet (Max, 2026-11-23); the sheet
    // has no bar over a train
    barIn: () => (panel.openId === id && panelEl.parentElement === myEl ? panelEl.querySelector('.panel-buttons') : null),
    // (‹ first on the card's top line when it was opened from another page (a trip, a station, a company, the search...):
    // Max, 2026-11-24 "When viewing my trip and clicking a train showing it's card. THAT card should have a back button";
    // then "only on the situation I mentioned or similar, not always. Just clicking a train now shows the back arrow":
    // over Home (a train tapped on the map) none; nor over another train: from train to train on the map is no going
    // back, Max 2026-11-24 "Back button is only when coming from a different screen, like station or trip selecting a
    // train. Not just tapping between them on the map")
    noUp: () => { const below = stack.keys().at(-2) ?? 'home'; return below === 'home' || below.startsWith('train:'); },
    follow: { can: () => panel.openId === id && panel.canFollow, on: () => panel.following, toggle: () => panel.toggleFollow() },
    redraw: () => panel.relabel(),
  };
}
// ---- A train's page, under its tiles (2026-11-23): "Why are we standing?", Share, Add my change ----
const extrasEl = Object.assign(document.createElement('div'), { className: 'tr-extras' });
// How long the train has stood still (ms) by its reported speeds (src/speed-log.js): from its newest report back while
// each is under 2 km/h (or, sending no speed, within 40 m of the newest). A train silent since its last report (531 at
// Hjärup on 17 Nov sent nothing for over an hour) counts as standing since then; whyFor also wants it drawn standing.
function stoodFor(id, at) {
  const list = speedLog.of(id, at);
  const last = list.at(-1);
  if (!last) { const rep = trains.get(id); return rep?.time ? Math.max(0, at - rep.time) : 0; }
  const m = (a, b) => Math.hypot((a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180), a.lat - b.lat) * 111195;
  let since = last.time;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e.speed !== null ? e.speed >= 2 : m(e, last) > 40) break;
    since = e.time;
  }
  return at - since;
}
// The reason a train stands (src/why-standing.js) once it has stood STOOD_MS; else, LATE_MIN or more late, the reason
// it is late (Max, 2026-11-23: he saw no reason on 445 at +29 min, moving); else null (its route not in: null too).
function whyFor(id) {
  const x = frameById.get(id), route = panel.openId === id ? panel.route : null;
  if (!x || x.stale || !route) return null;
  const known = { train: x, route, station: sig => stations.get(sig), disruptions: live && disruptions.loaded ? disruptions.list : [],
    lines: d => disruptions.stretchesOf(d), now: now() };
  // only a late train, and only with an answer (Max, 2026-11-23: it showed with no issue, even early; 'No reason
  // reported' said nothing)
  if ((lateOf(id) ?? 0) < LATE_MIN) return null;
  const w = (x.v ?? 0) < STAND_MS && stoodFor(id, now()) >= STOOD_MS ? { ...whyStanding(known), title: 'whyTitle' } : { ...whyLate(known), title: 'whyLateTitle' };
  return w.kind === 'none' || w.kind === 'stop' ? null : w;
}
function whyHtml(w) {
  if (!w || w.kind === 'stop') return '';
  const text = w.kind === 'disruption' ? t('whyDisruption', w.header) : w.kind === 'note' ? t('whyNote', w.text)
    : w.kind === 'waiting' ? t('whyWaiting', w.station, hhmm(w.planned)) : t('whyNone');
  const inner = `<small>${esc(t(w.title ?? 'whyTitle'))}</small><span>${esc(text)}</span>`;
  return w.kind === 'disruption' ? `<button type="button" class="why dis" data-go="dis:${esc(w.id)}">${icon('warning', 17)}<span class="why-t">${inner}</span>${icon('chevron', 16)}</button>`
    : `<div class="why ${w.kind}">${icon(w.kind === 'none' ? 'info' : 'warning', 17)}<span class="why-t">${inner}</span></div>`;
}
// Share's note (Max's phone, 2026-11-23: it sat over the map and the slider): under the buttons, in the card. Where the
// phone has no share sheet and copying isn't allowed (an http address: the home wifi) the link is shown to copy by
// hand, selectable, until the card closes; "Link copied" goes after a few seconds.
let shareNote = null;   // { id, how: 'copied' | 'shown', url, at }
const SHARE_NOTE_MS = 6000;
function shareNoteHtml(id) {
  const n = shareNote;
  if (!n || n.id !== id || (n.how === 'copied' && Date.now() - n.at > SHARE_NOTE_MS)) return '';
  return `<p class="share-note" role="status">${icon(n.how === 'copied' ? 'check' : 'share', 16)}<span>${esc(t(n.how === 'copied' ? 'linkCopiedShort' : 'linkShownShort'))}` +
    `<span class="share-url">${esc(n.url)}</span></span></p>`;
}
function drawExtras(id) {
  const route = panel.openId === id ? panel.route : null;
  const ahead = (route?.stops ?? []).some((s, i) => i > 0 && s.advertised && s.activity === 'Ankomst' && !s.canceled && !s.actual);
  // (Share is beside the star in the head; "Add a change" only on the expanded card: Max, 2026-11-23)
  const html = whyHtml(whyFor(id)) + '<div class="tr-acts">' +
    (ahead ? `<button type="button" class="chip" data-go="addchange:${esc(id)}">${icon('change', 17)}${esc(t('addChange'))}</button>` : '') + '</div>' + shareNoteHtml(id);
  if (extrasEl._h !== html) { extrasEl.innerHTML = html; extrasEl._h = html; }
}
function trainExtras(id) { drawExtras(id); return extrasEl; }
// Share, from its button beside the star (the train page's acts)
function shareOpen() {
  if (!panel.openId) return;
  const n = panel.number ?? trains.get(panel.openId)?.number;
  if (!n) return;
  const id = panel.openId;
  shareTrain({ number: n, title: t('shareTitle', n), text: t('shareText', n),
    note: (how, url) => { shareNote = { id, how, url, at: Date.now() }; drawExtras(id); } });
}
// What a page of the sheet's ideas needs to know about a train: its numbers (and its route, while its card has it).
function trainInfo(id) {
  const r = trains.get(id), m = trainMeta.get(id), x = r ?? m;
  if (!x) return null;
  return { number: String(x.number), operational: x.operational, date: x.date, route: panel.openId === id ? panel.route : null };
}

// Open a train on the map: its page, and the camera follows it. go: also fly there, zoomed in to the toys.
function openTrain(id, { go = false } = {}) {
  if (!id || !trains.get(id)) return false;
  return stack.open(`train:${id}`, { go });
}
// A train picked in the search or on a board: on the map, fly there and follow it; otherwise its stops.
function pickTrain(t) {
  if (t.onMap && openTrain(t.id, { go: true })) return;
  trainMeta.set(t.id, { operational: t.operational, date: t.date, number: t.number });
  stack.open(`train:${t.id}`, { go: true });
}

// ---- A station's board ----
const boardEl = document.getElementById('board');
const board = createBoard(boardEl, {
  load: (sig, activity) => fetchBoard(sig, activity, now(), settings.boardRows),
  loadDay: (sig, activity) => fetchStationDay(sig, activity, now()),   // the search on the board (2026-11-21)
  stationName,
  onPickTrain: t => pickTrain({ ...t, onMap: Boolean(trains.get(t.id)) }),
  onCloseTap: () => board.openSig && stack.close(`station:${board.openSig}`),
  // The station's own messages (live only).
  messages: live ? sig => fetchStationMessages(sig, now()) : null,
});
// The board's messages or its search want room (it turns .full): the sheet goes to full height; folded or closed again,
// back to the height it had (2026-11-23, stats-board-check: it stayed at full; a sheet raised by hand stays up).
let boardLvl = null;
new MutationObserver(() => {
  if (!stack?.top()?.startsWith('station:')) { boardLvl = null; return; }
  if (boardEl.classList.contains('full')) { if (stack.level < 2) { boardLvl = stack.level; stack.setLevel(2); } }
  else if (boardLvl !== null) { if (stack.level === 2) stack.setLevel(boardLvl); boardLvl = null; }
}).observe(boardEl, { attributes: true, attributeFilter: ['class'] });
function stationPage(sig) {
  const st0 = stations.get(sig);
  if (!st0) return null;
  // Under the board (2026-11-23): "Save a trip from here" (My trains), and once ever the tip about Peek.
  const extra = Object.assign(document.createElement('div'), { className: 'st-extras' });
  extra.innerHTML = `<button type="button" class="chip" data-go="newtrip:${esc(sig)}">${icon('trip', 17)}${esc(t('saveTripHere'))}</button>`;
  return {
    name: () => stations.get(sig)?.name ?? st0.name, kind: 'station', snap: false,
    show(el, { prev, dir, again = false }) {
      el.append(boardEl, extra);
      if (!again && !peekTipSeen()) extra.insertAdjacentHTML('afterbegin', `<p class="tip">${icon('info', 16)}<span>${esc(t('peekTip'))}</span></p>`);
      const st = stations.get(sig) ?? st0;
      if (board.openSig !== sig) board.open(st);
      map.unfollow();
      if (again) return;
      // From a train that stops here: the camera rides the train's line here (its line stays on the map meanwhile).
      const prevTrain = prev?.kind === 'train' ? prev.key.slice(6) : null;
      if (dir !== 0 && prevTrain && lastPath?.id === prevTrain && lastPath.sigs.has(sig)) {
        const cam = map.camera();
        map.ride(along(lastPath.coords, cam, shownAt(st)), rideZoom(cam.z)).then(() => { if (!panel.openId) clearPath(); });
        return;
      }
      if (!panel.openId) clearPath();
      if (dir !== 0) map.goTo(shownAt(st), dir > 0 ? 13 : 11);   // lands above the sheet
    },
    hide() { if (board.openSig === sig) board.close(); holder.append(boardEl); },
    unmount() { if (board.openSig === sig) board.close(); if (boardEl.parentElement !== holder && !stack.top()?.startsWith('station:')) holder.append(boardEl); },
    star: { on: () => favourites.has('station', sig), toggle: () => favourites.toggle('station', sig) },
    redraw: () => board.relabel(),
  };
}
// The Peek tip shows on the first board ever opened on this phone (then remembered).
const PEEK_TIP = 'peekTipSeen';
function peekTipSeen() {
  try { if (localStorage.getItem(PEEK_TIP) === 'true') return true; localStorage.setItem(PEEK_TIP, 'true'); } catch { /* shown, not remembered */ }
  return false;
}
async function openStation(sig, { go = false } = {}) {
  if (!stations.get(sig)) return;
  stack.open(`station:${sig}`, { go });
}

// ---- Several trains close together ("3 trains"): pick one ----
const pickerEl = document.getElementById('picker');
const pickLists = new Map();
let pickN = 0;
function showPicker(list) {
  const key = `pick:${++pickN}`;
  pickLists.set(key, [...list].sort((a, b) => (a.company || '').localeCompare(b.company || '', 'sv') || String(a.label).localeCompare(String(b.label))));
  stack.open(key);
}
if (import.meta.env.DEV) window.__picker = showPicker;   // (tools/back-check.mjs: one picker over another, then back)
function pickPage(key) {
  const rows = pickLists.get(key);
  if (!rows) return null;
  // One #picker for every "N trains here" page: a page lets go of it only while it holds it (back from a second
  // picker to the first: the first takes it in show, then the second's unmount must not hide it; Max 2026-11-23).
  let mine = null;
  const letGo = () => { if (mine?.contains(pickerEl)) { pickerEl.hidden = true; holder.append(pickerEl); } };
  return {
    name: () => t('trainsHere', rows.length), kind: 'pick',
    show(el) {
      mine = el;
      pickerEl.innerHTML = `<div class="panel-head"><strong>${t('trainsHere', rows.length)}</strong><span class="panel-buttons">` +
        `<button class="panel-close" type="button" aria-label="${t('close')}">${icon('close')}</button></span></div><ul class="pick-list">` +
        rows.map((r, i) => `<li><button type="button" data-i="${i}"><b>${esc(splitLabel(r.label).number)}</b>${tagHtml(splitLabel(r.label).minutes)} <span>${esc(r.company || t('train'))}</span></button></li>`).join('') + '</ul>';
      pickerEl.hidden = false;
      el.append(pickerEl);
      pickerEl.querySelector('.panel-close').onclick = () => stack.close(key);
      for (const b of pickerEl.querySelectorAll('[data-i]')) b.onclick = () => openTrain(rows[Number(b.dataset.i)].id);
    },
    // Half: all its rows, up to about half the screen (Max's phone, 2026-11-23: "2 trains" opened showing one row and
    // it was unclear it could be pulled up); more rows: the last one cut, pull up to scroll.
    half() {
      const list = mine?.contains(pickerEl) ? pickerEl.querySelector('.pick-list') : null;
      if (!list) return 0;
      // (the sheet about half the screen at most: its handle 20 px over the page, no bar since 2026-11-23)
      return Math.min(Math.round(list.getBoundingClientRect().bottom - mine.getBoundingClientRect().top + 14), Math.round(innerHeight * 0.5) - 24);
    },
    hide: letGo,
    unmount() { letGo(); pickLists.delete(key); },
  };
}

// ---- Settings, About, Connection: their parts are in index.html, moved into the page while it is shown ----
function heldPage(el, { name, kind, onShow, onHide }) {
  return {
    name, kind,
    show(page) { page.append(el); el.hidden = false; onShow?.(); },
    hide() { el.hidden = true; holder.append(el); onHide?.(); },
    unmount() { el.hidden = true; holder.append(el); },
  };
}

// ---- Help, with the map credits: the ? button next to Tilt ----
// (Max, 2026-11-12: the credit line at start was too intrusive. Fine while the app is private; OpenStreetMap's
// attribution guidelines want the credit seen without a tap, so the public version needs it visible again.)
const helpEl = document.getElementById('help');
// Help & About: a page in the sheet from ☰ (2026-11-22). Its × is hidden (back belongs to the stack) and kept for the tools.
helpEl.querySelector('.panel-close').onclick = () => stack.close('page:help');
// About (round 4): the logo, Buy me a coffee (Max's Ko-fi page) and Report a bug: a ready e-mail (Max, 2026-11-17:
// "Email, pre-filled"). The mail app opens with the build, a link to the same map view, the open train and the phone
// filled in; the person writes what happened (and attaches a screenshot). The address (Max, 2026-11-17: no spam, nothing
// pointing robots at his own domain): the monitor's Gmail with a "+bugs" tag, put together only on a tap, so the
// page and the public code never hold it whole (bugAddress; tools/about-check.mjs checks the page's code for it).
// Ko-fi as in Max's Connection Lab (Max, 2026-11-17: "do the same"): a plain link, the one Ko-fi's button script writes,
// in Ko-fi's blue with Ko-fi's cup kept in the page (kofi-cup.png, from there). Not the script itself: it would load
// from Ko-fi and Google Fonts on every visit, and it writes with document.writeln, so it can't go in a panel built later.
const KOFI_URL = 'https://ko-fi.com/X1C729ZIK7';
const bugAddress = () => { const back = s => [...s].reverse().join(''); return `${back('sgub+ppa.taraps')}@${back('moc.liamg')}`; };
const PUBLIC_URL = 'https://sparat.rangner.com/';   // the view link points here (inside the app the page's own address is local)
helpEl.querySelector('.about-logo').innerHTML = logoSvg({ id: 'about-logo' });
document.querySelector('#kofi-button .about-ic').innerHTML = `<img src="${kofiCup}" alt="">`;   // the words say where it goes
document.querySelector('#bug-button .about-ic').innerHTML = icon('bug', 20);
document.getElementById('kofi-button').onclick = () => { if (KOFI_URL) window.open(KOFI_URL, '_blank', 'noopener'); };
function bugMail() {
  const version = `${typeof __VERSION__ === 'string' ? __VERSION__ : '?'} (${typeof __BUILD__ === 'string' ? __BUILD__ : '?'})`;
  const view = map.viewText();
  const r = panel.openId && trains.get(panel.openId);
  const company = r && lateness.brand(r.id);
  const train = r ? `${r.number}${company ? ` ${company}` : ''}` : '–';
  const mode = replay ? `replay ${replay}` : fromFiles ? 'files' : 'live';
  const body = [t('bugWhat'), '', '', '', '—', `Spårat ${version}`, `${t('bugView')}: ${PUBLIC_URL}${view ? `#view=${view}` : ''}`,
    `${t('bugTrain')}: ${train}`, `${t('bugMode')}: ${mode}, ${settings.language}, ${settings.theme}`,
    `${t('bugDevice')}: ${navigator.userAgent}`].join('\r\n');
  return `mailto:${bugAddress()}?subject=${encodeURIComponent(t('bugSubject', version))}&body=${encodeURIComponent(body)}`;
}
window.__bugMail = bugMail;   // (tools: the mail a tap would open)
document.getElementById('bug-button').onclick = () => { window.location.href = bugMail(); };
helpEl.querySelector('.about-soon').hidden = true;
// The version and the commit it was built from (vite.config.js; Max, 2026-11-17: so a report names its build).
// The same word in both languages. "dev" on the PC's live-reloading page.
const versionEl = document.getElementById('about-version');
const versionText = `Version ${typeof __VERSION__ === 'string' ? __VERSION__ : '?'}` +
  ` (${typeof __BUILD__ === 'string' ? __BUILD__ : '?'}${import.meta.env.DEV ? ', dev' : ''})`;
versionEl.textContent = versionText;
// Settings → Debug shows only when switched on (Max, 2026-11-18: "Taps is good", "build yes"): #debug in the address
// (#debug=off hides it), or 7 taps on the version line above (7 more hide it), remembered on the device; on the dev
// page shown unless switched off. Hidden, its choices keep working.
const DEBUG_KEY = 'debugShown';
let debugShown = import.meta.env.DEV;
try { const v = localStorage.getItem(DEBUG_KEY); if (v !== null) debugShown = v === 'true'; } catch { /* storage blocked: the default */ }
function showDebug(on) {
  debugShown = on;
  try { localStorage.setItem(DEBUG_KEY, String(on)); } catch { /* used now, not remembered */ }
  document.getElementById('settings').classList.toggle('debug', on);
}
const debugAsked = new URLSearchParams(location.hash.slice(1)).get('debug');
if (debugAsked !== null) showDebug(debugAsked !== 'off'); else document.getElementById('settings').classList.toggle('debug', debugShown);
let taps = 0, lastTap = 0, sayTimer = null;
versionEl.addEventListener('click', () => {
  const at = Date.now();
  taps = at - lastTap < 1500 ? taps + 1 : 1;   // in a row: at most 1.5 s apart
  lastTap = at;
  if (taps < 7) return;
  taps = 0;
  showDebug(!debugShown);
  versionEl.textContent = t(debugShown ? 'debugOn' : 'debugOff');
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => { versionEl.textContent = versionText; }, 2500);
});
// Esc steps back one page, as Android's back (2026-11-22; the back chip goes home since 2026-11-23): a menu or the
// search first; at Home the sheet goes down.
// The day's bubble goes first; its ribbon closes when there is nothing else to step back from.
const dayBack = () => {
  if (dayView?.bubbleShown) { dayView.hideBubble(); return true; }
  if (dayView?.isOpen && stack.top() === 'home' && !stack.searching && stack.level === 0) { dayView.close(); return true; }
  return false;
};
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (navOpen) { closeNav(); return; }
  if (document.activeElement?.matches?.('.board-q')) return;   // (the board's own search closes itself)
  if (dayBack()) return;
  stack.back();
});
// The phone's back button in the Android app (Max, 2026-11-17; the stack since 2026-11-22): one page back per press;
// at Home with the sheet up it goes down; at rest the app goes to the background (as Android's own back does since
// Android 12: the map stays loaded). Only inside the app: Capacitor's bridge is there; the web page never loads this.
// With the keyboard open, back only hides the keyboard (Max's phone test, 2026-11-17: one swipe closed both it and the
// search). Open = a text field has focus and the page is clearly lower than the tallest seen at this width (the
// viewport line's interactive-widget=resizes-content: the keyboard shrinks the page).
if (window.Capacitor?.isNativePlatform?.()) {
  let tallest = { w: 0, h: 0 };
  const seen = () => { if (innerWidth !== tallest.w) tallest = { w: innerWidth, h: 0 }; tallest.h = Math.max(tallest.h, innerHeight); };
  seen();
  addEventListener('resize', seen);
  const keyboardUp = () => Boolean(document.activeElement?.matches?.('input, textarea')) && innerHeight < tallest.h - 150;
  import('@capacitor/app').then(({ App }) => App.addListener('backButton', () => {
    if (keyboardUp()) { document.activeElement.blur(); return; }
    if (navOpen) { closeNav(); return; }
    if (dayBack()) return;
    if (!stack.back()) App.minimizeApp();
  }));
}

// ---- ☰ (Max, 2026-11-22: at the right of the search bar): a small menu just above it with The day, Settings and
// Help & About. Closes with a tap elsewhere, Esc, the phone's back, or by opening one of its rows. ----
document.querySelector('#sheet .sh-logo').innerHTML = logoSvg({ small: true });   // the logo in the search field (Max, 2026-11-23: "logo is gone")
const navEl = document.getElementById('nav'), navButton = document.getElementById('nav-button');
for (const ic of navEl.querySelectorAll('[data-icon]')) ic.innerHTML = icon(ic.dataset.icon, 20);
// ☰'s menu: its choices as buttons where the search field is, in its place while open (Max, 2026-11-24: "Revamp hamburger
// menu... You cant search when manu is open anyways, and saves realaste. Also works better with the back arrows"; then
// "Place the buttons where the search bar is! And same dismiss rules"); until then a card floating by the button. The
// sheet keeps its height; the page behind holds still (src/stack.js frozen); ☰ or a map tap closes it.
navButton.before(navEl);
navEl.classList.remove('pop');
navEl.classList.add('sh-menu');
// Open and shut, the buttons slide out of ☰ and back into it, no fade (Max, 2026-11-24: "it should animate both in and
// out, sliding form the hamburger"; "Remove the fade on all"); the speed as the page changes' (Debug → Animation speed).
let navOpen = false;
function slideNav(open) {
  const b = navButton.getBoundingClientRect(), k = settings.motionSpeed === 'calm' ? 4 / 3 : 1;
  const rows = [...navEl.querySelectorAll('.nav-row:not([hidden])')];
  for (const r of rows) r.getAnimations().forEach(a => a.cancel());
  if (reduceMotion()) return Promise.resolve();
  return Promise.all(rows.map((r, i) => {
    const from = { transform: `translateX(${Math.round(b.left - r.getBoundingClientRect().left)}px)` }, to = { transform: 'none' };
    // (the first button travels furthest: it leaves first and comes back last)
    const n = rows.length - 1 - i;
    return r.animate(open ? [from, to] : [to, from], { duration: (260 + (open ? i : n) * 30) * k, easing: open ? 'cubic-bezier(.2, .8, .2, 1)' : 'cubic-bezier(.4, 0, .8, .4)', fill: 'forwards' }).finished.catch(() => {});
  }));
}
// (opened with Home pulled up: Home goes down to rest, Max 2026-11-24 "When menu is called while main card is already
// opened it should close"; a page opened from it and backed out of: Home with the menu open again, "When menu option is
// backed out of, the menu should still be open": navBack, src/main.js onChange)
let navBack = false;
function openNav() {
  if (stack.searching || navOpen) return;
  if (stack.top() === 'home' && stack.level > 0) stack.setLevel(0);
  navOpen = true;
  navEl.hidden = false;
  navButton.setAttribute('aria-expanded', 'true');
  document.getElementById('sheet').classList.add('menu-open');
  stack.refit();   // (a computer at rest: the box closes round the bar)
  slideNav(true).then(() => { if (navOpen) for (const r of navEl.querySelectorAll('.nav-row')) r.getAnimations().forEach(a => a.cancel()); });
  navEl.querySelector('.nav-row:not([hidden])')?.focus({ preventScroll: true });
}
function closeNav() {
  if (!navOpen) return;
  navOpen = false;
  navButton.setAttribute('aria-expanded', 'false');
  slideNav(false).then(() => {
    if (navOpen) return;   // (opened again meanwhile)
    navEl.hidden = true;
    for (const r of navEl.querySelectorAll('.nav-row')) r.getAnimations().forEach(a => a.cancel());
    document.getElementById('sheet').classList.remove('menu-open');
    stack.refit();
  });
}
onTap(navButton, () => (navOpen ? closeNav() : openNav()));   // (at once also right after a swipe: sheet.js onTap)
// (Not a finger on the map: the map works with the menu open, a drag moves it and the menu stays; a plain tap on the
// map closes it through onMapTap. Max, 2026-11-20; screens-check found it closing on every touch of the map, 2026-11-23.)
// (inside the sheet only its buttons and ☰ do anything while it is open: src/stack.js frozen. Outside the sheet and the
// map, a press closes it as before: the map's own buttons, the pills.)
document.addEventListener('pointerdown', (e) => { if (navOpen && !e.target.closest?.('#sheet') && !mapEl.contains(e.target)) closeNav(); }, true);
// A mouse pressed on a button keeps it while it stays where the button was: a pressed button shrinks (button:active,
// scale .94; a row .98), and a press held near a wide row's edge was let go outside it, so the click went to what was
// beside it and nothing opened (Max, 2026-11-24: the › on a saved trip "Still doesn't do anything"; quick clicks
// worked, they ended before the shrink). A finger has this by itself. Moved off the button: let go as before.
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  const b = e.target.closest?.('button');
  if (!b || b.disabled) return;
  const r = b.getBoundingClientRect();
  try { b.setPointerCapture(e.pointerId); } catch { return; }
  const off = (m) => {
    if (m.pointerId !== e.pointerId) return;
    if (m.clientX >= r.left && m.clientX <= r.right && m.clientY >= r.top && m.clientY <= r.bottom) return;
    try { b.releasePointerCapture(e.pointerId); } catch { /* let go already */ }
    b.removeEventListener('pointermove', off);
  };
  b.addEventListener('pointermove', off);
  b.addEventListener('lostpointercapture', () => b.removeEventListener('pointermove', off), { once: true });
}, true);
// The day (build plan part 4, src/day-view.js): the ribbon above the search bar, the sheet down to rest. Only the page
// reading the server's files has the day's history; the dev page with the key (or a replay) says so. Again: closes it.
document.head.append(Object.assign(document.createElement('style'), { textContent: DAY_CSS }));
const NARROW = matchMedia('(max-width: 439px)');
let sheetPad = 0;
// The map's free part: above the sheet, and above the ribbon while it is open (the slider and the buttons ride on it).
function padMap() {
  const h = dayView?.isOpen ? dayView.el.offsetHeight + 10 : 0, root = document.documentElement;
  root.style.setProperty('--ribbon-h', NARROW.matches && h ? `${h}px` : '0px');
  // (not while the card's "till …" chooser is open: it shuts back to the same height, and the map stays still; Max,
  // 2026-11-24: it "jumps the map around... Should not change map at all")
  const choosing = panelEl.classList.contains('picking') && panel.openId && !panel.hidden && stack?.top() === `train:${panel.openId}`;
  if (!choosing) map.setSheet(sheetPad + h);
  // The scale slider (74 px over the sheet and the ribbon, 190 tall) goes when it would reach the live mark at the top.
  root.classList.toggle('scale-squeezed', innerHeight - (NARROW.matches ? sheetPad + h : 0) - 74 - 190 < 52);
}
addEventListener('resize', () => { if (dayView?.isOpen) { padMap(); dayView.draw(); } });
// The shop window waits while The day's ribbon is open (at an earlier moment or about to be).
hooks.dayOther = () => Boolean(dayView?.isOpen || dayView?.past);
hooks.onDay = () => {
  if (!fromFiles || !positionsFeed?.history) { map.note(t('dayNeedsFiles')); return; }
  if (!dayView) {
    dayView = createDayView({ history: (a, b) => positionsFeed.history(a, b), now, delay: DRAW_DELAY_MS, net: () => net,
      onMode(past) {
        lastDraw = 0;
        if (past) { stack.home(0); map.unfollow(); }
        else {
          frameAll = [];   // (the live trains at once, from the next frame)
          const top = stack.top();
          if (top && stack.pageDef(top)?.kind === 'onlylive') stack.replace(top);
        }
        map.sunUpdate(true);
      },
      onClose: padMap });
    if (import.meta.env.DEV) window.__day = dayView;   // (tools/day-check.mjs)
  }
  if (dayView.isOpen) { dayView.close(); return; }
  stack.home(0);
  dayView.open();
  padMap();
};
// Pages that show live data (a train's card, a board, a disruption, a group's trains) at an earlier moment: "Only
// live. Back to live?" in their place (Max, 2026-11-22: The day is the map only).
const LIVE_ONLY = new Set(['train', 'station', 'pick', 'dis', 'dislist', 'co', 'kind', 'late', 'still']);
function defineNow(key) {
  const def = define(key);
  if (!def || !dayView?.past || !LIVE_ONLY.has(key.split(':')[0])) return def;
  return {
    name: def.name, kind: 'onlylive',
    show(el) {
      if (!dayView?.past) { setTimeout(() => { if (stack.top() === key) stack.replace(key); }); return; }
      el.innerHTML = `<div class="only-live"><p>${esc(t('dayOnlyLive'))}</p><small class="sub">${esc(t('dayOnlyLiveSub'))}</small>` +
        `<button type="button" class="only-live-go">${esc(t('dayBackLive'))}</button></div>`;
      el.querySelector('.only-live-go').onclick = () => dayView.live();
    },
  };
}

document.getElementById('open-day').onclick = () => { closeNav(); if (hooks.onDay) hooks.onDay(); else map.note(t('daySoon')); };
document.getElementById('open-settings').onclick = () => { closeNav(); navBack = true; stack.open('page:settings'); };
document.getElementById('help-button').onclick = () => { closeNav(); navBack = true; stack.open('page:help'); };

// ---- The search: a train number or a station ----
const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();   // "Göteborg" matches "goteborg"
// The stations whose name holds the text (the search; also My trains' station picker), those starting with it first.
function menuStations(text) {
  const q = fold(text);
  return [...stations.values()]
    .filter(st => st.advertised && st.lon !== null && fold(st.name).includes(q))
    .sort((a, b) => fold(b.name).startsWith(q) - fold(a.name).startsWith(q) || a.name.localeCompare(b.name, 'sv'));
}
const menu = createMenu({
  input: document.getElementById('search'),
  list: document.getElementById('search-results'),
  findTrains: digits => trains.reports()
    .filter(r => String(r.number).startsWith(digits))
    .sort((a, b) => String(a.number).length - String(b.number).length || Number(a.number) - Number(b.number))
    .map(r => ({ id: r.id, operational: r.operational, date: r.date, number: r.number, company: lateness.brand(r.id), time: r.time })),
  findStations: text => menuStations(text),
  async searchTimetable(number) {
    const found = await fetchRunsByNumber(number, now());
    return found.map(t => ({ ...t, from: t.from && stationName(t.from), to: t.to && stationName(t.to), at: found.length > 1 && t.start !== null ? hhmm(t.start) : null }));
  },
  // The trains on the map now, by group: the empty search's "Show only" chips, and companies and kinds typed.
  groups() {
    const brands = new Map(), kinds = new Map();
    let late = 0, still = 0;
    for (const x of frameAll) {
      const b = x.brand ?? '';
      brands.set(b, (brands.get(b) ?? 0) + 1);
      const k = kindOf(b);
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
      if (!x.stale && lateClass(lateOf(x.id)) === 'late') late++;
      if (!x.stale && x.v < STAND_MS) still++;
    }
    return { late, still, kinds: [...kinds].sort((a, b) => b[1] - a[1]), brands: [...brands].sort((a, b) => b[1] - a[1]) };
  },
  findDisruptions(text) {
    const q = fold(text);
    return disruptions.list.filter(d => fold(`${d.header} ${d.kind ?? ''} ${placesText(d, stationName)} ${d.text ?? ''}`).includes(q))
      .slice(0, 8).map(d => ({ id: d.id, header: d.header, sub: placesText(d, stationName) }));
  },
  recent: () => stack.recent(),
  rowOf,
  starred: () => starredRows(),
  remember: tr => trainMeta.set(tr.id, { operational: tr.operational, date: tr.date, number: tr.number }),
});
// A row for a page key (the empty search's Recent).
function rowOf(key) {
  const i = key.indexOf(':'), type = i < 0 ? key : key.slice(0, i), v = i < 0 ? '' : key.slice(i + 1);
  if (type === 'train') {
    const r = trains.get(v), m = trainMeta.get(v);
    if (!r && !m) return '';
    return trainRow({ id: v, number: r?.number ?? m.number, brand: r ? lateness.brand(v) : null, minutes: r ? lateOf(v) : null, sub: t(r ? 'onMap' : 'notOnMapNow') });
  }
  if (type === 'station') { const st = stations.get(v); return st ? stationRow({ sig: v, name: st.name, sub: t('station') }) : ''; }
  if (type === 'dis') { const d = disruptions.byId(v); return d ? groupRow({ key, name: d.header, sub: placesText(d, stationName) }) : ''; }
  if (type === 'dislist') return groupRow({ key, name: t('allDisruptions') });
  const g = groupOf(key, STAND_MS);
  return g ? groupRow({ key, name: g.name(), sub: g.sub(), colour: g.colour }) : '';
}
// The starred trains and stations as rows (a train not on the map: its run now, the next one, or the latest).
function starredRows() {
  const byNumber = new Map(trains.reports().map(r => [String(r.number), r]));
  return favourites.trains.map((n) => {
    const r = byNumber.get(n);
    return r ? trainRow({ id: r.id, number: n, brand: lateness.brand(r.id), minutes: lateOf(r.id), sub: t('onMap') })
      : `<button type="button" class="row" data-act="favtrain" data-n="${esc(n)}"><b class="r-num">${esc(n)}</b><span class="r-main"><b>${esc(t('train'))}</b><small>${esc(t('notOnMapNow'))}</small></span></button>`;
  }).join('') + favourites.stations.map(sig => stations.get(sig)).filter(Boolean)
    .map(st => stationRow({ sig: st.sig, name: st.name, lead: icon('starFilled', 18), cls: 'star' })).join('');
}
// A starred train: on the map, fly there; otherwise its run now, the next one, or the latest (yesterday's while it
// still runs after midnight; until 2026-11-22 the day's first run, TODO 62).
async function pickFavouriteTrain(number) {
  const r = trains.reports().find(x => String(x.number) === number);
  if (r) return pickTrain({ id: r.id, operational: r.operational, date: r.date, number: r.number, onMap: true });
  try {
    const t = pickRun(await fetchRunsByNumber(number, now()), now());
    if (t) pickTrain({ id: t.key, operational: t.operational, date: t.date, number: t.number, onMap: false });
  } catch (e) { console.warn('favourite:', e.message); }
}

// ---- Drawing: one clock per frame ----
// Each frame every train's simulation is brought to one moment (DELAY_MS ago), once. The camera (following), the
// 3D trains and the selected train's marker all use those same places, and while a train is selected the map is
// drawn in this same frame, so nothing creeps against anything else (the 3D trains used to be placed at a slightly
// later moment than the camera, a stutter on fast trains at close zoom). The dots and labels of the other trains go
// through the map's background worker, as often as a movement can be seen at this zoom (map.trainsEvery: 30 times a
// second close in, once a second far out): only the trains in or near the view (map.nearView), made
// from the places this frame already worked out (every train in Sweden used to be worked through a second time and
// sent, also when five of them were on screen).
// Every train is worked out only when the dots are due (map.trainsEvery: while the camera follows a train among the
// models, as soon as the fastest could have moved half a pixel). Between, only the open train moves on (trains.placedOne): the
// camera and its marker need it every frame. Until 2026-11-15 every train was worked out in every frame, 60 times a
// second, for dots refreshed 7 times a second at zoom 11 (Max: "Optimization is KEY here").
let lastDraw = 0, lastProgress = 0, lastFollow = 0, fullAsked = false;
// The open train's line is checked against the train's own way this often (src/path-follow.js).
const FOLLOW_MS = 250;
const whenIdle = cb => (window.requestIdleCallback ? window.requestIdleCallback(cb, { timeout: 500 }) : setTimeout(cb, 50));
// The open train's line changed to follow it: drawn, the changed stretch sliding into place.
function showFollowed(r, place) {
  shownPath.path = r.path;
  map.setPath(r.path, r.slide);
  if (place) map.setPathProgress(progressAt(r.path, place));
}
// frameAll: every train; frameTrains: those drawn, all or only those the filter shows (and the open one, always), so the
// dots, models, labels and "3 trains" groups all agree. The stats page counts every train.
let frameAll = [], frameTrains = [], frameById = new Map();
if (import.meta.env.DEV) window.__drawn = () => ({ all: frameAll.length, drawn: frameTrains.length });   // (tools/back-check.mjs)
// The day at an earlier moment (src/day-view.js): the trains from the day's history (src/day-trains.js) instead of the
// live ones; the live engine runs on untouched underneath (its places worked out once a second, for Home and the
// search). Drawn when the moment moved (at most 30 times a second), else as the live map is.
let dayDrawn = null, liveAllAt = 0, sunDrawnAt = 0;
function dayFrame(ts) {
  dayView.tick(ts);
  const T = dayView.moment;
  if (T === null) return;   // (a play just came to the end: live from the next frame)
  if (ts - liveAllAt > 1000) {
    liveAllAt = ts;
    frameAll = (netIn ? trains.placedAt(now() - DRAW_DELAY_MS) : earlyPlaced()).map(x => ({ ...x, brand: lateness.brand(x.id) }));
    frameById = new Map(frameAll.map(x => [x.id, x]));
  }
  if (T !== dayDrawn ? ts - lastDraw >= 33 : ts - lastDraw >= Math.max(250, map.trainsEvery())) {
    lastDraw = ts;
    dayDrawn = T;
    const near = map.nearView(), sun = settings.dayNight ? sunFor(T) : null, features = [];
    frameTrains = [];
    for (const x of dayView.at(T, near)) {
      if (filter.active && !filter.shows(x.brand, x.late === null || x.late === undefined ? 'unknown' : lateClass(x.late))) continue;
      x.night = nightAt(x, sun);
      frameTrains.push(x);
      if (near(x.lon, x.lat)) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lon, x.lat] }, properties: { id: x.id, bearing: x.bearing, ...pastProps(x) } });
    }
    map.setTrains({ type: 'FeatureCollection', features });
    if (import.meta.env.DEV) window.__last3d = frameTrains;
  }
  map.tick(ts);
  map.setSelectedPlace(null, null);
  dayView.placeBubble((lon, lat) => map.project(lon, lat));
  // the sun's line with the moment (it draws itself again only when the moment has moved a minute)
  if (ts - sunDrawnAt > 150) { sunDrawnAt = ts; map.sunUpdate(); }
}
function frame(ts) {
  if (dayView?.past) { dayFrame(ts); requestAnimationFrame(frame); return; }
  const t = now() - DRAW_DELAY_MS;
  const openId = panel.openId;
  const due = ts - lastDraw >= map.trainsEvery(Boolean(openId && map.following));
  if (due || !frameAll.length) {
    const sun = settings.dayNight ? sunFor(t) : null;
    frameAll = (netIn ? trains.placedAt(t) : earlyPlaced()).map(x => ({ ...x, brand: lateness.brand(x.id), night: nightAt(x, sun) }));
    // only some trains: a group's page or the lateness bar's colour (lightTest) while it is open, else the filter
    frameTrains = lightTest ? frameAll.filter(x => x.id === openId || (lightTest(x) && filter.lateShows(legendKey(x))))
      : filter.active ? frameAll.filter(x => x.id === openId || filter.shows(x.brand, legendKey(x))) : frameAll;
    frameById = new Map(frameAll.map(x => [x.id, x]));
  } else if (openId && frameById.has(openId)) {
    const x = trains.placedOne(openId, t);
    if (x) {
      const old = frameById.get(openId), one = { ...x, brand: lateness.brand(x.id), night: old.night };
      frameById.set(openId, one);
      for (const list of [frameAll, frameTrains]) { const i = list.indexOf(old); if (i >= 0) list[i] = one; }
    }
  }
  if (import.meta.env.DEV) window.__last3d = frameTrains;   // what the 3D layer draws (tools/follow-check.mjs)
  if (due) {
    lastDraw = ts;
    const near = map.nearView(), features = [];
    for (const x of frameTrains) {
      const r = near(x.lon, x.lat) && reportOf(x.id);
      if (r) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lon, x.lat] },
        properties: { id: x.id, bearing: x.bearing, ...propsFor(r, x) } });
    }
    map.setTrains({ type: 'FeatureCollection', features });
  }
  map.tick(ts);
  const sel = openId && frameById.get(openId);
  const r = sel && reportOf(sel.id);
  map.setSelectedPlace(sel || null, r ? propsFor(r, sel) : null);
  // How far along its route the open train is: at most 10 times a second (it took a fifth of the frame's time).
  // The open train's line follows its train (src/path-follow.js): checked FOLLOW_MS apart; the rare full re-route of
  // the way ahead (tens of ms) waits for a quiet moment.
  const follow = sel && shownPath?.id === sel.id ? shownPath.follow : null;
  if (follow && ts - lastFollow >= FOLLOW_MS) {
    lastFollow = ts;
    const r = follow.update(trains.wayOf(sel.id), ts);
    if (r) showFollowed(r, sel);
    else if (follow.wantsFull && !fullAsked) {
      fullAsked = true;
      whenIdle(() => {
        fullAsked = false;
        if (shownPath?.follow !== follow) return;
        const r2 = follow.full(trains.wayOf(shownPath.id), performance.now());
        if (r2) showFollowed(r2, frameById.get(shownPath.id));
      });
    }
  }
  if (sel && shownPath?.id === sel.id && ts - lastProgress >= 100) {
    lastProgress = ts;
    map.setPathProgress(progressAt(shownPath.path, sel));
  }
  // Drawn in this frame only when the open train moved a tenth of a pixel or more (a standing train draws nothing; a
  // moving camera draws itself).
  if (sel) map.drawIfMoved(sel);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- Settings: a page in the sheet, from ☰ → Settings (Max, 2026-11-12; the sheet 2026-11-22). Remembered on this
// phone; every change shows at once, without reloading the page (Max: reloading was a bad experience). ----
const settingsPage = document.getElementById('settings-page');
const debugDataEl = document.getElementById('set-data');   // Settings → Debug: the positions' rate and age
const settingsEl = document.getElementById('settings');
settingsPage.querySelector('.panel-close').onclick = () => stack.close('page:settings');
// A change (also Look on Auto when the phone switches between light and dark): each part shows it.
onSettingChange((key) => {
  if (key === 'theme' || key === 'trainStyle' || key === 'toyZoom' || key === 'trainSymbol' || key === 'accent'
    || key === 'routeNames' || key === 'nameSide' || key === 'pillSide' || key === 'routeEdge' || key === 'colourBlind') { map.applySettings(); dayView?.draw(); }
  if (key === 'language') {
    translatePage();
    dayView?.relabel();
    nameSwatches();
    map.relabel();   // "3 trains" on the map
    menu.refresh();
    panel.relabel();
    conn.relabel(); showConn();
    showFilter();
    homeDef.redraw();
    const top = stack.top();
    if (top !== 'home') stack.pageDef(top)?.redraw?.();
    stack.refreshBar();
  }
  if (key === 'boardRows') board.relabel();
  if (key === 'allPlaces') panel.relabel();   // Settings → All places (on the card until 2026-11-22)
  if (key === 'homeLegend') { if (!settings.homeLegend) filter.setLate(null); homeDef.redraw(); }   // Debug → Lateness colours on Home
  if (key === 'pageMotion') document.documentElement.dataset.motion = settings.pageMotion;   // Debug → Page change
  if (key === 'motionSpeed') document.documentElement.dataset.mspeed = settings.motionSpeed;   // Debug → Animation speed
  if (key === 'disruptionsMap') map.showDisruptions();   // Settings → Disruptions on the map (2026-11-18)
  if (key === 'dayNight') { map.sunShow(); frameAll = []; lastDraw = 0; dayDrawn = null; }   // the sun's line, the glow and the lit windows
  if (key === 'scaleSlider') map.sliderShow();   // Settings → Zoom slider (off by default, Max 2026-11-23)
  // The models' sizes are read each frame (trains-3d.js): draw once now, also when nothing moves.
  if (key === 'toySize' || key === 'modelSize' || key === 'toyClose' || key === 'realClose' || key === 'trueSize') map.drawNow();
  showSettings();
});
function showSettings() {
  for (const seg of settingsEl.querySelectorAll('.seg'))
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(settings[seg.dataset.key])));
  settingsEl.classList.toggle('real', settings.trainStyle !== 'toy');
  settingsEl.classList.toggle('style-real', settings.trainStyle === 'real');
  settingsEl.classList.toggle('symbol', settings.trainStyle === 'symbol');
  sizeEl.value = settings.toySize;
  sizeOut.textContent = `${settings.toySize} px`;
  realSizeEl.value = settings.modelSize;
  realSizeOut.textContent = `×${settings.modelSize}`;
  // One slider, for the kind of train chosen (Compact or Realistic).
  const close = settings[closeKey()];
  closeSizeEl.value = close;
  closeSizeOut.textContent = `×${close}`;
  accentName.textContent = (ACCENTS[settings.accent] ?? ACCENTS[DEFAULT_ACCENT]).name[lang()];
}
// Settings → Accent colour: one round swatch per curated colour (src/colours.js; Max, 2026-11-15), each in the light
// and the dark shade (the page's style picks one). 14 since 2026-11-19: the row shows the chosen colour and its name,
// a tap folds the swatches open under it (index.html .accent-pick); a pick, or the row again, folds them shut.
const swatchesEl = settingsEl.querySelector('.seg.swatches');
swatchesEl.innerHTML = Object.entries(ACCENTS).map(([k, a]) =>
  `<button type="button" data-v="${k}" style="--sw-l:${a.light.c};--sw-d:${a.dark.c}"></button>`).join('');
const nameSwatches = () => { for (const b of swatchesEl.children) b.title = b.ariaLabel = ACCENTS[b.dataset.v].name[lang()]; };
nameSwatches();
const accentOpen = document.getElementById('accent-open'), accentPick = document.getElementById('accent-pick');
const accentName = accentOpen.querySelector('.accent-name');
function foldAccents(open) {
  accentOpen.setAttribute('aria-expanded', String(open));
  accentPick.classList.toggle('open', open);
  accentPick.inert = !open;   // folded: its swatches can't be reached by Tab
}
accentOpen.onclick = () => foldAccents(accentOpen.getAttribute('aria-expanded') !== 'true');
for (const seg of settingsEl.querySelectorAll('.seg')) {
  for (const b of seg.querySelectorAll('button')) b.onclick = () => {
    setSetting(seg.dataset.key, b.dataset.v);
    if (seg === swatchesEl) { foldAccents(false); accentOpen.focus(); }
  };
}
const sizeEl = document.getElementById('set-toysize'), sizeOut = document.getElementById('set-toysize-out');
sizeEl.oninput = () => { setSetting('toySize', sizeEl.value); showSettings(); };
const realSizeEl = document.getElementById('set-realsize'), realSizeOut = document.getElementById('set-realsize-out');
realSizeEl.oninput = () => { setSetting('modelSize', realSizeEl.value); showSettings(); };
const closeSizeEl = document.getElementById('set-closesize'), closeSizeOut = document.getElementById('set-closesize-out');
const closeKey = () => (settings.trainStyle === 'toy' ? 'toyClose' : 'realClose');
closeSizeEl.oninput = () => { setSetting(closeKey(), closeSizeEl.value); showSettings(); };
showSettings();

// ---- Statistik's numbers (src/stats.js), drawn on Home and a company's page (src/home.js; Statistik's own page went
// 2026-11-22). Cancelled today and today's arrivals are asked for only while one of those is shown. ----
const snapshot = (brand = null) => stats.snapshot({ count: trains.count, reports: trains.reports(), frame: frameAll, lateness, stations,
  trainOf: id => trains.get(id), at: now(), replay: Boolean(replay), day: dayStats?.view(brand) ?? null, brand });
const statsShown = () => { const top = stack?.top(); return (top === 'home' && stack.level > 0) || Boolean(top?.startsWith('co:')); };
function wantStats() { if (live) stats.wantCancelled(askCancelled, now()); dayStats?.open(); }
// What Home and the group pages read (src/home.js).
const pageData = {
  frame: () => frameAll, lateOf, numberOf: id => trains.get(id)?.number ?? '?',
  favourites, stations: () => stations, location: () => map.location, stationName,
  myTrains: () => myTrains?.mineHtml() ?? null,   // the saved trips and pinned changes in Mine (src/my-trains.js)
  disruptions: () => (live && disruptions.loaded ? disruptions.list : null),
  snapshot, filter, still: STAND_MS,
  // a part just opened on Home shown whole, and let go again (src/stack.js reveal)
  reveal: el => stack.reveal(el), unreveal: () => stack.unreveal(),
  // the lateness bar's colour: a filter with its pill, held on every page (src/filter.js; Max, 2026-11-24)
  legend: { get: () => filter.late, set: (k) => { filter.setLate(filter.late === k ? null : k); homeDef.redraw(); } },
  statsActions: {
    openTrain: id => openTrain(id, { go: true }),
    openStation: sig => openStation(sig, { go: true }),
    describe: (id) => { const r = trains.get(id); return r ? { number: r.number, brand: lateness.brand(id) ?? '', minutes: lateOf(id) } : null; },
  },
  onShow: wantStats,
  onLight: light,
  // a group's trains on the map, all of them in view
  fit(list) {
    if (!list.length) return;
    const lons = list.map(x => x.lon), lats = list.map(x => x.lat);
    map.fitBox([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]);
  },
};
const homeDef = homePage(pageData);

// ---- The connection screen: a tap on the live mark at the top (Max's pick Y, 2026-11-18; a page in the sheet since
// 2026-11-22; src/connection.js). ----
const connPage = document.getElementById('conn-page');
const conn = createConnection(connPage, {
  getTrains: () => frameAll,
  reportTimeOf: id => trains.get(id)?.time ?? null,
});
let lastFileAt = null;   // when the last file came (this phone's clock; the public page)
onTap(document.getElementById('status'), () => (stack.top() === 'page:conn' ? stack.back() : stack.open('page:conn')));
connPage.querySelector('.panel-close').onclick = () => stack.close('page:conn');
// The line above the bar while the map shows only some trains (src/filter.js; until 2026-11-22 a bar under the top
// bar): what is shown, a tap opens that group's page, × shows every train again.
const line = createLine(document.getElementById('line'));
window.__line = line;   // (for the parts to come and the tools: set(id, { html, onTap, onClose, priority }), clear(id))
function showFilter() {
  lastDraw = 0;   // the dots at once, not at the next refresh (up to a second far out)
  // Two filters, two pills (Max, 2026-11-24: "separate pills for separate filters. Allow more than one."): the
  // companies' and kinds' ("Showing only SJ Snabbtåg, Commuter"), and the lateness' ("Showing only late 6+ min"); both
  // hold together (SJ Snabbtåg's late trains); each × lets go of its own.
  const list = filter.list(), co = list.filter(x => x.type !== 'late'), late = filter.late;
  const redraw = () => { stack.pageDef(stack.top())?.redraw?.(); homeDef.redraw(); };
  if (!co.length) line.clear('filter');
  else {
    const first = co[0], word = ({ type, v }) => (type === 'kind' ? t(`kind_${v}`) : v || t('stNoCompany'));
    line.set('filter', { priority: 10, always: true, html: `<span>${esc(t('filterShowing', co.map(word).join(', ')))}</span>`,
      onTap: () => stack.open(first.type === 'kind' ? `kind:${first.v}` : `co:${first.v}`),   // (a tap: the first one's page)
      onClose: () => { filter.clearCo(); redraw(); }, closeLabel: t('filterClear') });
  }
  if (!late) line.clear('filter-late');
  else {
    line.set('filter-late', { priority: 9, always: true, html: `<span>${esc(t('filterShowing', t('filtLate')[late]))}</span>`,
      onTap: () => stack.home(1),   // (Home with its lateness bar)
      onClose: () => { filter.setLate(null); redraw(); }, closeLabel: t('filterClear') });
  }
}
filter.onChange(showFilter);

// ---- Disruptions (src/disruptions.js; live only): Home's part and the list's page, the marks on the map, a
// disruption's page ----
let stationsLoaded;
const stationsReady = new Promise((resolve) => { stationsLoaded = resolve; });
let netNow = null;
netReady.then((n) => { netNow = n; });
const disruptions = createDisruptions({ load: fromFiles ? () => fileOf('disruptions').then(f => f.disruptions) : fetchDisruptions, now, station: sig => stations.get(sig), net: () => netNow,
  onData({ geojson }) {
    map.setDisruptions(geojson);
    const top = stack?.top() ?? '';
    if (top === 'dislist') stack.pageDef(top).redraw();
    if (top.startsWith('dis:')) { if (disruptions.byId(top.slice(4))) stack.pageDef(top).redraw(); else stack.close(top); }
  } });
if (live) Promise.all([netReady, stationsReady]).then(() => disruptions.start());
// The list (Max's pick C, 2026-11-18): the problems as before, then the rail work folded under "Rail work (n)" at the
// end, ending soonest first; open or folded is remembered on this device. The fold glides open and shut (Max,
// 2026-11-20: "Expanding and condensing störningar does not animate"): the rows are always there, in a box whose
// height goes from none to all of them (index.html .dis-works; none of it for less motion), shut ones out of reach
// (inert).
const WORKS_KEY = 'railWorksOpen';
let worksOpen = false;
try { worksOpen = localStorage.getItem(WORKS_KEY) === 'true'; } catch { /* folded */ }
function disListPage() {
  let el = null, seen = new Set();
  function draw() {
    const list = disruptions.list, problems = list.filter(d => !isWork(d));
    const works = list.filter(isWork).sort((a, b) => (a.until ?? Infinity) - (b.until ?? Infinity));
    const row = d => rowHtml(d, stationName, now());
    el.innerHTML = `<div class="panel-head"><strong>${t('disruptions')}</strong></div><div class="dis-body">` + (!disruptions.loaded ? stateHtml('loading', t('loading'))
      : !list.length ? stateHtml('empty', t('noDisruptions'))
      : `<p class="panel-note">${t(problems.length ? 'disruptionsNote' : 'noProblemsNow')}</p>`) +
      problems.map(row).join('') +
      (works.length ? `<button type="button" class="dis-fold" aria-expanded="${worksOpen}"><span class="dis-ic work" aria-hidden="true">${icon('cone', 16)}</span>` +
        `<span>${t('railWorks')} (${works.length})</span>${icon('chevronDown', 16)}</button>` +
        `<div class="dis-works${worksOpen ? ' open' : ''}"${worksOpen ? '' : ' inert'}><div class="dis-works-in">${works.map(row).join('')}</div></div>` : '') + '</div>';
    arrive(el.querySelectorAll('.dis-body > .dis-row, .dis-body > .dis-fold'), seen, r => r.dataset.id ?? 'fold');
    const fold = el.querySelector('.dis-fold'), box = el.querySelector('.dis-works');
    if (fold) fold.onclick = () => {
      worksOpen = !worksOpen;
      try { localStorage.setItem(WORKS_KEY, String(worksOpen)); } catch { /* not kept */ }
      fold.setAttribute('aria-expanded', String(worksOpen));
      box.classList.toggle('open', worksOpen);
      box.inert = !worksOpen;
      if (worksOpen) arrive(box.querySelectorAll('.dis-row'), new Set(), r => r.dataset.id);
      // the sheet shows the opened list at once (Max, 2026-11-23): its end is where the glide will take it
      const inner = box.firstElementChild;
      if (worksOpen) stack.reveal(fold, fold.getBoundingClientRect().bottom + 6 + (inner?.scrollHeight ?? 0));
      else stack.unreveal();
    };
  }
  return { name: () => t('disruptions'), kind: 'dislist', startLevel: 2 /* (opens full: Max, 2026-11-23) */, mount(page) { el = page; }, show(page, { dir }) { if (dir > 0) seen = new Set(); draw(); }, redraw: () => draw() };
}
// A disruption: its words; opened (not come back to), the map shows all of its stretches (one station: flies to it).
function disPage(id) {
  if (!disruptions.byId(id)) return null;
  let el = null;
  const draw = () => {
    const d = disruptions.byId(id);
    if (!d) return;
    el.innerHTML = `<div id="disruption">${cardHtml(d, stationName, now())}</div>`;
    el.querySelector('.panel-close').onclick = () => stack.close(`dis:${id}`);
  };
  return {
    name: () => disruptions.byId(id)?.header ?? t('disruptions'), kind: 'dis',
    mount(page) { el = page; },
    show(page, { dir }) {
      draw();
      if (dir <= 0) return;
      const d = disruptions.byId(id), box = disruptions.boundsOf(d), p = !box && disruptions.placeOf(d);
      map.unfollow();
      if (box) map.fitBox(box);
      else if (p) map.goTo(p, 9);
    },
    redraw: draw,
  };
}
function openDisruption(id) { stack.open(`dis:${id}`); }

// ---- Rail lines: Trafikverket's, always shown ----
map.showRail('trv');

// ---- Live data ----
// How each feed is doing, and its own problem if it has one (one feed's good news must not wipe the other's problem).
const status = { positions: 'starting', passings: 'starting', errors: { positions: null, passings: null }, pausedSince: null };
const statusError = () => [status.errors.positions, status.errors.passings].filter(Boolean).join(' · ') || null;
// When position data last arrived (this computer's clock). After NO_DATA_MS with nothing, every train brakes to a
// stop and turns grey, and the status line says since when; when data returns they fast-forward to their places.
const NO_DATA_MS = 60 * 1000;
let lastDataAt = null;

// Station passings: the lateness label, each train's delay and last passing, and a train whose GPS is quiet moves
// on to a station it is reported passing.
function onPassings(list) {
  stats.onPassings(list, now());
  lateness.update(list);
  routes.addPassings(list);
  trains.addPassings(list);
}
// Trains before the track file (TODO 24, Codex's beta review point 10; Max's go 2026-11-21, "1 a"): the feeds start
// at once, beside the track file (650 kB packed: a few seconds on slow mobile data, when the map stayed empty). Until it
// is in, each train is drawn standing at its latest report (its way, its lateness colour: earlyPlaced) and its reports
// wait in `early`; when it is in (or failed: no network, as before) they go to the simulation in one batch and it
// takes over. The movement itself is unchanged.
let netIn = false;
const early = [], earlyAt = new Map();   // reports before the track file; each train's latest of them
const earlyPlaced = () => [...earlyAt.values()].map(r => ({ id: r.id, lon: r.lon, lat: r.lat, bearing: r.bearing ?? 0, syncing: false,
  stale: false, v: 0, extra: 0 }));
const reportOf = id => trains.get(id) ?? (netIn ? null : earlyAt.get(id) ?? null);
const positionHandlers = {
  onRecords(records) {
    lastDataAt = now();
    conn.onBatch(records.length);
    stats.onRecords(records, now());
    speedLog.add(records, now());
    if (!netIn) {
      early.push(...records);
      for (const r of records) if (r.gone) earlyAt.delete(r.id); else earlyAt.set(r.id, r);
      return;
    }
    if (trains.halted) trains.setHalted(false);
    trains.update(records, now());
  },
  onStatus(s) {
    status.positions = s.mode;
    status.errors.positions = s.error ?? null;
    status.pausedSince = s.mode === 'paused' ? s.since ?? lastDataAt : null;
    if (s.error) console.warn('positions:', s.error);
  },
};
let positionsFeed = null, passingsFeed = null;   // the live feeds (stop functions with .restart), for coming back
netReady.then(net => { if (net) trains.useNet(net); }).finally(() => {
  netIn = true;
  if (early.length) trains.update(early.splice(0), now());
  earlyAt.clear();
});
// The feeds start at once (above: their reports wait for the track file).
(function startFeeds() {
  // The public page: everything from the fetcher's files (positions, passings, planned routes, stations).
  if (fromFiles) {
    positionsFeed = startFilesSource(filesBase, { ...positionHandlers, onPassings, onPlanned: gotPlanned, onStations: gotStations,
      // When the fetcher last got a position report (in each live file since 0.6.0), not when the file came: a file
      // keeps coming every 5 s while Trafikverket is silent, and that hid the "no data" halt (Codex's beta review point
      // 7). Taken as an age on the fetcher's own clock, so a phone clock that is off doesn't matter. Measured: even at
      // night some train in Sweden reports at least every 10 s (four night recordings), so NO_DATA_MS can stay a minute.
      onFile: (fileT, lastRecordAt) => { lastFileAt = Date.now(); lastDataAt = now() - (lastRecordAt ? Math.max(0, fileT - lastRecordAt) : 0); } });
    return;
  }
  if (!replay) { positionsFeed = startTrainSource(positionHandlers); return; }
  // A replay brings its own timetable (planned routes and passings), when the recording has one.
  startReplaySource(replay, { ...positionHandlers, onPlanned: rows => routes.add(rows), onPassings });
})();

// Back from the background (another app, a locked phone, another tab) after BACK_MS or more: a phone froze the page,
// so every train's data is as old as that. Each train is placed where it is now as soon as its next report comes
// (trains.resume), instead of fast-forwarding there (Max, 2026-11-14, note 3); the live feeds ask again at once; and
// the "no data" halt waits a minute from now (otherwise every train came back braking, grey, until data came).
const BACK_MS = 10 * 1000;
let hiddenAt = null;
// While hidden the files page asks for nothing (Codex's beta review point 6: the 5-s reads, the open board's and
// card's refreshes went on behind another app or a locked phone); back, it reads at once.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = now(); positionsFeed?.pause?.(); return; }
  positionsFeed?.resume?.();
  board.wake?.();
  panel.wake?.();
  if (hiddenAt === null) return;
  const was = hiddenAt;
  hiddenAt = null;
  if (now() - was < BACK_MS) return;
  trains.resume(was, now());
  if (lastDataAt !== null) lastDataAt = Math.max(lastDataAt, now());
  if (trains.halted) trains.setHalted(false);
  positionsFeed?.restart?.();
  passingsFeed?.restart?.();
});

// Planned rows (from the fetcher's files; the key page asks for its own below): the routes, and each train's company.
function gotPlanned(rows) {
  routes.add(rows);
  for (const row of rows) if (row.brand) lateness.setBrand(row.key, row.brand);
}
// The newest file of a kind from the fetcher (src/files-source.js); fails until it exists.
async function fileOf(kind) {
  const f = await positionsFeed?.latest?.(kind);
  if (!f) throw new Error(`no ${kind} file yet`);
  return f;
}
// { count, byBrand (null from a file made before 2026-11-21) }
function askCancelled() { return fromFiles ? fileOf('stats').then(f => ({ count: f.cancelled, byBrand: Array.isArray(f.cancelledBy) ? Object.fromEntries(f.cancelledBy) : null, day: f.day ?? null })) : fetchCancelledToday(swedishDay(now())); }
// Today's arrivals from the files: the whole day (hourly) + what changed since (every 5 minutes), as day-stats asks.
async function filesArrivals(midnight, since) {
  const full = await fileOf('arrivals');
  const add = await fileOf('arrivals-add').catch(() => null);
  const day = swedishDay(now()), rows = [];
  if (full.day === day && (since === null || since < full.t)) rows.push(...full.rows);
  if (add && add.day === day && add.t >= full.t) rows.push(...add.rows);
  return rows.map(([id, planned, actual, brand]) => ({ id, planned, actual, brand: brand ?? null }));   // (no company in files before 2026-11-21)
}

function gotStations(m) {
  stations = m;
  stationsLoaded();
  routes.setStations(new Map([...m].filter(([, st]) => st.lon !== null)));
  stopPlacesReady.then(() => map.setStations([...m.values()].filter(st => st.advertised && st.lon !== null).map(shownAt)));
  // A card opened before the stations came drew its line without them (no places: nothing, or a part): again now.
  panel.reroute();
}
// The station list is asked for until it arrives: again after 5 s, 15 s, then every minute. (Asked once, a failure
// left the page without station names, search, boards and planned routes until it was loaded again.)
function loadStations(tries = 0) {
  fetchStations().then(gotStations).catch((e) => {
    console.warn('stations:', e.message);
    setTimeout(() => loadStations(tries + 1), [5000, 15000][tries] ?? 60000);
  });
}
if (hasKey && replay) loadStations();
if (hasKey && !replay && !fromFiles) {
  passingsFeed = followPassings({
    onPassings,
    onStatus(s) {
      status.passings = s.mode;
      status.errors.passings = s.error ?? null;
      if (s.error) console.warn('timetable:', s.error);
    },
  });
  loadStations();

  // Planned routes: asked for trains on the map whose known route ends within 30 minutes (or isn't known), at most
  // every 5 minutes per train; each answer covers 30 minutes back to 90 minutes ahead.
  // The first question about a train reaches further back: 90 minutes (as far as the passings go) plus its known
  // delay. The arrival that ends its trip is then among the rows also when it runs late or had arrived before the
  // page opened; without that row a finished train stayed on the map up to 15 minutes instead of 2 (14 trains in
  // four recordings, 2026-11-13).
  const asked = new Map();   // train key -> when its route was last asked for
  const BACK_MS = 30 * 60000, FIRST_BACK_MS = 90 * 60000, MAX_BACK_MS = 4 * 3600000, LATE_MIN = 15;
  async function askRoutes() {
    const t = now();
    const want = trains.reports().filter(r => routes.until(r.id) < t + 30 * 60000 && !(t - (asked.get(r.id) ?? 0) < 5 * 60000));
    if (!want.length) return;
    const lateBy = r => lateness.get(r.id)?.minutes ?? 0;
    const again = want.filter(r => asked.has(r.id)), first = want.filter(r => !asked.has(r.id));
    const late = first.filter(r => lateBy(r) > LATE_MIN), onTime = first.filter(r => !(lateBy(r) > LATE_MIN));
    for (const r of want) asked.set(r.id, t);
    // Three questions at most: trains asked before, new ones, and new ones running late (few; as far back as the latest).
    // The first question about a train also asks for its company (withBrand).
    const groups = [[again, BACK_MS, false], [onTime, FIRST_BACK_MS, true],
      [late, Math.min(MAX_BACK_MS, FIRST_BACK_MS + Math.max(0, ...late.map(lateBy)) * 60000), true]];
    for (const [list, back, withBrand] of groups) {
      if (!list.length) continue;
      try {
        const rows = await fetchPlannedRoutes([...new Set(list.map(r => r.operational))], t - back, t + 90 * 60000, { withBrand });
        routes.add(rows);
        for (const row of rows) lateness.setBrand(row.key, row.brand);   // the company, also with no passing lately
      } catch (e) {
        console.warn('planned routes:', e.message);
        for (const r of list) asked.delete(r.id);
      }
    }
  }
  setTimeout(askRoutes, 5000);
  setInterval(askRoutes, 30000);

  setInterval(() => {
    const before = now() - FORGET_MS, keep = key => Boolean(trains.get(key)) || panel.openId === key;
    for (const [key, at] of asked) if (at < before && !keep(key)) asked.delete(key);
  }, 10 * 60000);
}
// Every 10 minutes the lists let go of trains with nothing newer than 6 hours that are neither on the map nor open
// in the panel (timetable rows, lateness, company, when its route was asked for). They only ever grew.
const FORGET_MS = 6 * 3600000;
if (!replay) setInterval(() => {
  const before = now() - FORGET_MS, keep = key => Boolean(trains.get(key)) || panel.openId === key;
  routes.trim(before, keep);
  lateness.trim(before, keep);
}, 10 * 60000);

const modeText = m => t('mode')[m] ?? m;
const statusEl = document.getElementById('status');
const statusCount = statusEl.querySelector('.count');

const clock = hhmm;   // Swedish time, wherever the phone is (src/clock.js)
const mins = sec => `${Math.max(1, Math.floor(sec / 60))} min`;

// The panel line for a train's state (trains.stateOf): '' when it simply follows its GPS.
function statusLine(st, noData) {
  if (!st) return t('notOnMap');
  if (noData) return t('noDataFromTrv', clock(lastDataAt));
  if (st.syncing) return t('catchingUp');
  const quiet = st.gpsSilentFor >= 60 ? t('noGpsFor', mins(st.gpsSilentFor)) : null;
  const passed = st.lastPassing && st.lastPassing.time > now() - 3 * 3600000
    ? t('lastPassed', stationName(st.lastPassing.sig), clock(st.lastPassing.time)) : '';
  const q = quiet ?? t('noNewPosition');
  if (st.stale) return t('silentFor', mins(st.silentFor));
  if (st.mode === 'stood') return quiet ? t('stoodStill', quiet, passed) : '';
  if (st.mode === 'waiting' && st.lastPassing?.sig === st.waitingFor && st.lastPassing.activity === 'Ankomst')
    return t('atStation', q, stationName(st.waitingFor), clock(st.lastPassing.time));
  if (st.mode === 'waiting' && st.waitingAt) return t('waitingAt', q, stationName(st.waitingFor), passed);
  if (st.mode === 'waiting') return t('waitingBefore', q, stationName(st.waitingFor), passed);
  if (st.mode === 'timetable') return t('byTimetable', q, passed);
  if (st.mode === 'coasted out') return t('stoppedLastSeen', q, passed);
  return '';
}

// The connection screen: the state in words, the chain from Trafikverket to this phone, and three numbers (once a
// second while it is open, src/connection.js).
function showConn(st = null) {
  const tNow = st?.tNow ?? now();
  const noData = st?.noData ?? (lastDataAt !== null && tNow - lastDataAt > NO_DATA_MS);
  const paused = st?.paused ?? (status.positions === 'paused' && status.pausedSince !== null);
  const outdated = st?.outdated ?? status.positions === 'outdated';
  const error = st?.error ?? statusError();
  const mode = status.positions;
  const [state, title, text] = replay ? ['replay', t('connReplay'), t('connReplayText', hhmm(tNow))]
    : outdated ? ['bad', t('needsUpdate'), t('connOutdatedText')]
    : paused ? ['bad', t('livePausedSince', clock(status.pausedSince)), t('connPausedText')]
    : noData ? ['bad', t('connNoData', clock(lastDataAt)), t('connNoDataText')]
    : error ? ['bad', t('connProblem'), error]
    : mode === 'starting' ? ['slow', modeText(mode), t('connStartText')]
    : mode !== 'stream' ? ['slow', modeText(mode), t('connSlowText')]
    : ['live', t('connLive'), t('connLiveText')];
  const fresh = trains.reports().filter(r => r.time >= tNow - 60000).length;
  const online = navigator.onLine !== false;
  const trv = { icon: 'train', name: t('connTrv'), sub: noData ? t('connSilent') : mode === 'stream' ? t('connStream') : t('connEvery10'),
    st: noData ? 'bad' : mode === 'stream' ? 'ok' : 'slow' };
  const you = { icon: 'phone', name: t('connYou'), st: online ? 'ok' : 'bad',
    sub: !online ? t('connOffline') : fromFiles && lastFileAt ? t('connAgo', Math.max(0, Math.round((Date.now() - lastFileAt) / 1000))) : t('connOnline') };
  // The public page: Trafikverket → our server → the website → you. When files stop coming, the phone can't tell
  // whether the server or the website failed: the website is marked, the server "not known".
  const chain = replay ? [] : fromFiles ? [trv,
    { icon: 'server', name: t('connServer'), sub: paused ? t('connUnknown') : t('connListening'), st: paused || !online ? 'unknown' : 'ok' },
    { icon: 'globe', name: t('connWeb'), sub: t('connEvery5'), st: !online ? 'unknown' : paused ? 'bad' : 'ok' }, you] : [trv, you];
  conn.update({ state, title, text, chain, trains: trains.count, fresh, behindS: DRAW_DELAY_MS / 1000,
    nextAt: fromFiles && !replay ? positionsFeed?.nextAt?.() ?? null : null });
}

let beatSeen = null, beatAt = 0;
setInterval(() => {
  const tNow = now();
  const noData = lastDataAt !== null && tNow - lastDataAt > NO_DATA_MS;
  if (noData && !trains.halted) trains.setHalted(true);
  trains.prune(tNow);
  // The open train's trip handed on to its next internal number (trains.prune): the card and the camera go with it.
  const to = panel.openId && !trains.get(panel.openId) ? trains.handedTo(panel.openId) : null;
  if (to) {
    const wasFollowing = map.following, key = `train:${panel.openId}`;
    if (stack.top() === key) stack.replace(`train:${to}`);
    else stack.close(key);
    if (!wasFollowing && panel.openId === to) { map.unfollow(); panel.setFollowing(false); }
  }
  if (!dayView?.past) map.sunUpdate();   // (the sun's line moves on once a minute; The day's moment: its own frame)
  const error = statusError();
  // On the map a short line (the main screen stays clean); the whole line in the menu. A problem shows on both, red.
  const mode = `${modeText(status.positions)}${replay ? ` ${hhmm(tNow)}` : ''}`;
  // The search bar's chip: the status in words, no count (Max, 2026-11-16: "remove the trains counter. Keep the status
  // text instead"): live / every 10 s / reconnecting / replay 07:01, or the problem; the whole short line, with the
  // count, as its label (read by tools/shot.mjs and soak.mjs).
  // The public page: "live data paused since 14:32" when no new file has come for 30 s (src/files-source.js).
  const paused = status.positions === 'paused' && status.pausedSince !== null;
  // Files in a format newer than this page reads (src/files-source.js; TODO 26): an app left un-updated says so.
  const outdated = status.positions === 'outdated';
  const state = outdated ? t('needsUpdate') : paused ? t('livePausedSince', clock(status.pausedSince)) : noData ? t('noDataSince', clock(lastDataAt)) : error ?? mode;
  const short = `${t('trainsCount', trains.count)} · ${state}`;
  // The pill itself: two or three words (Max, 2026-11-19: some were "WAY too long", the feeds' own error texts); the
  // whole line stays its label and title, and the connection screen behind it tells the rest.
  statusCount.textContent = pillText({ mode: status.positions, replayAt: replay ? hhmm(tNow) : null, outdated,
    pausedSince: paused ? clock(status.pausedSince) : null, noDataSince: noData ? clock(lastDataAt) : null, error: Boolean(error) });
  statusEl.title = short;
  statusEl.ariaLabel = short;
  // Yellow when not streaming (asking every 10 s, reconnecting, starting). The streaming mode is 'stream' (shown as
  // "live"): the test was !== 'live', so the chip was yellow all the time when live (2026-11-15 to 16).
  statusEl.classList.toggle('slow', status.positions !== 'stream' && !replay);
  // A pulse of the live dot when fresh data has come, at most every 10 s (round 4: a sign of life without drawing all the time).
  if (trains.lastReport && trains.lastReport !== beatSeen && tNow - beatAt > 10000 && !noData && !error) {
    beatSeen = trains.lastReport; beatAt = tNow;
    statusEl.classList.remove('beat'); void statusEl.offsetWidth; statusEl.classList.add('beat');
  }
  statusEl.classList.toggle('problem', Boolean(error) || noData || paused || outdated);
  if (!connPage.hidden) showConn({ tNow, noData, paused, outdated, error });

  // The stats: the running numbers every second; the page itself only while it is open.
  stats.tick(frameAll, tNow, id => trains.get(id));
  if (statsShown()) {   // (Home's and a company's page draw themselves: src/stack.js every)
    if (live) stats.wantCancelled(askCancelled, tNow);
    dayStats?.tick();
  }
  // Settings → Debug: the positions' rate and age (Max, 2026-11-15, 3A: the stats page keeps only a grey line).
  if (!settingsPage.hidden) {
    const r = stats.rate(tNow);
    debugDataEl.textContent = r ? t('stDebugRate', r.perSecond.toFixed(0), r.ageS.toFixed(0)) : '–';
  }

  // The open train's panel: a short line on how its place is known, when it isn't simply from its GPS.
  if (panel.openId) panel.setStatus(statusLine(trains.stateOf(panel.openId, tNow - DRAW_DELAY_MS), noData));
}, 1000);

// ---- The one sheet: made last, once everything its pages use is there (src/stack.js) ----
function define(key) {
  if (key === 'home') return homeDef;
  // My trains ('trip:', 'change:', 'newtrip', 'edittrip:', 'addchange:') and the ride page ('ride:'): their own modules
  const own = myTrains?.define(key) ?? ride?.define(key);
  if (own !== undefined) return own;
  const i = key.indexOf(':'), type = i < 0 ? key : key.slice(0, i), v = i < 0 ? '' : key.slice(i + 1);
  switch (type) {
    case 'train': return trainPage(v);
    case 'station': return stationPage(v);
    case 'pick': return pickPage(key);
    case 'dis': return disPage(v);
    case 'dislist': return live ? disListPage() : null;
    case 'co': case 'kind': case 'late': case 'still': return groupPage(key, pageData);
    case 'page':
      if (v === 'settings') return heldPage(settingsPage, { name: () => t('settings'), kind: 'settings', onShow: () => { foldAccents(false); showSettings(); } });
      if (v === 'help') return heldPage(helpEl, { name: () => t('aboutApp'), kind: 'help' });   // (About Spårat, as before the sheet: Max, 2026-11-24)
      if (v === 'conn') return heldPage(connPage, { name: () => t('connTitle'), kind: 'conn', onShow: () => showConn() });
      return null;
    default: return null;
  }
}
stack = createStack({
  sheet: document.getElementById('sheet'),
  define: defineNow,
  onPad: (h) => { sheetPad = h; padMap(); },
  onChange(pg) {
    // back on Home from a page the menu opened: the menu open again (navBack, openNav above)
    if (pg.key === 'home' && navBack) { navBack = false; setTimeout(openNav, 0); }
    // Home: the lateness bar's colour lit (a group's page lights its own trains itself, src/home.js)
    if (pg.key === 'home') light(null);
    else if (pg.def.kind !== 'group' && pg.def.kind !== 'trip') light(null);
    // a train's line stays only under its own page and a station's (where the camera may still ride it); a trip's
    // page keeps its own stations' names (showTrip below) but no train's line
    if (pg.def.kind === 'trip' && !panel.openId) { map.setPath(null); map.setAbroad(null); }
    else if (pg.def.kind !== 'train' && pg.def.kind !== 'station' && !panel.openId) clearPath();
  },
});
stack.onSearch((on) => { closeNav(); document.documentElement.classList.toggle('searching', on); if (on) menu.open(); });
// A train's card that changed its size (the "to Kallhäll" chooser opened or shut, its stops come in, Share's note):
// the sheet follows at once, not at the next second's tick (Max, 2026-11-23: "the card expands after way too long").
// Taller at once; shorter only when the person changed the card within the last 1.5 s (the chooser shut): its own
// content coming in (its stops, a line under the tiles) never moves the sheet down and up again.
let cardTouched = 0;
panelEl.addEventListener('pointerdown', () => { cardTouched = performance.now(); }, true);
panelEl.addEventListener('click', () => { cardTouched = performance.now(); }, true);
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => { if (panel.openId && stack.top() === `train:${panel.openId}`) refitCard(); }).observe(panelEl);
}
// Every row in the sheet is a door (data-go: the key it opens); a few do something else (data-act).
document.getElementById('sheet').addEventListener('click', (e) => {
  const b = e.target.closest('[data-go], [data-act], [data-legend], [data-filter], [data-cofilter], .dis-row[data-id]');
  if (!b) return;
  // a company in Home's filter card: on or off right there, Home stays (Max, 2026-11-24; src/home.js companiesHtml)
  if (b.dataset.cofilter !== undefined) { filter.toggle('brand', b.dataset.cofilter); return; }
  if (b.dataset.act === 'comore') { homeDef.toggleCo(); return; }
  // any row opening a company's or a kind's page (the search's results, Recent, Saved) filters too, as Home's do (Max,
  // 2026-11-23: "Filtering still doesn't show as a pill, and clicking the map eventually clears it. Should stick."):
  // a row that only lit its trains lost them at the next map tap
  const grp = /^(co|kind):(.*)$/.exec(b.dataset.go ?? '');
  if (grp) { const type = grp[1] === 'kind' ? 'kind' : 'brand'; if (!filter.has(type, grp[2])) filter.toggle(type, grp[2]); }
  if (b.dataset.go) stack.open(b.dataset.go, { go: true });
  else if (b.dataset.legend) pageData.legend.set(b.dataset.legend);
  // A company or kind picked on Home is a filter with its pill above the search bar (its × the only way out): a map
  // tap or a train card closed keeps it (Max, 2026-11-23: "when filtering an operator: clicking the map dismisses the
  // filtering... Filtered view should be able to show clean map with filter as a pill"), as "Show only" in the search.
  else if (b.dataset.filter) {
    const type = b.dataset.filter === 'kind' ? 'kind' : 'brand';
    if (!filter.has(type, b.dataset.v)) filter.toggle(type, b.dataset.v);
    stack.open(type === 'kind' ? `kind:${b.dataset.v}` : `co:${b.dataset.v}`);
  }
  else if (b.dataset.act === 'favtrain') pickFavouriteTrain(b.dataset.n);
  else if (b.dataset.act === 'showonly') stack.pageDef(stack.top())?.toggleShowOnly?.();
  else if (b.dataset.act === 'allplaces') setSetting('allPlaces', !settings.allPlaces);
  else if (b.dataset.id && b.classList.contains('dis-row')) stack.open(`dis:${b.dataset.id}`);
});
// For the tools (tools/lib/screen.mjs): the stack's keys, its top, the sheet's height; opening and going back.
window.__stack = {
  keys: () => stack.keys(), top: () => stack.top(), names: () => stack.names(), get level() { return stack.level; },
  get heights() { return stack.heights; }, get searching() { return stack.searching; },
  open: (key, opts) => stack.open(key, opts), back: () => stack.back(), home: level => stack.home(level), setLevel: i => stack.setLevel(i),
};

// ---- The sheet's ideas (build plan parts 3 and 6, 2026-11-23) ----
const openTrainRow = r => pickTrain({ id: r.key, operational: r.operational, date: r.date, number: r.number, onMap: Boolean(trains.get(r.key)) });
const followOnly = id => map.follow(() => placeNow(id), () => {});
// My trains: saved trips, pinned changes, the line above the bar (src/my-trains.js).
myTrains = createMyTrains({ stack, line, stationName, findStations: text => menuStations(text), openTrain: openTrainRow, trainInfo,
  showStation: (sig) => { const st = stations.get(sig); if (!st) return; map.unfollow(); map.goTo(shownAt(st), Math.max(12, map.camera().z)); },
  redrawHome: () => { if (stack.top() === 'home') homeDef.redraw(); },
  // A saved trip on the map (Max, 2026-11-23): all its stations in view with their names, only its next train(s) lit
  // while one is on the map (none yet: every train stays).
  showTrip({ sigs, trains: ids }) {
    const pts = sigs.map(s => stations.get(s)).filter(Boolean).map(shownAt).filter(p => Number.isFinite(p.lon));
    if (pts.length > 1) {
      map.unfollow();
      const lons = pts.map(p => p.lon), lats = pts.map(p => p.lat);
      map.fitBox([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]);
    }
    map.setRouteStations(sigs);
    const on = new Set(ids.filter(id => frameById.has(id)));
    light(on.size ? x => on.has(x.id) : null);
  } });
if (import.meta.env.DEV) {   // (tools/ideas-check.mjs)
  window.__routeSigs = () => map.routeStationsNow;
  window.__stationAt = (sig) => { const st = stations.get(sig); return st ? shownAt(st) : null; };
}
// "You seem to be on 231" and the ride page (src/ride.js), only while My location is on.
ride = createRide({ map, stack, line, drawDelay: DRAW_DELAY_MS, frame: () => frameAll, info: id => trainInfo(id), stationName, lateOf,
  follow: followOnly, unfollow: () => map.unfollow() });
// Peek: hold a station on the map (src/peek.js).
peek = createPeek({ box: mapEl, stationAt: (x, y) => map.stationAt(x, y), load: sig => fetchBoard(sig, 'Avgang', now(), 3), stationName,
  blocked: () => Boolean(shop?.running) });
// The shop window (src/shop-window.js; Settings → Shop window).
shop = createShopWindow({ map, enabled: () => settings.shopWindow,
  busy: () => stack.level > 0 || stack.searching || !navEl.hidden || Boolean(hooks.dayOther?.()),
  trains() {
    const said = new Map(speedLog.moving(now()));
    return frameAll.filter(x => !x.stale).map(x => ({ id: x.id, number: trains.get(x.id)?.number ?? '', brand: x.brand, lon: x.lon, lat: x.lat,
      // (a speed over 210 km/h is a glitch, 311 km/h reported on 17 Nov: the drawn speed then, else none)
      speed: [said.get(x.id), (x.v ?? 0) * 3.6].find(v => v !== undefined && v <= 210) ?? 0, bearing: x.bearing ?? 0, late: lateOf(x.id) }));
  },
  disruptions: () => (live && disruptions.loaded ? disruptions.list.filter(d => !isWork(d)).map(d => ({ id: d.id, header: d.header, place: disruptions.placeOf(d) })) : []),
  follow: followOnly, unfollow: () => map.unfollow() });
// A shared link (#train=531, src/share.js): today's run of that number, once the trains are in (on the map: there;
// otherwise its run now, the next one, or the latest, as a starred train).
if (sharedAt) {
  (async () => {
    await map.shown;
    const t0 = Date.now();
    while (!trains.count && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 300));
    await new Promise(r => setTimeout(r, 1200));
    pickFavouriteTrain(sharedAt);
  })();
}
if (import.meta.env.DEV) window.__ideas = { myTrains, ride, peek, shop, why: id => whyFor(id), stoodFor: id => stoodFor(id, now()), favourites };

