// The realistic trains: each company's usual train model (toy-trains.js MODELS: its cars and nose) at real size, with
// the company's usual number of cars and its realistic paint (brands.js), built as faceted trains by src/train-kit.js
// (2026-11-18, Max's pick "R2"; until then one shared shape with the same sloped nose for every company).
//
// Model space: metres, x = across (right), y = along the train (+y = the front), z = up. The rails are at z = 0.
import { buildFacets, STYLES } from './train-kit.js';
import { MODELS } from './toy-trains.js';

// colours: { body, skirt, band, roof, nose, windscreen, stripe } (any left out fall back to sensible ones); cars: how
// many cars; model: a key of MODELS (toy-brands.js says which one a company runs). Returns a THREE.Group of cars, the
// train's middle at the origin, the front towards +y. opts.pieces: each piece its own part (tools/models-check.mjs).
export function buildTrain({ colours = {}, cars = 3, model = 'regina' } = {}, opts) {
  return buildFacets(MODELS, model, colours, STYLES.real, cars, opts);
}
