// The map and how trains are drawn on it.
// Step 1: a dot per train. Step 2: rail lines from two sources, one shown at a time. Step 3: number + minutes off,
// the dot's colour from the minutes off. The dots glide (positions come from trains.js at each frame).
import { Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import { createTrainLayer, MIN_ZOOM as MODEL_ZOOM } from './trains-3d.js';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);

// OpenFreeMap: free, no key. Positron is their calm grey style, so the lines and dots stand out.
const STYLE = 'https://tiles.openfreemap.org/styles/positron';

export const RAIL_SOURCES = {
  trv: { name: 'Trafikverket', url: '/rail-trv.geojson', color: '#6e7781' },
  osm: { name: 'OpenStreetMap', url: '/rail-osm.geojson', color: '#8250df' },
};

// getTrains3d() -> the trains to draw as 3D models (see trains-3d.js).
export function createMap(container, { onTrainTap, getTrains3d } = {}) {
  const map = new Map({
    container,
    style: STYLE,
    center: [16.5, 62.5],   // middle of Sweden
    zoom: 4.3,
    hash: 'view',           // the view is kept in the address (#view=zoom/lat/lon/bearing/tilt), so a link opens the same view
    maxPitch: 70,
    attributionControl: { compact: true },
  });
  // Zoom buttons and a compass: tap the compass to turn north up and the view flat again; it leans with the tilt.
  map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

  if (import.meta.env.DEV) window.__map = map;   // lets tools/shot.mjs find and tap a train; not in a build

  const ready = new Promise(resolve => map.on('load', () => {
    // Rail lines first, so they sit under the trains. Each source is its own layer; loaded when first shown.
    for (const [id, s] of Object.entries(RAIL_SOURCES)) {
      map.addSource(`rail-${id}`, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: `rail-${id}`,
        type: 'line',
        source: `rail-${id}`,
        layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': s.color,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 8, 1.2, 14, 3],
        },
      });
    }

    map.addSource('trains', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // A ring around the tapped train, under its dot.
    map.addLayer({
      id: 'train-selected',
      type: 'circle',
      source: 'trains',
      filter: ['==', ['get', 'id'], ''],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 8, 10, 13],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#1b1f24',
        'circle-stroke-width': 2.5,
      },
    });
    map.addLayer({
      id: 'train-dots',
      type: 'circle',
      source: 'trains',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 7],
        // Minutes off timetable: green on time (+2 or less), yellow +3 to +5, red +6 or more, grey not known yet.
        'circle-color': ['match', ['get', 'late'], 'ontime', '#1a7f37', 'some', '#d4a72c', 'late', '#d1242f', '#8c959f'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
        // From MODEL_ZOOM in, the 3D trains take over; the dots stay (invisible) so a tap still finds the train.
        'circle-opacity': ['step', ['zoom'], 1, MODEL_ZOOM, 0],
        'circle-stroke-opacity': ['step', ['zoom'], 1, MODEL_ZOOM, 0],
      },
    });
    if (getTrains3d) map.addLayer(createTrainLayer({ getTrains: getTrains3d }));
    map.addLayer({
      id: 'train-labels',
      type: 'symbol',
      source: 'trains',
      minzoom: 6,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
      },
      paint: { 'text-color': '#1b1f24', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });

    // Tapping a train: a generous hit area, since dots are small on a phone.
    map.on('click', (e) => {
      const pad = 12;
      const hits = map.queryRenderedFeatures(
        [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers: ['train-dots'] });
      onTrainTap?.(hits[0]?.properties.id ?? null);
    });
    map.on('mouseenter', 'train-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'train-dots', () => { map.getCanvas().style.cursor = ''; });
    resolve();
  }));

  // ---- Following a train ----
  let following = null;       // { getPlace, onEnd, locked }
  let lastTick = 0;
  const pointers = new Set(); // fingers (or the mouse button) down on the map
  const box = map.getContainer();
  box.addEventListener('pointerdown', e => pointers.add(e.pointerId), true);
  for (const type of ['pointerup', 'pointercancel'])
    window.addEventListener(type, e => pointers.delete(e.pointerId), true);
  window.addEventListener('blur', () => pointers.clear());   // a release outside the window is never seen
  // How far (in screen pixels) a place is from the point the camera keeps the train at.
  const offFocus = (p) => {
    const at = map.project([p.lon, p.lat]), c = map.project(map.getCenter());
    return Math.hypot(at.x - c.x, at.y - c.y);
  };
  // While following, a zoom (wheel or pinch) zooms around the train rather than around the fingers.
  function zoomAroundCenter(on) {
    map.scrollZoom.enable(on ? { around: 'center' } : undefined);
    map.touchZoomRotate.enable(on ? { around: 'center' } : undefined);
  }
  function stopFollowing() {
    const end = following?.onEnd;
    following = null;
    zoomAroundCenter(false);
    end?.();
  }
  // After the user has moved the map: if the train is now far from the middle, they went to look elsewhere.
  let userMoved = false;
  map.on('movestart', (e) => { if (e.originalEvent) userMoved = true; });
  map.on('moveend', () => {
    if (!userMoved) return;
    userMoved = false;
    const p = following?.getPlace();
    if (!p) return;
    const { clientWidth: w, clientHeight: h } = box;
    if (offFocus(p) > 0.25 * Math.min(w, h * 0.55)) stopFollowing();
  });
  // Change the room kept free at the screen's edges, keeping the map still: the camera's new middle is the place
  // already showing there.
  function setPadding(padding) {
    const { clientWidth: w, clientHeight: h } = box;
    const at = map.unproject([(w + padding.left - padding.right) / 2, (h + padding.top - padding.bottom) / 2]);
    map.jumpTo({ center: at, padding });
  }

  const loaded = new Set();
  let shownRail = null;

  let isReady = false;
  ready.then(() => { isReady = true; });
  return {
    ready,
    // Called every animation frame with the trains where they are now.
    setTrains(geojson) {
      if (isReady) map.getSource('trains').setData(geojson);
    },
    // Tilt the view (55°) or lay it flat again.
    toggleTilt() {
      map.easeTo({ pitch: map.getPitch() > 5 ? 0 : 55, duration: 700 });
    },
    get tilted() { return map.getPitch() > 5; },
    onViewChange(fn) { map.on('pitchend', fn); },
    // Follow a train: keep it in the middle of the view above the train panel (which covers up to 45 % of the
    // screen's bottom). getPlace() -> { lon, lat } where the train is drawn now, or null when it is gone.
    // Zoom, turn and tilt stay the user's. Dragging the map far from the train stops following; a small nudge or a
    // pinch doesn't. onEnd() is called when following stops by itself (dragged away, or the train is gone).
    async follow(getPlace, onEnd) {
      await ready;
      const h = map.getContainer().clientHeight;
      setPadding({ top: 0, bottom: Math.round(h * 0.45) + 20, left: 0, right: 0 });
      following = { getPlace, onEnd, locked: false };
      zoomAroundCenter(true);
    },
    unfollow() { following = null; zoomAroundCenter(false); },
    get following() { return Boolean(following); },
    // Called every drawing frame: move the camera along with the followed train.
    tick(now) {
      const dt = Math.min(now - lastTick, 200);
      lastTick = now;
      if (!following || !isReady) return;
      // Moving the camera cancels any gesture just starting, so keep still while a finger or the mouse is down,
      // and during the map's own animations (the Tilt button, the compass, a wheel zoom, a fling).
      if (pointers.size || map.isMoving()) { following.locked = false; return; }
      const p = following.getPlace();
      if (!p) return stopFollowing();
      const off = offFocus(p);
      if (following.locked && off < 30) { map.jumpTo({ center: [p.lon, p.lat] }); return; }
      // Not on it yet (just tapped, or the train jumped): glide over in about half a second, then stay locked on.
      if (off < 1) { following.locked = true; map.jumpTo({ center: [p.lon, p.lat] }); return; }
      const c = map.getCenter(), k = 1 - Math.exp(-dt / 150);
      map.jumpTo({ center: [c.lng + (p.lon - c.lng) * k, c.lat + (p.lat - c.lat) * k] });
    },
    // Take the room kept for the panel away again, without moving what is on screen.
    async unpad() {
      await ready;
      setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    },
    // Ring the train with this id (null: none).
    async select(id) {
      await ready;
      map.setFilter('train-selected', ['==', ['get', 'id'], id ?? '']);
    },
    // Show one set of rail lines (a key of RAIL_SOURCES), or none (null).
    async showRail(id) {
      await ready;
      shownRail = id;
      for (const key of Object.keys(RAIL_SOURCES))
        map.setLayoutProperty(`rail-${key}`, 'visibility', key === id ? 'visible' : 'none');
      if (id && !loaded.has(id)) {
        loaded.add(id);
        map.getSource(`rail-${id}`).setData(RAIL_SOURCES[id].url);
      }
    },
    get shownRail() { return shownRail; },
  };
}
