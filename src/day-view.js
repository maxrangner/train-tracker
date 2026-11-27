// The day, the page side (build plan part 4, 2026-11-23; Max, 2026-11-22: "map only", no cards or boards for the past).
// ☰ → The day opens a ribbon just above the search bar: the last 24 hours to now (rolling: Max, 2026-11-27, "Just
// constant rolling"; until then today from 04:00), from the first history file there is, one bar per 15-minute slot
// (how many trains were on the map, coloured by their lateness: the day's overview file, else each slot's own), a handle to
// drag back in time, play/pause, a speed slider (×1 real time, ×10, ×60, ×180, ×600; Max, 2026-11-27: "Maybe just a
// play, pause and a slider for speed? And the x, live and timeline of course") and Live back to now. A slot with no
// file is a striped gap. While it shows an earlier moment the map has a coloured frame and "14:32 · earlier today" at
// the top (where the live mark is), the trains come from src/day-trains.js (the live engine runs on underneath,
// untouched), and a tap on a train shows a small bubble (number, company, lateness then, its trip's start → end,
// Follow) instead of its card, placed by the train as the live map's label is (src/map.js labelAt: clear of the train,
// held still); several (a group) one row each, a row picks that train (src/day.js: the ring and the following, as live).
//
// Only the slots shown are fetched (the handle's slot and its neighbours, the slots a play is heading into; Max,
// 2026-11-27: load only what is needed, with feedback): the bars come from the day's overview (src/live-file.js
// daySumOf, ~2 kB), and while the moment shown waits for its file the clock says "Loading…" and its slot on the
// ribbon shimmers. Without an overview (an older fetcher) the whole day follows in the background as before (a day is
// about 3 MB packed, docs/data.md "The day"). Each file once per session (files-source.js keeps them in a store of
// their own).
//   const day = createDayView({ history, overview, stationName, now, delay, net, onMode, onClose, onPick, onGone })
//     history(from, to): src/files-source.js history(); overview(): the newest daysum file or null; stationName(sig);
//     now(): the page's clock; delay: how far the live map is drawn
//     behind (ms); net(): the rail network or null; onMode(past, picked): the map turned to an earlier moment (true)
//     or back to live (false; picked: the train picked then, or null); onClose(): the ribbon closed;
//     onPick(id): a row of a group's bubble tapped; onGone(): the picked
//     train's bubble went by itself (its history ends there).
//   day.open() / day.close() / day.live() / day.seek(T) / day.play() (play or pause; playing makes the bar compact) /
//   day.setSpeed(i) (SPEEDS[i]); day.compact: the bar in its compact stage (onCompact(on) when it changes)
//   day.tick(ts) each frame: moves the moment on while playing; true when it moved
//   day.at(T, near) the trains at T (src/day-trains.js at; near(lon, lat): only those are routed along the rails)
//   day.trail(): the picked train's trip so far as lines [[lon, lat], ...] (the same array while unchanged), or null
//   day.bubble(ids, picked) / day.hideBubble() / day.placeBubble(place) / day.picked: the small bubble by a tapped
//   train (picked: that train is ringed and its bubble has Follow); place(hold, lon, lat, w, h): src/map.js labelAt
import { createDayTrains } from './day-trains.js';
import { HISTORY_MS, HISTORY_KEEP_MS, historySlot, historyCounts, daySumOf } from './live-file.js';
import { hhmm, swedishDay } from './clock.js';
import { lateClass } from './lateness.js';
import { minutesText } from './tag.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { esc } from './html.js';
import { ticksFor } from './day-ticks.js';
import { ms, reduceMotion } from './motion.js';

// The play speeds: real time, then ten minutes a minute, an hour a minute, three hours a minute, ten hours a minute.
export const SPEEDS = [1, 10, 60, 180, 600];
const FIRST_SPEED = 2;                // (×60 until another is chosen, for this visit)
const BACK_FROM_LIVE = 3600000;       // play pressed at the live end: from an hour back
const AT_ONCE = 2;                    // files asked at the same time
const RETRY_MS = 30000;               // a slot just finished whose file isn't there yet: asked again this often
const FRESH_MS = 8 * 60000;           // ... for this long after its end (the fetcher writes it, then uploads it)
const AHEAD_S = 25;                   // a play fetches the slots it reaches within this many seconds
const TRAIL_MS = 200;                 // the picked train's line worked out again at most this often

