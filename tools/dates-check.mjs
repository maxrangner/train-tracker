// The date passes (TODO 62, 2026-11-22: "do a thorough check on this topic ... Then fix all"): the fetcher's timetable
// and its tap files (fetcher/timetable.mjs, fetcher/tap-round.mjs) and the page's readers of them
// (src/files-source.js filesTapAsker, src/trafikverket.js) through four nights on a fake clock
// (tools/lib/fake-time.mjs), with a pretend Trafikverket serving the saved day of 17 Nov copied onto each day:
//   an ordinary night (18-19 Nov), the 23-hour day (28-30 Mar 2026), the 25-hour day (24-26 Oct 2026), the year's turn.
// Each night from 17:50 to 06:30 the next morning (the clock-change nights: from the day before, to the day after):
//   - the timetable is ready every minute and holds exactly yesterday, today and (from 18:00) tomorrow;
//   - today is asked again at 03:30 once, and stays ready meanwhile;
//   - 23:30: a train after midnight on a station's board has its whole card;
//   - 00:01: a train of the new day is found by its number, has its card, and is in its station's whole day;
//   - 00:30: the trains still running from the day before have every stop;
//   - every day's whole-day file at 23:30 has all the day's trains at its stations.
// Run twice: in Swedish time and with the computer in UTC (the Linux PC's zone is not known); the second by itself.
// About a minute, offline. Run: node tools/dates-check.mjs     exit code 0: all hold.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fakeClock, shiftDay } from './lib/fake-time.mjs';

const fails = [], notes = [];
const ok = (good, what) => (good ? notes : fails).push(what);
const MIN = 60000, HOUR = 60 * MIN;
const zone = process.env.TZ || 'the computer\'s own zone';

// The saved day, thinned: every train that runs past midnight, and every fifth other one (memory and time).
const SAVED = JSON.parse(readFileSync(new URL('../data/measure/day-2026-11-17.json', import.meta.url), 'utf8'));
const numberOf = a => a.AdvertisedTrainIdent || a.OperationalTrainNumber || '';
const crossing = new Set(SAVED.filter(a => a.AdvertisedTimeAtLocation?.startsWith('2026-11-18')).map(numberOf));
const DAY = SAVED.filter(a => a.LocationSignature && a.AdvertisedTimeAtLocation && (crossing.has(numberOf(a)) || Number(numberOf(a)) % 5 === 0));

