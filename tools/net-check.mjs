// The rail network's way-finding (src/rail-net.js) on a tiny made-up network built here, not the real data (the
// review's F14, 2026-11-17): so a change to route() / ahead() can be checked in a second, and each rule has its own
// case. node tools/net-check.mjs (no page needed; tools/check.mjs runs it).
//
//                    C (30° off, a branch a train can take)
//                   /
//   A ---------- * ---------- B         (A and B one straight track, 1.1 km each)
//                   \
//                    D (150°: back the way it came, a turn no train makes)
import { netFromJSON } from '../src/rail-net.js';

const SCALE = 1e6, LAT = 59, R = Math.PI / 180;
const K = Math.cos(LAT * R), M = R * 6371000;           // metres per degree of latitude; longitude times K
const pt = (eastM, northM) => [18 + eastM / (M * K), LAT + northM / M];
const at = (deg, m, from = [0, 0]) => [from[0] + Math.sin(deg * R) * m, from[1] + Math.cos(deg * R) * m];
const LINES = {
  A: [[-1100, 0], [-550, 0], [0, 0]],
  B: [[0, 0], [550, 0], [1100, 0]],
  C: [[0, 0], at(60, 500), at(60, 1000)],     // 30° off the line heading east (90°)
  D: [[0, 0], at(300, 500), at(300, 1000)],   // heading 300°: 150° from arriving eastwards
};
const names = Object.keys(LINES);
const n = [], d = [];
let px = 0, py = 0;
for (const name of names) {
  n.push(LINES[name].length);
  for (const [e, no] of LINES[name]) {
    const [lon, lat] = pt(e, no), x = Math.round(lon * SCALE), y = Math.round(lat * SCALE);
    d.push(x - px, y - py); px = x; py = y;
  }
}
const net = netFromJSON({ scale: SCALE, n, d, joined: true });
const place = (e, no) => { const [lon, lat] = pt(e, no); return { lon, lat }; };
const snapOn = (name, e, no) => { const s = net.snap(place(e, no)); return s && names[s.li] === name ? s : null; };
const len = p => (p ? Math.round(p.cum[p.cum.length - 1]) : null);

const fails = [], notes = [];
const expect = (what, ok, got) => { (ok ? notes : fails).push(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${got}`); };

const a = snapOn('A', -1000, 0), b = snapOn('B', 1000, 0), c = snapOn('C', ...at(60, 900)), dd = snapOn('D', ...at(300, 900));
if (!a || !b || !c || !dd) fails.push('setup: a place did not snap to its own track');
else {
  // 1. Straight on: A to B, about 2,000 m.
  const ab = net.route(a, b, 5000);
  expect('A to B straight on', ab && Math.abs(len(ab) - 2000) < 5, `${len(ab)} m`);
  // 2. Through the switch onto the branch C (a 30° turn): about 1,900 m.
  const ac = net.route(a, c, 5000);
  expect('A to C through the switch', ac && Math.abs(len(ac) - 1900) < 5, `${len(ac)} m`);
  // 3. No way onto D: it would mean reversing through the switch (150°).
  expect('A to D needs a reversal: none', net.route(a, dd, 5000) === null, len(net.route(a, dd, 5000)));
  // 4. The distance limit holds through switches...
  expect('A to B with a 1,500 m limit: none', net.route(a, b, 1500) === null, len(net.route(a, b, 1500)));
  // 5. ...and on the train's own line too (F05: a target on the same line used to skip the limit).
  const far = snapOn('A', -100, 0);
  expect('along A, 900 m away, 500 m limit: none', net.route(a, far, 500) === null, len(net.route(a, far, 500)));
  expect('along A, 900 m away, 1,000 m limit: found', len(net.route(a, far, 1000)) === 900, `${len(net.route(a, far, 1000))} m`);
  // 6. Ahead with no plan: the straightest way at the switch (B, not C).
  const straight = net.ahead(a, 90, 1500);
  const end = straight && net.snap({ lon: straight.lon.at(-1), lat: straight.lat.at(-1) });
  expect('ahead, no plan: straight on into B', end && names[end.li] === 'B', end ? names[end.li] : 'nothing');
  // 7. Ahead towards a planned place on C: the switch is taken towards it.
  const toC = net.ahead(a, 90, 200, c);
  expect('ahead towards C: through the switch', toC?.towardAt && Math.abs(toC.towardAt - 1900) < 5, `${Math.round(toC?.towardAt ?? 0)} m to C`);
}
for (const s of notes) console.log('  ' + s);
console.log(fails.length ? `net-check FAILED:\n  ${fails.join('\n  ')}` : `net-check ok: ${notes.length} cases on the made-up network`);
process.exit(fails.length ? 1 : 0);
