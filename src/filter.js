// Which trains the map shows: all, or only those of the companies and kinds tapped on the stats page (Max,
// 2026-11-14: "Clicking a brand or category in the stats should filter just those train on the map. Can be stacked").
// Stacked: a train is shown when it matches anything chosen (SJ Snabbtåg + Commuter: both). Not remembered after a
// reload. A company is its name, '' for "not known yet"; a kind is from src/train-kinds.js.
// And a lateness (Max, 2026-11-24: Home's lateness colours "should show as a pill on map. Filters should always show on
// map as pill"; it lit only while Home showed, a train opened showed every train again): one of 'ontime', 'some',
// 'late', 'unknown' (src/lateness.js lateClass, 'unknown' for a train with no news). It narrows the companies' choice:
// SJ Snabbtåg and late = SJ Snabbtåg's late trains. Two filters, two pills (Max, 2026-11-24: "separate pills for
// separate filters. Allow more than one."): the companies' and kinds' pill, the lateness' pill, each × its own.
import { kindOf } from './train-kinds.js';

export function createFilter() {
  const chosen = { brand: new Set(), kind: new Set(), late: new Set() };
  const listeners = [];
  const changed = () => { for (const fn of listeners) fn(); };
  const coActive = () => chosen.brand.size + chosen.kind.size > 0;
  return {
    get active() { return coActive() || chosen.late.size > 0; },
    // only companies or kinds chosen (the stats page's rows dim by these)
    get coActive() { return coActive(); },
    has: (type, v) => chosen[type]?.has(v) ?? false,
    toggle(type, v) {
      const set = chosen[type];
      if (!set) return;
      if (set.has(v)) set.delete(v); else set.add(v);
      changed();
    },
    // one lateness at a time (Home's bar: a colour tapped again lets go); null: none
    setLate(k) {
      if (chosen.late.size === (k ? 1 : 0) && (!k || chosen.late.has(k))) return;
      chosen.late.clear();
      if (k) chosen.late.add(k);
      changed();
    },
    get late() { return [...chosen.late][0] ?? null; },
    clear() { chosen.brand.clear(); chosen.kind.clear(); chosen.late.clear(); changed(); },
    // the companies and kinds only (their pill's ×), the lateness kept
    clearCo() { if (!coActive()) return; chosen.brand.clear(); chosen.kind.clear(); changed(); },
    // Whether a train of this company (null / '' when not known) is shown; lateKey: the train's lateness (left out:
    // the companies' choice alone).
    shows(brand, lateKey) {
      if (coActive() && !(chosen.brand.has(brand ?? '') || chosen.kind.has(kindOf(brand)))) return false;
      return lateKey === undefined || !chosen.late.size || chosen.late.has(lateKey);
    },
    // The lateness part alone (a page that lights its own trains: the companies' part is the page's)
    lateShows: lateKey => !chosen.late.size || chosen.late.has(lateKey),
    // What is chosen, companies first, the lateness last: [{ type, v }].
    list: () => [...[...chosen.brand].map(v => ({ type: 'brand', v })), ...[...chosen.kind].map(v => ({ type: 'kind', v })),
      ...[...chosen.late].map(v => ({ type: 'late', v }))],
    onChange: fn => listeners.push(fn),
  };
}
