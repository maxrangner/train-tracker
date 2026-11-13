// The map and how trains are drawn on it.
// Step 1: a dot per train. Step 2: rail lines from two sources, one shown at a time. Step 3: number + minutes off,
// the dot's colour from the minutes off. The dots glide (positions come from trains.js at each frame).
import { Map, Marker, NavigationControl, LngLat, setWorkerUrl } from 'maplibre-gl';
import { createTrainLayer, modelZoom, isToy } from './trains-3d.js';
import { settings, isDark } from './settings.js';
import { t } from './i18n.js';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);

// OpenFreeMap: free, no key. Positron is their calm grey style, so the lines and dots stand out; in dark their Dark
// style (Max, 2026-11-12: B, near black, of Dark and Fiord).
const styleUrl = dark => `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`;
// Our own colours on the map, light and dark. In dark, labels are white with a black border (Max, 2026-11-12).
const colours = dark => (dark
  ? { label: '#ffffff', halo: '#000000', station: '#ffffff', ring: '#e6edf3', ringFill: '#161b22', group: '#58a6ff',
      rail: '#7d8590', casing: '#000000', route: '#388bfd', stopFill: '#161b22' }
  : { label: '#1b1f24', halo: '#ffffff', station: '#3d444d', ring: '#3d444d', ringFill: '#ffffff', group: '#1f6feb',
      rail: '#6e7781', casing: '#ffffff', route: '#1f6feb', stopFill: '#ffffff' });

// The rail lines: Trafikverket's network, the one the trains follow (public/rail-net.json, 1.7 MB instead of the
// 11 MB rail-trv.geojson), handed over by main.js as railData.trv. The switch to OpenStreetMap's lines or none was
// removed 2026-11-12 (Max: decided, no need for the option).
export const RAIL_SOURCES = {
  trv: { name: 'Trafikverket' },
};

// Trains closer than this on the screen (pixels) share one label close in ("3 trains").
const GROUP_PX = 40;

// A dot's opacity: grey trains faded; none from the model zoom in (3D trains) or for the selected train (its marker).
const dotOpacity = sel => ['step', ['zoom'],
  ['case', ['==', ['get', 'id'], sel], 0, ['get', 'stale'], 0.4, 1], modelZoom(), 0];

const empty = () => ({ type: 'FeatureCollection', features: [] });
// Our layers on top of the base map, bottom to top. A settings change (toys, zoom, language) takes them away and
// adds them again; light/dark swaps the base map and then adds them again (Max, 2026-11-12: no reloading).
const OUR_LAYERS = ['rail-trv', 'path-casing', 'path-line', 'station-dots', 'station-names', 'path-stops', 'train-dots',
  'trains-3d', 'train-labels', 'train-labels-near', 'train-group-labels'];

