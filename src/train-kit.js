// The faceted trains (2026-11-18; Max picked "B and R2, that is facets on both" from docs/trains-look-1118/): one way of
// building every train, toy and realistic. Each car is one lofted shell: cross-section rings along the car, the nose
// made of rings that shrink along the train model's nose curve (toy-trains.js N), painted by facet (each face one
// colour from its height and its place along the car: skirt, stripe, window band, roof, nose), flat shaded. The
// windscreen and its frame are thin skins hugging the nose (painted onto the facets their edges came out ragged).
// White lights at the train's front, red at its back, glowing. Every company follows the same rules, so they look
// like one family.
// A train is a THREE.Group of cars (each a Group: its body as one part, plus its lights on the end cars), so the map
// can set each car on the track and bend the train round a curve (trains-3d.js). userData: length, width.
// Model space: metres (toy: caricature units), x across, y along (+y the front), z up, rails at z = 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const FLOOR = 0.8, GAP = 0.5;

// The cross-section: [share of the height, share of the half-width], bottom to the roof's crown.
const SHAPE = [[0, 0.84], [0.05, 0.97], [0.12, 1], [0.8, 1], [0.87, 0.95], [0.97, 0.66], [0.995, 0.14], [1, 0]];

// The two looks. toy: a unit of the toy models as it is (lengths are caricature units). real: true car lengths (a toy
// unit of 9 is 22.5 m), each company's usual number of cars, noses at real length.
export const STYLES = {
  toy: { real: false, sL: 1, noseL: 1, W: 3.2, wheel: 0.42, winPitch: 1.6, pillar: 0.24, glint: 0.1 },
  real: { real: true, sL: 2.5, noseL: 0.62, W: 3.1, wheel: 0.45, winPitch: 2.4, pillar: 0.4, glint: 0.1 },
};

// Paint bands as shares of the body height.
const BANDS = {
  1: { skirt: 0.2, stripe: [0.245, 0.31], windows: [[0.45, 0.75]], roof: 0.86 },
  2: { skirt: 0.15, stripe: [0.15, 0.2], windows: [[0.24, 0.42], [0.6, 0.78]], roof: 0.86 },
};

const lin = (pts, f) => { for (let i = 1; i < pts.length; i++) if (f <= pts[i][0]) { const [f0, x0] = pts[i - 1], [f1, x1] = pts[i]; return x0 + (x1 - x0) * (f - f0) / (f1 - f0); } return pts.at(-1)[1]; };

// The heights a car's rings use: the shape's own corners plus every paint edge, so paint lines run along edges.
function fractions(bands) {
  const fs = new Set(SHAPE.map(p => p[0]));
  fs.add(bands.skirt); fs.add(bands.stripe[0]); fs.add(bands.stripe[1]); fs.add(bands.roof);
  for (const [a, b] of bands.windows) { fs.add(a); fs.add(b); }
  return [...fs].sort((a, b) => a - b);
}

const noseTop = (n, top, d) => {   // the nose's height at d (0 where the nose starts, len at its tip)
  const vb = FLOOR + n.base * (top - FLOOR);
  const t = Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, d / n.len), n.k)), 1 / n.k);
  return vb + t * (top - vb);
};
const noseFront = (n, top, v) => {   // how far forward the nose surface is at height v
  const vb = FLOOR + n.base * (top - FLOOR);
  if (v <= vb) return n.len;
  const t = Math.min(1, (v - vb) / (top - vb));
  return n.len * Math.pow(Math.max(0, 1 - Math.pow(t, n.k)), 1 / n.k);
};

const WHITE = new THREE.Color('#ffffff');
function colourSet(raw) {
  const c = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') c[k] = new THREE.Color(v);
  c.stripeOn = !!raw.stripe; c.frameOn = !!raw.frame;
  c.stripe ??= c.body; c.frame ??= c.body;
  c.hub = c.wheel.clone().lerp(new THREE.Color('#9aa3ad'), 0.45);
  return c;
}

