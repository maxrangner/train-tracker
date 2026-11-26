// Spårat's page: wires the parts together. Each feature lives in its own module with its own state; this file makes
// them in order and hands each what it needs.
// The stylesheet by part, in this order, first (so the look's variables are there before any part starts; the layers:
// src/css/tokens.css).
import './css/tokens.css';
import './css/base.css';
import './css/sheet.css';
import './css/page.css';
import './css/train-card.css';
import './css/board.css';
import './css/menu.css';
import './css/map.css';
import './css/settings-about.css';
import './css/my-trains.css';
import './css/disruptions.css';
import './css/shop.css';
import './css/stats.css';
import './css/scrollbar.css';
import './css/connection.css';
import './css/scale.css';
import './css/day.css';
import { createTrains, STAND_SPEED } from './trains.js';
import { createLateness, label } from './lateness.js';
import { createMap } from './map.js';
import { createPanel } from './panel.js';
import { createSpeedLog } from './speed-log.js';
import { stationsMatching } from './menu.js';
import { favourites } from './favourites.js';
import { settings, setSetting } from './settings.js';
import { t, translatePage } from './i18n.js';
import { onTap } from './tap.js';
import { createStack } from './stack.js';
import { createLine } from './line.js';
import { createStart, groupPage } from './home.js';
import { createStartChips, START_KEYS } from './start-chips.js';
import { fetchBoard, fetchDisruptions, fetchDayArrivals, hasKey } from './trafikverket.js';
import { createDisruptions, isWork } from './disruptions.js';
import { loadNet } from './rail-net.js';
import { createRoutes } from './routes.js';
import { now } from './clock.js';
import { createStats } from './stats.js';
import { createDayStats } from './day-stats.js';
import { createFilter } from './filter.js';
import { addScrollbar } from './scrollbar.js';
import { hashParams } from './address.js';
import { createStationList } from './station-list.js';
import { createRouteOverlay } from './route-overlay.js';
import { createFrame } from './frame.js';
import { createNavMenu } from './nav-menu.js';
import { createBack } from './back.js';
import { createDay } from './day.js';
import { createFeeds } from './live/feeds.js';
import { createStatus } from './live/status.js';
import { createTrainPages } from './pages/train.js';
import { createStationPages } from './pages/station.js';
import { createPicker } from './pages/picker.js';
import { createDisruptionPages } from './pages/disruptions.js';
import { createHeldPages } from './pages/held.js';
import { createRouter } from './pages/router.js';
import { createAbout } from './about.js';
import { createSettingsPage } from './settings-page.js';
import { startChrome, buzz } from './chrome.js';
import { createFilterPills } from './filter-pills.js';
import { createSearch } from './search.js';
// The sheet's ideas: My trains and the change, "You seem to be on", Peek, the shop window, Share.
import { createMyTrains } from './my-trains.js';
import { createRide } from './ride.js';
import { createPeek } from './peek.js';
import { createShopWindow } from './shop-window.js';
import { sharedNumber, dropShared } from './share.js';

// ---- Where the data comes from: #replay=<name> plays a recording (data/positions-<name>.jsonl; the page's clock runs
// from its start); the public page reads the fetcher's files (VITE_DATA_URL; the dev page also #files=<address>, only
// there: a link can't point the public page elsewhere); else the key (the dev page, the Android dev app). ----
const hash = hashParams();
const replay = hash.get('replay');
const filesBase = replay ? null : (import.meta.env.DEV && hash.get('files')) || import.meta.env.VITE_DATA_URL || null;
const fromFiles = Boolean(filesBase);
const live = !replay && (hasKey || fromFiles);   // live data of some kind: stations, disruptions, stats, messages
const modeName = () => (replay ? `replay ${replay}` : fromFiles ? 'files' : 'live');
// A shared train (#train=531, src/share.js): opened once the trains are in (below); out of the address at once.
const sharedAt = sharedNumber();
if (sharedAt) dropShared();
// The files come every 5 s, a few seconds after the reports: drawn 30 s behind instead of 25, the movement as good
// (tools/motion-check.mjs --files).
const FILES_DELAY_MS = 30 * 1000;