const NIGHTS = [
  { name: 'an ordinary night', days: ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'], from: '2026-11-18T17:50', to: '2026-11-19T06:30', turns: ['2026-11-19'] },
  { name: 'the 23-hour day (29 Mar)', days: ['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31'], from: '2026-03-28T17:50', to: '2026-03-30T06:30', turns: ['2026-03-29', '2026-03-30'] },
  { name: 'the 25-hour day (25 Oct)', days: ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'], from: '2026-10-24T17:50', to: '2026-10-26T06:30', turns: ['2026-10-25', '2026-10-26'] },
  { name: 'the year\'s turn', days: ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'], from: '2026-12-31T17:50', to: '2027-01-01T06:30', turns: ['2027-01-01'] },
];

const { swedishParts, midnightOf, addDays, swedishDay } = await import('../src/clock.js');
// A Swedish wall time 'YYYY-MM-DDTHH:MM' as a moment (the first, in October's repeated hour).
const at = wall => [2, 1].map(h => Date.parse(`${wall}:00+0${h}:00`)).find(t => { const p = swedishParts(t); return `${p.day}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` === wall; });

async function night(n) {
  const served = new Map(n.days.map(d => [d, shiftDay(DAY, '2026-11-17', d)]));
  const clock = fakeClock(at(n.from));
  const pick = (xml, op, name) => new RegExp(`<${op} name="${name}" value="([^"]+)"`).exec(xml)?.[1];
  const asked = [];
  globalThis.fetch = async (url, opts = {}) => {
    const body = String(opts.body ?? '');
    let result;
    if (body.includes('changeid=')) result = { TrainAnnouncement: [], INFO: { LASTCHANGEID: '1', SSEURL: 'https://api.trafikinfo.trafikverket.se/v2/data.json?ssl=1' } };
    else if (body.includes('TrainStationMessage')) result = { TrainStationMessage: [] };
    else {
      const day = pick(body, 'EQ', 'ScheduledDepartureDateTime'), a = Date.parse(pick(body, 'GTE', 'AdvertisedTimeAtLocation')), b = Date.parse(pick(body, 'LT', 'AdvertisedTimeAtLocation'));
      asked.push({ day, at: Date.now() });
      result = { TrainAnnouncement: (served.get(day) ?? []).filter(r => { const p = Date.parse(r.AdvertisedTimeAtLocation); return p >= a && p < b; }) };
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ RESPONSE: { RESULT: [result] } }), text: async () => '' };
  };
  globalThis.EventSource = class { static CLOSED = 2; constructor() { this.readyState = 1; } close() { this.readyState = 2; } };

  const { createTimetable } = await import('../fetcher/timetable.mjs');
  const { createTapRound } = await import('../fetcher/tap-round.mjs');
  const { filesTapAsker } = await import('../src/files-source.js');
  const tv = await import('../src/trafikverket.js');
  const files = {};
  const shelf = { put: (kind, t, obj) => { files[kind] = JSON.parse(JSON.stringify(obj)); } };
  let round = null;
  const tt = createTimetable({ log: () => {}, onLoaded: () => round?.loaded() });
  round = createTapRound({ timetable: tt, shelf, breather: () => Promise.resolve() });
  const tickErrors = [];
  setInterval(() => round.tick().catch(e => tickErrors.push(`${label(Date.now())}: ${e.message}`)), 30000);
  tv.setTapAsker(filesTapAsker(async kind => files[kind] ?? null, () => Date.now()));

  const loaded = [];   // [day, when]
  const wrongDays = [], notReady = [];
  let first = true;
  const label = t => { const p = swedishParts(t); return `${p.day} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
  const byNumber = new Map();   // per served day: number -> rows
  for (const [d, rows] of served) { const m = new Map(); for (const r of rows) { const k = numberOf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } byNumber.set(d, m); }

  const checks = [];
  const when = (wall, fn) => checks.push([at(wall), fn]);
  for (const turn of n.turns) {
    const eve = addDays(turn, -1);
    // 23:30: a train after midnight on a big station's board has its whole card.
    when(`${eve}T23:30`, async (t) => {
      const sig = 'Cst';
      const board = await tv.fetchBoard(sig, 'Avgang', 40, t).catch(e => ({ error: e.message }));
      const rows = board.rows ?? board;
      const next = Array.isArray(rows) ? rows.find(r => r.date === turn) : null;
      if (!next) { ok(false, `${n.name}, ${label(t)}: no train of ${turn} on ${sig}'s board (${board.error ?? (Array.isArray(rows) ? rows.length + ' rows' : '?')})`); return; }
      const want = byNumber.get(turn).get(String(next.number))?.length ?? 0;
      const route = await tv.fetchRoute(next.operational, next.date, next.number).catch(() => null);
      const got = route?.stops?.length ?? route?.length ?? 0;
      ok(got > 0 && got >= Math.min(want, 2), `${n.name}, ${label(t)}: ${next.number} (${turn}, from ${sig}'s board) has its card (${got} stops)`);
    });
    // 00:01: a train of the new day starting 00:05-06:00 by its number, its card, its station's whole day.
    when(`${turn}T00:01`, async (t) => {
      const cand = [...byNumber.get(turn)].find(([, rows]) => { const p = Math.min(...rows.map(r => Date.parse(r.AdvertisedTimeAtLocation))); return p > t + 4 * MIN && p < t + 6 * HOUR && rows.some(r => r.Advertised); });
      if (!cand) { ok(false, `${n.name}, ${label(t)}: no new-day train to try`); return; }
      const [number, rows] = cand;
      const found = await tv.fetchTrainsByNumber(number, turn).catch(() => []);
      ok(found.length > 0, `${n.name}, ${label(t)}: number search finds ${number} of ${turn} (${found.length})`);
      const firstRow = rows.filter(r => r.Advertised && r.ActivityType === 'Avgang').sort((a, b) => Date.parse(a.AdvertisedTimeAtLocation) - Date.parse(b.AdvertisedTimeAtLocation))[0];
      if (found[0]) {
        const route = await tv.fetchRoute(found[0].operational, found[0].date, number).catch(() => null);
        ok((route?.stops?.length ?? route?.length ?? 0) > 0, `${n.name}, ${label(t)}: ${number}'s card has stops (${route?.stops?.length ?? route?.length ?? 0})`);
      }
      if (firstRow) {
        const day = await tv.fetchStationDay(firstRow.LocationSignature, 'Avgang', t).catch(() => []);
        const { groupOf } = await import('../src/tap-files.js'), df = files[`day-${groupOf(firstRow.LocationSignature)}`];
        ok(day.some(r => String(r.number) === number), `${n.name}, ${label(t)}: ${number} is in ${firstRow.LocationSignature}'s whole day (${day.length} trains; its file made ${df ? label(df.t) : 'never'})`);
      }
    });
    // 00:30: every train still running from the day before has every stop.
    when(`${turn}T00:30`, async (t) => {
      let short = 0, n0 = 0;
      for (const [number, rows] of byNumber.get(eve)) {
        const last = Math.max(...rows.map(r => Date.parse(r.AdvertisedTimeAtLocation)));
        if (last < t + 30 * MIN || !crossing.has(number)) continue;
        n0++;
        const route = await tv.fetchRoute(rows[0].OperationalTrainNumber, eve, number).catch(() => null);
        if ((route?.stops?.length ?? route?.length ?? 0) < 2) short++;
      }
      ok(n0 > 0 && short === 0, `${n.name}, ${label(t)}: the ${n0} trains still running from ${eve} have their cards (${short} without)`);
      // The number search and a starred train after midnight: last night's run while it still runs (src/trafikverket.js
      // fetchRunsByNumber, pickRun; until 2026-11-22 only today's was asked).
      const night = [...byNumber.get(eve)].find(([number, rows]) => crossing.has(number) && Math.max(...rows.map(r => Date.parse(r.AdvertisedTimeAtLocation))) > t + HOUR && byNumber.get(turn).has(number));
      if (night) {
        const runs = await tv.fetchRunsByNumber(night[0], t).catch(() => []), pick = tv.pickRun(runs, t);
        ok(runs.some(r => r.date === eve) && pick?.date === eve, `${n.name}, ${label(t)}: searching ${night[0]} finds last night's run still going (${runs.map(r => r.date).join(', ') || 'none'}); a star opens it (${pick?.date ?? 'none'})`);
      }
    });
  }
  // (In the first two minutes after midnight the day before yesterday may still be held: the days are looked at once a minute.)
  // Every evening's whole day at a big station: all its trains of the day.
  for (const d of n.days.slice(1, -1)) when(`${d}T23:30`, async (t) => {
    if (t < at(n.from) || t > at(n.to)) return;
    const want = (served.get(d) ?? []).concat(served.get(addDays(d, -1)) ?? [], served.get(addDays(d, 1)) ?? [])
      .filter(r => r.LocationSignature === 'Cst' && r.ActivityType === 'Avgang' && r.Advertised && !r.Deleted && swedishDay(Date.parse(r.AdvertisedTimeAtLocation)) === d).length;
    const got = (await tv.fetchStationDay('Cst', 'Avgang', t).catch(() => [])).length;
    ok(got === want, `${n.name}, ${label(t)}: Cst's whole day of ${d}: ${got} of ${want} departures`);
  });
  checks.sort((a, b) => a[0] - b[0]);

  await clock.runTo(at(n.to), async (t) => {
    const p = swedishParts(t), held = tt.stats().days;
    if (first && tt.ready()) first = false;
    if (!first && !tt.ready()) notReady.push(label(t));
    const allowed = new Set([p.day, addDays(p.day, -1), addDays(p.day, 1)]);
    const bad = held.filter(d => !allowed.has(d));
    if (!first && !(p.hour === 0 && p.minute < 2) && (bad.length || !held.includes(p.day) || (p.hour >= 1 && !held.includes(addDays(p.day, -1))) || (p.hour >= 19 && !held.includes(addDays(p.day, 1))))) wrongDays.push(`${label(t)}: ${held.join(',')}`);
    while (checks.length && checks[0][0] <= t) await checks.shift()[1](t);
  });
  for (const a of asked) loaded.push(a.day);
  const today03 = n.turns.map(d => asked.filter(a => a.day === d && a.at >= at(`${d}T03:30`) && a.at < at(`${d}T04:30`)).length);
  ok(!tickErrors.length, `${n.name}: the tap files made without errors${tickErrors.length ? ` (${tickErrors.slice(0, 2).join("; ")})` : ""}`);
  ok(!notReady.length, `${n.name}: ready every minute${notReady.length ? ` (not at ${notReady.slice(0, 3).join(', ')}${notReady.length > 3 ? ` and ${notReady.length - 3} more` : ''})` : ''}`);
  ok(!wrongDays.length, `${n.name}: holds yesterday, today and (from 18:00) tomorrow${wrongDays.length ? ` (wrong at ${wrongDays.length} minutes, e.g. ${wrongDays[0]})` : ''}`);
  ok(today03.every(q => q > 0), `${n.name}: today asked again at 03:30 (${today03.join(', ')} questions)`);
  tt.stop();
  clock.restore();
}

