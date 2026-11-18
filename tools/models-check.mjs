// Do any model's surfaces lie on top of each other? Builds every train model (compact and realistic, every company)
// and counts pairs of differently coloured parts whose surfaces lie in the same plane (within 3 cm) and overlap,
// unless the two parts have a different drawing order (a material's polygonOffset). Such pairs flicker on screen.
// Must be 0. Since the faceted trains (2026-11-18, src/train-kit.js) the trains are built with each piece as its own
// part (the shell, each windscreen skin, each wheel ...; the map gets them joined), and a triangle's colour is its
// own (vertex colours).
// Run: node tools/models-check.mjs [--json] [--who "Mälartåg"]     exit code 1 when any pair is found
import * as THREE from 'three';
import { buildToy } from '../src/toy-trains.js';
import { TOYS } from '../src/toy-brands.js';
import { buildTrain } from '../src/train-model.js';
import { styleFor } from '../src/brands.js';

const argv = process.argv.slice(2);
const who = argv.includes('--who') ? argv[argv.indexOf('--who') + 1] : null;
const SAME_PLANE_M = 0.03;

function triangles(root) {
  root.updateMatrixWorld(true);
  const out = [];
  let part = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    part++;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const order = o.material.polygonOffset ? o.material.polygonOffsetUnits : 0;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const v = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld));
      const nrm = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
      if (nrm.length() / 2 < 1e-4) continue;
      nrm.normalize();
      // Faces back to back fight too: normals are compared with one sign.
      const s = Math.sign(nrm.x || nrm.y || nrm.z) || 1;
      const vc = o.geometry.attributes.color, at = idx ? idx.getX(i) : i;
      const colour = vc ? new THREE.Color(vc.getX(at), vc.getY(at), vc.getZ(at)).getHexString() : o.material.color.getHexString();
      out.push({ part, order, colour, n: nrm.clone().multiplyScalar(s), d: nrm.dot(v[0]) * s,
        box: new THREE.Box3().setFromPoints(v) });
    }
  });
  return out;
}

// The pairs of parts that can flicker: [{ a, b (colours), normal, gap }].
function clashes(root) {
  const buckets = new Map();
  for (const t of triangles(root)) {
    const k = `${Math.round(t.n.x * 50)},${Math.round(t.n.y * 50)},${Math.round(t.n.z * 50)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  const found = [], seen = new Set();
  for (const list of buckets.values()) {
    list.sort((a, b) => a.d - b.d);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].d - list[i].d < SAME_PLANE_M; j++) {
      const a = list[i], b = list[j];
      if (a.part === b.part || a.colour === b.colour || a.order !== b.order || a.n.dot(b.n) < 0.9995) continue;
      const overlap = a.box.clone().intersect(b.box);
      if (overlap.isEmpty()) continue;
      const size = overlap.getSize(new THREE.Vector3());
      if ([size.x, size.y, size.z].sort((x, y) => y - x)[1] < 0.02) continue;   // touching along an edge only
      const key = `${Math.min(a.part, b.part)}-${Math.max(a.part, b.part)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ a: a.colour, b: b.colour, normal: a.n.toArray().map(x => +x.toFixed(2)), gap: +(b.d - a.d).toFixed(3), at: overlap.getCenter(new THREE.Vector3()).toArray().map(x => +x.toFixed(2)) });
    }
  }
  return found;
}

const total = { compact: 0, realistic: 0 };
const lines = [];
for (const [brand, toy] of Object.entries(TOYS)) {
  if (who && brand !== who) continue;
  const c = clashes(buildToy(toy, { pieces: true })), r = clashes(buildTrain({ ...styleFor(brand), model: toy.model }, { pieces: true }));
  total.compact += c.length; total.realistic += r.length;
  if (c.length || r.length) lines.push(`${brand}: compact ${c.length}, realistic ${r.length}`);
  if (who) for (const x of [...c, ...r]) lines.push(`   #${x.a} on #${x.b}, facing ${x.normal}, ${x.gap} m apart, at ${x.at}`);
}
if (argv.includes('--json')) console.log(JSON.stringify(total));
else {
  console.log(`surfaces of different colours on top of each other: compact ${total.compact}, realistic ${total.realistic}`);
  for (const l of lines) console.log(l);
}
process.exit(total.compact + total.realistic ? 1 : 0);
