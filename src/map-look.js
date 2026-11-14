// The map's own look (Max, 2026-11-14: "Paper" for light, "Night" for dark, chosen from five sketches). The base map
// stays OpenFreeMap's (positron for light, dark for dark); restyleBase() recolours it and hides what a train map
// doesn't need: the base map's own railways (ours are drawn instead), borders, airports, and every name except places
// and water. Layers are found by their kind (source-layer), so a renamed layer in OpenFreeMap's style still works.
// Our own layers' colours (rails, stations, labels) are in map.js colours(), which reads LOOK.

// Each look: land, water, park, wood (and its opacity), town, building, rivers: fill colours (null: hidden);
// road, roadMinor, roadCasing: line colours (null: hidden); places: which place names show ('towns': cities, towns,
// regions, countries; 'all' adds villages and suburbs); text, halo: place names; waterText: sea and lake names (null:
// hidden).
export const LOOK = {
  light: {
    land: '#f4f0e6', water: '#c5dbe8', park: '#e4ecd6', wood: '#e2ead4', town: '#ece6d8', building: '#e2dbca', rivers: '#c5dbe8',
    road: '#ffffff', roadMinor: null, roadCasing: null, places: 'towns', text: '#5a5246', halo: '#f4f0e6', waterText: '#6f93aa',
  },
  dark: {
    land: '#131c2c', water: '#0b1220', park: null, wood: '#16233a', woodOpacity: 0.6, town: '#182338', building: '#1c2940', rivers: '#0b1220',
    road: '#1e2a41', roadMinor: null, roadCasing: null, places: 'towns', text: '#9fb0c6', halo: '#131c2c', waterText: null,
  },
};

// Recolour the base map's layers for the light or dark look. Called after the base style has loaded, before our own
// layers are added (the sea-coloured cover outside Sweden takes the water colour from here).
export function restyleBase(map, dark) {
  const R = dark ? LOOK.dark : LOOK.light;
  const set = (id, p, v) => { try { map.setPaintProperty(id, p, v); } catch { /* not that kind of layer */ } };
  const show = (id, on) => { try { map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); } catch { /* */ } };
  const paint = (id, p, v) => (v ? (show(id, true), set(id, p, v)) : show(id, false));
  for (const l of map.getStyle().layers) {
    const sl = l['source-layer'], id = l.id;
    if (l.type === 'background') { set(id, 'background-color', R.land); continue; }
    if (l.source !== 'openmaptiles') continue;
    if (sl === 'water') set(id, 'fill-color', R.water);
    else if (sl === 'waterway') paint(id, 'line-color', R.rivers);
    else if (sl === 'park') paint(id, 'fill-color', R.park);
    else if (sl === 'landcover') {
      if (/ice|glacier/.test(id)) continue;
      paint(id, 'fill-color', R.wood);
      if (R.wood && R.woodOpacity) set(id, 'fill-opacity', R.woodOpacity);
    } else if (sl === 'landuse') paint(id, 'fill-color', R.town);
    else if (sl === 'building') { paint(id, 'fill-color', R.building); if (R.building) set(id, 'fill-outline-color', R.building); }
    else if (sl === 'aeroway' || sl === 'boundary') show(id, false);
    else if (sl === 'transportation' && l.type !== 'symbol') {
      if (/rail/.test(id)) show(id, false);                         // the base map's railways: ours are drawn instead
      else if (l.type === 'fill') paint(id, 'fill-color', R.road ? R.land : null);
      else if (/casing/.test(id)) paint(id, 'line-color', R.roadCasing);
      else if (/path|minor|subtle/.test(id)) paint(id, 'line-color', R.roadMinor);
      else paint(id, 'line-color', R.road);
    } else if (l.type === 'symbol') {
      if (sl === 'place') {
        const keep = R.places === 'all' || (R.places === 'towns' && /city|town|capital|country|state/.test(id)) ||
          (R.places === 'cities' && /city|capital/.test(id));
        show(id, keep);
        if (keep) { set(id, 'text-color', R.text); set(id, 'text-halo-color', R.halo); }
      } else if (sl === 'water_name') {
        show(id, Boolean(R.waterText));
        if (R.waterText) { set(id, 'text-color', R.waterText); set(id, 'text-halo-color', R.water); }
      } else show(id, false);                                       // road names, road numbers, airports
    }
  }
}
