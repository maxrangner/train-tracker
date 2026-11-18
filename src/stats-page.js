// The stats page as Max picked it (2026-11-15: "1D … I want it exactly as your demo"; the sketch in docs/stats-1115/):
// Sweden as a heatmap at the top (how many trains or how late, a switch beside it; Max 2026-11-15), then tiles: driven and cancelled, punctuality with the most late train and
// today's graph, the fastest on a speedometer, kinds of train and companies (a tap filters the map), the busiest
// stations, "for fun", and the data as a grey line at the end.
// Built once (and again when the language changes); after that, once a second, only what changed moves: numbers
// roll to their new value, rings and bars glide (CSS), the comparison slides in. Taps go somewhere: a train opens its
// card on the map, a station its board, an hour in the graph shows its numbers. Nothing moves for a phone set to
// reduce motion. Numbers: src/stats.js snapshot(); styles: src/stats.css.
import './stats.css';
import { t, lang } from './i18n.js';
import { brandColour } from './stats.js';
import { createSwedenMap, heatMode, heatGradient } from './stats-sweden.js';
import { addScrollbar } from './scrollbar.js';
import OUTLINE from './sweden-outline.json';

const FUN_EVERY_MS = 10 * 1000;     // "for fun": a new comparison this often (or at a tap)
const COMPANIES_SHOWN = 6;          // "Show all" opens the rest
const GAUGE_MAX = 250;              // km/h at the speedometer's end (the fastest reported in the recordings: 206)
import { esc } from './html.js';
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const num = (n, digits = 0) => Number(n).toLocaleString(lang() === 'sv' ? 'sv-SE' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const pct = (n, all) => (all ? Math.round(100 * n / all) : 0);
const h = (html) => { const tpl = document.createElement('template'); tpl.innerHTML = html.trim(); return tpl.content.firstElementChild; };
const $ = (el, sel) => el.querySelector(sel);

// A number that rolls from its last value to the new one (0.7 s).
function roll(el, v, digits = 0, suffix = '') {
  const from = el._v ?? v;
  el._v = v;
  cancelAnimationFrame(el._raf);
  if (reduce() || from === v || document.hidden) { el.textContent = num(v, digits) + suffix; return; }
  const t0 = performance.now(), dur = 700;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
    el.textContent = num(from + (v - from) * e, digits) + suffix;
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
// Swap an element's inside only when its text would change (keeps focus and taps on rows that stay the same).
const put = (el, html) => { if (el._html !== html) { el._html = html; el.innerHTML = html; } };

// A ring of shares; classes: their colours (k-…).
function donut(size, width, classes, mid) {
  const r = (size - width) / 2, C = 2 * Math.PI * r;
  const el = h(`<div class="st-donut" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
    `<circle class="st-ring" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${width}"/>` +
    classes.map(c => `<circle class="st-arc k-${c}" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="0 ${C}"/>`).join('') +
    `</svg><div class="st-mid">${mid}</div></div>`);
  const arcs = [...el.querySelectorAll('.st-arc')];
  el.update = (vals) => {
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    let off = 0;
    arcs.forEach((a, i) => {
      const len = vals[i] / total * C, gap = vals[i] && len > width ? width + 2 : 0;   // round ends: a 2 px gap between parts
      a.style.strokeDasharray = `${Math.max(0.01, len - gap)} ${C}`;
      a.style.strokeDashoffset = String(-(off + gap / 2));
      off += len;
    });
  };
  return el;
}

// The speedometer, 0-250 km/h. The needle turns in a short glide (set as an SVG attribute: the same in every browser).
function gauge(w = 118) {
  const R = 46, L = Math.PI * R;
  const ticks = [0, 50, 100, 150, 200, 250].map((v) => {
    const a = Math.PI * (1 - v / GAUGE_MAX), x = 60 + Math.cos(a) * (R + 11), y = 60 - Math.sin(a) * (R + 11);
    return `<text x="${x.toFixed(1)}" y="${(y + 2.5).toFixed(1)}" text-anchor="middle">${v}</text>`;
  }).join('');
  const el = h(`<svg class="st-gauge" width="${w}" height="${Math.round(w * 78 / 136)}" viewBox="-8 -4 136 78" aria-hidden="true">` +
    `<path class="st-gb" d="M ${60 - R} 60 A ${R} ${R} 0 0 1 ${60 + R} 60" stroke-width="9"/>` +
    `<path class="st-gv" d="M ${60 - R} 60 A ${R} ${R} 0 0 1 ${60 + R} 60" stroke-width="9" stroke-dasharray="0 ${L}"/>${ticks}` +
    `<line class="st-ndl" x1="60" y1="60" x2="${60 - R + 12}" y2="60"/><circle class="st-hub" cx="60" cy="60" r="4.5"/></svg>`);
  const needle = $(el, '.st-ndl');
  let angle = 0, raf = 0;
  el.update = (kmh) => {
    const k = Math.min(1, Math.max(0, kmh / GAUGE_MAX)), to = k * 180, from = angle;
    $(el, '.st-gv').style.strokeDasharray = `${k * L} ${L}`;
    cancelAnimationFrame(raf);
    angle = to;
    if (reduce() || from === to) { needle.setAttribute('transform', `rotate(${to} 60 60)`); return; }
    const t0 = performance.now();
    const step = (now) => {   // a little past and back, like a needle
      const q = Math.min(1, (now - t0) / 900), e = 1 + 2.2 * (q - 1) ** 3 + 1.2 * (q - 1) ** 2;
      needle.setAttribute('transform', `rotate(${from + (to - from) * e} 60 60)`);
      if (q < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  return el;
}

// The distance driven: one wheel per digit.
function odometer() {
  const el = h(`<span class="st-odo"></span>`);
  el.update = (v) => {
    const text = num(v, 1);
    const shape = text.replace(/\d/g, '0');
    if (el._shape !== shape) {
      el.innerHTML = [...text].map(ch => (/\d/.test(ch) ? `<span class="st-w"><span>${[...'0123456789'].map(d => `<i>${d}</i>`).join('')}</span></span>` : `<span>${ch}</span>`)).join('') +
        `<span class="st-u">km</span>`;
      el._shape = shape;
    }
    const wheels = el.querySelectorAll('.st-w > span');
    let k = 0;
    for (const ch of text) if (/\d/.test(ch)) wheels[k++].style.transform = `translateY(-${ch}em)`;
    el.setAttribute('aria-label', `${text} km`);
  };
  return el;
}

// "For fun": the comparisons (Max, 2026-11-14: random, just trivia). kmh: set against all trains' speeds added up;
// km: against the distance driven since the app opened. times: the number is "× something". The drawings are ours.
const TRIVIA = [
  { key: 'funSound', kmh: 1235, times: true, ic: 'sound' },     // the speed of sound at sea level, 343 m/s
  { key: 'funCheetah', kmh: 110, ic: 'cheetah' },
  { key: 'funJet', kmh: 900, ic: 'jet' },                       // an airliner cruising
  { key: 'funIss', kmh: 27600, times: true, ic: 'iss' },        // the space station
  { key: 'funEarth', kmh: 107000, times: true, ic: 'earth' },   // the Earth round the sun
  { key: 'funWalk', kmh: 5, ic: 'walk' },
  { key: 'funBolt', kmh: 44.7, times: true, ic: 'bolt' },       // Usain Bolt's top speed, 2009
  { key: 'funLap', km: 40075, ic: 'earth' },                    // round the Earth at the equator
  { key: 'funSweden', km: 1572, times: true, ic: 'sweden' },    // Smygehuk to Treriksröset
  { key: 'funMoon', km: 384400, times: true, ic: 'moon' },
];
const ICONS = {
  sound: '<path d="M8 17h6l7-6v22l-7-6H8z" fill="currentColor"/><path d="M27 15c3 3 3 11 0 14M31 11c6 6 6 16 0 22M35 7c8 8 8 22 0 30" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
  cheetah: '<ellipse cx="22" cy="28" rx="8" ry="7" fill="currentColor"/><circle cx="11" cy="18" r="3.6" fill="currentColor"/><circle cx="18" cy="12" r="3.6" fill="currentColor"/><circle cx="26" cy="12" r="3.6" fill="currentColor"/><circle cx="33" cy="18" r="3.6" fill="currentColor"/>',
  jet: '<path d="M22 4c1.6 0 2.4 2 2.4 4.5V17l14 8v3.5l-14-4v8.5l4 3V39L22 37.5 17.6 39v-3l4-3v-8.5l-14 4V25l14-8V8.5C21.6 6 20.4 4 22 4z" fill="currentColor"/>',
  iss: '<rect x="18" y="17" width="8" height="10" rx="2" fill="currentColor"/><path d="M4 12h11v20H4zM29 12h11v20H29z" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M4 22h11M29 22h11M9.5 12v20M34.5 12v20M15 22h3M26 22h3" stroke="currentColor" stroke-width="1.6"/>',
  earth: '<circle cx="22" cy="22" r="16" fill="none" stroke="currentColor" stroke-width="2.5"/><ellipse cx="22" cy="22" rx="7" ry="16" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 22h32M9 14h26M9 30h26" stroke="currentColor" stroke-width="2"/>',
  walk: '<circle cx="23" cy="7" r="3.6" fill="currentColor"/><path d="M22 13l-4 12 6 5 2 10M20 20l-6 4M22 15l7 6M18 25l-5 14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  bolt: '<path d="M25 3L9 25h11l-3 16 18-24H24z" fill="currentColor"/>',
  moon: '<path d="M28 6a16 16 0 1 0 10 26A13 13 0 0 1 28 6z" fill="currentColor"/>',
  sweden: `<path d="${OUTLINE.map(r => r.map((v, i) => (i % 2 ? '' : `${i ? 'L' : 'M'}${(15 + (v - 10.5) * 0.47 * 2.9).toFixed(1)} ${(2 + (69.1 - r[i + 1]) * 2.9).toFixed(1)}`)).join('') + 'Z').join('')}" fill="currentColor"/>`,
};

// root: #stats-body. actions: { openTrain(id), openStation(sig), describe(id) -> { number, brand, minutes } }.
// filter: src/filter.js (which rows show as pressed; main.js toggles it on a tap of [data-filter]).
export function createStatsPage(root, { openTrain, openStation, describe, filter }) {
  let builtLang = null, parts = [], funOffset = 0, beatSlot = null;
  addScrollbar(root);   // with a mouse: our own thin scrollbar (Max, 2026-11-15)
  const view = { fastest: 'now', busiest: 'recent' };   // the toggles: not remembered
  let companiesOpen = false, hourOn = null, last = null;

  function build() {
    builtLang = lang();
    root.innerHTML = '';
    parts = [sweden(), duo(), punctuality(), fastest(), kinds(), companies(), busiest(), fun(), data()];
    root.append(...parts);
  }

  // ---- Sweden as a heatmap, with the count beside it and the switch Trains / Lateness ----
  function sweden() {
    const map = createSwedenMap();
    const el = h(`<section class="st-sec st-se"><div class="st-se-side">` +
      `<div><b class="st-big st-count">0</b><div class="st-sub">${t('stTrainsNow')}</div></div>` +
      `<div class="st-legend"><div class="st-row"><span class="st-key k-moving"></span>${t('stMoving')}<b class="st-m"></b></div>` +
      `<div class="st-row"><span class="st-key k-standing"></span>${t('stStanding')}<b class="st-s"></b></div>` +
      `<div class="st-row"><span class="st-key k-grey"></span>${t('stNoNews')}<b class="st-g"></b></div></div>` +
      `<div class="st-apart"><b class="st-ap">–</b>${t('stApart')}</div>` +
      `<div class="seg st-seg st-heatseg" role="group" aria-label="${esc(t('stHeatWhat'))}"><button type="button" data-v="trains">${t('stHeatTrains')}</button><button type="button" data-v="lateness">${t('stHeatLate')}</button></div>` +
      `<div class="st-heatkey"></div></div></section>`);
    el.prepend(map.el);
    const key = $(el, '.st-heatkey'), segs = el.querySelectorAll('.st-heatseg button');
    const showMode = () => {
      const m = heatMode();
      segs.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === m)));
      put(key, m === 'lateness'
        ? `<div class="st-keys"><span><span class="st-key k-ontime"></span>${t('stKeyOnTime')}</span><span><span class="st-key k-some"></span>${t('stKeySome')}</span>` +
          `<span><span class="st-key k-late"></span>${t('stKeyLate')}</span></div><p class="st-sub">${t('stHeatBrighter')}</p>`
        : `<div class="st-ramp"><i style="background:${heatGradient()}"></i><span><span>${t('stHeatFewer')}</span><span>${t('stHeatMore')}</span></span></div>`);
    };
    segs.forEach((b) => { b.onclick = () => { map.setMode(b.dataset.v); showMode(); }; });
    el.update = (s) => {
      showMode();   // also follows a change of light / dark (the gradient)
      map.update(s);
      roll($(el, '.st-count'), s.count); roll($(el, '.st-m'), s.moving); roll($(el, '.st-s'), s.standing); roll($(el, '.st-g'), s.grey);
      if (s.apart === null) $(el, '.st-ap').textContent = '–'; else roll($(el, '.st-ap'), Math.round(s.apart), 0, ' km');
    };
    return el;
  }

  // ---- Driven while you watched, cancelled today ----
  function duo() {
    const el = h(`<section class="st-sec st-duo"><div class="st-tile"><span class="st-lbl">${t('stDriven')}</span><div class="st-o"></div><div class="st-sub">${t('stDrivenSub')}</div></div>` +
      `<div class="st-tile st-cancel"><span class="st-lbl">${t('stCancelled')}</span><div style="margin-top:6px"><b class="st-big st-cn">…</b></div><div class="st-sub st-cs">${t('stCancelledSub')}</div></div></section>`);
    const odo = odometer();
    $(el, '.st-o').append(odo);
    el.update = (s) => {
      odo.update(s.km);
      const c = s.cancelled, n = $(el, '.st-cn');
      if (typeof c === 'number') { roll(n, c); $(el, '.st-cs').textContent = t('stCancelledSub'); }
      else { n._v = undefined; n.textContent = c === 'loading' ? '…' : '–'; $(el, '.st-cs').textContent = c === 'replay' ? t('stNotInReplay') : c === 'failed' ? t('stCouldNotAsk') : t('stCancelledSub'); }
    };
    return el;
  }

  // ---- Punctuality: the ring, the most late train, today's graph ----
  function punctuality() {
    const el = h(`<section class="st-sec st-tile st-punct"><span class="st-lbl">${t('stPunctuality')}</span><div class="st-prow"></div>` +
      `<button type="button" class="st-go st-worst" hidden><span class="st-sub">${t('stMostLate')}</span><b class="st-wn"></b><span class="st-wt"></span><span class="st-wb"></span><span class="st-chev">›</span></button>` +
      `<div class="st-daybox"><span class="st-lbl">${t('stToday')}</span><div class="st-dayin"></div></div></section>`);
    const ring = donut(96, 11, ['ontime', 'some', 'late'], `<b class="st-p">0</b><small>${t('stKeyOnTime')}</small>`);
    const leg = h(`<div class="st-legend"><div class="st-row"><span class="st-key k-ontime"></span>${t('stLegOnTime')}<b class="st-a"></b></div>` +
      `<div class="st-row"><span class="st-key k-some"></span>${t('stLegSome')}<b class="st-b"></b></div>` +
      `<div class="st-row"><span class="st-key k-late"></span>${t('stLegLate')}<b class="st-c"></b></div>` +
      `<div class="st-row st-sub"><span class="st-key k-unknown"></span>${t('stLegUnknown')}<b class="st-u"></b></div></div>`);
    $(el, '.st-prow').append(ring, leg);
    const worst = $(el, '.st-worst'), dayIn = $(el, '.st-dayin');
    worst.onclick = () => worst._id && openTrain(worst._id);
    el.update = (s) => {
      const g = s.groups, known = g.ontime + g.some + g.late;
      ring.update([g.ontime, g.some, g.late]);
      roll($(ring, '.st-p'), pct(g.ontime, known), 0, ' %');
      roll($(leg, '.st-a'), g.ontime); roll($(leg, '.st-b'), g.some); roll($(leg, '.st-c'), g.late); roll($(leg, '.st-u'), g.unknown);
      worst.hidden = !(s.worst && s.worst.minutes > 0);
      if (!worst.hidden) {
        worst._id = s.worst.id;
        $(worst, '.st-wn').textContent = s.worst.number;
        put($(worst, '.st-wt'), `<span class="tag late">+${s.worst.minutes} min</span>`);
        $(worst, '.st-wb').textContent = s.worst.brand;
      }
      dayGraph(dayIn, s);
    };
    return el;
  }
  // Today's graph: one stacked bar per hour (on time, +3-5, +6 or more, from the bottom), height the hour's arrivals; a
  // tap on an hour shows its numbers, a second tap the day's again. Drawn anew only when the day's numbers change.
  function dayGraph(box, s) {
    const day = s.day;
    if (!day || day.state !== 'ok') {
      put(box, `<p class="st-sub">${!day ? t('stNotInReplay') : day.state === 'loading' ? t('stLoadingDay') : t('stCouldNotAsk5')}</p>`);
      box._key = null;
      return;
    }
    const hours = day.hours, slots = Math.max(24, hours.length);
    const key = `${builtLang}|${hours.map(c => c.join(',')).join(';')}`;
    if (box._key !== key) {
      box._key = key;
      const W = 10, BAR = 7, H = 50, TOP = 2, tot = hours.map(c => c[0] + c[1] + c[2]), most = Math.max(1, ...tot);
      let svg = `<line x1="0" x2="${slots * W}" y1="${TOP + H + 0.5}" y2="${TOP + H + 0.5}"/>`;
      hours.forEach((c, hr) => {
        let y = TOP + H, bars = '';
        [0, 1, 2].forEach((g) => {
          const len = c[g] / most * H;
          if (len <= 0) return;
          y -= len;
          bars += `<rect class="d${g}" x="${hr * W + 1.5}" y="${(y + Math.min(0.6, len / 3)).toFixed(2)}" width="${BAR}" height="${Math.max(0.6, len - 0.6).toFixed(2)}" rx="1.5"/>`;
        });
        svg += `<g data-h="${hr}"${hr === hourOn ? ' class="st-on"' : ''}><rect class="st-hit" x="${hr * W}" y="0" width="${W}" height="${TOP + H + 13}"/>${bars}</g>`;
      });
      svg += [0, 6, 12, 18, 23].map(hr => `<text x="${hr * W + 5}" y="${TOP + H + 11}" text-anchor="middle">${String(hr).padStart(2, '0')}</text>`).join('');
      box.innerHTML = `<svg class="st-day${hourOn !== null && hourOn < hours.length ? ' st-sel' : ''}" viewBox="0 0 ${slots * W} ${TOP + H + 13}" role="img" aria-label="${esc(t('stToday'))}">${svg}</svg><div class="st-hour"></div>`;
      box._html = null;
      $(box, 'svg').addEventListener('click', (e) => {
        const g = e.target.closest?.('g[data-h]');
        if (!g) return;
        const hr = Number(g.dataset.h);
        hourOn = hourOn === hr ? null : hr;
        box._key = null;
        dayGraph(box, last);
      });
    }
    const tot = hours.map(c => c[0] + c[1] + c[2]);
    const chip = $(box, '.st-hour');
    if (hourOn !== null && hourOn < hours.length) {
      const c = hours[hourOn], n = tot[hourOn];
      put(chip, `<b>${String(hourOn).padStart(2, '0')}–${String(hourOn + 1).padStart(2, '0')}</b><span>${t('stArrivalsN', num(n))}</span>` +
        `<span class="tag ontime">${pct(c[0], n)} %</span><span class="tag some">${pct(c[1], n)} %</span><span class="tag late">${pct(c[2], n)} %</span>`);
    } else {
      const all = tot.reduce((a, b) => a + b, 0), ok2 = hours.reduce((a, c) => a + c[0], 0), ok5 = hours.reduce((a, c) => a + c[0] + c[1], 0);
      put(chip, `<span>${t('stArrivalsN', `<b>${num(all)}</b>`)}</span><span class="tag ontime">${t('stPctOnTime', pct(ok2, all))}</span><span class="st-sub">${t('stMeasure', pct(ok5, all))}</span>`);
    }
  }

  // ---- Fastest: now, or today while the app was open on this phone ----
  function fastest() {
    const el = h(`<section class="st-sec st-tile"><div class="st-head"><span class="st-lbl">${t('stFastest')}</span>` +
      `<div class="seg st-seg" role="group" aria-label="${esc(t('stFastest'))}"><button type="button" data-v="now">${t('stNow')}</button><button type="button" data-v="today">${t('stTodayShort')}</button></div></div>` +
      `<div class="st-fast"></div><p class="st-sub st-tnote" hidden>${t('stWhileOpen')}</p></section>`);
    const g = gauge(), list = h(`<div class="st-fastlist"></div>`);
    $(el, '.st-fast').append(g, list);
    const segs = el.querySelectorAll('.st-seg button');
    segs.forEach((b) => { b.onclick = () => { view.fastest = b.dataset.v; el.update(last); }; });
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) openTrain(b.dataset.id); });
    el.update = (s) => {
      segs.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === view.fastest)));
      $(el, '.st-tnote').hidden = view.fastest !== 'today';
      const top = view.fastest === 'today' ? s.fastToday : s.fastNow;
      g.update(top[0]?.kmh ?? 0);
      put(list, top.length ? top.map((x, i) => {
        const onMap = describe(x.id) !== null;   // today's fastest may have finished its trip
        const inner = `<span class="st-rk">${i + 1}</span><span class="st-who"><b>${esc(x.number)}</b><small>${x.near ? esc(t('stNear', x.near)) : esc(x.brand)}</small></span>` +
          `<span class="st-kmh">${num(x.kmh)}<small class="st-sub"> km/h</small></span>`;
        return onMap ? `<button type="button" class="st-go st-fastrow" data-id="${esc(x.id)}">${inner}</button>` : `<div class="st-fastrow">${inner}</div>`;
      }).join('') : `<p class="st-sub">${t('stNoneYet')}</p>`);
    };
    return el;
  }

  // ---- Kinds of train and companies: rows are buttons; a tap shows only those trains on the map ----
  function barList(type, { limit = 0 } = {}) {
    const el = h(`<div class="st-bars"></div>`);
    const rows = new Map();
    const name = v => (type === 'kind' ? (v === 'unknown' ? `<i>${t('kind_unknown')}</i>` : esc(t(`kind_${v}`))) : v ? esc(v) : `<i>${t('stNoCompany')}</i>`);
    const colour = v => (type === 'kind' ? (v === 'unknown' ? 'var(--c-unknown)' : 'var(--accent)') : v ? brandColour(v) : 'var(--c-unknown)');
    el.update = (data, open = true) => {   // [[value, n]]
      const most = Math.max(1, ...data.map(d => d[1]));
      const seen = new Set();
      data.forEach(([v, n], i) => {
        seen.add(v);
        let r = rows.get(v);
        if (!r) {
          r = h(`<button type="button" class="st-brow" data-filter="${type}" data-v="${esc(v)}" aria-pressed="false"><span class="st-nm">${name(v)}</span>` +
            `<span class="st-tr"><span class="st-bar" style="width:0;background:${colour(v)}"></span></span><b class="st-n"></b></button>`);
          rows.set(v, r);
          el.append(r);
        }
        r.style.order = i;
        r.hidden = Boolean(limit && !open && i >= limit);
        r.setAttribute('aria-pressed', String(Boolean(filter.has(type, v))));
        const bar = $(r, '.st-bar'), w = `${(100 * n / most).toFixed(1)}%`;
        if (bar.style.width === '0px' || bar.style.width === '0') requestAnimationFrame(() => { bar.style.width = w; }); else bar.style.width = w;
        roll($(r, '.st-n'), n);
      });
      for (const [v, r] of rows) if (!seen.has(v)) { r.remove(); rows.delete(v); }
    };
    return el;
  }
  function kinds() {
    const el = h(`<section class="st-sec st-tile st-sec-bars"><span class="st-lbl">${t('stKinds')}</span><p class="st-sub">${t('stTapToFilter')}</p></section>`);
    const bars = barList('kind');
    $(el, '.st-lbl').after(bars);
    el.update = s => bars.update(s.kinds);
    return el;
  }
  function companies() {
    const el = h(`<section class="st-sec st-tile st-sec-bars"><span class="st-lbl">${t('stCompanies')}</span><button type="button" class="st-more" hidden></button></section>`);
    const bars = barList('brand', { limit: COMPANIES_SHOWN }), more = $(el, '.st-more');
    $(el, '.st-lbl').after(bars);
    more.onclick = () => { companiesOpen = !companiesOpen; el.update(last); };
    el.update = (s) => {
      bars.update(s.brands, companiesOpen);
      more.hidden = s.brands.length <= COMPANIES_SHOWN;
      more.textContent = companiesOpen ? t('stShowFewer') : t('stShowAll', s.brands.length);
    };
    return el;
  }

  // ---- Busiest stations: the last 15 minutes, or today's arrivals; a tap opens the board ----
  function busiest() {
    const el = h(`<section class="st-sec st-tile"><div class="st-head"><span class="st-lbl">${t('stBusiest')}</span>` +
      `<div class="seg st-seg" role="group" aria-label="${esc(t('stBusiest'))}"><button type="button" data-v="recent">${t('st15')}</button><button type="button" data-v="today">${t('stTodayShort')}</button></div></div>` +
      `<div class="st-rank"></div></section>`);
    const list = $(el, '.st-rank'), segs = el.querySelectorAll('.st-seg button');
    segs.forEach((b) => { b.onclick = () => { view.busiest = b.dataset.v; el.update(last); }; });
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-sig]'); if (b) openStation(b.dataset.sig); });
    el.update = (s) => {
      segs.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === view.busiest)));
      const today = view.busiest === 'today', top = today ? s.busyToday : s.busyRecent, most = Math.max(1, ...top.map(x => x.n));
      put(list, top.length ? top.map((x, i) => `<button type="button" class="st-go" data-sig="${esc(x.sig)}"><span class="st-pos">${i + 1}</span>` +
        `<span class="st-nm">${esc(x.name)}<span class="st-mini" style="width:${pct(x.n, most)}%"></span></span>` +
        `<span class="st-sub">${today ? t('stArrivalsN', num(x.n)) : t('stTrainsN', num(x.n))} <span class="st-chev">›</span></span></button>`).join('')
        : `<p class="st-sub">${today && !s.day ? t('stNotInReplay') : today && s.day?.state === 'loading' ? t('stLoadingDay') : t('stNoneYet')}</p>`);
    };
    return el;
  }

  // ---- For fun: all speeds added up, a comparison (every 10 s, or at a tap), north and south ----
  function fun() {
    const el = h(`<section class="st-sec st-tile st-fun" role="button" tabindex="0" aria-label="${esc(t('stFunNext'))}"><span class="st-hint">${t('stTapNext')}</span>` +
      `<span class="st-lbl">${t('stFun')}</span><div style="margin-top:6px"><b class="st-big st-sum">0</b><span class="st-sub"> km/h</span></div><div class="st-sub">${t('stFunSum')}</div>` +
      `<div class="st-cmp"><svg viewBox="0 0 44 44" aria-hidden="true"></svg><div><div class="st-x"></div><div class="st-sub st-what"></div></div></div>` +
      `<p class="st-sub st-ns" style="margin-top:10px"></p></section>`);
    let shown = null;
    const next = () => { funOffset++; show(last, true); };
    el.onclick = next;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); } };
    function show(s, swap) {
      const fits = TRIVIA.map(c => ({ c, x: c.kmh ? s.sumKmh / c.kmh : s.km / c.km })).filter(o => o.x >= 0.1);
      if (!fits.length) { $(el, '.st-cmp').hidden = true; return; }
      $(el, '.st-cmp').hidden = false;
      const slot = Math.floor(s.at / FUN_EVERY_MS);
      const { c, x } = fits[((Math.imul(slot, 2654435761) >>> 0) + funOffset) % fits.length];
      $(el, '.st-x').textContent = `${num(x, x < 10 ? 1 : 0)}${c.times ? ' ×' : ''}`;
      $(el, '.st-what').textContent = t(c.key);
      if (c.key !== shown) {
        $(el, '.st-cmp svg').innerHTML = ICONS[c.ic];
        if (shown !== null && swap !== false) { const cmp = $(el, '.st-cmp'); cmp.classList.remove('st-swap'); void cmp.offsetWidth; cmp.classList.add('st-swap'); }
        shown = c.key;
      }
    }
    el.update = (s, first) => {
      roll($(el, '.st-sum'), s.sumKmh);
      show(s, !first);
      const where = p => `<b>${esc(p.number)}</b>${p.near ? ` ${esc(t('stNear', p.near))}` : ''}`;
      put($(el, '.st-ns'), (s.north && s.south && s.apart !== null ? `${t('stFunNorth', where(s.north), where(s.south), num(s.apart))} ` : '') +
        (s.avg !== null ? esc(t('stFunAvg', num(s.avg))) : ''));
    };
    return el;
  }

  // ---- The data: a grey line at the end (Max, 3A; the same numbers under Settings → Debug) ----
  function data() {
    const el = h(`<p class="st-sec st-data"><span class="st-live"></span><span class="st-dt"></span></p>`);
    el.update = (s) => {
      $(el, '.st-dt').textContent = s.rate ? t('stData', num(s.rate.perSecond), num(s.rate.ageS)) : `${t('stData', '–', '–')}`;
      const slot = Math.floor(s.at / 10000);
      if (s.rate && slot !== beatSlot && !reduce()) { beatSlot = slot; el.classList.remove('st-beat'); void el.offsetWidth; el.classList.add('st-beat'); }
    };
    return el;
  }

  return {
    // s: src/stats.js snapshot(). first: the page has just opened (numbers are set, not rolled from old values).
    update(s, { first = false } = {}) {
      if (builtLang !== lang()) build();
      last = s;
      if (first) for (const el of root.querySelectorAll('.st-big, .st-legend b, .st-n, .st-ap, .st-p')) el._v = undefined;
      for (const p of parts) p.update(s, first);
    },
  };
}
