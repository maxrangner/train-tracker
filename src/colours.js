// The app's colours, in one place (the Soft look, Max 2026-11-15; sketches in docs/look-1115/recipes.mjs). The map
// (src/map.js, src/map-look.js) reads them here; the page's styles get them as CSS variables (cssVars, set on <html>
// by src/settings.js), so each colour is written once. Plain data: also read by docs/look-1115/accent-check.mjs.

// A train's lateness: on time (+2 or less), +3 to +5, +6 or more, not known. The drops on the map, the bars and dots
// elsewhere. Tags (a coloured chip with the minutes) use TAG: [background, text].
export const LATE = {
  light: { ontime: '#33c27f', some: '#f5b73b', late: '#f2645c', unknown: '#b3aca1' },
  dark: { ontime: '#4fd394', some: '#f7c35a', late: '#ff7b72', unknown: '#878a92' },
};
export const TAG = {
  light: { ontime: ['#d9f5e6', '#17804c'], some: ['#fdefcf', '#8a5d00'], late: ['#ffe0dd', '#c23a33'], unknown: ['#eeeae4', '#6f675c'] },
  dark: { ontime: ['#1f4a3a', '#7fe0b0'], some: ['#4d3f1d', '#ffd27a'], late: ['#57292b', '#ff9c94'], unknown: ['#363b4c', '#a8aec0'] },
};
// Disruptions on the map: yellow, orange, red (by level).
export const DISRUPTION = { light: ['#d4a017', '#e8701a', '#d1242f'], dark: ['#e3b341', '#f0883e', '#ff6b61'] };
// The stats page's heatmap, how many trains (Max, 2026-11-15: "cold to hot", then "add yellow/orange"): blue, violet,
// pink, orange, yellow. On the light land a deeper golden yellow (a plain yellow vanishes on white). Few trains to many.
export const HEAT = {
  light: ['#3b6fe0', '#7c4dd6', '#d64084', '#f2742a', '#f2b200'],
  dark: ['#4678ff', '#9260f5', '#ec5496', '#ff8e40', '#ffe278'],
};

// The base map (src/map-look.js uses these with its own finer shades).
export const MAP = {
  light: { land: '#f7f3ec', water: '#cfe4f1', rail: '#c4bcb0' },
  dark: { land: '#1d2130', water: '#131725', rail: '#56617f' },
};

// The page: cards, text, lines, and the problem colour for text (a cancelled stop, a red note).
export const PAGE = {
  light: { page: '#f7f3ec', card: '#ffffff', ink: '#2f2a24', muted: '#776f63', line: '#efe9e0', hover: '#f6f2ec', problem: '#c23a33',
    label: '#2f2a24', halo: '#ffffff', station: '#5b5348', shadow: '0 10px 30px rgba(80, 60, 30, 0.13), 0 2px 6px rgba(80, 60, 30, 0.06)',
    shadowSmall: '0 2px 8px rgba(80, 60, 30, 0.14)' },
  dark: { page: '#1d2130', card: '#272c3c', ink: '#f1f2f7', muted: '#9aa1b5', line: '#343a4d', hover: '#2f3547', problem: '#ff9c94',
    label: '#ffffff', halo: '#1d2130', station: '#c3c9d8', shadow: '0 10px 30px rgba(0, 0, 0, 0.35)', shadowSmall: '0 2px 8px rgba(0, 0, 0, 0.4)' },
};

