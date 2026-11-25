// The search's sources (the search itself: src/menu.js): trains on the map by number, today's timetable, stations,
// the groups of trains on the map now, disruptions, Recent's rows and the starred ones.
//
// createSearch({ trains, lateness, lateOf, stations, frame, disruptions, trainPages, stack }) -> the search
//   (src/menu.js: open(), refresh()); stack is a getter.
import { createMenu, fold, stationsMatching } from './menu.js';
import { trainRow, stationRow, groupRow, groupOf, starredRows } from './home.js';
import { fetchRunsByNumber } from './trafikverket.js';
import { placesText } from './disruptions.js';
import { lateClass } from './lateness.js';
import { kindOf } from './train-kinds.js';
import { STAND_SPEED } from './trains.js';
import { hhmm, now } from './clock.js';
import { t } from './i18n.js';

const DISRUPTIONS_SHOWN = 8;

export function createSearch(ctx) {
  const { trains, lateness, lateOf, stations, frame, disruptions, trainPages } = ctx;
  // A row for a page key (the empty search's Recent).
  function rowOf(key) {
    const i = key.indexOf(':'), type = i < 0 ? key : key.slice(0, i), v = i < 0 ? '' : key.slice(i + 1);
    if (type === 'train') {
      const r = trains.get(v), m = trainPages.metaOf(v);
      if (!r && !m) return '';
      return trainRow({ id: v, number: r?.number ?? m.number, brand: r ? lateness.brand(v) : null, minutes: r ? lateOf(v) : null, sub: t(r ? 'onMap' : 'notOnMapNow') });
    }
    if (type === 'station') { const st = stations.get(v); return st ? stationRow({ sig: v, name: st.name, sub: t('station') }) : ''; }
    if (type === 'dis') { const d = disruptions.byId(v); return d ? groupRow({ key, name: d.header, sub: placesText(d, stations.name) }) : ''; }
    if (type === 'dislist') return groupRow({ key, name: t('allDisruptions') });
    const g = groupOf(key, STAND_SPEED);
    return g ? groupRow({ key, name: g.name(), sub: g.sub(), colour: g.colour }) : '';
  }
  return createMenu({
    input: document.getElementById('search'),
    list: document.getElementById('search-results'),
    findTrains: digits => trains.reports()
      .filter(r => String(r.number).startsWith(digits))
      .sort((a, b) => String(a.number).length - String(b.number).length || Number(a.number) - Number(b.number))
      .map(r => ({ id: r.id, operational: r.operational, date: r.date, number: r.number, company: lateness.brand(r.id), time: r.time })),
    findStations: text => stationsMatching(stations.all, text),
    async searchTimetable(number) {
      const found = await fetchRunsByNumber(number, now());
      return found.map(x => ({ ...x, from: x.from && stations.name(x.from), to: x.to && stations.name(x.to), at: found.length > 1 && x.start !== null ? hhmm(x.start) : null }));
    },
    // The trains on the map now, by group: companies and kinds typed.
    groups() {
      const brands = new Map(), kinds = new Map();
      let late = 0, still = 0;
      for (const x of frame.all) {
        const b = x.brand ?? '';
        brands.set(b, (brands.get(b) ?? 0) + 1);
        const k = kindOf(b);
        kinds.set(k, (kinds.get(k) ?? 0) + 1);
        if (!x.stale && lateClass(lateOf(x.id)) === 'late') late++;
        if (!x.stale && x.v < STAND_SPEED) still++;
      }
      return { late, still, kinds: [...kinds].sort((a, b) => b[1] - a[1]), brands: [...brands].sort((a, b) => b[1] - a[1]) };
    },
    findDisruptions(text) {
      const q = fold(text);
      return disruptions.list.filter(d => fold(`${d.header} ${d.kind ?? ''} ${placesText(d, stations.name)} ${d.text ?? ''}`).includes(q))
        .slice(0, DISRUPTIONS_SHOWN).map(d => ({ id: d.id, header: d.header, sub: placesText(d, stations.name) }));
    },
    recent: () => ctx.stack.recent(),
    rowOf,
    starred() {
      const byNumber = new Map(trains.reports().map(r => [String(r.number), r]));
      const s = starredRows({ favourites: ctx.favourites, stations: stations.all, onMap(n) {
        const r = byNumber.get(n);
        return r ? { id: r.id, brand: lateness.brand(r.id), minutes: lateOf(r.id) } : null;
      } });
      return s.trains.join('') + s.stations.join('');
    },
    remember: tr => trainPages.remember(tr),
  });
}
