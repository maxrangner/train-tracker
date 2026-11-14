// The stats page: live numbers from what the page already has (Max, 2026-11-13: tap the "N trains · live" banner).
// Collected all the time, because they are cheap: the distance driven and the fastest train since the page opened
// (one pass over the drawn trains a second), how many positions arrive and how old they are, and the last 15 minutes
// of station passings. Everything else is worked out only while the page is open, once a second (render).
import { t, lang } from './i18n.js';
import { lateClass, label } from './lateness.js';
import { styleFor } from './brands.js';
import { STAND_MS } from './trains.js';
import { swedishDay } from './clock.js';

const RATE_MS = 60 * 1000;          // positions per second and their age: over the last minute
const BUSY_MS = 15 * 60 * 1000;     // busiest station: trains passing in the last 15 minutes
const NEAR_KM = 50;                 // "near" a station only when one is this close
// Fastest today: each train's highest reported speed today, while the app was open on this phone (Trafikverket keeps
// only the latest position, so the day can't be asked for). Kept on the phone for the day: the FAST_KEEP fastest.
const FAST_STORE = 'dayFastest', FAST_KEEP = 20, FAST_SAVE_MS = 30 * 1000;
const FUN_EVERY_MS = 10 * 1000;     // "for fun": a new comparison this often
// The comparisons (Max, 2026-11-14: "can be randomized since its just fun trivia"): a speed in km/h to set the
// trains' combined speed against, or a distance in km for the distance driven since the app was opened.
const TRIVIA = [
  { key: 'funSound', kmh: 1235 },     // the speed of sound at sea level, 343 m/s
  { key: 'funCheetah', kmh: 110 },
  { key: 'funJet', kmh: 900 },        // an airliner cruising
  { key: 'funIss', kmh: 27600 },      // the space station
  { key: 'funEarth', kmh: 107000 },   // the Earth round the sun
  { key: 'funWalk', kmh: 5 },
  { key: 'funBolt', kmh: 44.7 },      // Usain Bolt's top speed, 2009
  { key: 'funLap', km: 40075 },       // round the Earth at the equator
  { key: 'funSweden', km: 1572 },     // Smygehuk to Treriksröset
  { key: 'funMoon', km: 384400 },
];

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (n, digits = 0) => n.toLocaleString(lang() === 'sv' ? 'sv-SE' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

// A company's colour for its bar: the most colourful part of its paint (brands.js). When all of it is grey: its
// stripe if it has one (Öresundståg's orange line), else its body (SJ's silver; its darkest grey vanished in Dark).
function brandColour(brand) {
  const c = styleFor(brand).colours;
  const chroma = hex => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return Math.max(...v) - Math.min(...v); };
  const best = list => list.reduce((a, b) => (chroma(b) > chroma(a) ? b : a), list[0]);
  const main = best(['body', 'skirt', 'roof', 'nose', 'band'].map(k => c[k]).filter(Boolean));
  return chroma(main) >= 60 ? main : c.stripe ?? c.body;
}

// The closest passenger station to a place, with its distance in km (null when none is known).
function nearest(stations, lon, lat) {
  const k = Math.cos(lat * Math.PI / 180);
  let best = null, bestD = Infinity;
  for (const st of stations.values()) {
    if (!st.advertised || st.lon === null) continue;
    const d = ((st.lon - lon) * k) ** 2 + (st.lat - lat) ** 2;
    if (d < bestD) { bestD = d; best = st; }
  }
  return best && { name: best.name, km: Math.sqrt(bestD) * 111.2 };
}

