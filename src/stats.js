// The stats page's numbers: live, from what the page already has (Max, 2026-11-13: tap the "N trains · live" banner).
// Collected all the time, because they are cheap: the distance driven and the fastest train since the page opened
// (one pass over the drawn trains a second), how many positions arrive and how old they are, and the last 15 minutes
// of station passings. Everything else is worked out only while the page is open, once a second (snapshot). The page
// itself (what it looks like, what moves, what a tap does) is src/stats-page.js.
import { lateClass } from './lateness.js';
import { styleFor } from './brands.js';
import { STAND_MS } from './trains.js';
import { swedishDay } from './clock.js';
import { KINDS, kindOf } from './train-kinds.js';

const RATE_MS = 60 * 1000;          // positions per second and their age: over the last minute
const BUSY_MS = 15 * 60 * 1000;     // busiest station: trains passing in the last 15 minutes
const NEAR_KM = 50;                 // "near" a station only when one is this close
// Fastest today: each train's highest reported speed today, while the app was open on this phone (Trafikverket keeps
// only the latest position, so the day can't be asked for). Kept on the phone for the day: the FAST_KEEP fastest.
const FAST_STORE = 'dayFastest', FAST_KEEP = 20, FAST_SAVE_MS = 30 * 1000;

const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

// A company's colour for its bar: the most colourful part of its paint (brands.js). When all of it is grey: its
// stripe if it has one (Öresundståg's orange line), else its body (SJ's silver; its darkest grey vanished in Dark).
export function brandColour(brand) {
  const c = styleFor(brand).colours;
  const chroma = hex => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return Math.max(...v) - Math.min(...v); };
  const best = list => list.reduce((a, b) => (chroma(b) > chroma(a) ? b : a), list[0]);
  const main = best(['body', 'skirt', 'roof', 'nose', 'band'].map(k => c[k]).filter(Boolean));
  return chroma(main) >= 60 ? main : c.stripe ?? c.body;
}

// The closest passenger station to a place, by name, when one is within NEAR_KM (else null).
function nearest(stations, lon, lat) {
  const k = Math.cos(lat * Math.PI / 180);
  let best = null, bestD = Infinity;
  for (const st of stations.values()) {
    if (!st.advertised || st.lon === null) continue;
    const d = ((st.lon - lon) * k) ** 2 + (st.lat - lat) ** 2;
    if (d < bestD) { bestD = d; best = st; }
  }
  return best && Math.sqrt(bestD) * 111.2 <= NEAR_KM ? best.name : null;
}

