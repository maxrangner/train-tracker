// The map and how trains are drawn on it.
// Step 1: a dot per train. Step 2: rail lines from two sources, one shown at a time. Step 3: number + minutes off,
// the dot's colour from the minutes off. The dots glide (positions come from trains.js at each frame).
import { Map, Marker, NavigationControl, GeolocateControl, LngLat, Point, setWorkerUrl } from 'maplibre-gl';
import { createTrainLayer, modelZoom, modelsAt, symbolOnly, isToy } from './trains-3d.js';
import { settings, isDark } from './settings.js';
import { t } from './i18n.js';
import { progressAlong } from './path.js';
import { LOOK, restyleBase } from './map-look.js';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);

// OpenFreeMap: free, no key. Positron is their calm grey style, so the lines and dots stand out; in dark their Dark
// style (Max, 2026-11-12: B, near black, of Dark and Fiord).
const styleUrl = dark => `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`;
// Our own colours on the map, light and dark. In dark, labels are white with a dark border (Max, 2026-11-12).
// The open train's route is green, the part it has travelled a darker green (Max, 2026-11-13; it was one blue).
// The rails and stations follow the map's look (Max, 2026-11-14: "Paper" light, dark rails with a white edge;
// "Night" dark, rails in warm light; src/map-look.js).
const colours = dark => (dark
  ? { label: '#ffffff', halo: LOOK.dark.water, station: '#d6deea', ring: '#e8c170', ringFill: LOOK.dark.land, group: '#58a6ff',
      rail: '#e8c170', railEdge: null, railK: 1.3, nameHalo: LOOK.dark.land, dis: ['#e3b341', '#f0883e', '#ff6b61'], disEdge: LOOK.dark.land, disDash: true,
      casing: '#000000', route: '#3fb950', routeDone: '#238636', stopFill: '#161b22' }
  : { label: '#1b1f24', halo: '#ffffff', station: '#33373d', ring: '#33373d', ringFill: '#ffffff', group: '#1f6feb',
      rail: '#33373d', railEdge: '#ffffff', railK: 1.25, nameHalo: LOOK.light.land, dis: ['#d4a017', '#e8701a', '#d1242f'], disEdge: '#ffffff', disDash: false,
      casing: '#ffffff', route: '#2da44e', routeDone: '#116329', stopFill: '#ffffff' });
// The rails' width at each zoom (k: how bold): bolder far out than before, but not a black mass in a big yard close in.
const railWidth = k => ['interpolate', ['linear'], ['zoom'], 4, 0.5 * k, 7, 0.9 * k, 10, 1.5 * k, 13, Math.min(2.0 * k, 2.8), 16, Math.min(2.6 * k, 3.2)];

// The rail lines: Trafikverket's network, the one the trains follow (public/rail-net.json, 1.7 MB instead of the
// 11 MB rail-trv.geojson), handed over by main.js as railData.trv. The switch to OpenStreetMap's lines or none was
// removed 2026-11-12 (Max: decided, no need for the option).
export const RAIL_SOURCES = {
  trv: { name: 'Trafikverket' },
};

// Only Sweden shows (Max, 2026-11-13: "only Sweden visible", plain like the sea): everything outside Sweden's border
// (OpenStreetMap's, with its territorial waters: public/sweden-mask.json, from tools/sweden-mask.mjs) is painted in
// the base map's own sea colour, over the base map, under our rail lines and trains (trains abroad still show), and
// the base map's names outside Sweden are left out. Panning stays round Sweden.
const SEA = dark => (dark ? 'rgb(27, 27, 29)' : 'rgb(194, 200, 202)');   // OpenFreeMap's water, if its layer isn't found
const MAX_BOUNDS = [[-2, 52], [42, 72]];   // within the mask's own area (tools/sweden-mask.mjs BOX)
const MASK_URL = '/sweden-mask.json';
// The zoom's limits (Max, 2026-11-13: the zoom slider shows the absolute minimum and maximum): furthest out, all of
// Sweden on the screen (worked out for the screen's size); closest in, 19 (a street; the map's tiles end at 14 and
// are only enlarged after that, the default limit 22 was empty enlargement).
const SWEDEN_BOUNDS = [[10.9, 55.2], [24.2, 69.1]];
const MAX_ZOOM = 19;
let swedenShape = null;   // Sweden, roughly (about 1 km), for the names
let maskFailed = false;
const maskReady = fetch(MASK_URL).then(r => r.json())
  .then((g) => { swedenShape = g.features.find(f => f.properties.kind === 'sweden')?.geometry ?? null; })
  .catch((e) => { maskFailed = true; console.warn(`only Sweden: ${e.message} (run node tools/sweden-mask.mjs)`); });
// The start screen (index.html) stays until the first view shows only Sweden, or at most this long.
const FIRST_VIEW_MAX_MS = 8000;

// The fastest a drawn train moves, in metres a second (250 km/h): for how often the dots are refreshed (trainsEvery).
const FASTEST_MS = 70;
// Trains closer than this on the screen (pixels) share one label close in ("3 trains").
const GROUP_PX = 40;

// A train further out (with Settings → Trains → Symbol, at every zoom) is a triangle pointing the way it goes, or
// (Settings → Debug → Train symbol, Max 2026-11-13) a circle, in the same colours. Drawn once per colour, white-edged, sharp on a phone's screen (4 pixels per screen pixel).
const DOT_COLOURS = { ontime: '#1a7f37', some: '#d4a72c', late: '#d1242f', unknown: '#8c959f' };
// The arrow's shape in a 64 x 64 picture, pointing up (north); middle (32, 32). Max, 2026-11-15, from four sketches
// ("Change to A, but put a toggle under debug to toggle to C"): 'triangle' wider than before (base 44, was 34: hard
// to read), 'dart' (Settings → Debug → Train symbol → Dart) wide with a notch at the back.
const ARROWS = { triangle: [[32, 3], [54, 61], [10, 61]], dart: [[32, 3], [59, 61], [32, 48], [5, 61]] };
const arrow = () => ARROWS[settings.trainSymbol] ?? ARROWS.triangle;
const triangles = () => settings.trainSymbol !== 'circle';
function addTriangles(map) {
  for (const [name, colour] of Object.entries(DOT_COLOURS)) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.beginPath();
    arrow().forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.lineJoin = 'round';
    g.lineWidth = 8;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = colour;
    g.fill();
    // Drawn again on a settings change: the shape may have changed.
    if (map.hasImage(`tri-${name}`)) map.updateImage(`tri-${name}`, g.getImageData(0, 0, 64, 64));
    else map.addImage(`tri-${name}`, g.getImageData(0, 0, 64, 64), { pixelRatio: 4 });
  }
}

// A dot's opacity: grey trains faded; none from the model zoom in (3D trains) or for the selected train (its marker).
// With Settings → Trains → Symbol there are no models: the dots show at every zoom.
const dotOpacity = sel => {
  const seen = ['case', ['==', ['get', 'id'], sel], 0, ['get', 'stale'], 0.4, 1];
  return symbolOnly() ? seen : ['step', ['zoom'], seen, modelZoom(), 0];
};

