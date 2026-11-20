// The train's own numbers on its card (Max, 2026-11-20: "i" next to the star on the expanded card swaps the stops for
// these, "No second card popup"; built as the sketch https://claude.ai/artifact/N8NdNAEVFQzMccHYTntRaZ, his "1. Yes 2. A").
// From the top: the speed it reports, as a speedometer with a mark at what the track there is built for, and its place
// among the moving trains; its speed over the last 10 minutes (since the page opened: src/speed-log.js); the trip
// (the route line's shape, km done, the next stop, the track's speed along the whole way); its lateness at each stop;
// its day so far (km, stations passed, stops, minutes standing at stations).
// drawInfo(box, ctx) each second while shown; the speedometer's needle glides between (one frame each, only while
// the box is on screen). ctx: { id, number, t (the drawn moment), now, log (src/speed-log.js), net, path (the route line),
// place (the drawn train, or null), stops (the card's, arrival and departure merged), route, stationName, station, late }.
import { t as tr, lang } from './i18n.js';
import { esc } from './html.js';
import { hhmm } from './clock.js';
import { lateClass } from './lateness.js';
import { minutesText } from './tag.js';
import { HEAT } from './colours.js';
import { reduceMotion } from './motion.js';

const MAXV = 250;                 // the speedometer's end, km/h (the highest reported in Sweden: 206)
const SPAN_MS = 10 * 60 * 1000;   // the speed graph's window
const STRIP_M = 200;              // the track's speed along the trip, every this many metres
const R = Math.PI / 180;
const metres = (a, b) => Math.hypot((b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * R), b[1] - a[1]) * R * 6371000;
const dark = () => document.documentElement.dataset.theme === 'dark';
const fmt = n => Math.round(n).toLocaleString(lang() === 'sv' ? 'sv-SE' : 'en-GB');
const f1 = n => n.toFixed(1);

// ---- The route line in metres (cached on the path object: a new path, new numbers) ----
function metresOf(path) {
  if (path._m) return path._m;
  const c = path.coords, cum = new Float64Array(c.length);
  for (let i = 1; i < c.length; i++) cum[i] = cum[i - 1] + metres(c[i - 1], c[i]);
  return (path._m = cum);
}
// The metres along the path at the point nearest a place, searched between metres lo and hi.
function alongOf(path, p, lo = 0, hi = Infinity) {
  const c = path.coords, cum = metresOf(path), k = Math.cos(p.lat * R) * 111320, kl = 110540;
  let best = Infinity, m = null;
  for (let i = 1; i < c.length; i++) {
    if (cum[i] < lo || cum[i - 1] > hi) continue;
    const ax = (c[i - 1][0] - p.lon) * k, ay = (c[i - 1][1] - p.lat) * kl, bx = (c[i][0] - p.lon) * k, by = (c[i][1] - p.lat) * kl;
    if (Math.min(ax, bx) > best || Math.max(ax, bx) < -best || Math.min(ay, by) > best || Math.max(ay, by) < -best) continue;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, f = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    const d = Math.hypot(ax + f * dx, ay + f * dy);
    if (d < best) { best = d; m = cum[i - 1] + f * (cum[i] - cum[i - 1]); }
  }
  return m;
}
function pointAt(path, m) {
  const c = path.coords, cum = metresOf(path);
  let lo = 0, hi = c.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= m) lo = mid; else hi = mid; }
  const f = cum[hi] > cum[lo] ? Math.max(0, Math.min(1, (m - cum[lo]) / (cum[hi] - cum[lo]))) : 0;
  return [c[lo][0] + f * (c[hi][0] - c[lo][0]), c[lo][1] + f * (c[hi][1] - c[lo][1])];
}
// The line every km, for the small drawing; the track's speed every STRIP_M (3,000 look-ups for 600 km: ~4 ms).
function shapeOf(path, net) {
  if (path._shape) return path._shape;
  const total = metresOf(path).at(-1), line = [], speeds = [];
  for (let m = 0; m <= total; m += 1000) line.push(pointAt(path, m));
  line.push(path.coords.at(-1));
  if (net?.speedAt) for (let m = 0; m <= total; m += STRIP_M) { const [lon, lat] = pointAt(path, m); speeds.push(net.speedAt({ lon, lat })); }
  return (path._shape = { total, line, speeds });
}
// Each stop's metres along the line (its station's place, each searched after the one before).
function stopMetres(path, stops, station) {
  const key = stops.map(s => s.station).join();
  if (path._stops?.key === key) return path._stops.m;
  let from = 0;
  const m = stops.map(s => {
    const st = station(s.station);
    if (!st || st.lon == null) return null;
    const v = alongOf(path, st, from);
    if (v !== null) from = Math.max(from, v - 2000);
    return v;
  });
  path._stops = { key, m };
  return m;
}

