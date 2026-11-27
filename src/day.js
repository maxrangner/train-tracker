// The day (src/day-view.js): the ribbon above the search bar, the map at an earlier moment, made the first time ☰ →
// The day is opened. Only the page reading the fetcher's files has the day's history; elsewhere a note says so. Also the
// map's free part: above the sheet, and above the ribbon while it is open (the slider and the map's buttons ride on it).
//
// A train tapped at an earlier moment is followed as live (Max, 2026-11-27: "I want the same as live"; docs/guide.md
// "Tap a train"): ringed, the map follows it at once, its bubble (instead of the card) has Following / Follow; zoom,
// turn and tilt keep following, a drag moves where it is held, dragged off the screen it is let go (src/map.js); a tap
// on the map stops following, the next one lets it go. Back to live (Live, ×, a play's end) it goes on as live: its
// card, followed, when it is on the map then.
//
// createDay({ map, panel, panelEl, stack, frame, feeds, net, fromFiles, now, drawDelay, buzz, openTrain, stationName }) -> { view
//   (null until opened), past, toggle(), tap(id) (a tap on the map at an earlier moment: true when it was The day's),
//   bubble(ids) (a group tapped), back() (Esc's step: its bubble, then the ribbon at Home at rest), held(), pad(h)
//   (the sheet's resting height came) }; stack and feeds are getters; openTrain(id) -> bool: its live card, followed.
import { createDayView } from './day-view.js';
import { isWide } from './layout.js';
import { t } from './i18n.js';

const SQUEEZE = { over: 74, slider: 190, room: 52 };   // the scale slider (74 px over the sheet, 190 tall) goes when it would reach the live mark

export function createDay({ map, panel, panelEl, stack, frame, feeds, net, fromFiles, now, drawDelay, buzz = () => {}, openTrain = () => false, stationName = sig => sig }) {
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

  // ---------- the picked train ----------
  const follow = id => map.follow(() => frame.placeNow(id), () => {});   // (let go by itself: its bubble says Follow, day-view)
  function pick(id) {
    buzz();
    map.select(id);
    view.bubble([id], id);
    follow(id);
    stack().guard();   // (the browser's back lets it go: src/back.js)
  }
  function unpick() {
    if (view?.picked) { map.unfollow(); map.select(null); }
    view?.hideBubble();
  }

  function make() {
    view = createDayView({ history: (a, b) => feeds().history(a, b), overview: () => feeds().fileOf('daysum').catch(() => null), stationName, now, delay: drawDelay, net,
      onMode(past, picked) {
        frame.invalidate(!past);   // (back to live: the live trains at once, from the next frame)
        if (past) { stack().home(0); map.unfollow(); }
        else {
          if (picked) { map.unfollow(); map.select(null); }
          const top = stack().top();
          if (top && stack().pageDef(top)?.kind === 'onlylive') stack().replace(top);
          // (the train picked then goes on as live: its card, followed, when it is on the map now)
          if (picked) openTrain(picked);
        }
        map.sunUpdate(true);
      },
      following: () => map.following,
      onFollow() { buzz(); if (map.following) map.unfollow(); else if (view.picked) follow(view.picked); },
      onPick: pick,
      onGone() { map.unfollow(); map.select(null); },
      onClose: pad });
    // (its bubble kept by its train as the camera moves, before the map draws: as the live label, src/map.js)
    map.onMove(() => view.placeBubble());
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
    // A tap on the map at an earlier moment (src/main.js onTrainTap): a train picks it; nothing stops following, then
    // lets the train go (as live). false: not The day's (live, or nothing of it shown).
    tap(id) {
      if (!view?.past) return false;
      if (id) { pick(id); return true; }
      if (view.picked && map.following) { map.unfollow(); return true; }
      if (view.bubbleShown) { unpick(); return true; }
      return false;
    },
    // A group tapped at an earlier moment: a row each in the bubble (a row picks that train).
    bubble(ids) { unpick(); view.bubble(ids); stack().guard(); },
    back() {
      if (view?.bubbleShown) { unpick(); return true; }
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
