// Bottom sheets (the Soft look, Max 2026-11-15: "everything opens from the bottom"). Every card and page (a train, a
// station's board, the search, the stats, Settings, Help, disruptions) is a sheet at the bottom of the screen; on a
// wide screen a card at the left. The screens still open and close themselves by their `hidden` attribute; this
// module only keeps the newest open sheet on top: the ones under it wait, unchanged, and come back when it closes
// (the train card is still there after Settings). raise(el) puts an already open sheet on top again.
// The handle at the top: drag up for full height, down for half height or (further) to close.
const DRAG_START_PX = 30;   // a drag starts in the sheet's top 30 px (the handle and the heading's empty space)
const CLOSE_PX = 90;        // dragged down this far from half height: closed

export function initSheets(els) {
  const order = [];   // the open sheets, oldest first
  const show = () => {
    const top = order.at(-1);
    for (const el of els) el.classList.toggle('behind', !el.hidden && el !== top);
  };
  const seen = new MutationObserver((changes) => {
    for (const { target: el } of changes) {
      const i = order.indexOf(el);
      if (i >= 0) order.splice(i, 1);
      if (!el.hidden) order.push(el);
      else el.classList.remove('full');   // opens at its own height next time
    }
    show();
  });
  for (const el of els) {
    el.classList.add('sheet');
    if (!el.hidden) order.push(el);
    seen.observe(el, { attributes: true, attributeFilter: ['hidden'] });
    dragHandle(el);
  }
  show();
  return {
    raise(el) {
      if (el.hidden) return;
      const i = order.indexOf(el);
      if (i >= 0 && i < order.length - 1) { order.splice(i, 1); order.push(el); show(); }
    },
  };
}

function dragHandle(el) {
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    const top = el.getBoundingClientRect().top;
    if (e.clientY - top > DRAG_START_PX || e.target.closest('button, input, a')) return;
    start = { y: e.clientY, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = e.clientY - start.y;
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : '';   // follows the finger downwards
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = e.clientY - start.y;
    start = null;
    el.style.transform = '';
    if (dy < -40) el.classList.add('full');
    else if (dy > 40 && el.classList.contains('full') && !el.classList.contains('page')) el.classList.remove('full');
    else if (dy > CLOSE_PX) el.querySelector('.panel-close, .menu-close')?.click();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