// ---- Lateness at a stop (passed: as it left, or arrived at the end) ----
const lateAt = s => {
  for (const x of [s.dep, s.arr]) if (x?.actual && x.planned) return Math.round((x.actual - x.planned) / 60000);
  return null;
};
const kindOf = m => (m === null ? 'unknown' : lateClass(m));
const ordinal = n => (lang() === 'sv'
  ? `${n}:${[1, 2].includes(n % 10) && ![11, 12].includes(n % 100) ? 'a' : 'e'}`
  : `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`);

// ---- The speedometer: an arc from 0 to 250 km/h, the speed as a filled arc with a knob, a wedge for the track ----
const G = { cx: 165, cy: 138, r: 112, a0: -210, a1: 30 };
const ang = v => G.a0 + (G.a1 - G.a0) * Math.max(0, Math.min(1, v / MAXV));
const pt = (a, r) => [G.cx + r * Math.cos(a * R), G.cy + r * Math.sin(a * R)];
const arc = (a, b, r) => { const [x0, y0] = pt(a, r), [x1, y1] = pt(b, r); return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${f1(x1)} ${f1(y1)}`; };
function gaugeSvg() {
  let s = `<svg class="ti-gauge" viewBox="0 0 330 196" aria-hidden="true"><defs><linearGradient id="tiGrad" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" class="ti-g0"/><stop offset="1" class="ti-g1"/></linearGradient></defs>` +
    `<path class="ti-arc-bg" d="${arc(G.a0, G.a1, G.r)}"/><path class="ti-arc" d="${arc(G.a0, G.a0 + 0.1, G.r)}"/>`;
  for (let v = 0; v <= MAXV; v += 10) {
    const big = v % 50 === 0, a = ang(v), [x0, y0] = pt(a, G.r - 14), [x1, y1] = pt(a, G.r - (big ? 24 : 19));
    s += `<line class="ti-tick${big ? ' big' : ''}" x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}"/>`;
    if (big) { const [tx, ty] = pt(a, G.r - 38); s += `<text class="ti-num" x="${f1(tx)}" y="${f1(ty + 4.5)}">${v}</text>`; }
  }
  return s + `<path class="ti-mark" d="M0 -12L7 -23L-7 -23Z"/><g class="ti-knob"><circle r="13"/><circle r="8.5"/></g></svg>`;
}