window.__started = true;
// How a page comes in and how fast (Debug → Page change, Animation speed): src/css/sheet.css :root[data-motion], src/css/tokens.css [data-mspeed].
const markMotion = () => { const d = document.documentElement.dataset; d.motion = settings.pageMotion; d.mspeed = settings.motionSpeed; };
markMotion();   // (index.html reports it on screen if this line is never reached)
translatePage();

// ---- The data engines ----
// The rail network: the tracks the trains follow and the rail lines on the map; positions wait for it (failed: straight
// lines between reports).
const netUrl = new URL('rail-net.json', location.href).href;
const netReady = loadNet(netUrl).catch((e) => {
  console.warn(`rail network: ${e.message} (run node tools/rail-net.mjs)`);
  return null;
});
let net = null;
netReady.then((n) => { net = n; });
const trains = createTrains(fromFiles ? { delayMs: FILES_DELAY_MS } : {});
const DRAW_DELAY_MS = trains.DELAY_MS;   // how far behind real time the map is drawn
if (import.meta.env.DEV) Object.assign(window, { __trains: trains, __now: now });   // (for tools/; not in a build)
// Each train's planned route: at junctions a coasting train takes the way to its next stop, and waits before it.
const routes = createRoutes();
trains.useRoutes(routes);
netReady.then((n) => { if (n) routes.setNet(n); });
const lateness = createLateness();
if (import.meta.env.DEV) window.__lateness = lateness;   // (tools/ui-motion-check.mjs changes a train's minutes)
const stats = createStats({ keep: !replay });
const filter = createFilter();   // which trains the map shows (src/filter.js)
const speedLog = createSpeedLog();   // every train's speeds of the last 10 minutes (the card's own numbers)
// Today's arrivals for the stats: asked for only while shown (the key, or the fetcher's arrivals files).
const dayStats = live ? createDayStats({ now, loadArrivals: fromFiles ? (m, s) => feeds.arrivals(m, s) : fetchDayArrivals }) : null;
const minutesOf = id => lateness.get(id)?.minutes;
const lateOf = id => minutesOf(id) ?? null;
const labelFor = r => label(r.number, minutesOf(r.id));

// ---- The map, the card, the line on the map, the frame ----
let stack = null;   // the one sheet (src/stack.js): made last, once everything its pages use is there
let myTrains = null, ride = null, peek = null, shop = null;   // the sheet's ideas, made after the sheet
const holder = document.getElementById('page-holder');   // where the pages' parts wait while not shown
const mapEl = document.getElementById('map');
const panelEl = document.getElementById('panel');
const map = createMap('map', {
  // A plain tap on the map: ☰'s menu closes in the same tap, and the tap goes on to what is under it (src/stack.js R1, R2).
  onMapTap() {
    if (peek?.ate()) return true;   // (the finger lifted after a peek)
    nav.close();
    return false;
  },
  railData: { trv: () => netReady.then((n) => { if (!n) throw new Error('no rail network'); return n.toGeoJSON(); }) },
  getTrains3d: () => frame.drawn,   // (drawn where this frame put them, the places the camera uses)
  // Each car of a model sits on the track (The day's trains are drawn straight: the live train's track is elsewhere).
  alongTrack: (id, d) => (day.past ? null : trains.along(id, d)),
  sunTime: () => (day.past ? day.view.moment : now() - DRAW_DELAY_MS),
  // A train opens its page and the camera follows it (R2); nothing: R1 (src/stack.js mapTap). At an earlier moment
  // (The day): a small bubble over the train instead.
  onTrainTap(id) {
    const view = day.view;
    if (view?.past && (id || view.bubbleShown)) { if (id) day.bubble([id]); else view.hideBubble(); return; }
    if (trainPages.open(id, { fromMap: true })) return;
    stack.mapTap();
  },
  onStationTap(sig) { stationPages.open(sig, { fromMap: true }); },
  onDisruptionTap(id) { disPages.open(id, { fromMap: true }); },
  onGroupTap(list) { if (day.past) day.bubble(list.map(x => x.id)); else picker.show(list, { fromMap: true }); },
});
const stations = createStationList({ routes, map });
const follow = id => map.follow(() => frame.placeNow(id), () => panel.setFollowing(false));   // (gone or dragged off: following stops)
const panel = createPanel(panelEl, {
  stationName: stations.name,
  onMore: full => stack.setLevel(full ? 2 : 1),   // ("All stops" raises the sheet)
  onFold: (open, box) => (open ? stack.reveal(box) : stack.unreveal()),   // (its messages shown at once)
  onStop: sig => stationPages.open(sig),
  extra: id => trainPages.extras(id),
  onHead: () => stack?.refreshBar(),   // (its head line drawn again: share, star and Follow back in it)
  statusOf: id => status.lineOf(id),
  station: stations.get,
  lateOf: id => (trains.get(id) ? minutesOf(id) : undefined),
  info: (box, c) => trainPages.info(box, c),
  places: (id, r, stops) => route.placesAhead(id, r, stops),
  onSelect(id) {
    map.select(id);
    if (!id) map.unfollow();   // (the map stays exactly as it is)
    route.onSelect(id);
  },
  onRoute: (id, r) => route.onRoute(id, r),
  onFollow(id, on) {
    buzz();
    if (on) follow(id); else map.unfollow();
  },
});
const route = createRouteOverlay({ map, panel, trains, stations, net: () => net, netReady, netUrl,
  placeNow: id => frame.placeNow(id), drawnAt: id => frame.byId.get(id) });
