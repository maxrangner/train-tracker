// The live data: the positions and passings feeds (the fetcher's files on the public page, Trafikverket with the key
// on the dev page, or a recording), the station list, the planned routes, a pause while the page is hidden, and the
// lists let go of old trains. One clock of when data last came (lastDataAt) and one test of "no data".
//
// createFeeds({ mode: { replay, fromFiles, filesBase }, trains, routes, lateness, stats, speedLog, stations, panel,
//   netReady, now, onBatch, wake }) -> { state (each feed's mode and problem), error(), lastDataAt, lastFileAt,
//   noData(t), placed(t), reportOf(id), fileOf(kind), askCancelled(), arrivals(midnight, since), history, nextAt(),
//   tick(t) }
import { startTrainSource } from '../trains-source.js';
import { startFilesSource, filesTapAsker } from '../files-source.js';
import { startReplaySource } from '../replay-source.js';
import { followPassings, fetchStations, fetchPlannedRoutes, fetchCancelledToday, setTapAsker, hasKey } from '../trafikverket.js';
import { swedishDay } from '../clock.js';
import { arrivalsReader } from './arrivals.js';

// Nothing for this long: every train brakes to a stop and turns grey; data back, they fast-forward. Even at night some
// train in Sweden reports at least every 10 s (four night recordings), so a minute is safe.
export const NO_DATA_MS = 60 * 1000;
// Back from the background after this long (a phone froze the page): every train placed where it is now at its next
// report instead of fast-forwarding there, the feeds asked again at once, the "no data" halt a minute from now.
const AWAY_MS = 10 * 1000;
// Every FORGET_EVERY_MS the lists let go of trains with nothing newer than FORGET_MS that are neither on the map nor
// open (timetable rows, lateness, company, when a route was asked for): they only ever grew.
const FORGET_MS = 6 * 3600000, FORGET_EVERY_MS = 10 * 60000;
// The key page's planned routes: trains whose known route ends within ROUTES_AHEAD_MS, at most every ROUTES_AGAIN_MS
// each, asked ROUTES_BACK_MS back; the first time further (FIRST_BACK_MS, as far as the passings go, plus a late train's
// delay, at most MAX_BACK_MS: its ending arrival is then among the rows). As fetcher/ask-routes.mjs does for everyone.
const ROUTES_AHEAD_MS = 30 * 60000, ROUTES_AGAIN_MS = 5 * 60000, ROUTES_BACK_MS = 30 * 60000, FIRST_BACK_MS = 90 * 60000,
  MAX_BACK_MS = 4 * 3600000, ROUTES_LATE_MIN = 15, ROUTES_UNTIL_MS = 90 * 60000;
const STATIONS_RETRY_MS = [5000, 15000], STATIONS_RETRY_LAST_MS = 60000;

