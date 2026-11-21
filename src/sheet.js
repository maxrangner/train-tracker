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
import { reduceMotion } from './motion.js';

const NARROW = typeof matchMedia === 'function' ? matchMedia('(max-width: 439px)') : null;
const SCROLLERS = '.panel-table, .panel-info-box, .cd-list, .board-msg-list, #search-results, #stats-body, #settings, .help-body, #disruptions-body, #conn-body, .pick-list, .dis-text';
const SNAP_PX = 40;      // a drag this far (up or down) changes the height
const CLOSE_PX = 100;    // dragged down this far from half height (or on a page): closed
const HANDLE_PX = 34;    // the handle: the sheet's top this high
const TOP_GAP = 78;      // full height leaves this much at the top (the search bar)
// The compact train card dragged up (Max, 2026-11-21: on a slow drag the trip line "quickly disappears and the i and
// star button appears ... Should be animated and smooth"): its own parts (the trip line, "All stops") fade with the
// finger over this much (--fold, index.html), then it turns full and the full card's parts fade in; back below half
// of it, compact again, the same way. Other sheets (and with "reduce motion") turn full after 6 px, as before.
const FOLD_PX = 36;

const bottomSheet = el => Boolean(NARROW?.matches) && el.id !== 'menu';
const GLIDE_MS = 280;    // a little over the CSS height transition (.sheet, .26 s)

// A button that answers a finger at once, also right after a swipe (Max, 2026-11-20: "the menu doesn't react
// directly when a screen is dismissed"). Measured in the test browser: for about 0.4 s after a swipe ends, a tap gets
// its pointerdown and pointerup but no click (the browser takes it as stopping the swipe), so ☰ did nothing until the
// card had slid away. Here a finger lifted on the button, not moved, acts; the click that may follow is skipped. A
// mouse, a pen, the keyboard and tools' .click() still go through the click.
export function onTap(el, fn) {
  let down = null, tappedAt = -Infinity;
  el.addEventListener('pointerdown', (e) => { down = e.pointerType === 'touch' ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null; });
  el.addEventListener('pointercancel', () => { down = null; });
  el.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || e.pointerId !== d.id || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
    tappedAt = performance.now();
    fn(e);
  });
  el.addEventListener('click', (e) => { if (performance.now() - tappedAt > 700) fn(e); });
}

// A size change that glides (Max's phone test, 2026-11-17: Mer, the handle tap and a short drag down "snap down very
// fast"): the change itself (a class, new content) is made with the transitions off, so the new natural height can
// be measured at once (the height limit changes with it); then the height goes from what it was (or `from`, a dragged
// sheet's visible height) to the new one by the sheet's CSS transition, and is left to the content again after.
// settle: runs once the transitions are back on (what should move too, e.g. the transform back to 0).
export function glide(el, change, { from = el.getBoundingClientRect().height, settle } = {}) {
  clearTimeout(el.glideTimer);
  el.classList.add('dragging', 'gliding');   // (transitions off; gliding: until the glide ends, index.html)
  el.style.height = ''; el.style.maxHeight = '';
  change();
  const to = el.getBoundingClientRect().height;
  el.style.maxHeight = `${Math.max(from, to)}px`;   // (neither limit cuts the glide short)
  el.style.height = `${from}px`;
  el.getBoundingClientRect();   // (the start of the glide)
  el.classList.remove('dragging');
  settle?.();
  el.style.height = `${to}px`;
  // Let go at the end without a transition: the sheet's max-height has one, so clearing the glide's (larger) limit
  // ran a second glide from it, and a card taller than its compact limit glided down twice (Max, 2026-11-21: the
  // station card "bounces twice" when its messages fold; measured: 78 → 468, back to 78, → 468 again).
  el.glideTimer = setTimeout(() => {
    el.style.transition = 'none';
    el.style.height = ''; el.style.maxHeight = '';
    el.classList.remove('gliding');
    el.dispatchEvent(new Event('glided'));
    el.getBoundingClientRect();
    el.style.transition = '';
  }, GLIDE_MS);
}

// Sliding away: down by its own height, or from where the finger left it if that is further (a short sheet pulled
// further than its height climbed back before it went: Störningar with few rows 1001 → 908 px; 2026-11-21's sweep).
const away = dy => `translateY(max(100%, ${Math.round(dy)}px))`;