// The distance between two places in km, along the Earth.
function km(a, b) {
  const R = Math.PI / 180, s = Math.sin((b.lat - a.lat) * R / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin((b.lon - a.lon) * R / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

// keep: remember today's fastest on this phone (not in a replay, whose day is another).
export function createStats({ keep = true } = {}) {
  let metres = 0, lastTick = null;   // driven since the page opened
  const metresBy = new Map();         // the same per company (Statistik's company page, 2026-11-21)
  // Today's fastest (FAST_STORE): id -> { id, kmh, lon, lat, number, brand }.
  let fastDay = null, fastToday = new Map(), fastSaved = 0;
  const fastLoad = (day) => {
    fastDay = day; fastToday = new Map();
    if (!keep) return;
    try {
      const s = JSON.parse(localStorage.getItem(FAST_STORE) ?? 'null');
      if (s?.day === day) for (const x of s.list ?? []) fastToday.set(x.id, x);
    } catch { /* nothing saved, or the phone won't read it */ }
  };
  const fastTop = (n, brand = null) => [...fastToday.values()].filter(x => brand === null || x.brand === brand).sort((a, b) => b.kmh - a.kmh).slice(0, n);
  // Kept: the FAST_KEEP fastest, and each company's 3 fastest (its own page).
  const fastKept = () => {
    const keep = new Map(fastTop(FAST_KEEP).map(x => [x.id, x])), per = new Map();
    for (const x of [...fastToday.values()].sort((a, b) => b.kmh - a.kmh)) {
      const n = per.get(x.brand) ?? 0;
      if (n < 3) { keep.set(x.id, x); per.set(x.brand, n + 1); }
    }
    return keep;
  };
  const fastSave = (at) => {
    if (fastToday.size > 2 * FAST_KEEP + 60) fastToday = fastKept();
    if (!keep || at - fastSaved < FAST_SAVE_MS) return;
    fastSaved = at;
    try { localStorage.setItem(FAST_STORE, JSON.stringify({ day: fastDay, list: [...fastKept().values()] })); } catch { /* kept in memory */ }
  };
  let arrivals = [];                 // [{ at, age }] of positions arrived in the last minute
  let firstBatch = true;             // the first answer holds the last 10 minutes at once: not "arriving"
  let firstAt = null;                // when positions started arriving live
  let passings = [];                 // [{ key, station, time }] of the last 15 minutes
  const cancelled = { count: null, byBrand: null, at: 0, asking: false, failed: false };

  // "Fastest" is the speed the train itself reports, from a report under a minute old, not the drawn speed: a drawn
  // train goes faster than the real one while it catches up with its data (live 2026-11-13: "398 km/h" for a
  // Pågatåg). Reported speeds are sound: in the five core recordings (270,000 reports) the highest is 206 km/h,
  // none over 210. null: not known (grey, no speed sent, or an old report).
  const SPEED_MAX_AGE_MS = 60 * 1000;
  const reported = (x, reportOf, at) => {
    if (x.stale) return null;
    const r = reportOf(x.id);
    return r && r.speed !== null && r.speed !== undefined && at - r.time < SPEED_MAX_AGE_MS ? r.speed : null;
  };

  return {
    // New positions arrived (at: the page's clock); r.time is when each was measured.
    onRecords(records, at) {
      if (firstBatch) { firstBatch = false; return; }
      firstAt ??= at;
      for (const r of records) arrivals.push({ at, age: Math.max(0, at - r.time) });
      arrivals = arrivals.filter(a => a.at > at - RATE_MS);
    },
    onPassings(list, at) {
      for (const p of list) if (p.time > at - BUSY_MS) passings.push({ key: p.key, station: p.station, time: p.time });
    },
    // Once a second: the distance every drawn train went since the last tick (fast-forwarding trains included: they
    // cover ground the real train did), and the fastest one by its reported speed. reportOf(id): its latest report.
    tick(frame, at, reportOf) {
      // A sleeping tab doesn't add hours, and a clock set back (a replay starting: today -> its day) adds nothing
      // (it took the whole jump as driven backwards: "-2,291,814.7 km", 2026-11-15).
      const dt = lastTick === null ? 0 : Math.max(0, Math.min(5, (at - lastTick) / 1000));
      lastTick = at;
      const day = swedishDay(at);
      if (day !== fastDay) fastLoad(day);
      for (const x of frame) {
        if (!x.stale && x.v > 0) { metres += x.v * dt; const b = x.brand ?? ''; metresBy.set(b, (metresBy.get(b) ?? 0) + x.v * dt); }
        const kmh = reported(x, reportOf, at);
        if (kmh === null || kmh <= (fastToday.get(x.id)?.kmh ?? 0)) continue;
        fastToday.set(x.id, { id: x.id, kmh, lon: x.lon, lat: x.lat, number: reportOf(x.id)?.number ?? '?', brand: x.brand ?? '' });
      }
      fastSave(at);
      if (passings.length > 2000) passings = passings.filter(p => p.time > at - BUSY_MS);
    },
    // Cancelled trains today: asked when the page opens, at most every 10 minutes. ask(): () => Promise<{ count,
    // byBrand }> (byBrand null: not known per company, a file from before 2026-11-21).
    wantCancelled(ask, at) {
      if (cancelled.asking || (cancelled.at && at - cancelled.at < 10 * 60000)) return;
      cancelled.asking = true;
      ask().then((n) => { cancelled.count = n.count; cancelled.byBrand = n.byBrand ?? null; cancelled.failed = false; })
        .catch((e) => { cancelled.failed = true; console.warn('cancelled today:', e.message); })
        .finally(() => { cancelled.asking = false; cancelled.at = at; });
    },
    // The positions' rate and age, for the page's last line and Settings → Debug: null until 5 s of live data.
    rate(at) {
      const secs = firstAt === null ? 0 : Math.min(RATE_MS, at - firstAt) / 1000;
      const age = median(arrivals.map(a => a.age));
      return secs >= 5 && age !== null ? { perSecond: arrivals.length / secs, ageS: age / 1000 } : null;
    },

    // Every number on the page, plainly (src/stats-page.js draws them). d: { count (trains on the map), reports,
    // frame (drawn trains), lateness, stations, trainOf(id), at, replay, day (src/day-stats.js view, or null),
    // brand (a company's own page: only its trains; Max, 2026-11-21) }.
    snapshot(d) {
      const { lateness, stations, at } = d, brand = d.brand ?? null;
      const mine = id => brand === null || (lateness.brand(id) ?? '') === brand;
      const frame = brand === null ? d.frame : d.frame.filter(x => mine(x.id));
      const reports = brand === null ? d.reports : d.reports.filter(r => mine(r.id));
      const count = brand === null ? d.count : frame.length;
      // Moving, standing, no news; every train's place and lateness for the heatmap; north and south; the reported speeds added up.
      let moving = 0, standing = 0, sumKmh = 0, moved = 0, sumMoved = 0, north = null, south = null;
      const dots = [], fastNow = [];
      for (const x of frame) {
        dots.push({ id: x.id, lon: x.lon, lat: x.lat, stale: Boolean(x.stale), late: lateClass(lateness.get(x.id)?.minutes) });
        if (x.stale) continue;
        if (x.v >= STAND_MS) moving++; else standing++;
        if (!north || x.lat > north.lat) north = x;
        if (!south || x.lat < south.lat) south = x;
        const kmh = reported(x, d.trainOf, at);
        if (kmh === null) continue;
        sumKmh += kmh;
        if (kmh >= 2) { moved++; sumMoved += kmh; }
        fastNow.push({ id: x.id, kmh, lon: x.lon, lat: x.lat, number: d.trainOf(x.id)?.number ?? '?', brand: lateness.brand(x.id) ?? '' });
      }
      const place = x => x && { id: x.id, number: d.trainOf(x.id)?.number ?? '?', near: nearest(stations, x.lon, x.lat) };
      const withNear = list => list.map(x => ({ ...x, near: nearest(stations, x.lon, x.lat) }));

      // Kinds of train and companies, punctuality and the most late, minutes late together.
      const byBrand = new Map(), byKind = new Map();
      const groups = { ontime: 0, some: 0, late: 0, unknown: 0 };
      let worst = null, lateMin = 0;
      for (const r of reports) {
        const b = lateness.brand(r.id) ?? '', k = kindOf(b);
        byBrand.set(b, (byBrand.get(b) ?? 0) + 1);
        byKind.set(k, (byKind.get(k) ?? 0) + 1);
        const m = lateness.get(r.id)?.minutes;
        groups[lateClass(m)]++;
        if (m > 0) lateMin += m;
        if (m !== undefined && m !== null && (!worst || m > worst.minutes)) worst = { id: r.id, number: r.number, minutes: m, brand: b };
      }

      // Busiest stations: the last 15 minutes (passenger stations; each train once per station), and today's arrivals
      // (day-stats.js, the rows the punctuality graph is made of).
      passings = passings.filter(p => p.time > at - BUSY_MS);
      const perStation = new Map();
      for (const p of passings) {
        if (!stations.get(p.station)?.advertised || !mine(p.key)) continue;
        if (!perStation.has(p.station)) perStation.set(p.station, new Set());
        perStation.get(p.station).add(p.key);
      }
      const named = ([sig, n]) => ({ sig, name: stations.get(sig)?.name ?? sig, n });
      const busyRecent = [...perStation].map(([sig, keys]) => [sig, keys.size]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(named);
      const day = d.replay || !d.day ? null : d.day;
      const busyToday = day?.state === 'ok' ? [...day.stations].filter(([sig]) => stations.get(sig)?.advertised).sort((a, b) => b[1] - a[1]).slice(0, 3).map(named) : [];

      return {
        at, replay: Boolean(d.replay), count, moving, standing, grey: Math.max(0, count - moving - standing),
        dots, north: place(north), south: place(south), apart: north && south && north !== south ? km(north, south) : null,
        km: (brand === null ? metres : metresBy.get(brand) ?? 0) / 1000, sumKmh, avg: moved ? sumMoved / moved : null, lateMin,
        cancelled: d.replay ? 'replay' : cancelled.count === null ? (cancelled.failed ? 'failed' : 'loading')
          : brand === null ? cancelled.count : cancelled.byBrand ? cancelled.byBrand[brand] ?? 0 : 'unknown',
        groups, worst, day, brand,
        fastNow: withNear(fastNow.sort((a, b) => b.kmh - a.kmh).slice(0, 3)), fastToday: withNear(fastTop(3, brand)),
        kinds: KINDS.filter(k => byKind.has(k)).map(k => [k, byKind.get(k)]),
        brands: [...byBrand].sort((a, b) => (a[0] === '') - (b[0] === '') || b[1] - a[1]),
        busyRecent, busyToday, rate: this.rate(at),
      };
    },
  };
}
