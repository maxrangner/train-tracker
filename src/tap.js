// A button that answers a finger at once, also right after a swipe (Max, 2026-11-20: "the menu doesn't react
// directly when a screen is dismissed"). Measured in the test browser: for about 0.4 s after a swipe ends, a tap gets
// its pointerdown and pointerup but no click (the browser takes it as stopping the swipe), so ☰ did nothing until the
// card had slid away. Here a finger lifted on the button, not moved, acts; the click that may follow is skipped. A
// mouse, a pen, the keyboard and tools' .click() still go through the click.
// (Until 2026-11-25 this lived in src/sheet.js with the sheets that dragged themselves, gone since the one sheet,
// src/stack.js.)
const CLICK_AFTER_MS = 700;   // a touch's own click comes within this

export function onTap(el, fn) {
  let down = null, tappedAt = -Infinity, at = null;
  el.addEventListener('pointerdown', (e) => { down = e.pointerType === 'touch' ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null; });
  el.addEventListener('pointercancel', () => { down = null; });
  el.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || e.pointerId !== d.id || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
    tappedAt = performance.now(); at = { x: e.clientX, y: e.clientY };
    fn(e);
  });
  el.addEventListener('click', (e) => { if (performance.now() - tappedAt > CLICK_AFTER_MS) fn(e); });
  // (the click after that touch lands where the finger was: when the tap moved what was there (☰ lowering Home), it
  // fell on the map and closed the menu it had just opened; screens-check, 2026-11-25. Eaten there: at the finger's place.)
  document.addEventListener('click', (e) => {
    if (performance.now() - tappedAt > CLICK_AFTER_MS || el.contains(e.target) || Math.hypot(e.clientX - at.x, e.clientY - at.y) > 12) return;
    tappedAt = -Infinity;
    e.preventDefault(); e.stopPropagation();
  }, true);
}
