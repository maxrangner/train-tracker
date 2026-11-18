// The menu: opens from the ☰ button, so the main screen stays clean (Max, 2026-11-12). Search for a train number or
// a station; the full status line.
//
// findTrains(digits) -> trains on the map whose number starts with them: [{ id, number, company, time (latest report) }]
// findStations(text) -> passenger stations whose name matches: [{ sig, name }]
// searchTimetable(number) -> Promise of today's trips with exactly this number: [{ key, operational, date, number,
//   product, from, to, keys }] (from/to as names; keys: every piece of the trip, src/trip.js tripsOf). One row per
//   trip (Max 2026-11-16): a trip with a piece on the map is that piece's row; two pieces of one trip on the map at
//   once (at the handover; a quiet train stays on the map 2–15 min) become one row, the newest report's.
// onPickTrain({ id, operational, date, number, onMap }), onPickStation(station)
// favourites() -> { stations: [{ sig, name }], trains: [{ number, company, onMap }] }; onPickFavouriteTrain(number)

import { t } from './i18n.js';
import { icon } from './icons.js';
import { stateEl } from './state.js';

// All matches are listed (Max, 2026-11-12: 8 was too few; "2" matches 66 trains at rush hour); the list scrolls.
const MAX_ROWS = 200;
import { esc } from './html.js';

export function createMenu({ button, el, findTrains, findStations, searchTimetable, onPickTrain, onPickStation,
  favourites, onPickFavouriteTrain }) {
  const input = el.querySelector('#search');
  const list = el.querySelector('#search-results');
  let closedAt = 0;
  let asked = 0;   // counts searches, so a late timetable answer for an old search is dropped

  function open() {
    show(input.value.trim());
    el.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    input.focus();
    input.select();
  }
  function close() {
    if (el.hidden) return;
    el.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    input.blur();
    closedAt = performance.now();
  }
  button.onclick = () => (el.hidden ? open() : close());
  el.querySelector('.menu-close').onclick = close;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  // A tap outside the menu closes it (and that tap does nothing else, see justClosed).
  document.addEventListener('pointerdown', (e) => {
    if (!el.hidden && !el.contains(e.target) && !button.contains(e.target)) close();
  }, true);

  // ---- Search ----
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    show(input.value.trim());
  });
  input.addEventListener('keydown', (e) => {   // Enter picks the first result
    if (e.key === 'Enter') list.querySelector('button')?.click();
  });

  function row(html, pick) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = html;
    b.onclick = () => { close(); pick(); };
    li.append(b);
    return li;
  }
  const note = text => Object.assign(document.createElement('li'), { className: 'menu-note', textContent: text });

  function show(q) {
    const n = ++asked;
    list.replaceChildren();
    if (!q) return showFavourites();
    const digits = /^\d+$/.test(q);
    const trains = digits ? findTrains(q).slice(0, MAX_ROWS) : [];
    const stations = digits ? [] : findStations(q).slice(0, MAX_ROWS);
    const onMapRows = new Map();   // train id -> its row
    for (const tr of trains) {
      const li = row(`<b>${esc(tr.number)}</b> <span>${esc(tr.company || t('train'))} · ${t('onMap')}</span>`,
        () => onPickTrain({ ...tr, onMap: true }));
      onMapRows.set(tr.id, li);
      list.append(li);
    }
    for (const st of stations) list.append(row(`<b>${esc(st.name)}</b> <span>${t('station')}</span>`, () => onPickStation(st)));
    if (!digits && !stations.length) list.append(stateEl('empty', t('noStation'), 'li'));
    if (!digits) return;

    // A whole number: also today's timetable, for trains that aren't on the map (not started yet, or done).
    const waiting = stateEl('loading', t('lookingTimetable'), 'li');
    list.append(waiting);
    timer = setTimeout(async () => {
      let found;
      try { found = await searchTimetable(q); } catch (e) { if (n === asked) waiting.replaceWith(stateEl('error', t('timetableFailed', e.message), 'li')); return; }
      if (n !== asked) return;
      waiting.remove();
      const onMap = new Map(trains.map(tr => [tr.id, tr]));
      // Two pieces of one trip on the map: keep the newest report's row (the same time: the later piece's).
      for (const trip of found) {
        const here = trip.keys.filter(k => onMap.has(k));
        if (here.length < 2) continue;
        const keep = here.reduce((a, k) => ((onMap.get(k).time ?? 0) >= (onMap.get(a).time ?? 0) ? k : a));
        for (const k of here) if (k !== keep) onMapRows.get(k)?.remove();
      }
      const more = found.filter(tr => !tr.keys.some(k => onMap.has(k)));
      for (const tr of more.slice(0, MAX_ROWS)) {
        list.append(row(`<b>${esc(tr.number)}</b> <span>${esc([tr.product, tr.from && tr.to ? `${tr.from} → ${tr.to}` : ''].filter(Boolean).join(' · '))}</span>`,
          () => onPickTrain({ id: tr.key, operational: tr.operational, date: tr.date, number: tr.number, onMap: false })));
      }
      if (!trains.length && !more.length) list.append(stateEl('empty', t('noTrainToday', q), 'li'));
    }, 350);
  }

  // With the search field empty: the starred trains and stations.
  function showFavourites() {
    const f = favourites?.();
    if (!f) return;
    if (!f.trains.length && !f.stations.length) {
      list.append(note(t('favouritesHint')));
      return;
    }
    list.append(Object.assign(document.createElement('li'), { className: 'menu-label fav-label', textContent: t('favourites') }));
    for (const tr of f.trains) {
      list.append(row(`<b>${icon('starFilled', 15)} ${esc(tr.number)}</b> <span>${esc(tr.company || t('train'))}${tr.onMap ? ` · ${t('onMap')}` : ''}</span>`,
        () => onPickFavouriteTrain(tr.number)));
    }
    for (const st of f.stations) list.append(row(`<b>${icon('starFilled', 15)} ${esc(st.name)}</b> <span>${t('station')}</span>`, () => onPickStation(st)));
  }

  return {
    open, close,
    // Show the results again (Settings → Language changed).
    refresh() { if (!el.hidden) show(input.value.trim()); },
    get isOpen() { return !el.hidden; },
    // True just after a tap outside closed the menu: that tap shouldn't also deselect a train on the map.
    get justClosed() { return performance.now() - closedAt < 500; },
  };
}
