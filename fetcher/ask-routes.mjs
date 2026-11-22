// Planned routes, asked once for everyone the way the page asks for its own trains (src/main.js askRoutes): trains on
// the map whose known route ends within 30 minutes (or isn't known), at most every 5 minutes per train, 30 minutes back
// (the first time 90, more when late) to 90 minutes ahead; the first time with the company. Out of fetcher/main.mjs
// since 2026-11-22 so tools/ask-routes-check.mjs can try it.
// Each group is asked on its own: one that fails is marked not asked (tried again in 30 s) and the groups after it are
// still asked; the first error is thrown at the end, for the log. (Until 2026-11-22 the first failure ended the round:
// the groups after it stayed marked as asked, unasked for 5 minutes and then asked the short way; the code review of
// 2026-11-21, finding 4.)
const MIN = 60000;
export const BACK_MS = 30 * MIN, FIRST_BACK_MS = 90 * MIN, MAX_BACK_MS = 4 * 60 * MIN, LATE_MIN = 15;

export async function askRoutes(state, fetchPlannedRoutes, t = Date.now()) {
  const want = state.trains(t).filter(r => !r.gone && (state.plannedOf(r.id)?.until ?? 0) < t + 30 * MIN && !(t - (state.plannedOf(r.id)?.asked ?? 0) < 5 * MIN));
  if (!want.length) return;
  const again = want.filter(r => state.plannedOf(r.id)?.asked), first = want.filter(r => !state.plannedOf(r.id)?.asked);
  const late = first.filter(r => state.lateBy(r.id) > LATE_MIN), onTime = first.filter(r => !(state.lateBy(r.id) > LATE_MIN));
  state.markAsked(want.map(r => r.id), t);
  const groups = [[again, BACK_MS, false], [onTime, FIRST_BACK_MS, true],
    [late, Math.min(MAX_BACK_MS, FIRST_BACK_MS + Math.max(0, ...late.map(r => state.lateBy(r.id))) * MIN), true]];
  let error = null;
  for (const [list, back, withBrand] of groups) {
    if (!list.length) continue;
    try {
      state.addPlanned(await fetchPlannedRoutes([...new Set(list.map(r => r.operational))], t - back, t + 90 * MIN, { withBrand }), Date.now());
    } catch (e) {
      state.markAsked(list.map(r => r.id), 0);
      error ??= e;
    }
  }
  if (error) throw error;
}
