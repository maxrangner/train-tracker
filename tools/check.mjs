// The check to run before merging a change: replays the chosen recordings (tools/recordings.json) through the
// page's train code (tools/motion-check.mjs) and fails when a rule breaks or the movement gets worse than these limits.
// Then the screens are checked (tools/ui-check.mjs), when the page is running (npm run dev).
// Run: node tools/check.mjs [--full] [--library | --all]       exit code 0: all good; 1: something failed (it says what)
//   --library  the library recordings too;  --all  every recording in data/, listed or not
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

// Which recordings: tools/recordings.json says each kept recording's role. The core is replayed every time;
// --library adds the library; --all replays every recording in data/ (over 1 MB, so a minute's test is left out).
// A recording in data/ that isn't in the list is unsorted: named here, not replayed.
const LIST = JSON.parse(readFileSync('tools/recordings.json', 'utf8'));
const MODE = process.argv.includes('--all') ? 'all' : process.argv.includes('--library') ? 'library' : 'core';
const inData = readdirSync('data').filter(f => f.startsWith('positions-') && f.endsWith('.jsonl'));
const listed = new Set(LIST.recordings.map(x => `positions-${x.name}.jsonl`));
let missingCore = 0;
for (const x of LIST.recordings) for (const kind of ['positions', 'timetable']) {
  const want = x[kind], f = `data/${kind}-${x.name}.jsonl`;
  if (!want) continue;
  if (!existsSync(f)) {
    console.log(`${x.role === 'core' ? 'FAIL' : 'note'} ${f} is listed (${x.role}) but missing`);
    if (x.role === 'core') missingCore++;
  } else if (statSync(f).size !== want.bytes || createHash('sha256').update(readFileSync(f)).digest('hex') !== want.sha256) {
    console.log(`note ${f} differs from tools/recordings.json (size or SHA-256): not the recording that was chosen`);
  }
}
const unsorted = inData.filter(f => !listed.has(f) && statSync(`data/${f}`).size > 1e6);
if (unsorted.length) console.log(`note unsorted, not replayed (add to tools/recordings.json to use): ${unsorted.join(', ')}`);
const recordings = (MODE === 'all' ? inData.filter(f => statSync(`data/${f}`).size > 1e6)
  : LIST.recordings.filter(x => x.role === 'core' || (MODE === 'library' && x.role === 'library')).map(x => `positions-${x.name}.jsonl`))
  .filter(f => existsSync(`data/${f}`)).sort();
// What the replay's result depends on: these files' contents, and the replayed recordings' names and sizes.
const REPLAY_INPUTS = ['src/trains.js', 'src/rail-net.js', 'src/routes.js', 'src/path.js', 'src/clock.js',
  'tools/motion-check.mjs', 'tools/check.mjs', 'tools/recordings.json', 'public/rail-net.json', 'data/stations.json'];
const PASSED = 'data/.check-passed.json';
const stamp = createHash('sha256')
  .update(MODE)
  .update(REPLAY_INPUTS.map(p => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : 'none')).join())
  .update(recordings.flatMap(f => [f, f.replace('positions-', 'timetable-')]).filter(f => existsSync(`data/${f}`))
    .map(f => `${f}:${statSync(`data/${f}`).size}`).join())
  .digest('hex');
// One stamp per set (core, library, all), so a --library run doesn't make the next everyday run replay again.
const passedAll = existsSync(PASSED) ? JSON.parse(readFileSync(PASSED, 'utf8')) : {};
const last = passedAll[MODE] ?? null;
const skipReplay = !process.argv.includes('--full') && last?.stamp === stamp;
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
  const bad = CHECKS.filter(([k, ok]) => !ok(r[k]));
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${f} (${r.minutes} min${r.routes ? `, ${r.routes} routes` : ''}): ` +
    `frozen ${r.frozenPct} %, ${r.stopsPerMin} stops/min, 90 % within ${r.lag90S} s, track 99 % ${r.offTrack99M} m, ` +
    `grey ${r.greyPct} %, turn-backs ${r.turnBacks} (data ${r.truthTurnBacks}), wrong way ${r.wrongWay}, past stop ${r.pastStop}, moved after standing ${r.movedAfterStanding}`);
  for (const [k, , why] of bad) console.log(`     ${why}: ${k} = ${r[k]}`);
  failed += bad.length ? 1 : 0;
}
failed += missingCore;
if (!skipReplay) {
  console.log((failed ? `${failed} of ${recordings.length} recordings failed` : `all ${recordings.length} ${MODE} recordings pass`) +
    ` (replay ${Math.round((Date.now() - replayStart) / 1000)} s)`);
  if (!failed) writeFileSync(PASSED, JSON.stringify({ ...(passedAll.stamp ? {} : passedAll),
    [MODE]: { stamp, recordings: recordings.length, when: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' } }));
}

// The cases (tools/recordings.json): seconds, so always run. A case marked knownFailing shows but doesn't fail.
const cases = spawnSync('node', ['tools/cases.mjs'], { stdio: 'inherit' });
if (cases.status !== 0) failed++;

// The screens (exit code 2 from it: the page isn't running, which is said and doesn't fail the check).
const ui = spawnSync('node', ['tools/ui-check.mjs'], { stdio: 'inherit' });
process.exit(failed || ui.status === 1 ? 1 : 0);
