// The line above the bar (Max, 2026-11-22): a thin line over the sheet's top edge that shows only when it has
// something to say. Several parts may want it at once; the one with the highest priority is shown.
// Now: the filter ("Showing only Mälartåg ×", src/main.js). Later: a saved trip's next train, "You seem to be on 231".
//   const line = createLine(el)
//   line.set(id, { html, onTap, onClose, priority })  html: its words (trusted HTML); onTap(): a tap on it; onClose():
//     shows a × at its end that calls it; priority: higher wins (default 0)
//   line.clear(id)
//   line.shown -> the id shown now, or null
export function createLine(el) {
  const items = new Map();
  let shown = null;
  function draw() {
    let best = null;
    for (const [id, it] of items) if (!best || (it.priority ?? 0) > (best[1].priority ?? 0)) best = [id, it];
    shown = best?.[0] ?? null;
    el.hidden = !best;
    if (!best) { el.replaceChildren(); el.dataset.id = ''; return; }
    const [id, it] = best;
    el.dataset.id = id;
    el.innerHTML = `<button type="button" class="line-main">${it.html}</button>` +
      (it.onClose ? '<button type="button" class="line-x" aria-label="×"><svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg></button>' : '');
    el.querySelector('.line-main').onclick = () => it.onTap?.();
    const x = el.querySelector('.line-x');
    if (x) { x.onclick = () => it.onClose(); if (it.closeLabel) x.setAttribute('aria-label', it.closeLabel); }
  }
  return {
    set(id, item) { items.set(id, item); draw(); },
    clear(id) { if (items.delete(id)) draw(); },
    get shown() { return shown; },
  };
}
