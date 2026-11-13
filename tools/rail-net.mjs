// Build the rail network the page uses (public/rail-net.json) from Trafikverket's rail lines (public/rail-trv.geojson,
// from tools/rail-trv.mjs): small enough for a phone, connected so trains can follow the tracks (src/rail-net.js).
// - A line end that touches another line mid-way (within JOIN_M) is joined to it: that line is split there.
// - Each line is simplified, keeping every point within SIMPLIFY_M of the original.
// - Saved as whole numbers (1e-5 degrees, about 1 m), each the difference from the point before, plus each line's
//   number of points. Line ends meet on exactly equal numbers; src/rail-net.js finds them again on loading.
// - Pieces under 5 m are taken out and their ends joined (joinTinyPieces in src/rail-net.js; it was done by the page
//   at every start).
// Run: node tools/rail-net.mjs
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { joinTinyPieces } from '../src/rail-net.js';

const JOIN_M = 2;
const SIMPLIFY_M = 0.5;
const src = new URL('../public/rail-trv.geojson', import.meta.url);
const out = new URL('../public/rail-net.json', import.meta.url);

const R = Math.PI / 180;
const lines = JSON.parse(readFileSync(src, 'utf8')).features
  .map(f => f.geometry.coordinates.map(([lon, lat]) => [Math.round(lon * 1e5), Math.round(lat * 1e5)]));
const key = p => `${p[0]},${p[1]}`;
// Flat metres around a latitude, for distances (fine over a few hundred metres).
const kx = lat => Math.cos(lat / 1e5 * R) * 1.11195;   // metres per 1e-5 degree of longitude
const KY = 1.11195;                                       // metres per 1e-5 degree of latitude

// ---- 1. Join line ends that touch another line mid-way ----
const ends = new Map();
for (const c of lines) for (const e of [c[0], c[c.length - 1]]) ends.set(key(e), (ends.get(key(e)) ?? 0) + 1);
const CELL = 500;   // grid cells of 500 x 500 (1e-5 degrees, ~300 x 550 m)
const grid = new Map();
const cellKey = (x, y) => `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;
lines.forEach((c, li) => {
  for (let i = 0; i + 1 < c.length; i++) {
    const [a, b] = [c[i], c[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL / 2)));
    const seen = new Set();
    for (let k = 0; k <= n; k++) {
      const ck = cellKey(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n);
      if (seen.has(ck)) continue;
      seen.add(ck);
      (grid.get(ck) ?? grid.set(ck, []).get(ck)).push([li, i]);
    }
  }
});
const splits = new Map();   // line -> [{ i, t, p }] points to split at
let joined = 0;
for (const c of lines) for (const e of [c[0], c[c.length - 1]]) {
  if (ends.get(key(e)) !== 1) continue;
  let best = null;
  const cx = Math.floor(e[0] / CELL), cy = Math.floor(e[1] / CELL), k = kx(e[1]);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const [li, i] of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
      const d = lines[li], a = d[i], b = d[i + 1];
      if (key(a) === key(e) || key(b) === key(e)) continue;
      const ax = (a[0] - e[0]) * k, ay = (a[1] - e[1]) * KY, bx = (b[0] - e[0]) * k, by = (b[1] - e[1]) * KY;
      const vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy;
      const t = L ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L)) : 0;
      const dist = Math.hypot(ax + vx * t, ay + vy * t);
      if (!best || dist < best.dist) best = { dist, li, i, t, a, b };
    }
  }
  if (!best || best.dist > JOIN_M) continue;
  // The joining point: the nearest point of the other line (an existing point when it is one).
  const p = best.t < 0.01 ? best.a : best.t > 0.99 ? best.b
    : [Math.round(best.a[0] + (best.b[0] - best.a[0]) * best.t), Math.round(best.a[1] + (best.b[1] - best.a[1]) * best.t)];
  e[0] = p[0]; e[1] = p[1];   // move the loose end onto it
  (splits.get(best.li) ?? splits.set(best.li, []).get(best.li)).push({ i: best.i, t: best.t, p });
  joined++;
}
// Split the lines that were joined to (several splits on one line handled in order along it).
const split = [];
lines.forEach((c, li) => {
  const at = splits.get(li);
  if (!at) return split.push(c);
  at.sort((x, y) => x.i - y.i || x.t - y.t);
  let cur = [c[0]], j = 0;
  for (let i = 0; i + 1 < c.length; i++) {
    for (; j < at.length && at[j].i === i; j++) {
      const p = at[j].p;
      if (key(p) !== key(cur[cur.length - 1])) cur.push(p);
      if (cur.length >= 2) split.push(cur);
      cur = [p];
    }
    if (key(c[i + 1]) !== key(cur[cur.length - 1])) cur.push(c[i + 1]);
  }
  if (cur.length >= 2) split.push(cur);
});

// ---- 2. Simplify (Douglas-Peucker), keeping the ends ----
function simplify(c) {
  if (c.length <= 2) return c;
  const k = kx(c[0][1]);
  const keep = new Uint8Array(c.length);
  keep[0] = keep[c.length - 1] = 1;
  const stack = [[0, c.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const ax = c[s][0] * k, ay = c[s][1] * KY, vx = c[e][0] * k - ax, vy = c[e][1] * KY - ay, L = Math.hypot(vx, vy);
    let far = -1, farD = SIMPLIFY_M;
    for (let i = s + 1; i < e; i++) {
      const px = c[i][0] * k - ax, py = c[i][1] * KY - ay;
      const d = L ? Math.abs(px * vy - py * vx) / L : Math.hypot(px, py);
      if (d > farD) { farD = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([s, far], [far, e]); }
  }
  return c.filter((_, i) => keep[i]);
}
const simple = split.map(simplify).filter(c => c.length >= 2 && !(c.length === 2 && key(c[0]) === key(c[1])));

// ---- 3. Save ----
const n = [], d = [];
let px = 0, py = 0;
for (const c of simple) {
  n.push(c.length);
  for (const [x, y] of c) { d.push(x - px, y - py); px = x; py = y; }
}
// Tiny pieces (under 5 m) are taken out and their ends joined here, with the page's own code (src/rail-net.js), so
// the page loads a network that is ready (`joined`).
const ready = joinTinyPieces({ scale: 1e5, n, d });
const json = JSON.stringify({ about: 'Trafikverket rail lines (CC0), see tools/rail-net.mjs', scale: 1e5, joined: true, n: ready.n, d: ready.d });
writeFileSync(out, json);

const before = statSync(src).size;
const pts = simple.reduce((a, c) => a + c.length, 0), ptsBefore = lines.reduce((a, c) => a + c.length, 0);
const mb = b => `${(b / 1e6).toFixed(2)} MB`;
console.log(`lines ${lines.length} -> ${simple.length} (joined ${joined} loose ends to other lines); points ${ptsBefore} -> ${pts}`);
console.log(`size: ${mb(before)} (gzipped ${mb(gzipSync(readFileSync(src)).length)}) -> ${mb(json.length)} (gzipped ${mb(gzipSync(json).length)})`);