startChrome({ map, mapEl });
for (const sel of ['#settings', '.help-body', '#conn-body']) addScrollbar(document.querySelector(sel));
const frame = createFrame({ trains, lateness, map, panel, filter, settings, route, places: at => feeds.placed(at), reportOf: id => feeds.reportOf(id),
  day: () => day.view, lateOf, drawDelay: DRAW_DELAY_MS, now });
frame.start();

// ---- Disruptions (live only): the data; their pages below ----
const disruptions = createDisruptions({ load: fromFiles ? () => feeds.fileOf('disruptions').then(f => f.disruptions) : fetchDisruptions, now, station: stations.get, net: () => net,
  onData({ geojson }) { map.setDisruptions(geojson); disPages.onData(); } });
if (live) Promise.all([netReady, stations.ready]).then(() => disruptions.start());

// ---- The pages a key names ----
// (each part gets the sheet as a getter: it is made last)
const trainPages = createTrainPages({ get stack() { return stack; }, trains, panel, panelEl, map, route, frame, speedLog, stations, disruptions, live, lateOf, minutesOf,
  labelFor, buzz, follow, holder, favourites, net: () => net, now, drawDelay: DRAW_DELAY_MS });
const stationPages = createStationPages({ get stack() { return stack; }, stations, map, route, favourites, holder, pickTrain: tr => trainPages.pick(tr), trains, live, settings, now });
const picker = createPicker({ get stack() { return stack; }, holder, openTrain: id => trainPages.open(id) });
const disPages = createDisruptionPages({ get stack() { return stack; }, disruptions, stationName: stations.name, map, now });
const about = createAbout({ map, panel, trains, lateness, mode: modeName, debugAsked: hash.get('debug') });

// ---- ☰'s menu, The day, the way back ----
const day = createDay({ map, panel, panelEl, stack: () => stack, frame, feeds: () => feeds, net: () => net, fromFiles, now, drawDelay: DRAW_DELAY_MS });
const nav = createNavMenu({ stack: () => stack, mapEl, onDay: () => day.toggle(), onState: () => chips?.sync() });
const back = createBack({ nav, day, stack: () => stack });

// ---- The search; Home and the group pages ----
const search = createSearch({ get stack() { return stack; }, trains, lateness, lateOf, stations, frame, disruptions, trainPages, favourites });
const snapshot = (brand = null) => stats.snapshot({ count: trains.count, reports: trains.reports(), frame: frame.all, lateness, stations: stations.all,
  trainOf: id => trains.get(id), at: now(), replay: Boolean(replay), day: dayStats?.view(brand) ?? null, brand });