// The distance between two places in km, along the Earth.
function km(a, b) {
  const R = Math.PI / 180, s = Math.sin((b.lat - a.lat) * R / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin((b.lon - a.lon) * R / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

// keep: remember today's fastest on this phone (not in a replay, whose day is another).
export function createStats({ keep = true } = {}) {
  let metres = 0, lastTick = null;   // driven since the page opened
  // Today's fastest (FAST_STORE): id -> { kmh, lon, lat, number, brand }.
  let fastDay = null, fastToday = new Map(), fastSaved = 0;
  const fastLoad = (day) => {
    fastDay = day; fastToday = new Map();
    if (!keep) return;
    try {
      const s = JSON.parse(localStorage.getItem(FAST_STORE) ?? 'null');
      if (s?.day === day) for (const x of s.list ?? []) fastToday.set(x.id, x);
    } catch { /* nothing saved, or the phone won't read it */ }
  };
  const fastTop = n => [...fastToday.values()].sort((a, b) => b.kmh - a.kmh).slice(0, n);
  const fastSave = (at) => {
    if (fastToday.size > 2 * FAST_KEEP) fastToday = new Map(fastTop(FAST_KEEP).map(x => [x.id, x]));
    if (!keep || at - fastSaved < FAST_SAVE_MS) return;
    fastSaved = at;
    try { localStorage.setItem(FAST_STORE, JSON.stringify({ day: fastDay, list: fastTop(FAST_KEEP) })); } catch { /* kept in memory */ }
  };
  // The toggles on the page (Max, 2026-11-14: "a toggle between now/all day, 15min/all day"): not remembered.
  const view = { fastest: 'now', busiest: 'recent' };
  let arrivals = [];                 // [{ at, age }] of positions arrived in the last minute
  let firstBatch = true;             // the first answer holds the last 10 minutes at once: not "arriving"
  let firstAt = null;                // when positions started arriving live
  let passings = [];                 // [{ key, station, time }] of the last 15 minutes
  const cancelled = { count: null, at: 0, asking: false, failed: false };

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
      const dt = lastTick === null ? 0 : Math.min(5, (at - lastTick) / 1000);   // a sleeping tab doesn't add hours
      lastTick = at;
      const day = swedishDay(at);
      if (day !== fastDay) fastLoad(day);
      for (const x of frame) {
        if (!x.stale && x.v > 0) metres += x.v * dt;
        const kmh = reported(x, reportOf, at);
        if (kmh === null || kmh <= (fastToday.get(x.id)?.kmh ?? 0)) continue;
        fastToday.set(x.id, { id: x.id, kmh, lon: x.lon, lat: x.lat, number: reportOf(x.id)?.number ?? '?', brand: x.brand ?? '' });
      }
      fastSave(at);
    },
    // A tap on the page (main.js, one listener on the page's body): a toggle. True when something changed.
    click(el) {
      const b = el?.closest?.('[data-view] button[data-v]');
      if (!b) return false;
      view[b.parentElement.dataset.view] = b.dataset.v;
      return true;
    },
    // Cancelled trains today: asked when the page opens, at most every 10 minutes. ask(): () => Promise<count>.
    wantCancelled(ask, at) {
      if (cancelled.asking || (cancelled.at && at - cancelled.at < 10 * 60000)) return;
      cancelled.asking = true;
      ask().then((n) => { cancelled.count = n; cancelled.failed = false; })
        .catch((e) => { cancelled.failed = true; console.warn('cancelled today:', e.message); })
        .finally(() => { cancelled.asking = false; cancelled.at = at; });
    },

    // The page's content. d: { count (trains on the map), reports, frame (drawn trains), lateness, stations,
    // trainOf(id), at, replay }.
    render(d) {
      const { reports, frame, lateness, stations, at } = d;
      const out = [];
      // seg: a toggle drawn beside the title, [key, [[value, label], ...]] (view above, click()).
      const section = (title, body, seg = null) => out.push(`<section class="st-sec"><div class="st-head"><div class="menu-label">${title}</div>` +
        (seg ? `<div class="seg st-seg" data-view="${seg[0]}" role="group" aria-label="${esc(title)}">` +
          seg[1].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${view[seg[0]] === v}">${l}</button>`).join('') + `</div>` : '') +
        `</div>${body}</section>`);
      // Numbers in the punctuality colours, after the one legend (Max, 2026-11-14: "the two punctuality stats should
      // share legend").
      const keyed = (list) => list.map(([g, text]) => `<span class="st-key st-${g}"></span>${text}`).join(' ');

      // 6: moving, standing, no news
      let moving = 0, standing = 0;
      for (const x of frame) { if (x.stale) continue; if (x.v >= STAND_MS) moving++; else standing++; }
      out.push(`<p class="st-big">${t('stMoving', num(d.count), num(moving), num(standing), num(Math.max(0, d.count - moving - standing)))}</p>`);

      // 1: companies
      const byBrand = new Map();
      for (const r of reports) { const b = lateness.brand(r.id) ?? ''; byBrand.set(b, (byBrand.get(b) ?? 0) + 1); }
      const rows = [...byBrand].sort((a, b) => (a[0] === '') - (b[0] === '') || b[1] - a[1]);
      const most = Math.max(1, ...rows.map(r => r[1]));
      section(t('stCompanies'), `<div class="st-bars">` + rows.map(([b, n]) =>
        `<span class="st-name">${b ? esc(b) : `<i>${t('stNoCompany')}</i>`}</span>` +
        `<span class="st-track"><span class="st-bar" style="width:${(100 * n / most).toFixed(1)}%;background:${b ? brandColour(b) : 'var(--muted)'}"></span></span>` +
        `<span class="st-n">${num(n)}</span>`).join('') + `</div>`);

      // 2: punctuality: the trains on the map now, and under it today's arrivals per hour (Max, 2026-11-13: together)
      const groups = { ontime: 0, some: 0, late: 0, unknown: 0 };
      let worst = null;
      for (const r of reports) {
        const m = lateness.get(r.id)?.minutes;
        groups[lateClass(m)]++;
        if (m !== undefined && (!worst || m > worst.m)) worst = { r, m };
      }
      const known = groups.ontime + groups.some + groups.late;
      const pct = n => (known ? Math.round(100 * n / known) : 0);
      const today = d.replay || !d.day ? `<p>${t('stNotInReplay')}</p>`
        : d.day.state === 'loading' ? `<p>${t('stLoadingDay')}</p>`
        : d.day.state === 'failed' ? `<p>${t('stCouldNotAsk5')}</p>`
        : dayGraph(d.day);
      section(t('stPunctuality'), `<p class="st-legend">${keyed([['ontime', t('stKeyOnTime')], ['some', '+3–5'], ['late', t('stKeyLate')]])}</p>` +
        `<p class="st-part">${t('stNowOnMap')}</p>` + (known
        ? `<div class="st-stack">${['ontime', 'some', 'late'].map(g => `<span class="st-${g}" style="width:${(100 * groups[g] / known).toFixed(1)}%"></span>`).join('')}</div>` +
          `<p class="st-legend">${keyed(['ontime', 'some', 'late'].map(g => [g, `${pct(groups[g])} %`]))}` +
          (groups.unknown ? ` · ${t('stNotKnown', num(groups.unknown))}` : '') + `</p>` +
          (worst && worst.m > 0 ? `<p>${t('stMostLate')}: <b>${esc(label(worst.r.number, worst.m))}</b>${lateness.brand(worst.r.id) ? ` <span class="st-sub">${esc(lateness.brand(worst.r.id))}</span>` : ''}</p>` : '')
        : `<p>${t('stNoneYet')}</p>`) +
        `<p class="st-part">${t('stToday')}</p>` + today);

      // 3: fastest: now, or today while the app was open on this phone (the three fastest)
      const nowFast = [];
      for (const x of frame) {
        const kmh = reported(x, d.trainOf, at);
        if (kmh) nowFast.push({ id: x.id, kmh, lon: x.lon, lat: x.lat, number: d.trainOf(x.id)?.number ?? '?', brand: lateness.brand(x.id) ?? '' });
      }
      const fastList = view.fastest === 'today' ? fastTop(3) : nowFast.sort((a, b) => b.kmh - a.kmh).slice(0, 3);
      const fastLine = (x) => {
        const near = nearest(stations, x.lon, x.lat);
        return `<b>${esc(x.number)}</b>, ${num(x.kmh)} km/h` +
          (near && near.km <= NEAR_KM ? ` ${t('stNear', esc(near.name))}` : '') +
          (x.brand ? ` <span class="st-sub">${esc(x.brand)}</span>` : '');
      };
      section(t('stFastest'), (fastList.length ? fastList.map(x => `<p>${fastLine(x)}</p>`).join('') : `<p>${t('stNoneYet')}</p>`) +
        (view.fastest === 'today' ? `<p class="st-sub">${t('stWhileOpen')}</p>` : ''),
      ['fastest', [['now', t('stNow')], ['today', t('stTodayShort')]]]);

      // 4: busiest stations: the last 15 minutes (passenger stations; each train once per station), or today's
      // arrivals (day-stats.js, the rows the punctuality graph is made of)
      let busiest;
      if (view.busiest === 'today') {
        busiest = d.replay || !d.day ? null : d.day.state !== 'ok' ? [] : [...d.day.stations]
          .filter(([sig]) => stations.get(sig)?.advertised).sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([sig, n]) => [sig, t('stArrivalsN', num(n))]);
      } else {
        passings = passings.filter(p => p.time > at - BUSY_MS);
        const perStation = new Map();
        for (const p of passings) {
          if (!stations.get(p.station)?.advertised) continue;
          if (!perStation.has(p.station)) perStation.set(p.station, new Set());
          perStation.get(p.station).add(p.key);
        }
        busiest = [...perStation].sort((a, b) => b[1].size - a[1].size).slice(0, 3).map(([sig, keys]) => [sig, t('stTrainsN', num(keys.size))]);
      }
      section(t('stBusiest'), busiest === null ? `<p>${t('stNotInReplay')}</p>` : busiest.length
        ? busiest.map(([sig, n], i) => `<p>${i === 0 ? '<b>' : ''}${esc(stations.get(sig)?.name ?? sig)}${i === 0 ? '</b>' : ''}: ${n}</p>`).join('')
        : `<p>${view.busiest === 'today' && d.day?.state === 'loading' ? t('stLoadingDay') : t('stNoneYet')}</p>`,
      ['busiest', [['recent', t('st15')], ['today', t('stTodayShort')]]]);

      // 5: driven while you watched
      section(t('stDriven'), `<p class="st-big">${num(metres / 1000)} km</p>`);

      // 8: for fun (Max, 2026-11-14): all trains' speeds added up, a comparison that changes every FUN_EVERY_MS, the
      // trains furthest north and south, all minutes late together, the average speed of the moving trains. Speeds are
      // the reported ones (as for "fastest").
      let sumKmh = 0, moved = 0, sumMoved = 0, north = null, south = null;
      for (const x of frame) {
        if (x.stale) continue;
        if (!north || x.lat > north.lat) north = x;
        if (!south || x.lat < south.lat) south = x;
        const kmh = reported(x, d.trainOf, at);
        if (kmh === null) continue;
        sumKmh += kmh;
        if (kmh >= 2) { moved++; sumMoved += kmh; }
      }
      let lateMin = 0;
      for (const r of reports) { const m = lateness.get(r.id)?.minutes; if (m > 0) lateMin += m; }
      const fun = [];
      if (sumKmh > 0) {
        fun.push(`<p class="st-big">${t('stFunSpeed', num(sumKmh))}</p>`);
        // A comparison that fits: picked by the 10-second slot, so it stays put between redraws.
        const slot = Math.floor(at / FUN_EVERY_MS), fits = TRIVIA.map(c => ({ c, x: c.kmh ? sumKmh / c.kmh : metres / 1000 / c.km })).filter(o => o.x >= 0.1);
        if (fits.length) {
          const { c, x } = fits[(Math.imul(slot, 2654435761) >>> 0) % fits.length];
          fun.push(`<p>${t(c.key, num(x, x < 10 ? 1 : 0))}</p>`);
        }
      }
      if (moved) fun.push(`<p>${t('stFunAvg', num(sumMoved / moved))}</p>`);
      if (north && south && north !== south) {
        const where = (x) => {
          const near = nearest(stations, x.lon, x.lat);
          return `<b>${esc(d.trainOf(x.id)?.number ?? '?')}</b>${near && near.km <= NEAR_KM ? ` ${t('stNear', esc(near.name))}` : ''}`;
        };
        fun.push(`<p>${t('stFunNorth', where(north), where(south))} <span class="st-sub">${t('stFunApart', num(km(north, south)))}</span></p>`);
      }
      if (lateMin > 0) fun.push(`<p>${t('stFunLate', num(lateMin))}</p>`);
      section(t('stFun'), fun.length ? fun.join('') : `<p>${t('stNoneYet')}</p>`);

      // 9: cancelled today
      section(t('stCancelled'), `<p>${d.replay ? t('stNotInReplay')
        : cancelled.count !== null ? t('stCancelledN', num(cancelled.count))
        : cancelled.failed ? t('stCouldNotAsk') : t('loading')}</p>`);

      // 7: the data itself
      const secs = firstAt === null ? 0 : Math.min(RATE_MS, at - firstAt) / 1000;
      const age = median(arrivals.map(a => a.age));
      section(t('stData'), secs >= 5 && age !== null
        ? `<p>${t('stRate', num(arrivals.length / secs, 0), num(age / 1000))}</p>`
        : `<p>${t('stNoneYet')}</p>`);


      return out.join('');
    },
  };
}

// The day's graph: one stacked bar per hour (on time, +3-5, +6 or more, from the bottom), its height the hour's
// arrivals; a small gap between the parts; hour labels at 00, 06, 12, 18; each bar's numbers on hover (its title).
// Under it the day's totals, with Trafikverket's own measure (up to 5 minutes late is on time).
function dayGraph({ hours }) {
  const W = 10, BAR = 7, H = 45, TOP = 4, GAP = 0.6;   // low (Max, 2026-11-13: "the graph can be shorter")
  const totals = hours.map(c => c[0] + c[1] + c[2]);
  const most = Math.max(1, ...totals);
  const sum = [0, 1, 2].map(g => hours.reduce((s, c) => s + c[g], 0));
  const all = sum[0] + sum[1] + sum[2];
  const pct = n => (all ? Math.round(100 * n / all) : 0);
  const bars = hours.map((c, h) => {
    let y = TOP + H;
    const parts = ['ontime', 'some', 'late'].map((cls, g) => {
      const len = c[g] / most * H;
      if (len <= 0) return '';
      y -= len;
      const shown = Math.max(0.6, len - GAP);   // the gap shows the surface between the parts
      return `<rect class="d-${cls}" x="${h * W + 1.5}" y="${(y + (len - shown)).toFixed(2)}" width="${BAR}" height="${shown.toFixed(2)}" rx="1"/>`;
    }).join('');
    const tip = `${String(h).padStart(2, '0')}–${String(h + 1).padStart(2, '0')}: ${t('stDayTip', num(totals[h]), totals[h] ? Math.round(100 * c[0] / totals[h]) : 0)}`;
    return `<g><title>${esc(tip)}</title><rect class="d-hit" x="${h * W}" y="0" width="${W}" height="${TOP + H}"/>${parts}</g>`;
  }).join('');
  const labels = [0, 6, 12, 18].map(h => `<text x="${h * W + 1.5}" y="${TOP + H + 11}">${String(h).padStart(2, '0')}</text>`).join('');
  return `<svg class="st-day" viewBox="0 0 ${24 * W} ${TOP + H + 14}" role="img" aria-label="${esc(t('stToday'))}">` +
    `<line x1="0" x2="${24 * W}" y1="${TOP + H + 0.5}" y2="${TOP + H + 0.5}"/>${bars}${labels}</svg>` +
    `<p class="st-legend">${['ontime', 'some', 'late'].map((g, i) => `<span class="st-key st-${g}"></span>${pct(sum[i])} %`).join(' ')}</p>` +
    `<p>${t('stDayTotal', num(all), pct(sum[0] + sum[1]))}</p>`;
}
