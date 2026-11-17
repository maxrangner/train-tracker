// One trip from the pieces Trafikverket splits it into (2026-11-15, VR 2047: a diversion gave the same public number
// three internal numbers, 2047 Stockholm C → Herrljunga, 12015 Herrljunga → Fristad, 12016 only Göteborg C; the card
// showed one stop). Measured 13–15 Nov: 470–560 public numbers a day have several internal numbers, mostly planned
// (Öresundståg at the border, Pågatågen, Västtågen); a few are different trains with the same number (384: Vy
// Göteborg → Oslo and SJ Malmö → Stockholm; 7960 / 7961 there and back), which must stay apart.
// Pure (no page, no network), so node can check it: tools/split-check.mjs.

const HOUR = 60 * 60000;
// What the number search asks for each row (src/trafikverket.js fetchTrainsByNumber; from files the same rows):
// enough for tripsOf.
export const NUMBER_FIELDS = ['AdvertisedTrainIdent', 'OperationalTrainNumber', 'ScheduledDepartureDateTime',
  'AdvertisedTimeAtLocation', 'Deleted', 'FromLocation', 'ToLocation', 'ProductInformation'];
const first = list => list?.[0]?.LocationName ?? null;

// The pieces (one per internal number) of these rows, in the order first seen; Deleted rows are dropped.
function piecesOf(rows) {
  const byOp = new Map();
  rows.forEach((a, index) => {
    if (a.Deleted) return;
    const op = String(a.OperationalTrainNumber);
    let p = byOp.get(op);
    if (!p) byOp.set(op, p = { op, rows: [], t0: Infinity, t1: -Infinity, from: null, to: null, product: null, day: null });
    p.rows.push({ a, index });
    const t = Date.parse(a.AdvertisedTimeAtLocation);
    if (Number.isFinite(t)) { p.t0 = Math.min(p.t0, t); p.t1 = Math.max(p.t1, t); }
    p.from ??= first(a.FromLocation);
    p.to ??= first(a.ToLocation);
    p.product ??= a.ProductInformation?.[0]?.Description ?? null;
    p.day ??= a.ScheduledDepartureDateTime ?? null;
  });
  return byOp;
}

// The pieces that make one trip with `start`, among `pieces` (start included), in order of planned time.
function grow(pieces, start) {
  // What the joined trip is known to be (from, to, product): the start piece's, filled in by pieces joined later.
  const ref = { from: start.from, to: start.to, product: start.product };
  const joined = [start];
  const near = p => joined.some(j => Math.max(p.t0 - j.t1, j.t0 - p.t1) <= HOUR);
  let added = true;
  while (added) {
    added = false;
    for (const p of pieces) {
      if (joined.includes(p)) continue;
      const fields = ['from', 'to', 'product'];
      if (fields.some(f => p[f] && ref[f] && p[f] !== ref[f])) continue;   // a different train with the same number
      // Every field known on both sides and the same: one trip, however far apart in time (449: Göteborg C moved to
      // its own number, 1 h 40 min after the rest). Otherwise only next to a piece already joined.
      const sure = fields.every(f => p[f] && ref[f]);
      if (!sure && !near(p)) continue;
      joined.push(p);
      for (const f of fields) ref[f] ??= p[f];
      added = true;
    }
  }
  return joined.sort((x, y) => x.t0 - y.t0);
}

// The trips among the rows of one public number on one day (the number search, one row per trip; Max 2026-11-16,
// "2047" listed three times): each starts from its earliest piece not yet in a trip (its "anchor") and joins as
// joinPieces does. -> [{ operational (the anchor's), day (its ScheduledDepartureDateTime), ops (every piece, in trip
// order), from, to, product }], earliest first.
export function tripsOf(rows) {
  const left = [...piecesOf(rows).values()];
  const trips = [];
  while (left.length) {
    const anchor = left.reduce((a, p) => (p.t0 < a.t0 ? p : a));
    const joined = grow(left, anchor);
    for (const p of joined) left.splice(left.indexOf(p), 1);
    trips.push({ operational: anchor.op, day: anchor.day, ops: joined.map(p => p.op),
      from: joined.map(p => p.from).find(Boolean) ?? null, to: joined.map(p => p.to).findLast(Boolean) ?? null,
      product: joined.map(p => p.product).find(Boolean) ?? null, t0: anchor.t0 });
  }
  return trips.sort((a, b) => a.t0 - b.t0).map(({ t0, ...trip }) => trip);
}

// rows: TrainAnnouncement rows of one public number on one day (any internal numbers; Deleted ones are dropped).
// operational: the internal number of the piece that was tapped.
// -> { rows (in trip order), pieces (how many were joined), ops (their internal numbers), from, to } or null when the
// tapped piece has no rows.
export function joinPieces(rows, operational) {
  const byOp = piecesOf(rows);
  const tapped = byOp.get(String(operational));
  if (!tapped) return null;
  // In order of planned time; at the same minute the earlier piece first, then each piece's own order.
  const joined = grow([...byOp.values()], tapped);
  const order = new Map(joined.map((p, i) => [p, i]));
  const all = joined.flatMap(p => p.rows.map(r => ({ ...r, piece: order.get(p), t: Date.parse(r.a.AdvertisedTimeAtLocation) })));
  all.sort((x, y) => (Number.isFinite(x.t) && Number.isFinite(y.t) && x.t !== y.t ? x.t - y.t : 0)
    || x.piece - y.piece || x.index - y.index);

  // Where two pieces meet, the same station and the same event can come twice: keep one, the one that tells most.
  const tells = a => (a.TimeAtLocation ? 2 : 0) + (a.EstimatedTimeAtLocation ? 1 : 0);
  const out = [];
  for (const r of all) {
    const last = out.at(-1);
    if (last && last.piece !== r.piece && last.a.LocationSignature === r.a.LocationSignature
      && last.a.ActivityType === r.a.ActivityType) {
      if (tells(r.a) >= tells(last.a)) out[out.length - 1] = r;
      continue;
    }
    out.push(r);
  }
  return {
    rows: out.map(r => r.a),
    pieces: joined.length,
    ops: joined.map(p => p.op),
    from: joined.map(p => p.from).find(Boolean) ?? null,
    to: joined.map(p => p.to).findLast(Boolean) ?? null,
  };
}
