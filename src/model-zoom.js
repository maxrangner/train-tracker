// From which zoom the trains are 3D models, without the 3D code itself: the map needs these from the start, and the
// 3D code (three.js, about 146 kB packed) is loaded a few seconds after the map shows (map.js load3d; Max,
// 2026-11-19: "Yes, add the small pause"). trains-3d.js passes them on as before.
import { settings } from './settings.js';

// Toy or real-size trains, the toy size and from which zoom: src/settings.js, read when used. A change of toy or real
// makes the map add a new layer (map.js), whose trains are then built the new way.
export const isToy = () => settings.trainStyle === 'toy';
// 'symbol': never a model, the dot or triangle at every zoom (Max, 2026-11-14: "Add toggle to never show 3d model.
// Only dot/triangle"). modelZoom() stays 13 then: the close-in labels and station names change over there as with
// real-size trains.
export const symbolOnly = () => settings.trainStyle === 'symbol';
export const modelZoom = () => (isToy() ? settings.toyZoom : 13);
// Whether trains are drawn as models at this zoom (by the setting; map.js also waits for the 3D code).
export const modelsAt = zoom => !symbolOnly() && zoom >= modelZoom();