// The accent colour (Settings → Accent colour, Max 2026-11-15): buttons, the chosen train's route ("done": the part
// it has travelled), the "N trains" labels, the timeline's "now". c: the colour; ink: text on it. Only colours that
// pass docs/look-1115/accent-check.mjs (far enough from the lateness and disruption colours, also for red-green colour
// blindness; visible on the map; readable button text). Lime (from his concept pictures) was tried and failed: too
// close to the green "on time", and with red-green colour blindness close to yellow and orange (2026-11-15).
// 14 since 2026-11-19 (Max: "Add 1-14" from the round-2 sheet, docs/look-1115/accent-round2/; "sort the colors more
// naturally"): round the colour wheel, teal to pink, then the greys; a brighter one beside its plain one. The keys are
// what a phone has saved: a key is never renamed or removed (an unknown one falls back to the default).
export const ACCENTS = {
  teal: { name: { sv: 'Blågrön', en: 'Teal' },
    light: { c: '#0e7c86', ink: '#ffffff', done: '#0a575e' }, dark: { c: '#3cc6cf', ink: '#08201f', done: '#2b8f95' } },
  aqua: { name: { sv: 'Akvamarin', en: 'Aqua' },
    light: { c: '#009aba', ink: '#14161c', done: '#006c82' }, dark: { c: '#13dcf6', ink: '#14161c', done: '#0e9eb1' } },
  cerulean: { name: { sv: 'Cerulean', en: 'Cerulean' },
    light: { c: '#0b7a9a', ink: '#ffffff', done: '#08556c' }, dark: { c: '#77d2f5', ink: '#14161c', done: '#5697b0' } },
  ocean: { name: { sv: 'Havsblå', en: 'Ocean' },
    light: { c: '#1f6fc9', ink: '#ffffff', done: '#14508f' }, dark: { c: '#5fa8ff', ink: '#0d1626', done: '#3a7fd0' } },
  royal: { name: { sv: 'Kungsblå', en: 'Royal blue' },
    light: { c: '#0a54dd', ink: '#ffffff', done: '#073b9b' }, dark: { c: '#4f82ff', ink: '#14161c', done: '#395eb8' } },
  periwinkle: { name: { sv: 'Blålila', en: 'Periwinkle' },
    light: { c: '#5c64e6', ink: '#ffffff', done: '#3d43b0' }, dark: { c: '#9aa0ff', ink: '#141726', done: '#6c72d6' } },
  ultramarine: { name: { sv: 'Ultramarin', en: 'Ultramarine' },
    light: { c: '#3b19e6', ink: '#ffffff', done: '#2911a1' }, dark: { c: '#8483ff', ink: '#14161c', done: '#5f5eb8' } },
  violet: { name: { sv: 'Viol', en: 'Violet' },
    light: { c: '#8b4fd6', ink: '#ffffff', done: '#6533a6' }, dark: { c: '#bb8cff', ink: '#1a1030', done: '#9466dd' } },
  electric: { name: { sv: 'Elektrisk lila', en: 'Electric violet' },
    light: { c: '#7d00e4', ink: '#ffffff', done: '#5700a0' }, dark: { c: '#b973ff', ink: '#14161c', done: '#8553b8' } },
  fuchsia: { name: { sv: 'Fuchsia', en: 'Fuchsia' },
    light: { c: '#b420a0', ink: '#ffffff', done: '#7e1670' }, dark: { c: '#fb79e3', ink: '#14161c', done: '#b557a3' } },
  wine: { name: { sv: 'Vinröd', en: 'Wine' },
    light: { c: '#743355', ink: '#ffffff', done: '#51243b' }, dark: { c: '#f6a9cd', ink: '#14161c', done: '#b17a94' } },
  dusk: { name: { sv: 'Skymning', en: 'Dusk' },
    light: { c: '#685477', ink: '#ffffff', done: '#493b53' }, dark: { c: '#d0bae2', ink: '#14161c', done: '#9686a3' } },
  slate: { name: { sv: 'Skiffer', en: 'Slate' },
    light: { c: '#3c4660', ink: '#ffffff', done: '#252c3e' }, dark: { c: '#c9d1e6', ink: '#1a1f2c', done: '#98a1ba' } },
  graphite: { name: { sv: 'Grafit', en: 'Graphite' },
    light: { c: '#2b2b2b', ink: '#ffffff', done: '#1e1e1e' }, dark: { c: '#e6e6e6', ink: '#161616', done: '#a6a6a6' } },
};
export const DEFAULT_ACCENT = 'periwinkle';

// The CSS variables for a theme and accent, as { '--name': value }.
export function cssVars(dark, accent) {
  const th = dark ? 'dark' : 'light', P = PAGE[th], L = LATE[th], T = TAG[th];
  const A = (ACCENTS[accent] ?? ACCENTS[DEFAULT_ACCENT])[th];
  return {
    '--page': P.page, '--bg': P.card, '--card': P.card, '--ink': P.ink, '--muted': P.muted, '--line': P.line, '--hover': P.hover,
    '--late': P.problem, '--label': P.label, '--label-halo': P.halo, '--station': P.station, '--shadow': P.shadow, '--shadow-s': P.shadowSmall,
    '--accent': A.c, '--accent-ink': A.ink, '--accent-done': A.done, '--group': A.c,
    '--c-ontime': L.ontime, '--c-some': L.some, '--c-late': L.late, '--c-unknown': L.unknown,
    '--t-ontime-bg': T.ontime[0], '--t-ontime': T.ontime[1], '--t-some-bg': T.some[0], '--t-some': T.some[1],
    '--t-late-bg': T.late[0], '--t-late': T.late[1], '--t-unknown-bg': T.unknown[0], '--t-unknown': T.unknown[1],
    '--dis-1': DISRUPTION[th][0], '--dis-2': DISRUPTION[th][1], '--dis-3': DISRUPTION[th][2],
  };
}
