// Small animations (Max, 2026-11-20: "The app feels a bit static and stiff now"; his picks on the example page
// https://claude.ai/artifact/QJRLpa8nQ1wpDvJnvaHiFe: numbers roll, rows arrive, the lateness flashes, map signs
// answer a tap). The looks are in src/css; here the parts that need code. Nothing here makes the map
// draw again: only page elements move, mostly by CSS (the graphics chip). None of it with "reduce motion".

import { lang } from './i18n.js';

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// The one source for how long and how a movement goes. The times and curves are on src/css/tokens.css's :root (--t-glide the
// sheet's glide, --t-fold a box opening or shutting and ☰'s card, --t-page a page change, --t-page-long the other page
// changes' (Debug → Page change); --ez the sheet's curve, --ez-pop the small motions', --ez-ui the menu's and the boxes');
// CSS uses them there, the code here.
// speed(): every page change and glide takes this many times as long (Debug → Animation speed → Calmer: 4/3; src/css/tokens.css
// --mk). Read from <html data-mspeed> (src/main.js markMotion writes it).
export const speed = () => (typeof document !== 'undefined' && document.documentElement.dataset.mspeed === 'calm' ? 4 / 3 : 1);
const tokens = new Map();
function token(prop) {
  let v = tokens.get(prop);
  if (!v) { v = getComputedStyle(document.documentElement).getPropertyValue(prop).trim(); if (v) tokens.set(prop, v); }
  return v;
}
// A time token in ms, at the chosen speed: ms('fold') is --t-fold.
export function ms(name) {
  const v = token(`--t-${name}`), n = parseFloat(v);
  return (v.endsWith('ms') ? n : n * 1000) * speed();
}
// A curve token: easing('ui') is --ez-ui; easing() the sheet's --ez.
export const easing = (name = '') => token(name ? `--ez-${name}` : '--ez');

// A box's height glides from `from` (px, measured before it changed) to its height now, so what is under it moves with
// it, not in one jump (a station's messages, a train's notes, Home's filter card; ui-sweep, 2026-11-25); to: its new
// height when measured already. Nothing with "reduce motion" or when the height is the same. Returns a promise of its end.
export function glideHeight(el, from, to = el?.offsetHeight) {
  if (!el || !from || !to || from === to || reduceMotion()) return Promise.resolve();
  el.style.overflow = 'hidden';
  return el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: ms('fold'), easing: easing('ui') })
    .finished.catch(() => {}).then(() => { el.style.overflow = ''; });
}

// A number that rolls from its last value to the new one (0.7 s, easing out; first in Statistik, src/stats-page.js).
// The first value is shown at once; so is any value while the page is hidden or with "reduce motion".
// fmt(n, end): the text for n (end: the last step, e.g. "I tid" where the steps say "0 min"); the default: the
// number as stats-page.js writes it (digits, suffix).
export function roll(el, v, digits = 0, suffix = '', fmt = null) {
  const text = fmt ?? ((n) => Number(n).toLocaleString(lang() === 'sv' ? 'sv-SE' : 'en-GB',
    { maximumFractionDigits: digits, minimumFractionDigits: digits }) + suffix);
  const from = el._v ?? v;
  el._v = v;
  cancelAnimationFrame(el._raf);
  if (reduceMotion() || from === v || document.hidden) { el.textContent = text(v, true); return; }
  el.textContent = text(from, false);   // (at once: the new text drawn in its place would show for a frame)
  const t0 = performance.now(), dur = 700;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
    el.textContent = k === 1 ? text(v, true) : text(digits ? from + (v - from) * e : Math.round(from + (v - from) * e), false);
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
// Forget a number's last value (a screen opening shows its numbers at once; only a change after that rolls).
export function forgetRoll(el) { if (!el) return; cancelAnimationFrame(el._raf); el._v = undefined; }

// Rows that weren't in this list before come in one after another (src/css/base.css .arrive): 25 ms apart, at most 9
// steps, so a long list doesn't wait. seen: the keys already shown (a Set, kept by the list's owner and emptied when
// the list starts again); key(row): what makes a row the same row (default: its text).
// Only the first 16 new rows move (a screenful; the rest just show): 105 search rows, each animated, cost about 120 ms
// more at 4x slower (measured 2026-11-20). The page is laid out again only for a row still arriving (to restart it).
const ARRIVE_MAX = 16;
export function arrive(rows, seen, key = r => r.textContent.trim()) {
  let i = 0;
  const still = reduceMotion() || document.hidden;
  for (const r of rows) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    // (rows of a page sliding in come with it, not after it: one motion; Max, 2026-11-24 "It's sliding and fading at the
    // same time, and card jumps". Rows that come in later still arrive.)
    if (still || i >= ARRIVE_MAX || r.closest?.('.pg.in-r, .pg.in-l')) continue;
    r.style.setProperty('--i', Math.min(i++, 9));
    if (r.classList.contains('arrive')) { r.classList.remove('arrive'); void r.offsetWidth; }
    r.classList.add('arrive');
    r.addEventListener('animationend', () => { r.classList.remove('arrive'); r.style.removeProperty('--i'); }, { once: true });
  }
}

// A one-off animation (a CSS class) from its start again.
export function flash(el, cls = 'flash') {
  if (!el || reduceMotion()) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  // (the class goes when all its animations are done, its ::after's too: the lateness ring outlasts the pulse)
  const done = () => {
    if (el.getAnimations({ subtree: true }).some(a => a.playState === 'running')) return;
    el.classList.remove(cls);
    el.removeEventListener('animationend', done);
  };
  el.addEventListener('animationend', done);
}
