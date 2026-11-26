// The scale slider (Max's idea 10, "B": the whole bar with the thumb drag; 2026-11-22). One bar on the right edge with
// three named stops, Sweden – Town – Trackside: drag it and the map zooms with the same spot staying in place; in the
// last third the view tilts so the trains stand up as 3D models. It replaces + / − and the 3D button; the compass stays
// for a turned map. Each name is a button too. A pinch moves the thumb with the map. "Reduce motion": a name jumps.
//
// The bar's place f (0 at the bottom, Sweden; 1 at the top, Trackside) maps to zoom piece by piece through the stops,
// and to tilt only above TILT_FROM.

export const STOPS = [
  { key: 'sweden', f: 0 },
  { key: 'town', f: 0.5, zoom: 11 },
  { key: 'trackside', f: 1, zoom: 16.2, pitch: 60 },
];
export const TILT_FROM = 2 / 3;

// Zoom and tilt at bar place f, with minZoom the furthest out (all of Sweden on this screen).
export function cameraAt(f, minZoom) {
  const [a, b, c] = STOPS, f2 = Math.max(0, Math.min(1, f));
  const zoom = f2 <= b.f ? minZoom + (b.zoom - minZoom) * (f2 / b.f) : b.zoom + (c.zoom - b.zoom) * ((f2 - b.f) / (c.f - b.f));
  const pitch = f2 <= TILT_FROM ? 0 : c.pitch * ((f2 - TILT_FROM) / (1 - TILT_FROM));
  return { zoom, pitch };
}
// The bar place for a zoom (the thumb following a pinch).
export function placeOf(zoom, minZoom) {
  const [, b, c] = STOPS;
  if (zoom <= b.zoom) return Math.max(0, (zoom - minZoom) / (b.zoom - minZoom) * b.f);
  return Math.min(1, b.f + (zoom - b.zoom) / (c.zoom - b.zoom) * (c.f - b.f));
}

// map: MapLibre; around(): the screen point [x, y] the zoom holds still (the middle of the map's free part, above the
// sheet; or the followed train, which map.js holds itself); label(key): the stop's name in the page's language.
export function createScaleSlider(map, { around, label, reduce = () => false }) {
  const el = document.createElement('div');
  el.className = 'scale';
  el.innerHTML = `<div class="scale-names">${[...STOPS].reverse().map(s => `<button type="button" class="scale-name" data-stop="${s.key}"></button>`).join('')}</div>` +
    '<div class="scale-track" role="slider" tabindex="0" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100"><i class="scale-tilt"></i><i class="scale-fill"></i><b class="scale-thumb"></b></div>';
  const track = el.querySelector('.scale-track'), names = [...el.querySelectorAll('.scale-name')];
  const minZoom = () => map.getMinZoom();
  let f = placeOf(map.getZoom(), minZoom()), dragging = null;

  function show() {
    el.style.setProperty('--f', f.toFixed(4));
    track.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    const near = STOPS.reduce((m, s) => (Math.abs(s.f - f) < Math.abs(m.f - f) ? s : m));
    track.setAttribute('aria-valuetext', label(near.key));
    for (const n of names) n.setAttribute('aria-pressed', String(Math.abs(STOPS.find(s => s.key === n.dataset.stop).f - f) < 0.04));
  }
  function relabel() {
    for (const n of names) n.textContent = label(n.dataset.stop);
    track.setAttribute('aria-label', `${label('sweden')} – ${label('trackside')}`);
    show();
  }
  // Move the camera to bar place g (now, or gliding over ms).
  function go(g, ms = 0) {
    f = Math.max(0, Math.min(1, g));
    const { zoom, pitch } = cameraAt(f, minZoom());
    // Below the tilt part the user's own tilt is kept; in it, the bar sets the tilt.
    const opts = { zoom, around: map.unproject(around()), duration: ms, essential: true };
    if (f > TILT_FROM || map.getPitch() > 0.5) opts.pitch = f > TILT_FROM ? pitch : Math.min(map.getPitch(), pitch || 0);
    map.easeTo(opts);
    show();
  }
  // A finger or mouse on the track: the place under it (top = 1).
  const placeAt = y => { const r = track.getBoundingClientRect(); return 1 - (y - r.top) / r.height; };
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    track.setPointerCapture(e.pointerId);
    dragging = e.pointerId; el.classList.add('held');
    go(placeAt(e.clientY), 0);
  });
  track.addEventListener('pointermove', (e) => { if (dragging === e.pointerId) go(placeAt(e.clientY), 0); });
  const end = (e) => { if (dragging !== e.pointerId) return; dragging = null; el.classList.remove('held'); };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
  track.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.05 : 0;
    if (!step) return; e.preventDefault(); go(f + step, reduce() ? 0 : 200);
  });
  for (const n of names) n.addEventListener('click', (e) => { e.stopPropagation(); go(STOPS.find(s => s.key === n.dataset.stop).f, reduce() ? 0 : 900); });
  // A pinch, a wheel or a flight: the thumb follows the map (not while the bar itself is being dragged).
  map.on('zoom', () => { if (dragging === null) { f = placeOf(map.getZoom(), minZoom()); show(); } });
  relabel();
  return { el, relabel, get place() { return f; }, go };
}
