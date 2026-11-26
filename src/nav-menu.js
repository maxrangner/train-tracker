// ☰'s menu: a card under the search bar, an icon before each choice; its right edge in line with the box's outer edge
// (a computer: the sheet's; a phone, whose sheet is the screen's width: the bar's, ☰'s; Max, 2026-11-25)
// (Filter, The day, Settings, About; Max's pick C, 2026-11-25: the start's chips hold the rest, src/start-chips.js). It slides out from under the bar and back under it, as fast both ways; where there is no
// room under the bar (a phone's sheet at rest, its bar at the bottom) it comes out above the sheet. The page behind
// holds still while it is open (src/stack.js freeze). ☰, the sheet's arrow, a map tap, a page coming up, Esc and the backs close it
// (src/back.js).
//
// A choice that opens a page (Settings, About) parks it: it stays where it is, under the sheet, and the page slides over it;
// hidden once covered; back on Home it is there again as the sheet goes down, and open once the sheet stands (Max,
// 2026-11-25: "the hamburger menu clips through the new card. New card should just slide over with menu under, since it
// comes back at the back press anyways").
//
// One owner of its state: closed -> opening -> open -> closing -> closed; open -> parked -> open (back) or closed. Opening waits for the sheet to stand
// (stack.whenSettled) when it has to move first: the card is placed from where the sheet comes to rest, never from
// where it is on its way (a computer's chip card: closed first; back on Home from a page the menu opened: reopenOnHome).
//
// createNavMenu({ stack, mapEl, onDay, onState }) -> { isOpen, shown (not closed: on screen), open(), close(), toggle(),
//   reopenOnHome(), pageOnTop(key) }; stack is a getter (the sheet is made after the menu); onState(): its state changed
//   (the start's chips step aside while it shows).
import { icon } from './icons.js';
import { onTap } from './tap.js';
import { reduceMotion, ms, easing } from './motion.js';
import { isWide, sheetGeometry } from './layout.js';

