// The Spårat logo (Max's wordmark, 2026-11-15; redrawn as a vector in docs/look-1115/logo.mjs and checked against his
// picture there). Every letter is one centre line drawn as two rails: a 66-wide stroke with a 14-wide gap (rails 26
// wide); p and a rail by rail, their bowl's inner rail flowing into the stem. The ring above the a is "B" (Max's pick):
// a ring round a dot, from the letters' own rails. logoSvg(): the full logo; small: true, one line per letter, for small
// sizes (the search bar), where the gap between the rails would close up. The colour is the text's (currentColor).
const LETTERS = [
  'M 338 420 C 318 404 290 399 250 399 C 200 399 156 410 156 445 C 156 478 200 490 245 496 C 300 503 333 515 333 550 C 333 586 295 601 245 601 C 195 601 160 590 137 565',   // s
  'M 970 630 L 970 473.5 A 75 75 0 0 1 1045 398.5 L 1088 398.5',   // r
  'M 1436.5 291 L 1436.5 522 A 75 75 0 0 0 1511.5 597 L 1555 597',  // t
  'M 1365 398.5 L 1547 398.5',                                     // t's bar
];
const BOWLS = [[511.5, -1], [787.5, 1], [1217.5, 1]];   // p, a, a: the bowl's middle, the stem's side
const rails = (cx, dir) => {
  const xi = cx + dir * 81, xo = cx + dir * 121, ex = cx + dir * 75.6, bottom = dir < 0 ? 717 : 630;
  return [`M ${cx + 81} 496 A 81 81 0 1 0 ${cx - 81} 496 A 81 81 0 1 0 ${cx + 81} 496`,
    `M ${xi} 496 L ${xi} ${bottom}`, `M ${xo} ${bottom} L ${xo} 496 A 121 121 0 1 ${dir < 0 ? 1 : 0} ${ex} 590.4`];
};
const RING = { cx: 789, cy: 290 };
const VIEW = '100 220 1470 510';
let n = 0;

export function logoSvg({ small = false, label = 'Spårat' } = {}) {
  const id = `spl${++n}`;
  const path = d => `<path d="${d}"/>`;
  const inner = small
    ? `<g fill="none" stroke="white" stroke-width="50">${LETTERS.map(path).join('')}` +
      BOWLS.map(([cx, dir]) => `<circle cx="${cx}" cy="496" r="101"/>${path(`M ${cx + dir * 101} 496 L ${cx + dir * 101} ${dir < 0 ? 717 : 630}`)}`).join('') + '</g>' +
      `<circle cx="${RING.cx}" cy="${RING.cy}" r="44" fill="none" stroke="white" stroke-width="26"/><circle cx="${RING.cx}" cy="${RING.cy}" r="14" fill="white"/>`
    : `<g fill="none" stroke="white" stroke-width="66">${LETTERS.map(path).join('')}</g><g fill="none" stroke="black" stroke-width="14">${LETTERS.map(path).join('')}</g>` +
      `<g fill="none" stroke="white" stroke-width="26">${BOWLS.flatMap(([cx, dir]) => rails(cx, dir)).map(path).join('')}</g>` +
      `<circle cx="${RING.cx}" cy="${RING.cy}" r="46" fill="none" stroke="white" stroke-width="26"/><circle cx="${RING.cx}" cy="${RING.cy}" r="19" fill="white"/>`;
  return `<svg class="logo-svg" viewBox="${VIEW}" role="img" aria-label="${label}"><mask id="${id}" maskUnits="userSpaceOnUse" x="100" y="220" width="1470" height="510">` +
    `<rect x="100" y="220" width="1470" height="510" fill="black"/>${inner}</mask>` +
    `<rect x="100" y="220" width="1470" height="510" fill="currentColor" mask="url(#${id})"/></svg>`;
}
