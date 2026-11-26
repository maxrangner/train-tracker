// The start's chips (Max's pick C, 2026-11-25: "C. With störningar, started and stats pills"): three named buttons, an
// icon and a number each, like Home's card titles were (src/icons.js titleIcon, titleChip; src/css/sheet.css .sc):
//   Störningar  ⚠, how many disruptions there are (all of them, as the list counts), in the colour of the worst
//               problem in force (grey with rail work alone): the list ('dislist', src/pages/disruptions.js),
//   Sparade     ☆, how many are saved (trips and today's changes, trains, stations): 'saved' (src/home.js),
//   Statistik   bars, no number: 'stats' (src/home.js).
// At rest they float over the map just above the bar (a phone; a computer: under the search box, mirrored), and step
// aside while anything else is open: a page, the search, ☰'s menu. A tap opens that part as a card in the sheet; the
// three are the stack's root pages (src/stack.js roots: they replace each other, no ‹), and while one is open the
// chips are in the card's head, the lit one marked; a tap on the lit one closes it, back to the bar alone.
// The room the floating row takes: --chips-h on <html> (what sits on the sheet's edge stands above it or under it: the
// line, Rewind's ribbon; src/css/map.css, day.css), and room() for the stack, which counts it into --sheet-h on a phone
// (the map's buttons, its credit and scale ride on the sheet's top edge: one value, one glide; src/stack.js above).
//
// createStartChips({ stack, counts: { dis() -> { n, colour } or null, saved() -> n }, held() -> bool (☰'s menu
//   shown), has(key) -> bool (that chip shown: Störningar only with live data, a replay has none) }) -> { draw() (the numbers again: each second), sync() (shown or not: a page came, the search, the menu) };
//   stack is a getter.
import { titleIcon, titleChip } from './icons.js';
import { t } from './i18n.js';
import { esc } from './html.js';
import { isWide, onWideChange } from './layout.js';
import { swap } from './home.js';

export const START_KEYS = ['dislist', 'saved', 'stats'];
const CHIPS = { dislist: { icon: 'warning', word: 'disruptions' }, saved: { icon: 'star', word: 'mine' }, stats: { icon: 'bars', word: 'navStats' } };

export function createStartChips({ stack, counts, held, has = () => true }) {
  const root = document.documentElement;
  const float = Object.assign(document.createElement('div'), { id: 'chips', className: 'sc-row' });
  float.setAttribute('role', 'group');
  document.getElementById('line').after(float);
  const head = Object.assign(document.createElement('div'), { className: 'sh-chips sc-row' });
  head.setAttribute('role', 'group');
  document.querySelector('#sheet .sh-head').append(head);

  function html(lit) {
    const dis = counts.dis(), saved = counts.saved();
    return START_KEYS.filter(has).map((key) => {
      const c = CHIPS[key], on = key === lit;
      const n = key === 'dislist' ? dis?.n : key === 'saved' ? saved : null;
      const colour = key === 'dislist' && dis ? ` style="--ct:${dis.colour}"` : '';
      return `<button type="button" class="sc" data-chip="${key}" aria-pressed="${on}"${colour}>${titleIcon(c.icon)}<span class="sc-t">${esc(t(c.word))}</span>${titleChip(n)}</button>`;
    }).join('');
  }
  function draw() {
    const top = stack().top();
    swap(float, html(null));
    // (the card's head only while a chip's card is on top: as the card goes it keeps its look, the lit chip lit, while it
    // fades; drawn again unlit it was a new row flashing by as the card closed, ui-sweep 'störningar → back', 2026-11-26)
    if (START_KEYS.includes(top)) swap(head, html(top));
  }
  let shown = null, room = 0;   // room: the row's height and the 10 px over it, as last measured shown (a phone)
  function sync() {
    draw();
    const st = stack(), on = st.top() === 'home' && !st.searching && !held();
    if (on !== shown) {
      shown = on;
      root.classList.toggle('chips-off', !on);
      float.inert = !on;
    }
    // (a chip's height and the 10 px over it; hidden the row takes no room)
    const h = on ? (float.querySelector('.sc')?.offsetHeight ?? 0) + 10 : 0;
    root.style.setProperty('--chips-h', `${h}px`);
    const low = isWide() ? 0 : h || room;   // (hidden: kept, the map's buttons stay where they stand at rest)
    if (low !== room) { room = low; stack()?.edgeChanged?.(); }
  }
  // A tap: that part's card, or the lit one closed (back to the bar alone)
  const tap = (e) => {
    const b = e.target.closest('[data-chip]');
    if (!b) return;
    const st = stack(), key = b.dataset.chip;
    if (st.top() === key) st.home(0);
    else st.open(key, { go: true });
  };
  float.addEventListener('click', tap);
  head.addEventListener('click', tap);
  onWideChange(sync);
  return { draw, sync, room: () => room };
}