export function createNavMenu({ stack, mapEl, onDay, onState = () => {} }) {
  const navEl = document.getElementById('nav'), button = document.getElementById('nav-button');
  // Its window: the part of the screen past the line it comes out of (the box's bottom edge; above the sheet's top when
  // it comes out above), which it slides in and out of, so nothing of it shows past that line. A still window, not a
  // cut that moves with the card: the browser moved the card and its cut in two steps, and a frame where they parted
  // showed its corner through the box's rounded corner and its rows over the box (Max, 2026-11-26: "Calling Hamburger
  // menu shows its corner in the top right of the search bar before moving down"). src/css/menu.css #nav-window.
  const winEl = Object.assign(document.createElement('div'), { id: 'nav-window' });
  navEl.before(winEl);
  winEl.append(navEl);
  const sheetEl = document.getElementById('sheet');
  for (const ic of navEl.querySelectorAll('[data-icon]')) ic.innerHTML = icon(ic.dataset.icon, 20);
  const gap = () => sheetGeometry().inset;   // between the bar (or the sheet's edge) and the card (src/css/tokens.css --sheet-inset)
  let state = 'closed', side = 'below', turn = 0, placed = false;
  let faded = false;   // parked and faded out: the page it opened didn't cover it (fromMenu)
  let backHome = false;   // a page the menu opened: back on Home the menu is open again

  // What the state looks like: the only place the card's hidden, ☰'s aria-expanded and the sheet's freeze are written.
  function enter(next) {
    state = next;
    if (next !== 'parked') faded = false;
    const on = next === 'opening' || next === 'open';
    navEl.hidden = next === 'closed';
    navEl.classList.toggle('under', next === 'parked');
    button.setAttribute('aria-expanded', String(on));
    stack().freeze(on, close);   // (the sheet's arrow/handle closes it too: src/stack.js freeze)
    // (opening, not placed yet: not shown, where it was, until it slides out from its place once the sheet stands)
    navEl.style.visibility = next === 'opening' && !placed ? 'hidden' : '';
    if (next === 'closed' || next === 'open') navEl.getAnimations().forEach(x => x.cancel());
    onState();
  }
  function place() {
    const a = button.getBoundingClientRect(), s = sheetEl.getBoundingClientRect();
    const w = navEl.offsetWidth, h = navEl.offsetHeight;
    const right = isWide() ? s.right : a.right;
    navEl.style.left = `${Math.round(Math.max(10, Math.min(innerWidth - w - 10, right - w)))}px`;
    // (a computer at rest: under the whole box, its arrow band included)
    const under = isWide() && stack().level === 0 ? s.bottom : a.bottom, g = gap();
    // (its top in the window, which starts at the line below, at the screen's top above)
    if (under + g + h <= innerHeight - 10) {
      side = 'below';
      Object.assign(winEl.style, { top: `${Math.round(under)}px`, bottom: '0px', height: '' });
      navEl.style.top = `${Math.round(g)}px`;
    } else {
      side = 'above';
      Object.assign(winEl.style, { top: '0px', bottom: '', height: `${Math.round(s.top)}px` });
      navEl.style.top = `${Math.round(Math.max(10, s.top - g - h))}px`;
    }
  }
  // (out from behind the box and back behind it: the card lies under the sheet (src/css/menu.css) and moves its whole
  // height plus the gap, so it shows in the gap as it goes (Max, 2026-11-25: "Menu should go all the way behind the search
  // bar"); its window cuts it at the box's line, above)
  function slide(out) {
    navEl.getAnimations().forEach(x => x.cancel());
    if (reduceMotion()) return Promise.resolve();
    const d = navEl.offsetHeight + gap(), away = { transform: `translateY(${side === 'below' ? -d : d}px)` }, shown = { transform: 'none' };
    return navEl.animate(out ? [away, shown] : [shown, away], { duration: ms('fold'), easing: easing('ui'), fill: 'forwards' }).finished.catch(() => {});
  }

  // settle: wait for the sheet to stand before placing the card (it is moving, or about to)
  function open({ settle = false } = {}) {
    const st = stack();
    if (st.searching || state === 'opening' || state === 'open') return;
    // (opened over a chip's card, a computer's: the card closes first, the menu comes out from under the box at rest)
    const lower = st.isRoot(st.top());
    if (lower) st.home(0);
    const mine = ++turn;
    placed = false;
    enter('opening');
    st.guard();   // (the browser's back closes it: src/back.js)
    const go = () => {
      if (turn !== mine) return;
      placed = true;
      navEl.style.visibility = '';
      place();
      slide(true).then(() => { if (turn === mine) enter('open'); });
    };
    if (lower || settle) st.whenSettled().then(go);
    else go();
    navEl.querySelector('.nav-row:not([hidden])')?.focus({ preventScroll: true });
  }
  // (also when a page comes up from the menu or over it: the card slides back, the page comes meanwhile)
  function close() {
    if (state === 'closed' || state === 'closing') return;
    if (state === 'parked') { ++turn; enter('closed'); return; }   // (under a page: gone at once)
    const mine = ++turn;
    if (!placed) { enter('closed'); return; }   // (never shown: gone at once)
    enter('closing');
    return slide(false).then(() => { if (turn === mine) enter('closed'); });
  }
  // (coming back on Home, parked but shown again: ☰ shuts it, as an open menu)
  const toggle = () => (state === 'opening' || state === 'open' || (state === 'parked' && !navEl.hidden) ? close() : open());
  // Back on Home from a page the menu opened: open again once the sheet stands (a task later: not inside the stack's
  // own page change).
  function reopenOnHome() {
    if (!backHome) return;
    backHome = false;
    if (state !== 'parked') { queueMicrotask(() => open({ settle: true })); return; }
    // (parked: shown again under the sheet at once, uncovered as the sheet goes down; open once it stands)
    const mine = ++turn;
    navEl.hidden = false;
    if (faded) { faded = false; fade(true); }   // (it faded as a page that didn't cover it came: back where it was)
    button.setAttribute('aria-expanded', 'true');
    stack().whenSettled().then(() => { if (turn !== mine || state !== 'parked') return; place(); enter('open'); });
  }

  onTap(button, toggle);   // (at once also right after a swipe: src/tap.js)
  // (a finger on the map leaves it open: a plain map tap closes it through the map's onMapTap; inside the sheet only ☰
  // does anything while it is open, src/stack.js frozen; elsewhere a press closes it)
  document.addEventListener('pointerdown', (e) => {
    if ((state === 'opening' || state === 'open') && !e.target.closest?.('#sheet, #nav') && !mapEl.contains(e.target)) close();
  }, true);
  // (also while still sliding out: a quick tap on a choice parks it where it is going, so back finds it there, not
  // sliding out again; hidden once the page stands only where the page doesn't cover it, so a pull down on the page
  // uncovers it as it goes; Max, 2026-11-26: "When clicking back from settings for example the menu should not slide up
  // again, it should already be there")
  const fromMenu = (key) => {
    if (state !== 'open' && !(state === 'opening' && placed)) { close(); backHome = true; stack().open(key); return; }
    const mine = ++turn;
    navEl.getAnimations().forEach(x => x.finish());
    enter('parked');
    backHome = true;
    stack().open(key);
    // (a page that won't cover it, a computer's short Filter: it fades as the page comes, where it is, and back on Home
    // fades in there again; it showed under the page's edge until the sheet stood, then went in one frame; Max,
    // 2026-11-26: "Clicking filter option, the menu disappears when the too short card appears")
    const hide = () => {
      if (turn !== mine || state !== 'parked' || faded) return;
      faded = true;
      fade(false).then(() => { if (turn === mine && state === 'parked') { navEl.hidden = true; navEl.getAnimations().forEach(x => x.cancel()); } });
    };
    if (!coversAt(stack().target.height)) hide();
    stack().whenSettled().then(() => { if (!covered()) hide(); });
  };
  const covered = () => {
    const n = navEl.getBoundingClientRect(), s = sheetEl.getBoundingClientRect();
    return n.top >= s.top && n.bottom <= s.bottom && n.left >= s.left && n.right <= s.right;
  };
  // (whether the sheet will cover it at the height it is going to: a computer's hangs from its top, a phone's stands on
  // the screen's bottom)
  const coversAt = (h) => {
    const n = navEl.getBoundingClientRect(), s = sheetEl.getBoundingClientRect();
    return isWide() ? n.bottom <= s.top + h : n.top >= innerHeight - h;
  };
  const fade = shown => (reduceMotion() ? Promise.resolve()
    : navEl.animate([{ opacity: shown ? 0 : 1 }, { opacity: shown ? 1 : 0 }], { duration: ms('fold') * 0.6, easing: 'linear', fill: 'forwards' }).finished.catch(() => {}));
  document.getElementById('open-filter').onclick = () => fromMenu('filter');
  document.getElementById('open-day').onclick = () => { close(); onDay(); };
  document.getElementById('open-settings').onclick = () => fromMenu('page:settings');
  document.getElementById('help-button').onclick = () => fromMenu('page:help');

  return {
    get isOpen() { return state === 'opening' || state === 'open'; },
    // (parked under a page: not shown; parked and shown again on Home while the sheet goes down, reopenOnHome: shown, so
    // the start's chips stay aside and don't flash in until it is open; ui-sweep 'settings → back', 2026-11-26)
    get shown() { return state !== 'closed' && !(state === 'parked' && navEl.hidden); },
    open, close, toggle, reopenOnHome,
    // A page came on top: the menu is Home's, any other page shuts it (the status pill, the map); Home may reopen it.
    pageOnTop(key) { if (key === 'home') reopenOnHome(); else if (state !== 'parked') close(); },
  };
}
