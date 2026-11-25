// The day (src/day-view.js): the ribbon above the search bar, the map at an earlier moment, made the first time ☰ →
// The day is opened. Only the page reading the fetcher's files has the day's history; elsewhere a note says so. Also the
// map's free part: above the sheet, and above the ribbon while it is open (the slider and the map's buttons ride on it).
//
// createDay({ map, panel, panelEl, stack, frame, feeds, net, fromFiles, now, drawDelay }) -> { view (null until
//   opened), past, toggle(), back() (Esc's step: its bubble, then the ribbon at Home at rest), held(), pad(h) (the
//   sheet's resting height came) }; stack and feeds are getters.
import { createDayView, DAY_CSS } from './day-view.js';
import { isWide } from './layout.js';
import { t } from './i18n.js';

const SQUEEZE = { over: 74, slider: 190, room: 52 };   // the scale slider (74 px over the sheet, 190 tall) goes when it would reach the live mark

export function createDay({ map, panel, panelEl, stack, frame, feeds, net, fromFiles, now, drawDelay }) {
  document.head.append(Object.assign(document.createElement('style'), { textContent: DAY_CSS }));
  let view = null, sheetPad = 0;

  function pad() {
    const h = view?.isOpen ? view.el.offsetHeight + 10 : 0, root = document.documentElement;
    root.style.setProperty('--ribbon-h', !isWide() && h ? `${h}px` : '0px');
    // (not while the card's "to …" chooser is open: it shuts back to the same height, and the map stays still)
    const st = stack();
    const choosing = panelEl.classList.contains('picking') && panel.openId && !panel.hidden && st?.top() === `train:${panel.openId}`;
    if (!choosing) map.setSheet(sheetPad + h);
    root.classList.toggle('scale-squeezed', innerHeight - (!isWide() ? sheetPad + h : 0) - SQUEEZE.over - SQUEEZE.slider < SQUEEZE.room);
  }
  addEventListener('resize', () => { if (view?.isOpen) { pad(); view.draw(); } });

  function make() {
    view = createDayView({ history: (a, b) => feeds().history(a, b), now, delay: drawDelay, net,
      onMode(past) {
        frame.invalidate(!past);   // (back to live: the live trains at once, from the next frame)
        if (past) { stack().home(0); map.unfollow(); }
        else {
          const top = stack().top();
          if (top && stack().pageDef(top)?.kind === 'onlylive') stack().replace(top);
        }
        map.sunUpdate(true);
      },
      onClose: pad });
    if (import.meta.env.DEV) window.__day = view;   // (tools/day-check.mjs)
  }
  return {
    get view() { return view; },
    get past() { return Boolean(view?.past); },
    // (open: the shop window waits; src/shop-window.js)
    get busy() { return Boolean(view?.isOpen || view?.past); },
    toggle() {
      if (!fromFiles || !feeds()?.history) { map.note(t('dayNeedsFiles')); return; }
      if (!view) make();
      if (view.isOpen) { view.close(); return; }
      stack().home(0);
      view.open();
      pad();
      stack().guard();   // (the browser's back closes it: src/back.js)
    },
    // A train or a group tapped at an earlier moment: a small bubble over it instead of its page.
    bubble(ids) { view.bubble(ids); stack().guard(); },
    back() {
      if (view?.bubbleShown) { view.hideBubble(); return true; }
      const st = stack();
      if (view?.isOpen && st.top() === 'home' && !st.searching && st.level === 0) { view.close(); return true; }
      return false;
    },
    held: () => Boolean(view?.bubbleShown || view?.isOpen),
    pad(h) { sheetPad = h; pad(); },
    relabel() { view?.relabel(); },
    draw() { view?.draw(); },
  };
}
