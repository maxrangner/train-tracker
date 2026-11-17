// The app's icons: simple round line drawings on a 24 × 24 grid, in the text's colour (drawn for Spårat, 2026-11-15;
// they replace the characters ☰ ? ☆ × › used before). icon('close') -> an <svg> string; size in pixels.
const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  star: '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
  starFilled: '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z" fill="currentColor"/>',
  follow: '<path d="M12 3.5 19 20l-7-3.8L5 20z"/>',
  locate: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>',
  check: '<path d="m6 12.5 4 4 8-9"/>',
  train: '<rect x="6" y="3.5" width="12" height="13" rx="3.5"/><path d="M6 10.5h12M9 20l-1.6 1.5M15 20l1.6 1.5"/><circle cx="9.3" cy="13.6" r=".6"/><circle cx="14.7" cy="13.6" r=".6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 7.6v5.6M12 16.3v.4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.6M12 16.6v.3"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.4M12 7.6v.3"/>',
  bug: '<rect x="7.5" y="7.5" width="9" height="12" rx="4.5"/><path d="M12 11v8.5M7.5 12.5H4M16.5 12.5H20M7.6 16.5l-3 2M16.4 16.5l3 2M9.5 7.8 8 5M14.5 7.8 16 5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
  menu: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m6 15 6-6 6 6"/>',
  warning: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.2M12 16.8v.3"/>',
};
export const icon = (name, size = 20, stroke = 2) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;
