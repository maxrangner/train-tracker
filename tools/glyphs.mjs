// The map's own letters in Outfit (round 4, 2026-11-15: station names and our map labels in the app's font). The map
// draws text from "glyph" files: each letter as a soft-edged picture (a signed distance field, 24 px) in a small
// protobuf file per 256 characters. OpenFreeMap serves only Noto Sans, so these are cut here from public/fonts/
// (Outfit, SIL OFL), in the test browser with TinySDF (the same code MapLibre uses for letters it draws itself;
// installed with maplibre-gl, as is pbf), and written to public/glyphs/<font, spaces as ->/<range>.pbf. src/map.js sends the map's
// requests for these fonts there (transformRequest); any other range goes to OpenFreeMap's Noto Sans.
// node tools/glyphs.mjs        (no page server needed)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PbfWriter } from 'pbf';
import { launch } from './lib/browser.mjs';

export const GLYPH_FONTS = { 'Outfit Medium': 500, 'Outfit SemiBold': 600, 'Outfit Bold': 700 };
// Latin (å ä ö é ü ø æ …, », –, −): what the font file has (its latin subset). Others fall back to Noto Sans.
export const GLYPH_RANGES = [[0, 255], [8192, 8447], [8704, 8959]];
// The characters the font file lists (Google Fonts' latin subset); a test in the browser alone let in symbols that
// both fallback fonts drew alike (235 in 8704-8959).
const IN_FONT = [[0, 255], [0x2000, 0x206f], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2212, 0x2212], [0x2215, 0x2215]];

const font = readFileSync('public/fonts/outfit-latin.woff2').toString('base64');
const sdf = readFileSync('node_modules/@mapbox/tiny-sdf/index.js', 'utf8').replace('export default class TinySDF', 'window.TinySDF = class TinySDF');

const browser = await launch();
const page = await browser.newPage();
await page.setContent(`<style>@font-face { font-family: Outfit; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 900; }</style>`);
await page.addScriptTag({ content: sdf });
let files = 0, bytes = 0;
for (const [name, weight] of Object.entries(GLYPH_FONTS)) {
  for (const [lo, hi] of GLYPH_RANGES) {
    // In the page: each character the font has, drawn as MapLibre draws a local letter (src: glyph_manager, single
    // resolution): size 24, border 3, radius 8, cutoff 0.25; top shifted by 27 to the glyph files' baseline.
    const glyphs = await page.evaluate(async (weight, lo, hi, inFont) => {
      await document.fonts.load(`${weight} 24px Outfit`);
      const tiny = new window.TinySDF({ fontSize: 24, buffer: 3, radius: 8, cutoff: 0.25, fontFamily: 'Outfit', fontWeight: String(weight) });
      // Only what Outfit has (the browser would otherwise draw it in another font): its width is the same whichever
      // fallback font follows Outfit.
      const c = document.createElement('canvas').getContext('2d');
      const width = (ch, fallback) => { c.font = `${weight} 24px Outfit, ${fallback}`; return c.measureText(ch).width; };
      const has = ch => width(ch, 'serif') === width(ch, 'monospace') && width(ch, 'serif') > 0;
      const out = [];
      for (let id = lo; id <= hi; id++) {
        const ch = String.fromCodePoint(id);
        if (id < 32 || (id >= 127 && id < 160)) continue;
        if (!inFont.some(([a, b]) => id >= a && id <= b) || (id !== 32 && id !== 160 && !has(ch))) continue;
        const g = tiny.draw(ch);
        out.push({ id, bitmap: Array.from(g.data), width: g.glyphWidth, height: g.glyphHeight,
          left: Math.round(g.glyphLeft), top: Math.round(g.glyphTop - 27), advance: Math.round(g.glyphAdvance) });
      }
      return out;
    }, weight, lo, hi, IN_FONT);
    const pbf = new PbfWriter();
    pbf.writeMessage(1, (_, p) => {
      p.writeStringField(1, name);
      p.writeStringField(2, `${lo}-${hi}`);
      for (const g of glyphs) {
        p.writeMessage(3, (_, q) => {
          q.writeVarintField(1, g.id);
          if (g.width && g.height) q.writeBytesField(2, Uint8Array.from(g.bitmap));
          q.writeVarintField(3, g.width);
          q.writeVarintField(4, g.height);
          q.writeSVarintField(5, g.left);
          q.writeSVarintField(6, g.top);
          q.writeVarintField(7, g.advance);
        }, null);
      }
    }, null);
    const buf = pbf.finish();
    mkdirSync(`public/glyphs/${name.replace(/ /g, "-")}`, { recursive: true });
    writeFileSync(`public/glyphs/${name.replace(/ /g, "-")}/${lo}-${hi}.pbf`, buf);
    files++; bytes += buf.length;
    console.log(`${name} ${lo}-${hi}: ${glyphs.length} letters, ${(buf.length / 1024).toFixed(1)} kB`);
  }
}
await browser.close();
console.log(`${files} files, ${(bytes / 1024).toFixed(0)} kB in all`);
