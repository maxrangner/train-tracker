// Which trains the map shows: all, or only those of the companies and kinds tapped on the stats page (Max,
// 2026-11-14: "Clicking a brand or category in the stats should filter just those train on the map. Can be stacked").
// Stacked: a train is shown when it matches anything chosen (SJ Snabbtåg + Commuter: both). Not remembered after a
// reload. A company is its name, '' for "not known yet"; a kind is from src/train-kinds.js.
import { kindOf } from './train-kinds.js';

export function createFilter() {
  const chosen = { brand: new Set(), kind: new Set() };
  const listeners = [];
  const changed = () => { for (const fn of listeners) fn(); };
  return {
    get active() { return chosen.brand.size + chosen.kind.size > 0; },
    has: (type, v) => chosen[type]?.has(v) ?? false,
    toggle(type, v) {
      const set = chosen[type];
      if (!set) return;
      if (set.has(v)) set.delete(v); else set.add(v);
      changed();
    },
    clear() { chosen.brand.clear(); chosen.kind.clear(); changed(); },
    // Whether a train of this company (null / '' when not known) is shown.
    shows(brand) {
      if (!this.active) return true;
      return chosen.brand.has(brand ?? '') || chosen.kind.has(kindOf(brand));
    },
    // What is chosen, companies first: [{ type, v }].
    list: () => [...[...chosen.brand].map(v => ({ type: 'brand', v })), ...[...chosen.kind].map(v => ({ type: 'kind', v }))],
    onChange: fn => listeners.push(fn),
  };
}
