// The one sheet and its stack of pages (Max's pick A, "One sheet", 2026-11-22; the sketch:
// docs/reviews/2026-11-22-ui/design/sketch/dir-a-sheet.js). One sheet never leaves the bottom of the screen (on a
// computer, 440 px wide and up, it floats at the bottom left, 420 px wide). Everything opened is a page in it, on a
// stack: Home at the bottom, then a train, a station's board, a disruption, a company, Settings... Each page has a
// key ('home', 'train:<id>', 'station:<sig>', 'dis:<id>', 'dislist', 'co:<brand>', 'kind:<k>', 'late', 'still',
// 'pick:<ids>', 'page:settings', 'page:help', 'page:conn'); the page under the top one names the back chip
// ("‹ Stockholm C"), and holding the chip shows the whole trail. This replaces the ten sheets that each showed and hid
// themselves (src/sheet.js before 2026-11-22): there is one screen state, the stack.
//
// Three resting heights: low (at Home only the search bar and ☰; a page: its bar and its first line), half and full.
// The finger moves the sheet from anywhere on it; at full a finger scrolls the page, and a pull down from the page's
// top moves the sheet. A long pull down below low closes every page (back to Home).
//
// createStack({ sheet, define, onPad, onChange }) -> the stack (see the end).
//   define(key) -> a page, or null when the key names nothing (a train gone, a disruption ended):
//     { name: string | () => string (the back chip's word for it), kind ('home', 'train', 'station', ... : the
//       sheet's data-page), low: px (its low height; default the page low), mount(el) (once, when made),
//       show(el, { dir, prev, first, ...opts }) (each time it comes on top: dir 1 opened, -1 back to it; prev: the page
//       it came from, { key, kind }), hide() (covered or gone), unmount() (taken off the stack), level(i) (the sheet
//       came to rest at height i), every() (once a second while it is on top), star: { on(), toggle() } and follow:
//       { can(), on(), toggle() } for the bar's ☆ and Follow }
//   onPad(h): the map's free part is above this many pixels (the sheet's resting height, at most half): src/map.js setSheet.
//   onChange(top): a page came on top (the map's lit trains, the line above the bar).
import { reduceMotion } from './motion.js';
import { icon } from './icons.js';
import { esc } from './html.js';
import { t } from './i18n.js';

const NARROW = typeof matchMedia === 'function' ? matchMedia('(max-width: 439px)') : null;
const MAX_PAGES = 12;          // pages over Home at most (the oldest go)
const HOLD_MS = 480;           // holding the back chip this long shows the trail
const HEAD_PX = 72;            // the handle and the head (search or back chip)
const PAGE_LOW_PX = 140;       // a page resting low: its bar and its first line
const TOP_ROOM_PX = 52;        // full height leaves this much at the top (the live mark)