// The journey date: in the midnight recording (2026-11-12T23-02-56) three trips take a new internal number after
// midnight (989 as 991, 1738 as 21738, 8777 as 18778); their day is still the trip's (12 Nov), as in the timetable.
{
  const { toRecord } = await import('../src/trains-source.js');
  const lines = readFileSync(new URL('../data/positions-2026-11-12T23-02-56-574Z.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const off = new Set(), seen = new Set();
  for (const p of lines) {
    const r = toRecord(p);
    if (!r) continue;
    if (['989', '1738', '8777'].includes(String(r.number))) seen.add(r.id);
    if (p.Train?.JourneyPlanDepartureDate && r.date !== p.Train.JourneyPlanDepartureDate.slice(0, 10)) off.add(r.id);
  }
  ok(off.size === 0 && [...seen].some(id => id === '991/2026-11-12'), `the midnight recording: every train's day is its trip's (${off.size} not; 989 as ${[...seen].filter(id => id.startsWith('991/')).join(', ') || 'not seen'})`);
}

// The page at the day's turn and on the clock-change days (step 5).
{
  const { createDayStats } = await import('../src/day-stats.js');
  const { createStats } = await import('../src/stats.js');
  const { hhmm } = await import('../src/clock.js');
  const tv = await import('../src/trafikverket.js');
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
  // Today's graph: a page open across midnight shows the new day at once, not yesterday's bars.
  let T = at('2026-11-18T23:58');
  const arrivals = mid => [{ id: `1|Cst|${mid}`, planned: mid + 3600000, actual: mid + 3600000, brand: 'SJ' }];
  const ds = createDayStats({ now: () => T, loadArrivals: async mid => arrivals(mid) });
  ds.open(); await settle();
  const before = ds.view();
  T = at('2026-11-19T00:02');
  const after = ds.view();
  ds.tick(); await settle();
  const asked = ds.view();
  ok(before.state === 'ok' && after.state === 'loading' && after.hours.length === 1 && asked.state === 'ok' && asked.midnight === midnightOf('2026-11-19'),
    `the day graph at 00:02: the new day at once (${before.state} -> ${after.state}, ${after.hours.length} hour; asked: ${asked.state})`);
  // Its hours named by the clock on the clock-change days.
  for (const [day, slot, want] of [['2026-03-29', 2, '03'], ['2026-03-29', 22, '23'], ['2026-10-25', 3, '02'], ['2026-10-25', 24, '23']]) {
    T = at(`${day}T12:00`);
    const v = ds.view();
    ok(hhmm(v.midnight + slot * 3600000).slice(0, 2) === want, `the day graph on ${day}: bar ${slot} is the hour ${want} (${hhmm(v.midnight + slot * 3600000).slice(0, 2)})`);
  }
  // "Cancelled today": yesterday's count is not today's.
  const st = createStats({ keep: false });
  T = at('2026-11-18T23:50');
  st.wantCancelled(async () => ({ count: 144, day: '2026-11-18' }), T); await settle();
  T = at('2026-11-19T00:02');
  st.wantCancelled(async () => ({ count: 144, day: '2026-11-18' }), T); await settle();
  const stale = st.cancelledCount();
  T = at('2026-11-19T00:04');
  st.wantCancelled(async () => ({ count: 3, day: '2026-11-19' }), T); await settle();
  ok(stale === null && st.cancelledCount() === 3, `cancelled today after midnight: yesterday's 144 not shown (${stale}), today's 3 within minutes (${st.cancelledCount()})`);
  // The key page's whole-day search in summer: a train at 00:00 (Trafikverket's GT is "after").
  tv.setTapAsker(null); tv.setKey?.('x');
  const rowsAt = ['2026-06-15T00:00:00.000+02:00', '2026-06-15T23:59:00.000+02:00', '2026-06-14T23:59:00.000+02:00'];
  globalThis.fetch = async (url, opts = {}) => {
    const from = Date.parse(/<GT name="AdvertisedTimeAtLocation" value="([^"]+)"/.exec(String(opts.body))?.[1]);
    const list = rowsAt.filter(x => Date.parse(x) > from).map((x, i) => ({ AdvertisedTrainIdent: String(100 + i), OperationalTrainNumber: String(100 + i), ScheduledDepartureDateTime: x.slice(0, 10), AdvertisedTimeAtLocation: x }));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ RESPONSE: { RESULT: [{ TrainAnnouncement: list }] } }), text: async () => '' };
  };
  const summer = await tv.fetchStationDay('Cst', 'Avgang', Date.parse('2026-06-15T12:00:00+02:00')).catch(e => ({ error: e.message }));
  ok(Array.isArray(summer) && summer.length === 2, `the key page's whole day on a summer day: the 00:00 train in (${Array.isArray(summer) ? summer.length + ' of 2' : summer.error})`);
  // A disruption from the same date a year ago shows its year.
  globalThis.location ??= { hash: '', search: '' };   // (the page's settings read the address)
  const { timesText } = await import('../src/disruptions.js');
  const txt = timesText({ since: Date.parse('2025-11-19T08:00:00+01:00'), until: null }, Date.parse('2026-11-19T12:00:00+01:00'));
  ok(/2025/.test(txt), `a disruption from a year ago shows its year ("${txt}")`);
}

