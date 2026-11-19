// The check to run before merging a change: replays the chosen recordings (tools/recordings.json) through the
// page's train code (tools/motion-check.mjs) and fails when a rule breaks or the movement gets worse than these limits.
// Then the screens are checked (tools/ui-check.mjs), when the page is running (npm run dev).
// Run: node tools/check.mjs [--full] [--library | --all] [--rebaseline]   exit code 0: all good; 1: something failed
//   --library  the library recordings too;  --all  every recording in data/, listed or not
//   --rebaseline  replay and accept the numbers as they are now (tools/baseline.json)
// The replay takes minutes, so it is skipped when nothing it depends on has changed since it last passed: the
// movement code, this file's limits, the rail network and the recordings (see REPLAY_INPUTS). --full replays anyway.
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { RUSH_HOUR } from './lib/browser.mjs';

// A port nobody uses now (two sessions' checks at once each get their own; it was always 8095 until 2026-11-19).
const freePort = () => new Promise((res, rej) => { const s = createServer().once('error', rej).listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
// The file formats (TODO 37, 2026-11-19): a fetcher replaying the rush hour into its files on this computer, started
// first because some kinds are made only minutes in (arrivals-add after ~5); checked near the end (format-check
// --strict --wait: every kind made, readable, nothing removed or changed). With the key from .env it also asks
// stations, disruptions, stats and arrivals; without it those kinds can't be made, so only types are checked.
const HAS_KEY = existsSync('.env') && /^\s*(VITE_)?TRV_KEY\s*=\s*\S/m.test(readFileSync('.env', 'utf8'));
const formatPort = await freePort();
const formatFetcher = spawn('node', ['fetcher/main.mjs', '--env', '.env', '--replay', RUSH_HOUR, '--serve', String(formatPort), '--minutes', '60'], { stdio: 'ignore' });

// Rules (must be 0) and limits, from the numbers measured 2026-11-11/12, with some room.
const CHECKS = [
  ['pastStop', v => v === 0, 'a coasting train passed an unconfirmed planned stop (must be 0)'],
  ['movedAfterStanding', v => v === 0, 'a train moved on after standing still with its GPS quiet (must be 0)'],
  ['frozenPct', v => v <= 1.5, 'moving trains drawn standing more than 1.5 % of the time'],
  ['lag90S', v => v <= 10, '90 % of moments further than 10 s of travel from the truth'],
  // Real stops (an actual arrival and departure) the drawn train passed without standing 5 s: 19-21 % before the
  // dwell rule, 16-18 % after (2026-11-12).
  ['dwellThroughPct', v => v === null || v <= 22, 'over 22 % of real stops drawn driving through'],
  ['offTrack99M', v => v === null || v <= 1, '99 % of drawn trains further than 1 m from a track'],
  // U-turns drawn beyond the data's own (2026-11-12, after ignoring re-sent old positions: 216, 215 and 181 in the
  // hour-long rush recordings, from 220, 222 and 184): must not grow again.
  // Drawn moving against the real train, both moving, 3 s or more (2026-11-12: 1, 5 and 1 in the rush recordings).
  ['wrongWay', v => v <= 10, 'more than 10 times drawn against the real train'],
  ['extraTurnBacks', v => v <= 250, 'more than 250 U-turns drawn beyond the data’s own'],
];
// A recording with accepted numbers in tools/baseline.json is held to its own numbers instead (the limits above
// are for hour-long weekday recordings; counts grow with length and traffic): it fails when one gets worse by more
// than its margin. The must-be-0 rules and the track limit stay as above. node tools/check.mjs --rebaseline replays
// and writes the numbers as they are now (only when a change is accepted; say why in docs/movement.md).
const BASELINE = 'tools/baseline.json';
const MARGINS = {
  frozenPct: [b => b + 0.2, 'moving trains drawn standing'],
  lag90S: [b => b + 1, '90 % of moments within (s of travel)'],
  dwellThroughPct: [b => b + 2, 'real stops drawn driving through (%)'],
  wrongWay: [b => b + 2, 'drawn against the real train'],
  // Drawn onto another track before the next report (tools/lib/branch.mjs; since 2026-11-14).
  wrongBranch: [b => b + Math.max(3, Math.round(0.2 * b)), 'drawn onto a wrong branch'],
  extraTurnBacks: [b => b + Math.max(5, Math.round(0.1 * b)), 'U-turns drawn beyond the data’s own'],
  // Trains seen only at fixed places, drawn standing at real stops: median metres from where trains really stand
  // (public/stop-places.json; since 2026-11-14, point 5 B: 186 -> 23 m in the morning rush).
  standNoGpsMedM: [b => b + Math.max(10, Math.round(0.3 * b)), 'trains without GPS standing at stops, median m from the stopping place'],
};
const ALWAYS = new Set(['pastStop', 'movedAfterStanding', 'offTrack99M']);
const REBASE = process.argv.includes('--rebaseline');
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { about: '', recordings: {} };

// Which recordings: tools/recordings.json says each kept recording's role. The core is replayed every time;
// --library adds the library; --all replays every recording in data/ (over 1 MB, so a minute's test is left out).
// A recording in data/ that isn't in the list is unsorted: named here, not replayed.
const LIST = JSON.parse(readFileSync('tools/recordings.json', 'utf8'));
const MODE = process.argv.includes('--all') ? 'all' : process.argv.includes('--library') ? 'library' : 'core';
const inData = readdirSync('data').filter(f => f.startsWith('positions-') && f.endsWith('.jsonl'));
const listed = new Set(LIST.recordings.map(x => `positions-${x.name}.jsonl`));
let missingCore = 0;
const sums = new Map();   // file -> its SHA-256 now (also what the "nothing changed" stamp below is made of)
for (const x of LIST.recordings) for (const kind of ['positions', 'timetable']) {
  const want = x[kind], f = `data/${kind}-${x.name}.jsonl`;
  if (!want) continue;
  if (!existsSync(f)) {
    console.log(`${x.role === 'core' ? 'FAIL' : 'note'} ${f} is listed (${x.role}) but missing`);
    if (x.role === 'core') missingCore++;
  } else {
    const sum = createHash('sha256').update(readFileSync(f)).digest('hex');
    sums.set(f, sum);
    if (statSync(f).size === want.bytes && sum === want.sha256) continue;
    // A core recording that isn't the chosen one fails the check (it was only a note): its numbers mean nothing then.
    console.log(`${x.role === 'core' ? 'FAIL' : 'note'} ${f} differs from tools/recordings.json (size or SHA-256): not the recording that was chosen`);
    if (x.role === 'core') missingCore++;
  }
}
const unsorted = inData.filter(f => !listed.has(f) && statSync(`data/${f}`).size > 1e6);
if (unsorted.length) console.log(`note unsorted, not replayed (add to tools/recordings.json to use): ${unsorted.join(', ')}`);
const recordings = (MODE === 'all' ? inData.filter(f => statSync(`data/${f}`).size > 1e6)
  : LIST.recordings.filter(x => x.role === 'core' || (MODE === 'library' && x.role === 'library')).map(x => `positions-${x.name}.jsonl`))
  .filter(f => existsSync(`data/${f}`)).sort();
// What the replay's result depends on: these files' contents, and the replayed recordings' names and contents
// (their SHA-256; names and sizes before, so a changed recording of the same size passed as unchanged).
const REPLAY_INPUTS = ['src/trains.js', 'src/rail-net.js', 'src/routes.js', 'src/path.js', 'src/clock.js',
  'tools/motion-check.mjs', 'tools/lib/records.mjs', 'tools/lib/branch.mjs', 'tools/path-check.mjs', 'src/report-time.js',
  'src/path-follow.js', 'tools/route-follow-check.mjs', 'tools/check.mjs', 'tools/recordings.json', 'tools/baseline.json', 'public/rail-net.json', 'data/stations.json'];
const PASSED = 'data/.check-passed.json';
const stamp = createHash('sha256')
  .update(MODE)
  .update(REPLAY_INPUTS.map(p => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'none')).join())
  .update(recordings.flatMap(f => [f, f.replace('positions-', 'timetable-')]).filter(f => existsSync(`data/${f}`))
    .map(f => `${f}:${sums.get(`data/${f}`) ?? createHash('sha256').update(readFileSync(`data/${f}`)).digest('hex')}`).join())
  .digest('hex');
// One stamp per set (core, library, all), so a --library run doesn't make the next everyday run replay again.
const passedAll = existsSync(PASSED) ? JSON.parse(readFileSync(PASSED, 'utf8')) : {};
const last = passedAll[MODE] ?? null;
const skipReplay = !process.argv.includes('--full') && !REBASE && last?.stamp === stamp;
if (skipReplay) console.log(`replay skipped: the movement code, limits, rail network and ${MODE} recordings are as when all ${last.recordings} passed (${last.when}); --full replays anyway`);
else console.log(`replaying the ${MODE} recordings (${recordings.length}): ${recordings.map(f => f.slice(10, 29)).join(', ')}`);
const replayStart = Date.now();

let failed = 0;
// No secret in any file git tracks (plan to beta phase B, 2026-11-17): every time, it takes a second. A search
// that can't run (no settings file with a secret on this computer) fails too.
{
  const s = spawnSync('node', ['tools/key-search.mjs', '--git'], { encoding: 'utf8' });
  console.log(`${s.status === 0 ? 'ok  ' : 'FAIL'} ${(s.stdout || s.stderr || '').trim()}`);
  if (s.status !== 0) failed++;
}
// The fetcher writes only in Spårat's own folder on one.com (tools/upload-check.mjs: a pretend connection, no network;
// plan to beta step 1, 2026-11-17).
{
  const u = spawnSync('node', ['tools/upload-check.mjs'], { encoding: 'utf8' });
  console.log(`${u.status === 0 ? 'ok  ' : 'FAIL'} ${(u.stdout || '').trim().split('\n').at(-1)}`);
  if (u.status !== 0) { console.log((u.stdout || '').split('\n').filter(l => l.startsWith('FAIL')).join('\n')); failed++; }
}
// Taps from files (plan step 4, 2026-11-17): a saved day's timetable through the files' format and back, offline.
{
  const u = spawnSync('node', ['tools/taps-check.mjs', '--format'], { encoding: 'utf8' });
  console.log(`${u.status === 0 ? 'ok  ' : 'FAIL'} ${(u.stdout || u.stderr || '').trim().split('\n').at(-1)}`);
  if (u.status !== 0) failed++;
}
// Known problems in the libraries the Linux PC runs (npm's own list, asked online; Codex's review, 2026-11-17): high
// or critical there fails the check; in the page's other libraries it is a note; npm not answering is a note.
{
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages, linux = new Set(), todo = ['ssh2', 'nodemailer'];
  while (todo.length) { const n = todo.pop(); if (linux.has(n)) continue; linux.add(n); const e = lock[`node_modules/${n}`] ?? {}; todo.push(...Object.keys(e.dependencies ?? {}), ...Object.keys(e.optionalDependencies ?? {})); }
  const a = spawnSync('npm audit --omit=dev --json', { encoding: 'utf8', shell: true, timeout: 60000 });
  let v = null;
  try { v = JSON.parse(a.stdout).vulnerabilities; } catch { /* no answer */ }
  if (!v) console.log('note the libraries\' known problems could not be asked (npm audit gave no answer)');
  else {
    const bad = Object.values(v).filter(x => ['high', 'critical'].includes(x.severity));
    const there = bad.filter(x => linux.has(x.name)), other = bad.filter(x => !linux.has(x.name));
    console.log(`${there.length ? 'FAIL' : 'ok  '} libraries on the Linux PC (${linux.size}): ${there.length ? there.map(x => `${x.name} (${x.severity})`).join(', ') : 'no known high or critical problems'}`);
    if (other.length) console.log(`note the page's libraries: ${other.map(x => `${x.name} (${x.severity})`).join(', ')}`);
    if (there.length) failed++;
  }
}
for (const f of skipReplay ? [] : recordings) {
  let r;
  try {
    r = JSON.parse(execFileSync('node', ['tools/motion-check.mjs', `data/${f}`, '--json'], { encoding: 'utf8', maxBuffer: 1e8 }).trim().split('\n').at(-1));
  } catch (e) {
    console.log(`FAIL ${f}: the replay itself failed: ${e.message.split('\n')[0]}`);
    failed++;
    continue;
  }
  r.extraTurnBacks = r.turnBacks - r.truthTurnBacks;
  const name = f.slice('positions-'.length, -'.jsonl'.length), b = base.recordings[name];
  // Own baseline: the must-be-0 rules and the track limit, then each number against its own accepted value.
  const bad = b
    ? [...CHECKS.filter(([k, ok]) => ALWAYS.has(k) && !ok(r[k])),
       ...Object.entries(MARGINS).filter(([k, [lim]]) => r[k] !== null && b[k] !== null && b[k] !== undefined && r[k] > lim(b[k]))
         .map(([k, [lim, what]]) => [k, null, `${what}: ${r[k]}, accepted ${b[k]} (limit ${Number(lim(b[k]).toFixed(2))})`])]
    : CHECKS.filter(([k, ok]) => !ok(r[k]));
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${f} (${r.minutes} min${r.routes ? `, ${r.routes} routes` : ''}${b ? ', own baseline' : ''}): ` +
    `frozen ${r.frozenPct} %, ${r.stopsPerMin} stops/min, 90 % within ${r.lag90S} s, through stops ${r.dwellThroughPct} %, track 99 % ${r.offTrack99M} m, ` +
    `grey ${r.greyPct} %, turn-backs ${r.turnBacks} (data ${r.truthTurnBacks}), wrong way ${r.wrongWay}, past stop ${r.pastStop}, moved after standing ${r.movedAfterStanding}`);
  for (const [k, , why] of bad) console.log(`     ${why}${b ? '' : `: ${k} = ${r[k]}`}`);
  if (REBASE) {
    const zeroOk = CHECKS.filter(([k, ok]) => ALWAYS.has(k) && !ok(r[k])).length === 0;
    if (!zeroOk) console.log(`     not rebaselined: a must-be-0 rule or the track limit fails`);
    else {
      const now = Object.fromEntries(Object.keys(MARGINS).map(k => [k, r[k]]));
      if (b) console.log(`     baseline: ${Object.keys(MARGINS).filter(k => b[k] !== now[k]).map(k => `${k} ${b[k]} -> ${now[k]}`).join(', ') || 'unchanged'}`);
      else console.log('     baseline: first numbers');
      base.recordings[name] = { ...now, when: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }) };
      continue;   // rebaselining accepts the numbers as they are
    }
  }
  failed += bad.length ? 1 : 0;
}
if (REBASE && !skipReplay) {
  base.about = 'Accepted replay numbers per recording (tools/check.mjs holds each recording to its own, with a margin). Written by node tools/check.mjs --rebaseline when a change is accepted; why goes in docs/movement.md.';
  writeFileSync(BASELINE, JSON.stringify(base, null, 2) + '\n');
  console.log(`baseline written: ${BASELINE}`);
}
failed += missingCore;
// Routes drawn straight across (no way along the rails) must be 0 in these recordings' timetables
// (tools/path-check.mjs; 0 of 73,368 pieces in eight recordings since 2026-11-14, 181 before). Its inputs (the path
// code, the network) are replay inputs, so it runs when the replay does.
for (const f of skipReplay ? [] : recordings) {
  const tt = `data/${f.replace('positions-', 'timetable-')}`;
  if (!existsSync(tt)) continue;
  try {
    const p = JSON.parse(execFileSync('node', ['tools/path-check.mjs', tt, '--json'], { encoding: 'utf8', maxBuffer: 1e8 }).trim().split('\n').at(-1));
    console.log(`${p.straight ? 'FAIL' : 'ok  '} routes ${f.slice(10, 29)}: ${p.straight} of ${p.pieces} pieces drawn straight (must be 0)`);
    if (p.straight) failed++;
  } catch (e) { console.log(`FAIL routes ${f}: ${e.message.split('\n')[0]}`); failed++; }
}
// The open train's line follows the train (src/path-follow.js; Max, 2026-11-19: "avoid a line flipping back and
// forth"): in the first FOLLOW_MIN minutes of each recording every train is opened; the drawn train is on its line at
// least FOLLOW_ON % of the time, and the line goes back to a way it just left at most FOLLOW_FLIPS times a train-hour
// (2026-11-20: 98.8 % and 0.48 in the morning rush; 99.9 % and 1.0 on 19 Nov 23:28). Its inputs are replay inputs.
const FOLLOW_MIN = 10, FOLLOW_ON = 98, FOLLOW_FLIPS = 1.5;
for (const f of skipReplay ? [] : recordings) {
  try {
    const p = JSON.parse(execFileSync('node', ['tools/route-follow-check.mjs', `data/${f}`, '--minutes', String(FOLLOW_MIN), '--json'],
      { encoding: 'utf8', maxBuffer: 1e8 }).trim().split('
').at(-1));
    const bad = p.onLine < FOLLOW_ON || p.flipsPerTrainHour > FOLLOW_FLIPS;
    console.log(`${bad ? 'FAIL' : 'ok  '} line follows ${f.slice(10, 29)}: on its line ${p.onLine} % (min ${FOLLOW_ON}; the timetable's route alone ${p.onBase} %), flips back ${p.flipsPerTrainHour} a train-hour (max ${FOLLOW_FLIPS}), slowest update ${p.updateMsMax} ms`);
    if (bad) failed++;
  } catch (e) { console.log(`FAIL line follows ${f}: ${e.message.split('
')[0]}`); failed++; }
}
if (!skipReplay) {
  console.log((failed ? `${failed} of ${recordings.length} recordings failed` : `all ${recordings.length} ${MODE} recordings pass`) +
    ` (replay ${Math.round((Date.now() - replayStart) / 1000)} s)`);
  if (!failed && !REBASE) writeFileSync(PASSED, JSON.stringify({ ...(passedAll.stamp ? {} : passedAll),
    [MODE]: { stamp, recordings: recordings.length, when: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' } }));
}

// Max's screenshots of 19 Nov 23:26 (trains beside their painted route): 2576 and 2277 stay on their line in the
// recording made just after (on main before: 2576 17 m beside it). Seconds, so always run (when the recording is here).
const FOLLOW_CASE = 'data/positions-2026-11-19T22-28-02-750Z.jsonl';
if (existsSync(FOLLOW_CASE)) {
  const r = spawnSync('node', ['tools/route-follow-check.mjs', FOLLOW_CASE, '--train', '2576,2277', '--min-on', '99.9', '--max-flips', '0'], { encoding: 'utf8' });
  const line = (r.stdout ?? '').split('
').find(l => l.includes('on its line')) ?? '';
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} case 2576/2277 on their line (19 Nov 23:28):${line.split(':').slice(1).join(':')}`);
  if (r.status !== 0) { console.log(r.stdout); failed++; }
} else console.log(`note case 2576/2277 skipped: ${FOLLOW_CASE} is not here`);

// The cases (tools/recordings.json): seconds, so always run. A case marked knownFailing shows but doesn't fail.
const cases = spawnSync('node', ['tools/cases.mjs'], { stdio: 'inherit' });
if (cases.status !== 0) failed++;

// Trips split over several internal numbers (src/trip.js), on saved rows: seconds, offline.
const split = spawnSync('node', ['tools/split-check.mjs'], { stdio: 'inherit' });
if (split.status !== 0) failed++;

// The way-finding on a tiny made-up network (src/rail-net.js; the review's F14, 2026-11-17): a second, offline.
const netCheck = spawnSync('node', ['tools/net-check.mjs'], { stdio: 'inherit' });
if (netCheck.status !== 0) failed++;

// The public page's file reader and its boards against a pretend site (Codex's beta review, batch 1, 2026-11-18):
// files asked again after a 404, nothing held up by a stalled file, few requests with home down, none hidden, an
// unknown format not read, the board cut after the gone trains, the text protector. About 50 s, offline.
const filesCheck = spawnSync('node', ['tools/files-check.mjs'], { stdio: 'inherit' });
if (filesCheck.status !== 0) failed++;

// The boards end to end: a saved day through the fetcher's own board files and the page's reader (batch 2,
// 2026-11-19): every board full at 4, 12 and 40 rows, read 25 minutes after its file. About 70 s, offline.
const boardCheck = spawnSync('node', ['tools/board-check.mjs'], { stdio: 'inherit' });
if (boardCheck.status !== 0) failed++;

// The timetable stream through a 20-minute Trafikverket outage on a fast clock (batch 2, 2026-11-19): it asks less
// and less often while every question fails, and loads today again when answers come back. About 15 s, offline.
const outageCheck = spawnSync('node', ['tools/outage-check.mjs'], { stdio: 'inherit' });
if (outageCheck.status !== 0) failed++;

// The Linux PC's sparat command on a pretend Linux (batch 2, 2026-11-19): update, a damaged package or a wrong
// fingerprint refused with nothing touched, a version that won't start rolled back, back and forth, status. ~20 s.
const updateCheck = spawnSync('node', ['tools/linux-update-check.mjs'], { stdio: 'inherit' });
if (updateCheck.status !== 0) failed++;

// The screens (exit code 2 from it: the page isn't running, which is said and doesn't fail the check, for quick runs;
// in a release, SPARAT_RELEASE from tools/release.mjs, it fails: a release never goes out unchecked on screen).
const ui = spawnSync('node', ['tools/ui-check.mjs'], { stdio: 'inherit' });
if (ui.status === 2 && process.env.SPARAT_RELEASE) { console.log('FAIL the screens were not checked (no dev page answering): a release needs them; start npm run dev'); failed++; }
// The same screens on the page reading the fetcher's files (public-plan step 3): a fetcher replays the rush hour into
// its files on this computer (a free port; with the key from .env, stations and disruptions are asked as well).
let filesUi = { status: 0 };
if (ui.status !== 2) {
  const port = await freePort();
  const fetcher = spawn('node', ['fetcher/main.mjs', '--env', '.env', '--replay', RUSH_HOUR, '--serve', String(port), '--minutes', '8'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 75000));   // a minute in, as the page's own replay starts (the first batch taken in)
  filesUi = spawnSync('node', ['tools/ui-check.mjs', '--files', `http://localhost:${port}/`], { stdio: 'inherit' });
  fetcher.kill();
}
// The files this code makes stay readable by released pages and apps (HARD RULE, 2026-11-18): their types and every
// kind (tools/format-check.mjs, on the fetcher started first) and their meaning to the released readers
// (tools/format-read-check.mjs, made-up rows, offline).
{
  const fmt = spawnSync('node', ['tools/format-check.mjs', '--files', `http://localhost:${formatPort}/`, '--wait', '420', ...(HAS_KEY ? ['--strict'] : [])], { encoding: 'utf8' });
  console.log((fmt.stdout || '').trim());
  if (fmt.status === 1) failed++;
  formatFetcher.kill();
  const read = spawnSync('node', ['tools/format-read-check.mjs'], { stdio: 'inherit' });
  if (read.status !== 0) failed++;
}
// The site's files too (the code running on the Linux PC; tap files only there): the site not answering is a note.
{
  const fmt = spawnSync('node', ['tools/format-check.mjs', '--files', 'https://sparat.rangner.com/data/'], { encoding: 'utf8' });
  console.log(fmt.status === 2 ? `note ${(fmt.stdout || '').trim()}` : (fmt.stdout || '').trim());
  if (fmt.status === 1) failed++;
}
// Trains to and from abroad (src/abroad.js, 2026-11-18): the card's row and the map's leg, on the rush-hour replay.
let abroad = { status: 0 };
if (ui.status !== 2) abroad = spawnSync('node', ['tools/abroad-check.mjs'], { stdio: 'inherit' });
// Settings → Debug hidden until switched on (#debug, 7 taps on About's version line; 2026-11-18).
let debug = { status: 0 };
if (ui.status !== 2) debug = spawnSync('node', ['tools/debug-check.mjs'], { stdio: 'inherit' });
// A tap on a train in a "N trains" group lists the group (2026-11-18).
let group = { status: 0 };
if (ui.status !== 2) group = spawnSync('node', ['tools/group-check.mjs'], { stdio: 'inherit' });
// Disruptions: rail work vs problems in the list and on the map, the map setting (live data; 2026-11-18).
let dis = { status: 0 };
if (ui.status !== 2) dis = spawnSync('node', ['tools/disruption-check.mjs'], { stdio: 'inherit' });
// Room for the scrollbar in every scrolling area, phone and computer (Max, 2026-11-19).
let scroll = { status: 0 };
if (ui.status !== 2) scroll = spawnSync('node', ['tools/scroll-check.mjs'], { stdio: 'inherit' });
// The live pill: every state in both languages one short line (Max, 2026-11-19).
let pill = { status: 0 };
if (ui.status !== 2) pill = spawnSync('node', ['tools/pill-check.mjs'], { stdio: 'inherit' });
process.exit(failed || scroll.status === 1 || pill.status === 1 || ui.status === 1 || filesUi.status === 1 || abroad.status === 1 || debug.status === 1 || group.status === 1 || dis.status === 1 ? 1 : 0);
