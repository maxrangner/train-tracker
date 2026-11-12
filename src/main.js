import { startTrainSource } from './trains-source.js';
import { createTrains, DELAY_MS } from './trains.js';
import { createLateness, label, lateClass } from './lateness.js';
import { createMap, RAIL_SOURCES } from './map.js';
import { createPanel } from './panel.js';
import { createMenu } from './menu.js';
import { followPassings, fetchStations, fetchPlannedRoutes, fetchTrainsByNumber, hasKey } from './trafikverket.js';
import { loadNet } from './rail-net.js';
import { createRoutes } from './routes.js';
import { now } from './clock.js';
import { startReplaySource } from './replay-source.js';

// #replay=<name> in the address plays a recording (data/positions-<name>.jsonl, from tools/collect.mjs) instead of
// the live data, e.g. #view=11/59.33/18.06&replay=2026-11-11T16-46-20-921Z. The page's clock then runs from the
// recording's start (src/clock.js).
const replay = new URLSearchParams(location.hash.slice(1)).get('replay');

window.__started = true;   // index.html reports it on screen if this line is never reached
// The rail network: the tracks the trains follow, and Trafikverket's rail lines on the map. Positions start once it
// has loaded (or failed: then trains move in straight lines between reports).
const netReady = loadNet('/rail-net.json').catch((e) => {
  console.warn(`rail network: ${e.message} (run node tools/rail-net.mjs)`);
  return null;
});
const trains = createTrains();
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
  onSelect(id) {
    map.select(id);
    if (!id) { map.unfollow(); map.unpad(); }
  },
  onFollow(id, on) {
    if (on) follow(id); else map.unfollow();
  },
});
const map = createMap('map', {
  railData: { trv: () => netReady.then(net => { if (!net) throw new Error('no rail network'); return net.toGeoJSON(); }) },
  // The 3D trains are drawn where this frame put them (see frame below), the same places the camera uses.
  getTrains3d: () => frameTrains,
  // Tapping a train opens its panel and the camera follows it; tapping the map elsewhere closes it (a tap that only
  // closed the menu does nothing more).
  onTrainTap(id) {
    if (menu.justClosed) return;
    if (!openTrain(id)) panel.close();
  },
});

// Open a train on the map: its panel, and the camera follows it. go: also fly there, zoomed in to the toys.
function openTrain(id, { go = false } = {}) {
  const r = id && trains.get(id);
  if (!r) return false;
  panel.open({ id: r.id, operational: r.operational, date: r.date, label: labelFor(r) });
  const following = follow(id);
  const p = go && placeNow(id);
  if (p) following.then(() => map.goTo(p, 13));
  return true;
}

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
    const found = await fetchTrainsByNumber(number, new Date(now()).toLocaleDateString('sv-SE'));
    return found.map(t => ({ ...t, from: t.from && stationName(t.from), to: t.to && stationName(t.to) }));
  },
  onPickTrain(t) {
    if (t.onMap && openTrain(t.id, { go: true })) return;
    // Not on the map (not started yet, or done): its stops in the panel.
    map.unfollow();
    panel.open({ id: t.id, operational: t.operational, date: t.date, label: String(t.number) }, { follow: false });
  },
  async onPickStation(st) {
    if (panel.openId) panel.close();
    map.unfollow();
    await map.unpad();
    map.goTo(st, 13);
  },
});

// ---- Drawing: one clock per frame ----
// Each frame every train's simulation is brought to one moment (DELAY_MS ago), once. The camera (following), the
// 3D trains and the selected train's marker all use those same places, and while a train is selected the map is
// drawn in this same frame, so nothing creeps against anything else (the 3D trains used to be placed at a slightly
// later moment than the camera, a stutter on fast trains at close zoom). The dots and labels of the other trains go
// through the map's background worker, 30 times a second.
let lastDraw = 0;
let frameTrains = [], frameById = new Map();
function frame(ts) {
  const t = now() - DELAY_MS;
  frameTrains = trains.placedAt(t).map(x => ({ ...x, brand: lateness.brand(x.id) }));
  frameById = new Map(frameTrains.map(x => [x.id, x]));
  if (import.meta.env.DEV) window.__last3d = frameTrains;   // what the 3D layer draws (tools/follow-check.mjs)
  if (ts - lastDraw >= 33) {
    lastDraw = ts;
    map.setTrains(trains.toGeoJSON(t, propsFor));
  }
  map.tick(ts);
  const sel = panel.openId && frameById.get(panel.openId);
  const r = sel && trains.get(sel.id);
  map.setSelectedPlace(sel || null, r ? propsFor(r, sel) : null);
  if (sel) map.drawNow();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- Rail line switch (step 2): Trafikverket / OpenStreetMap / none ----
const railEl = document.getElementById('rail');
const RAIL_CHOICES = [...Object.entries(RAIL_SOURCES).map(([id, s]) => [id, s.name]), [null, 'No lines']];
function chooseRail(id) {
  map.showRail(id);
  for (const b of railEl.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.id === String(id)));
  try { localStorage.setItem('rail', String(id)); } catch { /* storage may be blocked */ }
}
for (const [id, name] of RAIL_CHOICES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.id = String(id);
  b.textContent = name;
  b.onclick = () => chooseRail(id);
  railEl.append(b);
}
let savedRail = 'trv';
try { savedRail = localStorage.getItem('rail') ?? 'trv'; } catch { /* default */ }
chooseRail(savedRail === 'null' ? null : savedRail in RAIL_SOURCES ? savedRail : 'trv');