// (Statistik or a company's page: the stats' cancelled trains and today's arrivals are asked for)
const statsShown = () => { const top = stack?.top(); return top === 'stats' || Boolean(top?.startsWith('co:')); };
function wantStats() { if (live) stats.wantCancelled(feeds.askCancelled, now()); dayStats?.open(); }
const pageData = {
  frame: () => frame.all, lateOf, numberOf: id => trains.get(id)?.number ?? '?',
  favourites, stations: () => stations.all, location: () => map.location, stationName: stations.name,
  myTrains: () => myTrains?.mineHtml() ?? null,
  disruptions: () => (live && disruptions.loaded ? disruptions.list : null),
  snapshot, filter, still: STAND_SPEED,
  reveal: el => stack.reveal(el), unreveal: () => stack.unreveal(),
  // the lateness bar's colour: a filter with its pill, held on every page
  legend: { get: () => filter.late, set: (k) => { filter.setLate(filter.late === k ? null : k); start.redraw(); } },
  statsActions: {
    openTrain: id => trainPages.open(id, { go: true }),
    openStation: sig => stationPages.open(sig, { go: true }),
    describe: (id) => { const r = trains.get(id); return r ? { number: r.number, brand: lateness.brand(id) ?? '', minutes: lateOf(id) } : null; },
  },
  onShow: wantStats,
  onLight: fn => frame.light(fn),
  fit(list) { if (list.length) map.fitPlaces(list); },   // (a group's trains, all of them in view)
};
// Home (the search bar alone) and its pages: Sparade, Statistik, Filter (src/home.js); the chips (made with the sheet)
const start = createStart(pageData);
let chips = null;
const line = createLine(document.getElementById('line'));
window.__line = line;   // (for the tools: set(id, { html, onTap, onClose, priority }), clear(id))
const pills = createFilterPills({ get stack() { return stack; }, filter, line, home: start, frame });
map.showRail('trv');

// ---- The live data and how it is doing ----
const feeds = createFeeds({ mode: { replay, fromFiles, filesBase }, trains, routes, lateness, stats, speedLog, stations, panel, netReady, now,
  onBatch: n => status.onBatch(n), wake: () => { stationPages.board.wake?.(); panel.wake?.(); } });
const status = createStatus({ feeds, trains, stations, stats, panel, frame, mode: { replay, fromFiles }, drawDelay: DRAW_DELAY_MS, now });
onTap(document.getElementById('status'), () => (stack.top() === 'page:conn' ? stack.back() : stack.open('page:conn')));
const settingsPage = createSettingsPage({ get stack() { return stack; }, map, day, search, panel, status, pills, home: start, board: stationPages.board, filter, frame, markMotion });
setInterval(() => {
  const tNow = now();
  feeds.tick(tNow);
  trainPages.handover();
  if (!day.past) map.sunUpdate();   // (the sun's line moves on once a minute; The day's moment: its own frame)
  status.tick(tNow);
  chips?.draw();   // (their numbers)
  stats.tick(frame.all, tNow, id => trains.get(id));
  if (statsShown()) {   // (Home's and a company's page draw themselves: src/stack.js every)
    if (live) stats.wantCancelled(feeds.askCancelled, tNow);
    dayStats?.tick();
  }
}, 1000);

// ---- The one sheet ----
const held = createHeldPages({ holder, pages: {
  settings: { el: settingsPage.el, name: () => t('settings'), kind: 'settings', onShow: settingsPage.onShow },
  help: { el: about.el, name: () => t('aboutApp'), kind: 'help', startLevel: 2 },   // (opens full, as tall as it is)
  conn: { el: status.connPage, name: () => t('connTitle'), kind: 'conn', onShow: () => status.showConn() },
} });
const defineNow = createRouter({ home: start.home, own: key => start.define(key) ?? myTrains?.define(key) ?? ride?.define(key), train: id => trainPages.define(id),
  station: sig => stationPages.define(sig), picker: key => picker.define(key), dis: disPages, group: key => groupPage(key, pageData),
  held, live, day, stack: () => stack });
