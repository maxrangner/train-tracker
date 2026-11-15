// How big a 3D train is drawn: its enlargement k, 1 = real size (Max, 2026-11-15). Kept apart from trains-3d.js
// so node can check it without a browser.
//
// Further out a model keeps its length on the screen, so zooming in it shrinks against the tracks:
//   compact: s.toySize pixels long; realistic: s.modelSize times real size at zoom 13, the same length after that.
// Once it is down to s.toyClose (compact) or s.realClose (realistic) times real size it stops shrinking and grows
// with the map like a real object.
// The change eases in and out over about one zoom step: a rounded corner, no sudden switch.
// s.trueSize: real size at every zoom; the three sizes above are not used then.
const EASE = 1;   // zoom steps over which the shrinking turns into staying the same size on the map

export function modelScale({ toy, zoom, metresPerPx, length, s }) {
  if (s.trueSize) return 1;
  // Sizes as powers of two: one zoom step in is one less.
  const close = toy ? s.toyClose : s.realClose;
  const b = Math.log2(close);
  if (!toy && s.modelSize <= close) return close;   // nothing to shrink before the close-in size
  const a = toy ? Math.log2(s.toySize * metresPerPx / length) : Math.log2(s.modelSize) + (13 - zoom);
  const d = a - b;
  if (d >= EASE / 2) return 2 ** a;
  if (d <= -EASE / 2) return 2 ** b;
  return 2 ** (b + (d + EASE / 2) ** 2 / (2 * EASE));
}
