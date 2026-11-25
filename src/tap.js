// A button that answers a finger at once, also right after a swipe (Max, 2026-11-20: "the menu doesn't react
// directly when a screen is dismissed"). Measured in the test browser: for about 0.4 s after a swipe ends, a tap gets
// its pointerdown and pointerup but no click (the browser takes it as stopping the swipe), so ☰ did nothing until the
// card had slid away. Here a finger lifted on the button, not moved, acts; the click that may follow is skipped. A
// mouse, a pen, the keyboard and tools' .click() still go through the click.
// (Until 2026-11-25 this lived in src/sheet.js with the sheets that dragged themselves, gone since the one sheet,
// src/stack.js.)
export function onTap(el, fn) {
  let down = null, tappedAt = -Infinity;
  el.addEventListener('pointerdown', (e) => { down = e.pointerType === 'touch' ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null; });
  el.addEventListener('pointercancel', () => { down = null; });
  el.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || e.pointerId !== d.id || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
    tappedAt = performance.now();
    fn(e);
  });
  el.addEventListener('click', (e) => { if (performance.now() - tappedAt > 700) fn(e); });
}