// A piece of geometry with one colour on every corner (wheels, bogies, lights ...), placed by matrix mx.
function painted(geo, colour, mx) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  if (mx) g.applyMatrix4(mx);
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([colour.r, colour.g, colour.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const at = (x, y, z, rx = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(1, 1, 1));

// One car, its middle at the origin: { pieces (the body's geometries), frames and screens (the windscreen frames' and
// windscreens' skins), glow (its lights' geometries) }.
// ends: { front, back }: 'front' / 'back' where this end is the train's (lights), null where it is coupled.
function car(spec, c, st, ends, lit = false) {
  const L = spec.length * st.sL, H = spec.height, W = st.W, hw = W / 2;
  const top = FLOOR + H, bands = BANDS[spec.decks === 2 ? 2 : 1];
  const flat = { len: st.real ? 0.5 : 0.3, base: 0.86, k: 5, taper: 0.04, flat: true };
  const scaleN = n => n && { ...n, len: n.len * st.sL * st.noseL };
  const fN = scaleN(spec.front) ?? flat, bN = scaleN(spec.back) ?? flat;
  const yF = L / 2 - fN.len, yB = -L / 2 + bN.len, straight = yF - yB;
  const fr = fractions(bands);
  const pieces = [], frames = [], screens = [], glow = [];

  // Ring: the cross-section at y, with height Hd above the floor and half-width w. Up to near the ring's top heights
  // stay true (so paint lines keep their height on the nose); above, they are squeezed into the rest.
  const squeeze = (h, Hd) => { const s = Math.max(0.35 * Hd, Hd - 0.15 * H); return h <= s || Hd >= H - 1e-6 ? Math.min(h, Hd) : s + (h - s) * (Hd - s) / (H - s); };
  const ring = (y, Hd, w) => {
    const pts = [];
    for (const f of fr) if (f < 1) pts.push({ p: new THREE.Vector3(lin(SHAPE, f) * w, y, FLOOR + squeeze(f * H, Hd)), f });
    const crown = { p: new THREE.Vector3(0, y, FLOOR + squeeze(H, Hd)), f: 1 };
    const left = pts.slice().reverse().map(q => ({ p: new THREE.Vector3(-q.p.x, y, q.p.z), f: q.f }));
    return [...pts, crown, ...left];
  };

  // The rings from the back tip to the front tip, each with its zone.
  const rings = [];
  const noseDs = n => n.flat ? [0.5, 1] : [0.16, 0.32, 0.47, 0.6, 0.72, 0.82, 0.9, 0.96, 1];
  for (const s of noseDs(bN).slice().reverse()) {
    const d = s * bN.len;
    rings.push({ r: ring(yB - d, noseTop(bN, top, d) - FLOOR, hw * (1 - (bN.taper ?? 0) * s * s)), zone: 'back' });
  }
  // The straight part: stations at every window edge (or vent edge).
  const ys = [yB], spans = [];
  const m = st.real ? 0.9 : 0.3, winLen = straight - 2 * m;
  if (spec.vents) {
    const len = straight * 0.6, n = 7, y0 = (yB + yF) / 2 - len / 2;
    ys.push(y0); spans.push('plain');
    for (let k = 0; k < n; k++) { ys.push(y0 + (k + 0.25) * len / n, y0 + (k + 0.75) * len / n); spans.push('plain', 'vent'); }
    spans.push('plain'); ys.push(y0 + len); spans.push('plain');
  } else if (winLen > 0.5 && !spec.noWindows) {
    const n = Math.max(1, Math.round(winLen / st.winPitch)), p = st.pillar, wl = (winLen - (n - 1) * p) / n;
    let y = yB + m; ys.push(y); spans.push('plain');
    for (let k = 0; k < n; k++) { y += wl; ys.push(y); spans.push('win'); if (k < n - 1) { y += p; ys.push(y); spans.push('plain'); } }
  }
  ys.push(yF); spans.push('plain');
  ys.forEach((y, i) => rings.push({ r: ring(y, H, hw), zone: 'mid', span: i > 0 ? spans[i - 1] : null }));
  for (const s of noseDs(fN)) {
    const d = s * fN.len;
    rings.push({ r: ring(yF + d, noseTop(fN, top, d) - FLOOR, hw * (1 - (fN.taper ?? 0) * s * s)), zone: 'front' });
  }

  const glass = c.band, glint = c.band.clone().lerp(WHITE, st.glint);
  const pos = [], col = [];
  // lit (the night side of the sun's line, 2026-11-23): the side windows go into a part of their own in the lights'
  // unlit paint (GLOW), warm, instead of the body's glass; the same triangles, so nothing lies on top of anything.
  const lpos = [], lcol = [];
  const tri = (a, b, cc, colour, into = null) => {
    if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(cc, a)).lengthSq() < 1e-8) return;
    const [P, C] = into ?? [pos, col];
    P.push(a.x, a.y, a.z, b.x, b.y, b.z, cc.x, cc.y, cc.z);
    for (let i = 0; i < 3; i++) C.push(colour.r, colour.g, colour.b);
  };
  const paintMid = (f, span, second) => {
    if (f < 0.01) return c.bogie;
    if (f < bands.skirt) return c.skirt;
    if (c.stripeOn && f >= bands.stripe[0] && f <= bands.stripe[1]) return c.stripe;
    if (f >= bands.roof) return c.roof;
    if (bands.windows.some(([a, b]) => f > a && f < b)) {
      if (span === 'win') return second ? glint : glass;   // one triangle of each window a little lighter: a glint
      if (span === 'vent') return c.band;
    }
    return c.body;
  };
  const paintNose = (n, f, z) => {
    if (f < 0.01) return c.bogie;
    if (n.flat) return paintMid(f, 'plain', false);
    if (z < FLOOR + bands.skirt * H) return c.skirt;
    if (c.stripeOn && z >= FLOOR + bands.stripe[0] * H && z <= FLOOR + bands.stripe[1] * H) return c.stripe;
    return c.nose;
  };
  for (let i = 0; i + 1 < rings.length; i++) {
    const A = rings[i], B = rings[i + 1];
    const zone = A.zone === 'mid' && B.zone === 'mid' ? 'mid' : A.zone === 'back' ? 'back' : 'front';
    const span = B.span ?? 'plain', N = A.r.length;
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = A.r[j].p, b = A.r[j2].p, cc = B.r[j2].p, d = B.r[j].p;
      const f = (A.r[j].f + A.r[j2].f) / 2, z = (a.z + b.z + cc.z + d.z) / 4;
      const pick = second => j2 === 0 ? c.bogie : zone === 'mid' ? paintMid(f, span, second) : paintNose(zone === 'front' ? fN : bN, f, z);
      // Every ring runs the same way round, so (a, c, b) and (a, d, c) always face out (a guess at which way was out
      // turned faces of the X2000's long low nose inside out, and they vanished: a hole; Max, 2026-11-18).
      const pane = lit && zone === 'mid' && span === 'win' && j2 !== 0 && bands.windows.some(([w0, w1]) => f > w0 && f < w1);
      tri(a, cc, b, pane ? LIT[0] : pick(false), pane ? [lpos, lcol] : null);
      tri(a, d, cc, pane ? LIT[1] : pick(true), pane ? [lpos, lcol] : null);
    }
  }
  // Caps at both tips: the upright front, in strips (one per pair of heights), facing out.
  for (const [R, dir, n] of [[rings[0], -1, bN], [rings.at(-1), 1, fN]]) {
    const r = R.r, N = r.length, m2 = (N - 1) / 2;   // right side 0..m2-1, crown m2, left side m2+1..N-1
    const face = (a, b, cc, colour) => {
      const nn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(cc, a));
      if (nn.y * dir < 0) tri(a, cc, b, colour); else tri(a, b, cc, colour);
    };
    for (let j = 0; j + 1 < m2; j++) {
      const a = r[N - 1 - j].p, b = r[j].p, cc = r[j + 1].p, d = r[N - 2 - j].p;
      const z = (a.z + cc.z) / 2, f = (r[j].f + r[j + 1].f) / 2;
      const colour = n.flat ? (z < FLOOR + bands.skirt * H ? c.skirt : c.body) : paintNose(n, f, z);
      face(a, b, cc, colour); face(a, cc, d, colour);
    }
    face(r[m2 - 1].p, r[m2].p, r[m2 + 1].p, n.flat ? c.roof : c.nose);
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  pieces.push(shell);
  if (lpos.length) {
    const windows = new THREE.BufferGeometry();
    windows.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3));
    windows.setAttribute('color', new THREE.Float32BufferAttribute(lcol, 3));
    glow.push(windows);
  }

  // Windscreen and frame: thin skins laid over the nose, a grid of facets following the nose's own surface.
  // widthAt(d, v): the body's half-width at height v on the ring d along the nose; the skin's point at (x, v) sits
  // on the furthest-forward ring still that wide there.
  const widthAt = (n, d, v) => {
    const Hd = noseTop(n, top, d) - FLOOR, h = v - FLOOR;
    if (h > Hd + 1e-6) return -1;
    const sq = Math.max(0.35 * Hd, Hd - 0.15 * H);
    const f = h <= sq || Hd >= H - 1e-6 ? h / H : (sq + (h - sq) * (H - sq) / Math.max(1e-6, Hd - sq)) / H;
    const s = d / n.len;
    return lin(SHAPE, Math.min(1, f)) * hw * (1 - (n.taper ?? 0) * s * s);
  };
  const onNose = (n, x, v) => {
    const ax = Math.abs(x);
    if (widthAt(n, 0, v) < ax) return null;
    let lo = 0, hi = n.len;
    for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (widthAt(n, mid, v) >= ax) lo = mid; else hi = mid; }
    return lo;
  };
  const skin = (n, dir, y0, v1, v2, half, x0, gap, colour, list) => {
    v2 = Math.min(v2, top - 0.25);   // clear of the roof's squeezed shoulders, where facets poke through
    if (v2 - v1 < 0.1) return;
    const R = 8, C = 10, grid = [];
    for (let i = 0; i <= R; i++) {
      const v = v1 + (v2 - v1) * i / R, row = [], edge = widthAt(n, 0, v) * 0.995;
      for (let j = 0; j <= C; j++) {
        const x = Math.max(-edge, Math.min(edge, x0 - half + 2 * half * j / C));
        const d = onNose(n, x, v) ?? 0;
        // Out from the surface along its slope (forward and up on a sloping nose), and sideways where the skin wraps
        // round the side, with more room towards the sides: never closer than gap to the body, so nothing flickers.
        const e = 0.02, slope = (noseFront(n, top, v + e) - noseFront(n, top, v - e)) / (2 * e);
        const nu = 1 / Math.hypot(1, slope), nv = -slope * nu;
        const side = Math.abs(x) / hw, s2 = side * side, o = gap + 0.12 * s2;
        const out = new THREE.Vector3(Math.sign(x) * s2, dir * nu * (1 - 0.6 * s2), nv * (1 - s2)).normalize().multiplyScalar(o);
        row.push(new THREE.Vector3(x, y0 + dir * d, v).add(out));
      }
      grid.push(row);
    }
    const p = [];
    const push = (a, b, cc) => {
      if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(cc, a)).lengthSq() < 1e-10) return;
      p.push(a.x, a.y, a.z, b.x, b.y, b.z, cc.x, cc.y, cc.z);
    };
    // Rows go up, columns go right (+x): (a, c, b) faces forward at the front (+y), (a, b, c) at the back (-y).
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const a = grid[i][j], b = grid[i][j + 1], cc = grid[i + 1][j + 1], d = grid[i + 1][j];
      if (dir > 0) { push(a, cc, b); push(a, d, cc); } else { push(a, b, cc); push(a, cc, d); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    list.push(painted(g, colour));
  };
  for (const [n, dir, y0] of [[fN, 1, yF], [bN, -1, yB]]) {
    if (n.flat || !n.screen) continue;
    const s1 = FLOOR + n.screen[0] * H, s2 = FLOOR + n.screen[1] * H;
    const long = n.len > 1.8 * (st.real ? 1.6 : 1);   // a long nose: less wrap (the skin broke into steps at its sides)
    if (c.frameOn) skin(n, dir, y0, s1 - 0.3, s2 + 0.3, long ? 0.84 * hw : n.wrap ? 0.94 * hw : 0.9 * hw, 0, 0.05, c.frame, frames);
    if (n.twin) for (const x0 of [-0.45 * hw, 0.45 * hw]) skin(n, dir, y0, s1, s2, 0.33 * hw, x0, 0.1, c.windscreen, screens);
    else skin(n, dir, y0, s1, s2, long ? 0.76 * hw : n.wrap ? 0.9 * hw : 0.82 * hw, 0, 0.1, c.windscreen, screens);
  }

  // Bogies and wheels (hubs stand 4 cm out of the wheels, the bogie 6 cm inside them: no surfaces on top of each other).
  const wr = st.wheel;
  const wheel = new THREE.CylinderGeometry(wr, wr, 0.32, 8).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(wr * 0.45, wr * 0.45, 0.4, 8).rotateZ(Math.PI / 2);
  // Two bogies, never so close that their wheels overlap (the short toy locomotives' did).
  const wd = st.real ? 1.1 : 0.66, by = Math.max((st.real ? L / 2 - 3.2 : spec.length / 2 - 1.8), wd + wr + 0.08);
  const bogieYs = spec.bogies && !st.real ? spec.bogies : [-by, by];
  for (const y0 of bogieYs) {
    const wx = hw - 0.32;
    pieces.push(painted(new THREE.BoxGeometry(2 * (wx - 0.22), st.real ? 3.0 : 2.2, 0.5), c.bogie, at(0, y0, 0.62)));
    for (const dy of [-wd, wd]) for (const x of [-1, 1]) {
      pieces.push(painted(wheel.clone(), c.wheel, at(x * wx, y0 + dy, wr)));
      pieces.push(painted(hub.clone(), c.hub, at(x * wx, y0 + dy, wr)));
    }
  }
  // Roof: pantographs (electric) and cooling boxes (diesel), standing clear of the roof.
  const pantos = spec.panto === 'both' ? [yB + 1.0, yF - 1.0] : spec.panto === 'front' ? [yF - 1.2] : spec.panto === 'back' ? [yB + 1.2] : [];
  for (const py of pantos) {
    pieces.push(painted(new THREE.BoxGeometry(1.5, 0.9, 0.22), c.bogie, at(0, py, top + 0.13)));
    const arm = new THREE.BoxGeometry(0.13, 1.45, 0.13);
    pieces.push(painted(arm.clone(), c.bogie, at(0, py - 0.34, top + 0.66, 0.8)));
    pieces.push(painted(arm.clone(), c.bogie, at(0, py + 0.34, top + 0.66, -0.8)));
    pieces.push(painted(new THREE.BoxGeometry(1.8, 0.16, 0.12), c.bogie, at(0, py, top + 1.16)));
  }
  for (const y of spec.roofBoxes ?? []) pieces.push(painted(new THREE.CylinderGeometry(1.0, 1.15, 0.5, 6).rotateX(Math.PI / 2).rotateZ(Math.PI / 6), c.roof, at(0, y * st.sL, top + 0.15)));
  // Lights: white at the train's front, red at its back, none on coupled ends; a coupler under a front that has one.
  for (const [n, dir, y0, kind] of [[fN, 1, yF, ends.front], [bN, -1, yB, ends.back]]) {
    if (!kind) continue;
    if (n.coupler) pieces.push(painted(new THREE.BoxGeometry(0.9, 0.5, 0.45), c.bogie, at(0, y0 + dir * (n.len + 0.12), FLOOR + 0.1)));
    const lv = FLOOR + (n.lights ?? 0.18) * H;
    const u = noseFront(n, top, lv), s = Math.min(1, u / n.len), w = hw * (1 - (n.taper ?? 0) * s * s);
    const colour = kind === 'front' ? c.light : c.tail;
    for (const x of [-1, 1]) glow.push(painted(new THREE.BoxGeometry(0.52, 0.12, 0.26), colour, at(x * w * 0.64, y0 + dir * (u + 0.08), lv)));
  }
  return { L, pieces, frames, screens, glow };
}