export function createStack({ sheet, define, onPad = () => {}, onChange = () => {} }) {
  const root = document.documentElement;
  const pagesEl = sheet.querySelector('.sh-pages');
  const input = sheet.querySelector('#search');
  const results = sheet.querySelector('#search-results');
  const backBtn = sheet.querySelector('.sh-back'), backLab = backBtn.querySelector('span');
  const starBtn = sheet.querySelector('.sh-star'), folBtn = sheet.querySelector('.sh-follow');
  const trail = Object.assign(document.createElement('div'), { id: 'trail', className: 'pop', hidden: true });
  trail.setAttribute('role', 'menu');
  document.body.append(trail);
  // the safe areas (a phone's rounded corners and bars): read once from CSS
  const probe = Object.assign(document.createElement('div'), { style: 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)' });
  document.body.append(probe);
  const safe = () => { const s = getComputedStyle(probe); return { top: parseFloat(s.paddingTop) || 0, bottom: parseFloat(s.paddingBottom) || 0 }; };

  const stack = [];          // [{ key, def, el, scroll, lvl }]
  const top = () => stack[stack.length - 1];
  let idx = 0, H = [HEAD_PX, 400, 800], searching = false, preSearch = 0, ready = false;
  let drag = null, touching = false, lastScroll = 0, eatUntil = 0, holdT = 0, holdFired = false;
  const wide = () => !NARROW?.matches;

  // ---------- heights ----------
  const lowOf = pg => (pg?.def.low ?? (pg?.key === 'home' ? HEAD_PX : PAGE_LOW_PX)) + (wide() ? 0 : safe().bottom);
  // A phone: the sheet is as tall as its tallest rest, slid down to the height shown (only its transform moves). A wider
  // screen: it floats 10 px above the bottom, so it takes the height shown itself (sliding it down would show its
  // lower part in that gap).
  const shownH = () => (wide() ? sheet.getBoundingClientRect().height : H[2] - new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42);
  function place(h, glide = true) {
    sheet.classList.toggle('dragging', !glide);
    if (wide()) { sheet.style.transform = ''; sheet.style.height = `${Math.round(h)}px`; }
    else { sheet.style.height = `${H[2]}px`; sheet.style.transform = `translateY(${Math.round(H[2] - h)}px)`; }
    const lvl = h < H[0] + 28 ? 'low' : h > (H[1] + H[2]) / 2 ? 'full' : 'half';
    sheet.dataset.lvl = lvl;
    root.style.setProperty('--sheet-shown', `${Math.round(h)}px`);
    // the map's buttons and its credit ride on the sheet's top edge (a phone); beside it on a wide screen
    root.style.setProperty('--sheet-h', wide() ? '0px' : `${Math.round(h)}px`);
    root.classList.toggle('sheet-tall', !wide() && h > innerHeight - 260);
    root.classList.toggle('sheet-high', h > H[1] + 70);
  }
  function pad() { if (ready) onPad(Math.min(H[idx], H[1])); }
  function measure() {
    const h = innerHeight, s = safe();
    const full = wide() ? h - 20 : h - TOP_ROOM_PX - s.top;
    H = [lowOf(top()), Math.round(Math.min(h * 0.6, Math.max(h * 0.5, 360), full - 40)), Math.round(full)];
    place(H[idx], false);
    sheet.getBoundingClientRect();
    sheet.classList.remove('dragging');
    pad();
  }
  addEventListener('resize', measure);
  NARROW?.addEventListener('change', measure);

  function setIndex(i, { still = false } = {}) {
    idx = Math.max(0, Math.min(2, i));
    sheet.dataset.h = String(idx);
    sheet.classList.remove('closing');
    if (idx < 2 && searching) closeSearch();
    const pg = top();
    if (!searching && pg) pg.lvl = idx;
    if (idx < 2) { const s = scroller(); if (s && s.scrollTop > 0) s.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); }
    place(H[idx]);
    if (!still) pad();
    if (!searching) pg?.def.level?.(idx);
  }
  const scroller = () => (searching ? results : top()?.el);

  // ---------- the finger: from anywhere on the sheet (A's drag) ----------
  function dragBegin(y, id) { drag = { y0: y, h0: shownH(), h: null, moved: false, ly: y, lt: performance.now(), v: 0, id }; }
  function dragMove(y) {
    if (!drag) return false;
    if (!drag.moved) { if (Math.abs(drag.y0 - y) < 8) return false; drag.moved = true; drag.y0 = y; clearTimeout(holdT); closeTrail(); }
    let h = drag.h0 + (drag.y0 - y);
    if (h > H[2]) h = H[2] + (h - H[2]) * 0.2;
    if (h < H[0]) h = H[0] - (H[0] - h) * 0.6;
    h = Math.max(48, h);
    const now = performance.now(), dt = now - drag.lt;
    if (dt > 4) { drag.v = 0.65 * ((drag.ly - y) / dt) + 0.35 * drag.v; drag.ly = y; drag.lt = now; }
    drag.h = h;
    place(h, false);
    const closing = stack.length > 1 && h < H[0] - 30;
    if (closing !== sheet.classList.contains('closing')) {
      sheet.classList.toggle('closing', closing);
      backLab.textContent = closing ? t('home') : nameOf(stack[stack.length - 2]);
    }
    return true;
  }
  function dragEnd() {
    const d = drag;
    drag = null; touching = false;
    if (!d || !d.moved) return;
    eatUntil = performance.now() + 150;
    const h = d.h ?? d.h0;
    if (sheet.classList.contains('closing')) { home(0); return; }
    let to;
    // A finger that stopped before it lifted throws nothing: the nearest height (2026-11-23, sheet-check: a pull held
    // still at 60 px below its start was thrown on by the speed of its last move).
    const v = performance.now() - d.lt > 120 ? 0 : d.v;
    if (Math.abs(v) > 0.45) {
      to = v > 0 ? H.findIndex(x => x > h + 6) : H.length - 1 - [...H].reverse().findIndex(x => x < h - 6);
      if (to < 0 || to > 2) to = v > 0 ? 2 : 0;
    } else { to = 0; H.forEach((x, i) => { if (Math.abs(x - h) < Math.abs(H[to] - h)) to = i; }); }
    setIndex(to);
  }
  sheet.addEventListener('pointerdown', (e) => {
    closeTrail(e.target);
    touching = true;
    if ((e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('input, select, textarea, label.sh-field')) return;
    const head = e.target.closest('.sh-grab, .sh-head'), full = idx === 2;
    if (!head && full && e.pointerType !== 'mouse') return;   // at full a finger scrolls the page; touchmove below takes a pull down from its top
    dragBegin(e.clientY, e.pointerId);
    drag.x0 = e.clientX;
    drag.body = !head && full;
  });
  const pointerMove = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dy = e.clientY - drag.y0;
    if (drag.body && !drag.moved && (scroller().scrollTop > 0 || dy < 7)) return;
    dragMove(e.clientY);
  };
  const pointerEnd = (e) => { touching = false; if (!drag || drag.id !== e.pointerId) return; dragEnd(); };
  document.addEventListener('pointermove', pointerMove);
  document.addEventListener('pointerup', pointerEnd);
  document.addEventListener('pointercancel', pointerEnd);
  // A finger on the page at full height: pulling down from the page's top moves the sheet, anything else scrolls.
  let tch = null;
  sheet.addEventListener('touchstart', (e) => {
    tch = idx === 2 && e.touches.length === 1 && !e.target.closest('.sh-grab, .sh-head, input')
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY, top: (scroller()?.scrollTop ?? 0) <= 0, on: false } : null;
    touching = true;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!tch) return;
    const y = e.touches[0].clientY, dy = y - tch.y, dx = e.touches[0].clientX - tch.x;
    if (!tch.on) {
      if (!tch.top || !e.cancelable || dy < -3 || Math.abs(dx) > Math.abs(dy) + 2) { tch = null; return; }
      if (dy <= 0) return;
      e.preventDefault();
      if (dy < 7) return;
      tch.on = true;
      dragBegin(tch.y, -1);
    }
    e.preventDefault();
    dragMove(y);
  }, { passive: false });
  const touchEnd = () => { touching = false; if (tch?.on) dragEnd(); tch = null; };
  sheet.addEventListener('touchend', touchEnd);
  sheet.addEventListener('touchcancel', touchEnd);
  sheet.addEventListener('scroll', () => { lastScroll = performance.now(); }, true);
  // A wheel over a sheet that isn't at full raises it a step (a mouse has no pull).
  let wheelAt = 0;
  sheet.addEventListener('wheel', (e) => {
    if (idx === 2 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (e.deltaY > 0 && performance.now() - wheelAt > 450) { wheelAt = performance.now(); setIndex(idx + 1); }
  }, { passive: false });
  // A drag's click is no tap; a tap on the handle steps the sheet up; on the page at low, it rises to half.
  sheet.addEventListener('click', (e) => {
    if (performance.now() < eatUntil) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.closest('.sh-grab')) { setIndex((idx + 1) % 3); return; }
    if (idx === 0 && !searching && e.target.closest('.pg') && !e.target.closest('button, a, input, [role="button"]')) setIndex(1);
  }, true);

  // ---------- the pages ----------
  const nameOf = pg => (typeof pg.def.name === 'function' ? pg.def.name() : pg.def.name) ?? '';
  function make(key, def) {
    const el = document.createElement('div');
    el.className = 'pg';
    el.dataset.key = key;
    el.dataset.kind = def.kind ?? key.split(':')[0];
    const pg = { key, def, el, scroll: 0, lvl: 1 };
    def.mount?.(el, pg);
    return pg;
  }
  // The bar over a page: the back chip naming the page under it, ☆ and Follow when the page has them.
  function syncBar() {
    const pg = top();
    if (!pg) return;
    sheet.dataset.page = pg.def.kind ?? pg.key.split(':')[0];
    if (pg.key === 'home') return;
    const under = stack[stack.length - 2];
    const word = nameOf(under);
    if (!sheet.classList.contains('closing') && backLab.textContent !== word) backLab.textContent = word;
    const aria = t('backTo', word);
    if (backBtn.getAttribute('aria-label') !== aria) backBtn.setAttribute('aria-label', aria);
    const star = pg.def.star, on = Boolean(star?.on());
    starBtn.hidden = !star;
    if (star && starBtn.getAttribute('aria-pressed') !== String(on)) {
      starBtn.innerHTML = icon(on ? 'starFilled' : 'star', 22);
      starBtn.setAttribute('aria-pressed', String(on));
      starBtn.setAttribute('aria-label', t(on ? 'starOn' : 'starOff'));
    }
    const fol = pg.def.follow, can = Boolean(fol?.can()), following = can && fol.on();
    folBtn.hidden = !can;
    if (can && folBtn.getAttribute('aria-pressed') !== String(following)) {
      folBtn.setAttribute('aria-pressed', String(following));
      folBtn.lastElementChild.textContent = t(following ? 'following' : 'follow');
    }
  }
  function show(pg, prev, dir, opts = {}) {
    if (prev) { prev.scroll = prev.el.scrollTop; prev.def.hide?.(); }
    const old = prev?.el;
    if (old && old !== pg.el) {
      old.classList.remove('in-r', 'in-l');
      if (reduceMotion()) old.remove();
      else { old.classList.add(dir > 0 ? 'out-l' : 'out-r'); setTimeout(() => { if (top()?.el !== old) old.remove(); old.classList.remove('out-l', 'out-r'); }, 200); }
    }
    pg.el.classList.remove('out-l', 'out-r');
    if (prev && !reduceMotion()) {
      pg.el.classList.add(dir > 0 ? 'in-r' : 'in-l');
      const el0 = pg.el;
      setTimeout(() => el0.classList.remove('in-r', 'in-l'), 400);
    }
    pagesEl.append(pg.el);
    H[0] = lowOf(pg);
    syncBar();
    const level = opts.level ?? (dir > 0 ? Math.max(1, pg.def.startLevel ?? 1) : pg.lvl ?? 1);
    pg.def.show?.(pg.el, { dir, prev: prev ? { key: prev.key, kind: prev.def.kind ?? prev.key.split(':')[0] } : null, ...opts });
    setIndex(pg.key === 'home' && dir < 0 && opts.level === undefined ? Math.min(level, idx) : level);
    pg.el.scrollTop = dir < 0 && idx === 2 ? pg.scroll ?? 0 : 0;
    syncBar();
    onChange(pg);
  }
  // Open the page with this key (a page already on the stack: back to it).
  function open(key, opts = {}) {
    closeTrail();
    if (searching) closeSearch();
    const at = stack.findIndex(p => p.key === key);
    if (at >= 0 && at === stack.length - 1) {   // it is open: up to half, shown again
      if (idx === 0) setIndex(1);
      top().def.show?.(top().el, { dir: 0, prev: null, again: true, ...opts });
      syncBar();
      return true;
    }
    if (at >= 0) { backTo(at, opts.level); return true; }
    const def = define(key);
    if (!def) return false;
    const prev = top(), pg = make(key, def);
    stack.push(pg);
    while (stack.length > MAX_PAGES + 1) { const gone = stack.splice(1, 1)[0]; gone.def.unmount?.(); gone.el.remove(); }
    recent(key);
    show(pg, prev, 1, opts);
    return true;
  }
  // Back to the page at i (everything above it goes).
  function backTo(i, level) {
    if (i >= stack.length - 1 || i < 0) return;
    const prev = top();
    const gone = stack.splice(i + 1);
    show(top(), prev, -1, level === undefined ? {} : { level });
    for (const p of gone) { if (p !== prev) p.def.hide?.(); p.def.unmount?.(); if (p.el !== top().el) setTimeout(() => p.el.remove(), reduceMotion() ? 0 : 220); }
  }
  function home(level) { if (stack.length > 1) backTo(0, level); else setIndex(level ?? idx); }
  // One step back: the search, the trail, a page, then the sheet down to rest. false: nothing left (Android: the app
  // goes to the background).
  function back() {
    if (!trail.hidden) { closeTrail(); return true; }
    if (searching) { closeSearch(); setIndex(preSearch); return true; }
    if (stack.length > 1) { backTo(stack.length - 2); return true; }
    if (idx > 0) { setIndex(0); return true; }
    return false;
  }
  // Take a page off the stack wherever it is (its train is gone, its × was pressed).
  function close(key) {
    const i = stack.findIndex(p => p.key === key);
    if (i <= 0) return;
    if (i === stack.length - 1) { backTo(i - 1); return; }
    const [p] = stack.splice(i, 1);
    p.def.unmount?.();
    p.el.remove();
    syncBar();
  }
  // Swap the top page for another (a train's trip handed on to its next number), at the same height.
  function replace(key, opts = {}) {
    const def = define(key);
    if (!def || stack.length < 2) return open(key, opts);
    const prev = stack.pop();
    const pg = make(key, def);
    stack.push(pg);
    show(pg, prev, 0, { level: idx, ...opts });
    prev.def.unmount?.();
    return true;
  }

  // The pages opened lately (the empty search's "Recent"), newest first.
  const lately = [];
  function recent(key) {
    if (key === 'home' || key.startsWith('page:') || key.startsWith('pick:')) return;
    const i = lately.indexOf(key);
    if (i >= 0) lately.splice(i, 1);
    lately.unshift(key);
    lately.length = Math.min(lately.length, 5);
  }

  // ---------- search: in the sheet's head; it raises the sheet to full ----------
  let onSearch = () => {};
  function openSearch() {
    if (searching || top()?.key !== 'home') return;
    preSearch = idx;
    searching = true;
    sheet.dataset.search = '';
    results.hidden = false;
    pagesEl.append(results);
    onSearch(true);
    idx = 2; sheet.dataset.h = '2';
    place(H[2]);
    results.scrollTop = 0;
  }
  function closeSearch() {
    if (!searching) return;
    searching = false;
    delete sheet.dataset.search;
    results.hidden = true;
    if (input.value) input.value = '';
    if (document.activeElement === input) input.blur();
    onSearch(false);
  }
  input.addEventListener('focus', openSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); setIndex(preSearch); } });
  sheet.querySelector('.sh-cancel').addEventListener('click', () => { closeSearch(); setIndex(preSearch); });

  // ---------- the bar ----------
  backBtn.addEventListener('click', () => { if (holdFired) { holdFired = false; return; } backTo(stack.length - 2); });
  backBtn.addEventListener('pointerdown', () => {
    holdFired = false;
    clearTimeout(holdT);
    holdT = setTimeout(() => { if (stack.length < 2) return; holdFired = true; openTrail(); }, HOLD_MS);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) backBtn.addEventListener(ev, () => clearTimeout(holdT));
  backBtn.addEventListener('contextmenu', e => e.preventDefault());
  starBtn.addEventListener('click', () => { top()?.def.star?.toggle(); syncBar(); });
  folBtn.addEventListener('click', () => { top()?.def.follow?.toggle(); syncBar(); });

  // The trail: every page under the top one, newest first; a tap goes back to it.
  function openTrail() {
    trail.innerHTML = `<small>${esc(t('backToShort'))}</small>` + stack.slice(0, -1).map((p, i) => ({ p, i })).reverse()
      .map(({ p, i }) => `<button type="button" role="menuitem" data-trail="${i}">${icon('back', 18)}<span>${esc(nameOf(p))}</span></button>`).join('');
    trail.hidden = false;
    const a = backBtn.getBoundingClientRect(), ph = trail.offsetHeight;
    trail.style.left = `${Math.max(10, a.left)}px`;
    trail.style.top = `${Math.max(10, a.top - ph - 8)}px`;
  }
  function closeTrail(target) { if (!trail.hidden && !trail.contains(target ?? null)) trail.hidden = true; }
  trail.addEventListener('click', (e) => { const b = e.target.closest('[data-trail]'); if (!b) return; trail.hidden = true; backTo(Number(b.dataset.trail)); });
  document.addEventListener('pointerdown', (e) => { if (!trail.hidden && !trail.contains(e.target) && !backBtn.contains(e.target)) trail.hidden = true; }, true);

  // ---------- each second: the page on top (not while a finger is on it or it scrolls) ----------
  const busy = () => touching || drag || performance.now() - lastScroll < 500;
  setInterval(() => { const pg = top(); if (!pg || searching) return; if (!busy()) pg.def.every?.(idx); syncBar(); }, 1000);

  // ---------- start: Home ----------
  const homeDef = define('home');
  const homePg = make('home', homeDef);
  stack.push(homePg);
  pagesEl.append(homePg.el);
  measure();
  ready = true;
  show(homePg, null, 0, { level: 0 });

  const api = {
    open, back, backTo, home, close, replace,
    top: () => top()?.key ?? null,
    keys: () => stack.map(p => p.key),
    names: () => stack.map(nameOf),
    has: key => stack.some(p => p.key === key),
    setLevel: i => setIndex(i),
    get level() { return idx; },
    get heights() { return [...H]; },
    get searching() { return searching; },
    get busy() { return busy(); },
    openSearch, closeSearch, refreshBar: syncBar, recent: () => [...lately],
    onSearch(fn) { onSearch = fn; },
    trailOpen: () => !trail.hidden, openTrail,
    pageEl: key => stack.find(p => p.key === key)?.el ?? null,
    pageDef: key => stack.find(p => p.key === key)?.def ?? null,
    measure,
  };
  return api;
}

// What other parts of the app fill in later (the plan of 2026-11-22): onDay(), ☰ → The day (src/main.js says "soon"
// until it is set).
// dayOther(): true while The day shows another time than now (the shop window waits meanwhile, src/shop-window.js);
// The day's code sets it (until then null: never).
export const hooks = { onDay: null, dayOther: null };
