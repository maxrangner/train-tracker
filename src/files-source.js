// The public page's data: the fetcher's files (public-plan step 3; fetcher/files.mjs makes them, src/live-file.js is
// their format), from one.com (or the fetcher's own --serve on this computer for tests). No key, no Trafikverket.
//   - Every 5 s the newest finished live file (live-<slot>.json, slot = time / 5 s): every train's latest position,
//     the passings of the last 30 s, how the fetcher's two streams are doing, and the names of the other files.
//   - On opening, and when files were missed for more than 30 s (a sleeping phone, lost signal): the passings of the
//     last 90 minutes (the passings file + the newest passings-add), so no train misses its lateness or its stops.
//   - The planned routes (planned + planned-add), the stations (once a day), and on request the disruptions, today's
//     cancelled trains and today's arrivals (each the newest file the live file names).
//   - The phone's clock: file names come from the time, so a clock a few seconds off would ask for files that don't
//     exist yet. Each file says when it was made; the difference is learnt from them and the page's clock set by it.
// Codex's beta review (2026-11-18), fixed here: a file that failed is asked again (point 5: a 404 was kept for good,
// so a missed stations file left the page without names until the next day); every request has a time limit and
// the supporting files never hold up the next live file; when no live file is found (home down) the page asks less
// and less often, not 24 names every 5 s (point 6); paused while the page is hidden (pause/resume); a live file in a
// format newer than this page knows is not read (status 'outdated', TODO 26); the time of the fetcher's last position
// report goes to onFile, so "no data" means no reports, not no files (point 7).
// Handlers as startTrainSource / startReplaySource: onRecords(records), onStatus({ mode, error }), onPassings(list),
// onPlanned(rows), plus onStations(Map) and onFile(fileTime, lastRecordAt) (a file came, even with no new reports;
// lastRecordAt: when the fetcher last got a position report, on its clock, or null from fetchers before 0.6.0).
import { trainOf, passingOf, plannedOf, LIVE_MS, FORMAT } from './live-file.js';
import { setClock } from './clock.js';
import { groupOf, withChanges } from './tap-files.js';

const READ_AT_MS = 2000;      // ask this long into each 5-s slot (the fetcher makes it at +0.05 s, uploads in ~0.5 s)
const GAP_MS = 30 * 1000;     // files missed for longer: read the passings files again
const PAUSED_MS = 30 * 1000;  // no new file for longer: "live data paused since …"
const KEEP_SEEN_MS = 3 * 3600 * 1000;
const ASK_MS = 15000;         // a request's time limit
const RETRY_MS = 30000;       // a file that failed is asked again after this, doubling each time up to RETRY_MAX_MS
const RETRY_MAX_MS = 5 * 60000;
const MISS_WAITS = [10000, 20000, 30000];   // nothing found: wait this long before looking again (then 30 s)
const FAR_EVERY = 4;          // while nothing is found, every 4th look goes 24 names back (a clock far off)