// The realistic trains: the model's cars, with as many plain middle cars as the company usually runs.
function realParts(parts, cars) {
  const loco = parts.find(p => p.loco);
  if (loco) return [...Array(Math.max(1, cars - 1)).fill({ ...parts[0], length: 10 }), loco];   // coaches, then the locomotive
  const first = parts[0], last = parts.at(-1);
  const middle = parts.length >= 3 ? { ...parts[1], length: 10 } : { ...first, front: null, back: null, panto: undefined };
  return [first, ...Array(Math.max(0, cars - 2)).fill(middle), last];
}

// One paint for all bodies, one for windscreen frames, one for windscreens and one for lights: every train shares them
// (and their see-through copies, trains-3d.js). The frames and windscreens lie a few centimetres over the curved nose,
// in places closer: the graphics card pulls them a little towards the eye (polygonOffset; screen over frame over
// body), so they never flicker against the body or each other (tools/models-check.mjs).
const BODY = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const FRAME = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
const SCREEN = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
// Lit windows at night: warm light, one triangle of each a little paler (as the glass's glint by day).
const LIT = [new THREE.Color('#ffd98a'), new THREE.Color('#ffe7b0')];

// A whole train. models: the train models (toy-trains.js MODELS); model: one of them; colours: { body, skirt, band,
// roof, nose, windscreen, stripe, frame, loco: { ... } } (as toy-brands.js and brands.js); style: STYLES.toy or
// STYLES.real; cars: how many cars (realistic). pieces: true keeps each piece its own part (tools/models-check.mjs).
export function buildFacets(models, model, colours, style, cars = 0, { pieces: separate = false, lit = false } = {}) {
  const base = { body: '#d0d7de', band: '#1f2328', windscreen: '#11161c', bogie: '#2d333b', wheel: '#1b1f24', light: '#fff4c2', tail: '#ff4a4a' };
  const r0 = { ...base, ...colours };
  r0.skirt ??= r0.body; r0.roof ??= r0.body; r0.nose ??= r0.body;
  const c = colourSet(r0);
  // The locomotive's paint: its own (toys), or for realistic trains the company's front colour all over.
  const lc = colours.loco ?? (style.real ? { body: r0.nose, nose: r0.nose, skirt: r0.skirt, roof: r0.nose } : null);
  let cl = c;
  if (lc) {
    const r = { ...r0, ...lc };
    r.skirt = lc.skirt ?? r.body; r.roof = lc.roof ?? r.body; r.nose = lc.nose ?? r.body;
    if (!lc.stripe) delete r.stripe;
    if (!lc.frame) delete r.frame;
    cl = colourSet(r);
  }
  const parts = style.real ? realParts(models[model] ?? models.regina, cars || 3) : (models[model] ?? models.regina);
  const lens = parts.map(p => p.length * style.sL);
  const total = lens.reduce((s, l) => s + l, 0) + GAP * (parts.length - 1);
  const train = new THREE.Group();
  let y = -total / 2;
  parts.forEach((p, i) => {
    const { pieces, frames, screens, glow } = car(p, p.loco ? cl : c, style, { front: i === parts.length - 1 ? 'front' : null, back: i === 0 ? 'back' : null }, lit);
    if (i < parts.length - 1) {   // the bellows to the next car, at this car's front end
      const h = Math.min(p.height, parts[i + 1].height);
      for (const k of [-1, 0, 1]) pieces.push(painted(new THREE.BoxGeometry(style.W - (k ? 0.9 : 1.1), 0.2, h - 1.0), c.bogie, at(0, lens[i] / 2 + GAP / 2 + k * 0.22, FLOOR + h / 2 - 0.1)));
    }
    const carGroup = new THREE.Group();
    if (separate) for (const g of pieces) { g.computeVertexNormals(); carGroup.add(new THREE.Mesh(g, BODY)); }
    else { const body = mergeGeometries(pieces); body.computeVertexNormals(); carGroup.add(new THREE.Mesh(body, BODY)); }
    for (const [list, paint] of [[frames, FRAME], [screens, SCREEN]]) {
      if (!list.length) continue;
      if (separate) for (const g of list) { g.computeVertexNormals(); carGroup.add(new THREE.Mesh(g, paint)); }
      else { const g = mergeGeometries(list); g.computeVertexNormals(); carGroup.add(new THREE.Mesh(g, paint)); }
    }
    if (glow.length) carGroup.add(new THREE.Mesh(mergeGeometries(glow), GLOW));
    carGroup.position.y = y + lens[i] / 2;
    train.add(carGroup);
    y += lens[i] + GAP;
  });
  train.userData.length = total;
  train.userData.width = style.W;
  return train;
}
