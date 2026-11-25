// ☰'s menu: a card under the search bar, an icon before each choice; its right edge in line with the box's outer edge
// (a computer: the sheet's; a phone, whose sheet is the screen's width: the bar's, ☰'s; Max, 2026-11-25)
// (The day, Settings, About). It slides out from under the bar and back under it, as fast both ways; where there is no
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
// where it is on its way (Home raised: lowered first; back on Home from a page the menu opened: reopenOnHome).
//
// createNavMenu({ stack, mapEl, onDay }) -> { isOpen, shown (not closed: on screen), open(), close(), toggle(),
//   reopenOnHome(), pageOnTop(key) }; stack is a getter (the sheet is made after the menu).
import { icon } from './icons.js';
import { onTap } from './tap.js';
import { reduceMotion, ms, easing } from './motion.js';
import { isWide, sheetGeometry } from './layout.js';

export function createNavMenu({ stack, mapEl, onDay }) {
  const navEl = document.getElementById('nav'), button = document.getElementById('nav-button');
  const sheetEl = document.getElementById('sheet');
  for (const ic of navEl.querySelectorAll('[data-icon]')) ic.innerHTML = icon(ic.dataset.icon, 20);
  const gap = () => sheetGeometry().inset;   // between the bar (or the sheet's edge) and the card (src/css/tokens.css --sheet-inset)
  let state = 'closed', side = 'below', turn = 0, placed = false;
  let backHome = false;   // a page the menu opened: back on Home the menu is open again

  // What the state looks like: the only place the card's hidden, ☰'s aria-expanded and the sheet's freeze are written.
  function enter(next) {
    state = next;
    const on = next === 'opening' || next === 'open';
    navEl.hidden = next === 'closed';
    navEl.classList.toggle('under', next === 'parked');
    button.setAttribute('aria-expanded', String(on));
    stack().freeze(on, close);   // (the sheet's arrow/handle closes it too: src/stack.js freeze)
    // (opening, not placed yet: not shown, where it was, until it slides out from its place once the sheet stands)
    navEl.style.visibility = next === 'opening' && !placed ? 'hidden' : '';
    if (next === 'closed' || next === 'open') navEl.getAnimations().forEach(x => x.cancel());
  }
  function place() {
    const a = button.getBoundingClientRect(), s = sheetEl.getBoundingClientRect();
    const w = navEl.offsetWidth, h = navEl.offsetHeight;
    const right = isWide() ? s.right : a.right;
    navEl.style.left = `${Math.round(Math.max(10, Math.min(innerWidth - w - 10, right - w)))}px`;
    // (a computer at rest: under the whole box, its arrow band included)
    const under = isWide() && stack().level === 0 ? s.bottom : a.bottom, g = gap();
    if (under + g + h <= innerHeight - 10) { side = 'below'; navEl.style.top = `${Math.round(under + g)}px`; }
    else { side = 'above'; navEl.style.top = `${Math.round(Math.max(10, s.top - g - h))}px`; }
  }
  // (out from under the edge it hangs from: it moves its whole height plus the gap, cut where that edge is)
  function slide(out) {
    navEl.getAnimations().forEach(x => x.cancel());
    if (reduceMotion()) return Promise.resolve();
    const g = gap(), h = navEl.offsetHeight, d = h + g, below = side === 'below';
    const hid = below ? { transform: `translateY(${-d}px)`, clipPath: `inset(${h}px -24px -24px -24px)` }
      : { transform: `translateY(${d}px)`, clipPath: `inset(-24px -24px ${h}px -24px)` };
    const shown = below ? { transform: 'none', clipPath: `inset(${-g}px -24px -24px -24px)` }
      : { transform: 'none', clipPath: `inset(-24px -24px ${-g}px -24px)` };
    return navEl.animate(out ? [hid, shown] : [shown, hid], { duration: ms('fold'), easing: easing('ui'), fill: 'forwards' }).finished.catch(() => {});
  }

  // settle: wait for the sheet to stand before placing the card (it is moving, or about to)
  function open({ settle = false } = {}) {
    const st = stack();
    if (st.searching || state === 'opening' || state === 'open') return;
    // (opened with Home raised: Home goes down to rest first)
    const lower = st.top() === 'home' && st.level > 0;
    if (lower) st.setLevel(0);
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
    slide(false).then(() => { if (turn === mine) enter('closed'); });
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
    button.setAttribute('aria-expanded', 'true');
    stack().whenSettled().then(() => { if (turn !== mine || state !== 'parked') return; place(); enter('open'); });
  }

  onTap(button, toggle);   // (at once also right after a swipe: src/tap.js)
  // (a finger on the map leaves it open: a plain map tap closes it through the map's onMapTap; inside the sheet only ☰
  // does anything while it is open, src/stack.js frozen; elsewhere a press closes it)
  document.addEventListener('pointerdown', (e) => {
    if ((state === 'opening' || state === 'open') && !e.target.closest?.('#sheet, #nav') && !mapEl.contains(e.target)) close();
  }, true);
  const fromMenu = (key) => {
    if (state !== 'open') { close(); backHome = true; stack().open(key); return; }
    const mine = ++turn;
    enter('parked');
    backHome = true;
    stack().open(key);
    stack().whenSettled().then(() => { if (turn === mine && state === 'parked') navEl.hidden = true; });
  };
  document.getElementById('open-day').onclick = () => { close(); onDay(); };
  document.getElementById('open-settings').onclick = () => fromMenu('page:settings');
  document.getElementById('help-button').onclick = () => fromMenu('page:help');

  return {
    get isOpen() { return state === 'opening' || state === 'open'; },
    get shown() { return state !== 'closed' && state !== 'parked'; },
    open, close, toggle, reopenOnHome,
    // A page came on top: the menu is Home's, any other page shuts it (the status pill, the map); Home may reopen it.
    pageOnTop(key) { if (key === 'home') reopenOnHome(); else if (state !== 'parked') close(); },
  };
}
