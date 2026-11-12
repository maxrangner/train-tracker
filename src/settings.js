// The look settings, in one place. A value comes from the address (#train=toy&toysize=80&toyzoom=12&boardrows=20),
// else from what was chosen in the menu's Settings (remembered on this phone/browser), else these defaults.
// Read them where they are used, each time, so a change takes effect without a reload where the code allows it.
const DEFAULTS = {
  trainStyle: 'real',   // 'toy': each company's usual train as a toy, bigger than real; 'real': real size
  toySize: 70,          // a toy is at least this long on the screen, in pixels (Max, 2026-11-12: 70)
  toyZoom: 11,          // toys from this zoom in (further out: dots)
  boardRows: 12,        // trains on a station's board (Max, 2026-11-12: "a certain amount of trains")
};
// The address name of each setting, and whether a change needs the page reloaded (the map's layers are set up once).
const KEYS = {
  trainStyle: { param: 'train', reload: true },
  toySize: { param: 'toysize', reload: false },
  toyZoom: { param: 'toyzoom', reload: true },
  boardRows: { param: 'boardrows', reload: false },
};
const STORE = 'settings';

let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}; } catch { /* storage blocked or broken: defaults */ }
const hash = new URLSearchParams(location.hash.slice(1));
const valid = {
  trainStyle: v => (['toy', 'real'].includes(v) ? v : undefined),
  toySize: v => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Math.max(30, Math.min(150, Number(v))) : undefined),
  toyZoom: v => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Math.max(8, Math.min(16, Number(v))) : undefined),
  boardRows: v => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Math.max(4, Math.min(40, Number(v))) : undefined),
};

export const settings = Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) =>
  [k, valid[k](hash.get(KEYS[k].param)) ?? valid[k](saved[k]) ?? d]));

// Change a setting from the menu: remembered, and taken out of the address (which would otherwise win next time).
// Returns true when the page must be reloaded for it to show.
export function setSetting(key, value) {
  const v = valid[key](value);
  if (v === undefined || v === settings[key]) return false;
  settings[key] = v;
  saved[key] = v;
  try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* not remembered, but used now */ }
  const now = new URLSearchParams(location.hash.slice(1));   // as it is now (the map keeps #view up to date)
  if (now.has(KEYS[key].param)) {
    now.delete(KEYS[key].param);
    history.replaceState(null, '', `#${now.toString().replace(/%2F/g, '/')}`);
  }
  return KEYS[key].reload;
}