export function createDayView({ history, overview = async () => null, stationName = sig => sig, now, delay, net, onMode = () => {}, onClose = () => {}, onPick = () => {}, onGone = () => {}, onCompact = () => {} }) {
  const root = document.documentElement;
  let day = null;                     // src/day-trains.js, made at the first open (the rail network is there by then)
  let shown = false, T = null, rate = 0, speed = FIRST_SPEED, lastTs = null, waiting = false, timer = null;
  const slots = new Map();            // slot -> { state: 'loading' | 'ok' | 'gap', n, c: { ontime, some, late, unknown }, at }
  let sum = null, sumFirst = null, sumAt = 0;   // the day's overview: slot -> { n, c } (null: none yet), its first slot, made when
  const queue = [];
  let active = 0;

  // ---------- the parts on the page ----------
  const el = document.createElement('div');
  el.id = 'day';
  el.hidden = true;
  el.setAttribute('role', 'group');
  el.innerHTML = '<div class="day-row"><button type="button" class="day-play"></button>' +
    `<input type="range" class="day-speed" min="0" max="${SPEEDS.length - 1}" step="1" value="${FIRST_SPEED}"><output class="day-rate"></output>` +
    `<i class="day-grow"></i><button type="button" class="day-x">${icon('close', 18)}</button></div>` +
    '<div class="day-track-row"><div class="day-track" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100"><canvas></canvas><b class="day-handle"></b></div>' +
    '<button type="button" class="day-live"><i></i><span></span></button></div><div class="day-ticks"></div>' +
    // the compact stage while it plays (Max, 2026-11-27: "Needs a compact view stage. Most compact can remove search, and
    // thin the scroll bar"; "Yes" to its sketch): play/pause, a thin timeline, ✕; a tap on it brings the whole bar back
    `<div class="day-mini"><button type="button" class="day-play day-mini-play"></button><div class="day-mini-track"><i></i><b></b></div><button type="button" class="day-x day-mini-x">${icon('close', 18)}</button></div>`;
  const track = el.querySelector('.day-track'), canvas = track.querySelector('canvas'), handle = track.querySelector('.day-handle');
  const shimmer = Object.assign(document.createElement('i'), { className: 'day-shimmer', hidden: true });   // the slot loading
  track.insertBefore(shimmer, handle);
  const ticksEl = el.querySelector('.day-ticks'), liveBtn = el.querySelector('.day-live');
  const miniPlay = el.querySelector('.day-mini-play'), miniTrack = el.querySelector('.day-mini-track');
  const playBtn = el.querySelector('.day-row .day-play'), speedEl = el.querySelector('.day-speed'), rateEl = el.querySelector('.day-rate');
  const clock = Object.assign(document.createElement('div'), { id: 'day-clock', hidden: true });
  clock.setAttribute('aria-live', 'polite');
  const frameEl = Object.assign(document.createElement('div'), { id: 'day-frame', hidden: true });
  const bubbleEl = Object.assign(document.createElement('div'), { id: 'day-bubble', hidden: true });
  document.body.append(frameEl, clock, el, bubbleEl);

  // ---------- the time line ----------
  const edge = () => now() - delay;                                     // the live map's moment
  const upTo = () => historySlot(edge()) * HISTORY_MS;                  // the end of the newest finished slot
  // The oldest slot whose file is still kept (src/live-file.js historyUntil: a day after the slot's end).
  const firstSlot = () => historySlot(edge() - HISTORY_KEEP_MS);
  // The ribbon's start: a day back, or later where the files only begin later: the overview's first slot, unless the
  // slot before it has a file (a fetcher started again keeps no overview of before; those files are there, asked for
  // when shown), and the slots found to have no file.
  function startT() {
    let s = firstSlot();
    const last = historySlot(upTo()) - 1;
    if (sum && sumFirst > s && slots.get(sumFirst - 1)?.state !== 'ok') s = sumFirst;
    while (s < last && slots.get(s)?.state === 'gap') s++;
    return s * HISTORY_MS;
  }
  const lastDone = () => historySlot(upTo()) - 1;

  // ---------- the files ----------
  function retryable(s, slot) { return s.state === 'gap' && Date.now() - s.at > RETRY_MS && Date.now() - (slot + 1) * HISTORY_MS < FRESH_MS + delay; }
  function want(slot, first = false) {
    if (slot < firstSlot() - 1 || slot > lastDone()) return;
    const s = slots.get(slot);
    if (s && s.state !== 'gap') return;
    if (s && !retryable(s, slot)) return;
    const i = queue.indexOf(slot);
    if (i >= 0) { if (!first) return; queue.splice(i, 1); }
    if (first) queue.unshift(slot); else queue.push(slot);
    pump();
  }
  function pump() {
    while (active < AT_ONCE && queue.length) {
      const slot = queue.shift();
      active++;
      slots.set(slot, { state: 'loading' });
      history(slot * HISTORY_MS, slot * HISTORY_MS).then(({ slots: got = [] }) => {
        const x = got[0];
        if (x?.rows) { day.add(x); slots.set(slot, { state: 'ok', ...statsOf(x.rows) }); if (T !== null) draw(); }
        else slots.set(slot, { state: 'gap', at: Date.now() });
      }).catch(() => slots.set(slot, { state: 'gap', at: Date.now() }))
        .finally(() => { active--; stepWalk(); if (shown) draw(); pump(); });
    }
  }
  // A slot's bar: its trains, by their lateness at their last point in it (counted as the fetcher counts the overview).
  function statsOf(rows) {
    const [n, ontime, some, late, unknown] = historyCounts(rows);
    return { n, c: { ontime, some, late, unknown } };
  }
  // The day's overview: the newest the fetcher has made (its name comes with the live file, so this is cheap to ask);
  // with none, the whole day is fetched as before (fillDay). The slot before its first is asked once (startT).
  let sumAsking = false, sumMisses = 0;   // (answers without one: after 3, an older fetcher, the whole day as before)
  function takeOverview() {
    if (sumAsking) return;
    sumAsking = true;
    overview().then((f) => {
      if (!f?.slots) { sumMisses++; return; }
      const m = daySumOf(f);
      if (!m.size) return;
      const had = sumFirst;
      sum = m; sumFirst = Math.min(...m.keys()); sumAt = f.t ?? 0;
      if (had !== sumFirst && sumFirst > firstSlot()) want(sumFirst - 1);
      if (shown) draw();
    }).catch(() => {}).finally(() => { sumAsking = false; });
  }
  // What the moment needs: its slot and the one before (a train's last point may be there) and after (its next).
  function need(at) {
    const s = historySlot(at);
    const ahead = rate ? historySlot(Math.min(upTo() - 1, at + rate * AHEAD_S * 1000)) : s + 1;
    for (let k = ahead; k >= s - 1; k--) want(k, true);
    // (nearest first: the slot itself ends up at the front)
    want(s, true);
  }
  const ready = at => { const st = slots.get(historySlot(at))?.state; return st === 'ok' || st === 'gap'; };
  function fillDay() { for (let s = lastDone(); s >= firstSlot(); s--) want(s); }
  // Each second while open: the overview's newest; with none, the whole day as before.
  function keepUp() { takeOverview(); if (!sum && sumMisses >= 3) fillDay(); }

  // ---------- the moment ----------
  let wasPast = false;
  function setMode(past) {
    const was = wasPast;
    wasPast = past;
    root.classList.toggle('day-past', past);
    frameEl.hidden = !past;
    clock.hidden = !past;
    const pick = picked;   // (back to live: the train picked then, src/day.js follows it on live if it is there)
    if (!past) hideBubble();
    if (was !== past) onMode(past, pick);
  }
  function seek(at, { keep = false } = {}) {
    if (!day) return;
    const end = upTo();
    if (at >= end - 1000) { live(); return; }
    T = Math.max(startT(), at);
    if (!keep) rate = 0;
    need(T);
    setMode(true);
    draw();
  }
  // Compact while it plays: pressing play makes it so, a tap on the compact row (or Live, ✕) brings the whole bar back;
  // pausing leaves it as it is. onCompact(): src/day.js places the bar and steps the search card and chips away.
  let compact = false;
  function setCompact(on) {
    if (compact === on) return;
    compact = on;
    // (in its place at once, both ways: gliding, the row slid through the map where the search bar had just gone)
    root.classList.add('day-snap');
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('day-snap')));
    el.classList.toggle('compact', on);
    root.classList.toggle('day-compact', on);
    onCompact(on);
    draw();
  }
  function live() {
    setCompact(false);
    rate = 0; waiting = false;
    T = null;
    setMode(false);
    draw();
  }
  // Play from the moment shown (at the live end: from an hour back), or pause.
  function play() {
    if (!day) return;
    if (rate) { rate = 0; draw(); return; }
    const at = Math.max(startT(), T ?? edge() - BACK_FROM_LIVE);
    rate = SPEEDS[speed]; lastTs = null;
    seek(at, { keep: true });
    setCompact(true);
  }
  // A new speed: at once while playing.
  function setSpeed(i) {
    speed = Math.max(0, Math.min(SPEEDS.length - 1, Math.round(i)));
    if (rate) rate = SPEEDS[speed];
    draw();
  }
  function tick(ts) {
    if (T === null || !rate) { lastTs = null; return false; }
    const dt = lastTs === null ? 0 : Math.min(100, ts - lastTs);
    lastTs = ts;
    // Waiting for the file the moment is in: the clock holds (the map would be empty otherwise).
    if (!ready(T)) { need(T); return false; }
    const next = T + dt * rate;
    if (next >= upTo() - 1000) { live(); return true; }
    if (historySlot(next) !== historySlot(T)) need(next);
    T = next;
    return dt > 0;
  }

  // ---------- drawing ----------
  const css = name => getComputedStyle(root).getPropertyValue(name).trim();
  let W = 0, H = 0;
  function draw() {
    if (!shown) return;
    const r = track.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (Math.round(r.width) !== W || Math.round(r.height) !== H) {
      W = Math.round(r.width); H = Math.round(r.height);
      canvas.width = W * dpr; canvas.height = H * dpr;
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const t0 = startT(), t1 = edge(), end = upTo(), span = Math.max(1, t1 - t0);
    const x = at => ((at - t0) / span) * W;
    const pad = 4, top = 6, base = H - pad, full = base - top;
    // A slot's counts: its own file's when fetched, else the overview's.
    const bar = s => { const v = slots.get(s); return v?.state === 'ok' ? v : sum?.get(s) ?? null; };
    let most = 1;
    for (let s = historySlot(t0); s * HISTORY_MS < end; s++) { const v = bar(s); if (v) most = Math.max(most, v.n); }
    const col = { ontime: css('--c-ontime'), some: css('--c-some'), late: css('--c-late'), unknown: css('--c-unknown') };
    const line = css('--line') || '#ccc', muted = css('--muted') || '#888';
    for (let s = historySlot(t0); s * HISTORY_MS < end; s++) {
      const a = x(s * HISTORY_MS) + 0.5, b = x((s + 1) * HISTORY_MS) - 0.5, w = Math.max(1, b - a), st = slots.get(s)?.state, v = bar(s);
      // (no file: found so, or not in the overview though it covers the slot)
      const gap = !v && (st === 'gap' || (sum && s >= sumFirst && (s + 1) * HISTORY_MS <= sumAt && st !== 'loading'));
      if (!v && !gap) {
        g.fillStyle = line; g.fillRect(a, base - 3, w, 3);
      } else if (!v) {
        g.save(); g.beginPath(); g.rect(a, top, w, full); g.clip();
        g.strokeStyle = muted; g.globalAlpha = 0.55; g.lineWidth = 1.2;
        for (let k = -full; k < w + full; k += 5) { g.beginPath(); g.moveTo(a + k, base); g.lineTo(a + k + full, top); g.stroke(); }
        g.restore();
      } else {
        let y = base;
        const h = Math.max(3, full * (v.n / most));
        for (const k of ['ontime', 'some', 'late', 'unknown']) {
          if (!v.c[k]) continue;
          const hk = h * (v.c[k] / v.n);
          g.fillStyle = col[k]; g.fillRect(a, y - hk, w, hk);
          y -= hk;
        }
      }
    }
    // The hours under it, and midnight as a line through it (src/day-ticks.js)
    const { ticks: marks, midnight } = ticksFor(t0, t1, W, { yesterday: t('dayYesterdayTick'), today: t('dayTodayTick'), now: t('dayNow') });
    if (midnight !== null) { g.fillStyle = css('--ink') || '#000'; g.globalAlpha = 0.85; g.fillRect(Math.round(midnight) - 1, 0, 2, H); g.globalAlpha = 1; }
    // Not in the files yet (the slot running now, and the live map's moment): the live end, in the accent.
    const live0 = x(end);
    g.fillStyle = css('--accent'); g.globalAlpha = 0.18; g.fillRect(live0, top, Math.max(2, W - live0), full); g.globalAlpha = 1;
    // The moment shown waiting for its file: its slot shimmers (and the clock says so).
    waiting = T !== null && !ready(T);
    shimmer.hidden = !waiting;
    if (waiting) {
      const s = historySlot(T);
      shimmer.style.left = `${Math.max(0, x(s * HISTORY_MS)).toFixed(1)}px`;
      shimmer.style.width = `${Math.max(6, x((s + 1) * HISTORY_MS) - Math.max(0, x(s * HISTORY_MS))).toFixed(1)}px`;
    }
    // The handle: the moment shown, or at the live end.
    const hx = T === null ? W : Math.max(0, Math.min(W, x(T)));
    handle.style.transform = `translateX(${hx.toFixed(1)}px)`;
    handle.classList.toggle('live', T === null);
    track.setAttribute('aria-valuenow', String(Math.round((hx / Math.max(1, W)) * 100)));
    track.setAttribute('aria-valuetext', T === null ? t('dayLive') : hhmm(T));
    const cls = m => (m.kind === 'now' ? 'now' : m.kind === 'yesterday' || m.x < 10 ? `first${m.kind === 'yesterday' ? ' day' : ''}` : m.kind === 'today' ? 'day' : '');
    const ticksHtml = marks.map(m => `<span${cls(m) ? ` class="${cls(m)}"` : ''} style="left:${m.x.toFixed(1)}px">${esc(m.text)}</span>`).join('');
    if (ticksEl.innerHTML !== ticksHtml) ticksEl.innerHTML = ticksHtml;
    // the buttons and the clock
    const playing = rate > 0;
    for (const b of [playBtn, miniPlay]) if (b.dataset.on !== String(playing)) { b.dataset.on = String(playing); b.innerHTML = icon(playing ? 'pause' : 'play', 18); b.setAttribute('aria-label', t(playing ? 'dayPause' : 'dayPlay')); }
    if (compact) {   // (its thin timeline: the moment's place on the whole span)
      const pct = `${((T === null ? 1 : Math.max(0, Math.min(1, (T - t0) / span))) * 100).toFixed(2)}%`;
      miniTrack.style.setProperty('--at', pct);
    }
    playBtn.setAttribute('aria-pressed', String(playing));
    if (Number(speedEl.value) !== speed) speedEl.value = String(speed);
    const word = `×${SPEEDS[speed]}`;
    if (rateEl.textContent !== word) rateEl.textContent = word;
    speedEl.setAttribute('aria-valuetext', word);
    speedEl.style.setProperty('--f', String(speed / (SPEEDS.length - 1)));
    liveBtn.classList.toggle('on', T === null);
    liveBtn.setAttribute('aria-pressed', String(T === null));
    showClock();
  }
  function showClock() {
    if (T === null) return;
    const text = `${hhmm(T)} · ${t(swedishDay(T) === swedishDay(edge()) ? 'dayEarlier' : 'dayYesterday')}${rate ? ` · ×${rate}` : ''}${waiting || walking() ? ` · ${t('loading')}` : ''}`;
    if (clock.textContent !== text) clock.textContent = text;
  }
  function relabel() {
    el.setAttribute('aria-label', t('theDay'));
    track.setAttribute('aria-label', t('dayDrag'));
    el.querySelector('.day-x').setAttribute('aria-label', t('dayClose'));
    speedEl.setAttribute('aria-label', t('daySpeed'));
    delete playBtn.dataset.on;   // (its name again in the new language)
    liveBtn.lastElementChild.textContent = t('dayLive');
    liveBtn.setAttribute('aria-label', t('dayBackLive'));
    draw();
  }

  // ---------- the finger, the keys, the buttons ----------
  const atX = clientX => { const r = track.getBoundingClientRect(), t0 = startT(); return t0 + ((clientX - r.left) / Math.max(1, r.width)) * (edge() - t0); };
  let dragging = null;
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    track.setPointerCapture(e.pointerId);
    dragging = e.pointerId; track.classList.add('held');
    seek(atX(e.clientX));
  });
  track.addEventListener('pointermove', (e) => { if (dragging === e.pointerId) seek(atX(e.clientX)); });
  const let_ = (e) => { if (dragging !== e.pointerId) return; dragging = null; track.classList.remove('held'); };
  track.addEventListener('pointerup', let_);
  track.addEventListener('pointercancel', let_);
  track.addEventListener('keydown', (e) => {
    const k = e.key, step = (e.shiftKey ? 60 : 5) * 60000;
    if (k === 'End') { e.preventDefault(); live(); return; }
    if (k === 'Home') { e.preventDefault(); seek(startT()); return; }
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowDown' && k !== 'ArrowUp') return;
    e.preventDefault(); e.stopPropagation();
    const back = k === 'ArrowLeft' || k === 'ArrowDown';
    seek((T ?? edge()) + (back ? -step : step));
  });
  playBtn.addEventListener('click', (e) => { e.stopPropagation(); play(); });
  miniPlay.addEventListener('click', (e) => { e.stopPropagation(); play(); });
  el.querySelector('.day-mini-x').addEventListener('click', (e) => { e.stopPropagation(); close(); });
  el.querySelector('.day-mini').addEventListener('click', (e) => { e.stopPropagation(); setCompact(false); });
  speedEl.addEventListener('input', () => setSpeed(Number(speedEl.value)));
  liveBtn.addEventListener('click', (e) => { e.stopPropagation(); live(); });
  el.querySelector('.day-x').addEventListener('click', (e) => { e.stopPropagation(); close(); });
  // (the ribbon is over the map: its touches are its own)
  for (const type of ['pointerdown', 'wheel', 'touchstart']) el.addEventListener(type, e => e.stopPropagation(), { passive: true });

  // ---------- the bubble over a tapped train ----------
  // pick: the one train tapped (ringed and always followed: src/day.js), its label: company, number, lateness then, and
  // its trip's start → end (Max, 2026-11-27: no time, it is at the top; no Follow, "just follow whatever train is
  // selected"); else a group's trains, a row each, a tap on a row picks it.
  let bubbleIds = null, bubbleAll = null, bubbleFor = null, bubbleW = null, bubbleH = null, picked = null;
  const hold = { side: 'down', sideAt: 0, held: null };   // where it sits by its train (src/map.js labelAt)
  function bubble(ids, pick = null) {
    if (!day || T === null || !ids?.length) { hideBubble(); return; }
    const same = bubbleIds && bubbleIds[0] === ids[0] && !bubbleEl.hidden;   // (its words again: it stays where it is)
    picked = pick;
    bubbleAll = ids;
    bubbleIds = ids.slice(0, 4);
    const rows = bubbleIds.map(id => day.placeOf(id, T)).filter(Boolean);
    if (!rows.length) { hideBubble(); return; }
    const row = p => `${p.brand ? `<span class="co">${esc(p.brand)}</span>` : ''}<b>${esc(String(p.number))}</b>` +
      `<span class="m ${lateClass(p.late)}">${p.late === null || p.late === undefined ? esc(t('dayLateUnknown')) : esc(minutesText(p.late))}</span>`;
    const p0 = rows[0], ends = picked && (p0.start || p0.end) ? `${p0.start ? stationName(p0.start) : '…'} → ${p0.end ? stationName(p0.end) : '…'}` : '';
    bubbleEl.innerHTML = (picked ? `<div class="db-row">${row(rows[0])}</div>${ends ? `<div class="db-ends">${esc(ends)}</div>` : ''}`
      : rows.map(p => `<button type="button" class="db-row db-pick" data-id="${esc(String(p.id))}">${row(p)}</button>`).join('')) +
      (ids.length > bubbleIds.length ? `<div class="db-more">+${ids.length - bubbleIds.length}</div>` : '');
    bubbleEl.classList.toggle('picked', Boolean(picked));
    if (picked && walk?.id !== picked) startWalk(picked);
    bubbleEl.hidden = false;
    bubbleFor = Math.floor(T / 60000);
    bubbleW = null;   // (measured again where it is placed)
    if (!same) hold.held = null;
  }
  // The picked train's whole trip so far (Max, 2026-11-27: "Either all or nothing"): its earlier slots are fetched, newest
  // first, one at a time, until one it isn't in (or no file, or the oldest kept); meanwhile the clock says Loading and
  // no line shows. ~40 kB a slot packed (a 3-hour trip ~0.5 MB), each once a session.
  let walk = null;   // { id, s (the next slot to look at), done }
  function startWalk(id) { walk = { id, s: (T === null ? historySlot(upTo()) : historySlot(T)) - 1, done: false }; stepWalk(); }
  function stepWalk() {
    if (!walk || walk.done || !day) return;
    for (;;) {
      const s = walk.s, st = slots.get(s)?.state;
      const noFile = st === 'gap' || (sum && s >= sumFirst && !sum.has(s) && (s + 1) * HISTORY_MS <= sumAt);
      if (s < firstSlot() || noFile || (st === 'ok' && !day.inSlot(walk.id, s))) { walk.done = true; if (shown) draw(); return; }
      if (st !== 'ok') { want(s, true); return; }   // (asked for: pump() steps on when it has come)
      walk.s--;
    }
  }
  const walking = () => Boolean(picked && walk && !walk.done);
  // The line for the map: worked out again when its files change, else at most every TRAIL_MS (the line's end follows
  // the train); null while its earlier slots come, or when no train is picked.
  let trailKey = null, trailLines = null, trailAt = 0;
  function trail() {
    if (!picked || T === null || !day || walking()) { trailKey = null; trailLines = null; return null; }
    const key = `${picked}|${day.slots.length}`, now = performance.now();
    if (key === trailKey && now - trailAt < TRAIL_MS) return trailLines;
    trailKey = key; trailAt = now;
    trailLines = day.trailOf(picked, T, { budgetMs: 6 });
    return trailLines;
  }
  function hideBubble() { bubbleIds = null; picked = null; walk = null; bubbleEl.hidden = true; hold.held = null; }
  bubbleEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const row = e.target.closest('.db-pick');
    if (row) onPick(bubbleIds.find(id => String(id) === row.dataset.id) ?? row.dataset.id);
  });
  for (const type of ['pointerdown', 'wheel', 'touchstart']) bubbleEl.addEventListener(type, e => e.stopPropagation(), { passive: true });
  // Each frame and each camera move: by its (first) train's place now, as the live map's label sits by its train (under
  // it first, else above or beside it, where no station's name is; held still on whole device pixels: src/map.js
  // labelAt), its words as of the moment. Kept on the screen across (up or down) by moving along, its arrow still at
  // the train.
  let lastPlace = null;
  function placeBubble(place = lastPlace) {
    lastPlace = place;
    if (!bubbleIds || T === null || !place) return;
    const p = day.placeOf(bubbleIds[0], T);
    if (!p) { const was = picked; hideBubble(); if (was) onGone(); return; }
    if (bubbleFor !== Math.floor(T / 60000)) bubble(bubbleAll, picked);
    if (bubbleW === null) { bubbleW = bubbleEl.offsetWidth; bubbleH = bubbleEl.offsetHeight; }
    const was = hold.side;
    place(hold, p.lon, p.lat, bubbleW, bubbleH);
    if (hold.side !== was || !bubbleEl.classList.contains(`s-${hold.side}`)) {
      bubbleEl.classList.remove('s-down', 's-up', 's-right', 's-left');
      bubbleEl.classList.add(`s-${hold.side}`);
    }
    const { x, y } = hold.held, across = hold.side === 'down' || hold.side === 'up';
    const left = across ? Math.max(8, Math.min(innerWidth - bubbleW - 8, x)) : x;
    bubbleEl.style.transform = `translate(${left}px, ${y}px)`;
    // its arrow at the train: across, where the train is along it; beside, at its middle
    const ax = across ? Math.round(Math.max(14, Math.min(bubbleW - 14, x + bubbleW / 2 - left))) : null;
    const axText = ax === null ? '' : `${ax}px`;
    if (bubbleEl.style.getPropertyValue('--ax') !== axText) { if (ax === null) bubbleEl.style.removeProperty('--ax'); else bubbleEl.style.setProperty('--ax', axText); }
  }

  // ---------- open and close ----------
  function open() {
    if (!day) day = createDayTrains({ net: net() });
    if (shown) return;
    shown = true;
    el.hidden = false;
    // (it fades in where it is, already in its place: ☰'s menu went at once, src/nav-menu.js)
    if (!reduceMotion()) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms('fold') * 0.6, easing: 'linear' });
    root.classList.add('day-open');
    relabel();
    keepUp();
    // the live end moves on; a slot that has just finished comes when it is there
    timer = setInterval(() => { if (!document.hidden) { keepUp(); draw(); } }, 1000);
  }
  function close() {
    if (!shown) return;
    live();
    setCompact(false);
    shown = false;
    el.hidden = true;
    root.classList.remove('day-open');
    clearInterval(timer);
    onClose();
  }

  return {
    el, open, close, live, seek, play, setSpeed, tick, relabel, draw, bubble, hideBubble, placeBubble, trail,
    at: (at, near) => (day ? day.at(at, { near, budgetMs: 6 }) : []),   // (6 ms a frame for new ways along the rails)
    placeOf: id => (day && T !== null ? day.placeOf(id, T) : null),     // (one train at the moment shown)
    get isOpen() { return shown; },
    get compact() { return compact; },
    expand: () => setCompact(false),
    get past() { return T !== null; },
    get moment() { return T; },
    get rate() { return rate; },
    get speed() { return SPEEDS[speed]; },
    get picked() { return picked; },
    get bubbleShown() { return Boolean(bubbleIds); },
    // A train's company and trip ends at the moment shown (the computer's label under the mouse, src/map.js hoverMore)
    aboutOf(id) { const p = day && T !== null ? day.placeOf(id, T) : null; return p && { company: p.brand ?? '', ends: p.start || p.end ? `${p.start ? stationName(p.start) : '…'} → ${p.end ? stationName(p.end) : '…'}` : '' }; },
    // For the checks (tools/day-check.mjs): what each slot holds and the ribbon's span.
    state: () => ({ open: shown, T, rate, waiting, start: startT(), upTo: upTo(), edge: edge(),
      slots: Object.fromEntries([...slots].map(([s, v]) => [s, v.state])), trains: day?.size ?? 0,
      overview: sum ? [...sum.keys()] : null, side: bubbleIds ? hold.side : null, walking: walking(), compact }),
  };
}
