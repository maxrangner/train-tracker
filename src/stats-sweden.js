// The stats page's small Sweden as a heatmap (Max, 2026-11-15: "a heatmap of train density instead", then the soft
// glow, "a proper color gradient … cold to hot", and "a toggle switching between density and lateness"; the sketch:
// docs/stats-1115/heat.src.html). Each train adds a soft spot (a Gaussian, sigma 3.8 px); the spots add up on a grid
// of one screen pixel, and the sum gives the colour:
//   trains:   cold to hot (src/colours.js HEAT), one train faint (~0.3), full at about 10 trains close together;
//   lateness: the app's lateness colours, green -> yellow -> red by the average of the trains there (those whose
//             lateness is known), brighter where more trains run.
// Worked out once a second, and only while the map can be seen (the page open, scrolled into view, the tab shown).
import OUTLINE from './sweden-outline.json';
import { HEAT, LATE } from './colours.js';
import { t } from './i18n.js';

const LON0 = 10.4, LON1 = 24.4, LAT0 = 55.0, LAT1 = 69.2, KX = Math.cos(62 * Math.PI / 180);
export const MAP_H = 290, MAP_W = Math.round(MAP_H * (LON1 - LON0) * KX / (LAT1 - LAT0));
const SIG = 3.8, R = 10, FULL = 10;
const SCORE = { ontime: 0, some: 0.5, late: 1 };   // lateness as 0..1 (not known: left out of the colour)
const KERNEL = [];
for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
  const w = Math.exp(-(dx * dx + dy * dy) / (2 * SIG * SIG));
  if (w > 0.01) KERNEL.push(dx, dy, w);
}
const rgb = c => { const v = parseInt(c.slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const ramp = (x, stops) => { const f = Math.min(0.999, Math.max(0, x)) * (stops.length - 1), i = Math.floor(f); return mix(stops[i], stops[i + 1], f - i); };
const dark = () => document.documentElement.dataset.theme === 'dark';
// The legend's gradient for the trains view, as CSS.
export const heatGradient = () => `linear-gradient(90deg, ${HEAT[dark() ? 'dark' : 'light'].join(', ')})`;

let mode = 'trains';   // 'trains' or 'lateness': kept while the app is open (not stored)
export const heatMode = () => mode;

export function createSwedenMap() {
  const box = document.createElement('div');
  box.className = 'st-se-map';
  const cv = document.createElement('canvas');
  cv.setAttribute('role', 'img');
  box.append(cv);
  const W = MAP_W, H = MAP_H, dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`;
  const ctx = cv.getContext('2d');
  const grid = document.createElement('canvas'); grid.width = W; grid.height = H;
  const gctx = grid.getContext('2d');
  const X = lon => (lon - LON0) / (LON1 - LON0) * W, Y = lat => (LAT1 - lat) / (LAT1 - LAT0) * H;
  const land = new Path2D();
  for (const r of OUTLINE) { for (let i = 0; i < r.length; i += 2) (i ? land.lineTo : land.moveTo).call(land, X(r[i]), Y(r[i + 1])); land.closePath(); }
  const dens = new Float32Array(W * H), lateSum = new Float32Array(W * H), lateW = new Float32Array(W * H);

  let snap = null, inView = true, dirty = true;
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; draw(); }).observe(cv);
  document.addEventListener('visibilitychange', () => draw());
  const visible = () => inView && !document.hidden && cv.isConnected && cv.offsetParent !== null;

  function draw() {
    if (!dirty || !snap || !visible()) return;
    dirty = false;
    const cs = getComputedStyle(document.documentElement), card = cs.getPropertyValue('--card').trim(), line = cs.getPropertyValue('--line').trim();
    dens.fill(0); lateSum.fill(0); lateW.fill(0);
    for (const d of snap.dots) {
      const px = Math.round(X(d.lon)), py = Math.round(Y(d.lat));
      if (px < -R || py < -R || px >= W + R || py >= H + R) continue;
      const sc = SCORE[d.late];
      for (let k = 0; k < KERNEL.length; k += 3) {
        const x = px + KERNEL[k], y = py + KERNEL[k + 1];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x, w = KERNEL[k + 2];
        dens[j] += w;
        if (sc !== undefined) { lateSum[j] += w * sc; lateW[j] += w; }
      }
    }
    const th = dark() ? 'dark' : 'light', hot = HEAT[th].map(rgb), L = LATE[th];
    const green = rgb(L.ontime), yellow = rgb(L.some), red = rgb(L.late);
    const img = gctx.createImageData(W, H), a = img.data;
    for (let j = 0; j < dens.length; j++) {
      const d = dens[j];
      if (d < 0.03) continue;
      const k = Math.min(1, d / FULL) ** 0.55;
      let c;
      if (mode === 'lateness') {
        const s = lateW[j] > 0.02 ? lateSum[j] / lateW[j] : 0;
        c = s < 0.5 ? mix(green, yellow, s * 2) : mix(yellow, red, (s - 0.5) * 2);
      } else c = ramp(k, hot);
      const o = j * 4;
      a[o] = c[0]; a[o + 1] = c[1]; a[o + 2] = c[2]; a[o + 3] = Math.round(255 * Math.min(1, 0.06 + k * 0.94));
    }
    gctx.putImageData(img, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = card; ctx.fill(land);
    ctx.save(); ctx.clip(land); ctx.imageSmoothingEnabled = true; ctx.drawImage(grid, 0, 0, W, H); ctx.restore();
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.stroke(land);
  }

  return {
    el: box,
    // Once a second while the page is open: the stats snapshot (src/stats.js).
    update(s) {
      snap = s;
      cv.setAttribute('aria-label', t(mode === 'lateness' ? 'stHeatAriaLate' : 'stHeatAria'));
      dirty = true;
      draw();
    },
    // The switch beside the map: 'trains' or 'lateness'.
    setMode(m) { mode = m; dirty = true; if (snap) this.update(snap); },
  };
}
