// Toy trains: a short, chunky caricature of each company's usual train (step 5, "the look").
// The shape follows the real train model (X61, Regina, X2000 ...); the paint follows the company (toy-brands.js).
// Built as faceted trains by src/train-kit.js (2026-11-18, Max's pick "B"); this file holds the train models: each
// model's cars and nose shapes, which the realistic trains (train-model.js) use too, at real length.
//
// Model space: x = across (right), y = along the train (+y = the front), z = up, rails at z = 0. Drawn at caricature
// proportions (a unit is a few cars squeezed into ~20 m); trains-3d.js enlarges it so it never gets too small on screen.
import { buildFacets, STYLES } from './train-kit.js';

// A nose: how far the front sticks out (len) at each height. Below `base` (a share of the body height) the front is
// upright; above it, it curves back to the roof: k = 1 a straight slope, 2 a round bulb, 5+ nearly flat. screen:
// [from, to] as shares of the body height, where the windscreen sits on the nose; wrap: it wraps round the sides;
// twin: two windscreens; taper: the share of the width lost at the very tip, seen from above; lights: their height.
// ---- The train models ----
// Each: a list of vehicles from the back to the front, with their shapes. Lengths are caricature lengths.
// The source of each look is in brands.js (the photo it was read off).
const N = {
  // Alstom Coradia Nordic (X61, X62) and Coradia (X60): a big rounded nose, a wraparound windscreen.
  coradia: { taper: 0.22, len: 2.4, base: 0.22, k: 2.1, screen: [0.42, 0.86], wrap: true, coupler: true },
  // Bombardier Regina (X50–X55): a long, even slope.
  regina:  { taper: 0.2, len: 2.6, base: 0.28, k: 1.35, screen: [0.45, 0.88] },
  // Stadler Dosto (ER1): a tall double-decker, sloped nose.
  dosto:   { taper: 0.15, len: 2.2, base: 0.3, k: 1.5, screen: [0.5, 0.82] },
  // X40: a double-decker with a blunt, rounded face.
  x40:     { taper: 0.15, len: 1.3, base: 0.35, k: 2.6, screen: [0.5, 0.8] },
  // Bombardier Contessa (X31K): a blunt black face.
  x31:     { taper: 0.08, len: 0.7, base: 0.5, k: 3.5, screen: [0.45, 0.82] },
  // ASEA X10 family (X11, X14): a flat face, two windscreens.
  x10:     { len: 0.45, base: 0.6, k: 5, screen: [0.5, 0.8], twin: true },
  // Bombardier Itino (Y31, Y32): a flat, upright face.
  itino:   { len: 0.6, base: 0.55, k: 4, screen: [0.45, 0.85] },
  // X2000: a long wedge on the power car.
  x2000:   { taper: 0.3, len: 3.8, base: 0.12, k: 1.15, screen: [0.5, 0.85], lights: 0.12 },
  x2000dt: { taper: 0.15, len: 1.4, base: 0.3, k: 2.2, screen: [0.5, 0.85] },          // the driving coach at the other end
  // Alstom Zefiro Express / Avelia Stream (X80): a bullet nose.
  x80:     { taper: 0.32, len: 3.2, base: 0.18, k: 1.7, screen: [0.45, 0.86], wrap: true },
  // Stadler FLIRT (VR X74, Vy type 74): a rounded slope with a big dark mask.
  flirt:   { taper: 0.2, len: 2.3, base: 0.25, k: 1.6, screen: [0.4, 0.88], wrap: true },
  // NSB class 73 (the X2000's Norwegian relative): a long pointed nose.
  c73:     { taper: 0.3, len: 3.4, base: 0.15, k: 1.25, screen: [0.5, 0.86] },
  // Locomotives: Rc (boxy, two windscreens) and Vectron (a slanted face).
  rc:      { len: 0.35, base: 0.62, k: 6, screen: [0.52, 0.86], twin: true },
  vectron: { taper: 0.08, len: 1.0, base: 0.45, k: 1.0, screen: [0.56, 0.86] },
};
const unit = (length, front, back, extra = {}) => ({ length, front, back, height: 3.4, ...extra });

export const MODELS = {
  coradia: [unit(9, null, N.coradia, { panto: 'back' }), unit(9, N.coradia, null)],
  regina:  [unit(9, null, N.regina, { panto: 'back' }), unit(9, N.regina, null)],
  dosto:   [unit(9, null, N.dosto, { height: 4.5, decks: 2 }), unit(9, N.dosto, null, { height: 4.5, decks: 2, panto: 'back' })],
  x40:     [unit(9, null, N.x40, { height: 4.5, decks: 2 }), unit(9, N.x40, null, { height: 4.5, decks: 2, panto: 'back' })],
  x31:     [unit(9, null, N.x31, { panto: 'back' }), unit(9, N.x31, null)],
  x10:     [unit(8, null, N.x10, { panto: 'back' }), unit(8, N.x10, null)],
  itino:   [unit(8, null, N.itino, { roofBoxes: [0] }), unit(8, N.itino, null, { roofBoxes: [0] })],
  x2000:   [unit(7, null, N.x2000dt), unit(6, null, null), unit(9, N.x2000, null, { panto: 'front', noWindows: true })],
  x80:     [unit(9, null, N.x80, { panto: 'back' }), unit(9, N.x80, null)],
  flirt:   [unit(9, null, N.flirt, { panto: 'back' }), unit(9, N.flirt, null)],
  c73:     [unit(9, null, N.c73), unit(9, N.c73, null, { panto: 'back' })],
  rc:      [unit(6, null, null), unit(6, null, null), unit(5.5, N.rc, N.rc, { panto: 'both', noWindows: true, vents: true, loco: true })],
  vectron: [unit(6, null, null), unit(6, null, null), unit(6, N.vectron, N.vectron, { panto: 'both', noWindows: true, loco: true })],
};

// colours: { body, skirt, band, roof, nose, windscreen, stripe, frame, loco: { ...colours of the locomotive } }
// model: a key of MODELS. Returns a THREE.Group of cars, the train's middle at the origin, the front towards +y.
// opts.pieces: each piece its own part (tools/models-check.mjs).
export function buildToy({ model = 'regina', colours = {} } = {}, opts) {
  return buildFacets(MODELS, model, colours, STYLES.toy, 0, opts);
}
