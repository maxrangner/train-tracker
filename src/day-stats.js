// Today's punctuality per hour, for the stats page's graph (Max, 2026-11-13: "cached and reused", "keep in mind data
// and file sizes; not scientific, just fun stats"). Every arrival at a passenger stop today, kept as
// train number + station -> hour and minutes late. A row Trafikverket changes again replaces its old copy.
//   - Asked for only while the stats page is open: the whole day the first time that day, after that only the rows
//     changed since the last ask (a few kB), again every 5 minutes while the page stays open.
//   - Saved on this phone (localStorage) with the day and the time of the last ask, so opening the app again the
//     same day asks only for what changed. A new day starts empty. If the phone won't save, it lives in memory only.
//   - The hour counts are kept up to date as rows come in: drawing never counts the ~31,000 rows again.
import { fetchDayArrivals } from './trafikverket.js';
import { swedishDay } from './clock.js';
import { lateClass } from './lateness.js';

const STORE = 'dayArrivals';
const EVERY_MS = 5 * 60 * 1000;     // while the page is open
const MARGIN_MS = 5 * 60 * 1000;    // ask a little further back than the last ask (clocks differ; extra rows replace)
const HOURS = 25;                   // a day with the clock turned back has 25
const GROUP = { ontime: 0, some: 1, late: 2 };

// Swedish midnight of moment t (ms). Swedish time is UTC+1 or +2, and the clock never changes at midnight.
function swedishMidnight(t) {
  const day = swedishDay(t);
  const utc = Date.parse(`${day}T00:00:00Z`);
  const h = Number(new Date(utc).toLocaleString('sv-SE', { hour: '2-digit', hour12: false, timeZone: 'Europe/Stockholm' }));
  return utc - h * 3600000;
}

// A row as one number: hour * 10000 + minutes late + 5000 (late kept within ±4999).
const pack = (hour, late) => hour * 10000 + Math.max(-4999, Math.min(4999, late)) + 5000;
const hourOf = v => Math.floor(v / 10000);
const groupOf = v => GROUP[lateClass((v % 10000) - 5000)];

// loadArrivals(midnight, since): the arrivals (src/trafikverket.js fetchDayArrivals with the key; the public page reads the
// fetcher's arrivals files instead, src/main.js filesArrivals).
export function createDayStats({ now, loadArrivals = fetchDayArrivals }) {
  let day = null, midnight = 0;
  let rows = new Map();               // "2042|Cst" -> packed
  let counts = [];                    // per hour: [on time, +3-5, +6 or more]
  let perStation = new Map();         // station signature -> arrivals today (the stats page's busiest stations, today)
  let asOf = null;                    // when the last good ask was sent
  let lastTry = 0, asking = false, failed = false, loaded = false;
  let openedAt = 0;                   // when the stats page last opened (busy: asking for numbers newer than that)

  function reset(d) {
    day = d; midnight = swedishMidnight(now()); rows = new Map(); asOf = null; perStation = new Map();
    counts = Array.from({ length: HOURS }, () => [0, 0, 0]);
  }
  function put(id, v) {
    const old = rows.get(id);
    if (old === v) return;
    if (old !== undefined) counts[hourOf(old)][groupOf(old)]--;
    else { const sig = id.slice(id.indexOf('|') + 1); perStation.set(sig, (perStation.get(sig) ?? 0) + 1); }
    rows.set(id, v);
    counts[hourOf(v)][groupOf(v)]++;
  }

  // Saved as "day\nasOf\nid,packed;id,packed;..." (about 14 characters a row).
  function load() {
    loaded = true;
    reset(swedishDay(now()));
    try {
      const [d, at, list] = (localStorage.getItem(STORE) ?? '').split('\n');
      if (d !== day || !list) return;
      for (const item of list.split(';')) {
        const i = item.lastIndexOf(',');
        const v = Number(item.slice(i + 1));
        if (i > 0 && hourOf(v) < HOURS) put(item.slice(0, i), v);
      }
      asOf = Number(at) || null;
    } catch { /* nothing saved, or the phone won't read it: start empty */ }
  }
  function save() {
    try {
      let list = '';
      for (const [id, v] of rows) list += (list ? ';' : '') + id + ',' + v;
      localStorage.setItem(STORE, `${day}\n${asOf}\n${list}`);
    } catch { /* full or refused: kept in memory only */ }
  }

  async function ask() {
    if (asking) return;
    asking = true;
    const t = now();
    lastTry = t;
    if (swedishDay(t) !== day) reset(swedishDay(t));
    try {
      const list = await loadArrivals(midnight, asOf === null ? null : asOf - MARGIN_MS);
      for (const r of list) {
        const hour = Math.floor((r.actual - midnight) / 3600000);
        if (hour >= 0 && hour < HOURS) put(r.id, pack(hour, Math.round((r.actual - r.planned) / 60000)));
      }
      asOf = t;
      failed = false;
      save();
    } catch (e) {
      failed = true;
      console.warn('today\'s arrivals:', e.message);
    } finally {
      asking = false;
    }
  }

  return {
    // The stats page opened: ask for what changed (or the whole day), unless asked in the last minute.
    open() {
      if (!loaded) load();
      openedAt = now();
      if (now() - lastTry > 60 * 1000) ask();
    },
    // Once a second while the page is open: again every 5 minutes.
    tick() { if (now() - lastTry >= EVERY_MS) ask(); },
    // For drawing: { state: 'loading' | 'failed' | 'ok', hours: counts up to this hour, now: the hour now,
    // stations: Map signature -> arrivals today, busy: asking while what is shown is from before the page opened (the
    // numbers saved earlier today; Max, 2026-11-21: the graph "doesn't indicate loading before appearing") }.
    view() {
      const hourNow = Math.min(HOURS - 1, Math.floor((now() - midnight) / 3600000));
      const state = asOf !== null ? 'ok' : failed ? 'failed' : 'loading';
      return { state, failed, hours: counts.slice(0, hourNow + 1), hourNow, stations: perStation, busy: asking && (asOf === null || asOf < openedAt) };
    },
  };
}
