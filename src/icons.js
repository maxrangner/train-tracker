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
  // The menu and the connection screen (2026-11-18): Statistics, our server, the website, the phone.
  stats: '<path d="M5 19.5V11M10 19.5V5M15 19.5v-6M20 19.5V9"/>',
  server: '<rect x="4" y="4.5" width="16" height="6" rx="2"/><rect x="4" y="13.5" width="16" height="6" rx="2"/><path d="M8 7.5h.01M8 16.5h.01"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.4 5.4 3.4 8.5s-1 6.1-3.4 8.5c-2.4-2.4-3.4-5.4-3.4-8.5s1-6.1 3.4-8.5z"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  back: '<path d="m14.5 6-6 6 6 6"/>',   // a disruption opened from the list: back to it (2026-11-20)
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp: '<path d="m6 15 6-6 6 6"/>',
  warning: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.2M12 16.8v.3"/>',
  cone: '<path d="M10.2 4h3.6l4.4 15H5.8z"/><path d="M8.5 9.5h7M7.4 14h9.2M3.5 19.5h17"/>',   // rail work (2026-11-18)
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',   // a group's "Show only" (2026-11-22)
  day: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>',   // ☰ → The day (2026-11-22)
  // My trains, share (2026-11-23): a trip (two places joined), a change (two arrows), +, share (out of a box).
  trip: '<circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.4 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.6"/>',
  change: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  share: '<path d="M12 14.5V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5"/>',
  play: '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>',   // The day's play buttons (2026-11-23)
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  // A saved trip's Edit and Delete (2026-11-23): a pencil, a bin.
  edit: '<path d="M14.5 5.5l4 4L9 19H5v-4z"/><path d="M12.5 7.5l4 4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5"/>',
  // A trip's station dragged up or down by its six dots (Max's pick A, 2026-11-23).
  grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></g>',
  // Home's cards' titles (Max's pick A, 2026-11-25; besides star, locate, warning, train, day (a clock), pause, server):
  // the filter, punctuality, a company, the fastest, the busiest, "for fun".
  funnel: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.7 2.7L16 9.5"/>',
  company: '<path d="M4 20V8l6-3v15M10 20V10l10 3v7M4 20h16"/>',
  gauge: '<path d="M4.5 16a8 8 0 1 1 15 0"/><path d="M12 13.5l4-4.5"/>',
  bars: '<path d="M4 19.5h16M7 19.5V12M12 19.5V7M17 19.5v-9"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
};
export const icon = (name, size = 20, stroke = 2) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;

// A card's title on Home (Max's pick A, 2026-11-25: "Give each sub card an icon before the title. And make it dynamic"):
// the title gets the class ct (and --ct: its colour, the accent unless set), its icon before the words, where there is
// a number a chip after them in the same colour on a 16 % tint of it (src/css/page.css .ct). titleChip(n): none for
// 0, null or ''.
export const titleIcon = name => `<span class="ct-ic" aria-hidden="true">${icon(name, 18)}</span>`;
export const titleChip = n => (n === 0 || n === null || n === undefined || n === '' ? '' : `<span class="ct-n">${n}</span>`);
// The attributes of a title (class names besides ct; colour: a CSS colour or none)
export const titleAttrs = (cls, colour = null) => `class="${cls} ct"${colour ? ` style="--ct:${colour}"` : ''}`;
