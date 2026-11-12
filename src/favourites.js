// Favourites: starred stations (by signature) and trains (by their public number, so "my 2611" works every day).
// Remembered on this phone/browser; shown in the menu when the search field is empty.
const STORE = 'favourites';

let fav = { stations: [], trains: [] };
try {
  const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
  if (s && Array.isArray(s.stations) && Array.isArray(s.trains)) fav = s;
} catch { /* storage blocked or broken: none */ }

const save = () => { try { localStorage.setItem(STORE, JSON.stringify(fav)); } catch { /* kept until the page closes */ } };
const listOf = kind => (kind === 'station' ? fav.stations : fav.trains);

export const favourites = {
  has: (kind, key) => listOf(kind).includes(String(key)),
  // Star or unstar; returns whether it is starred now.
  toggle(kind, key) {
    const list = listOf(kind), k = String(key), i = list.indexOf(k);
    if (i >= 0) list.splice(i, 1); else list.push(k);
    save();
    return i < 0;
  },
  get stations() { return [...fav.stations]; },
  get trains() { return [...fav.trains]; },
};