export function initSheets(els) {
  const order = [];   // the open sheets, oldest first
  const root = document.documentElement;
  let watched = null;
  // The open bottom sheet's height, for the map's buttons; 0 when none (or on a wide screen).
  const heightSeen = new ResizeObserver(() => showHeight());
  // The map's buttons go once to where the sheet ends up (2026-11-21's sweep: a train opened from a station's board
  // took them down to its "Laddar…" card, then back up as its timetable came):
  //  - a sheet still saying "Laddar…" doesn't take them down: they wait where they are until its content is in;
  //  - a gliding sheet gives where its glide ends, not where it is on the way (the buttons glide there themselves);
  //  - coming out from behind a tall sheet, they show in their place (they slid down the screen from its top).
  let shownH = 0, holdTimer = null;
  function showHeight() {
    const top = order.at(-1);
    const bottom = top && bottomSheet(top);
    const h = !bottom ? 0 : top.classList.contains('gliding') && top.style.height ? Math.round(parseFloat(top.style.height))
      : Math.round(top.getBoundingClientRect().height);
    clearTimeout(holdTimer);
    if (bottom && h < shownH && top.querySelector(':scope > .state.loading')) { holdTimer = setTimeout(showHeight, 150); return; }
    const tall = h > window.innerHeight - 260;   // the map's buttons hide behind a tall sheet
    if (!tall && root.classList.contains('sheet-tall')) {
      root.classList.add('sheet-jump');
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('sheet-jump')));
    }
    shownH = h;
    root.style.setProperty('--sheet-h', `${h}px`);
    root.classList.toggle('sheet-tall', tall);
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
  for (const el of els) el.addEventListener('glided', () => { if (el === order.at(-1)) showHeight(); });
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
    // Close the sheet on top the way a drag down does (its own close button); false when none is open (the phone's
    // back button in the app: then it leaves the app; Max, 2026-11-17).
    closeTop() {
      const top = order.at(-1);
      const button = top?.querySelector('.panel-close, .menu-close');
      if (!button) return false;
      button.click();
      return true;
    },
  };
}

