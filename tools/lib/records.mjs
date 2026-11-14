// A recording's positions as the page reads them (src/trains-source.js toRecord: the same fields and the same report
// time, src/report-time.js), for the replay tools: [{ id, lon, lat, speed, bearing, time, got, gone }], by arrival.
import { readFileSync } from 'node:fs';
import { reportTime } from '../../src/report-time.js';

export function readPositions(file, keep = () => true) {
  const recs = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line || !keep(line)) continue;
    const p = JSON.parse(line);
    const m = /POINT \(([-\d.]+) ([-\d.]+)/.exec(p?.Position?.WGS84 ?? '');
    if (!m || !p.Train) continue;
    recs.push({
      id: `${p.Train.OperationalTrainNumber}/${p.Train.OperationalTrainDepartureDate.slice(0, 10)}`,
      lon: Number(m[1]), lat: Number(m[2]), speed: p.Speed ?? null, bearing: p.Bearing ?? null,
      time: reportTime(p, p.via === 'start'), got: Date.parse(p.got), gone: p.Deleted === true || p.Status?.Active === false,
    });
  }
  return recs.sort((a, b) => a.got - b.got);
}
