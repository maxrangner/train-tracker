import { startTrainSource } from './trains-source.js';
import { createTrains, DELAY_MS } from './trains.js';
import { createLateness, label, lateClass } from './lateness.js';
import { createMap } from './map.js';
import { createPanel } from './panel.js';
import { createMenu } from './menu.js';
import { createBoard } from './board.js';
import { pathOf } from './path.js';
import { favourites } from './favourites.js';
import { settings, setSetting, onSettingChange } from './settings.js';
import { t, translatePage } from './i18n.js';
import { followPassings, fetchStations, fetchPlannedRoutes, fetchTrainsByNumber, fetchBoard, hasKey } from './trafikverket.js';
import { loadNet } from './rail-net.js';
import { createRoutes } from './routes.js';
import { now, hhmm, hhmmss, swedishDay } from './clock.js';
import { startReplaySource } from './replay-source.js';

// #replay=<name> in the address plays a recording (data/positions-<name>.jsonl, from tools/collect.mjs) instead of
// the live data, e.g. #view=11/59.33/18.06&replay=2026-11-11T16-46-20-921Z. The page's clock then runs from the
// recording's start (src/clock.js).
const replay = new URLSearchParams(location.hash.slice(1)).get('replay');

window.__started = true;   // index.html reports it on screen if this line is never reached
translatePage();           // the page's own words in the chosen language (Settings → Language)
// The rail network: the tracks the trains follow, and Trafikverket's rail lines on the map. Positions start once it
// has loaded (or failed: then trains move in straight lines between reports).
const netReady = loadNet('/rail-net.json').catch((e) => {
  console.warn(`rail network: ${e.message} (run node tools/rail-net.mjs)`);
  return null;
});
const trains = createTrains();
let net = null;
netReady.then((n) => { net = n; });
let shownPath = null;   // { id, path, places }: the open train's path
if (import.meta.env.DEV) Object.assign(window, { __trains: trains, __now: now });   // for the tools in tools/; not in a build
// Each train's planned route (timetable): at junctions a coasting train takes the way to its next planned stop,
// and it waits before that stop rather than arriving in the drawing.
const routes = createRoutes();
trains.useRoutes(routes);
netReady.then(net => { if (net) routes.setNet(net); });
const lateness = createLateness();
let stations = new Map();   // signature -> { sig, name, lon, lat, advertised }
const stationName = sig => stations.get(sig)?.name ?? sig;

const minutesOf = r => lateness.get(r.id)?.minutes;
const labelFor = r => label(r.number, minutesOf(r));
// While a train fast-forwards to catch up with its data, its label gets »» (the map's font has no ⏩). A stale train
// (silent for 2 minutes, or no data at all) is drawn grey and faded.
const propsFor = (r, sim) => ({
  label: labelFor(r) + (sim?.syncing && !sim.stale ? ' »»' : ''), late: lateClass(minutesOf(r)), stale: Boolean(sim?.stale),
  company: lateness.brand(r.id) ?? '',
});