// The sheet's pages scroll themselves at full: with a mouse, our own thin bar for whichever is on top (src/scrollbar.js).
const pageBar = addScrollbar(null, { host: document.querySelector('#sheet .sh-pages') });
stack = createStack({
  sheet: document.getElementById('sheet'),
  define: defineNow,
  roots: START_KEYS,   // (the chips' cards)
  above: () => chips?.room() ?? 0,   // (the chips float on the sheet's edge at rest: the map's buttons above them)
  onPad: h => day.pad(h),
  onChange(pg) {
    nav.pageOnTop(pg.key);
    // (Home: the lateness bar's colour lit; a group's page and a trip light their own trains themselves)
    if (pg.key === 'home' || (pg.def.kind !== 'group' && pg.def.kind !== 'trip')) frame.light(null);
    route.pageOnTop(pg.def.kind);
    pageBar.follow(pg.el);
    chips?.sync();
  },
  onBack: () => back.step(),
  held: () => back.held(),
});
stack.onSearch((on) => {
  nav.close();
  document.documentElement.classList.toggle('searching', on);
  if (on) search.open();
  pageBar.follow(on ? document.getElementById('search-results') : stack.pageEl(stack.top()));
  chips.sync();
});
chips = createStartChips({ stack: () => stack, held: () => nav.shown, has: key => key !== 'dislist' || live,
  counts: { dis: () => (live && disruptions.loaded ? start.disChip() : null), saved: () => start.savedCount() } });
chips.sync();
// Every row in the sheet is a door (data-go: the key it opens); a few do something else (data-act).
document.getElementById('sheet').addEventListener('click', (e) => {
  const b = e.target.closest('[data-go], [data-act], [data-legend], [data-filter], [data-cofilter], .dis-row[data-id]');
  if (!b) return;
  // (a company in Home's filter card: on or off right there, Home stays)
  if (b.dataset.cofilter !== undefined) { filter.toggle('brand', b.dataset.cofilter); return; }
  if (b.dataset.act === 'comore') { start.page('filter')?.toggleCo(); return; }
  // (any row opening a company's or a kind's page filters too, as Home's do: its pill stays after a map tap)
  const grp = /^(co|kind):(.*)$/.exec(b.dataset.go ?? '');
  if (grp) { const type = grp[1] === 'kind' ? 'kind' : 'brand'; if (!filter.has(type, grp[2])) filter.toggle(type, grp[2]); }
  if (b.dataset.go) stack.open(b.dataset.go, { go: true });
  else if (b.dataset.legend) pageData.legend.set(b.dataset.legend);
  else if (b.dataset.filter) {
    // (a company or kind picked on Home: a filter with its pill above the search bar, its × the only way out)
    const type = b.dataset.filter === 'kind' ? 'kind' : 'brand';
    if (!filter.has(type, b.dataset.v)) filter.toggle(type, b.dataset.v);
    stack.open(type === 'kind' ? `kind:${b.dataset.v}` : `co:${b.dataset.v}`);
  }
  else if (b.dataset.act === 'favtrain') trainPages.pickFavourite(b.dataset.n);
  else if (b.dataset.act === 'showonly') stack.pageDef(stack.top())?.toggleShowOnly?.();
  else if (b.dataset.act === 'allplaces') setSetting('allPlaces', !settings.allPlaces);
  else if (b.dataset.id && b.classList.contains('dis-row')) stack.open(`dis:${b.dataset.id}`);
});
// For the tools (tools/lib/screen.mjs): the stack's keys, its top, the sheet's height; opening and going back.
window.__stack = {
  keys: () => stack.keys(), top: () => stack.top(), names: () => stack.names(), get level() { return stack.level; },
  get heights() { return stack.heights; }, get searching() { return stack.searching; }, get target() { return stack.target; },
  whenSettled: () => stack.whenSettled(), onSettled: fn => stack.onSettled(fn),
  open: (key, opts) => stack.open(key, opts), back: () => stack.back(), home: level => stack.home(level), setLevel: i => stack.setLevel(i),
};

