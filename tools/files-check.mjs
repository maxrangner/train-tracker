// The public page's file reader (src/files-source.js) and its board answer, against a pretend site in memory: no
// network, about half a minute. Each case is a fault Codex's beta review (2026-11-18) found and batch 1 fixed:
//   - a file that answered 404 once is asked for again (point 5: stations were lost until the next day);
//   - a stalled supporting file never holds up the live files (point 5);
//   - home down: far fewer requests than 24 every 5 s (point 6); hidden: none at all (point 6);
//   - a live file in a newer format is not read (TODO 26);
//   - the fetcher's last report time reaches the page (point 7);
//   - a station board cuts after dropping trains that are gone (point 2);
//   - the text protector (src/html.js, point 1).
// Run: node tools/files-check.mjs     exit code 0: all hold; 1: one failed
import { startFilesSource, filesTapAsker } from '../src/files-source.js';
import { setTapAsker, fetchBoard, fetchStationDay } from '../src/trafikverket.js';
import { esc } from '../src/html.js';
import { FORMAT } from '../src/live-file.js';
import { encodeRows, groupOf } from '../src/tap-files.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (good, what) => { console.log(`${good ? 'ok  ' : 'FAIL'} ${what}`); if (!good) failed++; };

// A pretend site: live-<slot>.json exists from 0.6 s after its slot began, for a minute, unless liveOk() says no.
// other(name) -> the file's contents, null for 404, or 'stall' for an answer that never comes (until aborted).
function site({ liveOk = () => true, other = () => null, v = FORMAT, lastRecordAt = null } = {}) {
  const asked = [];
  globalThis.fetch = (url, opts = {}) => {
    const name = String(url).split('/').pop();
    asked.push({ name, at: Date.now() });
    const answer = val => Promise.resolve({ ok: val !== null, status: val === null ? 404 : 200, json: async () => val });
    const m = /^live-(\d+)\.json$/.exec(name);
    if (m) {
      const made = Number(m[1]) * 5000 + 50;
      if (!liveOk() || made + 600 > Date.now() || Date.now() - made > 60000) return answer(null);
      return answer({ v, t: made, kind: 'live', trains: [], passings: [], files: { stations: 'stations-1.json', planned: 'planned-1.json' },
        feeds: { positions: 'stream', passings: 'stream', lastRecordAt: lastRecordAt ?? made - 1000 } });
    }
    const val = other(name);
    if (val === 'stall') return new Promise((_, rej) => opts.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    return answer(val ?? null);
  };
  return asked;
}
const handlers = (extra = {}) => ({ onRecords() {}, onStatus() {}, onPassings() {}, onPlanned() {}, onStations() {}, onFile() {}, ...extra });

// 1. stations: 404 first, then there.
{
  let asks = 0, lists = 0;
  site({ other: n => (n === 'stations-1.json' ? (++asks === 1 ? null : { stations: [{ sig: 'Cst', name: 'Stockholm C' }] }) : n === 'planned-1.json' ? { rows: [], brands: {} } : null) });
  const realNow = Date.now;
  let shift = 0; Date.now = () => realNow() + shift;   // the retry wait (30 s) passes at once
  const stop = startFilesSource('http://site/', handlers({ onStations: () => lists++, onFile: () => { shift += 31000; } }));
  for (let i = 0; i < 40 && !lists; i++) await wait(250);
  stop(); Date.now = realNow;
  ok(lists === 1 && asks >= 2, `a stations file that answered 404 once is asked again and delivered (asked ${asks}, delivered ${lists})`);
}
// 2. a stalled planned file: live files go on.
{
  let files = 0;
  site({ other: n => (n.startsWith('planned') ? 'stall' : n === 'stations-1.json' ? { stations: [] } : null) });
  const stop = startFilesSource('http://site/', handlers({ onFile: () => files++ }));
  await wait(11500);
  stop();
  ok(files >= 2, `a stalled supporting file doesn't hold up live files (${files} live files in 11.5 s)`);
}
// 3. home down: requests per minute; 4. hidden: none.
{
  const asked = site({ liveOk: () => false });
  const stop = startFilesSource('http://site/', handlers());
  await wait(30000);
  const n = asked.length;
  stop.pause();
  const before = asked.length;
  await wait(6000);
  const hidden = asked.length - before;
  stop();
  ok(n <= 24 + 3 * 3, `home down: ${n} requests in 30 s (before the fix: 24 every 5 s, about 150)`);
  ok(hidden === 0, `hidden: ${hidden} requests in 6 s`);
}
// 5. a newer format: not read.
{
  let records = 0, mode = null;
  site({ v: FORMAT + 1 });
  const stop = startFilesSource('http://site/', handlers({ onRecords: () => records++, onFile: () => records++, onStatus: s => { mode = s.mode; } }));
  await wait(1500);
  stop();
  ok(mode === 'outdated' && records === 0, `a live file in format ${FORMAT + 1} is not read (status ${mode})`);
}
// 6. the fetcher's last report time reaches onFile.
{
  let got = null;
  const t0 = Date.now() - 90000;
  site({ lastRecordAt: t0 });
  const stop = startFilesSource('http://site/', handlers({ onFile: (t, rec) => { got = rec; } }));
  await wait(1500);
  stop();
  ok(got === t0, 'the fetcher\'s last report time is passed on with each file');
}
// 7. a busy station's board, made the way the fetcher makes it (src/tap-files.js encodeRows): 120 departures every
// 1.5 minutes from 80 minutes ago, those before now gone (left), the rest to come; boards of 4, 12 and 40 rows.
{
  const now = Date.parse('2026-11-18T13:00:00Z');
  const iso = ms => new Date(ms).toISOString();
  const rows = [];
  for (let i = 0; i < 120; i++) {
    const planned = now - 80 * 60000 + i * 90000;
    rows.push({ OperationalTrainNumber: String(1000 + i), AdvertisedTrainIdent: String(1000 + i), ScheduledDepartureDateTime: '2026-11-18T00:00:00.000+01:00',
      LocationSignature: 'Mc', ActivityType: 'Avgang', Advertised: true, Canceled: false, Deleted: false,
      AdvertisedTimeAtLocation: iso(planned), ...(planned < now ? { TimeAtLocation: iso(planned + 30000) } : {}) });
  }
  const toCome = rows.filter(a => !a.TimeAtLocation).length;
  const file = encodeRows(rows, { v: 1, t: now, kind: `board-${groupOf('Mc')}` });
  setTapAsker(filesTapAsker(async kind => (kind === `board-${groupOf('Mc')}` ? file : null), () => now));
  const got = [];
  for (const n of [4, 12, 40]) got.push((await fetchBoard('Mc', 'Avgang', now, n)).length);
  ok(got.join() === '4,12,40', `a board file with ${120 - toCome} trains gone and ${toCome} to come gives 4 / 12 / 40 rows (${got.join(' / ')})`);
  // The search on a board (2026-11-21): the station's day file gives the whole day, the gone ones marked; from a server
  // without day files, the board file (partial).
  const dayFile = encodeRows(rows, { v: 1, t: now, kind: `day-${groupOf('Mc')}` });
  setTapAsker(filesTapAsker(async kind => (kind === `day-${groupOf('Mc')}` ? dayFile : kind === `board-${groupOf('Mc')}` ? file : null), () => now));
  const day = await fetchStationDay('Mc', 'Avgang', now);
  const left = rows.filter(a => a.TimeAtLocation && Date.parse(a.TimeAtLocation) < now).length;   // (gone: left before now)
  ok(day.length === 120 && day.filter(r => r.gone).length === left && !day.partial, `a day file gives the whole day: ${day.length} trains, ${day.filter(r => r.gone).length} gone, not partial`);
  setTapAsker(filesTapAsker(async kind => (kind === `board-${groupOf('Mc')}` ? file : null), () => now));
  const old = await fetchStationDay('Mc', 'Avgang', now);
  ok(old.partial && old.length > 0, `no day file (an older server): the board file's trains, marked partial (${old.length})`);
}
// 8. the text protector.
ok(esc(`<b>"Sto'ck" & co</b>`) === '&lt;b&gt;&quot;Sto&#39;ck&quot; &amp; co&lt;/b&gt;', 'station names and ids are shown as typed (& < > " \')');

console.log(failed ? `files check FAILED (${failed})` : 'files check ok');
process.exit(failed ? 1 : 0);
