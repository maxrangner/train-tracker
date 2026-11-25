// Today's arrivals from the fetcher's files, as src/day-stats.js asks: the whole day (hourly) and what changed since
// (every 5 minutes). On its own, importing only src/clock.js: tools/format-read-check.mjs runs it as released.
//
// arrivalsReader(fileOf, now) -> async (midnight, since) -> [{ id, planned, actual, brand }]
import { swedishDay } from '../clock.js';

export function arrivalsReader(fileOf, now) {
  return async function filesArrivals(midnight, since) {
    const full = await fileOf('arrivals');
    const add = await fileOf('arrivals-add').catch(() => null);
    const day = swedishDay(now()), rows = [];
    if (full.day === day && (since === null || since < full.t)) rows.push(...full.rows);
    if (add && add.day === day && add.t >= full.t) rows.push(...add.rows);
    return rows.map(([id, planned, actual, brand]) => ({ id, planned, actual, brand: brand ?? null }));   // (no company in files before 2026-11-21)
  };
}
