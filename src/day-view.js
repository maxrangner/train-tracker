// The day, the page side (build plan part 4, 2026-11-23; Max, 2026-11-22: "map only", no cards or boards for the past).
// ☰ → The day opens a ribbon just above the search bar: today from 04:00 (or the first history file) to now, one bar
// per 15-minute slot (the history files' own: how many trains were on the map, coloured by their lateness), a handle to
// drag back in time, play/pause, a speed slider (×1 real time, ×10, ×60, ×180, ×600; Max, 2026-11-27: "Maybe just a
// play, pause and a slider for speed? And the x, live and timeline of course") and Live back to now. A slot with no
// file is a striped gap. While it shows an earlier moment the map has a coloured frame and "14:32 · earlier today" at
// the top (where the live mark is), the trains come from src/day-trains.js (the live engine runs on underneath,
// untouched), and a tap on a train shows a small bubble (number, company, lateness then, Follow) instead of its card;
// several (a group) one row each, a row picks that train (src/day.js: the ring and the following, as live).
//
// Only the slots needed are fetched first (the handle's slot and its neighbours, the slots a play is heading into);
// while the ribbon stays open the rest of the day follows in the background, newest first, two at a time, so the bars
// fill in. A whole day is about 3 MB packed (docs/data.md "The day"); each file once per session (files-source.js keeps
// them in a store of their own).
//   const day = createDayView({ history, now, delay, net, onMode, onClose, following, onFollow, onPick, onGone })
//     history(from, to): src/files-source.js history(); now(): the page's clock; delay: how far the live map is drawn
//     behind (ms); net(): the rail network or null; onMode(past, picked): the map turned to an earlier moment (true)
//     or back to live (false; picked: the train picked then, or null); onClose(): the ribbon closed; following() -> bool: the map follows the picked train;
//     onFollow(): its bubble's Follow pressed; onPick(id): a row of a group's bubble tapped; onGone(): the picked
//     train's bubble went by itself (its history ends there).
//   day.open() / day.close() / day.live() / day.seek(T) / day.play() (play or pause) / day.setSpeed(i) (SPEEDS[i])
//   day.tick(ts) each frame: moves the moment on while playing; true when it moved
//   day.at(T, near) the trains at T (src/day-trains.js at; near(lon, lat): only those are routed along the rails)
//   day.bubble(ids, picked) / day.hideBubble() / day.placeBubble(project) / day.picked: the small bubble over a tapped
//   train (picked: that train is ringed and its bubble has Follow)
import { createDayTrains } from './day-trains.js';
import { HISTORY_MS, historySlot } from './live-file.js';
import { hhmm, swedishDay, midnightOf, addDays } from './clock.js';
import { lateClass } from './lateness.js';
import { minutesText } from './tag.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { esc } from './html.js';

// The play speeds: real time, then ten minutes a minute, an hour a minute, three hours a minute, ten hours a minute.
export const SPEEDS = [1, 10, 60, 180, 600];
const FIRST_SPEED = 2;                // (×60 until another is chosen, for this visit)
const BACK_FROM_LIVE = 3600000;       // play pressed at the live end: from an hour back
const AT_ONCE = 2;                    // files asked at the same time
const FROM_HOUR = 4;                  // the ribbon starts at 04:00 (before 04:15: yesterday's 04:00)
const RETRY_MS = 30000;               // a slot just finished whose file isn't there yet: asked again this often
const FRESH_MS = 8 * 60000;           // ... for this long after its end (the fetcher writes it, then uploads it)
const AHEAD_S = 25;                   // a play fetches the slots it reaches within this many seconds

