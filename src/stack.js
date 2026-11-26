// The one sheet and its stack of pages (Max's pick A, "One sheet", 2026-11-22; the sketch:
// docs/reviews/2026-11-22-ui/design/sketch/dir-a-sheet.js). One sheet never leaves the bottom of the screen (on a
// computer, 440 px wide and up, it floats at the bottom left, 420 px wide). Everything opened is a page in it, on a
// stack: Home at the bottom, then a train, a station's board, a disruption, a company, Settings... Each page has a
// key ('home', 'train:<id>', 'station:<sig>', 'dis:<id>', 'dislist', 'co:<brand>', 'kind:<k>', 'late', 'still',
// 'pick:<ids>', 'page:settings', 'page:help', 'page:conn'). There is no back chip (Max, 2026-11-23: "Remove home
// button"; a map tap or a pull down goes home, Esc and Android's back step back). This replaces the ten sheets that each showed and hid
// themselves (src/sheet.js before 2026-11-22): there is one screen state, the stack.
//
// Home is the search bar and ☰ alone (Max's pick C, 2026-11-25: "Search bar strict for searching. Remove its line
// indicating you can swipe it up"): no handle, no pull, no height but its rest; a tap on the field searches.
// Three resting heights for a page: low (its bar and its first line), half and full.
// The finger moves the sheet from anywhere on it; at full a finger scrolls the page, and a pull down from the page's
// top moves the sheet. A long pull down below low closes every page (back to Home).
// The head (Max's phone, 2026-11-23: the handle "seems to hit it but doesn't respond", the sheet hard to lower): the
// handle, the grip over the map just above it (#sheet-grip, 24 px: with the handle 44 px to hit) and the head's parts
// that aren't buttons or the field are one handle: a tap there (the finger may wander TAP_PX) toggles low ↔ half; a pull
// from anywhere on the head moves the sheet, and a pull down from the head of PULL_PX or more, never up first, lowers
// it at least one height.
// The root pages (roots: the start chips' cards, src/start-chips.js, in the chips' order): opened, one stands over Home
// alone (what was above Home goes) and a root page on top is replaced by it, sliding the way its chip lies, at the
// height it had; no ‹. Their head holds the chips (src/css/sheet.css .sh-chips; a computer: under the search box).
//
// createStack({ sheet, define, roots, onPad, onChange, onBack, held, above }) -> the stack (see the end).
//   above() -> px: what floats over the bar at rest (the start's chips, src/start-chips.js). On a phone the map's
//   buttons ride on the sheet's top edge (--sheet-h) but never lower than over those chips at rest: one value, so a
//   pulled page can't take them under the chips and back up (2026-11-26: they bounced 48 px).
//   define(key) -> a page, or null when the key names nothing (a train gone, a disruption ended):
//     { name: string | () => string (its name: stack.names()), kind ('home', 'train', 'station', ... : the sheet's
//       data-page), low: px (its low height; default the page low) or () -> px (fitted: the height of its content to
//       show at low, measured from the page's top edge like half(); 0: not known yet, the page low; null: its content
//       still coming, as half(); read with half()),
//       mount(el) (once, when made),
//       show(el, { dir, prev, level, again, ...opts }) (each time it comes on top: dir 1 opened, -1 back to it, 0 the
//       same height (replace); prev: the page it came from, { key, kind }; level: the height it comes at; again: it was
//       on top already, opened again), hide() (covered or gone), unmount() (taken off the stack), level(i) (the sheet
//       came to rest at height i), every() (once a second while it is on top), star: { on(), toggle() } and follow:
//       { can(), on(), toggle() } for the bar's ☆ and Follow,
//     half() -> px (optional): the page's own half height, the height of its content to show at half, measured from
//       the page's top edge (under the head); the stack adds the head and the phone's safe area, and keeps it between
//       low + 60 px and full - 40 px; null: its content is still coming (the sheet waits where it is, at most half the
//       screen: a half fitted to what is half drawn moved again when the rest came, a bounce). With a fitted low, half
//       may equal low (a computer's train card: low is already the whole card, 2026-11-23); then a tap on the handle
//       goes between low and full.
//       Without half(), half stops between the page's parts at or under the usual half (about half the screen), never
//       through a row (Max, 2026-11-23: Home's "Alla störningar" cut in half: "annoyingly cut off content"); a page
//       shorter than that: its whole content. }
//     dismiss() (optional): shut what is small and open in the page (the card's "to …" chooser), at once, with no
//       glide: a map tap (R1 below).
//     snap: false (optional): no fitting without half(): the usual half (a station's board: its rows come after it
//       opens, and a half fitted before them moved again once they came: a bounce, sheet-moves-check).
//     fit: { box, ready() } (optional): the page's heights follow its content at once (a train's card: Max, 2026-11-23
//       "the card expands after way too long"): box's size is watched; ready(): its content is in. See fit('card').
//     atFull(measure) (optional): its content's end measured with its full look on (a train's card: its tables).
//     full() -> px or null (optional): its own full height for now instead of its content's (the search's; New trip's
//       while its room for a phone's keyboard shows).
// The bar over a page holds only its own buttons (star, Follow, def.acts()); a page without any has no bar (the head
// folds away: .no-bar), and a page with def.barIn() takes them into itself (a train: its card's top line beside the
// number, Max 2026-11-23: "move the pills share star and following down as it were before"); then it has no bar either.
// Esc and Android's back step back one page. A soft fade at the sheet's bottom edge
// says there is more of the page below (Max, 2026-11-23: Home "has no indication that there is more content").
//   onPad(h): the map's free part is above this many pixels (the sheet's resting height, at most half): src/map.js setSheet.
//   onChange(top): a page came on top (the map's lit trains, the line above the bar).
//   onBack() -> bool: the browser's back steps back with this (src/back.js: ☰'s menu, The day, then back() here);
//   held() -> bool: something outside the stack is open to step back from (the browser's back stays ours: guard()).
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
import { reduceMotion, ms, speed } from './motion.js';
import { isWide, onWideChange, isNative, sheetGeometry } from './layout.js';
import { icon } from './icons.js';
import { esc } from './html.js';
import { t } from './i18n.js';

const MAX_PAGES = 12;          // pages over Home at most (the oldest go)
// The sheet's sizes are src/css/tokens.css's (:root --grab-h, --head-h ...), read in measure() into geo (src/layout.js
// sheetGeometry): geo.grab the handle alone (a page without a bar), geo.head the search bar's or a page's bar's row,
// geo.barGap the room between the bar and the page under it, geo.barEdge Home at rest: the search bar 12 px from the
// sheet edge below, as at its sides (Max, 2026-11-23).
// Room under the last part shown (Max, 2026-11-24: "Still too much padding in the bottom of some cards. Please remove
// ALL such cases"): geo.fitGap (12 px) when the page shows whole (nothing below, no sign); a phone's cut page
// geo.fitGapPhone (40 px: room for its "More" pill under it, not over the part's lower edge; Max, 2026-11-24: "Dålig
// padding på 'mer' pillret"; the pill 24 px tall, 4 px over the bottom bar); a computer's sign has its own band under
// the page. geo.topRoom: full height leaves this much at the top (the live mark).
const PAGE_LOW_PX = 140;       // a page resting low: its bar and its first line
// A page change's end: the longest of them (src/css/tokens.css --t-page-long; Debug → Page change), at the chosen speed (Debug →
// Animation speed). The leaving page's picture goes then; the page coming in keeps its class 100 ms more (it surely stands).
const pageDone = () => Math.max(ms('page'), ms('page-long'));
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

