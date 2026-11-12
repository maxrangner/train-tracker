// The check to run before merging a change: replays every recording in data/ through the page's train code
// (tools/motion-check.mjs) and fails when a rule breaks or the movement gets worse than these limits.
// Run: node tools/check.mjs        exit code 0: all good; 1: something failed (it says what)
import { readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Rules (must be 0) and limits, from the numbers measured 2026-11-11/12 (PLAN.md, step 4), with some room.
const CHECKS = [
  ['pastStop', v => v === 0, 'a coasting train passed an unconfirmed planned stop (must be 0)'],
  ['movedAfterStanding', v => v === 0, 'a train moved on after standing still with its GPS quiet (must be 0)'],
  ['frozenPct', v => v <= 1.5, 'moving trains drawn standing more than 1.5 % of the time'],
  ['lag90S', v => v <= 10, '90 % of moments further than 10 s of travel from the truth'],
  ['offTrack99M', v => v === null || v <= 1, '99 % of drawn trains further than 1 m from a track'],
  // U-turns drawn beyond the data's own (2026-11-12, after ignoring re-sent old positions: 216, 215 and 181 in the
  // hour-long rush recordings, from 220, 222 and 184): must not grow again.
  // Drawn moving against the real train, both moving, 3 s or more (2026-11-12: 1, 5 and 1 in the rush recordings).
  ['wrongWay', v => v <= 10, 'more than 10 times drawn against the real train'],
  ['extraTurnBacks', v => v <= 250, 'more than 250 U-turns drawn beyond the data’s own'],
];

const recordings = readdirSync('data').filter(f => f.startsWith('positions-') && f.endsWith('.jsonl'))
  .filter(f => statSync(`data/${f}`).size > 1e6)   // a minute's test recording is too short to replay
  .sort();
let failed = 0;
for (const f of recordings) {
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
console.log(failed ? `${failed} of ${recordings.length} recordings failed` : `all ${recordings.length} recordings pass`);
process.exit(failed ? 1 : 0);
