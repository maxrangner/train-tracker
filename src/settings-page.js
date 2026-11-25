// Settings, a page in the sheet from ☰ → Settings: remembered on this phone (src/settings.js), every change shown at
// once without reloading the page (reloading was a bad experience). The accent's swatches fold open under its row.
//
// createSettingsPage({ map, day, search, panel, status, pills, home, stack, board, filter, frame, markMotion }) ->
//   { el, onShow() }; stack is a getter.
import { settings, setSetting, onSettingChange } from './settings.js';
import { translatePage, lang } from './i18n.js';
import { ACCENTS, DEFAULT_ACCENT } from './colours.js';

const MAP_LOOK = new Set(['theme', 'trainStyle', 'toyZoom', 'trainSymbol', 'accent', 'routeNames', 'nameSide', 'pillSide', 'routeEdge', 'colourBlind']);
const MODEL_SIZE = new Set(['toySize', 'modelSize', 'toyClose', 'realClose', 'trueSize']);   // read each frame (trains-3d.js): drawn once now

export function createSettingsPage(ctx) {
  const { map, day, search, panel, status, pills, home, board, filter, frame, markMotion } = ctx;
  const el = document.getElementById('settings-page');
  const settingsEl = document.getElementById('settings');
  const swatchesEl = settingsEl.querySelector('.seg.swatches');
  const accentOpen = document.getElementById('accent-open'), accentPick = document.getElementById('accent-pick');
  const accentName = accentOpen.querySelector('.accent-name');
  const sizeEl = document.getElementById('set-toysize'), sizeOut = document.getElementById('set-toysize-out');
  const realSizeEl = document.getElementById('set-realsize'), realSizeOut = document.getElementById('set-realsize-out');
  const closeSizeEl = document.getElementById('set-closesize'), closeSizeOut = document.getElementById('set-closesize-out');
  const closeKey = () => (settings.trainStyle === 'toy' ? 'toyClose' : 'realClose');   // (one slider, for the kind of train chosen)

  function show() {
    for (const seg of settingsEl.querySelectorAll('.seg'))
      for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(settings[seg.dataset.key])));
    settingsEl.classList.toggle('real', settings.trainStyle !== 'toy');
    settingsEl.classList.toggle('style-real', settings.trainStyle === 'real');
    settingsEl.classList.toggle('symbol', settings.trainStyle === 'symbol');
    sizeEl.value = settings.toySize;
    sizeOut.textContent = `${settings.toySize} px`;
    realSizeEl.value = settings.modelSize;
    realSizeOut.textContent = `×${settings.modelSize}`;
    const close = settings[closeKey()];
    closeSizeEl.value = close;
    closeSizeOut.textContent = `×${close}`;
    accentName.textContent = (ACCENTS[settings.accent] ?? ACCENTS[DEFAULT_ACCENT]).name[lang()];
  }
  // The accent: one round swatch per curated colour (src/colours.js), each in its light and dark shade.
  swatchesEl.innerHTML = Object.entries(ACCENTS).map(([k, a]) =>
    `<button type="button" data-v="${k}" style="--sw-l:${a.light.c};--sw-d:${a.dark.c}"></button>`).join('');
  const nameSwatches = () => { for (const b of swatchesEl.children) b.title = b.ariaLabel = ACCENTS[b.dataset.v].name[lang()]; };
  nameSwatches();
  function foldAccents(open) {
    accentOpen.setAttribute('aria-expanded', String(open));
    accentPick.classList.toggle('open', open);
    accentPick.inert = !open;   // (folded: its swatches can't be reached by Tab)
  }
  accentOpen.onclick = () => foldAccents(accentOpen.getAttribute('aria-expanded') !== 'true');
  for (const seg of settingsEl.querySelectorAll('.seg')) {
    for (const b of seg.querySelectorAll('button')) b.onclick = () => {
      setSetting(seg.dataset.key, b.dataset.v);
      if (seg === swatchesEl) { foldAccents(false); accentOpen.focus(); }
    };
  }
  sizeEl.oninput = () => { setSetting('toySize', sizeEl.value); show(); };
  realSizeEl.oninput = () => { setSetting('modelSize', realSizeEl.value); show(); };
  closeSizeEl.oninput = () => { setSetting(closeKey(), closeSizeEl.value); show(); };
  show();

  // A change (also Look on Auto when the phone turns light or dark): each part shows it.
  onSettingChange((key) => {
    if (MAP_LOOK.has(key)) { map.applySettings(); day.draw(); }
    if (key === 'language') {
      translatePage();
      day.relabel();
      nameSwatches();
      map.relabel();   // ("3 trains" on the map)
      search.refresh();
      panel.relabel();
      status.relabel();
      pills.show();
      home.redraw();
      const stack = ctx.stack, top = stack.top();
      if (top !== 'home') stack.pageDef(top)?.redraw?.();
      stack.refreshBar();
    }
    if (key === 'boardRows') board.relabel();
    if (key === 'allPlaces') panel.relabel();
    if (key === 'homeLegend') { if (!settings.homeLegend) filter.setLate(null); home.redraw(); }   // (Debug → Lateness colours on Home)
    if (key === 'pageMotion' || key === 'motionSpeed') markMotion();
    if (key === 'disruptionsMap') map.showDisruptions();
    if (key === 'dayNight') { map.sunShow(); frame.invalidate(true); }   // (the sun's line, the glow and the lit windows)
    if (key === 'scaleSlider') map.sliderShow();
    if (MODEL_SIZE.has(key)) map.drawNow();
    show();
  });
  return { el, onShow() { foldAccents(false); show(); } };
}
