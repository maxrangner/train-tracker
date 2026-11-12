// The settings, in one place. A value comes from the address (#train=toy&toysize=80&toyzoom=12&boardrows=20&theme=dark&lang=en),
// else from what was chosen in the menu's Settings (remembered on this phone/browser), else these defaults.
// Read them where they are used, each time, so a change takes effect without a reload where the code allows it.
// The phone's language at first start: Swedish if it is Swedish, otherwise English (Max, 2026-11-12).
const phoneLang = () => (String(globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language ?? '').toLowerCase().startsWith('sv') ? 'sv' : 'en');
const DEFAULTS = {
  theme: 'auto',        // 'auto': as the phone is set; 'light'; 'dark' (Max, 2026-11-12)
  language: phoneLang(), // 'sv' or 'en'
  trainStyle: 'real',   // 'toy': each company's usual train as a toy, bigger than real; 'real': real size
  toySize: 70,          // a toy is at least this long on the screen, in pixels (Max, 2026-11-12: 70)
  toyZoom: 11,          // toys from this zoom in (further out: dots)
  boardRows: 12,        // trains on a station's board (Max, 2026-11-12: "a certain amount of trains")
};
// The address name of each setting. Every change takes effect at once, without reloading the page (Max, 2026-11-12):
// whoever shows a setting listens with onSettingChange.
const KEYS = {
  theme: { param: 'theme' },
  language: { param: 'lang' },
  trainStyle: { param: 'train' },
  toySize: { param: 'toysize' },
  toyZoom: { param: 'toyzoom' },
  boardRows: { param: 'boardrows' },
};
const STORE = 'settings';

let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}; } catch { /* storage blocked or broken: defaults */ }
const hash = new URLSearchParams(location.hash.slice(1));
const valid = {
  theme: v => (['auto', 'light', 'dark'].includes(v) ? v : undefined),
  language: v => (['sv', 'en'].includes(v) ? v : undefined),
  trainStyle: v => (['toy', 'real'].includes(v) ? v : undefined),
  toySize: v => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Math.max(30, Math.min(150, Number(v))) : undefined),
  toyZoom: v => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Math.max(8, Math.min(16, Number(v))) : undefined),
  boardRows: v => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Math.max(4, Math.min(40, Number(v))) : undefined),
};

export const settings = Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) =>
  [k, valid[k](hash.get(KEYS[k].param)) ?? valid[k](saved[k]) ?? d]));

// ---- Changes: fn(key) is called after a setting changed ('theme' also when the phone switches while on Auto) ----
const listeners = [];
export const onSettingChange = fn => listeners.push(fn);
const changed = key => { for (const fn of listeners) fn(key); };

// Dark or light now, as chosen (Auto: as the phone is set now). The page's colours follow <html data-theme>.
const phoneDark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
export const isDark = () => settings.theme === 'dark' || (settings.theme === 'auto' && Boolean(phoneDark?.matches));
const showTheme = () => { if (typeof document !== 'undefined') document.documentElement.dataset.theme = isDark() ? 'dark' : 'light'; };
showTheme();
phoneDark?.addEventListener('change', () => { if (settings.theme === 'auto') { showTheme(); changed('theme'); } });

// Change a setting from the menu: remembered, taken out of the address (which would otherwise win next time), and
// announced. Returns true when it changed.
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
  if (key === 'theme') showTheme();
  changed(key);
  return true;
}
