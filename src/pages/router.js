// Which page a stack key names (src/stack.js define): 'home', 'train:<id>', 'station:<sig>', 'pick:<n>', 'dis:<id>',
// 'dislist', 'co:' 'kind:' 'late' 'still' (a group), 'page:settings|help|conn', and My trains' and the ride page's own.
// At an earlier moment (The day) a page showing live data says "Only live. Back to live?" in its place.
//
// createRouter({ home, own, train, station, picker, dis, group, held, live, day, stack }) -> defineNow(key); stack is a getter
import { t } from '../i18n.js';
import { esc } from '../html.js';

const LIVE_ONLY = new Set(['train', 'station', 'pick', 'dis', 'dislist', 'co', 'kind', 'late', 'still']);

export function createRouter({ home, own, train, station, picker, dis, group, held, live, day, stack }) {
  function define(key) {
    if (key === 'home') return home;
    const mine = own(key);   // (undefined: not theirs)
    if (mine !== undefined) return mine;
    const i = key.indexOf(':'), type = i < 0 ? key : key.slice(0, i), v = i < 0 ? '' : key.slice(i + 1);
    switch (type) {
      case 'train': return train(v);
      case 'station': return station(v);
      case 'pick': return picker(key);
      case 'dis': return dis.one(v);
      case 'dislist': return live ? dis.list() : null;
      case 'co': case 'kind': case 'late': case 'still': return group(key);
      case 'page': return held(v);
      default: return null;
    }
  }
  return function defineNow(key) {
    const def = define(key);
    if (!def || !day.past || !LIVE_ONLY.has(key.split(':')[0])) return def;
    return {
      name: def.name, kind: 'onlylive',
      show(el) {
        // (live again before it showed: the real page in its place)
        if (!day.past) { setTimeout(() => { if (stack().top() === key) stack().replace(key); }); return; }
        el.innerHTML = `<div class="only-live"><p>${esc(t('dayOnlyLive'))}</p><small class="sub">${esc(t('dayOnlyLiveSub'))}</small>` +
          `<button type="button" class="only-live-go">${esc(t('dayBackLive'))}</button></div>`;
        el.querySelector('.only-live-go').onclick = () => day.view.live();
      },
    };
  };
}
