// Taps from files against Trafikverket (plan step 4, 2026-11-17): with a fetcher running here (node fetcher/main.mjs
// --env <settings> --serve 8093, no upload), each sampled train card, station board, number search and station's
// messages is answered twice by the page's own code (src/trafikverket.js): once from the fetcher's files
// (src/files-source.js filesTapAsker), once from Trafikverket with the key, right after. Differences are listed; a
// few changed times are expected (the files are up to ~30 s behind). About 90 questions to Trafikverket, 2 a second.
// Run: node tools/taps-check.mjs [--files http://localhost:8093/] [--trains 30] [--stations 20] [--numbers 10]
//      node tools/taps-check.mjs --format   offline, no fetcher: a saved day's timetable (data/measure/day-*.json) through
//      the files' format and back (tools/check.mjs runs it): every field the same, times to the second.
// Exit code 0: within the limits below; 1: not.
import { readFileSync } from 'node:fs';
import { setKey, setTapAsker, fetchRoute, fetchBoard, fetchTrainsByNumber, fetchStationMessages } from '../src/trafikverket.js';
import { filesTapAsker } from '../src/files-source.js';
import { swedishDay } from '../src/clock.js';
import { encodeRows, decodeRows, TAP_FIELDS, withChanges } from '../src/tap-files.js';
import { readdirSync } from 'node:fs';

if (process.argv.includes('--format')) {
  const file = readdirSync('data/measure').filter(n => /^day-.*.json$/.test(n)).sort().at(-1);
  if (!file) { console.log('taps-check --format: no saved day (data/measure/day-*.json): skipped'); process.exit(0); }
  const raw = JSON.parse(readFileSync(`data/measure/${file}`, 'utf8'));
  const back = decodeRows(encodeRows(raw));
  const norm = (k, v) => (/Time/.test(k) && v ? Math.round(Date.parse(v) / 1000) : v === undefined || v === null || v === false || v === '' ? null : JSON.stringify(v));
  let bad = 0;
  for (let i = 0; i < raw.length; i++) for (const k of TAP_FIELDS) if (k !== 'ModifiedTime' && norm(k, raw[i][k]) !== norm(k, back[i][k])) bad++;
  // A change over a row: the changed row replaces it, a new one is added.
  const a = raw.slice(0, 50), b = [{ ...a[3], EstimatedTimeAtLocation: '2030-01-01T00:00:00.000+01:00' }, { ...a[4], LocationSignature: 'Zz' }];
  const merged = withChanges(encodeRows(a), encodeRows(b));
  const ok = bad === 0 && merged.length === 51 && merged.some(x => x.EstimatedTimeAtLocation?.startsWith('2029-12-31T23:00'));
  console.log(`${ok ? 'taps-check --format ok' : 'taps-check --format FAILED'}: ${raw.length} rows of ${file}, ${bad} fields differ; a change replaces its row, a new row is added`);
  process.exit(ok ? 0 : 1);
}

