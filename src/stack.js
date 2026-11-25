// The one sheet and its stack of pages (Max's pick A, "One sheet", 2026-11-22; the sketch:
// docs/reviews/2026-11-22-ui/design/sketch/dir-a-sheet.js). One sheet never leaves the bottom of the screen (on a
// computer, 440 px wide and up, it floats at the bottom left, 420 px wide). Everything opened is a page in it, on a
// stack: Home at the bottom, then a train, a station's board, a disruption, a company, Settings... Each page has a
// key ('home', 'train:<id>', 'station:<sig>', 'dis:<id>', 'dislist', 'co:<brand>', 'kind:<k>', 'late', 'still',
// 'pick:<ids>', 'page:settings', 'page:help', 'page:conn'). There is no back chip (Max, 2026-11-23: "Remove home
// button"; a map tap or a pull down goes home, Esc and Android's back step back). This replaces the ten sheets that each showed and hid
// themselves (src/sheet.js before 2026-11-22): there is one screen state, the stack.
//
// Three resting heights: low (at Home only the search bar and ☰; a page: its bar and its first line), half and full.
// The finger moves the sheet from anywhere on it; at full a finger scrolls the page, and a pull down from the page's
// top moves the sheet. A long pull down below low closes every page (back to Home).
// The head (Max's phone, 2026-11-23: the handle "seems to hit it but doesn't respond", the sheet hard to lower): the
// handle, the grip over the map just above it (#sheet-grip, 24 px: with the handle 44 px to hit) and the head's parts
// that aren't buttons or the field are one handle: a tap there (the finger may wander TAP_PX) toggles low ↔ half; a pull
// from anywhere on the head moves the sheet (Home's field too, with a finger: a tap on it still searches), and a pull
// down from the head of PULL_PX or more, never up first, lowers it at least one height.
//
// createStack({ sheet, define, onPad, onChange }) -> the stack (see the end).
//   define(key) -> a page, or null when the key names nothing (a train gone, a disruption ended):
//     { name: string | () => string (the back chip's word for it), kind ('home', 'train', 'station', ... : the
//       sheet's data-page), low: px (its low height; default the page low) or () -> px (fitted: the height of its
//       content to show at low, measured from the page's top edge like half(); 0: not known yet, the page low; read
//       with half()), mount(el) (once, when made),
//       show(el, { dir, prev, first, ...opts }) (each time it comes on top: dir 1 opened, -1 back to it; prev: the page
//       it came from, { key, kind }), hide() (covered or gone), unmount() (taken off the stack), level(i) (the sheet
//       came to rest at height i), every() (once a second while it is on top), star: { on(), toggle() } and follow:
//       { can(), on(), toggle() } for the bar's ☆ and Follow,
//     half() -> px (optional): the page's own half height, the height of its content to show at half, measured from
//       the page's top edge (under the head); the stack adds the head and the phone's safe area, and keeps it between
//       low + 60 px and full - 40 px. Read when the page comes on top and on stack.refit() (call it when the page's
//       content changed its wanted height). With a fitted low, half may equal low (a computer's train card: low is
//       already the whole card, 2026-11-23); then a tap on the handle goes between low and full.
//       Without half(), half stops between the page's parts at or under the usual half (about half the screen), never
//       through a row (Max, 2026-11-23: Home's "Alla störningar" cut in half: "annoyingly cut off content"); a page
//       shorter than that: its whole content. }
//     halfGrows: true (optional): half() may only make the half taller than the usual one, never shorter.
//     dismiss() (optional): shut what is small and open in the page (the card's "to …" chooser), at once, with no
//       glide: a map tap (R1 below).
//     snap: false (optional): no fitting without half(): the usual half (a station's board: its rows come after it
//       opens, and a half fitted before them moved again once they came: a bounce, sheet-moves-check).
//   stack.refit({ grow: true }): only taller (content that came in by itself: a sheet that went down and up again for
//   it is a bounce); without it (the person changed the page: opened the chooser, shut it) also shorter. settle: true
//   with grow: also shorter when the sheet last glided down (the page's first fit after opening from above: it goes on
//   down, no turn).
// The bar over a page holds only its own buttons (star, Follow, def.acts()); a page without any has no bar (the head
// folds away: .no-bar), and a page with def.barIn() takes them into itself (a train: its card's top line beside the
// number, Max 2026-11-23: "move the pills share star and following down as it were before"); then it has no bar either.
// Esc and Android's back step back one page. A soft fade at the sheet's bottom edge
// says there is more of the page below (Max, 2026-11-23: Home "has no indication that there is more content").
//   onPad(h): the map's free part is above this many pixels (the sheet's resting height, at most half): src/map.js setSheet.
//   onChange(top): a page came on top (the map's lit trains, the line above the bar).
//
// THE TAP RULES (Max, 2026-11-23: "a lot of FIRST taps did nothing, second closed"). Every part follows them; each has
// a test in tools/tap-check.mjs.
//   R1. A tap on the map's empty ground always does something visible, in one tap (mapTap): the sheet shown above the
//       page's lowest resting height (by more than STEP_PX) goes down to it (an expanded card collapses); already
//       there, every page closes: Home at rest. A map tap never steps back through earlier pages (a train opened from a
//       "2 trains" list closes with the list). Anything small that is open closes in that same tap, never as a tap of
//       its own: the search, ☰'s menu (src/main.js onMapTap), a page's own chooser (def.dismiss(): the
//       card's "to …" list).
//   R2. A tap on a train or a station on the map opens it at once, whatever is open (src/main.js onMapTap lets every
//       tap through).
//   R3. "Show only" (src/filter.js; the line above the bar with its ×, src/line.js) stays until its × is tapped: no map
//       tap clears it. A company picked in Home's filter card sets it (src/main.js data-cofilter).
//   R4. Esc and Android's back step back one page (back()); a pull down below low goes home (home()).
// A part opened inside a page (a fold, the card's messages) is shown at once: reveal(el) (the sheet rises, or at full
// the page scrolls to it), unreveal() when it is shut again.
import { reduceMotion } from './motion.js';
import { icon } from './icons.js';
import { esc } from './html.js';
import { t } from './i18n.js';

const NARROW = typeof matchMedia === 'function' ? matchMedia('(max-width: 439px)') : null;
const MAX_PAGES = 12;          // pages over Home at most (the oldest go)
const HEAD_PX = 72;            // the handle and the head (search or a page's bar)
// (the page changes' and the glide's time: 4/3 with Debug → Animation speed → Calmer; index.html --mk)
const motionK = () => (typeof document !== 'undefined' && document.documentElement.dataset.mspeed === 'calm' ? 4 / 3 : 1);
const BAR_GAP_PX = 8;          // room between the search bar and the page under it (index.html #sheet:not(.no-bar) .sh-head)
const GRAB_PX = 20;            // the handle alone (a page without a bar)
const HOME_LOW_PX = HEAD_PX + 10;   // Home at rest: the search bar 12 px from the sheet edge below, as at its sides (Max, 2026-11-23)
// Room under the last part shown (Max, 2026-11-24: "Still too much padding in the bottom of some cards. Please remove
// ALL such cases"): 12 px when the page shows whole (nothing below, no sign); a phone's cut page 40 px (its "More" pill
// sits in it); a computer's sign has its own band under the page.
const FIT_GAP_PX = 12;
// (a phone: room for the "More" pill under it, not over the part's lower edge; Max, 2026-11-24: "Dålig padding på 'mer'
// pillret"; the pill 24 px tall, 4 px over the bottom bar)
const FIT_GAP_PHONE_PX = 40;
const PAGE_LOW_PX = 140;       // a page resting low: its bar and its first line
const TOP_ROOM_PX = 52;        // full height leaves this much at the top (the live mark)
const TAP_PX = 14;             // a tap on the handle: the finger moved less than this (a real finger wanders)...
const TAP_MS = 450;            // ...and lifted within this
const PULL_PX = 48;            // a pull down from the head this long lowers the sheet at least one height
const FLICK_V = 2.2;           // a flick down this fast (px/ms) closes the page at once (a swipe of 1.5 px/ms, the test
                               // browser's and a plain quick swipe, still steps one height) (Max, 2026-11-23: closing a full card took three swipes)
