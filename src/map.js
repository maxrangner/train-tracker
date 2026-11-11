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
    // Slide the map so this point shows above the train panel (which covers up to 45 % of the screen's bottom).
    async focus(lon, lat) {
      await ready;
      const h = map.getContainer().clientHeight;
      map.easeTo({ center: [lon, lat], padding: { top: 0, bottom: Math.round(h * 0.45) + 20, left: 0, right: 0 }, duration: 600 });
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