const arg = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : process.argv[i + 1]; };
const BASE = arg('--files', 'http://localhost:8093/').replace(/\/?$/, '/');
const N = { trains: Number(arg('--trains', 30)), stations: Number(arg('--stations', 20)), numbers: Number(arg('--numbers', 10)) };
setKey(/^\s*VITE_TRV_KEY\s*=\s*['"]?([^'"\r\n]+)/m.exec(readFileSync('.env', 'utf8'))[1].trim());
const wait = ms => new Promise(r => setTimeout(r, ms));

// The newest files, as the page finds them: the live file names them.
let names = {};
async function refreshNames() {
  const st = await (await fetch(`${BASE}status`)).json();
  names = st.files ?? {};
}
const latest = async kind => (names[kind] ? (await fetch(BASE + names[kind])).json() : null);
const fromFiles = filesTapAsker(latest, Date.now);
async function both(fn) {
  setTapAsker(fromFiles);
  let a, b;
  try { a = await fn(); } catch (e) { a = { error: e.message }; }
  setTapAsker(null);
  await wait(500);
  try { b = await fn(); } catch (e) { b = { error: e.message }; }
  return [a, b];
}
const sec = t => (t == null ? t : Math.round(t / 1000));   // the files keep whole seconds
const stopText = s => `${s.station} ${s.activity} ${s.planned} est ${sec(s.estimated)} act ${sec(s.actual)} c${s.canceled ? 1 : 0} t${s.track} p${s.problems.join('/')} n${s.notes.join('/')}`;
const rowText = r => `${r.key} ${r.planned} est ${sec(r.estimated)} act ${sec(r.actual)} t${r.track} c${r.canceled ? 1 : 0} ${r.from}>${r.to}`;
function diff(as, bs) {   // lines in one and not the other
  const A = new Set(as), B = new Set(bs);
  return { onlyFiles: as.filter(x => !B.has(x)), onlyTrv: bs.filter(x => !A.has(x)) };
}

await refreshNames();
if (!names['taps-add'] || !names['card-00'] || !names.messages || !names['taps-index']) { console.log('taps-check: the fetcher has no tap files yet (the timetable loads for ~30 s, then a round every 30 s); try again'); process.exit(1); }
const live = await latest('live');
const day = swedishDay(Date.now());
const trains = live?.trains ?? [];
const checks = [];   // { kind, run: () => Promise of { same, line } }

// Train cards: trains on the map now (public number, internal number, day).
const picks = trains.filter((_, i) => i % Math.max(1, Math.floor(trains.length / N.trains)) === 0).slice(0, N.trains);
for (const row of picks) {
  const [id, number] = row;
  const [op, date] = String(id).split('/');
  if (!op || !date) continue;
  checks.push({ kind: 'cards', run: async () => {
    const [f, t] = await both(() => fetchRoute(op, date, number || null));
    const d = diff((f.stops ?? []).map(stopText), (t.stops ?? []).map(stopText));
    const same = !f.error && !t.error && f.from === t.from && f.to === t.to && f.pieces === t.pieces && !d.onlyFiles.length && !d.onlyTrv.length;
    return { same, line: `card ${number || op} ${date}: ${f.error ?? ''}${t.error ?? ''} ${f.stops?.length ?? '-'} vs ${t.stops?.length ?? '-'} stops; files only: ${d.onlyFiles.slice(0, 2).join(' | ')}; Trafikverket only: ${d.onlyTrv.slice(0, 2).join(' | ')}` };
  } });
}
// Boards: big stations.
const STATIONS = ['Cst', 'G', 'M', 'U', 'Lp', 'Hb', 'Nk', 'Sod', 'Gä', 'Kac', 'Söc', 'Fln', 'Hd', 'Vå', 'Ör', 'Lu', 'Sk', 'Bs', 'Mö', 'Fby'].slice(0, N.stations);
for (const sig of STATIONS) for (const act of ['Avgang', 'Ankomst']) checks.push({ kind: 'boards', run: async () => {
  const at = Date.now();
  const [f, t] = await both(() => fetchBoard(sig, act, at, 10));
  const d = diff((Array.isArray(f) ? f : []).map(rowText), (Array.isArray(t) ? t : []).map(rowText));
  const same = Array.isArray(f) && Array.isArray(t) && !d.onlyFiles.length && !d.onlyTrv.length;
  return { same, line: `board ${sig} ${act}: ${f.error ?? ''}${t.error ?? ''} ${f.length ?? '-'} vs ${t.length ?? '-'} rows; files only: ${d.onlyFiles.slice(0, 2).join(' | ')}; Trafikverket only: ${d.onlyTrv.slice(0, 2).join(' | ')}` };
} });
// The number search.
for (const number of [...new Set(trains.map(r => r[1]).filter(Boolean))].slice(0, N.numbers)) checks.push({ kind: 'numbers', run: async () => {
  const [f, t] = await both(() => fetchTrainsByNumber(number, day));
  const k = x => (Array.isArray(x) ? x.map(r => `${r.key} ${r.from}>${r.to} ${r.keys.join(',')}`).sort() : [x.error]);
  return { same: JSON.stringify(k(f)) === JSON.stringify(k(t)), line: `number ${number}: files ${JSON.stringify(k(f))} / Trafikverket ${JSON.stringify(k(t))}` };
} });
// Station messages.
for (const sig of STATIONS.slice(0, 10)) checks.push({ kind: 'messages', run: async () => {
  const at = Date.now();
  const [f, t] = await both(() => fetchStationMessages(sig, at));
  const k = x => (Array.isArray(x) ? x.map(m => m.text).sort() : [x.error]);
  return { same: JSON.stringify(k(f)) === JSON.stringify(k(t)), line: `messages ${sig}: files ${k(f).length} / Trafikverket ${k(t).length}` };
} });

// Each once; what differed is asked again 40 s later (the files may have been a change behind): only what still
// differs then counts.
const results = { cards: [0, 0, 0], boards: [0, 0, 0], numbers: [0, 0, 0], messages: [0, 0, 0] };   // same, same later, differs
const again = [];
for (const c of checks) { const r = await c.run(); if (r.same) results[c.kind][0]++; else again.push(c); }
if (again.length) { await wait(40000); await refreshNames(); }
const report = [];
for (const c of again) { const r = await c.run(); if (r.same) results[c.kind][1]++; else { results[c.kind][2]++; report.push(r.line); } }

for (const line of report) console.log('diff', line);
const pct = ([same, later, other]) => `${same + later} of ${same + later + other} the same${later ? ` (${later} after 40 s)` : ''}`;
console.log(`taps-check: cards ${pct(results.cards)}, boards ${pct(results.boards)}, number search ${pct(results.numbers)}, messages ${pct(results.messages)}`);
const share = ([same, later, other]) => (same + later + other ? (same + later) / (same + later + other) : 1);
process.exit(share(results.cards) >= 0.9 && share(results.boards) >= 0.85 && share(results.numbers) >= 0.9 && share(results.messages) >= 0.9 ? 0 : 1);
