// The page's clock. Live it is this computer's clock; in a replay (src/replay-source.js) it runs from the
// recording's start, at normal speed, so everything that reads the time sees the recording's time.
let offset = 0;

export const now = () => Date.now() + offset;

// From now on the clock says t (ms) and runs on from there.
export function setClock(t) { offset = t - Date.now(); }
