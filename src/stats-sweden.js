// The stats page's small Sweden (Max, 2026-11-15, sketch D: "exactly as your demo"): every train a dot in its
// lateness colour, a ripple when its new position arrives, the trains furthest north and south joined by a dashed
// line. A tap picks the closest dot within 16 px and shows a label; a tap on the label opens that train.
// Drawn on a canvas, and only while it can be seen (the page open, the map scrolled into view, the tab shown), at
// most 30 times a second; with nothing rippling, only when the numbers change (once a second).
import OUTLINE from './sweden-outline.json';
import { t } from './i18n.js';
import { tagHtml } from './tag.js';

const LON0 = 10.4, LON1 = 24.4, LAT0 = 55.0, LAT1 = 69.2, KX = Math.cos(62 * Math.PI / 180);
const H = 290, W = Math.round(H * (LON1 - LON0) * KX / (LAT1 - LAT0));
const RIPPLE_MS = 1200, FRAME_MS = 33, PICK_PX = 16;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// describe(id): { number, brand, minutes } of a train; open(id): open it on the map.
export function createSwedenMap({ describe, open }) {
  const box = document.createElement('div');
  box.className = 'st-se-map';
  const cv = document.createElement('canvas');
  cv.setAttribute('role', 'img');
  box.append(cv);
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`;
  const ctx = cv.getContext('2d');
  const X = lon => (lon - LON0) / (LON1 - LON0) * W, Y = lat => (LAT1 - lat) / (LAT1 - LAT0) * H;
  const land = new Path2D();
  for (const r of OUTLINE) { for (let i = 0; i < r.length; i += 2) (i ? land.lineTo : land.moveTo).call(land, X(r[i]), Y(r[i + 1])); land.closePath(); }

  let snap = null, pos = new Map(), ripples = [], picked = null, pickEl = null, colours = null;
  let inView = true, raf = 0, last = 0, dirty = true;
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; if (inView) wake(); }).observe(cv);
  document.addEventListener('visibilitychange', () => wake());

  const visible = () => inView && !document.hidden && cv.isConnected && cv.offsetParent !== null;
  function wake() { if (!raf && visible()) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (!visible()) return;
    ripples = ripples.filter(r => now - r.t < RIPPLE_MS);
    if (dirty || ripples.length) {
      if (now - last >= FRAME_MS) { draw(now); last = now; dirty = false; }
      raf = requestAnimationFrame(frame);
    }
  }
  function draw(now) {
    const C = colours;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C.card; ctx.fill(land);
    ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke(land);
    if (!snap) return;
    const pn = snap.north && pos.get(snap.north.id), ps = snap.south && pos.get(snap.south.id);
    if (pn && ps) {
      ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pn.x, pn.y); ctx.lineTo(ps.x, ps.y); ctx.stroke(); ctx.restore();
    }
    for (const p of pos.values()) {
      ctx.globalAlpha = p.stale ? 0.4 : 1;
      ctx.fillStyle = C[p.late];
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.3, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const r of ripples) {
      const p = pos.get(r.id); if (!p) continue;
      const k = (now - r.t) / RIPPLE_MS;
      ctx.globalAlpha = (1 - k) * 0.8; ctx.strokeStyle = C[p.late]; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5 + k * 9, 0, 7); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const p of [pn, ps]) if (p) {
      ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.fill();
      ctx.strokeStyle = C.card; ctx.lineWidth = 1.5; ctx.stroke();
    }
    const pp = picked && pos.get(picked);
    if (pp) { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pp.x, pp.y, 6, 0, 7); ctx.stroke(); }
  }
  function unpick() { pickEl?.remove(); pickEl = null; picked = null; dirty = true; wake(); }
  function placePick() {
    const p = picked && pos.get(picked);
    if (!p) { if (picked) unpick(); return; }
    // inside the box: the label's middle kept 8 px from its sides
    const half = (pickEl.offsetWidth || 80) / 2;
    pickEl.style.left = `${Math.max(half - 8, Math.min(W + 16 - half + 8, p.x + 8))}px`;
    pickEl.style.top = `${p.y + 8}px`;
  }
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = PICK_PX * PICK_PX;
    for (const [id, p] of pos) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = id; } }
    unpick();
    if (!best) return;
    const info = describe(best);
    if (!info) return;
    picked = best;
    pickEl = document.createElement('button');
    pickEl.type = 'button';
    pickEl.className = 'st-pick';
    pickEl.innerHTML = `<b>${esc(info.number)}</b> ${info.minutes === null || info.minutes === undefined
      ? `<span class="tag unknown">${esc(t('stKeyUnknown'))}</span>` : tagHtml(info.minutes)}<small>${esc(info.brand || t('stNoCompany'))} ›</small>`;
    pickEl.onclick = (ev) => { ev.stopPropagation(); const id = picked; unpick(); open(id); };
    box.append(pickEl);
    placePick();
    dirty = true; wake();
  });

  return {
    el: box,
    // Once a second while the page is open: the stats snapshot (src/stats.js).
    update(s) {
      snap = s;
      cv.setAttribute('aria-label', t('stMapAria'));
      const cs = getComputedStyle(document.documentElement), g = k => cs.getPropertyValue(k).trim();
      colours = { card: g('--card'), line: g('--line'), ink: g('--ink'), accent: g('--accent'),
        ontime: g('--c-ontime'), some: g('--c-some'), late: g('--c-late'), unknown: g('--c-unknown') };
      pos = new Map();
      for (const d of s.dots) if (d.lon >= LON0 - 1 && d.lon <= LON1 + 1) pos.set(d.id, { x: X(d.lon), y: Y(d.lat), late: d.late, stale: d.stale });
      if (!reduce()) { const now = performance.now(); for (const id of s.arrived) if (pos.has(id)) ripples.push({ id, t: now }); }
      if (pickEl) placePick();
      dirty = true;
      wake();
    },
  };
}
