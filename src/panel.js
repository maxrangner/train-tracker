// The panel that opens when a train is tapped: where it runs and every stop, planned and actual.
import { fetchRoute } from './trafikverket.js';
import { splitLabel, tagHtml } from './tag.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { hhmm } from './clock.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const time = t => (t ? hhmm(t) : '');
const off = (planned, at) => {
  if (!at) return '';
  const m = Math.round((at - planned) / 60000);
  return m === 0 ? '' : `${m > 0 ? '+' : ''}${m}`;
};

// The favourite star (☆ / ★), used by the train panel and the station board.
export const star = on => `<button class="panel-star" type="button" aria-pressed="${on}" aria-label="${t(on ? 'starOn' : 'starOff')}">${icon(on ? 'starFilled' : 'star')}</button>`;

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
    `<div class="panel-head"><span class="panel-title"><strong>${splitLabel(label).number}</strong>${tagHtml(splitLabel(label).minutes)}</span><span class="panel-buttons">` +
    (number && isStarred ? star(isStarred(number)) : '') +
    (canFollow ? `<button class="panel-follow" type="button" aria-pressed="${following}">${t(following ? 'following' : 'follow')}</button>` : '') +
    `<button class="panel-close" type="button" aria-label="${t('close')}">${icon('close')}</button></span></div>`;
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

  // While a card is open its times are asked for again every minute (Max, 2026-11-14: they came only once, when
  // it opened, so new actual times never showed). The table keeps where it was scrolled to.
  const REFRESH_MS = 60000;
  let refreshTimer = null;
  function refreshLater(train) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (openId !== train.id) return;
      try {
        const route = await fetchRoute(train.operational, train.date);
        if (openId !== train.id) return;
        const first = !shown?.route;
        shown = { train, route };
        if (first) onRoute?.(train.id, route);   // the first try had failed: its path too
        draw(train, route, { keepScroll: !first });
      } catch (e) {
        console.warn('route refresh:', e.message);
      }
      refreshLater(train);
    }, REFRESH_MS);
  }

  function close() {
    clearTimeout(refreshTimer);
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
      if (openId === train.id) { el.querySelector('.panel-note').textContent = t('routeFailed', e.message); refreshLater(train); }
      return;
    }
    if (openId !== train.id) return;   // another train was tapped meanwhile
    onRoute?.(train.id, route);
    shown = { train, route };
    draw(train, route);
    refreshLater(train);
  }

  // The panel's table for a train whose route has loaded.
  // keepScroll: a refresh; the table stays where it was scrolled to (otherwise it scrolls to the next stop).
  function draw(train, route, { keepScroll = false } = {}) {
    const scrolled = keepScroll ? el.querySelector('.panel-table')?.scrollTop : undefined;
    const status = el.querySelector('.panel-status')?.textContent ?? '';
    // One line per passenger stop: arrival and departure at the same station merged (they can come in either
    // order when both have the same planned minute).
    const stops = [];
    for (const s of route.stops.filter(x => x.advertised)) {
      const slot = s.activity === 'Avgang' ? 'dep' : 'arr';
      const last = stops.at(-1);
      if (last && last.station === s.station && !last[slot]) { last[slot] = s; continue; }
      stops.push({ station: s.station, [slot]: s });
    }
    // The next stop: the first with no actual time that isn't cancelled (a cancelled stop never gets one, so every
    // stop after it stayed "not passed": 1141 on 13 Nov, Ronneby cancelled, Max's note).
    const nextIdx = stops.findIndex(s => { const m = s.dep ?? s.arr; return !m.actual && !m.canceled; });

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
        `<td class="t dev">${off(main.planned, seen)}</td>` +
        `<td class="trk">${esc(d?.track || a?.track || '')}</td></tr>`;
    }).join('');

    // Trafikverket's notes (Max, 2026-11-13): problems first, then the rest. Each once; when it holds for only some
    // stops, they are named: "(Göteborg C)", "(from Alingsås)", "(Herrljunga, Vårgårda +3)".
    const noteLines = [];
    for (const kind of ['problems', 'notes']) {
      const at = new Map();   // text -> indices of the stops it is given at
      stops.forEach((s, i) => {
        for (const x of [s.arr, s.dep]) for (const text of x?.[kind] ?? []) {
          if (!at.has(text)) at.set(text, new Set());
          at.get(text).add(i);
        }
      });
      for (const [text, set] of at) {
        const idx = [...set].sort((a, b) => a - b);
        const run = idx.at(-1) - idx[0] === idx.length - 1;   // one stretch of stops in a row
        const name = i => stationName(stops[i].station);
        const where = idx.length === stops.length ? ''
          : run && idx.length >= 3 && idx.at(-1) === stops.length - 1 ? t('noteFrom', name(idx[0]))
          : run && idx.length >= 3 && idx[0] === 0 ? t('noteUntil', name(idx.at(-1)))
          : idx.slice(0, 2).map(name).join(', ') + (idx.length > 2 ? ` +${idx.length - 2}` : '');
        noteLines.push(`<p class="panel-tvnote${kind === 'problems' ? ' problem' : ''}">${esc(text)}${where ? ` <span>(${esc(where)})</span>` : ''}</p>`);
      }
    }

    const from = route.from ? stationName(route.from) : '';
    const to = route.to ? stationName(route.to) : '';
    el.innerHTML =
      head(train.label) +
      `<p class="panel-note">${[route.product, from && to ? `${from} → ${to}` : ''].filter(Boolean).join(' · ')}</p>` +
      (noteLines.length ? `<div class="panel-tvnotes">${noteLines.join('')}</div>` : '') +
      (stops.length
        ? `<div class="panel-table"><table><thead><tr><th>${t('station')}</th><th>${t('arr')}</th><th>${t('dep')}</th><th>${t('actual')}</th><th></th><th class="trk">${t('track')}</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="panel-note">${t('noStops')}</p>`);
    wireHead();
    if (status) setStatus(status);   // the line on how its place is known stays (main.js updates it each second)
    // Scroll the table (only the table) so the next stop is in view.
    const box = el.querySelector('.panel-table'), next = el.querySelector('tr.next');
    if (box && scrolled !== undefined) box.scrollTop = scrolled;
    else if (box && next) box.scrollTop = next.offsetTop - box.clientHeight / 2;
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
