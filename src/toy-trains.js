// Toy trains: a short, chunky caricature of each company's usual train (step 5, "the look").
// The shape follows the real train model (X61, Regina, X2000 ...); the paint follows the company (brands.js).
//
// Model space as in train-model.js: metres, x = across (right), y = along the train (+y = the front), z = up,
// rails at z = 0. Drawn at caricature proportions (a unit is a few cars squeezed into ~20 m); trains-3d.js
// enlarges it further so it never gets too small on the screen.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const W = 3.2;           // body width
const FLOOR = 0.8;       // bottom of the body above the rails
const GAP = 0.5;         // gap between vehicles
const BEVEL = 0.28;      // rounded edges everywhere: the toy look

// ---- Shapes ----
// Side profile (u along, v up) extruded across the width, with rounded edges, turned into model space.
const toModel = new THREE.Matrix4().set(
  0, 0, 1, 0,
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 0, 1);
function extrude(points, width, bevel = BEVEL) {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const b = Math.min(bevel, width / 4);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 3,
    curveSegments: 4,
  });
  g.applyMatrix4(toModel);
  g.translate(-(width - 2 * b) / 2, 0, 0);
  // Smooth light over the rounded edges: join the corners the extrusion left separate, then share their normals.
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const smooth = mergeVertices(g, 1e-4);
  smooth.computeVertexNormals();
  return smooth;
}
const boxGeo = (w, l, h) => new THREE.BoxGeometry(w, l, h);

// A nose: how far the front sticks out (len) at each height. Below `base` (a share of the body height) the
// front is upright; above it, it curves back to the roof: k = 1 a straight slope, 2 a round bulb, 5+ nearly flat.
// screen: [from, to] as shares of the body height, where the windscreen sits on the nose.
function noseCurve(nose, top) {
  const h = top - FLOOR, vb = FLOOR + nose.base * h, pts = [];
  pts.push([nose.len, FLOOR]);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, v = vb + t * (top - vb);
    pts.push([nose.len * Math.pow(Math.max(0, 1 - Math.pow(t, nose.k)), 1 / nose.k), v]);
  }
  return pts;   // from the bottom front to the roof, u measured forward from where the nose starts
}
const frontAt = (curve, v) => {   // u of the nose surface at height v
  for (let i = 1; i < curve.length; i++) {
    const [u0, v0] = curve[i - 1], [u1, v1] = curve[i];
    if (v <= v1) return v1 === v0 ? u1 : u0 + (u1 - u0) * (v - v0) / (v1 - v0);
  }
  return curve.at(-1)[0];
};
// A band of the nose's surface between two heights, `depth` thick (for windscreens and painted fronts).
function noseBand(curve, v1, v2, depth) {
  const surf = [];
  const n = 10;
  for (let i = 0; i <= n; i++) { const v = v1 + (v2 - v1) * i / n; surf.push([frontAt(curve, v), v]); }
  return [...surf, ...surf.slice().reverse().map(([u, v]) => [u - depth, v])];
}

// order: which part wins where two parts lie on (almost) the same surface: higher on top (the body 0; skirt and
// window band 1; nose paint, pillars and vents 2; roof, stripe and frame 3; windscreen 4; lights 5). Without it they
// flickered (Max, 2026-11-12); the graphics card pulls a higher part a little towards the eye (polygonOffset).
const materials = new Map();
const mat = (color, order = 0) => {
  const key = `${color}|${order}`;
  if (!materials.has(key)) materials.set(key, new THREE.MeshLambertMaterial(order
    ? { color, polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -2 * order } : { color }));
  return materials.get(key);
};
const mesh = (geo, color, x = 0, y = 0, z = 0, order = 0) => { const m = new THREE.Mesh(geo, mat(color, order)); m.position.set(x, y, z); return m; };

