// Build the rail network the page uses (public/rail-net.json) from Trafikverket's rail lines (data/rail-trv.geojson,
// from tools/rail-trv.mjs): small enough for a phone, connected so trains can follow the tracks (src/rail-net.js).
// - A line end that touches another line mid-way (within JOIN_M) is joined to it: that line is split there.
// - Each line is simplified, keeping every point within SIMPLIFY_M of the original.
// - Saved as whole numbers (1e-5 degrees, about 1 m), each the difference from the point before, plus each line's
//   number of points. Line ends meet on exactly equal numbers; src/rail-net.js finds them again on loading.
// - Pieces under 5 m are taken out and their ends joined (joinTinyPieces in src/rail-net.js; it was done by the page
//   at every start).
// - Overlap pieces are taken out: a line of up to OVERLAP_M with, at both its ends, a meeting point of exactly two
//   lines that turn back on each other (over 120°). Two lines overlap there and the bit between them points backwards,
//   so no train "can" pass (Rörstorp 22.5 m, Olskroken 5.8 m, Haga 5.2 m: the only 3 in Sweden; 43 route pieces were
//   drawn straight because of them; night of 2026-11-14, docs: night-1114/paths.md). The neighbour whose end piece is
//   shorter has its end moved across, so the two neighbours meet; kept only where they then meet at 30° or less.
// - Each line gets one digit (`c`, a string, one per line) from its link's properties (data/rail-trv-props.json, from
//   tools/rail-trv.mjs): 3 for a slow (40 km/h or less) or not public track, else 0; plus its traffic direction (0 both
//   ways, 1 along the line's points, 2 against them). src/rail-net.js makes routes prefer main tracks and the right
//   track of a double track with it. Without the properties file the network is written without `c`.
//   Where the data's one-way directions are known not to hold (TWO_WAY: GPS reports at 20 km/h or more on one-way
//   tracks run against the data's direction at Barkarby 77-94 % and Jakobsberg 29-34 % in seven recordings, Sweden
//   3.5-4.8 %; Mälarbanan was rebuilt to four tracks there; docs/movement-findings-1121.md N6), the tracks within
//   TWO_WAY_M of the station's point are marked both ways: the train's own GPS then decides which track it is on.
// - Each line also gets its link's design speed in km/h (`v`, a list, one per line; 0 not known; Max, 2026-11-20: the
//   train card's speedometer marks what the track is built for, docs/train-info-1120). About +15 kB as sent.
// - Straight corners get a curve beside them: a straight two-point line of at least CORNER_MIN_M on a normal track
//   whose every way on, at both ends, turns more than the trains' MAX_TURN (but not over SHARP_TURN, src/path.js).
//   Trafikverket draws the horseshoe north of Borås C (Kust till kust-banan, about 1.3 km) as one straight 845 m link
//   (SE454618e6-…): it meets the tracks at 62° and ~113°, so no train could leave Borås C westwards and Borås C →
//   Göteborg C was drawn 122 km via Herrljunga instead of 71 km (2026-11-16, docs/split-1116/a11-report.md). The
//   straight line stays (some reports sit on it); a smooth curve (a cubic Bézier, leaving each end along the
//   straightest neighbour) is added between its ends with its digit. Only that one in Sweden today; each is printed.
// Run: node tools/rail-net.mjs
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { joinTinyPieces } from '../src/rail-net.js';

const JOIN_M = 2;
const OVERLAP_M = 60;
const SIMPLIFY_M = 0.5;
const CORNER_MIN_M = 300;
const MAX_TURN = 60, SHARP_TURN = 120;   // as src/rail-net.js MAX_TURN and src/path.js SHARP_TURN
// Stations whose one-way tracks are marked both ways (see the top): [name, lon, lat] (data/stations.json's points).
const TWO_WAY = [['Barkarby', 17.863678, 59.405446], ['Jakobsberg', 17.833120, 59.423806]], TWO_WAY_M = 1500;
const CORNER_ARM = 0.65;                 // the curve's control arms, as a share of the straight line's length
const src = new URL('../data/rail-trv.geojson', import.meta.url);
const out = new URL('../public/rail-net.json', import.meta.url);

