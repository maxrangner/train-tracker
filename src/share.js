// Share a train (Max's idea 1, build plan part 6): a link https://sparat.rangner.com/#train=<public number> that opens
// Spårat on that train (today's run: src/main.js openShared). In the app the phone's own share sheet (Capacitor's Share
// plugin, @capacitor/share 6.0.4); in a browser navigator.share where there is one; else the link is copied, with a
// short note. shareLink(number), shareTrain({ number, title, note }) -> Promise of how it went ('app' | 'browser' |
// 'copied' | 'shown' | 'cancelled').
export const SHARE_BASE = 'https://sparat.rangner.com/';
export const shareLink = number => `${SHARE_BASE}#train=${encodeURIComponent(String(number).replace(/\D/g, ''))}`;

const native = () => Boolean(window.Capacitor?.isNativePlatform?.());

export async function shareTrain({ number, title, text, note }) {
  const url = shareLink(number);
  const said = (how) => { if (import.meta.env?.DEV) window.__lastShare = { url, how }; return how; };
  if (native()) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, url, dialogTitle: title });
      return said('app');
    } catch (e) {
      if (/cancel/i.test(String(e?.message ?? e))) return said('cancelled');
      /* not there: the browser's way below */
    }
  }
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ title, text, url }); return said('browser'); } catch (e) {
      if (e?.name === 'AbortError') return said('cancelled');
      /* refused (no user gesture, not allowed): copy */
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    note?.('copied', url);
    return said('copied');
  } catch {
    note?.('shown', url);   // nothing can copy here: the link is shown
    return said('shown');
  }
}

// A #train=<digits> in the address (a shared link), or null. trainStyle's own #train=toy|real|symbol is not one.
export function sharedNumber(hash = location.hash) {
  const v = new URLSearchParams(String(hash).slice(1)).get('train');
  return v && /^\d{1,6}$/.test(v) ? v : null;
}
// The address without it (the rest kept), as #view is dropped (src/map.js startView).
export function dropShared() {
  const now = new URLSearchParams(location.hash.slice(1));
  if (!sharedNumber()) return;
  now.delete('train');
  const rest = now.toString().replace(/%2F/g, '/');
  history.replaceState(null, '', `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`);
}