const empty = () => ({ type: 'FeatureCollection', features: [] });
// Our layers on top of the base map, bottom to top. A settings change (toys, zoom, language) takes them away and
// adds them again; light/dark swaps the base map and then adds them again (Max, 2026-11-12: no reloading).
const OUR_LAYERS = ['sweden-mask', 'rail-edge', 'rail-trv', 'path-casing', 'path-line', 'disruption-edge', 'disruption-lines', 'disruption-rings','station-dots', 'path-stops', 'train-dots', 'train-triangles',
  'trains-3d', 'train-labels', 'station-names'];

// getTrains3d() -> the trains to draw as 3D models (see trains-3d.js).
// railData: { [rail source id]: () => Promise<GeoJSON> } for rail lines that don't come from a url.
// onStationTap(sig): a station was tapped (and no train). onGroupTap([{ id, label, company }]): a "3 trains" label.
export function createMap(container, { onTrainTap, onStationTap, onGroupTap, onDisruptionTap, getTrains3d, alongTrack = null, railData = {} } = {}) {
  let dark = isDark();   // the base map now showing
  let selected = null;   // the tapped train's id
  let layer3d = null;    // the 3D trains layer now on the map (its models' outlines, for taps)
  let shownRail = null;  // the rail lines shown (a key of RAIL_SOURCES)
  let pathProgress = 0;   // how far along the shown path the train is (setPathProgress)
  let pathMetres = 0;     // the shown path's length
  // The path's colours now: the line by its line progress, its stops by their share of the way (f).
  const pathColours = () => {
    const C = colours(dark);
    return { line: ['step', ['line-progress'], C.routeDone, pathProgress, C.route],
      stops: ['case', ['<=', ['get', 'f'], pathProgress], C.routeDone, C.route] };
  };
  const map = new Map({
    container,
    style: styleUrl(dark),
    center: [16.5, 62.5],   // middle of Sweden
    zoom: 4.3,
    hash: 'view',           // the view is kept in the address (#view=zoom/lat/lon/bearing/tilt), so a link opens the same view
    maxBounds: MAX_BOUNDS,
    maxZoom: MAX_ZOOM,
    maxPitch: 70,
    // The map credits are in Help (the ? button at the top, index.html); see main.js for the public version.
    attributionControl: false,
    // Labels appear and go at once. Their 0.3 s fade kept the map drawing after every refresh of the dots: 27 frames
    // a second over all of Sweden with nothing moving on screen (measured 2026-11-15; Max: "Optimization is KEY").
    fadeDuration: 0,
  });
  // Zoom buttons and a compass: tap the compass to turn north up and the view flat again; it leans with the tilt.
  map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

  // My location (Max, 2026-11-13), under + and −: a tap flies the map to where this phone or computer is and shows
  // a blue dot there; it stops following a train. Browsers give the place only on a secure address (https, or the
  // computer itself), so over the home wifi (http://192.168.x.x) the button is grey, and a tap on it says why.
  const geolocate = new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, fitBoundsOptions: { maxZoom: 14 } });
  map.addControl(geolocate, 'top-right');
  const geoBox = geolocate._container;   // the control's own box (its button is inside)
  geoBox?.addEventListener('click', () => { if (following) stopFollowing(); }, true);
  const note = document.createElement('div');
  note.className = 'map-note card';
  note.hidden = true;
  map.getContainer().appendChild(note);
  let noteTimer = null;
  function showNote(text) {
    note.textContent = text;
    note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note.hidden = true; }, 5000);
  }
  geoBox?.addEventListener('pointerdown', () => { if (!window.isSecureContext) showNote(t('noLocation')); }, true);
  geolocate.on('error', () => { if (!window.isSecureContext) showNote(t('noLocation')); relabelControls(); });
  // The button's words in the page's language (again after a change of language: relabel).
  function relabelControls() {
    const b = geoBox?.querySelector('button');
    if (!b) return;
    const text = window.isSecureContext ? t('myLocation') : t('noLocation');
    b.title = text;
    b.setAttribute('aria-label', text);
  }

  // Furthest out: all of Sweden on the screen (again when the screen changes size, e.g. a phone turned).
  function setZoomLimits() {
    const cam = map.cameraForBounds(SWEDEN_BOUNDS, { padding: 20, bearing: 0 });
    if (cam && Number.isFinite(cam.zoom)) map.setMinZoom(Math.max(0, Math.min(MAX_ZOOM - 1, cam.zoom)));
    showZoom(false);
  }
  // The zoom slider (Max, 2026-11-13): a bar next to + and −, its top the closest zoom and its bottom the furthest,
  // a knob at the zoom now. It fades in while the zoom changes (wheel, pinch, buttons, a double tap, a fly-to) and
  // out 1.5 s after. While it shows it can be grabbed (Max, 2026-11-13 evening): a press or drag on it sets the zoom,
  // around the screen's middle (while following, the train), and it stays while held. An invisible grip round the
  // thin bar makes it easy to hit with a finger.
  const zoomBar = document.createElement('div');
  zoomBar.className = 'zoom-bar';
  zoomBar.setAttribute('aria-hidden', 'true');
  zoomBar.innerHTML = '<div class="zoom-knob"></div><div class="zoom-grip"></div>';
  map.getContainer().appendChild(zoomBar);
  const knob = zoomBar.firstChild, grip = zoomBar.lastChild;
  let zoomBarTimer = null;
  let held = null;   // the finger or mouse holding the slider
  function zoomFromY(clientY) {
    const r = zoomBar.getBoundingClientRect();
    const f = 1 - Math.max(0, Math.min(1, (clientY - r.top) / r.height));
    const min = map.getMinZoom(), max = map.getMaxZoom();
    map.jumpTo({ zoom: min + f * (max - min) });
  }
  grip.addEventListener('pointerdown', (e) => {
    if (!zoomBar.classList.contains('shown')) return;
    e.preventDefault();
    held = e.pointerId;
    grip.setPointerCapture(e.pointerId);
    zoomBar.classList.add('held');
    zoomFromY(e.clientY);
  });
  grip.addEventListener('pointermove', (e) => { if (e.pointerId === held) zoomFromY(e.clientY); });
  const letGo = (e) => {
    if (e.pointerId !== held) return;
    held = null;
    zoomBar.classList.remove('held');
    showZoom();   // fades 1.5 s after letting go
  };
  grip.addEventListener('pointerup', letGo);
  grip.addEventListener('pointercancel', letGo);
  function showZoom(reveal = true) {
    const min = map.getMinZoom(), max = map.getMaxZoom();
    const f = max > min ? Math.max(0, Math.min(1, (map.getZoom() - min) / (max - min))) : 0;
    knob.style.top = `${(1 - f) * 100}%`;
    if (!reveal) return;
    zoomBar.classList.add('shown');
    clearTimeout(zoomBarTimer);
    zoomBarTimer = setTimeout(() => { if (held === null) zoomBar.classList.remove('shown'); }, 1500);
  }
  map.on('zoom', () => showZoom());
  map.on('resize', setZoomLimits);
  setZoomLimits();

  if (import.meta.env.DEV) window.__map = map;   // lets tools/shot.mjs find and tap a train; not in a build

  // What our sources show, kept so it can be put back after the base map is swapped (light/dark).
  const data = { path: empty(), stations: empty(), trains: empty(), disruptions: empty() };

  function addSources() {
    const add = (id, extra = {}) => { if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: data[id] ?? empty(), ...extra }); };
    add('sweden-mask', { data: MASK_URL });
    for (const id of Object.keys(RAIL_SOURCES)) add(`rail-${id}`);
    add('path', { lineMetrics: true });   // line progress: the travelled part's colour (pathColours)
    add('stations');
    // The dots' tiles are made no finer than zoom 12 (about a metre's precision; closer in they are enlarged): the
    // default 18 cut the view into many small tiles, each one redrawing the map when it arrived (about 6 draws per
    // refresh of the dots at zoom 11; measured 2026-11-15).
    add('trains', { maxzoom: 12 });
    add('disruptions');
  }

  // Our layers, with the colours, model zoom and language as they are now.
  function addLayers() {
    const C = colours(dark), MODEL_ZOOM = modelZoom();
    // Outside Sweden, the sea's colour: over the base map's land, roads and borders, under its names after them, so
    // a Swedish name at the coast isn't cut (the names outside Sweden are left out, below). The dark map draws roads
    // and borders after some names, so the place is after its last layer that isn't names.
    let sea = SEA(dark);
    try { const c = map.getPaintProperty('water', 'fill-color'); if (typeof c === 'string') sea = c; } catch { /* no water layer */ }
    const base = map.getStyle().layers.filter(l => !OUR_LAYERS.includes(l.id));
    const firstName = base[base.findLastIndex(l => l.type !== 'symbol') + 1]?.id;
    map.addLayer({ id: 'sweden-mask', type: 'fill', source: 'sweden-mask', filter: ['==', ['get', 'kind'], 'mask'],
      paint: { 'fill-color': sea, 'fill-antialias': false } }, firstName);
    namesOnlyInSweden();
    // Rail lines first, so they sit under the trains. In the light look a white edge under them (the Paper look).
    if (C.railEdge) {
      map.addLayer({ id: 'rail-edge', type: 'line', source: 'rail-trv',
        layout: { visibility: shownRail === 'trv' ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.railEdge, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0, 8, 2.6, 10, 3.6, 13, 4.6, 16, 5.4] } });
    }
    for (const id of Object.keys(RAIL_SOURCES)) {
      map.addLayer({
        id: `rail-${id}`,
        type: 'line',
        source: `rail-${id}`,
        layout: { visibility: id === shownRail ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.rail,
          'line-width': railWidth(C.railK),
        },
      });
    }

    // The open train's whole path (setPath), start to finish: green ahead of the train, darker green behind it (Max,
    // 2026-11-13; the travelled part was once grey, which in the dark look was the rail lines' grey, so it looked
    // missing). Its stops: path-stops, below.
    map.addLayer({ id: 'path-casing', type: 'line', source: 'path', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 5, 14, 11] } });
    map.addLayer({ id: 'path-line', type: 'line', source: 'path', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-gradient': pathColours().line,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3, 14, 7] } });
    // Disruptions (setDisruptions; Max, 2026-11-14: in the menu and on the map): the stretch where it is, along our
    // tracks, coloured by Trafikverket's level (1-2 yellow, 3 orange, 4 red: its "green" level 1 is still a
    // disruption with a message for travellers). Over the rails and the open train's route, under the stations and
    // the trains. The line only, no dot (Max, 2026-11-15, "B, line only"); a ring round the station for a disruption
    // at one station, which has no line (src/disruptions.js geojson).
    const disColour = ['step', ['get', 'level'], C.dis[0], 3, C.dis[1], 4, C.dis[2]];
    // In the Night look the rails are warm yellow too: there the stretch is dashed, over a dark edge, to tell it apart.
    map.addLayer({ id: 'disruption-edge', type: 'line', source: 'disruptions', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round', visibility: C.disDash ? 'visible' : 'none' },
      paint: { 'line-color': C.disEdge, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 5, 8, 8, 14, 13] } });
    map.addLayer({ id: 'disruption-lines', type: 'line', source: 'disruptions', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': C.disDash ? 'butt' : 'round', 'line-join': 'round' },
      paint: { 'line-color': disColour, 'line-opacity': C.disDash ? 1 : 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 8, 5, 14, 9],
        ...(C.disDash ? { 'line-dasharray': [1.6, 1] } : {}) } });
    map.addLayer({ id: 'disruption-rings', type: 'circle', source: 'disruptions', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-opacity': 0, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6, 10, 11, 14, 15],
        'circle-stroke-color': disColour, 'circle-stroke-width': 3.5 } });
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
    // (The stations' names are added last, on top of everything: below.)

    // The open train's stops: a white circle with a ring in the path's colour (Max, 2026-11-13, like a map app's
    // line), above the stations' own grey rings, which hid them; a little larger than those.
    map.addLayer({ id: 'path-stops', type: 'circle', source: 'path', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 14, 7], 'circle-color': C.stopFill,
        'circle-stroke-color': pathColours().stops,
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
    // Triangles instead of circles (Settings → Train symbol): the circles stay, unseen, so taps still find the trains.
    addTriangles(map);
    map.addLayer({
      id: 'train-triangles',
      type: 'symbol',
      source: 'trains',
      layout: {
        visibility: triangles() ? 'visible' : 'none',
        'icon-image': ['case', ['get', 'stale'], 'tri-unknown',
          ['match', ['get', 'late'], 'ontime', 'tri-ontime', 'some', 'tri-some', 'late', 'tri-late', 'tri-unknown']],
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        // About as big as the circle: 9 px tall far out, 20 px from zoom 10.
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.55, 10, 1.25],
      },
      paint: { 'icon-opacity': dotOpacity(selected ?? '') },
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

    // Close in, where the models show, the labels are page elements placed every frame (placeNearLabels, below).

    // The stations' names, last so they lie on top of everything (Max, 2026-11-13: "a bit bigger and always on top
    // of other labels"): over the trains, their labels and the base map's names. The top layer is also placed first,
    // so where labels collide a station's name is kept and the other label is left out. (The selected train's label
    // is above the map itself, so it stays on top.)
    // From the zoom where the trains' labels are page elements (placeNearLabels) the names are page elements too,
    // above those labels; this layer draws them further out.
    map.addLayer({
      id: 'station-names',
      type: 'symbol',
      source: 'stations',
      minzoom: 11,
      maxzoom: Math.max(11, MODEL_ZOOM),
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 14,
        'text-offset': [0, -1.1],
        'text-anchor': 'bottom',
        'text-optional': true,
      },
      paint: { 'text-color': C.station, 'text-halo-color': C.nameHalo, 'text-halo-width': 1.5 },
    });

    applySelectionFilters();
    relabelControls();
  }

  // The base map's names (towns, seas, roads) only inside Sweden: each of its label layers also asks "within Sweden".
  let namesFiltered = false;
  function namesOnlyInSweden() {
    if (!swedenShape) return;
    namesFiltered = true;
    for (const l of map.getStyle().layers) {
      if (l.type !== 'symbol' || OUR_LAYERS.includes(l.id)) continue;
      const f = map.getFilter(l.id);
      if (JSON.stringify(f ?? null).includes('"within"')) continue;   // done already (our layers added again)
      map.setFilter(l.id, f ? ['all', f, ['within', swedenShape]] : ['within', swedenShape]);
    }
  }
  maskReady.then(() => { if (isReady) namesOnlyInSweden(); });

  // The id of the model under screen point pt (or null): each drawn model's ground outline projected to the screen,
  // a margin of 8 px round it, and its roof's height taken into account by also testing a bit above it.
  // A train bent along its track is tested car by car (one straight box missed the last car on a curve: 13-14 px
  // off with a box 10.6 px to each side, measured 2026-11-13).
  function modelAt(pt) {
    const R = Math.PI / 180, M = 111195;
    let best = null, bestD = Infinity;
    for (const [id, o] of layer3d?.outlines() ?? []) {
      const kx = Math.cos(o.lat * R), half = o.length / 2;
      const end = s => map.project([o.lon + s * half * Math.sin(o.bearing * R) / (M * kx), o.lat + s * half * Math.cos(o.bearing * R) / M]);
      const a = end(-1), b = end(1), c = map.project([o.lon, o.lat]);
      const side = map.project([o.lon + (o.width / 2) * Math.cos(o.bearing * R) / (M * kx), o.lat - (o.width / 2) * Math.sin(o.bearing * R) / M]);
      const halfW = Math.hypot(side.x - c.x, side.y - c.y) + 8;
      const pieces = o.cars ? o.cars.map(([lon0, lat0, lon1, lat1]) => [map.project([lon0, lat0]), map.project([lon1, lat1])]) : [[a, b]];
      // Tested at the ground and lifted by about a model's height (in a tilted view the model stands up).
      for (const lift of [0, halfW * 1.5]) {
        let d = Infinity;   // to the nearest piece's middle line
        for (const [p, q] of pieces) {
          const vx = q.x - p.x, vy = q.y - p.y, L2 = vx * vx + vy * vy || 1;
          const px = pt.x - p.x, py = pt.y + lift - p.y;
          const f = Math.max(0, Math.min(1, (px * vx + py * vy) / L2));
          d = Math.min(d, Math.hypot(px - vx * f, py - vy * f));
        }
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
    const dots = triangles() ? 0 : dotOpacity(id);   // with triangles the circles are only there for taps
    map.setPaintProperty('train-dots', 'circle-opacity', dots);
    map.setPaintProperty('train-dots', 'circle-stroke-opacity', dots);
    map.setPaintProperty('train-triangles', 'icon-opacity', dotOpacity(id));
    map.setFilter('train-labels', ['!=', ['get', 'id'], id]);
  }

  const ready = new Promise(resolve => map.on('load', () => {
    restyleBase(map, dark);
    addSources();
    addLayers();

    // Tapping a train: on its label, anywhere on its model (close in), or near its dot (a generous area, since dots
    // are small on a phone). The nearest wins.
    map.on('click', (e) => {
      // Close in, a station's name is drawn on top of everything, so a tap on it opens the station.
      const named = onStationTap && stationNameAt(e.point);
      if (named) return onStationTap(named);
      // Close in, a label: a "3 trains" label lists exactly the trains it was drawn for (the open train is in no
      // group); a train's own label opens it.
      const near = nearLabelAt(e.point);
      if (near && near.ids.length > 1 && onGroupTap) return onGroupTap(near.ids.map(id => nearProps.get(id)).filter(Boolean));
      if (near) return onTrainTap?.(near.ids[0]);
      const dist = f => { const p = map.project(f.geometry.coordinates); return Math.hypot(p.x - e.point.x, p.y - e.point.y); };
      // A train's label further out (Max, 2026-11-12: "it should be the entire train model, and the label").
      const lp = 3;
      const label = map.queryRenderedFeatures([[e.point.x - lp, e.point.y - lp], [e.point.x + lp, e.point.y + lp]],
        { layers: ['train-labels'] }).find(f => f.properties.id);
      if (label) return onTrainTap?.(label.properties.id);
      // Close in: anywhere on a model (its outline on the screen, with a little margin), nearest to its middle line.
      const onModel = modelsAt(map.getZoom()) ? modelAt(e.point) : null;
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
      // No train or station there: a disruption's ring or stretch?
      if (!nearest && onDisruptionTap) {
        const dp = 12;
        const dis = map.queryRenderedFeatures([[e.point.x - dp, e.point.y - dp], [e.point.x + dp, e.point.y + dp]], { layers: ['disruption-rings', 'disruption-lines'] });
        const hit = dis.find(f => f.layer.id === 'disruption-rings') ?? dis[0];
        if (hit) return onDisruptionTap(hit.properties.id);
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
    // The right and middle mouse buttons turn and tilt the map round the point under the pointer where the drag
    // starts, which stays under it (Max, 2026-11-13 evening: "should pivot the view at the mouse pointer, not center
    // of frame"); while a train is followed, round the train, which stays where it is (followRotation). The right
    // button is MapLibre's own (around: 'pointer'; tilting also brings the camera closer, as it keeps its distance);
    // the middle one is ours (Max, 2026-11-13): sideways turns, up and down tilts, at MapLibre's speeds (0.8° and
    // 0.5° a pixel), the point kept under the pointer. The browser's own middle-click scrolling is kept off the map.
    followRotation(false);
    let middle = null;
    map.getCanvasContainer().addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const r = map.getCanvasContainer().getBoundingClientRect(), point = { x: e.clientX - r.left, y: e.clientY - r.top };
      const at = map.unproject([point.x, point.y]);
      // The point to turn round: under the pointer (not when following: the camera holds the train, above).
      middle = { x: e.clientX, y: e.clientY, point, anchor: following ? null : { lon: at.lng, lat: at.lat } };
    });
    window.addEventListener('mousemove', (e) => {
      if (!middle) return;
      if (!(e.buttons & 4)) { middle = null; return; }   // let go outside the window
      const dx = e.clientX - middle.x, dy = e.clientY - middle.y;
      middle.x = e.clientX;
      middle.y = e.clientY;
      const bearing = map.getBearing() + dx * 0.8, pitch = Math.max(0, Math.min(map.getMaxPitch(), map.getPitch() - dy * 0.5));
      if (!middle.anchor) return map.jumpTo({ bearing, pitch });
      const tr = map._camera.transform.clone();
      tr.setBearing(bearing);
      tr.setPitch(pitch);
      map.jumpTo({ bearing, pitch, center: centreHolding(middle.anchor, middle.point, tr) });
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 1) middle = null; });
    map.on('render', placeNearLabels);
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
  selEl.innerHTML = '<div class="sel-dot"><svg viewBox="0 0 64 64" aria-hidden="true"><polygon points="" ' +
    'fill="currentColor" stroke="#fff" stroke-width="6" stroke-linejoin="round"/></svg></div><div class="sel-label"></div>';
  const selDot = selEl.firstChild, selLabel = selEl.lastChild, selShape = selEl.querySelector('polygon');
  // Placed to the exact (fractional) pixel: rounded to whole pixels, the ring flickered between two pixels on phones,
  // whose screen middle falls on a half pixel (measured 2026-11-12: moved in 4 of 10 frames; 0 with this).
  const selMarker = new Marker({ element: selEl, anchor: 'center', subpixelPositioning: true });
  let selShown = false, selText = '', selClass = '';

  // ---- Close in, the trains' labels ----
  // From the zoom where the models show, each train's label (company above number and lateness) and the "3 trains"
  // label of trains standing close together (Max, 2026-11-12: labels stacked at Stockholm C) are page elements,
  // placed after every frame the map draws, from the same places as the 3D trains (Max, 2026-11-14, from his note
  // "train labels flicker when zoomed in close": drawn by the map they were redone about 10 times a second through
  // its background worker and sawed up to 3 px, at most 10, behind their trains). The selected train has its own
  // label (its marker, above these). Further out the map draws the labels (train-labels), leaving out overlaps.
  const nearBox = document.createElement('div');
  nearBox.className = 'near-labels';
  map.getCanvasContainer().appendChild(nearBox);   // before the selection marker, which is added later: it stays on top
  // The stations' names close in, above the trains' labels (Max, 2026-11-13: station names "always on top of other
  // labels"; the map's own names can't be above page elements). A name that would overlap one already placed is
  // left out, as the map does, in the same order every frame so names don't swap.
  const namesBox = document.createElement('div');
  namesBox.className = 'station-names';
  map.getCanvasContainer().appendChild(namesBox);
  const nameEls = new globalThis.Map();   // station signature -> its element
  const NAME_DY = 15.4;   // the name's bottom above the station's point (as the map's: 1.1 em of 14 px)
  function placeStationNames(W, H) {
    if (map.getZoom() < Math.max(11, modelZoom())) {
      if (nameEls.size) { namesBox.replaceChildren(); nameEls.clear(); }
      return;
    }
    const placed = [], keep = new Set();
    for (const f of data.stations.features) {
      const q = map.project(f.geometry.coordinates);
      if (q.x < -120 || q.x > W + 120 || q.y < -20 || q.y > H + 60) continue;
      const { sig, name } = f.properties, w = String(name).length * 7.6 + 6, b = { l: q.x - w / 2, r: q.x + w / 2, t: q.y - NAME_DY - 18, bt: q.y - NAME_DY };
      if (placed.some(o => o.l < b.r && b.l < o.r && o.t < b.bt && b.t < o.bt)) continue;
      placed.push(b);
      keep.add(sig);
      let el = nameEls.get(sig);
      if (!el) {
        el = Object.assign(document.createElement('div'), { className: 'station-name', textContent: name });
        el.dataset.sig = sig;
        namesBox.appendChild(el);
        nameEls.set(sig, el);
      }
      el.style.transform = `translate(${q.x.toFixed(1)}px, ${(q.y - NAME_DY).toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [sig, el] of nameEls) if (!keep.has(sig)) { el.remove(); nameEls.delete(sig); }
  }
  // The station whose name (close in) is under a point of the map, or null.
  function stationNameAt(pt) {
    if (!nameEls.size) return null;
    const c = box.getBoundingClientRect(), x = pt.x + c.left, y = pt.y + c.top;
    for (const [sig, el] of nameEls) {
      const r = el.getBoundingClientRect();
      if (x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 3 && y <= r.bottom + 3) return sig;
    }
    return null;
  }
  let nearProps = new globalThis.Map();   // id -> the properties setTrains got for each train near the view
  const nearEls = new globalThis.Map();   // key -> { el, text, ids }
  const LABEL_DY = 12;   // the label's top below the train's point (the map's labels: 1.1 em of 11 px)
  function placeNearLabels() {
    if (!isReady) return;
    const { clientWidth: W, clientHeight: H } = box, pts = [];
    placeStationNames(W, H);
    if (map.getZoom() < modelZoom()) {
      if (nearEls.size) { nearBox.replaceChildren(); nearEls.clear(); }
      return;
    }
    for (const x of getTrains3d?.() ?? []) {
      const pr = x.id !== selected && nearProps.get(x.id);
      if (!pr) continue;
      const q = map.project([x.lon, x.lat]);
      if (q.x > -80 && q.y > -80 && q.x < W + 80 && q.y < H + 80) pts.push({ id: x.id, x: q.x, y: q.y, pr });
    }
    // Groups: the trains within GROUP_PX of the first one not yet in a group, in a fixed order (so groups don't swap).
    pts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const used = new Set(), keep = new Set();
    for (const p of pts) {
      if (used.has(p.id)) continue;
      const g = pts.filter(o => !used.has(o.id) && Math.hypot(o.x - p.x, o.y - p.y) <= GROUP_PX);
      for (const o of g) used.add(o.id);
      const one = g.length === 1, key = one ? g[0].id : `g:${g.map(o => o.id).join('|')}`;
      let n = nearEls.get(key);
      if (!n) {
        n = { el: document.createElement('div'), text: null, ids: g.map(o => o.id) };
        nearBox.appendChild(n.el);
        nearEls.set(key, n);
      }
      keep.add(key);
      const text = one ? `${g[0].pr.company ?? ''}|${g[0].pr.label}|${g[0].pr.stale}` : `${g.length}${t('nTrains')}`;
      if (text !== n.text) {
        n.text = text;
        if (one) {
          const { company, label, stale } = g[0].pr;
          n.el.className = `near-label${stale ? ' stale' : ''}`;
          n.el.replaceChildren(...(company ? [Object.assign(document.createElement('span'), { className: 'co', textContent: company }), '\n'] : []), String(label));
        } else {
          n.el.className = 'near-label group';
          n.el.textContent = text;
        }
      }
      const x = g.reduce((s, o) => s + o.x, 0) / g.length, y = g.reduce((s, o) => s + o.y, 0) / g.length;
      n.el.style.transform = `translate(${x.toFixed(1)}px, ${(y + LABEL_DY).toFixed(1)}px) translateX(-50%)`;
    }
    for (const [key, n] of nearEls) if (!keep.has(key)) { n.el.remove(); nearEls.delete(key); }
  }
  // The close-in label under a point of the map (screen pixels), with 3 px to spare, or null.
  function nearLabelAt(pt) {
    if (!nearEls.size) return null;
    const c = box.getBoundingClientRect();
    for (const n of nearEls.values()) {
      const r = n.el.getBoundingClientRect(), x = pt.x + c.left, y = pt.y + c.top;
      if (x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 3 && y <= r.bottom + 3) return n;
    }
    return null;
  }

  // ---- Following a train ----
  // The followed train is held at a point on the screen, its focus: at first the middle of the map above the panel,
  // after a drag wherever the drag left it. The room kept free for the panel (the camera's padding) is no longer
  // changed for this: in a tilted view a change of it changes the perspective, so the whole map jumped when a drag
  // was let go (Max, 2026-11-13 evening: "snaps into a slightly different position after letting go", "snaps and
  // turns"; measured at 55° tilt: the size round the train jumped 29 % in one frame; flat, nothing moved).
  let following = null;       // { getPlace, onEnd, locked, focus: { x, y }, place }
  if (import.meta.env.DEV) window.__followFocus = () => following?.focus ?? null;   // for tools/follow-check.mjs
  let lastTick = 0;
  const pointers = new Set(); // fingers (or the mouse button) down on the map
  const box = map.getContainer();
  box.addEventListener('pointerdown', e => pointers.add(e.pointerId), true);
  for (const type of ['pointerup', 'pointercancel'])
    window.addEventListener(type, e => pointers.delete(e.pointerId), true);
  window.addEventListener('blur', () => pointers.clear());   // a release outside the window is never seen
  // The panel covers up to 45 % of the screen's bottom (index.html); its top edge, with a margin.
  const panelTop = () => box.clientHeight - (Math.round(box.clientHeight * 0.45) + 20);
  const defaultFocus = () => ({ x: box.clientWidth / 2, y: panelTop() / 2 });
  // How far (in screen pixels) a place is from the point the train is held at.
  const offFocus = (p) => {
    const at = map.project([p.lon, p.lat]);
    return Math.hypot(at.x - following.focus.x, at.y - following.focus.y);
  };
  // The camera's middle that puts a place ({ lon, lat }) at a screen point, for a camera (MapLibre 6's own camera
  // state, not a public call; maplibre-gl is pinned).
  function centreHolding(place, point, tr = map._camera.transform) {
    const t = tr.clone();
    t.setLocationAtPoint(new LngLat(place.lon, place.lat), new Point(point.x, point.y));
    return t.center;
  }
  // Flights the page starts itself (to a station, a whole route): left alone, like a drag and its fling.
  let flying = false;
  // Holding on: every change of the camera (a wheel or pinch zoom, a turn, the + and − buttons, the zoom slider,
  // the arrow keys) is corrected before it is drawn so the followed train stays exactly on its focus. (Zooms and
  // turns go round the screen's middle, not the focus; this puts the train back in the same frame.)
  // MapLibre's own hook for this (set only while following): it is handed each camera about to be drawn.
  const holding = () => following?.locked && following.place && !flying && !dragged && !map.dragPan.isActive();
  // A flight to the followed train (a train picked in the search) aims, frame by frame, at where the train is now
  // rather than where it was when it was picked: shifted by how far it has moved since (Max, 2026-11-13 evening: "it
  // sort of misses the train a bit, then camera snaps to the correct view after a beat").
  let chase = null;   // { lon, lat }: where the train was when the flight started
  const holdTrain = (next) => {
    if (flying && chase && following?.place) {
      const c = next.center;
      return { center: new LngLat(c.lng + following.place.lon - chase.lon, c.lat + following.place.lat - chase.lat) };
    }
    return holding() ? { center: centreHolding(following.place, following.focus, next) } : {};
  };
  const landed = () => { flying = false; chase = null; };
  // While following, a zoom (wheel or pinch) zooms around the train rather than around the fingers.
  function zoomAroundCenter(on) {
    // The wheel's enable() does nothing when it is already on (so the option was never taken): off first.
    map.scrollZoom.disable();
    map.scrollZoom.enable(on ? { around: 'center' } : undefined);
    map.touchZoomRotate.enable(on ? { around: 'center' } : undefined);
  }
  // The right mouse button's turning: round the pointer, or while following round the screen's middle (the camera
  // update hook keeps the train on its focus, so it turns round the train).
  function followRotation(on) {
    map.dragRotate.disable();
    map.dragRotate.enable(on ? { around: 'center' } : { around: 'pointer' });
  }
  function stopFollowing(tell = true) {
    const end = following?.onEnd;
    following = null;
    zoomAroundCenter(false);
    followRotation(false);
    map.setTransformCameraUpdate(null);
    if (tell) end?.();
  }
  // A drag while following re-frames it: where the train is on the screen when the map comes to rest becomes its
  // focus (Max, 2026-11-13: "when clicking, dragging, then releasing - that should be the new center for the follow
  // ... so that you can reframe how you want it stuck"). Dragging doesn't stop following; a single tap on the map
  // closes the train (main.js). Kept on the screen and above the panel. Nothing else moves when it is let go.
  // Dragged away, off the screen or behind the panel, the train is let go (Max, 2026-11-13 evening: "if you drag too
  // far from the train it should let it go. Especially if it is off screen"): the camera stops following it, but it
  // stays chosen with its card open, "Follow" in the card follows again (Max, 2026-11-14: "Remove the automatic
  // deselect of a train when scrolling too far away"; until then it was closed). LET_GO_PX: how far past the edge
  // its middle must be (0: just past it).
  const LET_GO_PX = 0;
  let dragged = false;
  map.on('dragstart', () => { dragged = true; });
  map.on('moveend', () => {
    if (flying && !map._camera?.isEasing?.()) landed();
    if (!dragged || pointers.size) return;
    dragged = false;
    const p = following?.getPlace();
    if (!p) return;
    const { clientWidth: w, clientHeight: h } = box, at = map.project([p.lon, p.lat]);
    const panelEdge = h - Math.round(h * 0.45) - 10;   // the panel's top (index.html: 45 % high, 10 px from the bottom)
    if (at.x < -LET_GO_PX || at.x > w + LET_GO_PX || at.y < -LET_GO_PX || at.y > panelEdge + LET_GO_PX) return stopFollowing(true);
    following.focus = { x: Math.max(30, Math.min(w - 30, at.x)), y: Math.max(70, Math.min(panelTop() - 30, at.y)) };
    following.locked = false;   // locks again at once, or glides back inside the edges
    following.gap = null;
  });
  // Put the camera's middle on a place without stopping a zoom or turn in progress: MapLibre's jumpTo stops every
  // gesture, so the camera used to keep still until a zoom had ended and then catch up (Max, 2026-11-13: "the
  // camera stops for a beat, then recenters"). This uses MapLibre 6's own camera (not a public call; maplibre-gl is
  // pinned): false when it isn't there, and the camera then waits as before.
  function centerDuringGesture(centre) {
    const camera = map._camera;
    if (typeof camera?.applyTransformChange !== 'function') return false;
    camera.applyTransformChange(tr => tr.setCenter(centre));
    map.triggerRepaint();
    return true;
  }

  const loaded = new Set();

  let isReady = false;
  let lastDrawnPlace = null;   // drawIfMoved
  let lastTrainsSent = 0;      // setTrains
  ready.then(() => { isReady = true; });

  // The first view with only Sweden (Max, 2026-11-13: "the whole world shows first, then the Sweden mask kicks
  // in"; the cover is its own file and came about 0.4 s after the base map). Resolves once the base map, the cover
  // outside Sweden and the names left out abroad are all on screen; after FIRST_VIEW_MAX_MS whatever there is.
  const shown = new Promise((resolve) => {
    const giveUp = setTimeout(resolve, FIRST_VIEW_MAX_MS);
    const check = () => {
      let done = false;
      try {
        done = isReady && (namesFiltered || maskFailed) && map.isSourceLoaded('sweden-mask') && map.areTilesLoaded();
      } catch { done = false; }   // the cover's source isn't there yet
      if (!done) return;
      map.off('render', check);
      map.off('idle', check);
      clearTimeout(giveUp);
      map.once('render', () => resolve());   // one more frame, so what was just loaded has been drawn
      map.triggerRepaint();
    };
    map.on('render', check);
    map.on('idle', check);
  });

  return {
    ready,
    shown,
    // How long between two refreshes of the dots and labels (ms): the time the fastest train takes to move a quarter
    // of a pixel at this zoom, at least 33 ms (30 a second) and at most a second. Far out a train needs many seconds
    // to move one pixel (at the opening view about 20), and the 30 refreshes a second it got showed nothing new.
    // Always 33 ms while the map itself moves (a drag, a zoom, a flight) and from just before the models show.
    // following: the camera follows a train among the models, so the map is drawn in every frame anyway; the others
    // are then moved on as soon as the fastest could have gone half a pixel (every frame from about zoom 16).
    trainsEvery(following = false) {
      const z = map.getZoom();
      const metresPerPx = 40075016.686 * Math.cos(map.getCenter().lat * Math.PI / 180) / (512 * 2 ** z);
      if (following && modelsAt(z)) return Math.min(33, 1000 * 0.5 * metresPerPx / FASTEST_MS);
      if (map.isMoving() || z >= modelZoom() - 1) return 33;
      return Math.max(33, Math.min(1000, 1000 * 0.25 * metresPerPx / FASTEST_MS));
    },
    // Is a place in the view, or within half a view's width or height outside it? (lon, lat) -> true / false.
    // Only those trains are given to setTrains: the margin is far more than a train or the map moves between two
    // refreshes, and the groups (40 px) never reach across it.
    nearView() {
      const b = map.getBounds();
      const padLon = (b.getEast() - b.getWest()) * 0.5, padLat = (b.getNorth() - b.getSouth()) * 0.5;
      const w = b.getWest() - padLon, e = b.getEast() + padLon, s = b.getSouth() - padLat, n = b.getNorth() + padLat;
      return (lon, lat) => lon >= w && lon <= e && lat >= s && lat <= n;
    },
    // Called 30 times a second with the trains in and near the view, where they are now.
    setTrains(geojson) {
      data.trains = geojson;
      nearProps = new globalThis.Map(geojson.features.map(f => [f.properties.id, f.properties]));   // the close-in labels' words
      if (!isReady) return;
      // From the model zoom the dots are unseen; they only help a tap find a train. They are sent twice a second
      // there, and in between the map is only drawn again (the models move); every refresh used to cost two draws.
      const t = performance.now();
      if (modelsAt(map.getZoom()) && t - lastTrainsSent < 500) { map.triggerRepaint(); return; }
      lastTrainsSent = t;
      map.getSource('trains').setData(geojson);
    },
    // Follow a train: hold it in the middle of the view above the train panel (which covers up to 45 % of the
    // screen's bottom). getPlace() -> { lon, lat } where the train is drawn now, or null when it is gone.
    // Zoom, turn and tilt stay the user's; a drag moves the point the train is held at (above). onEnd() is called
    // when following stops by itself: the train is gone, or a drag took it off the screen or behind the panel (above).
    async follow(getPlace, onEnd) {
      await ready;
      dragged = false;
      following = { getPlace, onEnd, locked: false, focus: defaultFocus(), place: null };
      zoomAroundCenter(true);
      followRotation(true);
      map.setTransformCameraUpdate(holdTrain);
    },
    unfollow() { following = null; zoomAroundCenter(false); followRotation(false); map.setTransformCameraUpdate(null); },
    get following() { return Boolean(following); },
    // Whether trains are drawn as models at the zoom shown now.
    get modelsShown() { return modelsAt(map.getZoom()); },
    // Called every drawing frame: move the camera along with the followed train.
    tick(now) {
      const dt = Math.min(now - lastTick, 200);
      lastTick = now;
      if (!following || !isReady) return;
      const p = following.getPlace();
      if (!p) return stopFollowing();
      following.place = p;
      if (flying && !map.isMoving()) landed();   // a flight that ended without a moveend
      // A drag (one finger or the mouse moving the map), its fling and the page's own flights are left alone. A zoom
      // or turn in progress (a wheel, a pinch, the compass, the + and − buttons) isn't stopped: the camera keeps on
      // the train during it.
      if (dragged || flying || (map.dragPan.isActive() && pointers.size < 2)) { following.locked = false; following.gap = null; return; }
      const busy = pointers.size > 0 || map.isMoving();
      const moveTo = (centre) => {
        if (!busy) map.jumpTo({ center: centre });
        else if (!centerDuringGesture(centre)) following.locked = false;
      };
      const off = offFocus(p);
      if (following.locked && off < 0.05) return;   // already there: moving the camera would only draw the map again
      const target = centreHolding(p, following.focus);
      if (following.locked && off < 30) return moveTo(target);
      // Not on it yet (just tapped, a drag left it outside the edges, or the train jumped): the gap closes in about
      // half a second, then it stays locked on. The gap is kept against the moving train, so a fast train is caught
      // too (gliding towards where it was each frame, a train at 300 km/h stayed 8 px behind and never locked).
      if (off < 1) { following.locked = true; following.gap = null; return moveTo(target); }
      const k = 1 - Math.exp(-dt / 150);
      if (!following.gap) { const c = map.getCenter(); following.gap = { lng: c.lng - target.lng, lat: c.lat - target.lat }; }
      following.gap.lng *= 1 - k;
      following.gap.lat *= 1 - k;
      moveTo(new LngLat(target.lng + following.gap.lng, target.lat + following.gap.lat));
    },
    // The passenger stations: [{ sig, name, lon, lat }].
    // The disruptions to show (src/disruptions.js): a GeoJSON of their stretches and marks ({ id, level }).
    async setDisruptions(geojson) {
      data.disruptions = geojson ?? empty();
      await ready;
      if (isReady) map.getSource('disruptions').setData(data.disruptions);
    },
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
        const along = progressAlong(path);
        const share = (k, f) => along[k] + ((along[k + 1] ?? along[k]) - along[k]) * (f ?? 0);
        path.stops.forEach((c, i) => features.push({ type: 'Feature', properties: { f: share(path.stopAt[i], path.stopF?.[i]) },
          geometry: { type: 'Point', coordinates: c } }));
      }
      pathMetres = 0;
      if (path) for (let i = 1; i < path.coords.length; i++) {
        const [a, b] = [path.coords[i - 1], path.coords[i]], k = Math.cos(a[1] * Math.PI / 180);
        pathMetres += Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111195;
      }
      data.path = { type: 'FeatureCollection', features };
      await ready;
      if (isReady) map.getSource('path').setData(data.path);
    },
    // How far along the shown path the train is (0 to 1, as path.js progressAt): the darker green ends there.
    setPathProgress(f) {
      // Only when the change shows: half a pixel along the path at this zoom. The colours were set again in every
      // frame, each time making the line's colour ramp anew.
      const metresPerPx = 40075016.686 * Math.cos(map.getCenter().lat * Math.PI / 180) / (512 * 2 ** map.getZoom());
      if (Math.abs(f - pathProgress) * pathMetres < 0.5 * metresPerPx && !(f === 0 || f === 1)) return;
      if (Math.abs(f - pathProgress) < 1e-6) return;
      pathProgress = f;
      if (!isReady || !map.getLayer('path-line')) return;
      const c = pathColours();
      map.setPaintProperty('path-line', 'line-gradient', c.line);
      map.setPaintProperty('path-stops', 'circle-stroke-color', c.stops);
    },
    // Show the whole of a path above the panel at the bottom.
    async fitPath(path) {
      await ready;
      if (!path || path.coords.length < 2) return;
      const lons = path.coords.map(c => c[0]), lats = path.coords.map(c => c[1]);
      const h = map.getContainer().clientHeight;
      flying = true;
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: { top: 70, bottom: Math.round(h * 0.45) + 30, left: 30, right: 60 }, duration: 1000, maxZoom: 13 });
    },
    // Fly to a place ({ lon, lat }), zooming in to at least minZoom, so that it lands in the middle of the map above
    // the panel or board (the room kept free for those is no longer changed: in a tilted view that made the map
    // jump, Max 2026-11-13 evening: "when deselecting a train the camera snap zooms out a bit").
    // train: the place is the followed train's (the flight then keeps aiming at it, above).
    async goTo(place, minZoom, train = false) {
      await ready;
      flying = true;   // the camera leaves the followed train alone until it lands
      chase = train ? { lon: place.lon, lat: place.lat } : null;
      const f = defaultFocus();
      map.flyTo({ center: [place.lon, place.lat], zoom: Math.max(map.getZoom(), minZoom), duration: 1200, essential: true,
        offset: [f.x - box.clientWidth / 2, f.y - box.clientHeight / 2] });
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
      // Moved only when the train moved (the map moves it with the camera itself).
      const ll = selMarker.getLngLat();
      if (!selShown || ll.lng !== place.lon || ll.lat !== place.lat) selMarker.setLngLat([place.lon, place.lat]);
      if (!selShown) { selMarker.addTo(map); selShown = true; }
      const text = props.company && map.getZoom() >= modelZoom() ? `${props.company}\n${props.label}` : props.label;
      if (text !== selText) selLabel.textContent = selText = text;
      const tri = triangles();
      const shape = arrow().join(' ');   // the selected train's arrow: the same shape as the map's
      if (selShape.getAttribute('points') !== shape) selShape.setAttribute('points', shape);
      const cls =`sel-train late-${props.stale ? 'stale' : props.late}${modelsAt(map.getZoom()) ? ' model' : ''}${tri ? ' tri' : ''}`;
      if (cls !== selClass) selEl.className = selClass = cls;
      // The triangle turned the way the train goes, on the screen (the map may be turned).
      const turn = tri ? `rotate(${((place.bearing ?? 0) - map.getBearing()).toFixed(1)}deg)` : '';
      if (selDot.style.transform !== turn) selDot.style.transform = turn;
      // Round a toy the ring is as wide as the toy is long, plus a margin; otherwise the dot-sized ring (CSS).
      const ring = isToy() && map.getZoom() >= modelZoom() ? `${settings.toySize + 16}px` : '';
      if (selEl.style.width !== ring) { selEl.style.width = ring; selEl.style.height = ring; }
    },
    // Draw the map now, in this frame (camera, 3D trains and the selection marker all from the same moment).
    drawNow() { if (isReady) map.redraw(); },
    // Draw now when this place ({ lon, lat }: the open train) has moved a tenth of a pixel or more since it was last
    // drawn here. A standing train then costs no drawing at all; a moving camera makes the map draw itself.
    drawIfMoved(place) {
      if (!isReady) return;
      const metresPerPx = 40075016.686 * Math.cos(place.lat * Math.PI / 180) / (512 * 2 ** map.getZoom());
      const was = lastDrawnPlace;
      const moved = !was || Math.hypot((place.lon - was.lon) * Math.cos(place.lat * Math.PI / 180), place.lat - was.lat) * 111195 >= 0.1 * metresPerPx;
      if (!moved) return;
      lastDrawnPlace = { lon: place.lon, lat: place.lat };
      map.redraw();
    },
    // Show one set of rail lines (a key of RAIL_SOURCES), or none (null).
    async showRail(id) {
      await ready;
      shownRail = id;
      if (isReady) for (const key of Object.keys(RAIL_SOURCES))
        map.setLayoutProperty(`rail-${key}`, 'visibility', key === id ? 'visible' : 'none');
      if (isReady && map.getLayer('rail-edge')) map.setLayoutProperty('rail-edge', 'visibility', id === 'trv' ? 'visible' : 'none');
      if (id && !loaded.has(id) && railData[id]) {
        loaded.add(id);
        railData[id]().then((g) => { data[`rail-${id}`] = g; map.getSource(`rail-${id}`)?.setData(g); })
          .catch(e => console.warn(`rail lines: ${e.message}`));
      }
    },
    get shownRail() { return shownRail; },
    // After a change of language: only the words on the map change (the buttons' names; the "3 trains" labels take
    // the new words on the next frame). The layers stay (they used to be taken away and added again).
    async relabel() {
      await ready;
      relabelControls();
      map.triggerRepaint();
    },
    // After a settings change (look, toys, zoom): our layers again, and for light/dark the other base map
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
        restyleBase(map, dark);
        removeLayers();
        addSources();
        addLayers();
        isReady = true;
      });
      map.setStyle(styleUrl(dark), { diff: false });
    },
  };
}