// Where a train is drawn in this frame (the camera follows exactly this place).
const placeNow = id => frameById.get(id) ?? trains.placeOf(id, now() - DELAY_MS);
const follow = id => map.follow(() => placeNow(id), () => panel.setFollowing(false));
const panel = createPanel(document.getElementById('panel'), {
  stationName,
  isStarred: number => favourites.has('train', number),
  onStar: number => favourites.toggle('train', number),
  onSelect(id) {
    map.select(id);
    if (!id) { map.unfollow(); map.unpad(); }
    if (shownPath && shownPath.id !== id) { shownPath = null; map.setPath(null); }
  },
  // The open train's whole path, start to finish (Max, 2026-11-12), in one colour (Max, 2026-11-13).
  onRoute(id, route) {
    const places = [];
    for (const s of route.stops) {
      const st = stations.get(s.station);
      if (!st || st.lon === null) continue;
      const last = places[places.length - 1];
      if (last && last.sig === s.station) { last.stop ||= s.advertised; last.actual ||= s.actual; continue; }
      places.push({ sig: s.station, lon: st.lon, lat: st.lat, stop: s.advertised, actual: s.actual });
    }
    if (places.length < 2) return;
    shownPath = { id, path: pathOf(places, net), places };
    map.setPath(shownPath.path);
    if (!trains.get(id)) map.fitPath(shownPath.path);   // not on the map: show all of it
  },
  onFollow(id, on) {
    if (on) follow(id); else map.unfollow();
  },
});
const map = createMap('map', {
  railData: { trv: () => netReady.then(net => { if (!net) throw new Error('no rail network'); return net.toGeoJSON(); }) },
  // The 3D trains are drawn where this frame put them (see frame below), the same places the camera uses.
  getTrains3d: () => frameTrains,
  // Each car of a model sits on the track: a place d metres along a train's track from where it is drawn.
  alongTrack: (id, d) => trains.along(id, d),
  // Tapping a train opens its panel and the camera follows it; tapping the map elsewhere stops following first
  // (Max, 2026-11-13: "a single click unfollows"), and then closes it (a tap that only closed the menu does nothing
  // more).
  onTrainTap(id) {
    if (menu.justClosed) return;
    if (!id && map.following) { map.unfollow(); panel.setFollowing(false); return; }
    if (!openTrain(id)) { panel.close(); board.close(); }
  },
  onStationTap(sig) {
    if (menu.justClosed) return;
    openStation(sig);
  },
  onGroupTap(list) {
    if (menu.justClosed) return;
    showPicker(list);
  },
});

// ---- Several trains close together ("3 trains"): pick one ----
const pickerEl = document.getElementById('picker');
const escHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
function showPicker(list) {
  panel.close();
  board.close();
  const rows = [...list].sort((a, b) => (a.company || '').localeCompare(b.company || '', 'sv') || String(a.label).localeCompare(String(b.label)));
  pickerEl.innerHTML = `<div class="panel-head"><strong>${t('trainsHere', rows.length)}</strong><span class="panel-buttons">` +
    `<button class="panel-close" type="button" aria-label="${t('close')}">×</button></span></div><ul class="pick-list">` +
    rows.map((r, i) => `<li><button type="button" data-i="${i}"><b>${escHtml(r.label)}</b> <span>${escHtml(r.company || t('train'))}</span></button></li>`).join('') + '</ul>';
  pickerEl.hidden = false;
  pickerEl.querySelector('.panel-close').onclick = () => { pickerEl.hidden = true; };
  for (const b of pickerEl.querySelectorAll('[data-i]')) b.onclick = () => { pickerEl.hidden = true; openTrain(rows[Number(b.dataset.i)].id); };
}

// ---- A station's board (where the train panel opens; one of them at a time) ----
const board = createBoard(document.getElementById('board'), {
  load: (sig, activity) => fetchBoard(sig, activity, now(), settings.boardRows),
  stationName,
  onPickTrain: t => pickTrain({ ...t, onMap: Boolean(trains.get(t.id)) }),
  onClose: () => { if (!panel.openId) map.unpad(); },
  isStarred: sig => favourites.has('station', sig),
  onStar: sig => favourites.toggle('station', sig),
});
async function openStation(sig, { go = false } = {}) {
  const st = stations.get(sig);
  if (!st) return;
  if (panel.openId) panel.close();
  map.unfollow();
  await map.pad();   // the station shows above the board
  board.open(st);
  if (go) map.goTo(st, 13);
}

// A train picked in the search or on a board: on the map, fly there and follow it; otherwise its stops.
function pickTrain(t) {
  board.close();
  if (t.onMap && openTrain(t.id, { go: true })) return;
  map.unfollow();
  panel.open({ id: t.id, operational: t.operational, date: t.date, number: t.number, label: String(t.number) }, { follow: false });
}

