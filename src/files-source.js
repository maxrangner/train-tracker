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
// Handlers as startTrainSource / startReplaySource: onRecords(records), onStatus({ mode, error }), onPassings(list),
// onPlanned(rows), plus onStations(Map) and onFile(fileTime) (fresh data came, even with no new reports).
import { trainOf, passingOf, plannedOf, LIVE_MS } from './live-file.js';
import { setClock } from './clock.js';

const READ_AT_MS = 2000;      // ask this long into each 5-s slot (the fetcher makes it at +0.05 s, uploads in ~0.5 s)
const GAP_MS = 30 * 1000;     // files missed for longer: read the passings files again
const PAUSED_MS = 30 * 1000;  // no new file for longer: "live data paused since …"
const KEEP_SEEN_MS = 3 * 3600 * 1000;

export function startFilesSource(base, { onRecords, onStatus, onPassings, onPlanned, onStations, onFile }) {
  base = base.replace(/\/?$/, '/');
  let names = {};               // kind -> newest file name (from the live file)
  const loaded = {};            // kind -> the name taken in last (planned, planned-add, stations)
  const cache = new Map();      // file name -> promise of its contents (names never change content)
  const trainSeen = new Map();  // train id -> time of its newest report taken in
  const passSeen = new Map();   // passing key|station|activity|time -> its time
  let lastFile = null;          // the newest live file taken in: { t, at (this computer's clock) }
  let skew = 0;                 // the fetcher's clock minus this computer's (learnt from the files)
  const skewSamples = [];
  let needPassings = false, timer = null, stopped = false, mode = 'starting', lastError = null, busy = false;

  const status = (m, error = null) => {
    if (m === mode && error === lastError) return;
    mode = m; lastError = error;
    onStatus({ mode: m, error, since: lastFile?.t ?? null });
  };
  async function get(name) {
    if (!cache.has(name)) {
      cache.set(name, fetch(base + name).then((r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`${name}: ${r.status}`);
        return r.json();
      }).catch((e) => { cache.delete(name); throw e; }));
      if (cache.size > 400) cache.delete(cache.keys().next().value);
    }
    return cache.get(name);
  }
  // The newest of a kind the live file names (null: not made yet).
  const latest = kind => (names[kind] ? get(names[kind]) : Promise.resolve(null));

  // One live file, fetched without the cache (a 404 may exist a second later).
  async function live(slot) {
    const r = await fetch(`${base}live-${slot}.json`);
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

  async function takePassings() {
    const lists = [];
    for (const kind of ['passings', 'passings-add']) {
      try { const f = await latest(kind); if (f) lists.push(f.passings); } catch (e) { console.warn('passings file:', e.message); }
    }
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
      if (!names[kind] || loaded[kind] === names[kind]) continue;
      try {
        const f = await get(names[kind]);
        loaded[kind] = names[kind];
        if (f) onPlanned?.(f.rows.map(row => plannedOf(row, f.brands)));
      } catch (e) { console.warn('planned file:', e.message); }
    }
  }
  async function takeStations() {
    if (!names.stations || loaded.stations === names.stations) return;
    try {
      const f = await get(names.stations);
      if (!f) return;
      loaded.stations = names.stations;
      onStations?.(new Map(f.stations.map(st => [st.sig, st])));
    } catch (e) { console.warn('stations file:', e.message); }
  }

  async function take(file) {
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
    onFile?.(file.t);
    const fresh = [];
    for (const row of file.passings) addPassing(passingOf(row), fresh);
    if (fresh.length) onPassings?.(fresh);
    const m = file.feeds?.positions ?? 'stream';
    status(m === 'starting' ? 'starting' : m);
    // The first file, or back after missing some: the passings of the last 90 minutes. Until the fetcher has made its
    // passings file (it was just started too), asked again with each live file.
    if (gap > GAP_MS) needPassings = true;
    if (needPassings && names.passings) { needPassings = false; await takePassings(); }
    await takePlanned();
    await takeStations();
  }

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const at = Date.now() + skew;
      const slot = Math.floor((at - 1500) / LIVE_MS);
      let file = null;
      // The newest finished file; on a 404 one and two slots back. With nothing for a while (a clock far off, or a
      // long break) up to two minutes back, to find any file and learn the clock from it.
      const back = !lastFile || Date.now() - lastFile.at > 20000 ? 24 : 3;
      for (let k = 0; k < back && !file; k++) file = await live(slot - k);
      if (file && (!lastFile || file.t > lastFile.t)) await take(file);
      if (lastFile && Date.now() - lastFile.at > PAUSED_MS) status('paused');
      else if (!lastFile && Date.now() - startedAt > PAUSED_MS) status('paused', 'no live file found');
    } catch (e) {
      console.warn('files:', e.message);
      if (!lastFile || Date.now() - lastFile.at > PAUSED_MS) status('paused', e.message);
    } finally { busy = false; }
    // Forget what is long past (the lists only grew).
    const old = Date.now() + skew - KEEP_SEEN_MS;
    if (passSeen.size > 20000) for (const [k, t] of passSeen) if (t < old) passSeen.delete(k);
  }
  function schedule() {
    if (stopped) return;
    const at = Date.now() + skew;
    const wait = LIVE_MS - (at % LIVE_MS) + READ_AT_MS;
    timer = setTimeout(async () => { await tick(); schedule(); }, wait % LIVE_MS || LIVE_MS);
  }

  const startedAt = Date.now();
  onStatus({ mode: 'starting' });
  tick().then(schedule);

  const stop = () => { stopped = true; clearTimeout(timer); };
  // Back from the background: read at once (missed passings come with the next file, when the gap was over 30 s).
  stop.restart = () => { tick(); };
  stop.latest = latest;
  stop.pausedSince = () => (mode === 'paused' ? lastFile?.t ?? null : null);
  return stop;
}

// Taps through the small script on one.com (php/ask.php): the same four questions, kept 30 s there for everyone.
// The answer is Trafikverket's own, so src/trafikverket.js reads it as before. "busy" (503): once more after 2 s.
export function tapAsker(url) {
  return async (kind, params) => {
    const q = new URLSearchParams({ q: kind, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    for (let i = 0; ; i++) {
      const r = await fetch(`${url}?${q}`);
      if (r.status === 503 && i === 0) { await new Promise(res => setTimeout(res, 2000)); continue; }
      const body = await r.json().catch(() => null);
      if (!r.ok || !body || body.error) throw new Error(`ask.php ${kind}: ${body?.error ?? r.status}`);
      return body;
    }
  };
}