export function createDayView({ history, now, delay, net, onMode = () => {}, onClose = () => {}, following = () => false, onFollow = () => {}, onPick = () => {}, onGone = () => {} }) {
  const root = document.documentElement;
  let day = null;                     // src/day-trains.js, made at the first open (the rail network is there by then)
  let shown = false, T = null, rate = 0, speed = FIRST_SPEED, lastTs = null, waiting = false, timer = null;
  const slots = new Map();            // slot -> { state: 'loading' | 'ok' | 'gap', n, c: { ontime, some, late, unknown }, at }
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
    '<button type="button" class="day-live"><i></i><span></span></button></div><div class="day-ticks"></div>';
  const track = el.querySelector('.day-track'), canvas = track.querySelector('canvas'), handle = track.querySelector('.day-handle');
  const ticksEl = el.querySelector('.day-ticks'), liveBtn = el.querySelector('.day-live');
  const playBtn = el.querySelector('.day-play'), speedEl = el.querySelector('.day-speed'), rateEl = el.querySelector('.day-rate');
  const clock = Object.assign(document.createElement('div'), { id: 'day-clock', hidden: true });
  clock.setAttribute('aria-live', 'polite');
  const frameEl = Object.assign(document.createElement('div'), { id: 'day-frame', hidden: true });
  const bubbleEl = Object.assign(document.createElement('div'), { id: 'day-bubble', hidden: true });
  document.body.append(frameEl, clock, el, bubbleEl);

  // ---------- the time line ----------
  const edge = () => now() - delay;                                     // the live map's moment
  const upTo = () => historySlot(edge()) * HISTORY_MS;                  // the end of the newest finished slot
  // The day from 04:00 (the trains' own day: a night train after midnight still belongs to the evening before); before
  // 04:15, yesterday's (its files are kept until 01:00, so after that the ribbon starts at the first file there is).
  const dayStart = () => {
    const today = swedishDay(edge()), f = midnightOf(today) + FROM_HOUR * 3600000;
    return edge() >= f + HISTORY_MS ? f : midnightOf(addDays(today, -1)) + FROM_HOUR * 3600000;
  };
  // The ribbon's start: 04:00, or later where the files only begin later (the slots before the first file all gaps).
  function startT() {
    let s = historySlot(dayStart());
    const last = historySlot(upTo()) - 1;
    while (s < last && slots.get(s)?.state === 'gap') s++;
    return s * HISTORY_MS;
  }
  const lastDone = () => historySlot(upTo()) - 1;

  // ---------- the files ----------
  function retryable(s, slot) { return s.state === 'gap' && Date.now() - s.at > RETRY_MS && Date.now() - (slot + 1) * HISTORY_MS < FRESH_MS + delay; }
  function want(slot, first = false) {
    if (slot < historySlot(dayStart()) - 1 || slot > lastDone()) return;
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
        if (x?.rows) { day.add(x); slots.set(slot, { state: 'ok', ...statsOf(x.rows) }); }
        else slots.set(slot, { state: 'gap', at: Date.now() });
      }).catch(() => slots.set(slot, { state: 'gap', at: Date.now() }))
        .finally(() => { active--; if (shown) draw(); pump(); });
    }
  }
  // A slot's bar: its trains, by their lateness at their last point in it.
  function statsOf(rows) {
    const c = { ontime: 0, some: 0, late: 0, unknown: 0 };
    for (const row of rows) {
      const lates = row[10] ?? [];
      let m = null;
      for (let i = lates.length - 1; i >= 0; i--) if (lates[i] !== null && lates[i] !== undefined) { m = lates[i]; break; }
      c[lateClass(m)]++;
    }
    return { n: rows.length, c };
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
  function fillDay() { for (let s = lastDone(); s >= historySlot(dayStart()); s--) want(s); }

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
  function live() {
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
    waiting = !ready(T);
    if (waiting) { need(T); return false; }
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
    let most = 1;
    for (const [s, v] of slots) if (v.state === 'ok' && s * HISTORY_MS >= t0) most = Math.max(most, v.n);
    const col = { ontime: css('--c-ontime'), some: css('--c-some'), late: css('--c-late'), unknown: css('--c-unknown') };
    const line = css('--line') || '#ccc', muted = css('--muted') || '#888';
    for (let s = historySlot(t0); s * HISTORY_MS < end; s++) {
      const a = x(s * HISTORY_MS) + 0.5, b = x((s + 1) * HISTORY_MS) - 0.5, w = Math.max(1, b - a), v = slots.get(s);
      if (!v || v.state === 'loading') {
        g.fillStyle = line; g.fillRect(a, base - 3, w, 3);
      } else if (v.state === 'gap') {
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
    // Not in the files yet (the slot running now, and the live map's moment): the live end, in the accent.
    const live0 = x(end);
    g.fillStyle = css('--accent'); g.globalAlpha = 0.18; g.fillRect(live0, top, Math.max(2, W - live0), full); g.globalAlpha = 1;
    // The handle: the moment shown, or at the live end.
    const hx = T === null ? W : Math.max(0, Math.min(W, x(T)));
    handle.style.transform = `translateX(${hx.toFixed(1)}px)`;
    handle.classList.toggle('live', T === null);
    track.setAttribute('aria-valuenow', String(Math.round((hx / Math.max(1, W)) * 100)));
    track.setAttribute('aria-valuetext', T === null ? t('dayLive') : hhmm(T));
    // The hours under it, as many as fit.
    const hours = span / 3600000, step = [1, 2, 3, 4, 6].find(k => (W / hours) * k >= 44) ?? 6;
    const first = Math.ceil(t0 / 3600000) * 3600000, ticks = [];
    for (let at = first; at < t1 - 0.4 * 3600000 * step; at += 3600000) {
      const hh = Number(hhmm(at).slice(0, 2));
      if (hh % step) continue;
      const xa = x(at);
      if (xa > W - 34) continue;   // (clear of "now")
      ticks.push(`<span${xa < 10 ? ' class="first"' : ''} style="left:${xa.toFixed(1)}px">${hhmm(at).slice(0, 2)}</span>`);
    }
    ticks.push(`<span class="now" style="left:${W}px">${esc(t('dayNow'))}</span>`);
    ticksEl.innerHTML = ticks.join('');
    // the buttons and the clock
    const playing = rate > 0;
    if (playBtn.dataset.on !== String(playing)) { playBtn.dataset.on = String(playing); playBtn.innerHTML = icon(playing ? 'pause' : 'play', 18); playBtn.setAttribute('aria-label', t(playing ? 'dayPause' : 'dayPlay')); }
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
    const text = `${hhmm(T)} · ${t(swedishDay(T) === swedishDay(edge()) ? 'dayEarlier' : 'dayYesterday')}${rate ? ` · ×${rate}` : ''}${waiting ? ` · ${t('dayLoading')}` : ''}`;
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
  speedEl.addEventListener('input', () => setSpeed(Number(speedEl.value)));
  liveBtn.addEventListener('click', (e) => { e.stopPropagation(); live(); });
  el.querySelector('.day-x').addEventListener('click', (e) => { e.stopPropagation(); close(); });
  // (the ribbon is over the map: its touches are its own)
  for (const type of ['pointerdown', 'wheel', 'touchstart']) el.addEventListener(type, e => e.stopPropagation(), { passive: true });

  // ---------- the bubble over a tapped train ----------
  // pick: the one train tapped (ringed and followed: src/day.js), its bubble with Follow; else a group's trains, a row
  // each, a tap on a row picks it.
  let bubbleIds = null, bubbleAll = null, bubbleFor = null, bubbleW = null, picked = null, bubbleFollow = null;
  function bubble(ids, pick = null) {
    if (!day || T === null || !ids?.length) { hideBubble(); return; }
    picked = pick;
    bubbleAll = ids;
    bubbleIds = ids.slice(0, 4);
    const rows = bubbleIds.map(id => day.placeOf(id, T)).filter(Boolean);
    if (!rows.length) { hideBubble(); return; }
    const row = p => `${p.brand ? `<span class="co">${esc(p.brand)}</span>` : ''}<b>${esc(String(p.number))}</b>` +
      `<span class="m ${lateClass(p.late)}">${p.late === null || p.late === undefined ? esc(t('dayLateUnknown')) : esc(minutesText(p.late))}</span>`;
    const on = following();
    bubbleEl.innerHTML = (picked ? `<div class="db-row">${row(rows[0])}</div>`
      : rows.map(p => `<button type="button" class="db-row db-pick" data-id="${esc(String(p.id))}">${row(p)}</button>`).join('')) +
      (ids.length > bubbleIds.length ? `<div class="db-more">+${ids.length - bubbleIds.length}</div>` : '') +
      `<small>${esc(t('dayThen', hhmm(T)))}</small>` +
      (picked ? `<button type="button" class="sh-follow db-follow" aria-pressed="${on}">${icon('follow', 18)}<span>${esc(t(on ? 'following' : 'follow'))}</span></button>` : '');
    bubbleFollow = picked ? on : null;
    bubbleEl.classList.toggle('picked', Boolean(picked));
    bubbleEl.hidden = false;
    bubbleFor = Math.floor(T / 60000);
    bubbleW = null;   // (measured again where it is placed)
  }
  function hideBubble() { bubbleIds = null; picked = null; bubbleEl.hidden = true; }
  bubbleEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('.db-follow')) { onFollow(); return; }
    const row = e.target.closest('.db-pick');
    if (row) onPick(bubbleIds.find(id => String(id) === row.dataset.id) ?? row.dataset.id);
  });
  for (const type of ['pointerdown', 'wheel', 'touchstart']) bubbleEl.addEventListener(type, e => e.stopPropagation(), { passive: true });
  // Each frame: over its (first) train's place now, its words as of the moment; kept on the screen, its point over the
  // train.
  function placeBubble(project) {
    if (!bubbleIds || T === null) return;
    const p = day.placeOf(bubbleIds[0], T);
    if (!p) { const was = picked; hideBubble(); if (was) onGone(); return; }
    if (bubbleFor !== Math.floor(T / 60000) || (picked && bubbleFollow !== following())) bubble(bubbleAll, picked);
    const at = project(p.lon, p.lat);
    bubbleW ??= bubbleEl.offsetWidth;
    const left = Math.max(8, Math.min(innerWidth - bubbleW - 8, at.x - bubbleW / 2));
    bubbleEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(at.y)}px) translateY(calc(-100% - 14px))`;
    bubbleEl.style.setProperty('--ax', `${Math.round(Math.max(14, Math.min(bubbleW - 14, at.x - left)))}px`);
  }

  // ---------- open and close ----------
  function open() {
    if (!day) day = createDayTrains({ net: net() });
    if (shown) return;
    shown = true;
    el.hidden = false;
    root.classList.add('day-open');
    relabel();
    fillDay();
    // the live end moves on; a slot that has just finished comes when it is there
    timer = setInterval(() => { if (!document.hidden) { fillDay(); draw(); } }, 1000);
  }
  function close() {
    if (!shown) return;
    live();
    shown = false;
    el.hidden = true;
    root.classList.remove('day-open');
    clearInterval(timer);
    onClose();
  }

  return {
    el, open, close, live, seek, play, setSpeed, tick, relabel, draw, bubble, hideBubble, placeBubble,
    at: (at, near) => (day ? day.at(at, { near, budgetMs: 6 }) : []),   // (6 ms a frame for new ways along the rails)
    placeOf: id => (day && T !== null ? day.placeOf(id, T) : null),     // (one train at the moment shown)
    get isOpen() { return shown; },
    get past() { return T !== null; },
    get moment() { return T; },
    get rate() { return rate; },
    get speed() { return SPEEDS[speed]; },
    get picked() { return picked; },
    get bubbleShown() { return Boolean(bubbleIds); },
    // For the checks (tools/day-check.mjs): what each slot holds and the ribbon's span.
    state: () => ({ open: shown, T, rate, waiting, start: startT(), upTo: upTo(), edge: edge(),
      slots: Object.fromEntries([...slots].map(([s, v]) => [s, v.state])), trains: day?.size ?? 0 }),
  };
}
