// What several parts of the page ask about where they run, answered in one place: a computer or a phone (440 px wide
// and up is a computer: the sheet floats at the left, index.html's @media (min-width: 440px) rules), the app or a
// browser, the phone's keyboard up, and the sheet's sizes (index.html :root --grab-h ...; src/stack.js, src/map.js and
// src/main.js read them here rather than keeping copies).

// ---------- a computer or a phone ----------
// (CSS can't share a number in a media query: index.html's own @media rules say 440 px too)
export const WIDE = typeof matchMedia === 'function' ? matchMedia('(min-width: 440px)') : null;
export const isWide = () => Boolean(WIDE?.matches);
// fn() when the screen crosses 440 px (a resized window, a turned tablet)
export const onWideChange = (fn) => { WIDE?.addEventListener('change', fn); };

// ---------- the app ----------
// Inside the Android or iPhone app (Capacitor's bridge is there; the web page never has it).
export const isNative = () => Boolean(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.());

// ---------- the phone's keyboard ----------
// Up: a text field has focus and the page is clearly lower than the tallest seen at this width (the viewport line's
// interactive-widget=resizes-content: the keyboard shrinks the page). (src/main.js's map height keeps its own count: it
// also covers the keyboard on its way down.)
let tallest = { w: 0, h: 0 };
const seen = () => { if (innerWidth !== tallest.w) tallest = { w: innerWidth, h: 0 }; tallest.h = Math.max(tallest.h, innerHeight); };
if (typeof window !== 'undefined') { seen(); addEventListener('resize', seen); }
export const keyboardUp = () => Boolean(document.activeElement?.matches?.('input, textarea')) && innerHeight < tallest.h - 150;

// ---------- the sheet's sizes ----------
// From index.html's :root (px): grab (the handle's row on a phone; a computer's band is grabWide), head (the search bar's
// or a page's bar's row), barGap (under the bar when the page shows), barEdge (the search bar from the sheet's edge at
// rest), inset (a computer's sheet from the screen's edges), fitGap and fitGapPhone (room under the last part shown),
// topRoom (full height leaves this at the top: the live mark), width (a computer's sheet).
// Read once and kept (they don't change with the screen); again with fresh (src/stack.js measure).
const GEO = { grab: '--grab-h', grabWide: '--grab-h-wide', head: '--head-h', barGap: '--bar-gap', barEdge: '--bar-edge', inset: '--sheet-inset',
  fitGap: '--fit-gap', fitGapPhone: '--fit-gap-phone', topRoom: '--top-room', width: '--sheet-w' };
let geo = null;
export function sheetGeometry(fresh = false) {
  if (geo && !fresh) return geo;
  const cs = getComputedStyle(document.documentElement);
  const g = {};
  for (const [k, v] of Object.entries(GEO)) g[k] = parseFloat(cs.getPropertyValue(v));
  geo = g;
  return geo;
}
