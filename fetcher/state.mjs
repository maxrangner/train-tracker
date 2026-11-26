// What the fetcher knows, in memory only (nothing is written to disk): every train's latest position, the passings of
// the last 90 minutes, the planned rows of the trains on the map, and the slower lists (disruptions, stats, stations).
// No network here: the live feeds (fetcher/main.mjs) and the replay check (tools/fetcher-check.mjs) feed it alike.
// Records and passings keep the shapes the page uses today (src/trains-source.js toRecord, src/trafikverket.js
// followPassings), so the page can take them as they are (public-plan step 3).

import { historySlot } from '../src/live-file.js';

const MAX_AGE_MS =15 * 60 * 1000;     // a train silent this long is left out (the page's own limit, src/trains.js)
const GONE_KEEP_MS = 2 * 60 * 1000;    // a train reported gone is still listed (as gone) this long, so pages hear it
const PASSINGS_MS = 90 * 60 * 1000;    // the passings a page gets when it opens (followPassings' sinceMinutes)
const PLANNED_KEEP_MS = 6 * 3600 * 1000;
const r5 = x => Math.round(x * 1e5) / 1e5;   // as src/live-file.js rounds places (about 1 m)

export function createState() {
  const latest = new Map();     // train id -> record (toRecord's shape) + got (when the fetcher received it)
  const passings = new Map();   // key|station|activity -> passing + got
  const lastPassing = new Map(); // train key -> its latest passing (for its lateness)
  const planned = new Map();    // train id -> { rows: Map(sig|activity|planned -> row), until, asked, brand }
  const lists = {};             // disruptions, cancelled, arrivals, stations: { at, data }
  const history = new Map();    // 15-minute slot -> Map(train id -> { id, number, brand, from, until, points }): the day
  let count = { records: 0, passings: 0 };

  return {
    // A batch of position records (toRecord's shape). got: the fetcher's clock when they arrived.
    addRecords(records, got) {
      for (const r of records) {
        const old = latest.get(r.id);
        if (old && old.time > r.time && !r.gone) continue;   // an older report arriving late changes nothing
        latest.set(r.id, { ...r, got });
        count.records++;
      }
    },
    // first: the first answer after (re)starting, the last 90 minutes at once: kept, but not "new" for the live file
    // (pages get those from the passings file), so the live file stays small after a start.
    addPassings(list, got, { first = false } = {}) {
      for (const p of list) {
        const rec = { ...p, got: first ? 0 : got };
        passings.set(`${p.key}|${p.station}|${p.activity}`, rec);
        const last = lastPassing.get(p.key);
        if (!last || rec.time >= last.time) lastPassing.set(p.key, rec);
        count.passings++;
      }
    },
    addPlanned(rows, got) {
      for (const row of rows) {
        let t = planned.get(row.key);
        if (!t) planned.set(row.key, t = { rows: new Map(), until: 0, asked: 0, brand: null, added: got });
        const k = `${row.sig}|${row.activity}|${row.planned}`;
        if (!t.rows.has(k)) { t.rows.set(k, { sig: row.sig, activity: row.activity, planned: row.planned, got }); }
        if (row.brand) t.brand = row.brand;
        t.until = Math.max(t.until, row.planned);
      }
    },
    setList(name, data, at) { lists[name] = { at, data }; },
    list: name => lists[name] ?? null,

    // The trains shown now: reported within MAX_AGE_MS (gone ones for GONE_KEEP_MS), newest report per train.
    trains(now) {
      const out = [];
      for (const [id, r] of latest) {
        if (r.gone ? now - r.got > GONE_KEEP_MS : now - r.time > MAX_AGE_MS) { if (now - r.got > MAX_AGE_MS) latest.delete(id); continue; }
        out.push(r);
      }
      return out;
    },
    // Passings received after `since` (fetcher clock), or all of the last 90 minutes.
    passings(now, since = null) {
      const out = [];
      for (const [k, p] of passings) {
        if (now - p.time > PASSINGS_MS && (p.got === 0 || now - p.got > PASSINGS_MS)) {
          passings.delete(k);
          if (lastPassing.get(p.key) === p || now - (lastPassing.get(p.key)?.time ?? 0) > PLANNED_KEEP_MS) lastPassing.delete(p.key);
          continue;
        }
        if (since === null ? now - p.time <= PASSINGS_MS : p.got > since) out.push(p);
      }
      return out;
    },
    // The latest lateness per train (for asking planned routes far enough back, as the page does).
    lateBy: id => lastPassing.get(id)?.minutes ?? 0,
    plannedOf: id => planned.get(id) ?? null,
    // Planned rows of the trains on the map, planned from `from` on; added after `since` only, when given, except the
    // trains in `whole` (not in the base file: a train come (back) onto the map), which get all their rows. (Until
    // 2026-11-22 such a train, its rows stored before the base file, was in neither file for up to 10 minutes: the code
    // review of 2026-11-21, finding 10.)
    plannedRows(now, ids, from, since = null, whole = null) {
      const out = [], brands = {};
      for (const id of ids) {
        const t = planned.get(id);
        if (!t) continue;
        if (t.brand) brands[id] = t.brand;
        for (const r of t.rows.values()) if (r.planned >= from && (since === null || r.got > since || whole?.has(id))) out.push({ key: id, ...r });
      }
      for (const [id, t] of planned) if (now - Math.max(t.until, t.asked) > PLANNED_KEEP_MS && !latest.has(id)) planned.delete(id);
      return { rows: out, brands };
    },
    // The day (build plan part 4, 2026-11-22; the file's format: src/live-file.js historyRow). Every HISTORY_EVERY_MS
    // (fetcher/main.mjs liveTick) a sample of every train on the map, gone ones left out: its latest report (a point
    // only when the report is new since its last point in this slot) and, every sample, `until` moved on. The points
    // gather per 15-minute slot; takeHistory(slot) hands a finished slot out and forgets it. Times to whole seconds and
    // places to 1e-5 degrees here already, so the file gives back exactly these.
    sampleHistory(t) {
      const slot = historySlot(t);
      let b = history.get(slot);
      if (!b) history.set(slot, b = new Map());
      for (const r of latest.values()) {
        if (r.gone || t - r.time > MAX_AGE_MS) continue;   // as trains(t) shows them

        let tr = b.get(r.id);
        const at = Math.round(t / 1000) * 1000;
        if (!tr) b.set(r.id, tr = { id: r.id, number: r.number, brand: null, from: at, until: at, points: [] });
        tr.until = at;
        tr.number = r.number;
        const brand = planned.get(r.id)?.brand ?? lastPassing.get(r.id)?.brand ?? null;
        if (brand) tr.brand = brand;
        const time = Math.round(r.time / 1000) * 1000;
        if (tr.points.at(-1)?.time === time) continue;
        tr.points.push({ time, lon: r5(r.lon), lat: r5(r.lat), speed: r.speed ?? null, bearing: r.bearing ?? null, late: lastPassing.get(r.id)?.minutes ?? null });
      }
    },
    // A slot's trains as gathered ([{ id, number, brand, from, until, points }]), and forgotten here; [] if none.
    takeHistory(slot) {
      const b = history.get(slot);
      history.delete(slot);
      for (const s of history.keys()) if (s < slot) history.delete(s);   // a slot never taken (a clock moved): let go
      return b ? [...b.values()] : [];
    },
    historySlots: () => [...history.keys()],
    markAsked(ids, at) { for (const id of ids) { let t = planned.get(id); if (!t) planned.set(id, t = { rows: new Map(), until: 0, asked: 0, brand: null }); t.asked = at; } },
    // (count.passings, every passing seen, was spread over passings, the ones kept, until 2026-11-24: the status said 144523)
    sizes: () => ({ trains: latest.size, passings: passings.size, planned: planned.size, records: count.records, passingsSeen: count.passings }),
  };
}
