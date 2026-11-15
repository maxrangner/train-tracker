// When a position report was really made. Plain JavaScript, no page parts, so the Node tools read recordings alike.
//
// Some trains send through two boxes whose clocks are about 20 s apart (Norrtåg, Pågatågen, Östgötapendeln, some SL;
// 6-30 trains in an hour). A report from the box running behind carries a TimeStamp ~20 s too early, so the drawn
// train jumped ahead and back. Trafikverket's own receive time (ModifiedTime) tells which: a report taken in more than
// LATE_MS after its TimeStamp gets the receive time minus TAKE_MS, which is within about a second of the truth
// (night of 2026-11-14, docs: night-1114/night.md; replays: 90 % within 6.8 -> 6.1 s with the speed-0 rule).
// Not for the first answer after starting: that holds every train's latest report, which may have been received long
// ago and re-saved since (the recordings' `via: 'start'`).
const LATE_MS = 12000;
const TAKE_MS = 5000;

// p: Trafikverket's position object (TimeStamp, ModifiedTime). first: it came in the first answer.
export function reportTime(p, first = false) {
  const time = Date.parse(p.TimeStamp);
  if (first || !p.ModifiedTime) return time;
  const got = Date.parse(p.ModifiedTime);
  return got - time > LATE_MS ? got - TAKE_MS : time;
}
