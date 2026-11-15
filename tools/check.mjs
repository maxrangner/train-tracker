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
  'tools/motion-check.mjs', 'tools/lib/records.mjs', 'tools/lib/branch.mjs', 'tools/path-check.mjs', 'src/report-time.js', 'tools/check.mjs', 'tools/recordings.json', 'tools/baseline.json', 'public/rail-net.json', 'data/stations.json'];
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
if (!skipReplay) {
  console.log((failed ? `${failed} of ${recordings.length} recordings failed` : `all ${recordings.length} ${MODE} recordings pass`) +
    ` (replay ${Math.round((Date.now() - replayStart) / 1000)} s)`);
  if (!failed && !REBASE) writeFileSync(PASSED, JSON.stringify({ ...(passedAll.stamp ? {} : passedAll),
    [MODE]: { stamp, recordings: recordings.length, when: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' } }));
}

// The cases (tools/recordings.json): seconds, so always run. A case marked knownFailing shows but doesn't fail.
const cases = spawnSync('node', ['tools/cases.mjs'], { stdio: 'inherit' });
if (cases.status !== 0) failed++;

// Trips split over several internal numbers (src/trip.js), on saved rows: seconds, offline.
const split = spawnSync('node', ['tools/split-check.mjs'], { stdio: 'inherit' });
if (split.status !== 0) failed++;

// The screens (exit code 2 from it: the page isn't running, which is said and doesn't fail the check).
const ui = spawnSync('node', ['tools/ui-check.mjs'], { stdio: 'inherit' });
process.exit(failed || ui.status === 1 ? 1 : 0);