export function drawInfo(box, ctx) {
  if (!box) return;
  if (!box._built || box._lang !== lang()) build(box);
  const q = s => box.querySelector(s);
  const { id, t, now, log, net, path, place, stops = [], route } = ctx;

  // ---- Speed now ----
  const rep = place ? latestWithSpeed(log, id, t) : null;
  const on = Boolean(rep);
  q('.ti-on').hidden = !on; q('.ti-off').hidden = on; q('.ti-graph').hidden = !on;
  if (on) {
    const allowed = net?.speedAt ? net.speedAt(rep) : null;
    box._gauge = { target: rep.speed, allowed };
    const age = Math.max(0, Math.round((t - rep.time) / 1000));
    q('.ti-age').textContent = age < 60 ? tr('tiGpsAgo', age) : tr('tiNoFresh');
    q('.ti-sub').innerHTML = allowed ? tr('tiBuiltFor', allowed) : '';
    // Its place among the moving trains, and all of them as dots on 0-250.
    const moving = log.moving(t), me = moving.find(([x]) => x === id);
    q('.ti-rank b').textContent = !me ? tr('tiStanding') : moving.filter(([, v]) => v > me[1]).length === 0 ? tr('tiFastest')
      : tr('tiRank', ordinal(1 + moving.filter(([, v]) => v > me[1]).length));
    q('.ti-rank span').textContent = tr(me ? 'tiOfMoving' : 'tiMoving', moving.length);
    q('.ti-field').outerHTML = fieldSvg(moving.map(([, v]) => v), me?.[1] ?? null, ctx.number);
    q('.ti-graph svg').outerHTML = graphSvg(log.of(id, t), t, net, route, ctx.stationName);
    const shown = log.of(id, t).filter(e => e.speed !== null);
    q('.ti-top').textContent = shown.length ? tr('tiTop', Math.max(...shown.map(e => e.speed))) : '';
    q('.ti-since').hidden = !(log.since && t - log.since < SPAN_MS);
    if (!box._loop) loop(box);
  } else {
    box._gauge = null;
    q('.ti-age').textContent = '';
    q('.ti-off p').innerHTML = place ? tr('tiNoSpeed') : tr('tiNotOnMap');
  }

  // ---- The trip ----
  const shape = path ? shapeOf(path, net) : null;
  const sm = path ? stopMetres(path, stops, ctx.station) : [];
  const nextIdx = stops.findIndex(s => { const x = s.dep ?? s.arr; return !x.actual && !x.canceled; });
  let km = null;
  if (path && place) km = alongOf(path, place);
  else if (path && nextIdx !== 0) { const i = nextIdx === -1 ? stops.length - 1 : nextIdx - 1; km = sm[i]; }
  q('.ti-trip').hidden = !shape;
  if (shape) {
    const total = shape.total;
    q('.ti-km').innerHTML = `${fmt((km ?? 0) / 1000)}<small>km</small>`;
    q('.ti-of').textContent = tr('tiOfKm', fmt(total / 1000), Math.floor((100 * (km ?? 0)) / total));
    q('.ti-trip svg').outerHTML = tripSvg(shape, km, stops, sm, nextIdx, ctx.stationName);
    const next = stops[nextIdx];
    if (next && km !== null && sm[nextIdx] != null) {
      const x = next.arr ?? next.dep, late = Math.max(0, ctx.late ?? 0);
      const at = x.actual ?? x.estimated ?? x.planned + late * 60000;
      q('.ti-next').innerHTML = `<span>${tr('tiNext', esc(ctx.stationName(next.station)))}</span>` +
        `<span class="ti-m">${tr('tiNextIn', fmt(Math.max(0, sm[nextIdx] - km) / 1000), Math.max(0, Math.round((at - now) / 60000)))}</span>`;
    } else q('.ti-next').innerHTML = '';
  }

  // ---- Lateness along the trip ----
  q('.ti-late svg').outerHTML = lateSvg(stops, ctx.stationName);
  const known = stops.map(s => [lateAt(s), s]).filter(([v]) => v !== null);
  if (known.length) {
    const worst = known.reduce((a, b) => (b[0] >= a[0] ? b : a)), lastV = ctx.late ?? known.at(-1)[0];
    const tag = `<span class="ti-tag ${kindOf(lastV)}">${minutesText(lastV)}</span>`;
    q('.ti-late-sum').innerHTML = worst[0] <= 0 ? tr('tiLateNever', tag)
      : tr('tiLateSum', tag, minutesText(worst[0]), esc(ctx.stationName(worst[1].station)));
  } else q('.ti-late-sum').textContent = '';

  // ---- Its day so far ----
  const passed = new Set((route?.stops ?? []).filter(s => s.actual && s.actual <= now).map(s => s.station));
  const made = stops.filter(s => (s.arr ?? s.dep)?.actual).length;
  let still = 0;
  for (const s of stops) if (s.arr?.actual && s.dep) still += Math.max(0, (s.dep.actual ?? now) - s.arr.actual);
  q('.ti-d-km').textContent = km === null ? '–' : fmt(km / 1000);
  q('.ti-d-passed').textContent = passed.size;
  q('.ti-d-stops').textContent = made;
  q('.ti-d-still').innerHTML = `${Math.round(still / 60000)}<small>min</small>`;
  const dep = stops[0]?.dep?.actual;
  q('.ti-avg').textContent = dep && km && now > dep + 5 * 60000
    ? tr('tiAvg', ctx.stationName(stops[0].station), hhmm(dep), Math.round(km / 1000 / ((now - dep) / 3600000))) : '';
}

