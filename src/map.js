// The map and how trains are drawn on it.
// Step 1: a dot per train. Step 2: rail lines from two sources, one shown at a time. Step 3: number + minutes off,
// the dot's colour from the minutes off. The dots glide (positions come from trains.js at each frame).
import { Map, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import { createTrainLayer, MIN_ZOOM as MODEL_ZOOM, TOY } from './trains-3d.js';
import { settings } from './settings.js';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);

// OpenFreeMap: free, no key. Positron is their calm grey style, so the lines and dots stand out.
const STYLE = 'https://tiles.openfreemap.org/styles/positron';

export const RAIL_SOURCES = {
  // Trafikverket's lines come from the rail network the trains follow (public/rail-net.json, 1.7 MB instead of
  // the 11 MB rail-trv.geojson), handed over by main.js as railData.trv.
  trv: { name: 'Trafikverket', color: '#6e7781' },
  osm: { name: 'OpenStreetMap', url: '/rail-osm.geojson', color: '#8250df' },
};

// A dot's opacity: grey trains faded; none from MODEL_ZOOM in (3D trains) or for the selected train (its marker).
const dotOpacity = sel => ['step', ['zoom'],
  ['case', ['==', ['get', 'id'], sel], 0, ['get', 'stale'], 0.4, 1], MODEL_ZOOM, 0];

