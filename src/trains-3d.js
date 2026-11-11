// The 3D trains, drawn into the map with three.js (a MapLibre "custom layer").
// Shown from MIN_ZOOM in; further out the dots carry the map (groups and icons come in step 5).
import * as THREE from 'three';
import { MercatorCoordinate } from 'maplibre-gl';
import { buildTrain } from './train-model.js';
import { styleFor } from './brands.js';

export const MIN_ZOOM = 13;

// getTrains() -> [{ id, lon, lat, bearing (compass degrees), brand }] at the moment being drawn.
export function createTrainLayer({ getTrains }) {
  let map, renderer, scene, camera;
  const shown = new Map();        // id -> { object, brand }
  const templates = new Map();    // brand -> a built train to clone (clones share shapes and paint)

  const templateFor = (brand) => {
    const key = brand ?? '';
    if (!templates.has(key)) templates.set(key, buildTrain(styleFor(brand)));
    return templates.get(key);
  };

  return {
    id: 'trains-3d',
    type: 'custom',
    renderingMode: '3d',

    onAdd(m, gl) {
      map = m;
      camera = new THREE.Camera();
      scene = new THREE.Scene();
      // Light from the south-west and above, plus a soft fill, so sides and roofs read differently.
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(-0.6, -0.8, 1.2);
      scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.3));
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },

    render(gl, args) {
      const zoom = map.getZoom();
      const wanted = new Set();
      if (zoom >= MIN_ZOOM) {
        // Everything is placed relative to the middle of the view, in metres: x east, y north, z up.
        const origin = MercatorCoordinate.fromLngLat(map.getCenter(), 0);
        const s = origin.meterInMercatorCoordinateUnits();
        const b = map.getBounds();
        const padLon = (b.getEast() - b.getWest()) * 0.2, padLat = (b.getNorth() - b.getSouth()) * 0.2;

        for (const t of getTrains()) {
          if (t.lon < b.getWest() - padLon || t.lon > b.getEast() + padLon ||
              t.lat < b.getSouth() - padLat || t.lat > b.getNorth() + padLat) continue;
          wanted.add(t.id);
          let entry = shown.get(t.id);
          if (!entry || entry.brand !== t.brand) {
            if (entry) scene.remove(entry.object);
            entry = { object: templateFor(t.brand).clone(), brand: t.brand };
            shown.set(t.id, entry);
            scene.add(entry.object);
          }
          const m = MercatorCoordinate.fromLngLat([t.lon, t.lat], 0);
          entry.object.position.set((m.x - origin.x) / s, -(m.y - origin.y) / s, 0);
          entry.object.rotation.z = -THREE.MathUtils.degToRad(t.bearing ?? 0);
        }

        const toMap = new THREE.Matrix4()
          .makeTranslation(origin.x, origin.y, origin.z)
          .scale(new THREE.Vector3(s, -s, s));
        camera.projectionMatrix = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix).multiply(toMap);
      }
      for (const [id, entry] of shown) if (!wanted.has(id)) { scene.remove(entry.object); shown.delete(id); }
      if (!shown.size) return;
      renderer.resetState();
      renderer.render(scene, camera);
    },
  };
}