// ---- Tilt button ----
const tiltEl = document.getElementById('tilt');
const showTilt = () => tiltEl.setAttribute('aria-pressed', String(map.tilted));
tiltEl.onclick = () => map.toggleTilt();
map.onViewChange(showTilt);
map.ready.then(showTilt);

// ---- Live data ----
const status = { positions: 'starting', passings: 'starting', error: null };
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
    status.error = s.error ?? null;
    if (s.error) console.warn('positions:', s.error);
  },
};
netReady.then(net => { if (net) trains.useNet(net); }).finally(() => {
  if (!replay) return startTrainSource(positionHandlers);
  // A replay brings its own timetable (planned routes and passings), when the recording has one.
  startReplaySource(replay, { ...positionHandlers, onPlanned: rows => routes.add(rows), onPassings });
});

if (hasKey && replay) {
  fetchStations().then((m) => {
    stations = m;
    routes.setStations(new Map([...m].filter(([, st]) => st.lon !== null)));
  }).catch(e => console.warn('stations:', e.message));
}
if (hasKey && !replay) {
  followPassings({
    onPassings,
    onStatus(s) {
      status.passings = s.mode;
      if (s.error) { status.error = s.error; console.warn('timetable:', s.error); }
    },
  });
  fetchStations().then((m) => {
    stations = m;
    routes.setStations(new Map([...m].filter(([, st]) => st.lon !== null)));
  }).catch(e => console.warn('stations:', e.message));

  // Planned routes: asked for trains on the map whose known route ends within 30 minutes (or isn't known), at most
  // every 5 minutes per train; each answer covers 30 minutes back to 90 minutes ahead.
  const asked = new Map();   // train key -> when its route was last asked for
  async function askRoutes() {
    const t = now();
    const want = trains.reports().filter(r => routes.until(r.id) < t + 30 * 60000 && !(t - (asked.get(r.id) ?? 0) < 5 * 60000));
    if (!want.length) return;
    for (const r of want) asked.set(r.id, t);
    try {
      routes.add(await fetchPlannedRoutes([...new Set(want.map(r => r.operational))], t - 30 * 60000, t + 90 * 60000));
    } catch (e) {
      console.warn('planned routes:', e.message);
      for (const r of want) asked.delete(r.id);
    }
  }
  setTimeout(askRoutes, 5000);
  setInterval(askRoutes, 30000);
}

const MODE_TEXT = { starting: 'connecting', stream: 'live', reconnecting: 'reconnecting', polling: 'every 10 s', stopped: 'stopped',
  replay: 'replay' };
const statusEl = document.getElementById('status');
const statusFullEl = document.getElementById('status-full');

const clock = t => new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
const mins = sec => `${Math.max(1, Math.floor(sec / 60))} min`;

// The panel line for a train's state (trains.stateOf): '' when it simply follows its GPS.
function statusLine(st, noData) {
  if (!st) return 'No longer on the map (nothing from it for 15 minutes).';
  if (noData) return `No data from Trafikverket since ${clock(lastDataAt)}.`;
  if (st.syncing) return 'Catching up with its latest report (fast-forward).';
  const quiet = st.gpsSilentFor >= 60 ? `No GPS for ${mins(st.gpsSilentFor)}` : null;
  const passed = st.lastPassing && st.lastPassing.time > now() - 3 * 3600000
    ? ` · last passed ${stationName(st.lastPassing.sig)} ${clock(st.lastPassing.time)}` : '';
  if (st.stale) return `Nothing from this train for ${mins(st.silentFor)}; shown where it was last known.`;
  if (st.mode === 'stood') return quiet ? `${quiet} · it stood still before it went quiet${passed}` : '';
  if (st.mode === 'waiting' && st.lastPassing?.sig === st.waitingFor && st.lastPassing.activity === 'Ankomst')
    return `${quiet ?? 'No new position'} · at ${stationName(st.waitingFor)} (arrived ${clock(st.lastPassing.time)})`;
  if (st.mode === 'waiting') return `${quiet ?? 'No new position'} · waiting before ${stationName(st.waitingFor)} until it is confirmed${passed}`;
  if (st.mode === 'timetable') return `${quiet ?? 'No new position'} · moving by its timetable${passed}`;
  if (st.mode === 'coasted out') return `${quiet ?? 'No new position'} · stopped where it was last seen${passed}`;
  return '';
}

setInterval(() => {
  const t = now();
  const noData = lastDataAt !== null && t - lastDataAt > NO_DATA_MS;
  if (noData && !trains.halted) trains.setHalted(true);
  trains.prune(t);
  const ago = trains.lastReport ? Math.max(0, Math.round((t - trains.lastReport) / 1000)) : null;
  // On the map a short line (the main screen stays clean); the whole line in the menu. A problem shows on both, red.
  const mode = `${MODE_TEXT[status.positions] ?? status.positions}${replay ? ` ${new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}` : ''}`;
  statusEl.textContent = `${trains.count} trains · ` +
    (noData ? `no data since ${clock(lastDataAt)}` : status.error ? status.error : mode);
  statusFullEl.textContent =
    `${trains.count} trains · ` +
    (noData ? `no data since ${clock(lastDataAt)}` : ago === null ? 'no report yet' : `last report ${ago} s ago`) +
    ` · ${MODE_TEXT[status.positions] ?? status.positions}` +
    (replay ? ` of ${new Date(t).toLocaleTimeString('sv-SE')}` : '') +
    (status.error ? ` · ${status.error}` : '');
  statusEl.classList.toggle('problem', Boolean(status.error) || noData);

  // The open train's panel: a short line on how its place is known, when it isn't simply from its GPS.
  if (panel.openId) panel.setStatus(statusLine(trains.stateOf(panel.openId, t - DELAY_MS), noData));
}, 1000);
