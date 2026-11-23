// My trains (Max, 2026-11-22: "Do today only"): a saved trip from one station to another, and the change on the way
// (idea 11, "Will I make my change?"). Pure: the rows come from two whole-day boards (src/trafikverket.js
// fetchStationDay: today's departures at the start, today's arrivals at the end; the same files the board's search
// reads), joined by the train. No lookup per train.
//
// A trip: { from: sig, to: sig, via: sig | null }. A row: fetchStationDay's ({ key, number, date, planned, estimated,
// actual, track, canceled, product, to }).

export const MIN_CHANGE_MIN = 3;   // a change needs at least this many minutes (Max's yes to the plan, 2026-11-22)

// When a row happens: its real time once there, else the expected, else the planned.
export const when = r => r.actual ?? r.estimated ?? r.planned;
// Minutes late at a row (0 when not late or not known).
export const lateAt = r => Math.max(0, Math.round((when(r) - r.planned) / 60000));
// The same run of a train in two boards: its public number and its day (a split trip keeps its public number; the
// internal numbers differ between its pieces, src/trip.js).
const runOf = r => `${r.number}/${r.date}`;

// The trains going from A to B today: departures at A whose train arrives at B later. Sorted by departure.
// Each { number, date, dep (A's row), arr (B's row), canceled (either end cancelled) }.
export function direct(depA, arrB) {
  const at = new Map();
  for (const r of arrB) if (r.number) { const k = runOf(r), had = at.get(k); if (!had || r.planned < had.planned) at.set(k, r); }
  const out = [];
  for (const d of depA) {
    const a = d.number && at.get(runOf(d));
    if (a && a.planned > d.planned) out.push({ number: d.number, date: d.date, dep: d, arr: a, canceled: d.canceled || a.canceled });
  }
  return out.sort((x, y) => x.dep.planned - y.dep.planned);
}

// The trains still to take at moment now: not yet left A (no real departure), and not a cancelled one whose time has
// passed. The first is "your next train"; a cancelled one ahead stays in the list (crossed out) so its gap shows.
export function ahead(trains, now) {
  return trains.filter(x => !x.dep.actual && !(x.canceled && x.dep.planned < now));
}
// The next train that runs, and the one after it ("If it fails: next is 17:08").
export function nextTwo(trains, now) {
  const run = ahead(trains, now).filter(x => !x.canceled);
  return { next: run[0] ?? null, after: run[1] ?? null };
}

// A change at C: how it looks for a first train arriving at C (arrC row) and a second leaving C (depC row).
// { minutes: expected minutes between them, lost: under 0 (the second leaves before the first arrives), tight: under
// MIN_CHANGE_MIN, tracks: [arrival track, departure track] }.
export function change(arrC, depC) {
  const minutes = Math.round((when(depC) - when(arrC)) / 60000);
  return { minutes, lost: depC.canceled || arrC.canceled || minutes < 0, tight: minutes < MIN_CHANGE_MIN, tracks: [arrC.track || null, depC.track || null] };
}

// A trip with a change at C: each first train A → C paired with the first second train C → B leaving at least
// MIN_CHANGE_MIN minutes after the first's expected arrival at C (planned times, so a late first train shows its
// change as tight or lost instead of quietly pairing with a later train). Each { first, second, change, rescue } where
// first and second are direct()'s rows; second is null when no train C → B leaves after it today; rescue, when the
// change is lost: { second, change } with the first later train that works by expected times, or null.
export function withChange(depA, arrC, depC, arrB) {
  const legs1 = direct(depA, arrC), legs2 = direct(depC, arrB);
  return legs1.map(first => {
    const second = legs2.find(x => !x.canceled && x.dep.planned >= first.arr.planned + MIN_CHANGE_MIN * 60000) ?? null;
    const ch = second ? change(first.arr, second.dep) : null;
    // Lost: the first second train that still works by expected times (on 17 Nov's switch fault every change at
    // Hässleholm was lost; the trip page then says which later train to take).
    const rescue = ch?.lost ? legs2.find(x => !x.canceled && x !== second && when(x.dep) >= when(first.arr) + MIN_CHANGE_MIN * 60000) ?? null : null;
    return { first, second, change: ch, rescue: rescue && { second: rescue, change: change(first.arr, rescue.dep) } };
  });
}

// The line above the search bar for a saved trip: its next train, or null. { number, dep, late, track, to }.
export function lineOf(trains, now) {
  const { next } = nextTwo(trains, now);
  if (!next) return null;
  return { number: next.number, dep: next.dep, late: lateAt(next.dep), track: next.dep.track || null, to: next.arr };
}
