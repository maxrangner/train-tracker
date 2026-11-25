// One way back, the same for Esc, Android's back button (the app) and the browser's back (src/stack.js popstate):
// ☰'s menu first, then The day's bubble (and its ribbon when nothing else is left), then the search and the pages
// (stack.back: the search, a page, the sheet down to rest).
//
// createBack({ nav, day, stack }) -> { step() (one step back; false: nothing was left), held() (something outside
//   the stack to step back from: the browser's back must stay ours) }; stack is a getter (made after this).
import { isNative, keyboardUp } from './layout.js';

export function createBack({ nav, day, stack }) {
  function step() {
    if (nav.isOpen) { nav.close(); return true; }
    if (day.back()) return true;
    return stack().back();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // (the board's own search closes itself on Esc)
    if (!nav.isOpen && document.activeElement?.matches?.('.board-q')) return;
    step();
  });
  // The app (Capacitor's bridge; the web page never loads it): with the keyboard up, back only hides it (one swipe closed
  // both it and the search); nothing left, the app goes to the background as Android's own back does.
  if (isNative()) {
    import('@capacitor/app').then(({ App }) => App.addListener('backButton', () => {
      if (keyboardUp()) { document.activeElement.blur(); return; }
      if (!step()) App.minimizeApp();
    }));
  }
  return { step, held: () => nav.isOpen || day.held() };
}
