// The toy train gallery: every company's toy train, drawn from the same code as the map. Open /demo/trains.html.
// Also packed into one standalone page for the phone (tools/gallery.mjs).
import * as THREE from 'three';
import { buildToy } from '../src/toy-trains.js';
import { TOYS } from '../src/toy-brands.js';

let renderer = null;   // one 3D drawer shared by every card (browsers allow only ~16 at once)
const sheet = document.getElementById('sheet');

for (const [brand, toy] of Object.entries(TOYS)) {
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = `<h2>${brand}</h2><canvas></canvas>` +
    `<div class="src">${toy.note} <a href="${toy.photo}" target="_blank" rel="noopener">Photo</a></div>`;
  sheet.append(div);
  const canvas = div.querySelector('canvas');
  const train = buildToy(toy);
  let angle = Number(new URLSearchParams(location.hash.slice(1)).get('angle') ?? -0.75);   // from the front-left corner
  const draw = () => render(canvas, train, angle);
  draw();
  // Drag sideways to turn the train.
  let x0 = null;
  canvas.addEventListener('pointerdown', (e) => { x0 = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (x0 === null) return; angle += (e.clientX - x0) * 0.012; x0 = e.clientX; draw(); });
  canvas.addEventListener('pointerup', () => { x0 = null; });
}

function render(canvas, train, angle) {
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(2, window.devicePixelRatio);
  if (!renderer) renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const scene = new THREE.Scene();
  // The same light as on the map.
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-0.6, -0.8, 1.2);
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.3), train);

  const len = train.userData.length;
  const camera = new THREE.PerspectiveCamera(22, w / h, 1, 2000);
  camera.up.set(0, 0, 1);
  const d = len * 1.45;
  camera.position.set(Math.sin(angle) * d, Math.cos(angle) * d, d * 0.42);
  camera.lookAt(0, len * 0.08 * Math.cos(angle), 2.2);
  renderer.render(scene, camera);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(renderer.domElement, 0, 0);
}