function latestWithSpeed(log, id, t) {
  const e = log.at(id, t);
  if (!e) return null;
  if (e.speed !== null) return e;
  const list = log.of(id, t, 60 * 1000).filter(x => x.speed !== null);
  return list.at(-1) ?? null;
}

function build(box) {
  box._built = true; box._lang = lang();
  box.innerHTML =
    `<section class="ti-sec"><h3>${tr('tiSpeedNow')}<span class="ti-age"></span></h3>` +
      `<div class="ti-on"><div class="ti-gwrap">${gaugeSvg()}<div class="ti-read"><b>0</b><span>km/h</span></div></div>` +
      `<p class="ti-sub"></p><p class="ti-rank"><b></b><span></span></p><svg class="ti-field"></svg></div>` +
      `<div class="ti-off" hidden><b>–</b><p></p></div></section>` +
    `<section class="ti-sec ti-graph"><h3>${tr('tiGraph')}<span class="ti-top"></span></h3><svg></svg>` +
      `<p class="ti-legend"><span><i></i>${tr('tiLegendSpeed')}</span><span><i class="dash"></i>${tr('tiLegendTrack')}</span>` +
      `<span class="ti-since" hidden>${tr('tiSinceOpen')}</span></p></section>` +
    `<section class="ti-sec ti-trip"><h3>${tr('tiTrip')}</h3><p class="ti-progress"><b class="ti-km"></b><span class="ti-of"></span></p>` +
      `<svg></svg><p class="ti-next"></p></section>` +
    `<section class="ti-sec ti-late"><h3>${tr('tiLate')}</h3><svg></svg><p class="ti-late-sum"></p></section>` +
    `<section class="ti-sec"><h3>${tr('tiDay')}</h3><div class="ti-tiles">` +
      `<div><b class="ti-d-km"></b><span>${tr('tiKm')}</span></div><div><b class="ti-d-passed"></b><span>${tr('tiPassed')}</span></div>` +
      `<div><b class="ti-d-stops"></b><span>${tr('tiStops')}</span></div><div><b class="ti-d-still"></b><span>${tr('tiStill')}</span></div>` +
      `</div><p class="ti-avg"></p></section>`;
  box._shownV = null;
}