// Open a train on the map: its panel, and the camera follows it. go: also fly there, zoomed in to the toys.
function openTrain(id, { go = false } = {}) {
  const r = id && trains.get(id);
  if (!r) return false;
  board.close();
  pickerEl.hidden = true;
  panel.open({ id: r.id, operational: r.operational, date: r.date, number: r.number, label: labelFor(r) });
  const following = follow(id);
  const p = go && placeNow(id);
  if (p) following.then(() => map.goTo(p, 13));
  return true;
}


// ---- Help, with the map credits: the ? button next to Tilt ----
// (Max, 2026-11-12: the credit line at start was too intrusive. Fine while the app is private; OpenStreetMap's
// attribution guidelines want the credit seen without a tap, so the public version needs it visible again.)
const helpEl = document.getElementById('help');
function openHelp() { helpEl.hidden = false; helpEl.querySelector('.panel-close').focus(); }
helpEl.querySelector('.panel-close').onclick = () => { helpEl.hidden = true; };
document.getElementById('help-button').onclick = () => (helpEl.hidden ? openHelp() : (helpEl.hidden = true));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { helpEl.hidden = true; settingsPage.hidden = true; } });

// ---- The menu: search for a train number or a station ----
const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();   // "Göteborg" matches "goteborg"
const menu = createMenu({
  button: document.getElementById('menu-button'),
  el: document.getElementById('menu'),
  findTrains: digits => trains.reports()
    .filter(r => String(r.number).startsWith(digits))
    .sort((a, b) => String(a.number).length - String(b.number).length || Number(a.number) - Number(b.number))
    .map(r => ({ id: r.id, operational: r.operational, date: r.date, number: r.number, company: lateness.brand(r.id) })),
  findStations(text) {
    const q = fold(text);
    return [...stations.values()]
      .filter(st => st.advertised && st.lon !== null && fold(st.name).includes(q))
      .sort((a, b) => fold(b.name).startsWith(q) - fold(a.name).startsWith(q) || a.name.localeCompare(b.name, 'sv'));
  },
  async searchTimetable(number) {
    const found = await fetchTrainsByNumber(number, swedishDay(now()));
    return found.map(t => ({ ...t, from: t.from && stationName(t.from), to: t.to && stationName(t.to) }));
  },
  onPickTrain: pickTrain,
  onPickStation: st => openStation(st.sig, { go: true }),
  favourites: () => ({
    trains: favourites.trains.map((number) => {
      const r = trains.reports().find(x => String(x.number) === number);
      return { number, company: r ? lateness.brand(r.id) : null, onMap: Boolean(r) };
    }),
    stations: favourites.stations.map(sig => stations.get(sig)).filter(Boolean),
  }),
  // A starred train: on the map, fly there; otherwise today's run of that number (the next one, or the latest).
  async onPickFavouriteTrain(number) {
    const r = trains.reports().find(x => String(x.number) === number);
    if (r) return pickTrain({ id: r.id, operational: r.operational, date: r.date, number: r.number, onMap: true });
    try {
      const found = await fetchTrainsByNumber(number, swedishDay(now()));
      if (found.length) { const t = found[0]; pickTrain({ id: t.key, operational: t.operational, date: t.date, number: t.number, onMap: false }); }
    } catch (e) { console.warn('favourite:', e.message); }
  },
});

