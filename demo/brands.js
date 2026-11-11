// The brand sheet: every brand's 3D train, its colours and where they come from. Open /demo/brands.html.
import * as THREE from 'three';
import { buildTrain } from '../src/train-model.js';
import { BRANDS, styleFor } from '../src/brands.js';
import today from '../data/brands-today.json';

let renderer = null;   // shared by every card, see draw()
const sheet = document.getElementById('sheet');
document.getElementById('note').textContent =
  `${today.date}: ${today.brands.length} brands; ${today.withoutBrand} trains with no brand (freight, service) get the generic look.`;

const entries = [...today.brands, { brand: null, trains: today.withoutBrand }];
const COLOUR_NAMES = { body: 'body', skirt: 'lower', roof: 'roof', nose: 'front', stripe: 'stripe' };

for (const b of entries) {
  const style = styleFor(b.brand);
  const div = document.createElement('div');
  div.className = 'brand';
  const known = b.brand && BRANDS[b.brand];
  div.innerHTML =
    `<h2>${b.brand ?? 'No brand (freight, service)'}<span>${b.trains} trains today</span></h2>` +
    `<canvas></canvas>` +
    `<div class="swatches">${Object.entries(style.colours).filter(([k]) => COLOUR_NAMES[k])
      .map(([k, v]) => `<span class="sw"><i style="background:${v}"></i>${COLOUR_NAMES[k]} ${v}</span>`).join('')}</div>` +
    `<div class="src">${known ? (style.source ?? '') : b.brand ? 'not researched yet: generic look' : 'generic look'}</div>`;
  sheet.append(div);
  draw(div.querySelector('canvas'), style);
}

// One 3D drawer for all cards (browsers allow only ~16 at once); each picture is copied into its card.
function draw(canvas, style) {
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio;
  if (!renderer) renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-0.6, -0.8, 1.2);
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.3));

  // Two cars are enough to show the paint: the front car and the next.
  const train = buildTrain({ ...style, cars: 2 });
  scene.add(train);

  // Look at the front car from the front-left corner, slightly above.
  const camera = new THREE.PerspectiveCamera(24, w / h, 1, 1000);
  camera.up.set(0, 0, 1);
  camera.position.set(-38, 34, 12);
  camera.lookAt(0, 8, 2.4);
  renderer.render(scene, camera);
  canvas.getContext('2d').drawImage(renderer.domElement, 0, 0);
}