// getTrains3d() -> the trains to draw as 3D models (see trains-3d.js).
// railData: { [rail source id]: () => Promise<GeoJSON> } for rail lines that don't come from a url.
// onStationTap(sig): a station was tapped (and no train). onGroupTap([{ id, label, company }]): a "3 trains" label.
export function createMap(container, { onTrainTap, onStationTap, onGroupTap, getTrains3d, alongTrack = null, railData = {} } = {}) {
  let dark = isDark();   // the base map now showing
  let selected = null;   // the tapped train's id
  let layer3d = null;    // the 3D trains layer now on the map (its models' outlines, for taps)
  let shownRail = null;  // the rail lines shown (a key of RAIL_SOURCES)
  const map = new Map({
    container,
    style: styleUrl(dark),
    center: [16.5, 62.5],   // middle of Sweden
    zoom: 4.3,
    hash: 'view',           // the view is kept in the address (#view=zoom/lat/lon/bearing/tilt), so a link opens the same view
    maxPitch: 70,
    // The map credits are in Help (the ? button next to Tilt, index.html); see main.js for the public version.
    attributionControl: false,
  });
  // Zoom buttons and a compass: tap the compass to turn north up and the view flat again; it leans with the tilt.
  map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

  if (import.meta.env.DEV) window.__map = map;   // lets tools/shot.mjs find and tap a train; not in a build

  // What our sources show, kept so it can be put back after the base map is swapped (light/dark).
  const data = { path: empty(), stations: empty(), trains: empty(), 'train-groups': empty() };

  function addSources() {
    const add = (id, extra = {}) => { if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: data[id] ?? empty(), ...extra }); };
    for (const id of Object.keys(RAIL_SOURCES)) add(`rail-${id}`);
    add('path');
    add('stations');
    add('trains');
    // Close in, trains standing close together share one label (see train-group-labels).
    add('train-groups', { cluster: true, clusterRadius: GROUP_PX, clusterMaxZoom: 19 });
  }

  // Our layers, with the colours, model zoom and language as they are now.
  function addLayers() {
    const C = colours(dark), MODEL_ZOOM = modelZoom();
    // Rail lines first, so they sit under the trains.
    for (const id of Object.keys(RAIL_SOURCES)) {
      map.addLayer({
        id: `rail-${id}`,
        type: 'line',
        source: `rail-${id}`,
        layout: { visibility: id === shownRail ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.rail,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 8, 1.2, 14, 3],
        },
      });
    }

    // The open train's whole path (setPath), start to finish in one colour (Max, 2026-11-13: the travelled part was
    // grey, which in the dark look was the rail lines' grey, so it looked missing). Its stops: path-stops, below.
    map.addLayer({ id: 'path-casing', type: 'line', source: 'path', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 5, 14, 11] } });
    map.addLayer({ id: 'path-line', type: 'line', source: 'path', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.route,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3, 14, 7] } });
    // Passenger stations (setStations): a small ring from zoom 9, the name from zoom 11, under the trains.
    map.addLayer({
      id: 'station-dots',
      type: 'circle',
      source: 'stations',
      minzoom: 9,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 6],
        'circle-color': C.ringFill,
        'circle-stroke-color': C.ring,
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
      paint: { 'text-color': C.station, 'text-halo-color': C.halo, 'text-halo-width': 1.5 },
    });

    // The open train's stops: a white circle with a ring in the path's colour (Max, 2026-11-13, like a map app's
    // line), above the stations' own grey rings, which hid them; a little larger than those.
    map.addLayer({ id: 'path-stops', type: 'circle', source: 'path', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 14, 7], 'circle-color': C.stopFill,
        'circle-stroke-color': C.route,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 14, 3] } });

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
        'circle-opacity': dotOpacity(selected ?? ''),
        'circle-stroke-opacity': dotOpacity(selected ?? ''),
      },
    });
    if (getTrains3d) { layer3d = createTrainLayer({ getTrains: getTrains3d, along: alongTrack }); map.addLayer(layer3d); }
    // Labels further out: one per train, and the map leaves out labels that would overlap.
    map.addLayer({
      id: 'train-labels',
      type: 'symbol',
      source: 'trains',
      minzoom: 6,
      maxzoom: MODEL_ZOOM,
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
      paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.5,
        'text-opacity': ['case', ['get', 'stale'], 0.45, 1] },
    });

    // Close in, where the models show: trains standing close together share one label, "3 trains" (Max, 2026-11-12:
    // labels stacked on each other at Stockholm C). The map groups them by distance on the screen; a tap on the group
    // lists them (onGroupTap). A train on its own keeps its full label: company above number (lateness).
    map.addLayer({
      id: 'train-labels-near',
      type: 'symbol',
      source: 'train-groups',
      minzoom: MODEL_ZOOM,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'text-field': ['case', ['!=', ['get', 'company'], ''],
          ['format', ['get', 'company'], { 'font-scale': 0.85 }, '\n', {}, ['get', 'label'], {}],
          ['get', 'label']],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-overlap': 'always',   // every train shows its label (option A)
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
      },
      paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.5,
        'text-opacity': ['case', ['get', 'stale'], 0.45, 1] },
    });
    map.addLayer({
      id: 'train-group-labels',
      type: 'symbol',
      source: 'train-groups',
      minzoom: MODEL_ZOOM,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['concat', ['to-string', ['get', 'point_count']], t('nTrains')],
        'text-font': ['Noto Sans Bold'],
        'text-size': 13,
        'text-overlap': 'always',
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
      },
      paint: { 'text-color': C.group, 'text-halo-color': C.halo, 'text-halo-width': 2 },
    });

    applySelectionFilters();
  }

  // The id of the model under screen point pt (or null): each drawn model's ground outline projected to the screen,
  // a margin of 8 px round it, and its roof's height taken into account by also testing a bit above it.
  function modelAt(pt) {
    const R = Math.PI / 180, M = 111195;
    let best = null, bestD = Infinity;
    for (const [id, o] of layer3d?.outlines() ?? []) {
      const kx = Math.cos(o.lat * R), half = o.length / 2;
      const end = s => map.project([o.lon + s * half * Math.sin(o.bearing * R) / (M * kx), o.lat + s * half * Math.cos(o.bearing * R) / M]);
      const a = end(-1), b = end(1), c = map.project([o.lon, o.lat]);
      const side = map.project([o.lon + (o.width / 2) * Math.cos(o.bearing * R) / (M * kx), o.lat - (o.width / 2) * Math.sin(o.bearing * R) / M]);
      const halfW = Math.hypot(side.x - c.x, side.y - c.y) + 8;
      const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
      // Tested at the ground and lifted by about a model's height (in a tilted view the model stands up).
      for (const lift of [0, halfW * 1.5]) {
        const px = pt.x - a.x, py = pt.y + lift - a.y;
        const f = Math.max(0, Math.min(1, (px * vx + py * vy) / L2));
        const d = Math.hypot(px - vx * f, py - vy * f);
        const extra = Math.hypot(pt.x - c.x, pt.y + lift - c.y) / 1e4;   // equal hits: the nearer middle wins
        if (d <= halfW && d + extra < bestD) { bestD = d + extra; best = id; }
        if (map.getPitch() < 5) break;
      }
    }
    return best;
  }

  function removeLayers() {
    for (const id of OUR_LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  }

  // The selected train's own dot and label are drawn by its marker, so the layers leave it out.
  function applySelectionFilters() {
    const id = selected ?? '';
    map.setPaintProperty('train-dots', 'circle-opacity', dotOpacity(id));
    map.setPaintProperty('train-dots', 'circle-stroke-opacity', dotOpacity(id));
    map.setFilter('train-labels', ['!=', ['get', 'id'], id]);
    map.setFilter('train-labels-near', ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'id'], id]]);
  }

  const ready = new Promise(resolve => map.on('load', () => {
    addSources();
    addLayers();

    // Tapping a train: on its label, anywhere on its model (close in), or near its dot (a generous area, since dots
    // are small on a phone). The nearest wins.
    map.on('click', (e) => {
      // A "3 trains" label: list them.
      const gp = 12;
      const group = onGroupTap && map.queryRenderedFeatures([[e.point.x - gp, e.point.y - gp], [e.point.x + gp, e.point.y + gp]],
        { layers: ['train-group-labels'] })[0];
      if (group) {
        // The trains round the group's place, within the grouping distance (asking the map for the group's members
        // fails when the trains have moved and the groups were redone meanwhile, 30 times a second).
        // Exactly as many as the label says: the nearest to its point, which is the middle of its trains (the area
        // searched can reach into the next group: "2 trains" listed 3, Max 2026-11-12). The open train is in no group.
        const c = map.project(group.geometry.coordinates), r = GROUP_PX * 1.2;
        const near = map.queryRenderedFeatures([[c.x - r, c.y - r], [c.x + r, c.y + r]], { layers: ['train-dots'] });
        const byId = new globalThis.Map(near.filter(f => f.properties.id !== selected).map(f => [f.properties.id, f]));
        const fromMiddle = f => { const q = map.project(f.geometry.coordinates); return Math.hypot(q.x - c.x, q.y - c.y); };
        const members = [...byId.values()].sort((a, b) => fromMiddle(a) - fromMiddle(b)).slice(0, group.properties.point_count);
        if (members.length) return onGroupTap(members.map(f => f.properties));
      }
      const dist = f => { const p = map.project(f.geometry.coordinates); return Math.hypot(p.x - e.point.x, p.y - e.point.y); };
      // A train's label (Max, 2026-11-12: "it should be the entire train model, and the label").
      const lp = 3;
      const label = map.queryRenderedFeatures([[e.point.x - lp, e.point.y - lp], [e.point.x + lp, e.point.y + lp]],
        { layers: ['train-labels', 'train-labels-near'] }).find(f => f.properties.id);
      if (label) return onTrainTap?.(label.properties.id);
      // Close in: anywhere on a model (its outline on the screen, with a little margin), nearest to its middle line.
      const onModel = map.getZoom() >= modelZoom() ? modelAt(e.point) : null;
      if (onModel) return onTrainTap?.(onModel);
      const pad = isToy() && map.getZoom() >= modelZoom() ? Math.max(12, settings.toySize / 2) : 12;
      const hits = map.queryRenderedFeatures(
        [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers: ['train-dots'] });
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
    // Arrow keys (Max, 2026-11-12): up and down always tilt the view; left and right turn it while a train is
    // followed (otherwise they move the map, as the map's own keys do). Not while typing or in Help, Settings or the
    // menu. Caught before the map's own key handling, which would move the map and end the following.
    document.addEventListener('keydown', (e) => {
      if (!e.key.startsWith('Arrow') || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target?.closest?.('input, textarea, select, #help, #settings-page, #menu')) return;
      const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if (!vertical && !following) return;
      e.preventDefault();
      e.stopPropagation();
      if (vertical) {
        const pitch = Math.max(0, Math.min(map.getMaxPitch(), map.getPitch() + (e.key === 'ArrowUp' ? 10 : -10)));
        map.easeTo({ pitch, duration: 150 });
      } else {
        map.easeTo({ bearing: map.getBearing() + (e.key === 'ArrowLeft' ? -15 : 15), duration: 150 });
      }
    }, true);
    map.on('mouseenter', 'train-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'train-dots', () => { map.getCanvas().style.cursor = ''; });
    resolve();
  }));

  // ---- The selected train: ring, dot and label as one marker on top of the map ----
  // The map's own layers get their data through a background worker, a frame or more late; while the camera follows
  // a train every frame, a ring drawn by them jitters around the train. The marker is placed in the same frame as
  // the camera (setSelectedPlace), so it can't lag.
  const selEl = document.createElement('div');
  selEl.className = 'sel-train';
  selEl.innerHTML = '<div class="sel-dot"></div><div class="sel-label"></div>';
  const selDot = selEl.firstChild, selLabel = selEl.lastChild;
  // Placed to the exact (fractional) pixel: rounded to whole pixels, the ring flickered between two pixels on phones,
  // whose screen middle falls on a half pixel (measured 2026-11-12: moved in 4 of 10 frames; 0 with this).
  const selMarker = new Marker({ element: selEl, anchor: 'center', subpixelPositioning: true });
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
    // The wheel's enable() does nothing when it is already on (so the option was never taken): off first.
    map.scrollZoom.disable();
    map.scrollZoom.enable(on ? { around: 'center' } : undefined);
    map.touchZoomRotate.enable(on ? { around: 'center' } : undefined);
  }
  function stopFollowing() {
    const end = following?.onEnd;
    following = null;
    zoomAroundCenter(false);
    end?.();
  }
  // A drag while following re-frames it: where the train is on the screen when the map comes to rest becomes the
  // point the camera keeps it at (Max, 2026-11-13: "when clicking, dragging, then releasing - that should be the new
  // center for the follow ... so that you can reframe how you want it stuck"). Dragging no longer stops following;
  // a single tap on the map does (main.js). Kept on the screen and above the panel.
  let dragged = false;
  map.on('dragstart', () => { dragged = true; });
  map.on('moveend', () => {
    if (!dragged || pointers.size) return;
    dragged = false;
    const p = following?.getPlace();
    if (!p) return;
    const { clientWidth: w, clientHeight: h } = box, at = map.project([p.lon, p.lat]);
    const x = Math.max(30, Math.min(w - 30, at.x)), y = Math.max(70, Math.min(h - following.bottom - 30, at.y));
    setPadding({ left: Math.max(0, 2 * x - w), right: Math.max(0, w - 2 * x), top: Math.max(0, 2 * y - h), bottom: Math.max(0, h - 2 * y) });
  });
  // Put the camera's middle on a place without stopping a zoom or turn in progress: MapLibre's jumpTo stops every
  // gesture, so the camera used to keep still until a zoom had ended and then catch up (Max, 2026-11-13: "the
  // camera stops for a beat, then recenters"). This uses MapLibre 6's own camera (not a public call; maplibre-gl is
  // pinned): false when it isn't there, and the camera then waits as before.
  function centerDuringGesture(lng, lat) {
    const camera = map._camera;
    if (typeof camera?.applyTransformChange !== 'function') return false;
    camera.applyTransformChange(tr => tr.setCenter(new LngLat(lng, lat)));
    map.triggerRepaint();
    return true;
  }
  // Change the room kept free at the screen's edges, keeping the map still: the camera's new middle is the place
  // already showing there.
  function setPadding(padding) {
    const { clientWidth: w, clientHeight: h } = box;
    const at = map.unproject([(w + padding.left - padding.right) / 2, (h + padding.top - padding.bottom) / 2]);
    map.jumpTo({ center: at, padding });
  }

  const loaded = new Set();

  let isReady = false;
  ready.then(() => { isReady = true; });
  return {
    ready,
    // Called every animation frame with the trains where they are now.
    setTrains(geojson) {
      data.trains = geojson;
      if (!isReady) return;
      map.getSource('trains').setData(geojson);
      // Grouped labels close in; the selected train has its own label (the marker), so it isn't counted in a group.
      if (map.getZoom() >= modelZoom() - 1) {
        data['train-groups'] = selected
          ? { type: 'FeatureCollection', features: geojson.features.filter(f => f.properties.id !== selected) } : geojson;
        map.getSource('train-groups').setData(data['train-groups']);
      }
    },
    // Tilt the view (55°) or lay it flat again.
    toggleTilt() {
      map.easeTo({ pitch: map.getPitch() > 5 ? 0 : 55, duration: 700 });
    },
    get tilted() { return map.getPitch() > 5; },
    onViewChange(fn) { map.on('pitchend', fn); },
    // Follow a train: keep it in the middle of the view above the train panel (which covers up to 45 % of the
    // screen's bottom). getPlace() -> { lon, lat } where the train is drawn now, or null when it is gone.
    // Zoom, turn and tilt stay the user's; a drag moves the point the train is kept at (above). onEnd() is called
    // when following stops by itself (the train is gone).
    async follow(getPlace, onEnd) {
      await ready;
      const h = map.getContainer().clientHeight, bottom = Math.round(h * 0.45) + 20;
      setPadding({ top: 0, bottom, left: 0, right: 0 });
      dragged = false;
      following = { getPlace, onEnd, locked: false, bottom };
      zoomAroundCenter(true);
    },
    unfollow() { following = null; zoomAroundCenter(false); },
    get following() { return Boolean(following); },
    // Called every drawing frame: move the camera along with the followed train.
    tick(now) {
      const dt = Math.min(now - lastTick, 200);
      lastTick = now;
      if (!following || !isReady) return;
      const p = following.getPlace();
      if (!p) return stopFollowing();
      // A finger or the mouse is down, or the map is zooming or turning (a wheel zoom, a pinch, the compass): the
      // camera keeps on the train without stopping what the user does. Only a drag (one finger or the mouse moving
      // the map) and the map's own animations (a fling, a fly-to) are left alone.
      const busy = pointers.size > 0 || map.isMoving();
      if (busy && ((map.dragPan.isActive() && pointers.size < 2) || map._camera?.isEasing?.())) { following.locked = false; return; }
      const moveTo = (lng, lat) => {
        if (!busy) map.jumpTo({ center: [lng, lat] });
        else if (!centerDuringGesture(lng, lat)) following.locked = false;
      };
      const off = offFocus(p);
      if (following.locked && off < 30) return moveTo(p.lon, p.lat);
      // Not on it yet (just tapped, or the train jumped): glide over in about half a second, then stay locked on.
      if (off < 1) { following.locked = true; return moveTo(p.lon, p.lat); }
      const c = map.getCenter(), k = 1 - Math.exp(-dt / 150);
      moveTo(c.lng + (p.lon - c.lng) * k, c.lat + (p.lat - c.lat) * k);
    },
    // The passenger stations: [{ sig, name, lon, lat }].
    async setStations(list) {
      data.stations = { type: 'FeatureCollection', features: list.map(st => ({
        type: 'Feature', properties: { sig: st.sig, name: st.name }, geometry: { type: 'Point', coordinates: [st.lon, st.lat] } })) };
      await ready;
      if (isReady) map.getSource('stations').setData(data.stations);
    },
    // Draw a train's whole path (path.js) and its stops; null: none.
    async setPath(path) {
      const features = [];
      if (path && path.coords.length > 1) {
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: path.coords } });
        for (const c of path.stops) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } });
      }
      data.path = { type: 'FeatureCollection', features };
      await ready;
      if (isReady) map.getSource('path').setData(data.path);
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
      selected = id;
      await ready;
      if (isReady) applySelectionFilters();
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
      const text = props.company && map.getZoom() >= modelZoom() ? `${props.company}\n${props.label}` : props.label;
      if (text !== selText) selLabel.textContent = selText = text;
      const cls = `sel-train late-${props.stale ? 'stale' : props.late}${map.getZoom() >= modelZoom() ? ' model' : ''}`;
      if (cls !== selClass) selEl.className = selClass = cls;
      // Round a toy the ring is as wide as the toy is long, plus a margin; otherwise the dot-sized ring (CSS).
      const ring = isToy() && map.getZoom() >= modelZoom() ? `${settings.toySize + 16}px` : '';
      if (selEl.style.width !== ring) { selEl.style.width = ring; selEl.style.height = ring; }
    },
    // Draw the map now, in this frame (camera, 3D trains and the selection marker all from the same moment).
    drawNow() { if (isReady) map.redraw(); },
    // Show one set of rail lines (a key of RAIL_SOURCES), or none (null).
    async showRail(id) {
      await ready;
      shownRail = id;
      if (isReady) for (const key of Object.keys(RAIL_SOURCES))
        map.setLayoutProperty(`rail-${key}`, 'visibility', key === id ? 'visible' : 'none');
      if (id && !loaded.has(id) && railData[id]) {
        loaded.add(id);
        railData[id]().then((g) => { data[`rail-${id}`] = g; map.getSource(`rail-${id}`)?.setData(g); })
          .catch(e => console.warn(`rail lines: ${e.message}`));
      }
    },
    get shownRail() { return shownRail; },
    // After a settings change (look, language, toys, zoom): our layers again, and for light/dark the other base map
    // first. Nothing is reloaded; the trains, stations, path and rail lines are put back from what they showed.
    async applySettings() {
      await ready;
      const want = isDark();
      if (want === dark) {
        if (!isReady) return;   // a base map swap is under way; it adds the layers as they should be
        removeLayers();
        addLayers();
        return;
      }
      dark = want;
      isReady = false;
      map.once('style.load', () => {
        removeLayers();
        addSources();
        addLayers();
        isReady = true;
      });
      map.setStyle(styleUrl(dark), { diff: false });
    },
  };
}