// ---- Drawing: one clock per frame ----
// Each frame every train's simulation is brought to one moment (DELAY_MS ago), once. The camera (following), the
// 3D trains and the selected train's marker all use those same places, and while a train is selected the map is
// drawn in this same frame, so nothing creeps against anything else (the 3D trains used to be placed at a slightly
// later moment than the camera, a stutter on fast trains at close zoom). The dots and labels of the other trains go
// through the map's background worker, as often as a movement can be seen at this zoom (map.trainsEvery: 30 times a
// second close in, once a second far out): only the trains in or near the view (map.nearView), made
// from the places this frame already worked out (every train in Sweden used to be worked through a second time and
// sent, also when five of them were on screen).
let lastDraw = 0;
let frameTrains = [], frameById = new Map();
function frame(ts) {
  const t = now() - DELAY_MS;
  frameTrains = trains.placedAt(t).map(x => ({ ...x, brand: lateness.brand(x.id) }));
  frameById = new Map(frameTrains.map(x => [x.id, x]));
  if (import.meta.env.DEV) window.__last3d = frameTrains;   // what the 3D layer draws (tools/follow-check.mjs)
  if (ts - lastDraw >= map.trainsEvery()) {
    lastDraw = ts;
    const near = map.nearView(), features = [];
    for (const x of frameTrains) {
      const r = near(x.lon, x.lat) && trains.get(x.id);
      if (r) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lon, x.lat] },
        properties: { id: x.id, bearing: x.bearing, ...propsFor(r, x) } });
    }
    map.setTrains({ type: 'FeatureCollection', features });
  }
  map.tick(ts);
  const sel = panel.openId && frameById.get(panel.openId);
  const r = sel && trains.get(sel.id);
  map.setSelectedPlace(sel || null, r ? propsFor(r, sel) : null);
  if (sel) map.drawNow();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- Settings: their own page, from ☰ → Settings (Max, 2026-11-12). Remembered on this phone; every change shows at
// once, without reloading the page (Max: reloading was a bad experience). ----
const settingsPage = document.getElementById('settings-page');
const settingsEl = document.getElementById('settings');
document.getElementById('open-settings').onclick = () => {
  menu.close();
  helpEl.hidden = true;
  settingsPage.hidden = false;
  settingsPage.querySelector('.panel-close').focus();
};
settingsPage.querySelector('.panel-close').onclick = () => { settingsPage.hidden = true; };
// A change (also Look on Auto when the phone switches between light and dark): each part shows it.
onSettingChange((key) => {
  if (key === 'theme' || key === 'trainStyle' || key === 'toyZoom') map.applySettings();
  if (key === 'language') {
    translatePage();
    map.relabel();   // "3 trains" on the map
    menu.refresh();
    panel.relabel();
    board.relabel();
    pickerEl.hidden = true;
  }
  if (key === 'boardRows') board.relabel();
  showSettings();
});
function showSettings() {
  for (const seg of settingsEl.querySelectorAll('.seg'))
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(settings[seg.dataset.key])));
  settingsEl.classList.toggle('real', settings.trainStyle !== 'toy');
  sizeEl.value = settings.toySize;
  sizeOut.textContent = `${settings.toySize} px`;
}
for (const seg of settingsEl.querySelectorAll('.seg')) {
  for (const b of seg.querySelectorAll('button')) b.onclick = () => {
    setSetting(seg.dataset.key, b.dataset.v);
  };
}
const sizeEl = document.getElementById('set-toysize'), sizeOut = document.getElementById('set-toysize-out');
sizeEl.oninput = () => { setSetting('toySize', sizeEl.value); showSettings(); };
showSettings();

// ---- Rail lines: Trafikverket's, always shown ----
map.showRail('trv');

// ---- Live data ----
// How each feed is doing, and its own problem if it has one (one feed's good news must not wipe the other's problem).
const status = { positions: 'starting', passings: 'starting', errors: { positions: null, passings: null } };
const statusError = () => [status.errors.positions, status.errors.passings].filter(Boolean).join(' · ') || null;
// When position data last arrived (this computer's clock). After NO_DATA_MS with nothing, every train brakes to a
// stop and turns grey, and the status line says since when; when data returns they fast-forward to their places.
const NO_DATA_MS = 60 * 1000;
let lastDataAt = null;

