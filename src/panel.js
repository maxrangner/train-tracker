// The panel that opens when a train is tapped: where it runs and every stop, planned and actual.
import { fetchRoute } from './trafikverket.js';
import { t } from './i18n.js';

const time = t => (t ? new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '');
const off = (planned, at) => {
  if (!at) return '';
  const m = Math.round((at - planned) / 60000);
  return m === 0 ? '' : `${m > 0 ? '+' : ''}${m}`;
};

// The favourite star (☆ / ★), used by the train panel and the station board.
export const star = on => `<button class="panel-star" type="button" aria-pressed="${on}" aria-label="${t(on ? 'starOn' : 'starOff')}">${on ? '★' : '☆'}</button>`;

// onSelect(id or null): a train was opened, or the panel closed. onFollow(id, on): the Follow button was pressed.
// onRoute(id, route): the open train's route has loaded (fetchRoute), e.g. to draw its path.
// isStarred(number) / onStar(number) -> starred now: the ☆ for favourites.
export function createPanel(el, { stationName, onSelect, onFollow, onRoute, isStarred, onStar }) {
  let openId = null;
  let following = false;
  let canFollow = true;   // false for a train that isn't on the map
  let number = null;      // the open train's public number (for the star)
  let shown = null;       // { train, route }: what the panel shows, to redraw it in another language

  // The top line: the train's label, the Follow button (pressed while the camera follows the train) and ×.
  const head = label =>
    `<div class="panel-head"><strong>${label}</strong><span class="panel-buttons">` +
    (number && isStarred ? star(isStarred(number)) : '') +
    (canFollow ? `<button class="panel-follow" type="button" aria-pressed="${following}">${t(following ? 'following' : 'follow')}</button>` : '') +
    `<button class="panel-close" type="button" aria-label="${t('close')}">×</button></span></div>`;
  function wireHead() {
    el.querySelector('.panel-close').onclick = close;
    const f = el.querySelector('.panel-follow');
    if (f) f.onclick = () => { setFollowing(!following); onFollow?.(openId, following); };
    const s = el.querySelector('.panel-star');
    if (s) s.onclick = () => { const on = onStar(number); s.outerHTML = star(on); wireHead(); };
  }
  function setFollowing(on) {
    following = on;
    const b = el.querySelector('.panel-follow');
    if (b) { b.setAttribute('aria-pressed', String(on)); b.textContent = t(on ? 'following' : 'follow'); }
  }

  function close() {
    openId = null;
    el.hidden = true;
    el.innerHTML = '';
    onSelect?.(null);
  }

  // follow: false for a train that isn't on the map (picked from the timetable search).
  async function open(train, { follow = true } = {}) {
    openId = train.id;
    number = train.number ?? null;
    following = follow;   // opening a train on the map starts following it (main.js)
    canFollow = follow;
    onSelect?.(train.id);
    el.hidden = false;
    shown = { train, route: null };
    el.innerHTML = head(train.label) + `<p class="panel-note">${t('loadingRoute')}</p>`;
    wireHead();

    let route;
    try {
      route = await fetchRoute(train.operational, train.date);
    } catch (e) {
      if (openId === train.id) el.querySelector('.panel-note').textContent = t('routeFailed', e.message);
      return;
    }
    if (openId !== train.id) return;   // another train was tapped meanwhile
    onRoute?.(train.id, route);
    shown = { train, route };
    draw(train, route);
  }

  // The panel's table for a train whose route has loaded.
  function draw(train, route) {
    // One line per passenger stop: arrival and departure at the same station merged (they can come in either
    // order when both have the same planned minute).
    const stops = [];
    for (const s of route.stops.filter(x => x.advertised)) {
      const slot = s.activity === 'Avgang' ? 'dep' : 'arr';
      const last = stops.at(-1);
      if (last && last.station === s.station && !last[slot]) { last[slot] = s; continue; }
      stops.push({ station: s.station, [slot]: s });
    }
    const nextIdx = stops.findIndex(s => !(s.dep ?? s.arr).actual);

    const rows = stops.map((s, i) => {
      const a = s.arr, d = s.dep;
      const main = d ?? a;
      const seen = main.actual ?? main.estimated;
      const state = main.canceled ? 'canceled' : i < nextIdx || nextIdx === -1 ? 'passed' : i === nextIdx ? 'next' : '';
      return `<tr class="${state}">` +
        `<td class="st">${stationName(s.station)}</td>` +
        `<td class="t">${a ? time(a.planned) : ''}</td>` +
        `<td class="t">${d ? time(d.planned) : ''}</td>` +
        `<td class="t act">${main.canceled ? t('cancelledStop') : time(seen)}${main.actual ? '' : seen ? `<span class="est">${t('est')}</span>` : ''}</td>` +
        `<td class="t dev">${off(main.planned, seen)}</td></tr>`;
    }).join('');

    const from = route.from ? stationName(route.from) : '';
    const to = route.to ? stationName(route.to) : '';
    el.innerHTML =
      head(train.label) +
      `<p class="panel-note">${[route.product, from && to ? `${from} → ${to}` : ''].filter(Boolean).join(' · ')}</p>` +
      (stops.length
        ? `<div class="panel-table"><table><thead><tr><th>${t('station')}</th><th>${t('arr')}</th><th>${t('dep')}</th><th>${t('actual')}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="panel-note">${t('noStops')}</p>`);
    wireHead();
    // Scroll the table (only the table) so the next stop is in view.
    const box = el.querySelector('.panel-table'), next = el.querySelector('tr.next');
    if (box && next) box.scrollTop = next.offsetTop - box.clientHeight / 2;
  }

  // Draw it again as it is (Settings → Language changed): no new request, the map stays as it is.
  function relabel() {
    if (!openId || !shown) return;
    if (shown.route) { draw(shown.train, shown.route); return; }
    el.innerHTML = head(shown.train.label) + `<p class="panel-note">${t('loadingRoute')}</p>`;
    wireHead();
  }

  // A short line under the head saying how it stands with the train ('' for nothing), e.g. "No report for 3 min".
  function setStatus(text) {
    let line = el.querySelector('.panel-status');
    if (!text) { line?.remove(); return; }
    if (!line) {
      const head = el.querySelector('.panel-head');
      if (!head) return;
      line = Object.assign(document.createElement('p'), { className: 'panel-status' });
      head.after(line);
    }
    line.textContent = text;
  }

  return { open, close, setFollowing, setStatus, relabel, get openId() { return openId; } };
}