// The needle glides to the reported speed (each frame while the box is on screen; at once with "reduce motion").
function loop(box) {
  box._loop = true;
  const step = () => {
    if (!box.isConnected || !box.offsetParent || !box._gauge) { box._loop = false; return; }
    const g = box._gauge, target = g.target ?? 0;
    const v = box._shownV === null || reduceMotion() ? target : box._shownV + (target - box._shownV) * 0.12;
    if (v !== box._shownV) {
      box._shownV = Math.abs(v - target) < 0.05 ? target : v;
      const a = ang(box._shownV), [kx, ky] = pt(a, G.r);
      box.querySelector('.ti-arc').setAttribute('d', arc(G.a0, Math.max(G.a0 + 0.1, a), G.r));
      box.querySelector('.ti-knob').setAttribute('transform', `translate(${f1(kx)} ${f1(ky)})`);
      box.querySelector('.ti-read b').textContent = Math.round(box._shownV);
    }
    const mark = box.querySelector('.ti-mark');
    if (g.allowed) { const am = ang(g.allowed), [x, y] = pt(am, G.r); mark.setAttribute('transform', `translate(${f1(x)} ${f1(y)}) rotate(${f1(am + 90)})`); mark.style.display = ''; }
    else mark.style.display = 'none';
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Every moving train a dot on 0-250 km/h (piled where they crowd), this one large with its number.
function fieldSvg(speeds, mine, number) {
  const x = v => 10 + (310 * Math.min(v, MAXV)) / MAXV, pile = new Map();
  let s = `<line class="ti-axis" x1="10" y1="44" x2="320" y2="44"/>` +
    [0, 100, 200].map(v => `<text class="ti-num" x="${x(v)}" y="57" text-anchor="${v ? 'middle' : 'start'}">${v ? v : '0 km/h'}</text>`).join('');
  for (const v of speeds) {
    const b = Math.round(x(v) / 5.2), n = pile.get(b) ?? 0;
    pile.set(b, n + 1);
    if (n < 6) s += `<circle class="ti-dot" cx="${f1(b * 5.2)}" cy="${39 - n * 5.2}" r="2.2"/>`;
  }
  if (mine !== null) s += `<circle class="ti-me" cx="${f1(x(mine))}" cy="30" r="7"/><text class="ti-me-t" x="${f1(Math.min(300, Math.max(30, x(mine))))}" y="14">${esc(number ?? '')}</text>`;
  return `<svg class="ti-field" viewBox="0 0 330 60" aria-hidden="true">${s}</svg>`;
}

// The speed over the last 10 minutes; the track's speed dashed behind it; the stations passed as faint ticks.
function graphSvg(entries, t, net, route, stationName) {
  const W = 330, H = 170, L = 28, Rt = 6, Tp = 16, B = 22, w = W - L - Rt, h = H - Tp - B;
  const X = tt => L + (w * (tt - (t - SPAN_MS))) / SPAN_MS, Y = v => Tp + h - (h * Math.min(v, MAXV)) / MAXV;
  let s = '';
  for (const v of [0, 100, 200]) s += `<line class="ti-grid" x1="${L}" y1="${Y(v)}" x2="${W - Rt}" y2="${Y(v)}"/><text class="ti-num" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  for (const m of [10, 5, 0]) s += `<text class="ti-num" x="${X(t - m * 60000)}" y="${H - 5}" text-anchor="${m === 10 ? 'start' : m ? 'middle' : 'end'}">${m ? `−${m} min` : tr('tiNow')}</text>`;
  const seen = new Set();
  for (const p of route?.stops ?? []) {
    if (!p.actual || p.actual <= t - SPAN_MS || p.actual > t || seen.has(p.station)) continue;
    seen.add(p.station);
    const px = X(p.actual), lx = px > W - 40 ? px - 12 : px + 3;
    s += `<line class="ti-pass" x1="${f1(px)}" y1="${Tp}" x2="${f1(px)}" y2="${Tp + h}"/>` +
      `<text class="ti-pass-t" x="${f1(lx)}" y="${Tp + 8}" transform="rotate(90 ${f1(lx)} ${Tp + 8})">${esc(stationName(p.station))}</text>`;
  }
  const pts = entries.filter(e => e.speed !== null);
  if (pts.length >= 2) {
    let dd = '', d = '';
    pts.forEach((e, i) => {
      if (e.allowed === undefined) e.allowed = net?.speedAt ? net.speedAt(e) : null;
      if (e.allowed) dd += `${dd ? 'L' : 'M'}${f1(Math.max(L, X(e.time)))} ${f1(Y(e.allowed))}`;
      d += `${i ? 'L' : 'M'}${f1(X(e.time))} ${f1(Y(e.speed))}`;
    });
    const last = pts.at(-1);
    d += `L${f1(X(t))} ${f1(Y(last.speed))}`;
    s += (dd ? `<path class="ti-track" d="${dd}"/>` : '') +
      `<defs><linearGradient id="tiArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="ti-a0"/><stop offset="1" class="ti-a1"/></linearGradient></defs>` +
      `<path class="ti-area" d="${d}L${f1(X(t))} ${Y(0)}L${f1(X(pts[0].time))} ${Y(0)}Z"/><path class="ti-line" d="${d}"/>` +
      `<circle class="ti-end" cx="${f1(X(t))}" cy="${f1(Y(last.speed))}" r="4.5"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${s}</svg>`;
}

// The route's shape, done and left; dots for its stops, the start, the end and the next named; under it the track's
// speed along the whole trip, slow blue to fast yellow, with where the train is.
function tripSvg(shape, km, stops, sm, nextIdx, stationName) {
  const box = { x: 70, y: 28, w: 190, h: 182 };
  const lons = shape.line.map(p => p[0]), lats = shape.line.map(p => p[1]);
  const x0 = Math.min(...lons), x1 = Math.max(...lons), y0 = Math.min(...lats), y1 = Math.max(...lats);
  const kx = Math.cos(((y0 + y1) / 2) * R);
  const sc = Math.min(box.w / Math.max(1e-6, (x1 - x0) * kx), box.h / Math.max(1e-6, y1 - y0));
  const ox = box.x + (box.w - (x1 - x0) * kx * sc) / 2, oy = box.y + (box.h - (y1 - y0) * sc) / 2;
  const P = ([lon, lat]) => [ox + (lon - x0) * kx * sc, oy + (y1 - lat) * sc];
  const at = m => { const i = Math.max(0, Math.min(shape.line.length - 1, m / 1000)), a = shape.line[Math.floor(i)], b = shape.line[Math.min(shape.line.length - 1, Math.floor(i) + 1)], f = i - Math.floor(i); return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])]; };
  const line = pts => pts.map((p, i) => { const [x, y] = P(p); return `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`; }).join('');
  let s = `<path class="ti-route" d="${line(shape.line)}"/>`;
  if (km !== null) s += `<path class="ti-route done" d="${line([...shape.line.slice(0, Math.floor(km / 1000) + 1), at(km)])}"/>`;
  stops.forEach((st, i) => {
    if (sm[i] == null) return;
    const [x, y] = P(at(sm[i])), done = km !== null && sm[i] <= km, end = i === stops.length - 1, named = i === 0 || end || i === nextIdx;
    s += `<circle class="ti-stop${done ? ' done' : ''}" cx="${f1(x)}" cy="${f1(y)}" r="${named ? 5 : 3.6}"/>`;
    if (!named) return;
    const right = x > box.x + box.w / 2;
    s += `<text class="ti-stop-t${i === nextIdx ? ' next' : ''}" x="${f1(end ? x : right ? x + 10 : x - 10)}" y="${f1(end ? y - 11 : i === nextIdx ? y + 16 : y + 4)}" ` +
      `text-anchor="${end ? 'middle' : right ? 'start' : 'end'}">${esc(stationName(st.station))}</text>`;
  });
  if (km !== null) { const [x, y] = P(at(km)); s += `<circle class="ti-train-ring" cx="${f1(x)}" cy="${f1(y)}" r="11"/><circle class="ti-train" cx="${f1(x)}" cy="${f1(y)}" r="7"/>`; }
  // The strip.
  const sy = 232, sx = 8, sw = 314, n = shape.speeds.length, per = sw / Math.max(1, n), heat = HEAT[dark() ? 'dark' : 'light'];
  const colour = v => (v ? heat[v < 80 ? 0 : v < 120 ? 1 : v < 160 ? 2 : v < 200 ? 3 : 4] : null);
  if (n) {
    let run = 0;
    for (let i = 1; i <= n; i++) {
      if (i < n && colour(shape.speeds[i]) === colour(shape.speeds[run])) continue;
      const c = colour(shape.speeds[run]);
      s += `<rect x="${f1(sx + run * per)}" y="${sy}" width="${f1((i - run) * per + 0.5)}" height="9"${c ? ` fill="${c}"` : ' class="ti-strip-none"'}/>`;
      run = i;
    }
    if (km !== null) {
      const mx = sx + (sw * km) / shape.total;
      s += `<rect class="ti-strip-left" x="${f1(mx)}" y="${sy - 1}" width="${f1(Math.max(0, sx + sw - mx))}" height="11"/><path class="ti-strip-at" d="M${f1(mx)} ${sy - 3}l-5 -6h10z"/>`;
    }
    s += `<text class="ti-num" x="${sx}" y="${sy + 23}">${tr('tiStrip')}</text><text class="ti-num" x="${sx + sw}" y="${sy + 23}" text-anchor="end">${tr('tiStripScale')}</text>`;
  }
  return `<svg viewBox="0 0 330 ${n ? 260 : 214}" aria-hidden="true">${s}</svg>`;
}