function dragging(el) {
  let start = null;   // { y, t, id, h }
  // (its own click is never swallowed below: a drag down that began on a button slid the card away but left it open,
  // the train selected and the map's buttons up where the card was; Max, 2026-11-21)
  const close = () => { swallowUntil = 0; el.querySelector('.panel-close, .menu-close')?.click(); };
  // A drag can start anywhere on the sheet (Max, 2026-11-20: "when train card is expanded: swiping down from where
  // ever on the card should minimize it"): on a button or link once the finger has moved (a press that stays put is
  // the button's tap, and a drag's click is swallowed), and in a scrolling list with a swipe down while the list is at
  // its top (touchmove below; a list scrolled down scrolls up first, and a swipe up always scrolls it).
  let wait = null;          // a press on a button or link, not moved yet: { id, y }
  let inList = null;        // a finger down in a list: { id, y }
  let swallowUntil = 0;     // a drag that began on a button: its click (if one comes) does nothing
  const begin = (id, y, fromButton = false) => {
    const compact = !el.classList.contains('full') && !el.classList.contains('page');
    start = { y, t: performance.now(), id, h: el.getBoundingClientRect().height,
      handle: y - el.getBoundingClientRect().top < HANDLE_PX, fromButton, compact,
      fold: compact && el.id === 'panel' && !reduceMotion() };
    try { el.setPointerCapture(id); } catch { /* the pointer is gone */ }
    el.classList.add('dragging');
  };
  el.addEventListener('click', (e) => { if (performance.now() < swallowUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
  el.addEventListener('pointerdown', (e) => {
    wait = null;
    inList = null;
    if (!bottomSheet(el) || e.button > 0 || e.target.closest('input, select, label, textarea')) return;
    if (e.target.closest(SCROLLERS)) { inList = { id: e.pointerId, y: e.clientY }; return; }
    if (e.target.closest('button, a')) { wait = { id: e.pointerId, y: e.clientY }; return; }
    begin(e.pointerId, e.clientY);
  });
  el.addEventListener('touchmove', (e) => {
    if (start?.fromList) { if (e.cancelable) e.preventDefault(); return; }   // (the list never takes over the drag)
    if (!inList || start || e.touches.length !== 1) return;
    const from = inList, list = e.target.closest?.(SCROLLERS);
    inList = null;   // decided on the first move: the list's own scroll, or the sheet
    const dy = e.touches[0].clientY - from.y;
    if (!list || dy <= 0 || list.scrollTop > 0) return;
    e.preventDefault();   // (no scroll: the sheet follows the finger)
    begin(from.id, from.y);
    start.fromList = true;
  }, { passive: false });
  el.addEventListener('pointermove', (e) => {
    if (wait && e.pointerId === wait.id && Math.abs(e.clientY - wait.y) > 8) { const { id, y } = wait; wait = null; begin(id, y, true); }
    if (!start || e.pointerId !== start.id) return;
    const dy = e.clientY - start.y;
    if (dy < 0) {   // taller, following the finger, up to full height
      el.style.transform = '';
      const h = `${Math.min(window.innerHeight - TOP_GAP, start.h - dy)}px`;
      // A compact card has nothing taller to show: it shows its full content (the train card: after FOLD_PX) and
      // grows to the finger (Max, 2026-11-16: dragging up "doesn't follow the finger"; only its height limit grew).
      if (start.fold && start.grew && dy > -FOLD_PX / 2) { start.grew = false; el.classList.remove('full'); }
      if (start.compact && !start.grew && dy < -(start.fold ? FOLD_PX : 6)) { start.grew = true; el.classList.add('full'); }
      if (start.fold) el.style.setProperty('--fold', start.grew ? '0' : String(Math.min(1, -dy / FOLD_PX)));
      el.style.maxHeight = h;
      if (start.grew || start.fold) el.style.height = h;
    } else {        // down: the whole sheet follows the finger
      el.style.maxHeight = '';
      // grown first, then back below the start: at its small height again, following the finger down (Max's phone
      // test, 2026-11-17: it stayed at the grown height, shifted down, and was left there cut off); the train card
      // compact again
      if (start.fold) {
        if (start.grew) { start.grew = false; el.classList.remove('full'); }
        el.style.height = '';
        el.style.setProperty('--fold', '0');
      } else if (start.grew) el.style.height = `${start.h}px`;
      el.style.transform = `translateY(${dy}px)`;
    }
  });
  const end = (e) => {
    wait = null;
    inList = null;
    if (!start || e.pointerId !== start.id) return;
    const dy = e.clientY - start.y, tap = Math.abs(dy) < 6 && performance.now() - start.t < 400, { handle, h: startH, grew, fold } = start;
    if (start.fromButton) swallowUntil = performance.now() + 400;
    start = null;
    const unfold = () => el.style.removeProperty('--fold');   // (once the transitions are on: the parts fade back)
    if (grew && dy > CLOSE_PX) {   // grown, then pulled far down: slides away and closes, as from small
      el.classList.remove('dragging');
      el.classList.add('leaving');
      el.style.transform = away(dy);
      setTimeout(close, 200);
      return;
    }
    if (grew) {   // grown with the finger: on to full height, or back to compact; its height glides there
      const stay = dy < -SNAP_PX;
      glide(el, () => { if (!stay) el.classList.remove('full'); }, { settle: () => { el.style.transform = ''; unfold(); } });   // (back up, if pulled below its start)
      return;
    }
    // the train card pulled up less than FOLD_PX: back to its compact height, its parts fade back
    if (fold && dy < 0 && !(tap && handle)) { glide(el, () => {}, { settle: () => { el.style.transform = ''; unfold(); } }); return; }
    unfold();
    const page = el.classList.contains('page'), full = el.classList.contains('full');
    if (tap && handle && !page) { glide(el, () => { el.classList.toggle('full'); el.style.transform = ''; }); return; }
    if (dy < -SNAP_PX && !full) { glide(el, () => { el.classList.add('full'); el.style.transform = ''; }); return; }
    // From full: a short drag down goes back to compact, a long one (past half its height) closes it (Max, 2026-11-15:
    // "a swipe all the way down should close it. But a small swipe only minimize it"). It glides from where the finger
    // left it (the height it shows, its top where it was).
    if (dy > SNAP_PX && full && !page && dy < Math.max(2 * CLOSE_PX, startH / 2)) {
      glide(el, () => { el.classList.remove('full'); el.style.transform = ''; }, { from: startH - dy });
      return;
    }
    el.classList.remove('dragging');   // from here it moves to where it settles (CSS transition)
    el.style.maxHeight = '';
    if (tap || dy < -SNAP_PX) { el.style.transform = ''; return; }
    if (dy > CLOSE_PX) {   // slides away, then closes
      el.classList.add('leaving');
      el.style.transform = away(dy);
      setTimeout(close, 200);
      return;
    }
    el.style.transform = '';   // springs back
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