// ---- One vehicle ----
// spec: { length, height, front, back (noses or null: a flat end), decks (window rows), panto, roofBoxes,
//         frontPaint: true to paint the nose in c.nose, cabWindows }
function vehicle(spec, c) {
  const { length: L, height: H } = spec;
  const top = FLOOR + H;
  const g = new THREE.Group();
  const flat = { len: 0.25, base: 0.85, k: 6 };   // a plain end: upright with a rounded top edge
  const fN = spec.front ?? flat, bN = spec.back ?? flat;
  const fC = noseCurve(fN, top), bC = noseCurve(bN, top);
  const yF = L / 2 - fN.len, yB = -L / 2 + bN.len;   // where the straight body ends at each end

  // The body: one piece, from the back nose to the front nose.
  const outline = [
    [yB - bN.len, FLOOR], [yF + fN.len, FLOOR],
    ...fC.slice(1).map(([u, v]) => [yF + u, v]),
    ...bC.slice(1).reverse().map(([u, v]) => [yB - u, v]),
  ];
  g.add(mesh(extrude(outline, W), c.body));

  // Lower body (skirt) and roof in their own colours, as thin shells along the straight part.
  const straight = yF - yB;
  if (c.skirt !== c.body) g.add(mesh(boxGeo(W + 0.06, straight, 0.7), c.skirt, 0, (yF + yB) / 2, FLOOR + 0.35, 1));
  if (c.roof !== c.body) g.add(mesh(extrude([[yB - 0.2, top - 0.5], [yF + 0.2, top - 0.5], [yF, top], [yB, top]], W + 0.06, 0.15), c.roof, 0, 0, 0, 3));
  if (c.stripe) g.add(mesh(boxGeo(W + 0.08, straight, 0.22), c.stripe, 0, (yF + yB) / 2, FLOOR + 0.95, 3));

  // Window rows: dark bands along the sides (one per deck), split by pillars.
  const rows = spec.decks === 2 ? [FLOOR + H * 0.3, FLOOR + H * 0.68] : [FLOOR + H * 0.6];
  const winH = spec.decks === 2 ? H * 0.2 : H * 0.28;
  const winLen = straight - 0.6;
  if (winLen > 0.5 && !spec.noWindows) for (const z of rows) {
    g.add(mesh(boxGeo(W + 0.05, winLen, winH), c.band, 0, (yF + yB) / 2, z, 1));
    const n = Math.max(1, Math.round(winLen / 1.6));
    for (let k = 1; k < n; k++) g.add(mesh(boxGeo(W + 0.08, 0.22, winH + 0.02), c.body, 0, yB + 0.3 + k * winLen / n, z, 2));
  }

  // The ends: painted front, windscreen, lights. Back noses are built the same way and turned around.
  for (const [nose, curve, dir, yAt] of [[spec.front, fC, 1, yF], [spec.back, bC, -1, yB]]) {
    if (!nose) continue;
    const end = new THREE.Group();
    if (nose.paint ?? true) {
      const v1 = FLOOR, v2 = top;
      end.add(mesh(extrude(noseBand(curve, v1 + 0.02, v2 - 0.02, nose.len + 0.6), W + 0.08), c.nose, 0, 0.03, 0, 2));
    }
    const [s1, s2] = nose.screen;
    const sv1 = FLOOR + s1 * H, sv2 = FLOOR + s2 * H;
    if (c.frame) {   // a coloured frame round the windscreen (Västtågen's blue, Norrtåg's yellow)
      end.add(mesh(extrude(noseBand(curve, sv1 - 0.3, Math.min(top, sv2 + 0.3), 0.8), W + 0.12, 0.14), c.frame, 0, 0.05, 0, 3));
    }
    if (nose.twin) {   // two separate windscreens (X11, Rc)
      for (const x of [-0.75, 0.75]) {
        const sg = extrude(noseBand(curve, sv1, sv2, 0.3), 1.2, 0.08);
        sg.translate(x, 0.09, 0);
        end.add(mesh(sg, c.windscreen, 0, 0, 0, 4));
      }
    } else {
      end.add(mesh(extrude(noseBand(curve, sv1, sv2, 0.6), W + (nose.wrap ? 0.14 : -0.5), 0.12), c.windscreen, 0, 0.08, 0, 4));
    }
    for (const x of [-1.05, 1.05]) {
      const lv = FLOOR + (nose.lights ?? 0.18) * H;
      end.add(mesh(boxGeo(0.5, 0.12, 0.28), c.light, x, frontAt(curve, lv) + 0.1, lv, 5));
    }
    if (nose.coupler) end.add(mesh(boxGeo(1.0, 0.5, 0.5), c.bogie, 0, nose.len + 0.15, FLOOR + 0.1));
    end.position.y = yAt;
    if (dir < 0) { end.rotation.z = Math.PI; end.position.y = yAt; }
    g.add(end);
  }

  // A locomotive's side: ribbed vents instead of windows.
  if (spec.vents) {
    const n = 7, len = straight * 0.6;
    for (let k = 0; k < n; k++) g.add(mesh(boxGeo(W + 0.06, len / n * 0.5, H * 0.3), c.band, 0, (yF + yB) / 2 - len / 2 + (k + 0.5) * len / n, FLOOR + H * 0.6, 2));
  }

  // Under the body: bogies with chunky wheels.
  const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10);
  wheel.rotateZ(Math.PI / 2);
  for (const y of spec.bogies ?? [-L / 2 + 1.8, L / 2 - 1.8]) {
    g.add(mesh(boxGeo(2.4, 2.2, 0.5), c.bogie, 0, y, 0.6));
    for (const dy of [-0.65, 0.65]) for (const x of [-1.25, 1.25]) g.add(mesh(wheel, c.wheel, x, y + dy, 0.42));
  }

  // Roof: a pantograph (electric) or cooling boxes (diesel).
  const pantos = spec.panto === 'both' ? [yB + 1.0, yF - 1.0] : spec.panto === 'front' ? [yF - 1.2] : spec.panto === 'back' ? [yB + 1.2] : [];
  for (const py of pantos) {
    g.add(mesh(boxGeo(1.6, 1.0, 0.25), c.bogie, 0, py, top + 0.12));
    const arm = boxGeo(0.12, 1.5, 0.12);
    const a1 = mesh(arm, c.bogie, 0, py - 0.35, top + 0.65); a1.rotation.x = 0.8;
    const a2 = mesh(arm, c.bogie, 0, py + 0.35, top + 0.65); a2.rotation.x = -0.8;
    g.add(a1, a2, mesh(boxGeo(1.8, 0.14, 0.1), c.bogie, 0, py, top + 1.15));
  }
  for (const y of spec.roofBoxes ?? []) g.add(mesh(extrude([[-0.9, 0], [0.9, 0], [0.9, 0.5], [-0.9, 0.5]], 2.2, 0.12), c.roof, 0, y, top - 0.1, 1));

  // Seen from above, a nose narrows towards its tip (taper: the share of the width lost at the very front).
  // Every part is baked into the vehicle's own space first, so the body and its paint narrow together.
  const fT = spec.front?.taper ?? 0, bT = spec.back?.taper ?? 0;
  if (fT || bT) {
    g.updateMatrixWorld(true);
    const parts = [];
    g.traverse(o => { if (o.isMesh) parts.push(o); });
    for (const m of parts) {
      const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      const p = geo.attributes.position;
      let moved = false;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        // s: how far along the nose (0 where it starts, 1 at the tip); the narrowing grows as s².
        const [s, taper] = y > yF ? [Math.min(1, (y - yF) / fN.len), fT] : y < yB ? [Math.min(1, (yB - y) / bN.len), bT] : [0, 0];
        if (s && taper) { p.setX(i, p.getX(i) * (1 - taper * s * s)); moved = true; }
      }
      if (moved) geo.computeVertexNormals();
      const flatM = new THREE.Mesh(geo, m.material);
      m.removeFromParent();
      g.add(flatM);
    }
    for (const o of [...g.children]) if (!o.isMesh) g.remove(o);
  }
  return g;
}

