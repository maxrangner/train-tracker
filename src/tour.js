// The shop window (Max's idea 4, 2026-11-22): the phone on its side (or on a charger, where the phone can tell) with
// no touch for IDLE_MS: the buttons fade and the camera tours Sweden by itself, a stop about STOP_MS each with one line
// of text. Any touch brings everything back. Pure: what to show next, and when to start.

export const IDLE_MS = 30 * 1000, STOP_MS = 20 * 1000;

const km = (a, b) => {
  const x = (b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180), y = b.lat - a.lat;
  return Math.hypot(x, y) * 111.2;
};
const ahead = (p, s) => {   // where a train is in s seconds at its speed and bearing
  const d = (p.speed ?? 0) / 3600 * s, b = (p.bearing ?? 0) * Math.PI / 180;
  return { lon: p.lon + d * Math.sin(b) / (111.2 * Math.cos(p.lat * Math.PI / 180)), lat: p.lat + d * Math.cos(b) / 111.2 };
};
const turn = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// Two moving trains about to pass each other: within 6 km, heading opposite ways, closer in 60 s than now. The pair
// that meets soonest.
export function meeting(trains) {
  const moving = trains.filter(x => (x.speed ?? 0) >= 40);
  let best = null;
  for (let i = 0; i < moving.length; i++) for (let j = i + 1; j < moving.length; j++) {
    const a = moving[i], b = moving[j], d = km(a, b);
    if (d > 6 || turn(a.bearing, b.bearing) < 135) continue;
    const d60 = km(ahead(a, 60), ahead(b, 60));
    if (d60 >= d) continue;
    const secs = d / ((a.speed + b.speed) / 3600);
    if (!best || secs < best.secs) best = { a, b, secs, lon: (a.lon + b.lon) / 2, lat: (a.lat + b.lat) / 2 };
  }
  return best;
}

// The tour's stops right now, in order, each { kind, lon, lat, zoom, train?, trains?, disruption?, value? }: the
// fastest train, the most late moving train, a disruption, a meeting. Kinds whose thing isn't there are left out.
// trains: [{ id, number, brand, lon, lat, speed, bearing, late (minutes or null) }]; disruptions: [{ id, header, place }].
export function stops(trains, disruptions = []) {
  const out = [], moving = trains.filter(x => (x.speed ?? 0) >= 5);
  const fastest = [...moving].sort((a, b) => b.speed - a.speed)[0];
  if (fastest) out.push({ kind: 'fastest', lon: fastest.lon, lat: fastest.lat, zoom: 11.5, train: fastest, value: Math.round(fastest.speed) });
  const late = [...moving].filter(x => x.late !== null && x.late !== undefined).sort((a, b) => b.late - a.late)[0];
  if (late && late.late >= 6 && late !== fastest) out.push({ kind: 'late', lon: late.lon, lat: late.lat, zoom: 11, train: late, value: late.late });
  const dis = disruptions.find(d => d.place);
  if (dis) out.push({ kind: 'disruption', lon: dis.place.lon, lat: dis.place.lat, zoom: 9.5, disruption: dis });
  const m = meeting(trains);
  if (m) out.push({ kind: 'meeting', lon: m.lon, lat: m.lat, zoom: 12, trains: [m.a, m.b], value: Math.max(1, Math.round(m.secs)) });
  return out;
}

// When the shop window runs. Fed the phone's state; says whether it should be on.
// state: { sideways (the screen wider than tall), charging (true / false / null: not known), lastTouch (ms), now (ms),
// enabled (the setting), busy (a sheet raised, the search open, The day running) }.
export function shouldRun({ sideways, charging, lastTouch, now, enabled, busy }) {
  if (!enabled || busy) return false;
  return (sideways || charging === true) && now - lastTouch >= IDLE_MS;
}
