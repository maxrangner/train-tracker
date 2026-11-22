// Peek (Max's idea 9, build plan part 6): press and hold a station on the map (about HOLD_MS, the finger still) and a
// small bubble at the finger shows its next three departures (time, where to, track, lateness). Lift the finger and it
// is gone; a plain tap still opens the board (the tap after a peek is eaten: ate()). With a mouse, holding the button
// the same way.
// deps: { box (the map's element), stationAt(x, y) in the box -> sig | null, load(sig) -> Promise of board rows
//   (fetchBoard's), stationName(sig), blocked() -> true while a peek must not start }
import { hhmm } from './clock.js';
import { t } from './i18n.js';
import { esc } from './html.js';
import { tagHtml } from './tag.js';
import { stateHtml } from './state.js';

export const HOLD_MS = 400;
const STILL_PX = 8;      // a finger moving more than this before the hold is a drag
const LEAVE_PX = 28;     // after the bubble shows, moving this far lets it go

export function createPeek({ box, stationAt, load, stationName, blocked = () => false }) {
  const bubble = Object.assign(document.createElement('div'), { id: 'peek', className: 'pop', hidden: true });
  bubble.setAttribute('role', 'status');
  document.body.append(bubble);
  let press = null, shown = null, eatUntil = 0, asked = 0;
  const pointers = new Set();

  function place(x, y) {
    const w = bubble.offsetWidth, h = bubble.offsetHeight;
    let top = y - h - 28;
    if (top < 8) top = y + 28;
    bubble.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x - w / 2))}px`;
    bubble.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, top))}px`;
  }
  function row(r) {
    const seen = r.actual ?? r.estimated, late = seen ? Math.round((seen - r.planned) / 60000) : 0;
    return `<div class="pk-row${r.canceled ? ' canceled' : ''}"><b>${hhmm(r.planned)}</b><span>${esc(r.to ? stationName(r.to) : '')}</span>` +
      `${r.canceled ? `<span class="tag late">${esc(t('cancelled'))}</span>` : late > 0 ? tagHtml(late, { short: true }) : ''}<i>${esc(r.track || '')}</i></div>`;
  }
  async function show(sig, x, y) {
    const n = ++asked;
    shown = { sig, x, y };
    bubble.innerHTML = `<small>${esc(stationName(sig))}</small>${stateHtml('loading', t('loading'))}`;
    bubble.hidden = false;
    place(x, y);
    try { navigator.vibrate?.(8); } catch { /* not here */ }
    let rows = null;
    try { rows = await load(sig); } catch { rows = null; }
    if (n !== asked || !shown) return;
    bubble.innerHTML = `<small>${esc(stationName(sig))} · ${esc(t('departures'))}</small>` +
      (rows === null ? `<p class="empty">${esc(t('tripNoAnswer'))}</p>` : rows.length ? rows.slice(0, 3).map(row).join('') : `<p class="empty">${esc(t('noDepartures'))}</p>`);
    place(x, y);
  }
  function hide() { if (!shown) return; shown = null; asked++; bubble.hidden = true; eatUntil = performance.now() + 500; }
  function cancel() { clearTimeout(press?.timer); press = null; }

  box.addEventListener('pointerdown', (e) => {
    pointers.add(e.pointerId);
    if (pointers.size > 1 || (e.pointerType === 'mouse' && e.button !== 0) || blocked()) { cancel(); hide(); return; }
    const r = box.getBoundingClientRect(), x = e.clientX, y = e.clientY;
    cancel();
    press = { id: e.pointerId, x, y, timer: setTimeout(() => {
      const sig = stationAt(x - r.left, y - r.top);
      if (press && sig) show(sig, x, y);
      press = null;
    }, HOLD_MS) };
  }, true);
  const move = (e) => {
    if (press && press.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > STILL_PX) cancel();
    if (shown && Math.hypot(e.clientX - shown.x, e.clientY - shown.y) > LEAVE_PX) hide();
  };
  const up = (e) => { pointers.delete(e.pointerId); cancel(); hide(); };
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  // (a phone's own long-press menu, over the map)
  box.addEventListener('contextmenu', (e) => { if (shown || press) e.preventDefault(); });
  return {
    // The tap that ends a peek opens nothing (src/main.js onMapTap).
    ate: () => performance.now() < eatUntil,
    get shown() { return shown?.sig ?? null; },
    hide,
  };
}
