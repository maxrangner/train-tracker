// The 3D trains, drawn into the map with three.js (a MapLibre "custom layer").
// Shown from modelZoom() in; further out the dots carry the map (groups and icons come in step 5).
import * as THREE from 'three';
import { MercatorCoordinate } from 'maplibre-gl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildTrain } from './train-model.js';
import { styleFor } from './brands.js';
import { buildToy } from './toy-trains.js';
import { toyFor } from './toy-brands.js';
import { settings } from './settings.js';
import { modelScale } from './model-size.js';

// Toy or real-size trains, the toy size and from which zoom: src/settings.js, read when used. A change of toy or real
// makes the map add a new layer (map.js), whose trains are then built the new way.
export const isToy = () => settings.trainStyle === 'toy';
// 'symbol': never a model, the dot or triangle at every zoom (Max, 2026-11-14: "Add toggle to never show 3d model.
// Only dot/triangle"). modelZoom() stays 13 then: the close-in labels and station names change over there as with
// real-size trains.
export const symbolOnly = () => settings.trainStyle === 'symbol';
export const modelZoom = () => (isToy() ? settings.toyZoom : 13);
// Whether trains are drawn as models at this zoom.
export const modelsAt = zoom => !symbolOnly() && zoom >= modelZoom();
const EARTH = 40075016.686;   // metres round the equator

// Kept for as long as the page lives, shared by every layer made (a settings change makes a new layer, map.js):
// one three.js renderer per map canvas, and each model built once per look. A new renderer and new models per
// layer were never given back: 50 settings changes left 13,736 graphics buffers where there had been 786
// (measured 2026-11-13).
const renderers = new WeakMap();   // the map's WebGL context -> its three.js renderer
const built = new Map();           // 'toy|<key>' or 'real|<key>' -> a built train to clone
const faded = new Map();           // a model's paint -> its see-through copy, for grey trains

// Join each car's parts that share a paint into one part. A model is built from many small shapes (a realistic
// SL Pendeltåg: 97, an SJ night train: 127), and every one was drawn by itself, every frame, for every train on
// screen. The triangles and paints stay exactly the same, so the picture does too; the builders (train-model.js,
// toy-trains.js) and tools/models-check.mjs, which looks at the parts one by one, are not touched.
function joinParts(train) {
  train.updateMatrixWorld(true);
  for (const car of train.children) {
    if (car.isMesh) continue;   // one part already (the piece between two cars)
    const parts = [];
    let odd = false;            // anything that isn't a plain part or a group of parts: leave the car as built
    car.traverse((o) => { if (o.isMesh) parts.push(o); else if (o !== car && !o.isGroup) odd = true; });
    if (odd || parts.length < 2) continue;
    const toCar = car.matrixWorld.clone().invert(), byPaint = new Map();
    for (const p of parts) {
      const place = new THREE.Matrix4().multiplyMatrices(toCar, p.matrixWorld);
      if (place.determinant() < 0) { odd = true; break; }   // a mirrored part would turn inside out
      const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);   // colour: the faceted trains paint by corner
      g.applyMatrix4(place);
      (byPaint.get(p.material) ?? byPaint.set(p.material, []).get(p.material)).push(g);
    }
    if (odd) continue;
    const joined = [];
    for (const [paint, shapes] of byPaint) {
      const g = shapes.length > 1 ? mergeGeometries(shapes) : shapes[0];
      if (!g) { odd = true; break; }
      joined.push(new THREE.Mesh(g, paint));
    }
    if (odd) continue;
    car.clear();
    car.add(...joined);
  }
}

