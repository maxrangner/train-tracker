// A station's page: its board (src/board.js, one #board moved into whichever station page shows), "Save a trip from
// here", once ever the tip about Peek; the camera flies there, or rides a train's line there from that train's page.
//
// createStationPages({ stations, map, route, favourites, holder, stack, pickTrain, trains, live, settings, now })
//   -> { define(sig), open(sig, opts), board }; stack is a getter.
import { createBoard } from '../board.js';
import { fetchBoard, fetchStationDay, fetchStationMessages } from '../trafikverket.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { esc } from '../html.js';

const PEEK_TIP = 'peekTipSeen';   // (the tip shows on the first board ever opened on this phone)
function peekTipSeen() {
  try { if (localStorage.getItem(PEEK_TIP) === 'true') return true; localStorage.setItem(PEEK_TIP, 'true'); } catch { /* shown, not remembered */ }
  return false;
}

export function createStationPages(ctx) {
  const { stations, map, route, favourites, holder, pickTrain, trains, live, settings, now } = ctx;
  const boardEl = document.getElementById('board');
  const board = createBoard(boardEl, {
    load: (sig, activity) => fetchBoard(sig, activity, now(), settings.boardRows),
    loadDay: (sig, activity) => fetchStationDay(sig, activity, now()),
    stationName: stations.name,
    onPickTrain: tr => pickTrain({ ...tr, onMap: Boolean(trains.get(tr.id)) }),
    messages: live ? sig => fetchStationMessages(sig, now()) : null,
    onFull: full => boardFull(full),
  });
  // The board's messages or its search want room: the sheet goes to full; folded or closed, back to where it was.
  function boardFull(full) {
    const stack = ctx.stack;
    if (!stack?.top()?.startsWith('station:')) stack?.releaseFull('board', false);
    else if (full) stack.requestFull('board');
    else stack.releaseFull('board');
  }
  function stationPage(sig) {
    const st0 = stations.get(sig);
    if (!st0) return null;
    const extra = Object.assign(document.createElement('div'), { className: 'st-extras' });
    extra.innerHTML = `<button type="button" class="chip" data-go="newtrip:${esc(sig)}">${icon('trip', 17)}${esc(t('saveTripHere'))}</button>`;
    return {
      name: () => stations.get(sig)?.name ?? st0.name, kind: 'station', snap: false,
      show(el, { prev, dir, again = false }) {
        el.append(boardEl, extra);
        if (!again && !peekTipSeen()) extra.insertAdjacentHTML('afterbegin', `<p class="tip">${icon('info', 16)}<span>${esc(t('peekTip'))}</span></p>`);
        const st = stations.get(sig) ?? st0;
        if (board.openSig !== sig) board.open(st);
        map.unfollow();
        if (again) return;
        // From a train that stops here: the camera rides the train's line here (the line stays meanwhile).
        const prevTrain = prev?.kind === 'train' ? prev.key.slice(6) : null;
        const riding = dir !== 0 && prevTrain ? route.ride(prevTrain, sig, stations.shownAt(st)) : null;
        if (riding) { riding.then(() => route.clearUnlessOpen()); return; }
        route.clearUnlessOpen();
        if (dir !== 0) map.goTo(stations.shownAt(st), dir > 0 ? 13 : 11);   // (lands above the sheet)
      },
      hide() { if (board.openSig === sig) board.close(); holder.append(boardEl); },
      unmount() { if (board.openSig === sig) board.close(); if (boardEl.parentElement !== holder && !ctx.stack.top()?.startsWith('station:')) holder.append(boardEl); },
      star: { on: () => favourites.has('station', sig), toggle: () => favourites.toggle('station', sig) },
      redraw: () => board.relabel(),
    };
  }
  return {
    define: stationPage, board,
    open(sig, { go = false } = {}) { if (stations.get(sig)) ctx.stack.open(`station:${sig}`, { go }); },
  };
}