export function startFilesSource(base, { onRecords, onStatus, onPassings, onPlanned, onStations, onFile }) {
  base = base.replace(/\/?$/, '/');
  let names = {};               // kind -> newest file name (from the live file)
  const loaded = {};            // kind -> the name taken in last (planned, planned-add, stations)
  const cache = new Map();      // file name -> promise of its contents (names never change content); only files that came
  const failed = new Map();     // file name -> { tries, at }: not there or not read; asked again after a growing wait
  const loading = {};           // 'passings' | 'planned' | 'stations' -> its promise while it is being taken in
  const trainSeen = new Map();  // train id -> time of its newest report taken in
  const passSeen = new Map();   // passing key|station|activity|time -> its time
  let lastFile = null;          // the newest live file taken in: { t, at (this computer's clock) }
  let skew = 0;                 // the fetcher's clock minus this computer's (learnt from the files)
  const skewSamples = [];
  let needPassings = false, timer = null, stopped = false, paused = false, mode = 'starting', lastError = null, busy = false;
  let misses = 0;               // looks in a row that found no live file while none had come for 20 s

  const status = (m, error = null) => {
    if (m === mode && error === lastError) return;
    mode = m; lastError = error;
    onStatus({ mode: m, error, since: lastFile?.t ?? null });
  };
  const ask = name => fetch(base + name, { signal: AbortSignal.timeout(ASK_MS) });
  const fail = name => {
    const f = failed.get(name) ?? { tries: 0, at: 0 };
    failed.set(name, { tries: f.tries + 1, at: Date.now() });
  };
  // One file by name (null: not there, or asked again too soon after failing). Only what came is kept.
  function get(name) {
    if (cache.has(name)) return cache.get(name);
    const f = failed.get(name);
    if (f && Date.now() - f.at < Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (f.tries - 1))) return Promise.resolve(null);
    const p = ask(name).then((r) => {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${name}: ${r.status}`);
      return r.json();
    }).then((v) => {
      if (v === null) { cache.delete(name); fail(name); return null; }
      failed.delete(name);
      return v;
    }, (e) => { cache.delete(name); fail(name); throw e; });
    cache.set(name, p);
    if (cache.size > 400) cache.delete(cache.keys().next().value);
    return p;
  }
  // The newest of a kind the live file names (null: not made yet, or not there now).
  const latest = kind => (names[kind] ? get(names[kind]) : Promise.resolve(null));

  // One live file, fetched without the cache (a 404 may exist a second later).
  async function live(slot) {
    const r = await ask(`live-${slot}.json`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`live file: ${r.status}`);
    return r.json();
  }

  function learnClock(fileT) {
    // A file is typically read ~2.3 s after it was made: the fetcher's clock now is about fileT + 2.3 s.
    skewSamples.push(fileT + 2300 - Date.now());
    if (skewSamples.length > 9) skewSamples.shift();
    const s = [...skewSamples].sort((a, b) => a - b)[skewSamples.length >> 1];
    // The page's clock follows only a clear difference (more than 3 s, from at least three files): a clock moved back
    // and forth would make the trains jump.
    if (skewSamples.length >= 3 && Math.abs(s - skew) > 3000) {
      skew = s;
      setClock(Date.now() + skew);
    }
  }

  // The passings of the last 90 minutes: the newest passings file and, when the live file names one, the newest -add.
  // needPassings is cleared only when every file named was read (one that failed is tried again with the next file).
  async function takePassings() {
    const lists = [];
    for (const kind of ['passings', 'passings-add']) {
      if (!names[kind]) continue;
      let f = null;
      try { f = await latest(kind); } catch (e) { console.warn('passings file:', e.message); }
      if (!f) return;
      lists.push(f.passings);
    }
    needPassings = false;
    const out = [];
    for (const rows of lists) for (const row of rows) addPassing(passingOf(row), out);
    if (out.length) onPassings?.(out);
  }
  function addPassing(p, out) {
    const k = `${p.key}|${p.station}|${p.activity}|${p.time}`;
    if (passSeen.has(k)) return;
    passSeen.set(k, p.time);
    out.push(p);
  }
  async function takePlanned() {
    for (const kind of ['planned', 'planned-add']) {
      const name = names[kind];
      if (!name || loaded[kind] === name) continue;
      try {
        const f = await get(name);
        if (!f) continue;   // not there now: asked again later (get's wait)
        loaded[kind] = name;
        onPlanned?.(f.rows.map(row => plannedOf(row, f.brands)));
      } catch (e) { console.warn('planned file:', e.message); }
    }
  }
  async function takeStations() {
    const name = names.stations;
    if (!name || loaded.stations === name) return;
    try {
      const f = await get(name);
      if (!f) return;
      loaded.stations = name;
      onStations?.(new Map(f.stations.map(st => [st.sig, st])));
    } catch (e) { console.warn('stations file:', e.message); }
  }
  // Each kind at most once at a time, and never awaited by the live file's reading.
  function once(kind, fn) {
    if (loading[kind]) return;
    loading[kind] = fn().finally(() => { loading[kind] = null; });
  }

  function take(file) {
    // A format newer than this page knows: not read (its rows could mean other things); the page asks to be updated.
    if ((file.v ?? 1) > FORMAT) { status('outdated', `files in format ${file.v}, this page reads ${FORMAT}`); return false; }
    const gap = lastFile ? file.t - lastFile.t : Infinity;
    lastFile = { t: file.t, at: Date.now() };
    learnClock(file.t);
    names = file.files ?? {};
    const records = [];
    for (const row of file.trains) {
      const r = trainOf(row, file.t);
      const had = trainSeen.get(r.id);
      if (had !== undefined && r.time <= had) continue;
      trainSeen.set(r.id, r.time);
      records.push(r);
    }
    if (records.length) onRecords(records);
    onFile?.(file.t, file.feeds?.lastRecordAt ?? null);
    const fresh = [];
    for (const row of file.passings) addPassing(passingOf(row), fresh);
    if (fresh.length) onPassings?.(fresh);
    const m = file.feeds?.positions ?? 'stream';
    status(m === 'starting' ? 'starting' : m);
    // The first file, or back after missing some: the passings of the last 90 minutes. Until the fetcher has made its
    // passings file (it was just started too), asked again with each live file.
    if (gap > GAP_MS) needPassings = true;
    if (needPassings && names.passings) once('passings', takePassings);
    once('planned', takePlanned);
    once('stations', takeStations);
    return true;
  }

  async function tick() {
    if (busy || stopped || paused) return;
    busy = true;
    let found = false;
    try {
      const at = Date.now() + skew;
      const slot = Math.floor((at - 1500) / LIVE_MS);
      let file = null;
      // The newest finished file; on a 404 one and two slots back. With nothing for a while (a clock far off, or a
      // long break): up to two minutes back on the first look and every FAR_EVERY-th after, 3 names between.
      const lost = !lastFile || Date.now() - lastFile.at > 20000;
      const back = lost && misses % FAR_EVERY === 0 ? 24 : 3;
      for (let k = 0; k < back && !file; k++) file = await live(slot - k);
      found = Boolean(file);
      if (file && (!lastFile || file.t > lastFile.t)) take(file);
      if (mode === 'outdated') return;
      if (lastFile && Date.now() - lastFile.at > PAUSED_MS) status('paused');
      else if (!lastFile && Date.now() - startedAt > PAUSED_MS) status('paused', 'no live file found');
    } catch (e) {
      console.warn('files:', e.message);
      if (!lastFile || Date.now() - lastFile.at > PAUSED_MS) status('paused', e.message);
    } finally {
      busy = false;
      misses = found || !(!lastFile || Date.now() - lastFile.at > 20000) ? 0 : misses + 1;
    }
    // Forget what is long past (the lists only grew; train ids carry their day, so an old one never comes back).
    const old = Date.now() + skew - KEEP_SEEN_MS;
    if (passSeen.size > 20000) for (const [k, t] of passSeen) if (t < old) passSeen.delete(k);
    if (trainSeen.size > 2000) for (const [k, t] of trainSeen) if (t < old) trainSeen.delete(k);
  }
  function schedule() {
    if (stopped || paused) return;
    clearTimeout(timer);
    let wait;
    if (misses) wait = MISS_WAITS[Math.min(misses, MISS_WAITS.length) - 1] * (0.85 + 0.3 * Math.random());
    else {
      const at = Date.now() + skew;
      wait = (LIVE_MS - (at % LIVE_MS) + READ_AT_MS) % LIVE_MS || LIVE_MS;
    }
    timer = setTimeout(async () => { await tick(); schedule(); }, wait);
  }

  const startedAt = Date.now();
  onStatus({ mode: 'starting' });
  tick().then(schedule);

  const stop = () => { stopped = true; clearTimeout(timer); };
  // Back from the background: read at once (missed passings come with the next file, when the gap was over 30 s).
  stop.restart = () => { if (!paused) tick(); };
  // Hidden (another app in front, the phone locked): no requests at all; back: one read at once, then the usual pace.
  stop.pause = () => { paused = true; clearTimeout(timer); };
  stop.resume = () => {
    if (!paused || stopped) return;
    paused = false;
    misses = 0;
    tick().then(schedule);
  };
  stop.latest = latest;
  stop.pausedSince = () => (mode === 'paused' ? lastFile?.t ?? null : null);
  // For tools/files-check.mjs: how much the reader keeps.
  stop.sizes = () => ({ cache: cache.size, failed: failed.size, trainSeen: trainSeen.size, passSeen: passSeen.size });
  return stop;
}

// Taps from the fetcher's files (plan step 4, 2026-11-17; src/tap-files.js, fetcher/timetable.mjs): the same four
// questions as src/trafikverket.js asks Trafikverket, answered from the newest files the live file names, in
// Trafikverket's own answer shape, so the card, board, search and messages read them as before. asOf: when the
// answer's newest file was made (the card and board say "updated" when it is older than 2 minutes).
// latest(kind) -> Promise of the newest file of that kind (null: none yet); at() -> the page's clock.
const byPlanned = (a, b) => Date.parse(a.AdvertisedTimeAtLocation) - Date.parse(b.AdvertisedTimeAtLocation);
export function filesTapAsker(latest, at) {
  const need = async kind => {
    const f = await latest(kind);
    if (!f) throw new Error('the timetable is not ready yet; try again in a minute');
    return f;
  };
  return async (kind, p) => {
    const now = at();
    if (kind === 'messages') {
      const f = await need('messages');
      return { asOf: f.t, TrainStationMessage: f.messages.filter(m => m[0] === p.sig && (!m[2] || Date.parse(m[2]) < now) && (!m[3] || Date.parse(m[3]) > now))
        .map(m => ({ LocationCode: m[0], FreeText: m[1], StartDateTime: m[2], EndDateTime: m[3], Status: m[4] })) };
    }
    const add = await latest('taps-add');
    if (kind === 'board') {
      // Every row of the station from 90 minutes back: fetchBoard (src/trafikverket.js) drops the trains that are gone
      // and then takes the next n. (Cut to n × 4 here first, a busy station's board could come out empty: Codex's beta
      // review point 2; Malmö C at midday 2026-11-18 showed 8 of 12, and 0 with the board set to 8 or 4 rows.)
      const g = await need(`board-${groupOf(p.sig)}`), act = p.act === 'Avgang' ? 'D' : 'A';
      const rows = withChanges(g, add, r => r[3] === p.sig && r[4] === act)
        .filter(a => a.Advertised && !a.Deleted && Date.parse(a.AdvertisedTimeAtLocation) > now - 90 * 60000).sort(byPlanned);
      return { asOf: add?.t ?? g.t, TrainAnnouncement: rows };
    }
    // route (by public or internal number) and train (the number search): the train's group, by its public number
    // (an internal number finds it in the index).
    const day = p.date ?? p.day;
    let number = kind === 'train' || p.by === 'number' ? String(p.number ?? p.value) : null, op = number ? null : String(p.value);
    const groupKey = number ?? (await latest('taps-index'))?.ops?.[op] ?? op;
    const g = await need(`card-${groupOf(groupKey)}`);
    const rows = withChanges(g, add, (r, f) => (number ? r[1] === number : r[0] === op) && String(f.d[r[2]] ?? '').slice(0, 10) === day).sort(byPlanned);
    return { asOf: add?.t ?? g.t, TrainAnnouncement: rows };
  };
}