// ---- The train models ----
// Each: a list of vehicles from the back to the front, with their shapes. Lengths are caricature lengths.
// The source of each look is in brands.js (the photo it was read off).
const N = {
  // Alstom Coradia Nordic (X61, X62) and Coradia (X60): a big rounded nose, a wraparound windscreen.
  coradia: { taper: 0.22, len: 2.4, base: 0.22, k: 2.1, screen: [0.42, 0.86], wrap: true, coupler: true },
  // Bombardier Regina (X50–X55): a long, even slope.
  regina:  { taper: 0.2, len: 2.6, base: 0.28, k: 1.35, screen: [0.45, 0.88] },
  // Stadler Dosto (ER1): a tall double-decker, sloped nose.
  dosto:   { taper: 0.15, len: 2.2, base: 0.3, k: 1.5, screen: [0.5, 0.82] },
  // X40: a double-decker with a blunt, rounded face.
  x40:     { taper: 0.15, len: 1.3, base: 0.35, k: 2.6, screen: [0.5, 0.8] },
  // Bombardier Contessa (X31K): a blunt black face.
  x31:     { taper: 0.08, len: 0.7, base: 0.5, k: 3.5, screen: [0.45, 0.82] },
  // ASEA X10 family (X11, X14): a flat face, two windscreens.
  x10:     { len: 0.45, base: 0.6, k: 5, screen: [0.5, 0.8], twin: true },
  // Bombardier Itino (Y31, Y32): a flat, upright face.
  itino:   { len: 0.6, base: 0.55, k: 4, screen: [0.45, 0.85] },
  // X2000: a long wedge on the power car.
  x2000:   { taper: 0.3, len: 3.8, base: 0.12, k: 1.15, screen: [0.5, 0.85], lights: 0.12 },
  x2000dt: { taper: 0.15, len: 1.4, base: 0.3, k: 2.2, screen: [0.5, 0.85] },          // the driving coach at the other end
  // Alstom Zefiro Express / Avelia Stream (X80): a bullet nose.
  x80:     { taper: 0.32, len: 3.2, base: 0.18, k: 1.7, screen: [0.45, 0.86], wrap: true },
  // Stadler FLIRT (VR X74, Vy type 74): a rounded slope with a big dark mask.
  flirt:   { taper: 0.2, len: 2.3, base: 0.25, k: 1.6, screen: [0.4, 0.88], wrap: true },
  // NSB class 73 (the X2000's Norwegian relative): a long pointed nose.
  c73:     { taper: 0.3, len: 3.4, base: 0.15, k: 1.25, screen: [0.5, 0.86] },
  // Locomotives: Rc (boxy, two windscreens) and Vectron (a slanted face).
  rc:      { len: 0.35, base: 0.62, k: 6, screen: [0.52, 0.86], twin: true },
  vectron: { taper: 0.08, len: 1.0, base: 0.45, k: 1.0, screen: [0.56, 0.86] },
};
const unit = (length, front, back, extra = {}) => ({ length, front, back, height: 3.4, ...extra });