// ---- The sheet's ideas ----
const openTrainRow = r => trainPages.pick({ id: r.key, operational: r.operational, date: r.date, number: r.number, onMap: Boolean(trains.get(r.key)) });
const followOnly = id => map.follow(() => frame.placeNow(id), () => {});
// My trains: saved trips, pinned changes, the line above the bar (src/my-trains.js).
myTrains = createMyTrains({ stack, line, stationName: stations.name, findStations: text => stationsMatching(stations.all, text), openTrain: openTrainRow,
  trainInfo: id => trainPages.trainInfo(id),
  showStation: (sig) => { const st = stations.get(sig); if (!st) return; map.unfollow(); map.goTo(stations.shownAt(st), Math.max(12, map.camera().z)); },
  redrawHome: () => { start.redraw(); chips.draw(); },
  // A saved trip on the map: all its stations in view with their names, only its next train(s) lit while on the map.
  showTrip({ sigs, trains: ids }) {
    const pts = sigs.map(s => stations.get(s)).filter(Boolean).map(stations.shownAt).filter(p => Number.isFinite(p.lon));
    if (pts.length > 1) { map.unfollow(); map.fitPlaces(pts); }
    map.setRouteStations(sigs);
    const on = new Set(ids.filter(id => frame.byId.has(id)));
    frame.light(on.size ? x => on.has(x.id) : null);
  } });
if (import.meta.env.DEV) {   // (tools/ideas-check.mjs)
  window.__routeSigs = () => map.routeStationsNow;
  window.__stationAt = (sig) => { const st = stations.get(sig); return st ? stations.shownAt(st) : null; };
}
// "You seem to be on 231" and the ride page (src/ride.js), only while My location is on.
ride = createRide({ map, stack, line, drawDelay: DRAW_DELAY_MS, frame: () => frame.all, info: id => trainPages.trainInfo(id), stationName: stations.name, lateOf,
  follow: followOnly, unfollow: () => map.unfollow() });
// Peek: hold a station on the map (src/peek.js).
peek = createPeek({ box: mapEl, stationAt: (x, y) => map.stationAt(x, y), load: sig => fetchBoard(sig, 'Avgang', now(), 3), stationName: stations.name,
  blocked: () => Boolean(shop?.running) });
// The shop window (src/shop-window.js; Settings → Shop window).
shop = createShopWindow({ map, enabled: () => settings.shopWindow,
  busy: () => stack.level > 0 || stack.searching || nav.shown || day.busy,
  trains() {
    const said = new Map(speedLog.moving(now()));
    return frame.all.filter(x => !x.stale).map(x => ({ id: x.id, number: trains.get(x.id)?.number ?? '', brand: x.brand, lon: x.lon, lat: x.lat,
      // (a speed over 210 km/h is a glitch: the drawn speed then, else none)
      speed: [said.get(x.id), (x.v ?? 0) * 3.6].find(v => v !== undefined && v <= 210) ?? 0, bearing: x.bearing ?? 0, late: lateOf(x.id) }));
  },
  disruptions: () => (live && disruptions.loaded ? disruptions.list.filter(d => !isWork(d)).map(d => ({ id: d.id, header: d.header, place: disruptions.placeOf(d) })) : []),
  follow: followOnly, unfollow: () => map.unfollow() });
// A shared link: today's run of that number once the trains are in (on the map: there; otherwise as a starred train).
if (sharedAt) {
  (async () => {
    await map.shown;
    const t0 = Date.now();
    while (!trains.count && Date.now() - t0 < 15000) await new Promise(r => setTimeout(r, 300));
    await new Promise(r => setTimeout(r, 1200));
    trainPages.pickFavourite(sharedAt);
  })();
}
if (import.meta.env.DEV) window.__ideas = { myTrains, ride, peek, shop, why: id => trainPages.why(id), stoodFor: id => trainPages.stoodFor(id), favourites };