const STEP_PX = 40;            // a map tap lowers the sheet only when that moves it at least this far (R1); else it closes
const NOT_GRAB = 'button, a, input, select, textarea, label, [role="button"]';   // the head's parts that aren't the handle
// the head: the sheet's own, or on a page without a bar its first line where it says so (a train's card: number and
// buttons; its empty parts are the handle as the bar's were)
const HEAD = '.sh-grab, .sh-head, .pg-head';
// A page part's heading (the "more below" word, moreWord): the part is a heading, or starts with one; its own words
// without what is inside its spans (a train's info: the age beside "Speed now").
const PART_HEAD = 'h2, h3, h4';
const partHead = c => (c.matches(PART_HEAD) ? c : c.firstElementChild?.matches(PART_HEAD) ? c.firstElementChild : null);
const partName = h => [...h.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() || h.textContent.trim();

export function createStack({ sheet, define, onPad = () => {}, onChange = () => {} }) {
  const root = document.documentElement;
  const pagesEl = sheet.querySelector('.sh-pages');
  const input = sheet.querySelector('#search');
  const results = sheet.querySelector('#search-results');
  const barEl = sheet.querySelector('.sh-bar'), btnsEl = sheet.querySelector('.sh-btns'), upBtn = sheet.querySelector('.sh-up');
  const starBtn = sheet.querySelector('.sh-star'), folBtn = sheet.querySelector('.sh-follow'), actsEl = sheet.querySelector('.sh-acts');
  // the handle's grip over the map, just above the sheet (index.html #sheet-grip; a phone only)
  const grip = Object.assign(document.createElement('div'), { id: 'sheet-grip' });
  grip.setAttribute('aria-hidden', 'true');
  sheet.after(grip);
  // the fade at the shown bottom edge with its "more below" chevron (syncFade): a tap shows more (half to full; at full
  // the page scrolls on)
  const fadeEl = Object.assign(document.createElement('div'), { className: 'sh-fade' });
  // Its word beside the arrow (Max, 2026-11-24: an arrow that does something says what): the hidden part's heading when
  // only one part is below ("Fler avgångar"), else "Mer" (Home: "There is more than störningar down there"); moreWord.
  fadeEl.innerHTML = `<button type="button" class="sh-more" tabindex="-1" aria-label="${esc(t('moreBelow'))}"><span class="sh-word"></span>${icon('chevronDown', 18)}</button>`;
  sheet.append(fadeEl);
  // A computer (440 px wide and up): the handle's dash becomes a small arrow (Max, 2026-11-23: the dash is a phone
  // thing): ⌃ at rest (a tap raises the sheet), ⌄ raised (a tap lowers it); index.html .sh-arrow. A phone keeps the dash.
  // With more below, the same word as the phone's sign beside it.
  // (the word and the arrow one pill, lit together under the mouse: Max, 2026-11-24 "v-pill background blocks 'mer'")
  sheet.querySelector('.sh-grab')?.insertAdjacentHTML('beforeend', `<span class="sh-pill"><span class="sh-word"></span><span class="sh-arrow">${icon('chevronUp', 18)}</span></span>`);
  fadeEl.firstChild.addEventListener('click', () => {
    if (idx < 2) { setIndex(2); return; }
    const pg = scroller();
    pg?.scrollBy({ top: Math.round(pg.clientHeight * 0.7), behavior: reduceMotion() ? 'auto' : 'smooth' });
  });
  // the safe areas (a phone's rounded corners and bars): read once from CSS
  const probe = Object.assign(document.createElement('div'), { style: 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)' });
  document.body.append(probe);
  const safe = () => { const s = getComputedStyle(probe); return { top: parseFloat(s.paddingTop) || 0, bottom: parseFloat(s.paddingBottom) || 0 }; };

  const stack = [];          // [{ key, def, el, scroll, lvl }]
  const top = () => stack[stack.length - 1];
  let idx = 0, H = [HEAD_PX, 400, 800], fullMax = 800, searching = false, preSearch = 0, ready = false;
  let drag = null, touching = false, lastScroll = 0, eatUntil = 0;
  const wide = () => !NARROW?.matches;

  // ---------- heights ----------
  const fittedLow = pg => typeof pg?.def.low === 'function';
  // Which pages rest low: Home and a page with its own low (a train's collapsed card). Every other page has only half and
  // full (Max, 2026-11-23: "Closing out a fully expanded card is THREE swipes. Too much. Same with settings."): its low is
  // its half, so a pull down from half, a map tap there or a flick closes it.
  const keepsLow = pg => !pg || pg.key === 'home' || fittedLow(pg);
  // [low, half] of a page
  function heightsOf(pg) {
    const h0 = lowOf(pg), h1 = halfOf(pg, h0);
    return [keepsLow(pg) ? h0 : h1, h1, fullOf(pg, h1)];
  }
  // Full: the page's content and the usual room under it, never more than the screen's full (fullMax) nor less than its
  // half (Max, 2026-11-24: "A full expanded card should never just show empty space. Cut it off earlier in that case").
  // A page whose content differs at full (a train's card: its tables, its notes) measures it so (def.atFull(measure)).
  // A phone's sheet stays fullMax tall and only slides (place): this is just where full stops.
  // At full, its content grown or shrunk (a part opened, rows came in): full follows it (a glide), at most once a second
  // (src/stack.js's tick) or at once when a part is revealed.
  // (taller at once; shorter only when two ticks in a row agree: a part gliding shut or open is measured mid-glide)
  // At half too, shorter only: its content shrank after it came in by itself (a status line gone, a part folded; refit's
  // grow kept the room), so no empty room stays under it (Max, 2026-11-24: "Still too much padding in the bottom of some
  // cards"); taller comes with refit as before.
  let fullSeen = null, halfSeen = null;
  function fitFull() {
    if (drag || searching) return;
    if (idx === 1) {
      if (revealed) return;   // (grown on purpose for a part just opened: stays until it shuts, unreveal)
      const h1 = heightsOf(top())[1];
      if (h1 >= H[1] - 8) { halfSeen = null; return; }
      if (halfSeen !== h1) { halfSeen = h1; return; }
      halfSeen = null;
      H[1] = h1; place(H[1]); pad();
      return;
    }
    if (idx !== 2) return;
    const f = fullOf(top(), H[1]);
    if (Math.abs(f - H[2]) <= 2) { fullSeen = null; return; }
    if (f < H[2] && fullSeen !== f) { fullSeen = f; return; }
    fullSeen = null;
    H[2] = f; place(H[2]); pad();
  }
  function fullOf(pg, half) {
    const el = pg?.el;
    // (a page whose content is not in yet: the screen's full, so the sheet only ever goes down to it once it is)
    if (!el?.isConnected || searching || pg.def.fitted?.() === false) return fullMax;
    const measure = () => { let end = 0; for (const c of el.children) if (c.offsetHeight) end = Math.max(end, c.offsetTop + c.offsetHeight); return end; };
    const end = pg.def.atFull ? pg.def.atFull(measure) : measure();
    if (!end) return fullMax;
    const need = headPx() + end + FIT_GAP_PX + (wide() ? 0 : safe().bottom);
    return Math.round(Math.max(half, Math.min(fullMax, need)));
  }
  // the handle and the head: on a computer 10 px more (the sheet hangs from the top, room above the search field; index.html);
  // a page without a bar: the handle alone
  // (the handle's row read from the page: a computer's train card has a thin one, index.html)
  const grabEl = sheet.querySelector('.sh-grab'), grabH = () => grabEl?.offsetHeight || GRAB_PX;
  // (with the search bar: 8 px more under it, so a scrolled page goes out of sight below it, not right at its edge;
  // index.html .sh-head's margin; Max, 2026-11-24 "Better just add the padding")
  const headPx = () => (sheet.classList.contains('no-bar') ? 0 : HEAD_PX - GRAB_PX + BAR_GAP_PX) + grabH() + (wide() ? 10 : 0);
  function lowOf(pg) {
    const l = pg?.def.low, s = wide() ? 0 : safe().bottom;
    // (never under Home at rest: a long pull down from a train's collapsed card, 76 px, closed it to Home at 82 and the sheet
    // rose 6 px after the finger let go; sheet-moves-check, 2026-11-24)
    if (typeof l === 'function') { const c = l(); return c > 0 ? Math.min(Math.max(headPx() + c, HOME_LOW_PX) + s, fullMax - 40) : PAGE_LOW_PX + s; }
    // (a computer's handle band taller than the phone's handle: its extra room too, index.html #sheet .sh-grab)
    const band = wide() ? Math.max(0, grabH() - GRAB_PX) : 0;
    // (a computer, ☰'s menu open over Home at rest: the bar alone, 10 px above and under it, no arrow band: index.html)
    if (pg?.key === 'home' && wide() && sheet.classList.contains('menu-open')) return 10 + (HEAD_PX - GRAB_PX) + 10;
    return pg?.key === 'home' ? HOME_LOW_PX + s + band : (l ?? PAGE_LOW_PX) + s + (wide() ? 10 : 0) + band;
  }
  // A phone: the sheet is as tall as its tallest rest, slid down to the height shown (only its transform moves). A wider
  // screen: it floats 10 px above the bottom, so it takes the height shown itself (sliding it down would show its
  // lower part in that gap).
  const shownH = () => (wide() ? sheet.getBoundingClientRect().height : fullMax - new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42);
  function place(h, glide = true) {
    sheet.classList.toggle('dragging', !glide);
    if (wide()) { sheet.style.transform = ''; sheet.style.height = `${Math.round(h)}px`; }
    else { sheet.style.height = `${fullMax}px`; sheet.style.transform = `translateY(${Math.round(fullMax - h)}px)`; }
    const lvl = h < H[0] + 28 ? 'low' : h > (H[1] + H[2]) / 2 ? 'full' : 'half';
    sheet.dataset.lvl = lvl;
    root.style.setProperty('--sheet-shown', `${Math.round(h)}px`);
    // the map's buttons and its credit ride on the sheet's top edge (a phone); beside it on a wide screen
    root.style.setProperty('--sheet-h', wide() ? '0px' : `${Math.round(h)}px`);
    root.classList.toggle('sheet-tall', !wide() && h > innerHeight - 260);
    // (high: well over half and over 60 % of the screen; a short page at full, its content all of it since 2026-11-24,
    // leaves the map's buttons and the live mark in place)
    root.classList.toggle('sheet-high', h > H[1] + 70 && h > innerHeight * 0.6);
    sheet.style.setProperty('--sheet-off', wide() ? '0px' : `${Math.round(fullMax - h)}px`);
    if (glide && Math.abs(h - shownTo) > 2) lastDir = Math.sign(h - shownTo);
    shownTo = h;
    if (glide) syncFade();
  }
  // The fade at the bottom edge: the page has more below what is shown (not at low: the head and a line).
  let shownTo = 0, lastDir = 0;   // the shown height, and which way the sheet last glided (1 up, -1 down)
  // How much of the page is hidden under the shown bottom edge (px; its content, not its own room at the end). On a
  // computer the handle's row is at the bottom: not part of what shows.
  function hiddenBelow() {
    const pg = searching ? results : top()?.el;
    if (!pg) return { visible: 0, below: 0 };
    const visible = shownTo - pagesEl.offsetTop - (wide() ? grabH() : 0);
    let last = 0;
    for (const c of pg.children) if (c.offsetHeight) last = Math.max(last, c.offsetTop + c.offsetHeight);
    return { visible, below: last - pg.scrollTop - visible };
  }
  function syncFade() {
    const { visible, below } = hiddenBelow();
    const more = visible > 140 && below > 12;
    if (more !== sheet.classList.contains('more-below')) { sheet.classList.toggle('more-below', more); fadeEl.firstChild.tabIndex = more ? 0 : -1; }
    if (more) syncWord(visible);
    syncNext(below);
  }
  // The word for what is hidden below the shown edge: a heading's name when the hidden part is one whole part (its
  // heading first, no other heading after it, nothing of a shown part cut off), else "More".
  function moreWord(visible) {
    const pg = searching ? results : top()?.el;
    // (Home always "More": Max, 2026-11-24 "main should say 'mer'")
    if (!pg || (!searching && top().key === 'home')) return t('moreWord');
    const kids = [...pg.children].filter(c => c.offsetHeight);
    const at = c => c.offsetTop - pg.scrollTop;
    const hidden = kids.filter(c => at(c) >= visible - 4);
    const cut = kids.some(c => at(c) < visible - 4 && at(c) + c.offsetHeight > visible + 12);
    const heads = hidden.map(partHead).filter(Boolean);
    return !cut && heads.length === 1 && partHead(hidden[0]) ? partName(heads[0]) : t('moreWord');
  }
  let shownWord = null;
  function syncWord(visible) {
    const w = moreWord(visible);
    if (w === shownWord) return;
    shownWord = w;
    for (const el of sheet.querySelectorAll('.sh-word')) el.textContent = w;
    fadeEl.firstChild.setAttribute('aria-label', w === t('moreWord') ? t('moreBelow') : `${t('moreBelow')}: ${w}`);
  }
  // Which way a tap on the handle moves the sheet (a computer's arrow points that way, index.html): up to show more only
  // when more is hidden (Max, 2026-11-24: the arrow "just expands the card to show more empty space"; Home at half gave
  // no sign of more below); else down (a page without a low: closed).
  function syncNext(below = hiddenBelow().below) {
    const pg = top(), low = !searching && keepsLow(pg);
    const more = (low && idx === 0) || (idx < 2 && below > 12) || (low && idx < 2 && H[1] - H[0] < 30);
    // ('close': a tap would only close the page, which its ‹ does already: a computer shows no arrow then; Max,
    // 2026-11-24 "Screens like this has both back arrow and the collapse arrow that dismisses it. Remove the last one")
    const closes = !more && !low && !searching && !(idx === 2 && H[1] - H[0] >= 30);
    const v = more ? 'more' : closes ? 'close' : 'less';
    if (sheet.dataset.next !== v) sheet.dataset.next = v;
  }
  function pad() { if (ready) onPad(Math.min(H[idx], H[1])); }
  // Half: the page's own (def.half, see the top), else the usual half.
  let usualHalf = 400;
  // (low: the page's low height, when it is about to change: the half is never under it)
  function halfOf(pg, low = lowOf(pg)) {
    if (!pg?.def.half) return snapHalf(pg, low);
    const want = pg.def.half();
    if (!(want > 0)) return usualHalf;
    const h = Math.round(Math.max(low + (fittedLow(pg) ? 0 : 60), Math.min(headPx() + want + (wide() ? 0 : safe().bottom), fullMax - 40)));
    // halfGrows: the page's half only ever taller than the usual one (a train's card: its "More" above the phone's
    // bar on a short screen; on a tall one the usual half, no glide once its stops are in: 2026-11-23)
    return pg.def.halfGrows ? Math.max(usualHalf, h) : h;
  }
  // A page without its own half: the lowest edge at or under the usual half where no row or small part is cut,
  // preferring the end of a whole part (a section) when it is near; a page shorter than the usual half: all of it.
  function snapHalf(pg, low) {
    const el = pg?.el;
    if (!el?.isConnected || searching || pg.def.snap === false) return usualHalf;
    const base = headPx() + (wide() ? 0 : safe().bottom), limit = usualHalf - base;
    const top0 = el.getBoundingClientRect().top - el.scrollTop;
    const boxes = [];
    for (const e of el.querySelectorAll(':scope > *, :scope > * > *, :scope > * > * > *')) {
      const r = e.getBoundingClientRect();
      if (r.height > 0) boxes.push({ t: r.top - top0, b: r.bottom - top0, h: r.height, part: e.parentElement === el });
    }
    if (!boxes.length) return usualHalf;
    // (up to a fifth taller than the usual half when that shows a whole part, never closer than 40 px to full)
    const hi = Math.min(limit * 1.2, fullMax - base - 40), lo = limit * 0.5, gap = wide() ? FIT_GAP_PX : FIT_GAP_PHONE_PX;
    const end = Math.max(...boxes.map(x => x.b));
    if (end + FIT_GAP_PX <= hi) return Math.round(Math.max(low + 60, base + end + FIT_GAP_PX));
    const clean = y => !boxes.some(x => x.h < 220 && x.t < y - 1 && x.b > y + 1);
    // the clean edges' distance from the usual half (above it counts half again: rather a little less than more)
    const off = c => (c <= limit ? limit - c : (c - limit) * 1.5);
    let best = null, bestPart = null, below = 0;
    for (const x of boxes) {
      const c = x.b + gap;
      if (x.b < 40 || c > hi || !clean(x.b + 1)) continue;
      if (c <= limit) below = Math.max(below, c);
      if (c < lo) continue;
      if (best === null || off(c) < off(best)) best = c;
      if (x.part && (bestPart === null || off(c) < off(bestPart))) bestPart = c;
    }
    const want = bestPart !== null && off(bestPart) <= off(best) + 60 ? bestPart : best ?? below;
    return want ? Math.round(Math.max(low + 60, base + want)) : usualHalf;
  }
  function measure() {
    const h = innerHeight, s = safe();
    const full = wide() ? h - 20 : h - TOP_ROOM_PX - s.top;
    usualHalf = Math.round(Math.min(h * 0.6, Math.max(h * 0.5, 360), full - 40));
    fullMax = Math.round(full);
    H = [PAGE_LOW_PX, usualHalf, fullMax];
    [H[0], H[1], H[2]] = heightsOf(top());
    place(H[idx], false);
    sheet.getBoundingClientRect();
    sheet.classList.remove('dragging');
    pad();
  }
  addEventListener('resize', measure);
  NARROW?.addEventListener('change', measure);

  function setIndex(i, { still = false } = {}) {
    // (a page that doesn't rest low: half; closing it is home(), not a height)
    if (i <= 0 && !searching && !keepsLow(top())) i = 1;
    // (the page notes how it looks before the height changes it, to glide from there: a train card's buttons)
    if (!searching) top()?.def.beforeLevel?.(Math.max(0, Math.min(2, i)));
    idx = Math.max(0, Math.min(2, i));
    // (full measured now, the page as it is: it may have grown since its heights were read)
    if (idx === 2 && !searching) H[2] = Math.max(H[2], fullOf(top(), H[1]));
    sheet.dataset.h = String(idx);
    sheet.classList.remove('closing');
    if (idx < 2 && searching) closeSearch();
    const pg = top();
    if (!searching && pg) pg.lvl = idx;
    if (idx === 1 && !searching && pg) { H[1] = halfOf(pg); if (!keepsLow(pg)) H[0] = H[1]; }   // (its parts may have changed since)
    if (idx < 2) { const s = scroller(); if (s && s.scrollTop > 0) s.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); }
    place(H[idx]);
    if (!still) pad();
    if (!searching) pg?.def.level?.(idx);
    guard();
  }
  const scroller = () => (searching ? results : top()?.el);

  // ---------- the finger: from anywhere on the sheet (A's drag) ----------
  // ys, t0: where and when the finger came down; top: the highest it went; i0: the height it started at
  function dragBegin(y, id) { drag = { y0: y, h0: shownH(), h: null, moved: false, ly: y, lt: performance.now(), v: 0, id, ys: y, t0: performance.now(), top: y, low: y, i0: idx }; }
  function dragMove(y) {
    if (!drag) return false;
    drag.top = Math.min(drag.top, y);
    drag.low = Math.max(drag.low, y);
    if (!drag.moved) { if (Math.abs(drag.y0 - y) < 10) return false;   // (a tap's wobble is no drag)
      drag.moved = true; drag.y0 = y; }
    // (a computer: the sheet hangs from the top, so a pull down makes it taller)
    const grow = wide() ? -1 : 1;
    let h = drag.h0 + (drag.y0 - y) * grow;
    const raw = h;   // (where the finger is, before the sheet gives way or stops at Home's rest)
    if (h > H[2]) h = H[2] + (h - H[2]) * 0.2;
    // (below its lowest a page that rests low gives way a little; one that closes there follows the finger all the way:
    // let go, it is where Home rests, no glide after, 2026-11-23)
    if (h < H[0] && (searching || keepsLow(top()))) h = H[0] - (H[0] - h) * 0.6;
    // never below Home at rest (a long pull down closes every page and Home rests there: pulled lower, the sheet rose
    // again after the finger let go, a bounce; sheet-moves-check, 2026-11-23)
    h = Math.max(HOME_LOW_PX + (wide() ? 0 : safe().bottom), h);
    const now = performance.now(), dt = now - drag.lt;
    if (dt > 4) { drag.v = 0.65 * ((drag.ly - y) * grow / dt) + 0.35 * drag.v; drag.ly = y; drag.lt = now; }
    drag.h = h;
    place(h, false);
    // (the finger 30 px under the page's lowest height: a train's collapsed card, 80 px, sits under Home's rest, so the
    // sheet's own height can't get there)
    const closing = stack.length > 1 && raw < H[0] - 30;
    if (closing !== sheet.classList.contains('closing')) sheet.classList.toggle('closing', closing);
    return true;
  }
  function dragEnd() {
    const d = drag;
    drag = null; touching = false;
    if (!d || !d.moved) return;
    eatUntil = performance.now() + 150;
    const h = d.h ?? d.h0;
    // A page pulled or flicked away: Home as it was (its height and its place in the list; Max, 2026-11-23: going into a
    // page from Home and back 'should not dismiss the location'); a map tap still leaves Home at rest (R1).
    if (sheet.classList.contains('closing')) { backTo(0); return; }
    // A flick down closes the page at once; on a page without low, any throw down from its half does.
    const v0 = performance.now() - d.lt > 120 ? 0 : d.v;
    if (stack.length > 1 && !searching && (v0 < -FLICK_V || (!keepsLow(top()) && v0 < -0.45 && h < H[1] - 6))) { backTo(0); return; }
    let to;
    // A finger that stopped before it lifted throws nothing: the nearest height (2026-11-23, sheet-check: a pull held
    // still at 60 px below its start was thrown on by the speed of its last move).
    const v = performance.now() - d.lt > 120 ? 0 : d.v;
    if (Math.abs(v) > 0.45) {
      to = v > 0 ? H.findIndex(x => x > h + 6) : H.length - 1 - [...H].reverse().findIndex(x => x < h - 6);
      if (to < 0 || to > 2) to = v > 0 ? 2 : 0;
    } else { to = 0; H.forEach((x, i) => { if (Math.abs(x - h) < Math.abs(H[to] - h)) to = i; }); }
    // pulled down, never up first: at least one height lower (2026-11-23: a pull of 150 px from full came back up to
    // full, the nearest height; on a train's page too, 225 px from full and 230 from its half)
    if (!wide() && d.i0 > 0 && to >= d.i0 && h < d.h0 - PULL_PX && d.ys - d.top < 10) to = d.i0 - 1;
    // and pulled up, never down first: at least one height higher (a pull of 260 px from a train's half came back to
    // it: 247 px from half, 252 from full, 2026-11-23)
    if (!wide() && d.i0 < 2 && to <= d.i0 && h > d.h0 + PULL_PX && d.low - d.ys < 10) to = d.i0 + 1;
    setIndex(to);
  }
  const isGrab = el => el === grip || Boolean(el.closest('.sh-grab')) || Boolean(el.closest('.sh-head, .pg-head') && !el.closest(NOT_GRAB));
  // ☰'s menu open (src/main.js openNav): the sheet holds still, no pull, no scroll, no tap on the page behind; only ☰
  // and a map tap do anything then (Max, 2026-11-24: "When hamburger is acativated the normal scroll of the card should
  // not be possible"; "Only tapping search should be normal behavior, or hamburger or tap the map dismisses")
  const frozen = () => sheet.classList.contains('menu-open');
  function pointerDown(e) {
    touching = true;
    if (frozen()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Home's field: a finger's pull moves the sheet, its tap still searches (not while searching; not a mouse: its
    // press focuses the field at once)
    const field = e.target.closest('label.sh-field');
    // (a finger on a text field not being typed in moves the sheet like the rest, its tap still types: Max, 2026-11-23,
    // "Swiping down on a text entry field should also swipe the card"; Home's search field the same since before)
    const typing = el => el.matches('select') || el === document.activeElement || e.pointerType !== 'touch';
    const input = e.target.closest('input, select, textarea');
    if (field ? e.pointerType !== 'touch' || searching : input && typing(input)) return;
    const head = e.target === grip || e.target.closest(HEAD), full = idx === 2;
    if (!head && full && e.pointerType !== 'mouse') return;   // at full a finger scrolls the page; touchmove below takes a pull down from its top
    dragBegin(e.clientY, e.pointerId);
    drag.x0 = e.clientX;
    drag.body = !head && full;
    drag.head = Boolean(head);
    drag.grab = isGrab(e.target);
  }
  sheet.addEventListener('pointerdown', pointerDown);
  grip.addEventListener('pointerdown', pointerDown);
  const pointerMove = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dy = e.clientY - drag.y0;
    if (drag.body && !drag.moved && (scroller().scrollTop > 0 || dy < 7)) return;
    dragMove(e.clientY);
  };
  // A tap on the handle: low ↔ half (from full: half, then low). Taken from the finger, not the click: a finger that wandered
  // more than the drag's 8 px got no click and its drag went back where it was, so nothing happened (Max's phone).
  const handleTap = e => e.type === 'pointerup' && drag.grab && Math.abs(e.clientY - drag.ys) < TAP_PX && performance.now() - drag.t0 < TAP_MS;
  const pointerEnd = (e) => {
    touching = false;
    if (!drag || drag.id !== e.pointerId) return;
    if (handleTap(e)) {
      drag = null;
      eatUntil = performance.now() + 400;   // (the click that may follow)
      syncNext();
      const low = !searching && keepsLow(top());
      if (sheet.dataset.next === 'more') setIndex(low && idx === 0 && H[1] - H[0] >= 30 ? 1 : 2);
      // (from full one step: to half when the page has one of its own, then to rest; Max, 2026-11-24: "When Main menu is
      // full expanded and the 'close arrow' is clicked, it should compact, not close it. Clicking map already closes.")
      else if (idx === 2 && !searching && H[1] - H[0] >= 30) setIndex(1);
      else if (low || searching) setIndex(0);
      else if (idx === 2) setIndex(1);
      else backTo(0);   // (a page without a low, all of it shown at half: closed to Home, as a pull or a map tap)
      return;
    }
    dragEnd();
  };
  document.addEventListener('pointermove', pointerMove);
  document.addEventListener('pointerup', pointerEnd);
  document.addEventListener('pointercancel', pointerEnd);
  // A mouse pulling the sheet selects no text: the selection it began grew over the map, and a press on the map then
  // dragged the selection (a ghost picture) instead of the map; "live" showed highlighted (Max's PC, 2026-11-23). Text
  // made to be copied (the share link, the version) still selects.
  document.addEventListener('selectstart', (e) => {
    const el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (drag && !el?.closest('.share-url, .about-version')) e.preventDefault();
  }, true);
  // A finger on the page at full height: pulling down from the page's top moves the sheet, anything else scrolls.
  // The finger's moves are listened for on the element it touched: a page redraws its parts (a train's tiles each
  // second), and a touch whose element left the page no longer reaches the sheet, so the pull stopped where it was and
  // the sheet stayed there (2026-11-23, screens-check).
  let tch = null;
  function touchMove(e) {
    if (!tch || e.sheetSeen) return;
    e.sheetSeen = true;   // (heard on the element and again on the sheet)
    const y = e.touches[0].clientY, dy = y - tch.y, dx = e.touches[0].clientX - tch.x;
    if (!tch.on) {
      if (!tch.top || !e.cancelable || dy < -3 || Math.abs(dx) > Math.abs(dy) + 2) { tch = null; return; }
      if (dy <= 0) return;
      e.preventDefault();
      tch.held = true; tch.dx = dx; tch.dy = dy;
      if (dy < 10) return;
      tch.on = true;
      dragBegin(tch.y, -1);
    }
    e.preventDefault();
    dragMove(y);
  }
  function touchEnd(e) {
    for (const [type, fn] of [['touchmove', touchMove], ['touchend', touchEnd], ['touchcancel', touchEnd]]) e.currentTarget.removeEventListener(type, fn);
    // A tap whose finger wobbled down a few px: its moves were held for a pull that never came, and the browser then
    // drops the click (Max's phone, 2026-11-23: the card's notes "sometimes needs two clicks to expand"); the click is
    // given here, once (a click the browser sends after all is dropped).
    const t = tch;
    if (t && !t.on && t.held && e.type === 'touchend' && Math.abs(t.dx) < 12 && Math.abs(t.dy) < 12) {
      const b = t.target?.closest?.('button, a, label, [role="button"], [data-go], [data-act]');
      if (b && b.isConnected && !b.disabled) { given = { el: b, at: performance.now() }; b.click(); setTimeout(() => { if (given?.el === b) given = null; }, 600); }
    }
    touching = false; if (tch?.on) dragEnd(); tch = null;
  }
  let given = null;   // { el, at }: the click given above
  addEventListener('click', (e) => {
    if (!given || !e.isTrusted) return;
    if (performance.now() - given.at < 600 && given.el.contains(e.target)) { e.preventDefault(); e.stopPropagation(); }
    given = null;
  }, true);
  sheet.addEventListener('touchstart', (e) => {
    tch = !frozen() && idx === 2 && e.touches.length === 1 && !e.target.closest(HEAD) && !(e.target.closest('input, textarea') && e.target === document.activeElement)
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY, top: (scroller()?.scrollTop ?? 0) <= 0, on: false, target: e.target, held: false, dx: 0, dy: 0 } : null;
    touching = true;
    e.target.addEventListener('touchmove', touchMove, { passive: false });
    e.target.addEventListener('touchend', touchEnd);
    e.target.addEventListener('touchcancel', touchEnd);
  }, { passive: true });
  // (a listener on the sheet itself too: the browser decides at the touch's start whether its moves may be stopped,
  // and only where such a listener already is)
  sheet.addEventListener('touchmove', touchMove, { passive: false });
  sheet.addEventListener('scroll', () => { lastScroll = performance.now(); syncFade(); }, true);
  // A wheel over a sheet that isn't at full raises it a step (a mouse has no pull).
  let wheelAt = 0;
  sheet.addEventListener('wheel', (e) => {
    if (frozen()) { e.preventDefault(); return; }
    if (idx === 2 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (e.deltaY > 0 && performance.now() - wheelAt > 450) { wheelAt = performance.now(); setIndex(idx === 0 && H[1] - H[0] < 30 ? 2 : idx + 1); }
  }, { passive: false });
  // A drag's click is no tap (the handle's tap: pointerEnd); on the page at low, a tap raises it to half.
  sheet.addEventListener('click', (e) => {
    if (performance.now() < eatUntil) { e.preventDefault(); e.stopPropagation(); return; }
    if (frozen() && !e.target.closest('.sh-search')) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.closest('.sh-grab')) return;
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
  // A page's title line: its .g-head or .panel-head at its top (one level in at most)
  const headOf = pg => pg.el.querySelector(':scope > .g-head, :scope > .panel-head, :scope > :first-child > .g-head, :scope > :first-child > .panel-head');
  // The bar over a page: ☆, Follow and the page's own buttons when it has them; none (or taken into the page): no bar.
  function syncBar() {
    const pg = top();
    if (!pg) return;
    sheet.dataset.page = pg.def.kind ?? pg.key.split(':')[0];
    if (pg.key === 'home') { sheet.classList.remove('no-bar'); return; }
    // the page's own buttons beside the star (def.acts(): [{ id, icon, label, armed? }], def.act(id))
    const acts = pg.def.acts?.() ?? [], actsKey = acts.map(a => `${a.id}${a.armed ? '!' : ''}${a.label}`).join('|');
    if (actsEl.dataset.k !== actsKey) {
      actsEl.dataset.k = actsKey;
      actsEl.hidden = !acts.length;
      actsEl.innerHTML = acts.map(a => `<button type="button" class="sh-act${a.armed ? ' armed' : ''}" data-act-id="${esc(a.id)}" aria-label="${esc(a.label)}" title="${esc(a.label)}">${icon(a.icon, 20)}<span>${esc(a.label)}</span></button>`).join('');
    }
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
    // ‹ one page back on every page but those that say noUp (true, or a function: a train's, over Home)
    const up = !(typeof pg.def.noUp === 'function' ? pg.def.noUp() : pg.def.noUp);
    if (upBtn.hidden === up) upBtn.hidden = !up;
    const word = t('stepBack');
    if (upBtn.getAttribute('aria-label') !== word) upBtn.setAttribute('aria-label', word);
    // ‹ and the buttons on the page's own title line, never a row of their own (Max, 2026-11-23: "The back arrow takes
    // up a full row all by itself. Wasted space"): ‹ first, the buttons at its end (def.barIn: the page's own place)
    const head = up ? headOf(pg) : null;
    if (head && head.firstElementChild !== upBtn) head.prepend(upBtn);
    else if (!head && upBtn.parentElement !== barEl) barEl.prepend(upBtn);
    const own = (pg.def.barIn ? pg.def.barIn() : null) ?? head, place = own ?? barEl;
    if (btnsEl.parentElement !== place) place.append(btnsEl);
    const any = !starBtn.hidden || !folBtn.hidden || !actsEl.hidden;
    sheet.classList.toggle('no-bar', Boolean(head) || (!up && (Boolean(own) || !any)));
  }
  // The page leaving shows only what it showed: the sheet growing for the new page would open up its hidden part as it
  // slides out (Max, 2026-11-25: "I can see a red number element swipe by, that is not present in either relevant
  // cards": Home's lateness pills, at rest hidden under the bar; tools/ui-sweep.mjs "stray")
  function clipLeaving(el) {
    const r = el.getBoundingClientRect(), s = sheet.getBoundingClientRect();
    const seen = getComputedStyle(el).visibility === 'hidden' ? 0 : Math.max(0, Math.min(r.bottom, s.bottom, innerHeight) - r.top);
    el.style.clipPath = `inset(0 0 calc(100% - ${Math.floor(seen)}px) 0)`;   // (the page grows with the sheet: from its top)
  }
  // The page leaving slides out as a still picture of itself (Max, 2026-11-25: "horrible animation with elements
  // showing that shouldn't"): its own page lets go of its shared parts at once (a station's timetable, a train's card:
  // the next page may want them), so it emptied and its lower parts rose into view as it went. Its ids and key stay (its
  // look hangs on them); it goes after the new page, so a lookup finds the real one first, and under it
  // (index.html .pg-ghost); untouchable.
  function ghostOf(el) {
    const g = el.cloneNode(true);
    g.classList.remove('in-r', 'in-l');
    g.classList.add('pg-ghost');
    // (what was hidden stays hidden: some of its look hangs on the sheet's page, which changes as it leaves, e.g. a
    // train card's Follow showing only its icon at full)
    const all = el.getElementsByTagName('*'), copies = g.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) if (getComputedStyle(all[i]).display === 'none') copies[i].style.display = 'none';
    const from = el.querySelectorAll('canvas'), to = g.querySelectorAll('canvas');
    from.forEach((c, i) => { try { to[i].getContext('2d')?.drawImage(c, 0, 0); } catch { /* a picture it can't copy: blank */ } });
    g.inert = true;
    g.setAttribute('aria-hidden', 'true');
    return g;
  }
  function show(pg, prev, dir, opts = {}) {
    const old = prev?.el;
    if (prev) prev.scroll = old.scrollTop;
    let ghost = null;
    if (old && old !== pg.el && old.isConnected) {
      if (!reduceMotion()) {
        clipLeaving(old);
        ghost = ghostOf(old);
        old.style.clipPath = '';
        ghost.classList.add(dir > 0 ? 'out-l' : 'out-r');
      }
      old.remove();
      old.classList.remove('in-r', 'in-l', 'out-l', 'out-r');
    }
    if (prev) prev.def.hide?.();
    pg.el.classList.remove('out-l', 'out-r');
    pg.el.style.clipPath = '';
    if (prev && !reduceMotion()) {
      pg.el.classList.add(dir > 0 ? 'in-r' : 'in-l');
      const el0 = pg.el;
      setTimeout(() => el0.classList.remove('in-r', 'in-l'), 400 * motionK());
    }
    pagesEl.append(pg.el);
    if (ghost) {
      pagesEl.append(ghost);
      ghost.scrollTop = prev.scroll;
      setTimeout(() => ghost.remove(), 300 * motionK());
    }
    syncBar();
    H[0] = lowOf(pg);
    const level = opts.level ?? (dir > 0 ? Math.max(1, pg.def.startLevel ?? 1) : pg.lvl ?? 1);
    pg.def.show?.(pg.el, { dir, prev: prev ? { key: prev.key, kind: prev.def.kind ?? prev.key.split(':')[0] } : null, ...opts });
    syncBar();   // (‹ and the buttons on its title line before its heights and its scroll are read: a list came back 4 px short)
    [H[0], H[1], H[2]] = heightsOf(pg);   // (once its content is in)
    setIndex(pg.key === 'home' && dir < 0 && opts.level === undefined ? Math.min(level, idx) : level);
    pg.el.scrollTop = dir < 0 && idx === 2 ? pg.scroll ?? 0 : 0;
    syncBar();
    onChange(pg);
    guard();
  }
  // Open the page with this key (a page already on the stack: back to it).
  function open(key, opts = {}) {
    if (searching) closeSearch();
    const at = stack.findIndex(p => p.key === key);
    if (at >= 0 && at === stack.length - 1) {   // it is open: up to half, shown again
      if (idx === 0) setIndex(1);
      top().def.show?.(top().el, { dir: 0, prev: null, again: true, ...opts });
      syncBar();
      return true;
    }
    // (opened again by a tap: at its start height, not the one it was left at; Max, 2026-11-23: a train card left
    // collapsed came back collapsed. Esc and the phone's back keep the height: back())
    if (at >= 0) { backTo(at, opts.level ?? Math.max(1, stack[at].def.startLevel ?? 1)); return true; }
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
    for (const p of gone) { if (p !== prev) p.def.hide?.(); p.def.unmount?.(); if (p.el !== top().el) setTimeout(() => p.el.remove(), reduceMotion() ? 0 : 300 * motionK()); }
  }
  // The page on top changed its wanted half height (def.half): read it again; resting at half, the sheet glides there.
  function refit({ grow = false, settle = false } = {}) {
    if (searching) return;
    // (the half from the new low: from the old one, a card whose chooser shut kept its taller half, its room left empty
    // under it, and a map tap then only took that room away: Max's case (a), 2026-11-23)
    let [h0, h1, h2] = heightsOf(top());
    if (grow && !(settle && lastDir < 0)) { h0 = Math.max(h0, H[0]); h1 = Math.max(h1, H[1]); h2 = Math.max(h2, H[2]); }
    if (h0 === H[0] && h1 === H[1] && h2 === H[2]) { syncFade(); return; }
    H[0] = h0; H[1] = h1; H[2] = h2;
    if (!drag) { place(H[idx]); pad(); }
  }
  function home(level) { if (stack.length > 1) backTo(0, level); else setIndex(level ?? idx); }
  // One step back: the search, a page, then the sheet down to rest. false: nothing left (Android: the app
  // goes to the background).
  function back() {
    if (searching) { closeSearch(); setIndex(preSearch); return true; }
    if (stack.length > 1) { backTo(stack.length - 2); return true; }
    if (idx > 0) { setIndex(0); return true; }
    return false;
  }
  // A tap on the map's empty ground (R1 at the top): what is small closes, then the sheet goes down to the page's
  // lowest height, or, already there, every page closes. Returns what it did: 'down', 'home' or null (Home at rest).
  function mapTap() {
    if (searching) { closeSearch(); setIndex(0); return 'down'; }
    const pg = top();
    pg.def.dismiss?.();
    [H[0], H[1], H[2]] = heightsOf(pg);   // (what was dismissed took its room with it)
    revealed = null;
    // what of the page is shown: below full, at most its half (more is empty room a glide left under it: taking only
    // that away moves the sheet and shows nothing new, Max's cases (a) and (c) on the computer)
    const showing = idx === 2 ? shownTo : Math.min(shownTo, H[1]);
    if (showing - H[0] > STEP_PX) { setIndex(0); return 'down'; }
    if (stack.length > 1) { home(0); return 'home'; }
    if (Math.abs(shownTo - H[0]) > 2) setIndex(0);
    return null;
  }
  // A part just opened inside the page on top (el; bottom: where its end will be on the screen, when it is still
  // gliding open): shown at once. Below full: the sheet takes its new half, or, when the part still ends below what that
  // shows, rises to full; at full the page scrolls it into view. unreveal(): the part shut again; a sheet risen for it
  // goes back to the height it had (unless it was moved meanwhile), else it takes its new heights.
  let revealed = null;   // { key, from, to }
  function reveal(el, bottom) {
    const pg = top();
    if (searching || !pg || !el?.isConnected || !pg.el.contains(el)) return;
    // (its start and end measured from the top of the page's content)
    const r = el.getBoundingClientRect(), top0 = pg.el.getBoundingClientRect().top - pg.el.scrollTop;
    const start = r.top - top0, end = (bottom ?? r.bottom) - top0 + 12;
    const need = pagesEl.offsetTop + end + (wide() ? 0 : safe().bottom);   // the sheet's height that shows all of it
    // (full: the page's new content, the part still gliding open counted to its end)
    const [l0, h1, f] = heightsOf(pg);
    H[2] = Math.max(f, Math.min(fullMax, Math.round(need)));
    if (idx < 2) {
      H[0] = l0;
      if (need <= Math.max(h1, H[idx]) + 2) { revealed = { key: pg.key, from: idx, to: 1 }; H[1] = Math.max(h1, H[1], Math.round(need)); if (idx === 0) setIndex(1); else { place(H[1]); pad(); } return; }
      revealed = { key: pg.key, from: idx, to: 2 };
      setIndex(2);
    }
    if (idx === 2 && !drag) { place(H[2]); pad(); }
    // at full: scrolled until its end is in view, its start kept in view (the page's height at full: under the head, less
    // the fade at the bottom edge)
    const view = H[2] - pagesEl.offsetTop - 40 - (wide() ? 0 : safe().bottom);
    const over = end - pg.el.scrollTop - view;
    if (over > 0) pg.el.scrollBy({ top: Math.max(0, Math.min(over, start - pg.el.scrollTop - 8)), behavior: reduceMotion() ? 'auto' : 'smooth' });
  }
  function unreveal() {
    const pg = top(), was = revealed;
    revealed = null;
    if (searching || !pg) return;
    if (was && was.key === pg.key && idx === was.to) { setIndex(was.from); return; }
    refit();
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
    guard();
    sheet.dataset.search = '';
    results.hidden = false;
    pagesEl.append(results);
    onSearch(true);
    idx = 2; sheet.dataset.h = '2';
    H[2] = searchFull();
    place(H[2]);
    results.scrollTop = 0;
  }
  // The search's height: a phone's all of the screen (its keyboard covers the lower half: the field goes up, clear of
  // it); a computer's as tall as its results, growing and shrinking with them (Max, 2026-11-24: "Just clicking the
  // search bar expands the card fully with just empty space. It should be sized dynamically relating to the search
  // results")
  function searchFull() {
    if (!wide()) return fullMax;
    let end = 0;
    for (const c of results.children) if (c.offsetHeight) end = Math.max(end, c.offsetTop + c.offsetHeight);
    return Math.round(Math.min(fullMax, Math.max(headPx() + 120, headPx() + end + FIT_GAP_PX)));
  }
  new MutationObserver(() => {
    if (!searching || !wide() || drag) return;
    const f = searchFull();
    if (Math.abs(f - H[2]) > 2) { H[2] = f; place(H[2]); }
  }).observe(results, { childList: true, subtree: true, characterData: true });
  function closeSearch() {
    if (!searching) return;
    searching = false;
    H[2] = fullOf(top(), H[1]);
    delete sheet.dataset.search;
    results.hidden = true;
    if (input.value) input.value = '';
    if (document.activeElement === input) input.blur();
    onSearch(false);
  }
  input.addEventListener('focus', openSearch);
  // (only while searching: a field left focused after the search closed took Esc and did nothing, so the first Esc over
  // a page was lost; stats-board-check, 2026-11-24)
  input.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (!searching) { input.blur(); return; } e.stopPropagation(); closeSearch(); setIndex(preSearch); });
  sheet.querySelector('.sh-cancel').addEventListener('click', () => { closeSearch(); setIndex(preSearch); });

  // ---------- the bar ----------
  upBtn.addEventListener('click', () => back());
  // A page drawing its title line again drops ‹ and the buttons from it: put back at once, not at the next second (a
  // board's tab or its search closed made its line 8 px shorter for a moment: sheet-moves-check)
  // (before the frame is drawn: the observer runs before paint)
  new MutationObserver(() => { if (!upBtn.isConnected || !btnsEl.isConnected) syncBar(); growFull(); }).observe(pagesEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  // At full, the page's content grown (a board turned to its whole day, rows came in): full grows with it at once, not at
  // the next tick (the board's search stayed at half height for a second: stats-board-check, 2026-11-24); shrinking
  // waits for the tick (fitFull)
  let growPending = false;
  function growFull() {
    if (growPending) return;
    growPending = true;
    requestAnimationFrame(() => {
      growPending = false;
      if (idx !== 2 || drag || searching) return;
      const f = fullOf(top(), H[1]);
      if (f > H[2] + 2) { H[2] = f; place(H[2]); pad(); }
    });
  }
  starBtn.addEventListener('click', () => { top()?.def.star?.toggle(); syncBar(); });
  actsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-act-id]'); if (b) { top()?.def.act?.(b.dataset.actId); syncBar(); } });
  folBtn.addEventListener('click', () => { top()?.def.follow?.toggle(); syncBar(); });


  // ---------- each second: the page on top (not while a finger is on it or it scrolls) ----------
  const busy = () => touching || drag || performance.now() - lastScroll < 500;
  setInterval(() => { const pg = top(); if (!pg || searching) return; if (!busy()) { pg.def.every?.(idx); fitFull(); syncFade(); } syncBar(); }, 1000);

  // ---------- the phone's own back in a browser (Max, 2026-11-23: "swipe back again closes the page, not swipe back")
  // The browser's back (Android's gesture, the back button) left the site. While there is something to step back from
  // (a page, the search, the sheet raised) one history entry of our own stands in front: back takes it and steps one
  // thing back, as Android's back in the app does (src/main.js, Capacitor); with nothing left it leaves. Not in the app.
  const NATIVE = Boolean(window.Capacitor?.isNativePlatform?.());
  // (only a step back off our own entry counts: an address followed forward, a #train= link or a changed setting in the
  // address, also brings a popstate, and was taken for a back press that undid it; debug-check, 2026-11-24. A back keeps
  // the history's length; a new entry changes it or replaces ours.)
  let guarded = false, guardLen = 0;
  function guard() {
    if (!ready || NATIVE || guarded) return;
    if (stack.length > 1 || idx > 0 || searching) { try { history.pushState({ sparat: 1 }, ''); guarded = true; guardLen = history.length; } catch { /* (a sandboxed frame) */ } }
  }
  addEventListener('popstate', (e) => {
    if (NATIVE || !guarded) return;
    guarded = false;
    if (e.state?.sparat || history.length !== guardLen) return;   // (not a step back off our entry)
    if (back()) guard();
    else history.back();   // (nothing left to step back from, the pages closed in the app meanwhile: the user meant to leave)
  });

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
    get shown() { return shownTo; },
    get heights() { return [...H]; },
    get searching() { return searching; },
    get busy() { return busy(); },
    openSearch, closeSearch, refreshBar: syncBar, recent: () => [...lately],
    onSearch(fn) { onSearch = fn; },
    pageEl: key => stack.find(p => p.key === key)?.el ?? null,
    pageDef: key => stack.find(p => p.key === key)?.def ?? null,
    measure, refit, mapTap, reveal, unreveal, headPx,
  };
  return api;
}

// What other parts of the app fill in later (the plan of 2026-11-22): onDay(), ☰ → The day (src/main.js says "soon"
// until it is set).
// dayOther(): true while The day shows another time than now (the shop window waits meanwhile, src/shop-window.js);
// The day's code sets it (until then null: never).
export const hooks = { onDay: null, dayOther: null };
