// A thin scrollbar drawn by the page, on a computer with a mouse (Max, 2026-11-15, the stats page in Firefox: the
// browser's bar clipped into text and graphics, and on hover got a dark background and grew wider). Ours: a grey
// slider you can drag, always the same thickness, no background, small arrows while the mouse is over the sheet, and
// placed in the sheet's own margin so it never covers what is shown. Phones keep their own (they show it only while
// scrolling). A browser only lets a page change its own scrollbar's colour and thin/normal (Firefox), so this is drawn.
import './scrollbar.css';
import { reduceMotion } from './motion.js';

const ARROW = 12, MIN_THUMB = 28, STEP = 60, REPEAT_MS = 70, HOLD_MS = 320;
const mouse = matchMedia('(hover: hover) and (pointer: fine)');
const smooth = () => (reduceMotion() ? 'auto' : 'smooth');
const arrow = d => `<svg width="8" height="6" viewBox="0 0 8 6" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`;

// scroller: the element that scrolls; its offset parent (a positioned sheet) holds the bar.
// { host }: one bar in host for whichever element scrolls there now (the sheet's pages: the top page or the search's
// results); bar.follow(el) moves it on (Max, 2026-11-25: "Grabbing the scrollbar shows a black background under it ...
// Also changes width. This was fixed once before. Why back?": since the one sheet the pages themselves scroll, and they
// had the browser's bar). It shows only while its element really scrolls (a page in the sheet scrolls at full only).
// Returns { follow } (nothing to follow on a phone).
export function addScrollbar(scroller, { host = null } = {}) {
  if (!mouse.matches) return { follow() {} };
  const own = host ? 'sb-page' : 'sb-own';   // (a page keeps its padding: index.html .pg; only the browser's bar goes)
  const bar = document.createElement('div');
  bar.className = 'sb';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML = `<button type="button" class="sb-arrow sb-up" tabindex="-1">${arrow('M4 0 8 6H0z')}</button>` +
    `<div class="sb-track"><div class="sb-thumb"></div></div>` +
    `<button type="button" class="sb-arrow sb-down" tabindex="-1">${arrow('M0 0h8L4 6z')}</button>`;
  if (host) host.append(bar); else scroller.after(bar);
  const track = bar.querySelector('.sb-track'), thumb = bar.querySelector('.sb-thumb');

  let queued = false;
  const geometry = () => {
    const room = scroller.clientHeight - 2 * ARROW, range = scroller.scrollHeight - scroller.clientHeight;
    const h = Math.max(MIN_THUMB, room * scroller.clientHeight / Math.max(1, scroller.scrollHeight));
    return { room, range, h };
  };
  const scrolls = () => { const o = getComputedStyle(scroller).overflowY; return o === 'auto' || o === 'scroll'; };
  function place() {
    queued = false;
    if (!scroller?.isConnected) { bar.hidden = true; return; }
    const { room, range, h } = geometry();
    // (a page still sliding in or out: none until it stands, the bar doesn't slide with it; ui-sweep, 2026-11-25)
    // (nor while the sheet glides to another height: About growing to full showed it for 17 frames, then it fit)
    bar.hidden = range <= 1 || room <= MIN_THUMB || (host && (!scrolls() || gliding.size > 0 || /(^| )(in|out)-[lr]( |$)/.test(scroller.className)));
    if (bar.hidden) return;
    bar.style.top = `${scroller.offsetTop}px`;
    bar.style.height = `${scroller.clientHeight}px`;
    thumb.style.height = `${h}px`;
    thumb.style.transform = `translateY(${(room - h) * scroller.scrollTop / range}px)`;
  }
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };
  const ro = new ResizeObserver(later);
  const mo = new MutationObserver(later);   // the content grew or shrank
  const co = new MutationObserver(later);   // (its own class: a page's slide ending)
  function bind(el) {
    if (scroller) { scroller.removeEventListener('scroll', later); ro.unobserve(scroller); mo.disconnect(); co.disconnect(); scroller.classList.remove(own); }
    scroller = el;
    if (!el) { bar.hidden = true; return; }
    el.classList.add(own);
    el.addEventListener('scroll', later, { passive: true });
    ro.observe(el);
    mo.observe(el, { childList: true, subtree: true });
    if (host) co.observe(el, { attributes: true, attributeFilter: ['class'] });
    later();
  }
  const first = scroller;
  scroller = null;
  bind(first);
  // (a page in the sheet scrolls only at full: the sheet's height step or the search changing says when)
  if (host) new MutationObserver(later).observe(host.closest('#sheet') ?? host, { attributes: true, attributeFilter: ['data-h', 'data-search'] });
  // (the sheet's own glides running: its height or its slide)
  const gliding = new Set(), sheetEl = host?.closest('#sheet');
  if (sheetEl) {
    sheetEl.addEventListener('transitionrun', (e) => { if (e.target === sheetEl) { gliding.add(e.propertyName); later(); } });
    for (const ev of ['transitionend', 'transitioncancel']) sheetEl.addEventListener(ev, (e) => { if (e.target === sheetEl) { gliding.delete(e.propertyName); later(); } });
  }

  // Drag the slider.
  thumb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    thumb.setPointerCapture(e.pointerId);
    thumb.classList.add('sb-drag');
    const y0 = e.clientY, top0 = scroller.scrollTop, { room, range, h } = geometry();
    const move = (ev) => { scroller.scrollTop = top0 + (ev.clientY - y0) * range / Math.max(1, room - h); };
    const up = () => { thumb.classList.remove('sb-drag'); thumb.removeEventListener('pointermove', move); thumb.removeEventListener('pointerup', up); thumb.removeEventListener('pointercancel', up); };
    thumb.addEventListener('pointermove', move);
    thumb.addEventListener('pointerup', up);
    thumb.addEventListener('pointercancel', up);
  });
  // A click on the track above or below the slider: a page up or down.
  track.addEventListener('pointerdown', (e) => {
    if (e.target === thumb) return;
    const below = e.clientY > thumb.getBoundingClientRect().top;
    scroller.scrollBy({ top: (below ? 1 : -1) * scroller.clientHeight * 0.9, behavior: smooth() });
  });
  // The arrows: a step, and held, steps again and again.
  for (const [b, dir] of [[bar.querySelector('.sb-up'), -1], [bar.querySelector('.sb-down'), 1]]) {
    let wait = 0, every = 0;
    const stop = () => { clearTimeout(wait); clearInterval(every); };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      scroller.scrollBy({ top: dir * STEP, behavior: smooth() });
      wait = setTimeout(() => { every = setInterval(() => scroller.scrollBy({ top: dir * STEP / 2 }), REPEAT_MS); }, HOLD_MS);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
  }
  later();
  return { follow: bind };
}
