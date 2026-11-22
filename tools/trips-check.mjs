// My trains (src/trips.js) on the saved timetable day of 17 Nov 2026 (data/measure/day-2026-11-17.json, as Trafikverket
// answered at 15:15 that day): direct trains Lund C → Malmö C and Södertälje Syd → Stockholm C, a change at Stockholm C
// (Uppsala C → Malmö C), the next train and the one after, and changes worked out on made-up rows. Offline, seconds.
// Run: node tools/trips-check.mjs
import { readFileSync } from 'node:fs';
import { direct, ahead, nextTwo, withChange, change, lineOf, MIN_CHANGE_MIN } from '../src/trips.js';
import { trainKey } from '../src/trafikverket.js';
import { swedishDay, hhmm } from '../src/clock.js';

let failed = 0;
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };
const raw = JSON.parse(readFileSync(new URL('../data/measure/day-2026-11-17.json', import.meta.url), 'utf8'));
const DAY = '2026-11-17';
// A station's whole day in one direction, as fetchStationDay hands it over.
const dayOf = (sig, act) => raw.filter(a => a.LocationSignature === sig && a.ActivityType === act && a.Advertised && !a.Deleted
  && a.ScheduledDepartureDateTime && swedishDay(Date.parse(a.AdvertisedTimeAtLocation)) === DAY).map(a => ({
  key: trainKey(a.OperationalTrainNumber, a.ScheduledDepartureDateTime), operational: a.OperationalTrainNumber, date: a.ScheduledDepartureDateTime.slice(0, 10),
  number: a.AdvertisedTrainIdent, planned: Date.parse(a.AdvertisedTimeAtLocation),
  estimated: a.EstimatedTimeAtLocation ? Date.parse(a.EstimatedTimeAtLocation) : null, actual: a.TimeAtLocation ? Date.parse(a.TimeAtLocation) : null,
  track: a.TrackAtLocation ?? '', canceled: a.Canceled === true, product: a.ProductInformation?.[0]?.Description ?? null,
  to: a.ToLocation?.[0]?.LocationName ?? null })).sort((x, y) => x.planned - y.planned);
const NOW = Date.parse('2026-11-17T15:00:00+01:00');

const luMc = direct(dayOf('Lu', 'Avgang'), dayOf('Mc', 'Ankomst'));
ok(luMc.length > 100, `Lund C → Malmö C: ${luMc.length} direct trains today`);
// (531's departure row at Lund C is missing from this saved day, only its arrival is there: it is checked whole.)
ok(direct(dayOf('Cst', 'Avgang'), dayOf('Mc', 'Ankomst')).some(x => x.number === '531'), 'train 531 is a direct train Stockholm C → Malmö C');
ok(luMc.every((x, i) => x.arr.planned > x.dep.planned && (!i || luMc[i - 1].dep.planned <= x.dep.planned)), 'each arrives after it leaves; sorted by departure');
const still = ahead(luMc, NOW);
ok(still.every(x => !x.dep.actual) && still.length < luMc.length, `at 15:00: ${still.length} still to take, none already left`);
const { next, after } = nextTwo(luMc, NOW);
ok(next && after && next.dep.planned <= after.dep.planned && !next.canceled && !after.canceled,
  `next ${next?.number} at ${next && hhmm(next.dep.planned)} track ${next?.dep.track}, then ${after?.number} at ${after && hhmm(after.dep.planned)}`);
const line = lineOf(luMc, NOW);
ok(line && line.number === next.number && line.track === (next.dep.track || null), `the line above the bar: ${line?.number} ${line && hhmm(line.dep.planned)} track ${line?.track} +${line?.late}`);

const sööCst = direct(dayOf('Söö', 'Avgang'), dayOf('Cst', 'Ankomst'));
ok(sööCst.length > 50, `Södertälje Syd → Stockholm C: ${sööCst.length} direct trains`);

// Uppsala C → Malmö C changing at Stockholm C.
const pairs = withChange(dayOf('U', 'Avgang'), dayOf('Cst', 'Ankomst'), dayOf('Cst', 'Avgang'), dayOf('Mc', 'Ankomst'));
const paired = pairs.filter(p => p.second);
ok(paired.length > 10, `Uppsala C → Malmö C via Stockholm C: ${paired.length} of ${pairs.length} first trains have a second`);
ok(paired.every(p => p.second.dep.planned >= p.first.arr.planned + MIN_CHANGE_MIN * 60000), `every planned change is at least ${MIN_CHANGE_MIN} minutes`);
const ex = paired.find(p => p.first.dep.planned > NOW) ?? paired[0];
console.log(`     e.g. ${ex.first.number} ${hhmm(ex.first.dep.planned)} → Cst ${hhmm(ex.first.arr.planned)} (track ${ex.change.tracks[0]}), then ${ex.second.number} ${hhmm(ex.second.dep.planned)} (track ${ex.change.tracks[1]}): ${ex.change.minutes} min`);

// Changes on made-up rows.
const T = Date.parse('2026-11-17T10:00:00+01:00'), m = 60000;
const arr = (planned, estimated = null, extra = {}) => ({ planned, estimated, actual: null, track: '3', canceled: false, ...extra });
ok(change(arr(T, T + 5 * m), arr(T + 6 * m)).tight && !change(arr(T, T + 5 * m), arr(T + 6 * m)).lost, 'arrives 5 min late, leaves 6 min after plan: 1 minute, tight');
ok(change(arr(T, T + 8 * m), arr(T + 6 * m)).lost, 'arrives 8 min late, the second leaves at 6: lost');
ok(change(arr(T), arr(T + 10 * m, null, { canceled: true })).lost, 'the second train cancelled: lost');
ok(change(arr(T), arr(T + 10 * m)).minutes === 10 && !change(arr(T), arr(T + 10 * m)).tight, 'on time with 10 minutes: fine');
console.log(failed ? `${failed} failed` : 'trips-check: all good');
process.exit(failed ? 1 : 0);
