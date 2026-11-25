// About Spårat (a page in the sheet from ☰): the logo, Buy me a coffee (Ko-fi), Report a bug (a ready e-mail with the
// build, the map view, the open train and the phone), the version and commit; 7 taps on the version show or hide
// Settings → Debug (remembered; #debug in the address too; the dev page shows it unless switched off).
//
// createAbout({ map, panel, trains, lateness, mode, debugAsked }) -> { el }; mode() -> 'live' | 'files' | 'replay …'
import { t } from './i18n.js';
import { icon } from './icons.js';
import { logoSvg } from './logo.js';
import { settings } from './settings.js';
import kofiCup from './kofi-cup.png';

// Ko-fi as a plain link with Ko-fi's cup kept in the page: Ko-fi's script would load from Ko-fi and Google Fonts on every
// visit, and it writes with document.writeln.
const KOFI_URL = 'https://ko-fi.com/X1C729ZIK7';
// The monitor's Gmail with a "+bugs" tag, put together only on a tap, so the page's code never holds it whole
// (tools/about-check.mjs checks for it).
const bugAddress = () => { const back = s => [...s].reverse().join(''); return `${back('sgub+ppa.taraps')}@${back('moc.liamg')}`; };
const PUBLIC_URL = 'https://sparat.rangner.com/';   // the view link points here (inside the app the page's address is local)
const DEBUG_KEY = 'debugShown';
const TAPS = 7, TAP_GAP_MS = 1500, SAID_MS = 2500;   // taps in a row at most TAP_GAP_MS apart; "Debug on" shown this long
const version = () => `${typeof __VERSION__ === 'string' ? __VERSION__ : '?'} (${typeof __BUILD__ === 'string' ? __BUILD__ : '?'})`;

export function createAbout({ map, panel, trains, lateness, mode, debugAsked }) {
  const el = document.getElementById('help');
  el.querySelector('.about-logo').innerHTML = logoSvg({ id: 'about-logo' });
  document.querySelector('#kofi-button .about-ic').innerHTML = `<img src="${kofiCup}" alt="">`;   // (the words say where it goes)
  document.querySelector('#bug-button .about-ic').innerHTML = icon('bug', 20);
  document.getElementById('kofi-button').onclick = () => { if (KOFI_URL) window.open(KOFI_URL, '_blank', 'noopener'); };
  function bugMail() {
    const v = version();
    const view = map.viewText();
    const r = panel.openId && trains.get(panel.openId);
    const company = r && lateness.brand(r.id);
    const train = r ? `${r.number}${company ? ` ${company}` : ''}` : '–';
    const body = [t('bugWhat'), '', '', '', '—', `Spårat ${v}`, `${t('bugView')}: ${PUBLIC_URL}${view ? `#view=${view}` : ''}`,
      `${t('bugTrain')}: ${train}`, `${t('bugMode')}: ${mode()}, ${settings.language}, ${settings.theme}`,
      `${t('bugDevice')}: ${navigator.userAgent}`].join('\r\n');
    return `mailto:${bugAddress()}?subject=${encodeURIComponent(t('bugSubject', v))}&body=${encodeURIComponent(body)}`;
  }
  window.__bugMail = bugMail;   // (tools: the mail a tap would open)
  document.getElementById('bug-button').onclick = () => { window.location.href = bugMail(); };
  el.querySelector('.about-soon').hidden = true;

  // The version and the commit it was built from (vite.config.js): a report names its build; "dev" on the PC's page.
  const versionEl = document.getElementById('about-version');
  const versionText = `Version ${typeof __VERSION__ === 'string' ? __VERSION__ : '?'}` +
    ` (${typeof __BUILD__ === 'string' ? __BUILD__ : '?'}${import.meta.env.DEV ? ', dev' : ''})`;
  versionEl.textContent = versionText;
  const settingsEl = document.getElementById('settings');
  let debugShown = import.meta.env.DEV;
  try { const v = localStorage.getItem(DEBUG_KEY); if (v !== null) debugShown = v === 'true'; } catch { /* storage blocked: the default */ }
  function showDebug(on) {
    debugShown = on;
    try { localStorage.setItem(DEBUG_KEY, String(on)); } catch { /* used now, not remembered */ }
    settingsEl.classList.toggle('debug', on);
  }
  if (debugAsked !== null) showDebug(debugAsked !== 'off'); else settingsEl.classList.toggle('debug', debugShown);
  let taps = 0, lastTap = 0, sayTimer = null;
  versionEl.addEventListener('click', () => {
    const at = Date.now();
    taps = at - lastTap < TAP_GAP_MS ? taps + 1 : 1;
    lastTap = at;
    if (taps < TAPS) return;
    taps = 0;
    showDebug(!debugShown);
    versionEl.textContent = t(debugShown ? 'debugOn' : 'debugOff');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { versionEl.textContent = versionText; }, SAID_MS);
  });
  return { el };
}