// getTrains3d() -> the trains to draw as 3D models (see trains-3d.js).
// railData: { [rail source id]: () => Promise<GeoJSON> } for rail lines that don't come from a url.
// onStationTap(sig): a station was tapped (and no train).
export function createMap(container, { onTrainTap, onStationTap, getTrains3d, railData = {} } = {}) {
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

    // The open train's path (setPath): the part still ahead in blue, the part travelled grey, its stops as rings.
    map.addSource('path', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'path-casing', type: 'line', source: 'path', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 5, 14, 11] } });
    map.addLayer({ id: 'path-line', type: 'line', source: 'path', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['match', ['get', 'part'], 'ahead', '#1f6feb', '#9aa3ad'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3, 14, 7] } });
    map.addLayer({ id: 'path-stops', type: 'circle', source: 'path', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 14, 6], 'circle-color': '#ffffff',
        'circle-stroke-color': ['match', ['get', 'part'], 'ahead', '#1f6feb', '#9aa3ad'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 14, 3] } });

    // Passenger stations (setStations): a small ring from zoom 9, the name from zoom 11, under the trains.
    map.addSource('stations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'station-dots',
      type: 'circle',
      source: 'stations',
      minzoom: 9,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 6],
        'circle-color': '#ffffff',
        'circle-stroke-color': '#3d444d',
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 2],
      },
    });
    map.addLayer({
      id: 'station-names',
      type: 'symbol',
      source: 'stations',
      minzoom: 11,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-offset': [0, -1.1],
        'text-anchor': 'bottom',
        'text-optional': true,
      },
      paint: { 'text-color': '#3d444d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });

    map.addSource('trains', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'train-dots',
      type: 'circle',
      source: 'trains',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 7],
        // Minutes off timetable: green on time (+2 or less), yellow +3 to +5, red +6 or more, grey not known yet.
        // A stale train (silent for 2 minutes, or no data at all) is grey and faded.
        'circle-color': ['case', ['get', 'stale'], '#8c959f',
          ['match', ['get', 'late'], 'ontime', '#1a7f37', 'some', '#d4a72c', 'late', '#d1242f', '#8c959f']],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
        // From MODEL_ZOOM in, the 3D trains take over; the dots stay (invisible) so a tap still finds the train.
        // The selected train's dot is invisible too: it is drawn by the selection marker (below).
        'circle-opacity': dotOpacity(''),
        'circle-stroke-opacity': dotOpacity(''),
      },
    });
    if (getTrains3d) map.addLayer(createTrainLayer({ getTrains: getTrains3d }));
    map.addLayer({
      id: 'train-labels',
      type: 'symbol',
      source: 'trains',
      minzoom: 6,
      layout: {
        // From the zoom where the trains are drawn as models, the company goes above the number and lateness
        // (Max, 2026-11-12: a label is company, train number and on time). Further out just the number.
        'text-field': ['step', ['zoom'], ['get', 'label'], MODEL_ZOOM,
          ['case', ['!=', ['get', 'company'], ''],
            ['format', ['get', 'company'], { 'font-scale': 0.85 }, '\n', {}, ['get', 'label'], {}],
            ['get', 'label']]],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        // From the zoom where the trains are drawn as models every label shows, even over another (Max, 2026-11-12,
        // option A: the label is the only place a toy shows its lateness). Further out, overlapping labels are left out.
        'text-overlap': ['step', ['zoom'], 'never', MODEL_ZOOM, 'always'],
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
      },
      paint: { 'text-color': '#1b1f24', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5,
        'text-opacity': ['case', ['get', 'stale'], 0.45, 1] },
    });

    // Tapping a train: a generous hit area, since dots are small on a phone.
    // With the toy trains a tap anywhere on the toy counts (half its length round its middle); the nearest wins.
    map.on('click', (e) => {
      const pad = TOY && map.getZoom() >= MODEL_ZOOM ? Math.max(12, settings.toySize / 2) : 12;
      const hits = map.queryRenderedFeatures(
        [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers: ['train-dots'] });
      const dist = f => { const p = map.project(f.geometry.coordinates); return Math.hypot(p.x - e.point.x, p.y - e.point.y); };
      const nearest = hits.reduce((best, f) => (!best || dist(f) < dist(best) ? f : best), null);
      // No train there: a station?
      if (!nearest && onStationTap && map.getZoom() >= 9) {
        const sp = 14;
        const st = map.queryRenderedFeatures([[e.point.x - sp, e.point.y - sp], [e.point.x + sp, e.point.y + sp]], { layers: ['station-dots', 'station-names'] })
          .reduce((best, f) => (!best || dist(f) < dist(best) ? f : best), null);
        if (st) return onStationTap(st.properties.sig);
      }
      onTrainTap?.(nearest?.properties.id ?? null);
    });
    map.on('mouseenter', 'train-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'train-dots', () => { map.getCanvas().style.cursor = ''; });
    resolve();
  }));

  // ---- The selected train: ring, dot and label as one marker on top of the map ----
  // The map's own layers get their data through a background worker, a frame or more late; while the camera follows
  // a train every frame, a ring drawn by them jitters around the train. The marker is placed in the same frame as
  // the camera (setSelectedPlace), so it can't lag.
  let selected = null;
  const selEl = document.createElement('div');
  selEl.className = 'sel-train';
  selEl.innerHTML = '<div class="sel-dot"></div><div class="sel-label"></div>';
  const selDot = selEl.firstChild, selLabel = selEl.lastChild;
  const selMarker = new Marker({ element: selEl, anchor: 'center' });
  let selShown = false, selText = '', selClass = '';

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
    // The passenger stations: [{ sig, name, lon, lat }].
    async setStations(list) {
      await ready;
      map.getSource('stations').setData({ type: 'FeatureCollection', features: list.map(st => ({
        type: 'Feature', properties: { sig: st.sig, name: st.name }, geometry: { type: 'Point', coordinates: [st.lon, st.lat] } })) });
    },
    // Draw a train's path (path.js) split at point index `split` (travelled before it, ahead after it); null: none.
    async setPath(path, split = 0) {
      await ready;
      const features = [];
      if (path && path.coords.length > 1) {
        const k = Math.max(0, Math.min(split, path.coords.length - 1));
        const line = (coords, part) => coords.length > 1 && features.push({ type: 'Feature', properties: { part }, geometry: { type: 'LineString', coordinates: coords } });
        line(path.coords.slice(0, k + 1), 'done');
        line(path.coords.slice(k), 'ahead');
        path.stops.forEach((c, i) => features.push({ type: 'Feature', properties: { part: path.stopAt[i] <= k ? 'done' : 'ahead' },
          geometry: { type: 'Point', coordinates: c } }));
      }
      map.getSource('path').setData({ type: 'FeatureCollection', features });
    },
    // Show the whole of a path above the panel at the bottom.
    async fitPath(path) {
      await ready;
      if (!path || path.coords.length < 2) return;
      const lons = path.coords.map(c => c[0]), lats = path.coords.map(c => c[1]);
      const h = map.getContainer().clientHeight;
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: { top: 70, bottom: Math.round(h * 0.45) + 30, left: 30, right: 60 }, duration: 1000, maxZoom: 13 });
    },
    // Fly to a place ({ lon, lat }), zooming in to at least minZoom.
    async goTo(place, minZoom) {
      await ready;
      map.flyTo({ center: [place.lon, place.lat], zoom: Math.max(map.getZoom(), minZoom), duration: 1200, essential: true });
    },
    // Keep room for the panel or board at the screen's bottom (45 %), without moving what is on screen.
    async pad() {
      await ready;
      setPadding({ top: 0, bottom: Math.round(map.getContainer().clientHeight * 0.45) + 20, left: 0, right: 0 });
    },
    // Take the room kept for the panel away again, without moving what is on screen.
    async unpad() {
      await ready;
      setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    },
    // Ring the train with this id (null: none). Its dot and label are then drawn by the selection marker.
    async select(id) {
      await ready;
      selected = id;
      map.setPaintProperty('train-dots', 'circle-opacity', dotOpacity(id ?? ''));
      map.setPaintProperty('train-dots', 'circle-stroke-opacity', dotOpacity(id ?? ''));
      map.setFilter('train-labels', ['!=', ['get', 'id'], id ?? '']);
      if (!id && selShown) { selMarker.remove(); selShown = false; }
    },
    // Called every frame with the selected train's place (the one the camera uses) and its label and colour
    // ({ label, late, stale }), or null.
    setSelectedPlace(place, props) {
      if (!isReady || !selected || !place) {
        if (selShown) { selMarker.remove(); selShown = false; }
        return;
      }
      selMarker.setLngLat([place.lon, place.lat]);
      if (!selShown) { selMarker.addTo(map); selShown = true; }
      const text = props.company && map.getZoom() >= MODEL_ZOOM ? `${props.company}\n${props.label}` : props.label;
      if (text !== selText) selLabel.textContent = selText = text;
      const cls = `sel-train late-${props.stale ? 'stale' : props.late}${map.getZoom() >= MODEL_ZOOM ? ' model' : ''}`;
      if (cls !== selClass) selEl.className = selClass = cls;
      // Round a toy the ring is as wide as the toy is long, plus a margin; otherwise the dot-sized ring (CSS).
      const ring = TOY && map.getZoom() >= MODEL_ZOOM ? `${settings.toySize + 16}px` : '';
      if (selEl.style.width !== ring) { selEl.style.width = ring; selEl.style.height = ring; }
    },
    // Draw the map now, in this frame (camera, 3D trains and the selection marker all from the same moment).
    drawNow() { if (isReady) map.redraw(); },
    // Show one set of rail lines (a key of RAIL_SOURCES), or none (null).
    async showRail(id) {
      await ready;
      shownRail = id;
      for (const key of Object.keys(RAIL_SOURCES))
        map.setLayoutProperty(`rail-${key}`, 'visibility', key === id ? 'visible' : 'none');
      if (id && !loaded.has(id)) {
        loaded.add(id);
        const source = map.getSource(`rail-${id}`);
        if (railData[id]) railData[id]().then(g => source.setData(g)).catch(e => console.warn(`rail lines: ${e.message}`));
        else source.setData(RAIL_SOURCES[id].url);
      }
    },
    get shownRail() { return shownRail; },
  };
}
