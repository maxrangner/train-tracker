// The sun's line (src/sun.js) against published times (looked up 2026-11-22, weather2travel.com's Stockholm November
// 2026 table: 1 Nov 07:07 / 15:55, 15 Nov 07:41 / 15:22, 30 Nov 08:15 / 14:57; Kiruna: midnight sun all June 2026,
// polar night in mid-December). Sunrise and sunset found here by halving, within 3 minutes of the table. Offline, ms.
// Run: node tools/sun-check.mjs
import { sunAt, altitude, HORIZON, nightness, shade, BOX } from '../src/sun.js';
import { midnightOf, hhmm } from '../src/clock.js';

let failed = 0;
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };
const STOCKHOLM = [59.3293, 18.0686], KIRUNA = [67.8558, 20.2253];
const alt = ([lat, lon], t) => altitude(lat, lon, sunAt(t));

// The moment between a and b where the sun crosses the horizon (it must cross once).
function cross(place, a, b) {
  const up = alt(place, a) > HORIZON;
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if ((alt(place, m) > HORIZON) === up) a = m; else b = m; }
  return (a + b) / 2;
}
const H = 3600000;
for (const [day, rise, set] of [['2026-11-01', '07:07', '15:55'], ['2026-11-15', '07:41', '15:22'], ['2026-11-30', '08:15', '14:57']]) {
  const m = midnightOf(day), r = cross(STOCKHOLM, m + 3 * H, m + 11 * H), s = cross(STOCKHOLM, m + 12 * H, m + 20 * H);
  const off = (t, want) => { const [h, mi] = want.split(':').map(Number); return Math.abs((t - m) / 60000 - (h * 60 + mi)); };
  ok(off(r, rise) <= 3 && off(s, set) <= 3, `Stockholm ${day}: sunrise ${hhmm(r)} (table ${rise}), sunset ${hhmm(s)} (table ${set})`);
}
// Kiruna: the sun up all through 15 June, down all through 20 December.
const allDay = (day, test) => { const m = midnightOf(day); for (let k = 0; k < 24 * 12; k++) if (!test(alt(KIRUNA, m + k * 300000))) return false; return true; };
ok(allDay('2026-06-15', a => a > HORIZON), 'Kiruna 15 June 2026: the sun never sets');
ok(allDay('2026-12-20', a => a < HORIZON), 'Kiruna 20 December 2026: the sun never rises');
// The shade: none at noon in Malmö in June, full over all of Sweden at midnight in December, dusk between.
ok(nightness(5) === 0 && nightness(-20) === 1 && nightness(-6) > 0 && nightness(-6) < 1, 'the shade: 0 by day, 1 in full night, between at dusk');
const noonJune = shade(Date.parse('2026-06-15T11:00:00Z')), midnightDec = shade(Date.parse('2026-12-15T23:00:00Z'));
ok(noonJune.every(a => a === 0), 'the picture at noon in June: no shade anywhere in Sweden\'s box');
ok(midnightDec.every(a => a === 255), 'the picture at midnight in December: full shade everywhere');
// Late afternoon in November: the north and east darker than the south-west (the line runs across Sweden).
const nov = shade(Date.parse('2026-11-22T14:45:00Z'), 72, 128), at = (lat, lon) => {
  const y = r => Math.log(Math.tan(Math.PI / 4 + r * Math.PI / 360));
  const row = Math.floor((y(BOX.north) - y(lat)) / (y(BOX.north) - y(BOX.south)) * 128), col = Math.floor((lon - BOX.west) / (BOX.east - BOX.west) * 72);
  return nov[row * 72 + col];
};
ok(at(67.86, 20.23) > at(55.6, 13.0), `22 Nov 15:45 Swedish time: Kiruna darker (${at(67.86, 20.23)}) than Malmö (${at(55.6, 13.0)})`);
// Fast enough to remake every second in The day's fast play: time the picture.
const t0 = performance.now(); for (let i = 0; i < 50; i++) shade(Date.now() + i * 60000); const ms = (performance.now() - t0) / 50;
ok(ms < 8, `one picture in ${ms.toFixed(2)} ms (here; a phone is slower)`);
console.log(failed ? `${failed} failed` : 'sun-check: all good');
process.exit(failed ? 1 : 0);
