// The fetcher's round of planned-route questions (fetcher/ask-routes.mjs) when one question fails (the code review of
// 2026-11-21, finding 4): the groups after it are still asked, only the failed one is marked to ask again, and the
// error still reaches the log. And the planned files (finding 10): a train that comes (back) onto the map after the
// base file, its rows stored before it, is in the next planned-add file. Offline; under a second.
// Run: node tools/ask-routes-check.mjs
import { askRoutes } from '../fetcher/ask-routes.mjs';
import { createState } from '../fetcher/state.mjs';
import { buildPlanned } from '../fetcher/files.mjs';

const MIN = 60000, t = Date.parse('2026-11-22T08:00:00Z');
let failed = 0;
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };

// Three trains, one per group: A asked before (again, 30 min back), B new and on time (90 min back), C new and 40 min
// late (130 min back).
function pretendState() {
  const planned = new Map([['A', { asked: t - 10 * MIN, until: t }]]);
  const added = [];
  return {
    added, planned,
    trains: () => ['A', 'B', 'C'].map(id => ({ id, operational: id, gone: false })),
    plannedOf: id => planned.get(id) ?? null,
    lateBy: id => (id === 'C' ? 40 : 0),
    markAsked(ids, at) { for (const id of ids) planned.set(id, { ...(planned.get(id) ?? { until: 0 }), asked: at }); },
    addPlanned(rows) { added.push(...rows); },
  };
}

for (const failing of ['A', 'B', 'C']) {
  const state = pretendState(), asked = [];
  let error = null;
  try {
    await askRoutes(state, async (ops, from) => {
      asked.push(`${ops.join()} ${Math.round((t - from) / MIN)}`);
      if (ops.includes(failing)) throw new Error(`Trafikverket: 500 (${failing})`);
      return ops.map(op => ({ key: op }));
    }, t);
  } catch (e) { error = e; }
  const marks = ['A', 'B', 'C'].map(id => `${id}:${state.planned.get(id).asked === 0 ? 'again' : 'asked'}`).join(' ');
  ok(asked.join(', ') === 'A 30, B 90, C 130', `${failing} fails: every group still asked (${asked.join(', ')})`);
  ok(marks === ['A', 'B', 'C'].map(id => `${id}:${id === failing ? 'again' : 'asked'}`).join(' '), `${failing} fails: only it is asked again in 30 s (${marks})`);
  ok(error?.message.includes(failing) && state.added.length === 2, `${failing} fails: the error reaches the log, the other two routes are in (${state.added.length})`);
}
// The planned files: X's route stored at 07:50; the base file at 08:00 while X is off the map (no report for 20
// minutes); X reported again at 08:03; the planned-add file at 08:04.
{
  const state = createState(), T0 = t - 10 * MIN, base = t, add = t + 4 * MIN;
  const rec = (id, time) => ({ id, operational: id, date: '2026-11-22', number: id, lon: 18, lat: 59, speed: 0, bearing: 0, time, gone: false });
  state.addRecords([rec('X', T0 - 20 * MIN), rec('Y', base - MIN)], T0 - 20 * MIN);
  state.addPlanned([{ key: 'X', sig: 'Cst', activity: 'Avgang', planned: t + 20 * MIN }, { key: 'Y', sig: 'U', activity: 'Ankomst', planned: t + 30 * MIN }], T0);
  const shown = at => state.trains(at).filter(r => !r.gone).map(r => r.id);
  const baseIds = shown(base), baseFile = buildPlanned(state, base, baseIds, base - 4 * 60 * MIN);
  state.addRecords([rec('X', t + 3 * MIN)], t + 3 * MIN);
  const addFile = buildPlanned(state, add, shown(add), add - 4 * 60 * MIN, base, new Set(baseIds));
  const keys = file => [...new Set(file.rows.map(r => r[0]))].join() || 'none';
  ok(!baseIds.includes('X') && keys(baseFile) === 'Y', `the base file: X off the map, not in it (${keys(baseFile)})`);
  ok(keys(addFile) === 'X', `the planned-add file a minute after X is back: X's whole route in it, Y not again (${keys(addFile)})`);
}
console.log(failed ? `ask-routes-check FAILED (${failed})` : 'ask-routes-check ok');
process.exit(failed ? 1 : 0);
