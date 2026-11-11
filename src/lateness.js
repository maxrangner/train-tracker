// Minutes off the timetable per train, from its latest actual passing of a station.

export function createLateness() {
  const byKey = new Map();   // trainKey -> {minutes, station, time}
  return {
    // Take in passings. Returns true if any train's minutes changed.
    update(passings) {
      let changed = false;
      for (const p of passings) {
        const known = byKey.get(p.key);
        if (known && known.time > p.time) continue;           // an older passing than the one we have
        if (!known || known.minutes !== p.minutes) changed = true;
        byKey.set(p.key, p);
      }
      return changed;
    },
    get(key) { return byKey.get(key) ?? null; },
    get count() { return byKey.size; },
  };
}

// "2042 (+2)", "2057 (-21)", "1877 (0)"; just the number when the minutes aren't known yet.
export function label(number, minutes) {
  if (minutes === null || minutes === undefined) return String(number);
  return `${number} (${minutes > 0 ? '+' : ''}${minutes})`;
}
