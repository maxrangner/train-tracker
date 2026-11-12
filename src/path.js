// A train's whole path along the rails, start to finish, from its timetable: every place it passes or stops at, in
// order, joined along the tracks (rail-net.js). Where no way along the tracks is found (a place missing from the
// network, a gap), that piece is a straight line. Plain JavaScript, no page parts.

const R = Math.PI / 180;
const metres = (a, b) => Math.hypot((b.lon - a.lon) * Math.cos(a.lat * R), b.lat - a.lat) * R * 6371000;

// places: [{ lon, lat, stop }] in the train's order; net: the rail network, or null.
// Returns { coords: [[lon, lat], ...], at: [index in coords of each place], stops: [[lon, lat], ...] (the passenger
// stops), stopAt: [index in coords of each stop] }.
export function pathOf(places, net) {
  const coords = [];
  const at = [];
  const add = (lon, lat) => {
    const last = coords[coords.length - 1];
    if (!last || last[0] !== lon || last[1] !== lat) coords.push([lon, lat]);
  };
  let prev = null, prevSnap = null;
  for (const p of places) {
    const snap = net ? net.snap(p, null, 500) : null;
    if (prev) {
      const poly = prevSnap && snap ? net.route(prevSnap, snap, metres(prev, p) * 3 + 3000) : null;
      if (poly) for (let i = 0; i < poly.lon.length; i++) add(poly.lon[i], poly.lat[i]);
      else add(snap?.lon ?? p.lon, snap?.lat ?? p.lat);
    } else {
      add(snap?.lon ?? p.lon, snap?.lat ?? p.lat);
    }
    at.push(coords.length - 1);
    prev = p;
    prevSnap = snap;
  }
  const stopIdx = places.map((p, i) => (p.stop ? at[i] : null)).filter(i => i !== null);
  return { coords, at, stops: stopIdx.map(i => coords[i]), stopAt: stopIdx };
}

// The index of the point of the path nearest to a place ({ lon, lat }).
export function nearestIndex(path, place) {
  const k = Math.cos(place.lat * R);
  let best = 0, bestD = Infinity;
  path.coords.forEach(([lon, lat], i) => {
    const d = ((lon - place.lon) * k) ** 2 + (lat - place.lat) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
