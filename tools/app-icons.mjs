// The app's icons (Max's pick H4, 2026-11-20; sketches in docs/look-1120-icon/): the logo's white å on the Orchid
// gradient (#9a5cf0 → #d0389f), its long shadow falling to the lower right. Drawn at every Android size into
// android/app/src/main/res/mipmap-*, and the browser tab's icon into index.html. node tools/app-icons.mjs (run again
// after a logo change). Per size: ic_launcher.png (rounded square, old phones), ic_launcher_round.png (circle), and the
// "adaptive" icon's two layers, ic_launcher_background.png (the gradient) and ic_launcher_foreground.png (the å and its
// shadow on clear): the phone cuts its own shape from them and shows about the middle 72 of their 108 units.
import { writeFileSync, readFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
import { logoSvg, ICON_VIEW } from '../src/logo.js';

const RES = 'android/app/src/main/res';
const SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };   // the launcher icon in pixels
const FROM = '#9a5cf0', TO = '#d0389f';

// The design lives in a 1024 square (the visible icon); `view` may show more of it (the adaptive layers: 1536, the
// 1024 in the middle). The å is h tall, centred; its shadow: copies stepping down-right, black fading 0.32 → 0.04.
let n = 0;
const aa = (h, dx = 0, dy = 0) => {
  const w = h * 286 / 428;
  return logoSvg({ fill: '#fff', view: ICON_VIEW, id: `a${++n}` }).replace('<svg ', `<svg x="${512 - w / 2 + dx}" y="${512 - h / 2 + dy}" width="${w}" height="${h}" `);
};
function icon({ view = '0 0 1024 1024', clip = '', back = true, front = true, h = 720 }) {
  const [vx, vy, vw] = view.split(' ').map(Number), step = Math.max(6, h / 100), copies = Math.ceil((vx + vw + 100) / step);
  const defs = `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1024" y2="1024"><stop offset="0" stop-color="${FROM}"/><stop offset="1" stop-color="${TO}"/></linearGradient>` +
    `<linearGradient id="ls" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1024" y2="1024"><stop offset="0.3" stop-color="#000" stop-opacity="0.32"/><stop offset="1" stop-color="#000" stop-opacity="0.04"/></linearGradient>` +
    (front ? `<mask id="lm" maskUnits="userSpaceOnUse" x="${vx}" y="${vy}" width="${vw}" height="${vw}"><rect x="${vx}" y="${vy}" width="${vw}" height="${vw}"/>` +
      Array.from({ length: copies }, (_, i) => aa(h, i * step, i * step)).join('') + '</mask>' : '') +
    (clip ? `<clipPath id="c">${clip}</clipPath>` : '');
  const all = `x="${vx}" y="${vy}" width="${vw}" height="${vw}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}"><defs>${defs}</defs><g${clip ? ' clip-path="url(#c)"' : ''}>` +
    (back ? `<rect ${all} fill="url(#g)"/>` : '') + (front ? `<rect ${all} fill="url(#ls)" mask="url(#lm)"/>${aa(h)}` : '') + '</g></svg>';
}
const SQUARE = icon({ clip: '<rect width="1024" height="1024" rx="240"/>' });
const ROUND = icon({ clip: '<circle cx="512" cy="512" r="512"/>', h: 720 * 0.85 });
const LAYER = '-256 -256 1536 1536';   // 108 units, the visible 72 = the design's 1024
const BACK = icon({ view: LAYER, front: false }), FORE = icon({ view: LAYER, back: false });

const browser = await launch();
const page = await browser.newPage();
async function shot(svg, px, file) {
  await page.setContent(`<body style="margin:0;background:transparent"><img id="i" width="${px}" height="${px}" style="display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body>`);
  await page.waitForFunction(() => document.getElementById('i').complete);
  const png = await (await page.$('#i')).screenshot({ omitBackground: true });
  if (file) writeFileSync(file, png);
  return png;
}
for (const [dpi, px] of Object.entries(SIZES)) {
  await shot(SQUARE, px, `${RES}/mipmap-${dpi}/ic_launcher.png`);
  await shot(ROUND, px, `${RES}/mipmap-${dpi}/ic_launcher_round.png`);
  await shot(BACK, px * 108 / 48, `${RES}/mipmap-${dpi}/ic_launcher_background.png`);
  await shot(FORE, px * 108 / 48, `${RES}/mipmap-${dpi}/ic_launcher_foreground.png`);
}
const adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
  '    <background android:drawable="@mipmap/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n';
for (const f of ['ic_launcher', 'ic_launcher_round']) writeFileSync(`${RES}/mipmap-anydpi-v26/${f}.xml`, adaptive);
// The browser tab: a 64-pixel picture (sharp on a high-density screen), written into index.html's icon line.
const tab = Buffer.from(await shot(SQUARE, 64)).toString('base64');
const html = readFileSync('index.html', 'utf8'), line = /<link rel="icon"[^>]*>/;
if (!line.test(html)) throw new Error('index.html has no <link rel="icon">');
writeFileSync('index.html', html.replace(line, `<link rel="icon" type="image/png" href="data:image/png;base64,${tab}">`));
await browser.close();
console.log(`icons: ${Object.keys(SIZES).length} sizes × 4 into ${RES}, the tab icon into index.html (${Math.round(tab.length / 1024)} kB)`);