// getTrains() -> [{ id, lon, lat, bearing (compass degrees), brand, stale }] at the moment being drawn.
// selection() -> { id, colour, faded } for the selected train, or null: a ring on the ground round its model, under it
// (Max, 2026-11-15: "the ring around the train should be underneath the model, not on top"), as wide as the model is
// long as drawn, plus RING_MARGIN_PX; RING_PX thick, as the ring further out.
// along(id, d) -> { lon, lat } d metres along the train's track from its drawn place (+ ahead), or null: each car
// is set on the track there, so a train bends round a curve (without it, or where it gives null, the train is
// drawn straight).
const RING_MARGIN_PX = 8, RING_PX = 2.5;
// At most this many car shadows at once (far more cars than a screen shows close in).
const SHADOW_MAX = 1500;
// A soft dark patch, darkest in the middle, gone at its edge (drawn once, shared by every layer).
let shadowTexture = null;
const shadowPaint = () => {
  if (!shadowTexture) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    shadowTexture = new THREE.CanvasTexture(cv);
  }
  return new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false });
};
export function createTrainLayer({ getTrains, along = null, selection = null }) {
  let map, renderer, scene, camera;
  // The selected train's ring: a flat ring of radius 1 on the ground, scaled to the model. Its thickness is a share of
  // the radius, so a new shape is made only when that share changes by half a percent.
  let ring = null, ringShare = null;
  let shadows = null;
  const ringPaint = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide });
  const TOY = isToy();   // fixed for this layer
  const shown = new Map();        // id -> { object, brand }
  // Each drawn train's outline on the ground: id -> { lon, lat, bearing, length, width } in metres, the middle at
  // lon/lat (map.js: a tap anywhere on the model opens the train); cars: where each car lies when the train is bent
  // along its track (bend below), else null.
  const outlines = new Map();
  // brand -> a built train to clone (clones share shapes and paint); kept in `built` for the layers after this one
  const templates = { has: key => built.has(`${TOY ? 'toy' : 'real'}|${key}`), get: key => built.get(`${TOY ? 'toy' : 'real'}|${key}`),
    set: (key, train) => built.set(`${TOY ? 'toy' : 'real'}|${key}`, train) };

  // A stale train (silent for a while, or no data at all) is drawn plain grey and see-through, in its own shape
  // (Max, 2026-11-13; it used to turn into the plain three-car model, so an eight-car train shrank when it went
  // grey): its company's model in the plain model's colours, with its own copies of the materials, so the shared
  // ones in train-model.js stay as they are.
  const STALE = '\0stale';
  const keyOf = t => (t.stale ? STALE : '') + (t.brand ?? '');
  const templateFor = (key) => {
    if (!templates.has(key)) {
      const stale = key.startsWith(STALE), brand = (stale ? key.slice(STALE.length) : key) || null;
      const style = TOY ? toyFor(brand) : styleFor(brand);
      const plain = TOY ? toyFor(null) : styleFor(null);
      // Realistic trains: the company's own train model (toy-brands.js says which), in its realistic paint (brands.js).
      const train = TOY ? buildToy(stale ? { ...style, colours: plain.colours } : style)
        : buildTrain({ ...(stale ? { ...style, colours: plain.colours } : style), model: toyFor(brand).model });
      joinParts(train);
      if (stale) {
        train.traverse((o) => {
          if (!o.isMesh) return;
          if (!faded.has(o.material)) faded.set(o.material, Object.assign(o.material.clone(), { transparent: true, opacity: 0.4, depthWrite: false }));
          o.material = faded.get(o.material);
        });
      }
      // Each car (a child of the model): where it sits and how far it reaches along the train, for bending.
      train.updateMatrixWorld(true);
      for (const c of train.children) {
        const box = new THREE.Box3().setFromObject(c);
        c.userData.p0 = c.position.toArray();
        c.userData.span = [box.min.y, box.max.y];
      }
      const size = new THREE.Box3().setFromObject(train).getSize(new THREE.Vector3());
      train.userData.width = size.x;
      train.userData.length ??= size.y;   // the realistic models don't say; measured (front towards +y)
      templates.set(key, train);
    }
    return templates.get(key);
  };

  // Set each car of train t's model on the track: its middle where the track is at its place along the train, turned
  // to face from its back end to its front end along the track. k: the model's enlargement (model-size.js). The
  // model itself isn't turned then; its cars carry the direction. False when the track isn't known far enough back;
  // otherwise where each car lies on the ground, [back lon, back lat, front lon, front lat] (for taps, map.js).
  const R = Math.PI / 180, M = 111195;
  // A train's own lift, in metres at real size: 0 to 6 steps of 5 cm, fixed by its id.
  const LIFT_M = 0.05, LIFT_STEPS = 7;
  const liftOf = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % LIFT_STEPS) * LIFT_M; };
  function bend(object, t, k) {
    if (!along) return false;
    const kx = Math.cos(t.lat * R);
    const placed = [], cars = [];
    for (const c of object.children) {
      const y0 = c.userData.p0[1], [b, f] = c.userData.span;
      const mid = along(t.id, y0 * k), back = along(t.id, b * k), front = along(t.id, f * k);
      if (!mid || !back || !front) return false;
      const dx = (front.lon - back.lon) * kx, dy = front.lat - back.lat;
      cars.push([back.lon, back.lat, front.lon, front.lat]);
      placed.push([c, ((mid.lon - t.lon) * kx * M) / k, ((mid.lat - t.lat) * M) / k,
        dx || dy ? Math.atan2(dx, dy) : (t.bearing ?? 0) * R]);
    }
    object.rotation.z = 0;
    for (const [c, x, y, heading] of placed) {
      c.position.set(x, y, c.userData.p0[2]);
      c.rotation.z = -heading;
    }
    return cars;
  }

  return {
    id: 'trains-3d',
    type: 'custom',
    outlines: () => outlines,
    renderingMode: '3d',

    onAdd(m, gl) {
      map = m;
      camera = new THREE.Camera();
      scene = new THREE.Scene();
      // A warm sun from the south-west and above, and the sky's light from straight above with a warmer bounce from
      // the ground (2026-11-18, the faceted trains: roofs, sides and noses read apart). Until then the sky light came
      // from the side (three.js's own "up" is y; the map's is z).
      const sun = new THREE.DirectionalLight(0xfff6ea, 2.0);
      sun.position.set(-0.6, -0.8, 1.2);
      const sky = new THREE.HemisphereLight(0xf2f5ff, 0xa1978a, 1.5);
      sky.position.set(0, 0, 1);
      scene.add(sun, sky);
      // The soft shadows under the cars: one flat, blurred patch per car, all drawn in one go (one instanced part).
      shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), shadowPaint(), SHADOW_MAX);
      shadows.count = 0;
      shadows.frustumCulled = false;
      shadows.renderOrder = -2;   // first: under the ring and the models
      scene.add(shadows);
      ring = new THREE.Mesh(new THREE.BufferGeometry(), ringPaint);
      ring.visible = false;
      ring.renderOrder = -1;   // before the models; they cover it where they lie over it
      scene.add(ring);
      renderer = renderers.get(gl);
      if (!renderer) {
        renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
        renderer.autoClear = false;
        renderers.set(gl, renderer);
      }
      // For checks (tools, dev mode only): how many separate parts and triangles the last frame drew.
      if (import.meta.env.DEV) window.__3d = { calls: () => renderer.info.render.calls, triangles: () => renderer.info.render.triangles };
    },

    // The layer is taken off the map (a settings change): its trains leave the scene. The renderer and the built
    // models stay for the next layer. The ring is this layer's own, so its shape and paint are let go.
    onRemove() {
      for (const entry of shown.values()) scene.remove(entry.object);
      shown.clear();
      outlines.clear();
      if (ring) {
        scene.remove(ring);
        ring.geometry.dispose();
        ring = null;
        ringShare = null;
      }
      ringPaint.dispose();
      if (shadows) { scene.remove(shadows); shadows.geometry.dispose(); shadows.dispose(); shadows = null; }
    },

    render(gl, args) {
      const zoom = map.getZoom();
      const wanted = new Set();
      if (modelsAt(zoom)) {
        // Everything is placed relative to the middle of the view, in metres: x east, y north, z up.
        const origin = MercatorCoordinate.fromLngLat(map.getCenter(), 0);
        const s = origin.meterInMercatorCoordinateUnits();
        // How much each model is enlarged: src/model-size.js (metres per pixel at this zoom).
        const metresPerPx = EARTH * Math.cos(map.getCenter().lat * Math.PI / 180) / (512 * 2 ** zoom);
        const b = map.getBounds();
        const padLon = (b.getEast() - b.getWest()) * 0.2, padLat = (b.getNorth() - b.getSouth()) * 0.2;

        for (const t of getTrains()) {
          if (t.lon < b.getWest() - padLon || t.lon > b.getEast() + padLon ||
              t.lat < b.getSouth() - padLat || t.lat > b.getNorth() + padLat) continue;
          wanted.add(t.id);
          let entry = shown.get(t.id);
          const key = keyOf(t);
          if (!entry || entry.key !== key) {
            if (entry) scene.remove(entry.object);
            entry = { object: templateFor(key).clone(), key };
            shown.set(t.id, entry);
            scene.add(entry.object);
          }
          const m = MercatorCoordinate.fromLngLat([t.lon, t.lat], 0);
          const k = modelScale({ toy: TOY, zoom, metresPerPx, length: entry.object.userData.length, s: settings });
          // Lifted a few centimetres (times its enlargement) by its id: two models that overlap where trains meet
          // no longer share a height, so their surfaces don't flicker against each other (Max, 2026-11-16).
          entry.object.position.set((m.x - origin.x) / s, -(m.y - origin.y) / s, liftOf(t.id) * k);
          entry.object.scale.setScalar(k);
          const cars = bend(entry.object, t, k);
          if (!cars) {
            entry.object.rotation.z = -THREE.MathUtils.degToRad(t.bearing ?? 0);
            for (const c of entry.object.children) { c.position.fromArray(c.userData.p0); c.rotation.z = 0; }
          }
          outlines.set(t.id, { lon: t.lon, lat: t.lat, bearing: t.bearing ?? 0,
            length: entry.object.userData.length * k, width: (templateFor(key).userData.width ?? 3) * k, cars: cars || null });
        }

        // The shadows: one under each car, as long as the car, a little wider, where the car is (bent trains too).
        if (shadows) {
          let n = 0;
          const one = new THREE.Matrix4(), local = new THREE.Matrix4();
          for (const id of wanted) {
            const entry = shown.get(id);
            if (!entry) continue;
            entry.object.updateMatrixWorld(true);
            const w = entry.object.userData.width ?? 3;
            for (const c of entry.object.children) {
              if (n >= SHADOW_MAX) break;
              const [y0, y1] = c.userData.span, cy = (y0 + y1) / 2 - c.userData.p0[1];
              local.makeScale(w + 1.6, y1 - y0 + 1.4, 1).setPosition(0, cy, 0.03);
              shadows.setMatrixAt(n++, one.multiplyMatrices(c.matrixWorld, local));
            }
          }
          shadows.count = n;
          shadows.instanceMatrix.needsUpdate = true;
        }

        // The selected train's ring, on the ground under its model.
        const sel = selection?.(), o = sel && shown.has(sel.id) ? outlines.get(sel.id) : null;
        if (o) {
          const radius = o.length / 2 + RING_MARGIN_PX * metresPerPx;
          const share = Math.min(0.5, Math.round(RING_PX * metresPerPx / radius * 200) / 200);
          if (share !== ringShare) {
            ringShare = share;
            ring.geometry.dispose();
            ring.geometry = new THREE.RingGeometry(1 - share, 1, 96);
          }
          ring.position.copy(shown.get(sel.id).object.position).setZ(0.05);
          ring.scale.setScalar(radius);
          ringPaint.color.set(sel.colour);
          ringPaint.opacity = sel.faded ? 0.45 : 1;
          ring.visible = true;
        } else ring.visible = false;

        const toMap = new THREE.Matrix4()
          .makeTranslation(origin.x, origin.y, origin.z)
          .scale(new THREE.Vector3(s, -s, s));
        camera.projectionMatrix = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix).multiply(toMap);
      }
      for (const [id, entry] of shown) if (!wanted.has(id)) { scene.remove(entry.object); shown.delete(id); }
      for (const id of outlines.keys()) if (!wanted.has(id)) outlines.delete(id);
      if (!shown.size) return;
      renderer.resetState();
      renderer.render(scene, camera);
    },
  };
}