export function createStack({ sheet, define, roots = [], onPad = () => {}, onChange = () => {}, onBack = null, held = () => false, above = () => 0 }) {
  const isRoot = pg => Boolean(pg) && roots.includes(pg.key);
  const root = document.documentElement;
  const pagesEl = sheet.querySelector('.sh-pages');
  const input = sheet.querySelector('#search');
  const results = sheet.querySelector('#search-results');
  const barEl = sheet.querySelector('.sh-bar'), btnsEl = sheet.querySelector('.sh-btns'), upBtn = sheet.querySelector('.sh-up');
  const starBtn = sheet.querySelector('.sh-star'), folBtn = sheet.querySelector('.sh-follow'), actsEl = sheet.querySelector('.sh-acts');
  // the handle's grip over the map, just above the sheet (src/css/sheet.css #sheet-grip; a phone only)
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
  // thing): ⌃ at rest (a tap raises the sheet), ⌄ raised (a tap lowers it); src/css/sheet.css .sh-arrow. A phone keeps the dash.
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

  let geo = sheetGeometry(true);   // the sheet's sizes (the top of this file); read again in measure()
  const homeLow = () => geo.head + 2 * geo.barEdge;    // Home at rest: the search bar, as much room above it as under it
  const stack = [];          // [{ key, def, el, scroll, lvl }]
  const top = () => stack[stack.length - 1];
  let idx = 0, H = [homeLow(), 400, 800], fullMax = 800, preSearch = 0, ready = false;
  let drag = null, touching = false, lastScroll = 0, eatUntil = 0;
  const wide = isWide;
  // The search (in the sheet's head) is a page-like entry over Home while it is open, never on the stack: its results
  // are its page, its full their height (searchFull); it rests low as Home does, so any height under full shuts it.
  // srch: it while open, else null. cur(): what the sheet shows, the search or the page on top.
  let srch = null;
  const cur = () => srch ?? top();

  // ---------- heights ----------
  const fittedLow = pg => typeof pg?.def.low === 'function';
  // Which pages rest low: Home and a page with its own low (a train's collapsed card). Every other page has only half and
  // full (Max, 2026-11-23: "Closing out a fully expanded card is THREE swipes. Too much. Same with settings."): its low is
  // its half, so a pull down from half, a map tap there or a flick closes it.
  const keepsLow = pg => !pg || pg.key === 'home' || pg.key === 'search' || fittedLow(pg);
  // A half of its own, clearly above low (a computer's train card has none: its low is already the whole card); the
  // search has none either: from it, down is rest.
  const hasOwnHalf = () => !srch && H[1] - H[0] >= 30;
  // [low, half, full] of a page (the search: Home's low and half under it, its own full)
  // (Home holds nothing under the search bar since Max's pick C, 2026-11-25: no half, its half is its low, so the search
  // pulled down from full goes to the bar alone; Max, 2026-11-26: "when search is fully expanded and swipes down a little
  // bit, there is just a huge area of empty space")
  // (as the page will be once its glides end, atRest: a train card's parts measured mid-glide set its half 20 px too
  // tall and the tick took it in a second later, "the small card jumps a few pixels"; Max, 2026-11-26)
  function heightsOf(pg) {
    const base = pg === srch ? top() : pg;
    return atRest(base?.el, () => {
      const h0 = lowOf(base), h1 = base?.key === 'home' ? h0 : halfOf(base, h0);
      return [keepsLow(base) ? h0 : h1, h1, fullOf(pg, h1)];
    });
  }
  // Where a page's content ends (px from its top edge, its scroll counted): its parts' lowest edge. A part marked
  // [data-spacer] is room, not content (the New trip page's room to scroll a field above a phone's keyboard).
  const parts = el => [...el.children].filter(c => c.offsetHeight && !c.hasAttribute('data-spacer'));
  const contentEnd = el => parts(el).reduce((end, c) => Math.max(end, c.offsetTop + c.offsetHeight), 0);
  // Full: the page's content and the usual room under it, never more than the screen's full (fullMax) nor less than its
  // half (Max, 2026-11-24: "A full expanded card should never just show empty space. Cut it off earlier in that case").
  // A page whose content differs at full (a train's card: its tables, its notes) measures it so (def.atFull(measure)).
  // A phone's sheet stays fullMax tall and only slides (place): this is just where full stops.
  // The chips' cards (roots) open at full, as tall as they are, on both sizes (startOf; Max, 2026-11-26: "clicking stats,
  // saved or disruptions should show them fully expanded. But only as far as needed"; the phone too: "Statistics on phone
  // still doesn't open fully expanded like I asked"); a full only a little over their half is their half, no stop a few
  // px over another ("statistics seems to have three different heights it can snap to").
  function fullOf(pg, half) {
    const f = fullOfPage(pg, half);
    return isRoot(pg) && f - half < 60 ? half : f;
  }
  function fullOfPage(pg, half) {
    const own = pg?.def.full?.();
    if (own != null) return Math.min(fullMax, Math.round(own));
    const el = pg?.el;
    // (a page whose content is not in yet: the screen's full, so the sheet only ever goes down to it once it is)
    if (!el?.isConnected || (pg.def.fit && !pg.fitted)) return fullMax;
    // (as the page will be once its glides end: a part gliding shut measured whole kept the sheet tall and empty under
    // it until the tick took that away seconds later; Max, 2026-11-26, Störningar's rail work shut)
    const end = atRest(el, () => (pg.def.atFull ? pg.def.atFull(() => contentEnd(el)) : contentEnd(el)));
    if (!end) return fullMax;
    const need = headPx() + end + geo.fitGap + (wide() ? 0 : safe().bottom);
    return Math.round(Math.max(half, Math.min(fullMax, need)));
  }
  // the handle and the head: on a computer and at Home geo.barEdge more (room above the search field; src/css/sheet.css
  // .sh-head's margin-top); a computer's root page its chips' row under the search box too (geo.chipsRow);
  // a page without a bar: the handle alone
  // (the handle's row read from the page: a computer's train card has a thin one, src/css/sheet.css; Home has none)
  const atHome = () => sheet.dataset.page === 'home';
  const grabEl = sheet.querySelector('.sh-grab'), grabH = () => (atHome() ? 0 : grabEl?.offsetHeight || geo.grab);
  // (with the search bar: 8 px more under it, so a scrolled page goes out of sight below it, not right at its edge;
  // src/css/sheet.css .sh-head's margin; Max, 2026-11-24 "Better just add the padding")
  const headPx = () => (sheet.classList.contains('no-bar') ? 0 : geo.head + geo.barGap + (wide() && sheet.hasAttribute('data-root') ? geo.chipsRow : 0))
    + grabH() + (wide() || atHome() ? geo.barEdge : 0);
  // A page whose content is still coming (its half() or low() null): where the sheet is now, at most half the screen
  // (from Home at full a loading card covered it all until its stops came), measured as half() is
  const waiting = () => Math.max(1, Math.round(Math.min(shownTo, innerHeight * 0.5) - headPx()));
  function lowOf(pg) {
    const l = pg?.def.low, s = wide() ? 0 : safe().bottom;
    // (never under Home at rest: a long pull down from a train's collapsed card, 76 px, closed it to Home at 82 and the sheet
    // rose 6 px after the finger let go; sheet-moves-check, 2026-11-24)
    if (typeof l === 'function') { const c = l() ?? waiting(); return c > 0 ? Math.min(Math.max(headPx() + c, homeLow()) + s, fullMax - 40) : PAGE_LOW_PX + s; }
    // (a computer's handle band taller than the phone's handle: its extra room too, src/css/sheet.css #sheet .sh-grab)
    const band = wide() ? Math.max(0, grabH() - geo.grab) : 0;
    return pg?.key === 'home' ? homeLow() + s : (l ?? PAGE_LOW_PX) + s + (wide() ? geo.barEdge : 0) + band;
  }
  // Half: the page's own (def.half, see the top), else the usual half.
  // (never under low + 60, so a page resting low has a half clearly above it; a page without a low of its own (its low is
  // its half) none: "2 trains here" stood 74 px taller than its rows on a computer; Max, 2026-11-26: "Multiple trains
  // card shows too much empty space underneth")
  const floorOf = (pg, low) => (keepsLow(pg) ? low + (fittedLow(pg) ? 0 : 60) : 0);
  let usualHalf = 400;
  // (low: the page's low height, when it is about to change: the half is never under it)
  function halfOf(pg, low = lowOf(pg)) {
    if (!pg?.def.half) return snapHalf(pg, low);
    const own = pg.def.half(), want = own ?? waiting();
    // (a page that fits its content, measured once its content is in: from then its full is measured too, fullOf)
    if (pg.def.fit && own > 0) pg.fitted = true;
    if (!(want > 0)) return usualHalf;
    return Math.round(Math.max(floorOf(pg, low), Math.min(headPx() + want + (wide() ? 0 : safe().bottom), fullMax - 40)));
  }
  // A page without its own half: the lowest edge at or under the usual half where no row or small part is cut,
  // preferring the end of a whole part (a section) when it is near; a page shorter than the usual half: all of it.
  function snapHalf(pg, low) {
    const el = pg?.el;
    if (!el?.isConnected || pg.def.snap === false) return usualHalf;
    const base = headPx() + (wide() ? 0 : safe().bottom), limit = usualHalf - base;
    const top0 = el.getBoundingClientRect().top - el.scrollTop;
    const boxes = [];
    for (const e of el.querySelectorAll(':scope > *, :scope > * > *, :scope > * > * > *')) {
      const r = e.getBoundingClientRect();
      if (r.height > 0 && !e.closest('[data-spacer]')) boxes.push({ t: r.top - top0, b: r.bottom - top0, h: r.height, part: e.parentElement === el });
    }
    if (!boxes.length) return usualHalf;
    // (up to a fifth taller than the usual half when that shows a whole part, never closer than 40 px to full)
    const hi = Math.min(limit * 1.2, fullMax - base - 40), lo = limit * 0.5, gap = wide() ? geo.fitGap : geo.fitGapPhone;
    const end = Math.max(...boxes.map(x => x.b));
    if (end + geo.fitGap <= hi) return Math.round(Math.max(floorOf(pg, low), base + end + geo.fitGap));
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
    return want ? Math.round(Math.max(floorOf(pg, low), base + want)) : usualHalf;
  }

  // H[0..2] (low, half, full) change only here, fit(reason). The policy (new: measured again; -: kept):
  //   reason   asked by                low          half                       full                       placed
  //   page     show                    new          new                        new                        by setIndex
  //   dismiss  mapTap                  new          new                        new                        by mapTap
  //   resize   measure                 new          new                        new                        yes, no glide
  //   refit    unreveal                new          new                        new                        yes
  //   card     a def.fit box resized,  new, only taller (both ways: its first fit once ready, or within    yes
  //            the tick                1.5 s of a touch on the box: the chooser shut)
  //   level    setIndex                to half without a low: = half; to half: new; to full: at least new  by setIndex
  //   content  the page watcher        -            -                          at full: taller            yes
  //   tick     each second             -            at half: shorter only,     at full: taller; shorter   yes
  //                                                 not while revealed         on agreeing ticks
  //   reveal   reveal                  new          at least the part's end    at least the part's end    by reveal
  //   search   open / close search     -            -                          the search's / the page's  by its caller
  //   results  the results changed     -            -                          the search's (a computer)  yes
  // Shorter waits for two agreeing measures (a part gliding shut or open is measured mid-glide); taller never waits.
  let shorter = [null, null, null];   // a shorter height measured once at that level (agreed: the next tick's)
  const agreed = (i, h) => { if (shorter[i] === h) { shorter[i] = null; return true; } shorter[i] = h; return false; };
  const TOUCH_MS = 1500;
  const touched = new WeakMap();   // a def.fit box -> when the person last pressed it
  function fit(reason, arg) {
    const pg = cur();
    switch (reason) {
      case 'page': case 'dismiss': H = heightsOf(pg); return;
      case 'resize': H = heightsOf(pg); place(H[idx], false); sheet.getBoundingClientRect(); sheet.classList.remove('dragging'); pad(); return;
      case 'refit': case 'card': {
        const f = pg.def.fit;
        const both = reason === 'refit' || (f.ready() && !pg.fitted) || performance.now() - (touched.get(f.box) ?? 0) <= TOUCH_MS;
        let [h0, h1, h2] = heightsOf(pg);
        if (!both) { h0 = Math.max(h0, H[0]); h1 = Math.max(h1, H[1]); h2 = Math.max(h2, H[2]); }
        if (h0 === H[0] && h1 === H[1] && h2 === H[2]) { syncFade(); return; }
        H = [h0, h1, h2];
        if (!drag) { place(H[idx]); pad(); }
        return;
      }
      case 'level':
        if (srch) return;
        // (full measured as the page is, before its full look: it may have grown since its heights were read; half with
        // its half look on, its parts may have changed since: setIndex asks before and after it sets data-h)
        if (idx === 2) H[2] = Math.max(H[2], fullOf(pg, H[1]));
        else if (idx === 1) { H[1] = heightsOf(pg)[1]; if (!keepsLow(pg)) H[0] = H[1]; }
        return;
      case 'content': {
        if (idx !== 2 || drag) return;
        const f = fullOf(pg, H[1]);
        if (f > H[2] + 2) { H[2] = f; place(H[2]); pad(); }
        return;
      }
      case 'tick': {
        if (drag) return;
        if (idx === 1) {
          if (revealed) return;   // (grown on purpose for a part just opened: stays until it shuts, unreveal)
          const h1 = heightsOf(pg)[1];
          if (h1 >= H[1] - 8) { shorter[1] = null; return; }
          if (!agreed(1, h1)) return;
          H[1] = h1; place(H[1]); pad();
          return;
        }
        if (idx !== 2) return;
        const f = fullOf(pg, H[1]);
        if (Math.abs(f - H[2]) <= 2) { shorter[2] = null; return; }
        if (f < H[2] && !agreed(2, f)) return;
        shorter[2] = null;
        H[2] = f; place(H[2]); pad();
        return;
      }
      case 'reveal': {   // arg: the sheet's height that shows the part whole; returns the level to show it at
        const [l0, h1, f] = heightsOf(pg);
        H[2] = Math.max(f, Math.min(fullMax, Math.round(arg)));
        if (idx === 2) return 2;
        H[0] = l0;
        if (arg <= Math.max(h1, H[idx]) + 2) { H[1] = Math.max(h1, H[1], Math.round(arg)); return 1; }
        return 2;
      }
      case 'search': H[2] = fullOf(pg, H[1]); return;
      case 'results': {
        if (!wide() || drag) return;
        const f = fullOf(pg, H[1]);
        if (Math.abs(f - H[2]) > 2) { H[2] = f; place(H[2]); }
        return;
      }
      default: throw new Error(`fit: ${reason}?`);
    }
  }

  // A phone: the sheet is as tall as its tallest rest, slid down to the height shown (only its transform moves). A wider
  // screen: it floats 10 px above the bottom, so it takes the height shown itself (sliding it down would show its
  // lower part in that gap).
  const shownH = () => (wide() ? sheet.getBoundingClientRect().height : fullMax - new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42);
  let shownTo = 0;   // the shown height
  // The sheet to this height (glide: false, a finger holds it); render() then shows what rides on that.
  function place(h, glide = true) {
    sheet.classList.toggle('dragging', !glide);
    if (wide()) { sheet.style.transform = ''; sheet.style.height = `${Math.round(h)}px`; }
    else { sheet.style.height = `${fullMax}px`; sheet.style.transform = `translateY(${Math.round(fullMax - h)}px)`; }
    const was = shownTo;
    shownTo = h;
    going(h, was, glide);
    render(h, glide);
  }
  // What rides on the sheet's height: the CSS it is read from, the map's tall/high marks, the fade at its bottom edge.
  function render(h, glide) {
    root.style.setProperty('--sheet-shown', `${Math.round(h)}px`);
    // the map's buttons and its credit ride on the sheet's top edge (a phone); beside it on a wide screen
    root.style.setProperty('--sheet-h', wide() ? '0px' : `${Math.round(Math.max(h, lowOf(stack[0]) + above()))}px`);
    root.classList.toggle('sheet-tall', !wide() && h > innerHeight - 260);
    // (high: well over half and over 60 % of the screen; a short page at full, its content all of it since 2026-11-24,
    // leaves the map's buttons and the live mark in place)
    root.classList.toggle('sheet-high', h > H[1] + 70 && h > innerHeight * 0.6);
    sheet.style.setProperty('--sheet-off', wide() ? '0px' : `${Math.round(fullMax - h)}px`);
    if (glide) syncFade();
  }
  // Where the sheet is going (target: { level, height }) and when it stands: whenSettled() resolves once its own glide
  // has ended (at once when nothing glides or with reduce motion); onSettled(fn) each time it comes to rest.
  let target = { level: 0, height: 0 }, gliding = false, settleTimer = 0, waiters = [];
  const settledFns = new Set();
  function going(h, was, glide) {
    target = { level: idx, height: Math.round(h) };
    clearTimeout(settleTimer);
    if (!glide) { if (drag) gliding = true; else settled(); return; }   // (a finger holds it: it stands once let go and glided)
    if (reduceMotion() || (!gliding && Math.round(was) === Math.round(h))) { settled(); return; }
    gliding = true;
    settleTimer = setTimeout(settled, ms('glide') + 150);   // (no transitionend: an unchanged value, a hidden page)
  }
  function settled() {
    clearTimeout(settleTimer);
    const was = gliding;
    gliding = false;
    const w = waiters;
    waiters = [];
    w.forEach(fn => fn(target));
    if (was) for (const fn of settledFns) fn(target);
  }
  sheet.addEventListener('transitionend', (e) => { if (e.target === sheet && (e.propertyName === 'transform' || e.propertyName === 'height') && !drag) settled(); });
  // The fade at the bottom edge: the page has more below what is shown (not at low: the head and a line).
  // How much of the page is hidden under the shown bottom edge (px; its content, not its own room at the end). On a
  // computer the handle's row is at the bottom: not part of what shows.
  function hiddenBelow() {
    const pg = cur()?.el;
    if (!pg) return { visible: 0, below: 0 };
    const visible = shownTo - pagesEl.offsetTop - (wide() ? grabH() : 0);
    return { visible, below: contentEnd(pg) - pg.scrollTop - visible };
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
    const c = cur(), pg = c?.el;
    if (!pg) return t('moreWord');
    const kids = parts(pg);
    const at = k => k.offsetTop - pg.scrollTop;
    const hidden = kids.filter(k => at(k) >= visible - 4);
    const cut = kids.some(k => at(k) < visible - 4 && at(k) + k.offsetHeight > visible + 12);
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
  // Which way a tap on the handle moves the sheet (a computer's arrow points that way, src/css/sheet.css): up to show more only
  // when more is hidden (Max, 2026-11-24: the arrow "just expands the card to show more empty space"; Home at half gave
  // no sign of more below); else down (a page without a low: closed).
  function syncNext(below = hiddenBelow().below) {
    const low = keepsLow(cur());
    const more = (low && idx === 0) || (idx < 2 && below > 12) || (low && idx < 2 && !hasOwnHalf());
    // ('close': a tap would only close the page, which its ‹ does already: a computer shows no arrow then; Max,
    // 2026-11-24 "Screens like this has both back arrow and the collapse arrow that dismisses it. Remove the last one")
    const closes = !more && !low && !(idx === 2 && hasOwnHalf());
    const v = more ? 'more' : closes ? 'close' : 'less';
    if (sheet.dataset.next !== v) sheet.dataset.next = v;
  }
  function pad() { if (ready) onPad(Math.min(H[idx], H[1])); }
  function measure() {
    geo = sheetGeometry(true);
    const h = innerHeight, s = safe();
    // (a computer's sheet floats geo.inset from the screen's top and bottom)
    const full = wide() ? h - 2 * geo.inset : h - geo.topRoom - s.top;
    usualHalf = Math.round(Math.min(h * 0.6, Math.max(h * 0.5, 360), full - 40));
    fullMax = Math.round(full);
    fit('resize');
  }
  addEventListener('resize', measure);
  onWideChange(measure);

  function setIndex(i) {
    // (a page that doesn't rest low: half; closing it is home(), not a height)
    if (i <= 0 && !keepsLow(cur())) i = 1;
    // (Home, the bar alone, has only its rest)
    if (cur() === stack[0]) i = 0;
    // (the page notes how it looks before the height changes it, to glide from there: a train card's buttons)
    cur()?.def.beforeLevel?.(Math.max(0, Math.min(2, i)));
    idx = Math.max(0, Math.min(2, i));
    if (idx === 2) fit('level');
    sheet.dataset.h = String(idx);
    sheet.classList.remove('closing');
    if (idx < 2 && srch) closeSearch();
    const pg = cur();
    if (pg) pg.lvl = idx;
    // (the page takes its look for the new height before its half is measured: a train card measured with its full
    // look gave a half remembered from before, and when the card had changed since, the sheet stopped a few px off and
    // the tick moved it a second later; Max, 2026-11-26: "after the contration the small card jumps a few pixels")
    pg?.def.level?.(idx);
    if (idx === 1) fit('level');
    if (idx < 2) { const s = scroller(); if (s && s.scrollTop > 0) s.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); }
    place(H[idx]);
    pad();
    guard();
  }
  const scroller = () => cur()?.el;

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
    if (h < H[0] && keepsLow(cur())) h = H[0] - (H[0] - h) * 0.6;
    // never below Home at rest (a long pull down closes every page and Home rests there: pulled lower, the sheet rose
    // again after the finger let go, a bounce; sheet-moves-check, 2026-11-23)
    h = Math.max(lowOf(stack[0]), h);
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
    // A finger that stopped before it lifted throws nothing (2026-11-23, sheet-check: a pull held still at 60 px below its
    // start was thrown on by the speed of its last move).
    const v = performance.now() - d.lt > 120 ? 0 : d.v;
    // A flick down closes the page at once; on a page without low, any throw down from its half does.
    if (stack.length > 1 && (v < -FLICK_V || (!keepsLow(top()) && v < -0.45 && h < H[1] - 6))) { backTo(0); return; }
    // thrown: the next height that way; else the nearest
    let to;
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
    // (down to a half that is its low (Home's: heightsOf): the low itself, at rest)
    if (to > 0 && to < d.i0 && Math.abs(H[to] - H[to - 1]) <= 2) to -= 1;
    setIndex(to);
  }
  const isGrab = el => el === grip || Boolean(el.closest('.sh-grab')) || Boolean(el.closest('.sh-head, .pg-head') && !el.closest(NOT_GRAB));
  // Frozen (freeze(true): ☰'s menu open, src/nav-menu.js): the sheet holds still, no pull, no scroll, no tap on the
  // page behind; only ☰ and a map tap do anything then (Max, 2026-11-24: "When hamburger is acativated the normal
  // scroll of the card should not be possible"; "Only tapping search should be normal behavior, or hamburger or tap the
  // map dismisses"). The class .frozen stops the page's scroll (src/css/sheet.css).
  // (dismiss: what the sheet's handle or arrow does meanwhile: closes the menu; Max, 2026-11-25 "With menu is expanded,
  // the little arrow below search should work and dismiss menu")
  let frozen = false, dismissFrozen = null;
  function freeze(on, dismiss = null) { frozen = Boolean(on); dismissFrozen = frozen ? dismiss : null; sheet.classList.toggle('frozen', frozen); }
  function pointerDown(e) {
    touching = true;
    if (frozen) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // (Home: strictly the search, nothing to pull; the search's own field: it types)
    if (cur() === stack[0] || e.target.closest('label.sh-field')) return;
    // (a finger on a text field not being typed in moves the sheet like the rest, its tap still types: Max, 2026-11-23,
    // "Swiping down on a text entry field should also swipe the card")
    const typing = el => el.matches('select') || el === document.activeElement || e.pointerType !== 'touch';
    const input = e.target.closest('input, select, textarea');
    if (input && typing(input)) return;
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
      const low = keepsLow(cur());
      if (sheet.dataset.next === 'more') setIndex(low && idx === 0 && hasOwnHalf() ? 1 : 2);
      // (from full one step: to half when the page has one of its own, then to rest; Max, 2026-11-24: "When Main menu is
      // full expanded and the 'close arrow' is clicked, it should compact, not close it. Clicking map already closes.")
      else if (idx === 2 && hasOwnHalf()) setIndex(1);
      else if (low) setIndex(0);
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
    // (the sheet's own listener for the moves stays: a touch on the sheet itself, Home's bare edge, took it off, and no
    // touch after it could pull a page down: its moves came uncancellable; screens-check, 2026-11-25)
    const own = e.currentTarget === sheet;
    for (const [type, fn] of [['touchmove', touchMove], ['touchend', touchEnd], ['touchcancel', touchEnd]]) if (!own || type !== 'touchmove') e.currentTarget.removeEventListener(type, fn);
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
    tch = !frozen && idx === 2 && e.touches.length === 1 && !e.target.closest(HEAD) && !(e.target.closest('input, textarea') && e.target === document.activeElement)
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
    if (frozen) { e.preventDefault(); return; }
    if (idx === 2 || cur() === stack[0] || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (e.deltaY > 0 && performance.now() - wheelAt > 450) { wheelAt = performance.now(); setIndex(idx === 0 && !hasOwnHalf() ? 2 : idx + 1); }
  }, { passive: false });
  // A drag's click is no tap (the handle's tap: pointerEnd); on the page at low, a tap raises it to half.
  sheet.addEventListener('click', (e) => {
    if (performance.now() < eatUntil) { e.preventDefault(); e.stopPropagation(); return; }
    if (frozen && !e.target.closest('.sh-search')) { e.preventDefault(); e.stopPropagation(); if (e.target.closest('.sh-grab')) dismissFrozen?.(); return; }
    if (e.target.closest('.sh-grab')) return;
    if (idx === 0 && e.target.closest('.pg') && !e.target.closest('button, a, input, [role="button"]')) setIndex(1);
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
    if (def.fit) watchBox(def.fit.box);
    return pg;
  }
  // A def.fit page's box: its size watched (the sheet follows it at once, fit('card')), the person's presses on it noted
  const boxWatch = typeof ResizeObserver === 'function'
    ? new ResizeObserver((es) => { const f = top()?.def.fit; if (f && !srch && es.some(e => e.target === f.box)) fit('card'); }) : null;
  const watched = new WeakSet();
  function watchBox(box) {
    if (!box || watched.has(box)) return;
    watched.add(box);
    const press = () => touched.set(box, performance.now());
    box.addEventListener('pointerdown', press, true);
    box.addEventListener('click', press, true);
    boxWatch?.observe(box);
  }
  // A page's title line: its .g-head or .panel-head at its top (one level in at most)
  let headSwapTimer = 0;
  const headOf = pg =>pg.el.querySelector(':scope > .g-head, :scope > .panel-head, :scope > :first-child > .g-head, :scope > :first-child > .panel-head');
  // The bar over a page: ☆, Follow and the page's own buttons when it has them; none (or taken into the page): no bar.
  function syncBar() {
    const pg = top();
    if (!pg) return;
    sheet.dataset.page = pg.def.kind ?? pg.key.split(':')[0];
    // (data-head-swap: a chip's card just came or went, the head's chips and search box trade places; the leaving one
    // goes first, the coming one after it, never over it: src/css/sheet.css; Max, 2026-11-26: "the card visually buggs
    // out when closing. Clipping the search bar". Set only as the card comes or goes, kept through the fades: this
    // runs again each second)
    if (sheet.hasAttribute('data-root') !== isRoot(pg)) {
      sheet.setAttribute('data-head-swap', '');
      clearTimeout(headSwapTimer);
      headSwapTimer = setTimeout(() => sheet.removeAttribute('data-head-swap'), 600);
    }
    sheet.toggleAttribute('data-root', isRoot(pg));
    // Home's head is the search bar, a root page's the chips (src/css/sheet.css): ‹ and the buttons back in the bar, unseen
    if (pg.key === 'home' || isRoot(pg)) {
      sheet.classList.remove('no-bar');
      if (upBtn.parentElement !== barEl) barEl.prepend(upBtn);
      if (btnsEl.parentElement !== barEl) barEl.append(btnsEl);
      return;
    }
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
    // ‹ only on a page opened by a click in the page before it or the menu, never on one the map opened, whatever was
    // open before (Max, 2026-11-25: "Only arrow back when coming from a click on a previous card or menu etc. Never just
    // because you had a card open before"); and not where the page says noUp (a train's, over Home)
    const up = !pg.fromMap && !(typeof pg.def.noUp === 'function' ? pg.def.noUp() : pg.def.noUp);
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
    return r.top + seen;   // (where what it shows ends, on the screen)
  }
  // The page leaving slides out as a still picture of itself (Max, 2026-11-25: "horrible animation with elements
  // showing that shouldn't"): its own page lets go of its shared parts at once (a station's timetable, a train's card:
  // the next page may want them), so it emptied and its lower parts rose into view as it went. Its ids and key stay (its
  // look hangs on them); it goes after the new page, so a lookup finds the real one first, and under it
  // (src/css/sheet.css .pg-ghost); untouchable.
  const FROZEN = ['display', 'visibility', 'opacity', 'boxSizing', 'width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom',
    'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'position', 'top', 'justifyContent', 'alignItems',
    'flexDirection', 'gap', 'fontSize', 'lineHeight'];
  function ghostOf(el, cut = Infinity) {
    const g = el.cloneNode(true);
    g.classList.remove('in-r', 'in-l');
    g.classList.add('pg-ghost');
    // (each part frozen as it looks now: much of its look hangs on the sheet's page and height, which change as it
    // leaves: a train card's Follow came back and its stops rose 40 px in the copy; ui-sweep, 2026-11-25)
    const all = el.getElementsByTagName('*'), copies = g.getElementsByTagName('*');
    const looks = [], cutOff = new Set();
    // (what is under the cut isn't shown: hidden, not read; a long timetable has hundreds of parts)
    for (let i = 0; i < all.length; i++) {
      if (all[i].getBoundingClientRect().top > cut) { looks.push(null); cutOff.add(i); continue; }
      const cs = getComputedStyle(all[i]);
      looks.push(cs.display === 'none' ? null : FROZEN.map(k => cs[k]));
    }
    for (let i = 0; i < copies.length; i++) {
      const st = copies[i].style;
      if (!looks[i]) { st.display = 'none'; continue; }
      FROZEN.forEach((k, j) => { st[k] = looks[i][j]; });
    }
    // (a grid whose rows under the cut were hidden: the rest from its top; its height is kept, and the room the hidden
    // rows left was spread over the others, 4 px more under each of Settings' rows, 48 px by the last; ui-sweep,
    // 2026-11-26. Only those: a grid centring an icon keeps its centre)
    if (cutOff.size) {
      const at = new Map([...all].map((e, i) => [e, i]));
      for (let i = 0; i < copies.length; i++) {
        if (!looks[i] || !/grid/.test(looks[i][0])) continue;
        if ([...all[i].children].some(c => cutOff.has(at.get(c)))) copies[i].style.alignContent = 'start';
      }
    }
    const from = el.querySelectorAll('canvas'), to = g.querySelectorAll('canvas');
    from.forEach((c, i) => { try { to[i].getContext('2d')?.drawImage(c, 0, 0); } catch { /* a picture it can't copy: blank */ } });
    g.inert = true;
    g.setAttribute('aria-hidden', 'true');
    return g;
  }
  // The height a page opens at: its def.startLevel (a number, or a function of nothing), else half; the chips' cards at
  // full, as tall as they are (fullOf; Max, 2026-11-26: "clicking stats, saved or disruptions should show
  // them fully expanded. But only as far as needed")
  function startOf(pg) {
    const own = typeof pg.def.startLevel === 'function' ? pg.def.startLevel() : pg.def.startLevel;
    return Math.max(1, own ?? (isRoot(pg) ? 2 : 1));
  }
  function show(pg, prev, dir, opts = {}) {
    const old = prev?.el;
    const pagesTop0 = pagesEl.getBoundingClientRect().top;   // (the leaving page's copy is held where it was: below)
    // (what the last page noted for its heights isn't this page's: a part revealed there kept this one's half from
    // shrinking)
    revealed = null; shorter = [null, null, null];
    if (prev) prev.scroll = old.scrollTop;
    let ghost = null;
    if (old && old !== pg.el && old.isConnected) {
      if (!reduceMotion()) {
        ghost = ghostOf(old, clipLeaving(old));
        old.style.clipPath = '';
        // (a computer, back to Home: the card fades where it is as the sheet closes to the search box, no slide; it lay
        // under the search box fading in, three moves in one place; Max, 2026-11-26: "still buggy animations when closing
        // out cards on the search bar")
        ghost.classList.add(wide() && pg === stack[0] ? 'out-fade' : dir > 0 ? 'out-l' : 'out-r');
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
      setTimeout(() => el0.classList.remove('in-r', 'in-l'), pageDone() + 100 * speed());
    }
    pagesEl.append(pg.el);
    // (the copies always after the real pages, an older one still sliding too: a page coming back within its slide went
    // after it, and a lookup found the copy's bin first; ideas-check, 2026-11-25)
    for (const g of pagesEl.querySelectorAll(':scope > .pg-ghost')) pagesEl.append(g);
    if (ghost) {
      pagesEl.append(ghost);
      ghost.scrollTop = prev.scroll;
      setTimeout(() => ghost.remove(), pageDone());
    }
    syncBar();
    const level = opts.level ?? (dir > 0 ? startOf(pg) : pg.lvl ?? 1);
    // (the height it will have, before the sheet has it: a card drawn for the old page's height first redrew a frame later)
    pg.def.show?.(pg.el, { dir, prev: prev ? { key: prev.key, kind: prev.def.kind ?? prev.key.split(':')[0] } : null, level, ...opts });
    syncBar();   // (‹ and the buttons on its title line before its heights and its scroll are read: a list came back 4 px short)
    fit('page');   // (once its content is in)
    setIndex(level);
    // (back to a scrolled page: on a computer the sheet grows downward as it comes, so a scroll kept from a taller
    // page was pulled back with every frame and the page slid down the whole way; the one that fits its final height
    // from the start: what is shown stays, the bottom edge reveals the rest; ui-sweep, 2026-11-25)
    const room = wide() ? Math.max(0, H[idx] - shownH()) : 0;
    pg.el.scrollTop = dir < 0 && idx === 2 ? Math.min(pg.scroll ?? 0, Math.max(0, pg.el.scrollHeight - pg.el.clientHeight - room)) : 0;
    syncBar();
    // (the head grew or shrank with the new page, the search bar back on Home: the pages' area moved with it, and the
    // leaving page's copy jumped 52 px in one frame as it went; Max, 2026-11-26: "Dismissing any cards the animation is
    // buggy and jittery with the search pill")
    if (ghost) {
      const d = Math.round(pagesTop0 - pagesEl.getBoundingClientRect().top);
      if (d) ghost.style.inset = `${d}px 0 ${-d}px 0`;
    }
    onChange(pg);
    guard();
  }
  // Open the page with this key (a page already on the stack: back to it).
  function open(key, opts = {}) {
    if (srch) closeSearch();
    const at = stack.findIndex(p => p.key === key);
    if (at >= 0 && at === stack.length - 1) {   // it is open: up to half, shown again
      if (idx === 0) setIndex(1);
      top().def.show?.(top().el, { dir: 0, prev: null, again: true, ...opts });
      syncBar();
      return true;
    }
    // (opened again by a tap: at its start height, not the one it was left at; Max, 2026-11-23: a train card left
    // collapsed came back collapsed. Esc and the phone's back keep the height: back())
    if (at >= 0) { backTo(at, opts.level ?? startOf(stack[at])); return true; }
    const def = define(key);
    if (!def) return false;
    const prev = top(), pg = make(key, def);
    pg.fromMap = Boolean(opts.fromMap);   // (opened by a tap on the map: no ‹, syncBar)
    if (isRoot(pg)) { openRoot(pg, prev, opts); return true; }
    stack.push(pg);
    while (stack.length > MAX_PAGES + 1) { const gone = stack.splice(1, 1)[0]; gone.def.unmount?.(); gone.el.remove(); }
    recent(key);
    show(pg, prev, 1, opts);
    return true;
  }
  // A root page over Home alone (the top of this file): what was above Home goes; a root page on top is replaced,
  // the new one sliding in from the side its chip is on, at the height the old one had.
  function openRoot(pg, prev, opts) {
    const gone = stack.splice(1);
    stack.push(pg);
    const swap = isRoot(prev);
    const dir = swap ? Math.sign(roots.indexOf(pg.key) - roots.indexOf(prev.key)) : 1;
    show(pg, prev, dir, swap && opts.level === undefined ? { ...opts, level: Math.max(1, idx) } : opts);
    for (const p of gone) { if (p !== prev) p.def.hide?.(); p.def.unmount?.(); }
  }
  // Back to the page at i (everything above it goes).
  function backTo(i, level) {
    if (i >= stack.length - 1 || i < 0) return;
    const prev = top();
    const gone = stack.splice(i + 1);
    show(top(), prev, -1, level === undefined ? {} : { level });
    for (const p of gone) { if (p !== prev) p.def.hide?.(); p.def.unmount?.(); if (p.el !== top().el) setTimeout(() => p.el.remove(), reduceMotion() ? 0 : pageDone()); }
  }
  function home(level) { if (stack.length > 1) backTo(0, level); else setIndex(level ?? idx); }
  // A part of the page wants full height for a while (a station's board with its messages or its search open: token
  // 'board'): raised to full from where it was; released, back there (a sheet moved by hand meanwhile stays). release
  // with move false only forgets (the page it was asked for is gone).
  const raisedFrom = new Map();   // token -> the level it was raised from
  function requestFull(token) { if (idx < 2) { raisedFrom.set(token, idx); setIndex(2); } }
  function releaseFull(token, move = true) {
    if (!raisedFrom.has(token)) return;
    const from = raisedFrom.get(token);
    raisedFrom.delete(token);
    if (move && idx === 2) setIndex(from);
  }
  // One step back: the search, a page, then the sheet down to rest. false: nothing left (Android: the app
  // goes to the background).
  function back() {
    if (srch) { closeSearch(); setIndex(preSearch); return true; }
    if (stack.length > 1) { backTo(stack.length - 2); return true; }
    if (idx > 0) { setIndex(0); return true; }
    return false;
  }
  // A tap on the map's empty ground (R1 at the top): what is small closes, then the sheet goes down to the page's
  // lowest height, or, already there, every page closes. Returns what it did: 'down', 'home' or null (Home at rest).
  function mapTap() {
    if (srch) { closeSearch(); setIndex(0); return 'down'; }
    const pg = top();
    pg.def.dismiss?.();
    // (a computer: every page closes at once, Home at rest; Max, 2026-11-26: "a click on the map with a card open should
    // close it out, not just collapse it in stages")
    if (wide() && stack.length > 1) { revealed = null; home(0); return 'home'; }
    fit('dismiss');   // (what was dismissed took its room with it)
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
    if (srch || !pg || !el?.isConnected || !pg.el.contains(el)) return;
    // (its start and end measured from the top of the page's content)
    const r = el.getBoundingClientRect(), top0 = pg.el.getBoundingClientRect().top - pg.el.scrollTop;
    const start = r.top - top0, end = (bottom ?? r.bottom) - top0 + 12;
    const need = pagesEl.offsetTop + end + (wide() ? 0 : safe().bottom);   // the sheet's height that shows all of it
    // (full: the page's new content, the part still gliding open counted to its end)
    const to = fit('reveal', need);
    if (idx < 2) {
      revealed = { key: pg.key, from: idx, to };
      if (to === 1) { if (idx === 0) setIndex(1); else { place(H[1]); pad(); } return; }
      setIndex(2);
    }
    if (!drag) { place(H[2]); pad(); }
    // at full: scrolled until its end is in view, its start kept in view (the page's height at full: under the head, less
    // the fade at the bottom edge)
    const view = H[2] - pagesEl.offsetTop - 40 - (wide() ? 0 : safe().bottom);
    const over = end - pg.el.scrollTop - view;
    if (over > 0) pg.el.scrollBy({ top: Math.max(0, Math.min(over, start - pg.el.scrollTop - 8)), behavior: reduceMotion() ? 'auto' : 'smooth' });
  }
  function unreveal() {
    const pg = top(), was = revealed;
    revealed = null;
    if (srch || !pg) return;
    if (was && was.key === pg.key && idx === was.to) { setIndex(was.from); return; }
    // (the half from the new low: from the old one, a card whose chooser shut kept its taller half, its room left empty
    // under it, and a map tap then only took that room away: Max's case (a), 2026-11-23)
    // (measured as the page will be: the part has only begun to glide shut, measured now it was still whole, and the
    // sheet stood that tall and empty until the tick took it in two seconds later; Max, 2026-11-26: Störningar's
    // "expanding and contracting the card leaves a lot of empty space")
    atRest(pg.el, () => fit('refit'));
  }
  // measure() with the page's glides (CSS transitions in el) for that moment at their end, then back where they were:
  // where a glide just started will take the page (just short of the end: a glide at its end is over and gone; one
  // without an end, a loading sign's, left alone)
  function atRest(el, measure) {
    const glides = el?.getAnimations?.({ subtree: true }).filter(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)) ?? [];
    const was = glides.map(a => a.currentTime);
    for (const a of glides) a.currentTime = a.effect.getComputedTiming().endTime - 0.01;
    try { return measure(); } finally { glides.forEach((a, i) => { a.currentTime = was[i]; }); }
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
  const searchPg = { key: 'search', el: results, def: { kind: 'search', full: () => searchFull() }, lvl: 2 };
  // (straight to full, not through setIndex: the map keeps the room it had under the sheet, pad)
  function openSearch() {
    if (srch) return;
    if (isRoot(top())) home(0);   // (a computer's chip card under the search box: the search over Home instead)
    if (top()?.key !== 'home') return;
    preSearch = idx;
    srch = searchPg;
    guard();
    sheet.dataset.search = '';
    results.hidden = false;
    pagesEl.append(results);
    onSearch(true);
    idx = 2; sheet.dataset.h = '2';
    fit('search');
    place(H[2]);
    results.scrollTop = 0;
  }
  // The search's height: a phone's all of the screen (its keyboard covers the lower half: the field goes up, clear of
  // it); a computer's as tall as its results, growing and shrinking with them (Max, 2026-11-24: "Just clicking the
  // search bar expands the card fully with just empty space. It should be sized dynamically relating to the search
  // results"); empty, only its line and the usual room under it (Max, 2026-11-25: "Empty search field has too big empty
  // card": a floor of 120 px under the bar left ~100 px empty)
  function searchFull() {
    if (!wide()) return fullMax;
    // (the handle's band at the bottom is hidden while searching, src/css/sheet.css: not counted)
    return Math.round(Math.min(fullMax, headPx() - grabH() + (grabEl?.offsetHeight ?? 0) + Math.max(contentEnd(results), 24) + geo.fitGap));
  }
  new MutationObserver(() => { if (srch) fit('results'); }).observe(results, { childList: true, subtree: true, characterData: true });
  // (Home's full read while the results still show, Home hidden: the screen's full, as since the search began)
  function closeSearch() {
    if (!srch) return;
    srch = null;
    fit('search');
    delete sheet.dataset.search;
    results.hidden = true;
    if (input.value) input.value = '';
    if (document.activeElement === input) input.blur();
    onSearch(false);
  }
  input.addEventListener('focus', openSearch);
  // (only while searching: a field left focused after the search closed took Esc and did nothing, so the first Esc over
  // a page was lost; stats-board-check, 2026-11-24)
  input.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (!srch) { input.blur(); return; } e.stopPropagation(); closeSearch(); setIndex(preSearch); });
  sheet.querySelector('.sh-cancel').addEventListener('click', () => { closeSearch(); setIndex(preSearch); });

  // ---------- the bar ----------
  upBtn.addEventListener('click', () => back());
  // A page drawing its title line again drops ‹ and the buttons from it: put back at once, not at the next second (a
  // board's tab or its search closed made its line 8 px shorter for a moment: sheet-moves-check)
  // (before the frame is drawn: the observer runs before paint)
  // The page's content changed: at full it grows with it in the next frame, not at the next tick (a board turned to its
  // whole day, the board's search stayed at half height for a second: stats-board-check, 2026-11-24): fit('content')
  let contentPending = false;
  new MutationObserver(() => {
    if (!upBtn.isConnected || !btnsEl.isConnected) syncBar();
    if (contentPending) return;
    contentPending = true;
    requestAnimationFrame(() => { contentPending = false; if (!srch) fit('content'); });
  }).observe(pagesEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  starBtn.addEventListener('click', () => { top()?.def.star?.toggle(); syncBar(); });
  actsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-act-id]'); if (b) { top()?.def.act?.(b.dataset.actId); syncBar(); } });
  folBtn.addEventListener('click', () => { top()?.def.follow?.toggle(); syncBar(); });


  // ---------- each second: the page on top (not while a finger is on it or it scrolls) ----------
  const busy = () => touching || drag || performance.now() - lastScroll < 500;
  setInterval(() => {
    const pg = top();
    if (!pg || srch) return;
    if (!busy()) { pg.def.every?.(idx); if (pg.def.fit) fit('card'); fit('tick'); syncFade(); }
    syncBar();
  }, 1000);

  // ---------- the phone's own back in a browser (Max, 2026-11-23: "swipe back again closes the page, not swipe back")
  // The browser's back (Android's gesture, the back button) left the site. While there is something to step back from
  // (a page, the search, the sheet raised) one history entry of our own stands in front: back takes it and steps one
  // thing back, as Android's back in the app does (src/back.js: the same chain); with nothing left it leaves. Not in the app.
  const NATIVE = isNative();
  // (only a step back off our own entry counts: an address followed forward, a #train= link or a changed setting in the
  // address, also brings a popstate, and was taken for a back press that undid it; debug-check, 2026-11-24. A back keeps
  // the history's length; a new entry changes it or replaces ours.)
  let guarded = false, guardLen = 0;
  function guard() {
    if (!ready || NATIVE || guarded) return;
    if (stack.length > 1 || idx > 0 || srch || held()) { try { history.pushState({ sparat: 1 }, ''); guarded = true; guardLen = history.length; } catch { /* (a sandboxed frame) */ } }
  }
  addEventListener('popstate', (e) => {
    if (NATIVE || !guarded) return;
    guarded = false;
    if (e.state?.sparat || history.length !== guardLen) return;   // (not a step back off our entry)
    if ((onBack ?? back)()) guard();
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

  // (what floats on the sheet's edge changed without the sheet moving: the chips hidden by ☰'s menu, a width change)
  const edgeChanged = () => render(shownTo, true);
  const api = {
    edgeChanged,
    open, back, backTo, home, close, replace,
    top: () => top()?.key ?? null,
    keys: () => stack.map(p => p.key),
    names: () => stack.map(nameOf),
    has: key => stack.some(p => p.key === key),
    isRoot: key => roots.includes(key),
    setLevel: i => setIndex(i),
    get level() { return idx; },
    get heights() { return [...H]; },
    get searching() { return Boolean(srch); },
    get busy() { return busy(); },
    // where the sheet is going ({ level, height }), and its glide's end (see going())
    get target() { return { ...target }; },
    whenSettled: () => (gliding ? new Promise((r) => { waiters.push(r); }) : Promise.resolve({ ...target })),
    onSettled(fn) { settledFns.add(fn); return () => settledFns.delete(fn); },
    openSearch, closeSearch, refreshBar: syncBar, recent: () => [...lately],
    onSearch(fn) { onSearch = fn; },
    pageEl: key => stack.find(p => p.key === key)?.el ?? null,
    pageDef: key => stack.find(p => p.key === key)?.def ?? null,
    mapTap, reveal, unreveal, freeze, requestFull, releaseFull,
    guard,   // (something outside the stack opened: the browser's back is ours until it is stepped back from)
  };
  return api;
}
