// The settings, in one place. A value comes from the address (#train=toy&accent=ocean&toysize=80&toyzoom=12&realsize=2&toyclose=6&realclose=2.5&truesize=1&boardrows=20&symbol=triangle&theme=dark&lang=en),
// else from what was chosen in the menu's Settings (remembered on this phone/browser), else these defaults.
// Read them where they are used, each time, so a change takes effect without a reload where the code allows it.
// The phone's language at first start: Swedish if it is Swedish, otherwise English (Max, 2026-11-12).
import { ACCENTS, DEFAULT_ACCENT, cssVars } from './colours.js';

const phoneLang = () => (String(globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language ?? '').toLowerCase().startsWith('sv') ? 'sv' : 'en');
const DEFAULTS = {
  theme: 'auto',        // 'auto': as the phone is set; 'light'; 'dark' (Max, 2026-11-12)
  language: phoneLang(), // 'sv' or 'en'
  trainStyle: 'toy',    // 'toy': each company's usual train as a toy, bigger than real (the default, Max 2026-11-15); 'real': real size;
                        // 'symbol': never a model, the dot or triangle at every zoom (Max, 2026-11-14)
  toySize: 70,          // a toy is at least this long on the screen, in pixels (Max, 2026-11-12: 70)
  toyZoom: 12,          // toys from this zoom in (further out: dots; Max, 2026-11-15: 12)
  // How big the models are drawn (src/model-size.js; Max, 2026-11-15, debug settings except trueSize):
  modelSize: 1,         // realistic models at zoom 13, times real size (1 to 4); further in the same length on screen
  // Zooming in, models stop shrinking at this, times real size (1 to 6), one for each kind (Max, 2026-11-15: compact
  // ×6, realistic ×2.5).
  toyClose: 6,
  realClose: 2.5,
  trueSize: false,      // "Realistic size": real size at every zoom, the sizes above not used
  boardRows: 12,        // trains on a station's board (Max, 2026-11-12: "a certain amount of trains")
  // A train further out: 'circle', or 'triangle' pointing the way it goes (Max, 2026-11-13, a debug setting; the
  // triangle the default since 2026-11-14, Max: "make triangles default"); 'dart', a wide arrow with a notch at the
  // back, to try (Max, 2026-11-15: option C of the arrow sketches, under Debug).
  // Since 2026-11-15 'drop' (the Soft look, Max: "Drops"): a circle with a point showing the way.
  trainSymbol: 'drop',
  // The accent colour: buttons, the chosen train's route (Max, 2026-11-15: a setting, a few curated colours;
  // src/colours.js ACCENTS).
  accent: DEFAULT_ACCENT,
  // (trainCard, 'compact' or 'expanded', was a setting until 2026-11-20, Max: "Remove tågkort setting"; the card
  // always opens compact. A phone's saved value is left unread.)
  // A stop Trafikverket gives no expected time for, counted down to (Max, 2026-11-15, 1B, with a Debug switch to A):
  // 'guess', its planned time plus the lateness now (shown with ≈), or 'planned'.
  noEstimate: 'guess',
  // Disruptions on the map (Max, 2026-11-18): 'all' (problems and rail work, the default: "Alla"), 'problems' (faults
  // and incidents only: "Fel") or 'off'. The menu's list always has them all.
  disruptionsMap: 'all',
  // A menu screen opened over an open train's card (Debug, Max 2026-11-20: "Make a debug toggle for the three
  // options"; src/main.js openPage): 'card' (the card waits under it), 'follow' (the card goes, the train stays
  // followed) or 'clear' (card and train let go).
  pageOverTrain: 'card',
};
// The address name of each setting. Every change takes effect at once, without reloading the page (Max, 2026-11-12):
// whoever shows a setting listens with onSettingChange.
const KEYS = {
  theme: { param: 'theme' },
  language: { param: 'lang' },
  trainStyle: { param: 'train' },
  toySize: { param: 'toysize' },
  toyZoom: { param: 'toyzoom' },
  modelSize: { param: 'realsize' },
  toyClose: { param: 'toyclose' },
  realClose: { param: 'realclose' },
  trueSize: { param: 'truesize' },
  boardRows: { param: 'boardrows' },
  trainSymbol: { param: 'symbol' },
  accent: { param: 'accent' },
  noEstimate: { param: 'noest' },
  disruptionsMap: { param: 'dis' },
  pageOverTrain: { param: 'overtrain' },
};
const STORE = 'settings';

let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}; } catch { /* storage blocked or broken: defaults */ }
const hash = new URLSearchParams(location.hash.slice(1));
// A number from lo to hi in half steps, or undefined.
const halves = (lo, hi) => v => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
  ? Math.max(lo, Math.min(hi, Math.round(Number(v) * 2) / 2)) : undefined);
const valid = {
  theme: v => (['auto', 'light', 'dark'].includes(v) ? v : undefined),
  language: v => (['sv', 'en'].includes(v) ? v : undefined),
  trainStyle: v => (['toy', 'real', 'symbol'].includes(v) ? v : undefined),
  toySize: v => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Math.max(30, Math.min(150, Number(v))) : undefined),
  toyZoom: v => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Math.max(8, Math.min(16, Number(v))) : undefined),
  modelSize: halves(1, 4),
  toyClose: halves(1, 6),
  realClose: halves(1, 6),
  trueSize: v => (v === true || v === 'true' || v === '1' ? true : v === false || v === 'false' || v === '0' ? false : undefined),
  boardRows: v => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Math.max(4, Math.min(40, Number(v))) : undefined),
  trainSymbol: v => (['circle', 'triangle', 'dart', 'drop'].includes(v) ? v : undefined),
  accent: v => (typeof v === 'string' && Object.hasOwn(ACCENTS, v) ? v : undefined),
  noEstimate: v => (['guess', 'planned'].includes(v) ? v : undefined),
  disruptionsMap: v => (['all', 'problems', 'off'].includes(v) ? v : undefined),
  pageOverTrain: v => (['card', 'follow', 'clear'].includes(v) ? v : undefined),
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
// The page's colours (src/colours.js) as CSS variables on <html>, for the theme and accent now.
const showTheme = () => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement, dark = isDark();
  root.dataset.theme = dark ? 'dark' : 'light';
  for (const [k, v] of Object.entries(cssVars(dark, settings.accent))) root.style.setProperty(k, v);
};
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
  const now = new URLSearchParams(location.hash.slice(1));   // as it is now (other settings, #replay and the like)
  if (now.has(KEYS[key].param)) {
    now.delete(KEYS[key].param);
    history.replaceState(null, '', `#${now.toString().replace(/%2F/g, '/')}`);
  }
  if (key === 'theme' || key === 'accent') showTheme();
  changed(key);
  return true;
}
