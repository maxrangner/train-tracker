// Favourites: starred stations (by signature) and trains (by their public number, so "my 2611" works every day).
// Remembered on this phone/browser; shown in the menu when the search field is empty.
// Since 2026-11-23 (My trains, build plan part 3) also saved trips and pinned changes:
//   trips:   [{ key, from, to, via }] (station signatures; via may be null): kept until removed, shown for today;
//   changes: [{ key, day, a: { number, operational, date }, b: { ... }, at }] ("Add my change": train a, then train b
//            at station at): one day's pair, dropped once that day is over.
const STORE = 'favourites';

let fav = { stations: [], trains: [], trips: [], changes: [] };
try {
  const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
  if (s && Array.isArray(s.stations) && Array.isArray(s.trains)) {
    fav = { ...s, trips: Array.isArray(s.trips) ? s.trips : [], changes: Array.isArray(s.changes) ? s.changes : [] };
  }
} catch { /* storage blocked or broken: none */ }

const save = () => { try { localStorage.setItem(STORE, JSON.stringify(fav)); } catch { /* kept until the page closes */ } };
const listOf = kind => (kind === 'station' ? fav.stations : fav.trains);

// A trip's key: "Lu>Mc", with a change "U>Cst>Mc".
export const tripKey = (from, to, via = null) => [from, via, to].filter(Boolean).join('>');

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

  // ---- My trains ----
  get trips() { return fav.trips.map(x => ({ ...x })); },
  trip: key => fav.trips.find(x => x.key === key) ?? null,
  // Save a trip (the same one again: kept once); returns its key.
  addTrip(from, to, via = null) {
    const key = tripKey(from, to, via);
    if (!fav.trips.some(x => x.key === key)) { fav.trips.push({ key, from, to, via: via || null }); save(); }
    return key;
  },
  // A trip edited (Max, 2026-11-23): the new stations take the old trip's place in the list (its key follows its
  // stations; the saved form stays { key, from, to, via }). The same trip already saved elsewhere: kept once, there.
  // Returns the new key.
  replaceTrip(oldKey, from, to, via = null) {
    const key = tripKey(from, to, via), i = fav.trips.findIndex(x => x.key === oldKey);
    if (i < 0) return this.addTrip(from, to, via);
    if (key !== oldKey && fav.trips.some(x => x.key === key)) fav.trips.splice(i, 1);
    else fav.trips[i] = { ...fav.trips[i], key, from, to, via: via || null };
    save();
    return key;
  },
  removeTrip(key) { const n = fav.trips.length; fav.trips = fav.trips.filter(x => x.key !== key); if (fav.trips.length !== n) save(); },
  // The pinned changes of day (YYYY-MM-DD, Swedish); older ones are dropped.
  changes(day) {
    const keep = fav.changes.filter(x => x.day >= day);
    if (keep.length !== fav.changes.length) { fav.changes = keep; save(); }
    return keep.filter(x => x.day === day).map(x => ({ ...x }));
  },
  change: key => fav.changes.find(x => x.key === key) ?? null,
  addChange(item) {
    if (!fav.changes.some(x => x.key === item.key)) { fav.changes.push(item); save(); }
    return item.key;
  },
  removeChange(key) { const n = fav.changes.length; fav.changes = fav.changes.filter(x => x.key !== key); if (fav.changes.length !== n) save(); },
};