// The minutes late at each stop, evenly spaced, in the map's three colours; stops ahead as dashed rings.
function lateSvg(stops, stationName) {
  const W = 330, H = 184, L = 26, Rt = 10, Tp = 14, B = 58, w = W - L - Rt, h = H - Tp - B, n = stops.length;
  if (n < 2) return `<svg viewBox="0 0 ${W} 10" aria-hidden="true"></svg>`;
  const vals = stops.map(lateAt), known = vals.filter(v => v !== null);
  const top = Math.max(8, ...known.map(v => v + 1)), bot = Math.min(-1, ...known.map(v => v - 1));
  const X = i => L + (w * i) / (n - 1), Y = v => Tp + (h * (top - v)) / (top - bot);
  const band = (a, b, k) => { const y0 = Y(Math.min(b, top)), y1 = Y(Math.max(a, bot)); return y1 > y0 ? `<rect class="ti-band ${k}" x="${L}" y="${f1(y0)}" width="${w}" height="${f1(y1 - y0)}"/>` : ''; };
  let s = band(bot, 2.5, 'ontime') + band(2.5, 5.5, 'some') + band(5.5, top, 'late');
  for (const v of [0, 3, 6, 10, 20, 30].filter(v => v <= top && (v <= 6 || top > v + 3))) s += `<text class="ti-num" x="${L - 6}" y="${f1(Y(v) + 4)}" text-anchor="end">${v ? `+${v}` : '0'}</text>`;
  s += `<line class="ti-zero" x1="${L}" y1="${f1(Y(0))}" x2="${L + w}" y2="${f1(Y(0))}"/>`;
  let d = '';
  vals.forEach((v, i) => { if (v !== null) d += `${d ? 'L' : 'M'}${f1(X(i))} ${f1(Y(v))}`; });
  if (d) s += `<path class="ti-late-line" d="${d}"/>`;
  const few = n <= 12, worst = known.length ? Math.max(...known) : null, lastKnown = vals.findLastIndex(v => v !== null);
  const step = Math.ceil(n / 9);
  vals.forEach((v, i) => {
    const r = few ? 5.5 : 4;
    if (v === null) s += `<circle class="ti-ahead" cx="${f1(X(i))}" cy="${f1(Y(0))}" r="${few ? 4 : 3}"/>`;
    else {
      s += `<circle class="ti-late-dot ${kindOf(v)}" cx="${f1(X(i))}" cy="${f1(Y(v))}" r="${r}"/>`;
      if (v !== 0 && (few || v === worst || i === lastKnown)) s += `<text class="ti-late-v" x="${f1(X(i))}" y="${f1(Y(v) - 9)}">${v > 0 ? `+${v}` : v}</text>`;
    }
    if (few || i % step === 0 || i === n - 1) {
      const lx = X(i), ly = H - B + 12;
      s += `<text class="ti-num" x="${f1(lx)}" y="${ly}" text-anchor="end" transform="rotate(-50 ${f1(lx)} ${ly})">${esc(short(stationName(stops[i].station)))}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${s}</svg>`;
}
const short = name => { const n = name.replace(/ (C|Central|centralstation)$/, ''); return n.length > 11 ? `${n.slice(0, 10)}…` : n; };