for (const n of NIGHTS) {
  try { await night(n); } catch (e) { fails.push(`${n.name}: stopped: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`); }
}

for (const n of notes) console.log(`ok   [${zone}] ${n}`);
for (const f of fails) console.log(`FAIL [${zone}] ${f}`);
let bad = fails.length;
// The same in UTC, in a process of its own (a time zone is read when the process starts).
if (!process.env.DATES_CHECK_CHILD) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, TZ: 'UTC', DATES_CHECK_CHILD: '1' }, encoding: 'utf8' });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  if (r.status !== 0) bad++;
  // The monitor's mail rules on a computer in UTC (its rows in Swedish time whatever the zone; the Linux PC's is not known).
  const m = spawnSync(process.execPath, [fileURLToPath(new URL('./monitor-check.mjs', import.meta.url))], { env: { ...process.env, TZ: 'UTC' }, encoding: 'utf8' });
  console.log(`${m.status === 0 ? 'ok  ' : 'FAIL'} [UTC] the monitor's check${m.status === 0 ? '' : `:\n${m.stdout.split('\n').filter(l => l.startsWith('FAIL')).join('\n')}`}`);
  if (m.status !== 0) bad++;
  console.log(bad ? `dates-check FAILED (${bad})` : 'dates-check ok: every date pass holds, in Swedish time and in UTC');
}
process.exit(bad ? 1 : 0);
