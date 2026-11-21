// The replay's rules and limits (tools/check.mjs holds the recordings to them). In a file of their own since
// 2026-11-21, so that an edit to check.mjs itself (a new screen check, say) doesn't start the replay: a change here does.

// Rules (must be 0) and limits, from the numbers measured 2026-11-11/12, with some room.
export const CHECKS = [
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
export const MARGINS = {
  frozenPct: [b => b + 0.2, 'moving trains drawn standing'],
  lag90S: [b => b + 1, '90 % of moments within (s of travel)'],
  // Since 2026-11-21 a stop counts within 300 m of the station point or of its measured stopping place.
  dwellThroughPct: [b => b + 2, 'real stops drawn driving through (%)'],
  wrongWay: [b => b + 2, 'drawn against the real train'],
  // Drawn onto another track before the next report (tools/lib/branch.mjs; since 2026-11-14).
  wrongBranch: [b => b + Math.max(3, Math.round(0.2 * b)), 'drawn onto a wrong branch'],
  extraTurnBacks: [b => b + Math.max(5, Math.round(0.1 * b)), 'U-turns drawn beyond the data’s own'],
  // Drawn U-turns with no real turn of the same train within 90 s (since 2026-11-21, TODO 4; the real direction
  // judged over 20 m moved, so a standing train's GPS wobble at a terminus no longer hides or makes a turn).
  unmatchedTurnBacks: [b => b + Math.max(5, Math.round(0.15 * b)), 'U-turns drawn with no real turn within 90 s'],
  // Trains seen only at fixed places, drawn standing at real stops: median metres from where trains really stand
  // (public/stop-places.json; since 2026-11-14, point 5 B: 186 -> 23 m in the morning rush).
  standNoGpsMedM: [b => b + Math.max(10, Math.round(0.3 * b)), 'trains without GPS standing at stops, median m from the stopping place'],
};
export const ALWAYS = new Set(['pastStop', 'movedAfterStanding', 'offTrack99M']);

// The open train's line follows the train (src/path-follow.js; Max, 2026-11-19: "avoid a line flipping back and
// forth"): in the first FOLLOW_MIN minutes of each recording every train is opened; the drawn train is on its line at
// least FOLLOW_ON % of the time, and the line goes back to a way it just left at most FOLLOW_FLIPS times a train-hour
// (2026-11-20, first 10 minutes: 99.0-99.2 % and 0.07-0.23 in the rushes, the late evening and Saturday; the night
// 97.5 %: trains parked after their trip on sidings the rail data joins to their route's end only kilometres round,
// 7877 north of Stockholm C and 496 at Göteborg C, the line can't reach them).
export const FOLLOW_MIN = 10, FOLLOW_ON = 97, FOLLOW_FLIPS = 1.5;