const R = Math.PI / 180;
const feats = JSON.parse(readFileSync(src, 'utf8')).features;
const lines = feats.map(f => f.geometry.coordinates.map(([lon, lat]) => [Math.round(lon * 1e5), Math.round(lat * 1e5)]));
const linkOf = feats.map(f => String(f.properties.id).replace(/^SE/, '').toLowerCase());   // each line's link (carried below)
const propsFile = new URL('../data/rail-trv-props.json', import.meta.url);
const props = existsSync(propsFile) ? JSON.parse(readFileSync(propsFile, 'utf8')).links : null;
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
const split = [], splitLink = [];
const put = (c, li) => { split.push(c); splitLink.push(linkOf[li]); };
lines.forEach((c, li) => {
  const at = splits.get(li);
  if (!at) return put(c, li);
  at.sort((x, y) => x.i - y.i || x.t - y.t);
  let cur = [c[0]], j = 0;
  for (let i = 0; i + 1 < c.length; i++) {
    for (; j < at.length && at[j].i === i; j++) {
      const p = at[j].p;
      if (key(p) !== key(cur[cur.length - 1])) cur.push(p);
      if (cur.length >= 2) put(cur, li);
      cur = [p];
    }
    if (key(c[i + 1]) !== key(cur[cur.length - 1])) cur.push(c[i + 1]);
  }
  if (cur.length >= 2) put(cur, li);
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
const simple = [], simpleLink = [];
split.forEach((c, i) => {
  const s = simplify(c);
  if (s.length >= 2 && !(s.length === 2 && key(s[0]) === key(s[1]))) { simple.push(s); simpleLink.push(splitLink[i]); }
});

// ---- 3. Save ----
const n = [], d = [];
let px = 0, py = 0;
for (const c of simple) {
  n.push(c.length);
  for (const [x, y] of c) { d.push(x - px, y - py); px = x; py = y; }
}
// Tiny pieces (under 5 m) are taken out and their ends joined here, with the page's own code (src/rail-net.js), so
// the page loads a network that is ready (`joined`).
const joinedTiny = joinTinyPieces({ scale: 1e5, n, d });
const ready = removeOverlaps(joinedTiny);
// Each remaining line's digit (see the top): slow or not public 3, plus the direction.
let c, speeds = null;
if (props) {
  const linkAt = ready.kept.map(i => simpleLink[joinedTiny.kept[i]]);
  c = linkAt.map((id) => {
    const [v, a, f] = props[id] ?? [0, 3, 0];
    return ((v > 0 && v <= 40) || a !== 0 ? 3 : 0) + f;
  }).join('');
  speeds = linkAt.map(id => (props[id] ?? [0])[0] || 0);
  const slow = [...c].filter(x => x >= '3').length, oneWay = [...c].filter(x => x % 3 !== 0).length;
  console.log(`track properties: ${slow} of ${c.length} lines slow or not public, ${oneWay} one-way`);
} else console.log('no data/rail-trv-props.json (node tools/rail-trv.mjs --props): the network has no track properties');
if (c) c = twoWay(ready, c);
const curved = addCornerCurves(ready, c, speeds);
c = curved.c;
const json = JSON.stringify({ about: 'Trafikverket rail lines (CC0), see tools/rail-net.mjs', scale: 1e5, joined: true, n: curved.n, d: curved.d,
  ...(c ? { c } : {}), ...(speeds ? { v: speeds } : {}) });
writeFileSync(out, json);

// ---- 4. Overlap pieces (see the top) ----
function removeOverlaps({ n: nn, d: dd }) {
  const ls = [];
  let x = 0, y = 0, k = 0;
  for (const cnt of nn) { const pts = []; for (let i = 0; i < cnt; i++) { x += dd[2 * k]; y += dd[2 * k + 1]; k++; pts.push([x, y]); } ls.push(pts); }
  const mXY = (a, b) => Math.hypot((b[0] - a[0]) * kx(a[1]), (b[1] - a[1]) * KY);
  const lineLen = l => { let t = 0; for (let i = 1; i < l.length; i++) t += mXY(l[i - 1], l[i]); return t; };
  const headXY = (a, b) => (Math.atan2((b[0] - a[0]) * Math.cos(a[1] / 1e5 * R), b[1] - a[1]) / R + 360) % 360;
  const angle = (a, b) => { const v = Math.abs(a - b) % 360; return v > 180 ? 360 - v : v; };
  const at = new Map();   // meeting point -> [[line, 0 start / 1 end]]
  ls.forEach((l, li) => { for (const e of [0, 1]) { const kk = key(e ? l.at(-1) : l[0]); (at.get(kk) ?? at.set(kk, []).get(kk)).push([li, e]); } });
  const leave = (li, e) => (e ? headXY(ls[li].at(-1), ls[li].at(-2)) : headXY(ls[li][0], ls[li][1]));
  const turn = (a, b) => angle((leave(...a) + 180) % 360, leave(...b));
  const kink = new Set();
  for (const [kk, es] of at) if (es.length === 2 && es[0][0] !== es[1][0] && turn(es[0], es[1]) > 120) kink.add(kk);
  let removed = 0;
  ls.forEach((l, li) => {
    const ka = key(l[0]), kb = key(l.at(-1));
    if (!kink.has(ka) || !kink.has(kb) || ka === kb) return;
    const len = lineLen(l);
    if (len > OVERLAP_M) return;
    const a = at.get(ka).find(([lj]) => lj !== li), b = at.get(kb).find(([lj]) => lj !== li);
    if (!a || !b || !ls[a[0]] || !ls[b[0]] || a[0] === b[0]) return;
    const endSeg = ([lj, e]) => { const L = ls[lj]; return e ? mXY(L.at(-1), L.at(-2)) : mXY(L[0], L[1]); };
    const moveA = endSeg(a) < endSeg(b) && endSeg(a) > len;
    const mv = moveA ? a : b, stay = moveA ? b : a;
    const B = ls[mv[0]], saved = [...(mv[1] ? B.at(-1) : B[0])];
    const target = moveA ? [...l.at(-1)] : [...l[0]];
    if (mv[1]) B[B.length - 1] = target; else B[0] = target;
    if (turn(stay, mv) > 30 || lineLen(B) < 1) { if (mv[1]) B[B.length - 1] = saved; else B[0] = saved; return; }
    console.log(`overlap piece of ${len.toFixed(1)} m taken out at ${(l[0][1] / 1e5).toFixed(5)},${(l[0][0] / 1e5).toFixed(5)}`);
    ls[li] = null;
    removed++;
  });
  const n2 = [], d2 = [], kept = [];
  let px = 0, py = 0;
  ls.forEach((l, i) => { if (!l) return; kept.push(i); n2.push(l.length); for (const [qx, qy] of l) { d2.push(qx - px, qy - py); px = qx; py = qy; } });
  console.log(`overlap pieces taken out: ${removed}`);
  return { n: n2, d: d2, kept };
}

// ---- 5. Straight corners (see the top) ----
// The digits with the one-way tracks near TWO_WAY marked both ways (a line counts when any of its points is near).
function twoWay({ n: nn, d: dd }, digits) {
  const out = [...digits];
  let x = 0, y = 0, k = 0, changed = 0;
  nn.forEach((cnt, li) => {
    let near = false;
    for (let i = 0; i < cnt; i++) {
      x += dd[2 * k]; y += dd[2 * k + 1]; k++;
      if (!near) near = TWO_WAY.some(([, lon, lat]) => Math.hypot((x - lon * 1e5) * kx(lat * 1e5), (y - lat * 1e5) * KY) <= TWO_WAY_M);
    }
    const v = Number(out[li]);
    if (near && v % 3 !== 0) { out[li] = String(v - (v % 3)); changed++; }
  });
  console.log(`one-way tracks marked both ways near ${TWO_WAY.map(t => t[0]).join(', ')} (within ${TWO_WAY_M} m): ${changed}`);
  return out.join('');
}
function addCornerCurves({ n: nn, d: dd }, digits, speeds) {
  const ls = [];
  let x = 0, y = 0, k = 0;
  for (const cnt of nn) { const pts = []; for (let i = 0; i < cnt; i++) { x += dd[2 * k]; y += dd[2 * k + 1]; k++; pts.push([x, y]); } ls.push(pts); }
  const mXY = (a, b) => Math.hypot((b[0] - a[0]) * kx(a[1]), (b[1] - a[1]) * KY);
  const headXY = (a, b) => (Math.atan2((b[0] - a[0]) * kx(a[1]), (b[1] - a[1]) * KY) / R + 360) % 360;
  const angle = (a, b) => { const v = Math.abs(a - b) % 360; return v > 180 ? 360 - v : v; };
  const at = new Map();   // meeting point -> [[line, 0 start / 1 end]]
  ls.forEach((l, li) => { for (const e of [0, 1]) { const kk = key(e ? l.at(-1) : l[0]); (at.get(kk) ?? at.set(kk, []).get(kk)).push([li, e]); } });
  const leave = (li, e) => (e ? headXY(ls[li].at(-1), ls[li].at(-2)) : headXY(ls[li][0], ls[li][1]));
  const turn = (a, b) => angle((leave(...a) + 180) % 360, leave(...b));
  // The straightest way on from line li's end e: { nb, turn }, or null at a dead end.
  const straightest = (li, e) => {
    const pt = e ? ls[li].at(-1) : ls[li][0];
    const others = at.get(key(pt)).filter(([lj]) => lj !== li);
    return others.map(nb => ({ nb, turn: turn([li, e], nb) })).sort((p, q) => p.turn - q.turn)[0] ?? null;
  };
  let out = digits, added = 0;
  const count = ls.length;
  for (let li = 0; li < count; li++) {
    const l = ls[li];
    if (l.length !== 2 || (digits && digits[li] >= '3')) continue;
    const len = mXY(l[0], l[1]);
    if (len < CORNER_MIN_M) continue;
    const a = straightest(li, 0), b = straightest(li, 1);
    if (!a || !b || a.turn <= MAX_TURN || b.turn <= MAX_TURN || a.turn > SHARP_TURN || b.turn > SHARP_TURN) continue;
    // Leave each end the way its straightest neighbour arrives there (straight on from it).
    const [W, E] = l, arm = len * CORNER_ARM;
    const step = (p, h) => [p[0] + Math.sin(h * R) * arm / kx(p[1]), p[1] + Math.cos(h * R) * arm / KY];
    const P1 = step(W, (leave(...a.nb) + 180) % 360), P2 = step(E, (leave(...b.nb) + 180) % 360);
    const N = Math.max(8, Math.ceil(len / 40));
    const curve = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, w0 = (1 - t) ** 3, w1 = 3 * (1 - t) ** 2 * t, w2 = 3 * (1 - t) * t * t, w3 = t ** 3;
      curve.push(i === 0 ? [...W] : i === N ? [...E] : [Math.round(w0 * W[0] + w1 * P1[0] + w2 * P2[0] + w3 * E[0]), Math.round(w0 * W[1] + w1 * P1[1] + w2 * P2[1] + w3 * E[1])]);
    }
    let curveLen = 0;
    for (let i = 1; i < curve.length; i++) curveLen += mXY(curve[i - 1], curve[i]);
    ls.push(curve);
    if (out) out += out[li];
    if (speeds) speeds.push(speeds[li]);   // (the curve has its straight line's speed)
    added++;
    console.log(`straight corner of ${len.toFixed(0)} m (turns ${a.turn.toFixed(0)}° and ${b.turn.toFixed(0)}°) at ${(W[1] / 1e5).toFixed(5)},${(W[0] / 1e5).toFixed(5)}: curve of ${curveLen.toFixed(0)} m added`);
  }
  console.log(`straight corners with a curve added: ${added}`);
  const n2 = [], d2 = [];
  let px = 0, py = 0;
  for (const l of ls) { n2.push(l.length); for (const [qx, qy] of l) { d2.push(qx - px, qy - py); px = qx; py = qy; } }
  return { n: n2, d: d2, c: out };
}

const before = statSync(src).size;
const pts = simple.reduce((a, c) => a + c.length, 0), ptsBefore = lines.reduce((a, c) => a + c.length, 0);
const mb = b => `${(b / 1e6).toFixed(2)} MB`;
console.log(`lines ${lines.length} -> ${simple.length} (joined ${joined} loose ends to other lines); points ${ptsBefore} -> ${pts}`);
console.log(`size: ${mb(before)} (gzipped ${mb(gzipSync(readFileSync(src)).length)}) -> ${mb(json.length)} (gzipped ${mb(gzipSync(json).length)})`);
