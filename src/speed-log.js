// Every train's reported speeds over the last 10 minutes, kept from when the page opened (Max, 2026-11-20, "A": the
// website's files carry only each train's latest position, so a train's speeds from before the page opened aren't
// there). For the train card's speed graph and its place among the moving trains (src/train-info.js).
// A report is kept only when it is newer than the train's last one (some trains re-send an older position:
// docs/data.md "Re-sent old positions"). A train reported gone is dropped.
const KEEP_MS = 10 * 60 * 1000;
export const FRESH_MS = 60 * 1000;   // a speed counts as "now" while its report is under a minute old (as src/stats.js)

export function createSpeedLog() {
  const byId = new Map();   // id -> [{ time, speed, lon, lat }] oldest first (speed null: none sent)
  let since = null;         // when the first report came (the page's clock)

  // records: as src/trains.js gets them ({ id, time, speed, lon, lat, gone }).
  function add(records, at) {
    since ??= at;
    // (The first answer holds the last 10 minutes at once, not in time order.)
    const list0 = records.length > 50 ? [...records].sort((a, b) => a.time - b.time) : records;
    for (const r of list0) {
      if (r.gone) { byId.delete(r.id); continue; }
      let list = byId.get(r.id);
      if (!list) byId.set(r.id, list = []);
      const last = list[list.length - 1];
      if (last && r.time <= last.time) continue;
      list.push({ time: r.time, speed: r.speed ?? null, lon: r.lon, lat: r.lat });
      let cut = 0;
      while (cut < list.length - 1 && list[cut].time < r.time - KEEP_MS) cut++;
      if (cut) list.splice(0, cut);
    }
  }
  // The latest report at or before t (null: none).
  function at(id, t) {
    const list = byId.get(id);
    if (!list?.length || list[0].time > t) return null;
    let lo = 0, hi = list.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (list[m].time <= t) lo = m; else hi = m - 1; }
    return list[lo];
  }
  return {
    add,
    at,
    // A train's reports from t - ms to t.
    of: (id, t, ms = KEEP_MS) => (byId.get(id) ?? []).filter(e => e.time > t - ms && e.time <= t),
    // Every moving train's speed at t (a report with a speed under a minute old, 2 km/h or more): [[id, kmh]].
    moving(t) {
      const out = [];
      for (const id of byId.keys()) {
        const e = at(id, t);
        if (e && e.speed !== null && e.speed >= 2 && t - e.time < FRESH_MS) out.push([id, e.speed]);
      }
      return out;
    },
    get since() { return since; },
    clear() { byId.clear(); since = null; },
  };
}
