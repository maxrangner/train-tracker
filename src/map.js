// The map and how trains are drawn on it. Step 1: a dot and the board number.
import { Map, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);

// OpenFreeMap: free, no key. Positron is their calm grey style, so the dots stand out.
const STYLE = 'https://tiles.openfreemap.org/styles/positron';

export function createMap(container) {
  const map = new Map({
    container,
    style: STYLE,
    center: [16.5, 62.5],   // middle of Sweden
    zoom: 4.3,
    attributionControl: { compact: true },
  });

  const ready = new Promise(resolve => map.on('load', () => {
    map.addSource('trains', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'train-dots',
      type: 'circle',
      source: 'trains',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 7],
        'circle-color': ['case', ['>', ['coalesce', ['get', 'speed'], 0], 0], '#1f6feb', '#d1242f'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
      },
    });
    map.addLayer({
      id: 'train-numbers',
      type: 'symbol',
      source: 'trains',
      minzoom: 6,
      layout: {
        'text-field': ['get', 'number'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
      },
      paint: { 'text-color': '#1b1f24', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
    resolve();
  }));

  // Redraw at most twice a second, however fast reports arrive.
  let pending = null;
  let timer = null;
  return {
    ready,
    setTrains(geojson) {
      pending = geojson;
      if (timer) return;
      timer = setTimeout(async () => {
        timer = null;
        await ready;
        map.getSource('trains').setData(pending);
      }, 500);
    },
  };
}