export const MODELS = {
  coradia: [unit(9, null, N.coradia, { panto: 'back' }), unit(9, N.coradia, null)],
  regina:  [unit(9, null, N.regina, { panto: 'back' }), unit(9, N.regina, null)],
  dosto:   [unit(9, null, N.dosto, { height: 4.5, decks: 2 }), unit(9, N.dosto, null, { height: 4.5, decks: 2, panto: 'back' })],
  x40:     [unit(9, null, N.x40, { height: 4.5, decks: 2 }), unit(9, N.x40, null, { height: 4.5, decks: 2, panto: 'back' })],
  x31:     [unit(9, null, N.x31, { panto: 'back' }), unit(9, N.x31, null)],
  x10:     [unit(8, null, N.x10, { panto: 'back' }), unit(8, N.x10, null)],
  itino:   [unit(8, null, N.itino, { roofBoxes: [0] }), unit(8, N.itino, null, { roofBoxes: [0] })],
  x2000:   [unit(7, null, N.x2000dt), unit(6, null, null), unit(9, N.x2000, null, { panto: 'front', noWindows: true })],
  x80:     [unit(9, null, N.x80, { panto: 'back' }), unit(9, N.x80, null)],
  flirt:   [unit(9, null, N.flirt, { panto: 'back' }), unit(9, N.flirt, null)],
  c73:     [unit(9, null, N.c73), unit(9, N.c73, null, { panto: 'back' })],
  rc:      [unit(6, null, null), unit(6, null, null), unit(5.5, N.rc, N.rc, { panto: 'both', noWindows: true, vents: true, loco: true })],
  vectron: [unit(6, null, null), unit(6, null, null), unit(6, N.vectron, N.vectron, { panto: 'both', noWindows: true, loco: true })],
};

// colours: { body, skirt, band, roof, nose, windscreen, stripe, loco: { ...colours of the locomotive } }
// model: a key of MODELS. Returns a THREE.Group, the train's middle at the origin, the front towards +y.
export function buildToy({ model = 'regina', colours = {} } = {}) {
  const base = {
    body: '#d0d7de', skirt: null, band: '#1f2328', roof: null, nose: null, windscreen: '#11161c',
    bogie: '#2d333b', wheel: '#1b1f24', light: '#fff4c2', stripe: null, frame: null,
  };
  const c = { ...base, ...colours };
  c.skirt ??= c.body; c.roof ??= c.body; c.nose ??= c.body;
  const cl = { ...c, ...(colours.loco ?? {}) };
  if (colours.loco) { cl.skirt = colours.loco.skirt ?? cl.body; cl.roof = colours.loco.roof ?? cl.body; cl.nose = colours.loco.nose ?? cl.body; cl.stripe = colours.loco.stripe ?? null; cl.frame = colours.loco.frame ?? null; }

  const parts = MODELS[model] ?? MODELS.regina;
  const train = new THREE.Group();
  const total = parts.reduce((s, p) => s + p.length, 0) + GAP * (parts.length - 1);
  let y = -total / 2;
  parts.forEach((p, i) => {
    const v = vehicle(p, p.loco ? cl : c);
    v.position.y = y + p.length / 2;
    train.add(v);
    if (i < parts.length - 1) train.add(mesh(boxGeo(W - 1.0, GAP + 0.6, p.height - 1.0), c.bogie, 0, y + p.length + GAP / 2, FLOOR + p.height / 2));
    y += p.length + GAP;
  });
  train.userData.length = total;
  return train;
}
