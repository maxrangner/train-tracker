// The menu: opens from the ☰ button, so the main screen stays clean (Max, 2026-11-12). Search for a train number or
// a station; the full status line.
//
// findTrains(digits) -> trains on the map whose number starts with them: [{ id, number, company }]
// findStations(text) -> passenger stations whose name matches: [{ sig, name }]
// searchTimetable(number) -> Promise of today's trains with exactly this number: [{ key, operational, date, number,
//   product, from, to }] (from/to as names)
// onPickTrain({ id, operational, date, number, onMap }), onPickStation(station)
// favourites() -> { stations: [{ sig, name }], trains: [{ number, company, onMap }] }; onPickFavouriteTrain(number)

const MAX_ROWS = 8;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
    for (const t of trains) {
      list.append(row(`<b>${esc(t.number)}</b> <span>${esc(t.company || 'Train')} · on the map</span>`,
        () => onPickTrain({ ...t, onMap: true })));
    }
    for (const st of stations) list.append(row(`<b>${esc(st.name)}</b> <span>Station</span>`, () => onPickStation(st)));
    if (!digits && !stations.length) list.append(note('No station by that name.'));
    if (!digits) return;

    // A whole number: also today's timetable, for trains that aren't on the map (not started yet, or done).
    const waiting = note('Looking in today\'s timetable…');
    list.append(waiting);
    timer = setTimeout(async () => {
      let found;
      try { found = await searchTimetable(q); } catch (e) { if (n === asked) waiting.textContent = `Couldn't search the timetable: ${e.message}`; return; }
      if (n !== asked) return;
      waiting.remove();
      const onMap = new Set(trains.map(t => t.id));
      const more = found.filter(t => !onMap.has(t.key));
      for (const t of more.slice(0, MAX_ROWS)) {
        list.append(row(`<b>${esc(t.number)}</b> <span>${esc([t.product, t.from && t.to ? `${t.from} → ${t.to}` : ''].filter(Boolean).join(' · '))}</span>`,
          () => onPickTrain({ id: t.key, operational: t.operational, date: t.date, number: t.number, onMap: false })));
      }
      if (!trains.length && !more.length) list.append(note(`No train ${q} today.`));
    }, 350);
  }

  // With the search field empty: the starred trains and stations.
  function showFavourites() {
    const f = favourites?.();
    if (!f) return;
    if (!f.trains.length && !f.stations.length) {
      list.append(note('Tap ☆ on a train or a station to keep it here.'));
      return;
    }
    list.append(Object.assign(document.createElement('li'), { className: 'menu-label fav-label', textContent: 'Favourites' }));
    for (const t of f.trains) {
      list.append(row(`<b>★ ${esc(t.number)}</b> <span>${esc(t.company || 'Train')}${t.onMap ? ' · on the map' : ''}</span>`,
        () => onPickFavouriteTrain(t.number)));
    }
    for (const st of f.stations) list.append(row(`<b>★ ${esc(st.name)}</b> <span>Station</span>`, () => onPickStation(st)));
  }

  return {
    open, close,
    get isOpen() { return !el.hidden; },
    // True just after a tap outside closed the menu: that tap shouldn't also deselect a train on the map.
    get justClosed() { return performance.now() - closedAt < 500; },
  };
}
