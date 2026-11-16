// The Android app's icons (2026-11-16): the browser icon's look (the white å of the logo on the accent colour) drawn at
// every Android size into android/app/src/main/res/mipmap-*. node tools/app-icons.mjs (run again after a logo change).
// Three files per size: ic_launcher.png (rounded square, old phones), ic_launcher_round.png (circle), and
// ic_launcher_foreground.png (the å alone on clear, for the "adaptive" icon: the phone cuts its own shape from the
// background colour in values/ic_launcher_background.xml, and shows only the middle 66 of the 108 units).
import { writeFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
import { logoSvg, ICON_VIEW } from '../src/logo.js';
import { ACCENTS, DEFAULT_ACCENT } from '../src/colours.js';

const BG = ACCENTS[DEFAULT_ACCENT].light.c, INK = ACCENTS[DEFAULT_ACCENT].light.ink;
const RES = 'android/app/src/main/res';
const SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };   // the launcher icon in pixels
const glyph = (w, h) => logoSvg({ fill: INK, view: ICON_VIEW, id: 'm' }).replace('<svg ', `<svg width="${w}" height="${h}" `);
// The å's box is 286 × 428 (ICON_VIEW): drawn 2/3 of the icon's height in the square ones, as in the browser icon.
const square = (px, round) => `<div style="width:${px}px;height:${px}px;background:${BG};border-radius:${round ? '50%' : `${px * 15 / 64}px`};display:flex;align-items:center;justify-content:center">${glyph(px * 0.75 * 286 / 428 * (round ? 0.85 : 1), px * 0.75 * (round ? 0.85 : 1))}</div>`;
const fore = px => { const s = px * 108 / 48, h = s * 0.42;   // the safe middle is 66/108: the å 42 % of the full height
  return `<div style="width:${s}px;height:${s}px;display:flex;align-items:center;justify-content:center">${glyph(h * 286 / 428, h)}</div>`; };

const browser = await launch();
const page = await browser.newPage();
async function shot(html, file) {
  await page.setContent(`<body style="margin:0;background:transparent">${html}</body>`);
  const box = await page.$('body > div');
  writeFileSync(file, await box.screenshot({ omitBackground: true }));
}
for (const [dpi, px] of Object.entries(SIZES)) {
  await shot(square(px, false), `${RES}/mipmap-${dpi}/ic_launcher.png`);
  await shot(square(px, true), `${RES}/mipmap-${dpi}/ic_launcher_round.png`);
  await shot(fore(px), `${RES}/mipmap-${dpi}/ic_launcher_foreground.png`);
}
writeFileSync(`${RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
await browser.close();
console.log(`icons: ${Object.keys(SIZES).length} sizes × 3 into ${RES}, background ${BG}`);
