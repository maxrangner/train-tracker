// The panel that opens when a train is tapped: where it runs and every stop, planned and actual.
import { fetchRoute } from './trafikverket.js';

const time = t => (t ? new Date(t).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '');
const off = (planned, at) => {
  if (!at) return '';
  const m = Math.round((at - planned) / 60000);
  return m === 0 ? '' : `${m > 0 ? '+' : ''}${m}`;
};

export function createPanel(el, { stationName, onSelect }) {
  let openId = null;

  function close() {
    openId = null;
    el.hidden = true;
    el.innerHTML = '';
    onSelect?.(null);
  }

  async function open(train) {
    openId = train.id;
    onSelect?.(train.id);
    el.hidden = false;
    el.innerHTML = `<div class="panel-head"><strong>${train.label}</strong><button class="panel-close" aria-label="Close">×</button></div>` +
      `<p class="panel-note">Loading the route…</p>`;
    el.querySelector('.panel-close').onclick = close;

    let route;
    try {
      route = await fetchRoute(train.operational, train.date);
    } catch (e) {
      if (openId === train.id) el.querySelector('.panel-note').textContent = `Couldn't load the route: ${e.message}`;
      return;
    }
    if (openId !== train.id) return;   // another train was tapped meanwhile

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
        `<td class="t act">${main.canceled ? 'cancelled' : time(seen)}${main.actual ? '' : seen ? '<span class="est"> est.</span>' : ''}</td>` +
        `<td class="t dev">${off(main.planned, seen)}</td></tr>`;
    }).join('');

    const from = route.from ? stationName(route.from) : '';
    const to = route.to ? stationName(route.to) : '';
    el.innerHTML =
      `<div class="panel-head"><strong>${train.label}</strong><button class="panel-close" aria-label="Close">×</button></div>` +
      `<p class="panel-note">${[route.product, from && to ? `${from} → ${to}` : ''].filter(Boolean).join(' · ')}</p>` +
      (stops.length
        ? `<div class="panel-table"><table><thead><tr><th>Station</th><th>Arr.</th><th>Dep.</th><th>Actual</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="panel-note">No passenger stops in today's timetable (likely a freight or service train).</p>`);
    el.querySelector('.panel-close').onclick = close;
    // Scroll the table (only the table) so the next stop is in view.
    const box = el.querySelector('.panel-table'), next = el.querySelector('tr.next');
    if (box && next) box.scrollTop = next.offsetTop - box.clientHeight / 2;
  }

  return { open, close };
}
