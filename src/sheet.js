// Sheets (the Soft look, Max 2026-11-15). Every card and page (a train, a station's board, the search, the stats,
// Settings, Help, disruptions) is a sheet. On a phone (under 440 px wide) a card slides up from the bottom
// ("perfect on phone"); on a wider screen everything opens from the search bar, at the left ("on pc it should slide or
// expand from the top/search bar"); the search opens from the search bar on a phone too, so the keyboard never hides
// its results. The screens still open and close themselves by their `hidden` attribute; this module keeps the newest
// open sheet on top (the ones under it wait, unchanged, and come back when it closes; raise(el) puts an open one on
// top again), lets a bottom sheet be dragged, and tells the page how high the open bottom sheet is (--sheet-h on
// <html>: the map's buttons stay above it).
// Dragging a bottom sheet (Max: it should follow the finger, and go back to compact): anywhere outside its scrolling
// lists and buttons. Up: taller, to full height; down: from full to half, from half (or a page) further to close. A
// tap on the handle (the sheet's top) switches between half and full.
const NARROW = typeof matchMedia === 'function' ? matchMedia('(max-width: 439px)') : null;
const SCROLLERS = '.panel-table, .cd-list, #search-results, #stats-body, #settings, .help-body, #disruptions-body, .pick-list, .dis-text';
const SNAP_PX = 40;      // a drag this far (up or down) changes the height
const CLOSE_PX = 100;    // dragged down this far from half height (or on a page): closed
const HANDLE_PX = 34;    // the handle: the sheet's top this high
const TOP_GAP = 78;      // full height leaves this much at the top (the search bar)

const bottomSheet = el => Boolean(NARROW?.matches) && el.id !== 'menu';

export function initSheets(els) {
  const order = [];   // the open sheets, oldest first
  const root = document.documentElement;
  let watched = null;
  // The open bottom sheet's height, for the map's buttons; 0 when none (or on a wide screen).
  const heightSeen = new ResizeObserver(() => showHeight());
  function showHeight() {
    const top = order.at(-1);
    const h = top && bottomSheet(top) ? Math.round(top.getBoundingClientRect().height) : 0;
    root.style.setProperty('--sheet-h', `${h}px`);
    root.classList.toggle('sheet-tall', h > window.innerHeight - 260);   // the map's buttons hide behind a tall sheet
  }
  function show() {
    const top = order.at(-1);
    for (const el of els) el.classList.toggle('behind', !el.hidden && el !== top);
    if (watched !== top) {
      if (watched) heightSeen.unobserve(watched);
      watched = top ?? null;
      if (watched) heightSeen.observe(watched);
    }
    showHeight();
  }
  const seen = new MutationObserver((changes) => {
    for (const { target: el } of changes) {
      const i = order.indexOf(el);
      if (i >= 0) order.splice(i, 1);
      if (!el.hidden) order.push(el);
      else { el.classList.remove('full', 'dragging', 'leaving'); el.style.transform = ''; el.style.maxHeight = ''; }
    }
    show();
  });
  for (const el of els) {
    el.classList.add('sheet');
    if (!el.hidden) order.push(el);
    seen.observe(el, { attributes: true, attributeFilter: ['hidden'] });
    dragging(el);
  }
  NARROW?.addEventListener('change', show);
  show();
  return {
    raise(el) {
      if (el.hidden) return;
      const i = order.indexOf(el);
      if (i >= 0 && i < order.length - 1) { order.splice(i, 1); order.push(el); show(); }
    },
  };
}

function dragging(el) {
  let start = null;   // { y, t, id, h }
  const close = () => el.querySelector('.panel-close, .menu-close')?.click();
  el.addEventListener('pointerdown', (e) => {
    if (!bottomSheet(el) || e.button > 0 || e.target.closest(`button, input, a, select, label, ${SCROLLERS}`)) return;
    start = { y: e.clientY, t: performance.now(), id: e.pointerId, h: el.getBoundingClientRect().height,
      handle: e.clientY - el.getBoundingClientRect().top < HANDLE_PX };
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = e.clientY - start.y;
    if (dy < 0) {   // taller, following the finger, up to full height
      el.style.transform = '';
      el.style.maxHeight = `${Math.min(window.innerHeight - TOP_GAP, start.h - dy)}px`;
    } else {        // down: the whole sheet follows the finger
      el.style.maxHeight = '';
      el.style.transform = `translateY(${dy}px)`;
    }
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = e.clientY - start.y, tap = Math.abs(dy) < 6 && performance.now() - start.t < 400, { handle, h: startH } = start;
    start = null;
    el.classList.remove('dragging');   // from here it moves to where it settles (CSS transition)
    el.style.maxHeight = '';
    const page = el.classList.contains('page'), full = el.classList.contains('full');
    if (tap) { if (handle && !page) el.classList.toggle('full'); el.style.transform = ''; return; }
    if (dy < -SNAP_PX) { el.classList.add('full'); el.style.transform = ''; return; }
    // From full: a short drag down goes back to compact, a long one (past half its height) closes it (Max, 2026-11-15:
    // "a swipe all the way down should close it. But a small swipe only minimize it").
    if (dy > SNAP_PX && full && !page && dy < Math.max(2 * CLOSE_PX, startH / 2)) { el.classList.remove('full'); el.style.transform = ''; return; }
    if (dy > CLOSE_PX) {   // slides away, then closes
      el.classList.add('leaving');
      el.style.transform = 'translateY(100%)';
      setTimeout(close, 200);
      return;
    }
    el.style.transform = '';   // springs back
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
