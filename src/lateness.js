// Per train, from the timetable feed: minutes off the timetable (from its latest actual passing) and its brand.

export function createLateness() {
  const byKey = new Map();    // trainKey -> {minutes, station, time}
  const brands = new Map();   // trainKey -> brand, e.g. "Pågatågen"
  return {
    // Take in passings. Returns true if any train's minutes changed.
    update(passings) {
      let changed = false;
      for (const p of passings) {
        if (p.brand) brands.set(p.key, p.brand);
        const known = byKey.get(p.key);
        if (known && known.time > p.time) continue;           // an older passing than the one we have
        if (!known || known.minutes !== p.minutes) changed = true;
        byKey.set(p.key, p);
      }
      return changed;
    },
    // Forget the trains whose latest passing is older than `before` (ms), unless keep(key) says to keep one.
    trim(before, keep = () => false) {
      for (const [key, p] of byKey) if (p.time < before && !keep(key)) { byKey.delete(key); brands.delete(key); }
      for (const key of brands.keys()) if (!byKey.has(key) && !keep(key)) brands.delete(key);
    },
    get(key) { return byKey.get(key) ?? null; },
    brand(key) { return brands.get(key) ?? null; },
    get count() { return byKey.size; },
  };
}

// The colour group for minutes off timetable: on time (+2 or less, early included), a little late (+3 to +5),
// late (+6 or more; Trafikverket's own punctuality counts up to 5 minutes as on time), or not known yet.
export function lateClass(minutes) {
  if (minutes === null || minutes === undefined) return 'unknown';
  if (minutes <= 2) return 'ontime';
  if (minutes <= 5) return 'some';
  return 'late';
}

// "2042 (+2)", "2057 (-21)", "1877 (0)"; just the number when the minutes aren't known yet.
export function label(number, minutes) {
  if (minutes === null || minutes === undefined) return String(number);
  return `${number} (${minutes > 0 ? '+' : ''}${minutes})`;
}