export function createFeeds({ mode: { replay, fromFiles, filesBase }, trains, routes, lateness, stats, speedLog, stations, panel, netReady, now, onBatch, wake }) {
  // How each feed is doing, and its own problem (one feed's good news must not wipe the other's problem).
  const state = { positions: 'starting', passings: 'starting', errors: { positions: null, passings: null }, pausedSince: null };
  let lastDataAt = null;   // when position data last came (this computer's clock)
  let lastFileAt = null;   // when the last file came (this phone's clock; the public page)
  let positionsFeed = null, passingsFeed = null;   // (stop functions with .restart)
  if (fromFiles) setTapAsker(filesTapAsker(kind => positionsFeed?.latestNow?.(kind) ?? Promise.resolve(null), now));

  // Trains before the track file: drawn standing at their latest report until it is in (or failed), their reports
  // waiting in `early`; then they go to the simulation in one batch.
  let netIn = false;
  const early = [], earlyAt = new Map();
  const earlyPlaced = () => [...earlyAt.values()].map(r => ({ id: r.id, lon: r.lon, lat: r.lat, bearing: r.bearing ?? 0, syncing: false,
    stale: false, v: 0, extra: 0 }));
  netReady.then((net) => { if (net) trains.useNet(net); }).finally(() => {
    netIn = true;
    if (early.length) trains.update(early.splice(0), now());
    earlyAt.clear();
  });

  // Station passings: the lateness, each train's last passing; a train whose GPS is quiet moves on to a station it passes.
  function onPassings(list) {
    stats.onPassings(list, now());
    lateness.update(list);
    routes.addPassings(list);
    trains.addPassings(list);
  }
  const positionHandlers = {
    onRecords(records) {
      lastDataAt = now();
      onBatch(records.length);
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
      state.positions = s.mode;
      state.errors.positions = s.error ?? null;
      state.pausedSince = s.mode === 'paused' ? s.since ?? lastDataAt : null;
      if (s.error) console.warn('positions:', s.error);
    },
  };
  // Planned rows (from the fetcher's files): the routes, and each train's company.
  function gotPlanned(rows) {
    routes.add(rows);
    for (const row of rows) if (row.brand) lateness.setBrand(row.key, row.brand);
  }
  function gotStations(m) {
    stations.set(m);
    panel.reroute();   // (a card opened before the stations drew its line without them)
  }
  // Asked until it arrives: a failure left the page without names, search, boards and routes until reloaded.
  function loadStations(tries = 0) {
    fetchStations().then(gotStations).catch((e) => {
      console.warn('stations:', e.message);
      setTimeout(() => loadStations(tries + 1), STATIONS_RETRY_MS[tries] ?? STATIONS_RETRY_LAST_MS);
    });
  }

  // The feeds start at once, beside the track file.
  if (fromFiles) {
    positionsFeed = startFilesSource(filesBase, { ...positionHandlers, onPassings, onPlanned: gotPlanned, onStations: gotStations,
      // (when the fetcher last got a report, not when the file came: files keep coming while Trafikverket is silent; an
      // age on the fetcher's own clock, so a phone clock that is off doesn't matter)
      onFile: (fileT, lastRecordAt) => { lastFileAt = Date.now(); lastDataAt = now() - (lastRecordAt ? Math.max(0, fileT - lastRecordAt) : 0); } });
  } else if (!replay) positionsFeed = startTrainSource(positionHandlers);
  else startReplaySource(replay, { ...positionHandlers, onPlanned: rows => routes.add(rows), onPassings });   // (its own timetable, when recorded)

  // The key page: passings, stations and planned routes from Trafikverket.
  const asked = new Map();   // train key -> when its route was last asked for
  if (hasKey && replay) loadStations();
  if (hasKey && !replay && !fromFiles) {
    passingsFeed = followPassings({
      onPassings,
      onStatus(s) {
        state.passings = s.mode;
        state.errors.passings = s.error ?? null;
        if (s.error) console.warn('timetable:', s.error);
      },
    });
    loadStations();
    // Three questions at most: trains asked before, new ones, new ones running late; the first also asks for the company.
    const askRoutes = async () => {
      const t = now();
      const want = trains.reports().filter(r => routes.until(r.id) < t + ROUTES_AHEAD_MS && !(t - (asked.get(r.id) ?? 0) < ROUTES_AGAIN_MS));
      if (!want.length) return;
      const lateBy = r => lateness.get(r.id)?.minutes ?? 0;
      const again = want.filter(r => asked.has(r.id)), first = want.filter(r => !asked.has(r.id));
      const late = first.filter(r => lateBy(r) > ROUTES_LATE_MIN), onTime = first.filter(r => !(lateBy(r) > ROUTES_LATE_MIN));
      for (const r of want) asked.set(r.id, t);
      const groups = [[again, ROUTES_BACK_MS, false], [onTime, FIRST_BACK_MS, true],
        [late, Math.min(MAX_BACK_MS, FIRST_BACK_MS + Math.max(0, ...late.map(lateBy)) * 60000), true]];
      for (const [list, back, withBrand] of groups) {
        if (!list.length) continue;
        try {
          const rows = await fetchPlannedRoutes([...new Set(list.map(r => r.operational))], t - back, t + ROUTES_UNTIL_MS, { withBrand });
          routes.add(rows);
          for (const row of rows) lateness.setBrand(row.key, row.brand);   // (the company, also with no passing lately)
        } catch (e) {
          console.warn('planned routes:', e.message);
          for (const r of list) asked.delete(r.id);
        }
      }
    };
    setTimeout(askRoutes, 5000);
    setInterval(askRoutes, 30000);
  }
  if (!replay) setInterval(() => {
    const before = now() - FORGET_MS, keep = key => Boolean(trains.get(key)) || panel.openId === key;
    routes.trim(before, keep);
    lateness.trim(before, keep);
    for (const [key, at] of asked) if (at < before && !keep(key)) asked.delete(key);
  }, FORGET_EVERY_MS);

  // While hidden the files page asks for nothing; back, it reads at once.
  let hiddenAt = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = now(); positionsFeed?.pause?.(); return; }
    positionsFeed?.resume?.();
    wake();
    if (hiddenAt === null) return;
    const was = hiddenAt;
    hiddenAt = null;
    if (now() - was < AWAY_MS) return;
    trains.resume(was, now());
    if (lastDataAt !== null) lastDataAt = Math.max(lastDataAt, now());
    if (trains.halted) trains.setHalted(false);
    positionsFeed?.restart?.();
    passingsFeed?.restart?.();
  });

  // The newest file of a kind from the fetcher (src/files-source.js); fails until it exists.
  async function fileOf(kind) {
    const f = await positionsFeed?.latest?.(kind);
    if (!f) throw new Error(`no ${kind} file yet`);
    return f;
  }
  const noData = (t = now()) => lastDataAt !== null && t - lastDataAt > NO_DATA_MS;
  return {
    state,
    error: () => [state.errors.positions, state.errors.passings].filter(Boolean).join(' · ') || null,
    get lastDataAt() { return lastDataAt; },
    get lastFileAt() { return lastFileAt; },
    noData,
    placed: t => (netIn ? trains.placedAt(t) : earlyPlaced()),
    reportOf: id => trains.get(id) ?? (netIn ? null : earlyAt.get(id) ?? null),
    fileOf,
    // { count, byBrand (null from a file made before 2026-11-21), day }
    askCancelled: () => (fromFiles ? fileOf('stats').then(f => ({ count: f.cancelled, byBrand: Array.isArray(f.cancelledBy) ? Object.fromEntries(f.cancelledBy) : null, day: f.day ?? null }))
      : fetchCancelledToday(swedishDay(now()))),
    arrivals: arrivalsReader(fileOf, now),   // (today's arrivals from the files: src/live/arrivals.js)
    get history() { return positionsFeed?.history ? (a, b) => positionsFeed.history(a, b) : null; },
    nextAt: () => positionsFeed?.nextAt?.() ?? null,
    // Each second: no data for a minute, every train brakes; trains gone are let go of.
    tick(t) {
      if (noData(t) && !trains.halted) trains.setHalted(true);
      trains.prune(t);
    },
  };
}
