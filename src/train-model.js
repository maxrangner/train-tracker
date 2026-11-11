// One simple, realistic-but-simplified train, built from a few shapes: cars with a window band, a light roof,
// a sloped cab nose with a dark windscreen at each end, bogies and headlights. Flat colours, no textures.
//
// Model space: metres, x = across (right), y = along the train (+y = the front), z = up. The rails are at z = 0.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const W = 3.1;          // body width
const FLOOR = 1.0;      // bottom of the body above the rails
const TOP = 4.2;        // top of the body
const NOSE = 3.4;       // length of the sloped cab nose
const GAP = 0.8;        // gap between cars

// Shape (u along the train, v up) extruded across the width, turned into model space.
const toModel = new THREE.Matrix4().set(
  0, 0, 1, 0,   // x' = extrusion (width)
  1, 0, 0, 0,   // y' = u (length)
  0, 1, 0, 0,   // z' = v (height)
  0, 0, 0, 1);
function profile(points, width) {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  g.applyMatrix4(toModel);
  g.translate(-width / 2, 0, 0);
  return g;
}

const box = (w, l, h, r = 0) => (r ? new RoundedBoxGeometry(w, l, h, 2, r) : new THREE.BoxGeometry(w, l, h));

// The nose, from u = 0 (joins the car) to u = NOSE (the very front).
const noseGeometry = profile([[0, FLOOR], [NOSE, FLOOR], [NOSE, 2.3], [1.3, TOP], [0, TOP]], W);
const noseSkirt = profile([[0, FLOOR], [NOSE, FLOOR], [NOSE, 1.75], [0, 1.75]], W + 0.02);
// The windscreen: a thin dark slab lying on the slope from (1.3, TOP) to (NOSE, 2.3).
const windscreenGeometry = (() => {
  const a = [1.3, TOP], b = [NOSE, 2.3];
  const d = [b[0] - a[0], b[1] - a[1]], len = Math.hypot(...d);
  const n = [-d[1] / len * 0.06, d[0] / len * 0.06].map(x => -x);   // outward from the slope
  const p = t => [a[0] + d[0] * t, a[1] + d[1] * t];
  const p1 = p(0.08), p2 = p(0.62);
  return profile([p1, p2, [p2[0] + n[0], p2[1] + n[1]], [p1[0] + n[0], p1[1] + n[1]]], W - 0.5);
})();

const materials = new Map();
const mat = (color) => {
  if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  return materials.get(color);
};

// colours: { body, skirt, band, roof, nose, windscreen, stripe } (any left out fall back to sensible ones;
// no stripe unless given)
// cars: how many cars. Returns a THREE.Group, the train's middle at the origin, the front towards +y.
export function buildTrain({ colours = {}, cars = 3, carLength = 25 } = {}) {
  const c = {
    body: '#d0d7de', skirt: null, band: '#1f2328', roof: '#eef1f4', nose: null, windscreen: '#11161c',
    bogie: '#2d333b', light: '#fff4c2', ...colours,
  };
  c.skirt ??= c.body;
  c.nose ??= c.body;

  const train = new THREE.Group();
  const total = cars * carLength + (cars - 1) * GAP;
  for (let i = 0; i < cars; i++) {
    const car = new THREE.Group();
    const first = i === cars - 1, last = i === 0;              // the front car is the one at +y
    const front = first ? NOSE : 0, back = last ? NOSE : 0;     // room taken by noses at the ends
    const bodyLen = carLength - front - back;
    const mid = (back - front) / 2;                              // the straight body's centre within the car

    const body = new THREE.Mesh(box(W, bodyLen, TOP - FLOOR, 0.25), mat(c.body));
    body.position.set(0, mid, (FLOOR + TOP) / 2);
    const skirt = new THREE.Mesh(box(W + 0.02, bodyLen, 0.75), mat(c.skirt));
    skirt.position.set(0, mid, FLOOR + 0.375);
    const band = new THREE.Mesh(box(W + 0.04, bodyLen - 1.2, 1.0), mat(c.band));
    band.position.set(0, mid, 2.75);
    const roof = new THREE.Mesh(box(W - 0.5, bodyLen - 0.4, 0.3, 0.12), mat(c.roof));
    roof.position.set(0, mid, TOP + 0.1);
    car.add(body, skirt, band, roof);
    // An optional thin stripe along the side, just under the windows (e.g. Öresundståg's orange line).
    if (c.stripe) {
      const stripe = new THREE.Mesh(box(W + 0.05, bodyLen, 0.22), mat(c.stripe));
      stripe.position.set(0, mid, 2.0);
      car.add(stripe);
    }
    // Pillars between the windows: thin strips of body colour across the band, about every 2.6 m.
    const bandLen = bodyLen - 1.2, n = Math.max(2, Math.round(bandLen / 2.6));
    for (let k = 1; k < n; k++) {
      const pillar = new THREE.Mesh(box(W + 0.07, 0.35, 1.0), mat(c.body));
      pillar.position.set(0, mid - bandLen / 2 + k * bandLen / n, 2.75);
      car.add(pillar);
    }
    // A dark gangway to the next car.
    if (!first) {
      const gangway = new THREE.Mesh(box(W - 0.8, GAP + 0.4, TOP - FLOOR - 0.6), mat(c.bogie));
      gangway.position.set(0, carLength / 2 + GAP / 2, (FLOOR + TOP) / 2);
      car.add(gangway);
    }

    for (const end of [first && 1, last && -1].filter(Boolean)) {
      const nose = new THREE.Group();
      nose.add(new THREE.Mesh(noseGeometry, mat(c.nose)),
        new THREE.Mesh(noseSkirt, mat(c.skirt)),
        new THREE.Mesh(windscreenGeometry, mat(c.windscreen)));
      for (const x of [-0.95, 0.95]) {
        const l = new THREE.Mesh(box(0.45, 0.08, 0.3), mat(c.light));
        l.position.set(x, NOSE + 0.02, 1.95);
        nose.add(l);
      }
      nose.position.y = end * (carLength / 2 - NOSE);
      if (end < 0) nose.rotation.z = Math.PI;                    // the back nose faces backwards
      car.add(nose);
    }
    for (const y of [-carLength / 2 + 3, carLength / 2 - 3]) {
      const bogie = new THREE.Mesh(box(2.4, 3.0, 0.8), mat(c.bogie));
      bogie.position.set(0, y, 0.55);
      car.add(bogie);
    }
    car.position.y = -total / 2 + carLength / 2 + i * (carLength + GAP);
    train.add(car);
  }
  return train;
}
