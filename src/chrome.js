// The page around the map: the start screen, the map credit, the logo in the search field, the phone's keyboard not
// moving the map, buttons pressing in on a touch and keeping a mouse press, and a short buzz.
//
// startChrome({ map, mapEl }); buzz()
import { ownMap } from './map.js';
import { logoSvg } from './logo.js';
import { isNative } from './layout.js';

const SPLASH_MIN_MS = 1300;      // the start screen's logo draws itself in about this long (index.html): it stays as long
const SPLASH_FADE_MS = 500;
const CREDIT_MS = 5000;          // the map credit: seen this long after the start screen, or until the map is touched
const CREDIT_FADE_MS = 700;
const KEYBOARD_GONE_MS = 1000;   // a field let go: the keyboard takes this long at most to go
const KEYBOARD_PX = 150;         // the page this much shorter than before while typing: the keyboard is up

// A short buzz when a train is opened or followed: in the app through Capacitor's haptics plugin (the app has no
// permission to vibrate itself; it works on iPhones too); on the web page navigator.vibrate (Android browsers only).
const haptics = isNative() ? import('@capacitor/haptics').catch(() => null) : null;
export function buzz() {
  if (haptics) { haptics.then(h => h?.Haptics.impact({ style: h.ImpactStyle.Light })).catch(() => { /* not here */ }); return; }
  try { navigator.vibrate?.(8); } catch { /* not allowed here */ }
}

export function startChrome({ map, mapEl }) {
  // Buttons press in while held (index.html "Motion"): an iPhone shows :active on a touch only when the page listens.
  document.addEventListener('touchstart', () => {}, { passive: true });
  document.querySelector('#sheet .sh-logo').innerHTML = logoSvg({ small: true });

  // The start screen fades once the map shows only Sweden (and its logo has drawn: index.html __splashDrawn).
  const splash = document.getElementById('splash');
  Promise.all([map.shown, window.__splashDrawn]).then(() => setTimeout(() => { splash.classList.add('gone'); setTimeout(() => { splash.hidden = true; }, SPLASH_FADE_MS); },
    Math.max(0, SPLASH_MIN_MS - performance.now())));

  // The map credit: shown once the start screen has gone, faded on the first touch of the map (or a wheel) or after a
  // while; the full credits stay in About.
  const creditEl = Object.assign(document.createElement('div'), { id: 'credit' });
  const creditLink = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  creditEl.innerHTML = `© ${creditLink('https://www.openstreetmap.org/copyright', 'OpenStreetMap')} © ${creditLink('https://openmaptiles.org/', 'OpenMapTiles')}` +
    (ownMap ? '' : ` · ${creditLink('https://openfreemap.org/', 'OpenFreeMap')}`);
  mapEl.appendChild(creditEl);
  map.shown.then(() => {
    const fade = (e) => {
      if (e?.target && creditEl.contains(e.target)) return;   // (a tap on one of its links opens it first)
      if (creditEl.classList.contains('gone')) return;
      creditEl.classList.add('gone');
      setTimeout(() => { creditEl.hidden = true; }, CREDIT_FADE_MS);
      for (const type of ['pointerdown', 'wheel']) mapEl.removeEventListener(type, fade);
    };
    setTimeout(fade, Math.max(SPLASH_MIN_MS - performance.now(), 0) + SPLASH_FADE_MS + CREDIT_MS);
    for (const type of ['pointerdown', 'wheel']) mapEl.addEventListener(type, fade, { passive: true });
  });

  // The phone's keyboard shrinks the page (the search list ends above it): while a field has focus and the page is
  // clearly lower, the map keeps its last full height and runs on behind the keyboard, so its middle doesn't move; a
  // field let go, it keeps it until the page is tall again (or KEYBOARD_GONE_MS), not shrinking and growing back.
  let full = { w: innerWidth, h: innerHeight }, letGoAt = -Infinity;
  const fit = () => {
    const typing = Boolean(document.activeElement?.matches?.('input, textarea'));
    if (innerWidth !== full.w) { full = { w: innerWidth, h: innerHeight }; letGoAt = -Infinity; }
    const going = !typing && performance.now() - letGoAt < KEYBOARD_GONE_MS;
    if ((typing || going) && innerHeight < full.h - KEYBOARD_PX) {
      mapEl.style.bottom = 'auto'; mapEl.style.height = `${full.h}px`;
    } else {
      full.h = innerHeight; mapEl.style.bottom = ''; mapEl.style.height = '';
    }
  };
  addEventListener('resize', fit);
  addEventListener('focusout', () => {
    letGoAt = performance.now();
    setTimeout(fit, 0);
    setTimeout(fit, KEYBOARD_GONE_MS + 50);   // (it never went: the page's own height again)
  });

  // A mouse pressed on a button keeps it while it stays where the button was: a pressed button shrinks (:active), and a
  // press held near a wide row's edge was let go outside it, so nothing opened. A finger has this by itself.
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const b = e.target.closest?.('button');
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect();
    try { b.setPointerCapture(e.pointerId); } catch { return; }
    const off = (m) => {
      if (m.pointerId !== e.pointerId) return;
      if (m.clientX >= r.left && m.clientX <= r.right && m.clientY >= r.top && m.clientY <= r.bottom) return;
      try { b.releasePointerCapture(e.pointerId); } catch { /* let go already */ }
      b.removeEventListener('pointermove', off);
    };
    b.addEventListener('pointermove', off);
    b.addEventListener('lostpointercapture', () => b.removeEventListener('pointermove', off), { once: true });
  }, true);
}