// Station passings: the lateness label, each train's delay and last passing, and a train whose GPS is quiet moves
// on to a station it is reported passing.
function onPassings(list) {
  lateness.update(list);
  routes.addPassings(list);
  trains.addPassings(list);
}
const positionHandlers = {
  onRecords(records) {
    lastDataAt = now();
    if (trains.halted) trains.setHalted(false);
    trains.update(records, now());
  },
  onStatus(s) {
    status.positions = s.mode;
    status.errors.positions = s.error ?? null;
    if (s.error) console.warn('positions:', s.error);
  },
};
netReady.then(net => { if (net) trains.useNet(net); }).finally(() => {
  if (!replay) return startTrainSource(positionHandlers);
  // A replay brings its own timetable (planned routes and passings), when the recording has one.
  startReplaySource(replay, { ...positionHandlers, onPlanned: rows => routes.add(rows), onPassings });
});

function gotStations(m) {
  stations = m;
  routes.setStations(new Map([...m].filter(([, st]) => st.lon !== null)));
  map.setStations([...m.values()].filter(st => st.advertised && st.lon !== null));
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
if (hasKey && !replay) {
  followPassings({
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
    const groups = [[again, BACK_MS], [onTime, FIRST_BACK_MS],
      [late, Math.min(MAX_BACK_MS, FIRST_BACK_MS + Math.max(0, ...late.map(lateBy)) * 60000)]];
    for (const [list, back] of groups) {
      if (!list.length) continue;
      try {
        routes.add(await fetchPlannedRoutes([...new Set(list.map(r => r.operational))], t - back, t + 90 * 60000));
      } catch (e) {
        console.warn('planned routes:', e.message);
        for (const r of list) asked.delete(r.id);
      }
    }
  }
  setTimeout(askRoutes, 5000);
  setInterval(askRoutes, 30000);

  // Every 10 minutes the lists let go of trains with nothing newer than 6 hours that are neither on the map nor open
  // in the panel (timetable rows, lateness, company, when its route was asked for). They only ever grew.
  const FORGET_MS = 6 * 3600000;
  setInterval(() => {
    const before = now() - FORGET_MS, keep = key => Boolean(trains.get(key)) || panel.openId === key;
    routes.trim(before, keep);
    lateness.trim(before, keep);
    for (const [key, at] of asked) if (at < before && !keep(key)) asked.delete(key);
  }, 10 * 60000);
}

const modeText = m => t('mode')[m] ?? m;
const statusEl = document.getElementById('status');
const statusFullEl = document.getElementById('status-full');

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
  if (st.mode === 'waiting') return t('waitingBefore', q, stationName(st.waitingFor), passed);
  if (st.mode === 'timetable') return t('byTimetable', q, passed);
  if (st.mode === 'coasted out') return t('stoppedLastSeen', q, passed);
  return '';
}

setInterval(() => {
  const tNow = now();
  const noData = lastDataAt !== null && tNow - lastDataAt > NO_DATA_MS;
  if (noData && !trains.halted) trains.setHalted(true);
  trains.prune(tNow);
  const error = statusError();
  const ago = trains.lastReport ? Math.max(0, Math.round((tNow - trains.lastReport) / 1000)) : null;
  // On the map a short line (the main screen stays clean); the whole line in the menu. A problem shows on both, red.
  const mode = `${modeText(status.positions)}${replay ? ` ${hhmm(tNow)}` : ''}`;
  statusEl.textContent = `${t('trainsCount', trains.count)} · ` +
    (noData ? t('noDataSince', clock(lastDataAt)) : error ?? mode);
  statusFullEl.textContent =
    `${t('trainsCount', trains.count)} · ` +
    (noData ? t('noDataSince', clock(lastDataAt)) : ago === null ? t('noReportYet') : t('lastReport', ago)) +
    ` · ${modeText(status.positions)}` +
    (replay ? t('replayOf', hhmmss(tNow)) : '') +
    (error ? ` · ${error}` : '');
  statusEl.classList.toggle('problem', Boolean(error) || noData);

  // The open train's panel: a short line on how its place is known, when it isn't simply from its GPS.
  if (panel.openId) panel.setStatus(statusLine(trains.stateOf(panel.openId, tNow - DELAY_MS), noData));
}, 1000);
