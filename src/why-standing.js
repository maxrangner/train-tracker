// "Why are we standing?" (Max's idea 2, 2026-11-22): one honest sentence on a train that has stood still for over a
// minute, only from what the data says; never a guess (not from the train in front). The answer is a reason's kind
// and its parts; the card puts it into words (src/i18n.js whyStanding_*).
//
// In order:
// 1. 'disruption': a disruption in force on its stretch: its stations include the train's last passed or next stop,
//    or its drawn line passes within NEAR_KM of the train.
// 2. 'note': Trafikverket's own problem note at the stop it stands at or the next one ("Signalfel", "Växelfel"), not
//    "Inställt" (that says the stop is cancelled, not why it stands).
// 3. 'waiting': at a station (within AT_KM of it) after its planned departure, not yet left.
// 4. 'stop': at a station before its departure: a normal stop, no reason needed.
// 5. 'none': "No reason reported".

export const STAND_MS = 60 * 1000;   // standing this long before a reason is given
const NEAR_KM = 1.5, AT_KM = 0.6;

// A problem note that names a cause of standing (Trafikverket's texts, Swedish): faults ("Signalfel", "Växelfel",
// "Spårfel", "Elfel", "Fordonsfel"), accidents, people or animals on the track, works, waiting for another train,
// speed limits, weather. Not "Spårändrat" (another track), "Inställt", "Kort tåg", "Ändrad väg".
export const isCause = text => /fel\b|fel$|olycka|obehörig|djur|arbete|väntar|möte|hastighet|kontaktledning|polis|brand|oväder|storm|snö|stopp|nedsatt|störning/i.test(text)
  && !/spårändr|inställ|kort tåg|ändrad väg/i.test(text);

const km = (a, b) => {
  const x = (b.lon - a.lon) * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180), y = b.lat - a.lat;
  return Math.hypot(x, y) * 111.2;
};
// The distance from p to the line a-b (km; flat, fine for a few km).
function kmToPiece(p, a, b) {
  const k = Math.cos(p.lat * Math.PI / 180), ax = (a[0] - p.lon) * k, ay = a[1] - p.lat, bx = (b[0] - p.lon) * k, by = b[1] - p.lat;
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, f = l ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l)) : 0;
  return Math.hypot(ax + dx * f, ay + dy * f) * 111.2;
}

// train: { lon, lat } where it stands; route: src/trafikverket.js fetchRoute's answer ({ stops: [{ station, activity,
// planned, estimated, actual, canceled, problems }] }); station(sig) -> { name, lon, lat }; disruptions: their list
// (src/disruptions.js), each { id, header, sections }; lines(d) -> its drawn stretches (coordinate lists), optional;
// now: ms. Returns { kind, ... }.
// A disruption in force on the train's stretch: its stations include the last passed or next stop, or its drawn line
// passes within NEAR_KM of the train.
function onStretch(train, around, disruptions, lines) {
  for (const d of disruptions) {
    const bySig = d.sections?.some(sec => sec.some(sig => around.includes(sig)));
    const byLine = !bySig && lines(d).some(c => c.some((pt, i) => i > 0 && kmToPiece(train, c[i - 1], pt) < NEAR_KM));
    if (bySig || byLine) return { kind: 'disruption', id: d.id, header: d.header };
  }
  return null;
}

// "Why late?" (Max, 2026-11-23: "Also don't see the reason for the delay"): a train LATE_MIN or more late, moving or
// not, from the same honest sources: a disruption on its stretch, else Trafikverket's cause note on any of its stops
// (passed or ahead: the note stays on the stop where it happened), else 'none' ("No reason reported").
export const LATE_MIN = 5;
export function whyLate({ train, route, disruptions = [], lines = () => [], now }) {
  const stops = route?.stops ?? [];
  let last = -1;
  stops.forEach((s, i) => { if (s.actual && s.actual <= now) last = i; });
  const next = stops.findIndex((s, i) => i > last && !s.canceled);
  const dis = onStretch(train, [stops[last]?.station, stops[next]?.station].filter(Boolean), disruptions, lines);
  if (dis) return dis;
  const note = stops.flatMap(s => s.problems ?? []).find(isCause);
  return note ? { kind: 'note', text: note } : { kind: 'none' };
}

export function whyStanding({ train, route, station, disruptions = [], lines = () => [], now }) {
  const stops = route?.stops ?? [];
  // The last stop passed (an actual time) and the next one (none yet), by their rows.
  let last = -1;
  stops.forEach((s, i) => { if (s.actual && s.actual <= now) last = i; });
  const next = stops.findIndex((s, i) => i > last && !s.canceled);
  const around = [stops[last]?.station, stops[next]?.station].filter(Boolean);

  // 1. A disruption on its stretch.
  const dis = onStretch(train, around, disruptions, lines);
  if (dis) return dis;
  // Where it stands: at a station of its route?
  const at = stops.findIndex(s => { const st = station(s.station); return st && st.lon != null && km(train, st) < AT_KM; });
  const atSig = at >= 0 ? stops[at].station : null;
  // 2. Trafikverket's note naming a cause, at that station or any stop still ahead (531 on 17 Nov stood at Hjärup with
  // "Växelfel" on its last stop, Malmö C). Notes that aren't causes are left out ("Spårändrat", "Inställt", "Kort tåg").
  const ahead = stops.filter((s, i) => s.station === atSig || (next >= 0 && i >= next));
  const note = ahead.flatMap(s => s.problems ?? []).find(isCause);
  if (note) return { kind: 'note', text: note };
  // 3-4. At a station: its departure there.
  if (atSig) {
    const dep = stops.find(s => s.station === atSig && s.activity === 'Avgang');
    if (dep && !dep.actual) {
      const name = station(atSig)?.name ?? atSig;
      if (dep.planned < now - 30 * 1000) return { kind: 'waiting', station: name, planned: dep.planned, estimated: dep.estimated };
      return { kind: 'stop', station: name, planned: dep.planned };
    }
  }
  return { kind: 'none' };
}
