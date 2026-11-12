// Packs the toy train gallery (demo/trains.js with three.js and the toy code) into one standalone page that opens
// anywhere, e.g. on Max's phone as an Artifact. The trains come from the same code as the map.
// Run: node tools/gallery.mjs [--out shots/toy-trains.html]
import { build } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? process.argv[outArg + 1] : 'shots/toy-trains.html';

const result = await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    write: false,
    minify: true,
    lib: { entry: 'demo/trains.js', formats: ['iife'], name: 'ToyGallery' },
  },
});
const code = [result].flat()[0].output.find(o => o.type === 'chunk').code;

const page = `<title>Toy Trains</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@600&display=swap">
<style>
  /* Layout: one column of cards on a phone, two or more side by side on a wide screen. */
  :root {
    --bg: #eef1f4; --card: #ffffff; --fg: #1b1f24; --muted: #59636e; --accent: #0969da; --edge: rgba(27,31,36,.1);
    --display: 'Space Grotesk', system-ui, sans-serif; --text: 'Inter', system-ui, sans-serif;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg: #15191e; --card: #1f252c; --fg: #e6edf3; --muted: #9aa5b1; --accent: #4c9eff; --edge: rgba(230,237,243,.1); color-scheme: dark } }
  :root[data-theme="dark"] {
    --bg: #15191e; --card: #1f252c; --fg: #e6edf3; --muted: #9aa5b1; --accent: #4c9eff; --edge: rgba(230,237,243,.1); color-scheme: dark }
  body { background: var(--bg); color: var(--fg); font: 15px/1.45 var(--text);
    padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
    padding-block: 16px 24px; }
  h1 { font: 600 22px/1.2 var(--display); margin: 0 0 4px; text-wrap: balance; }
  p.note { margin: 0 0 14px; color: var(--muted); max-width: 65ch; }
  #sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 12px; }
  .card { background: var(--card); border: 1px solid var(--edge); border-radius: 10px; padding: 10px 12px; min-width: 0; }
  .card h2 { font: 600 16px/1.3 var(--display); margin: 0; }
  .card canvas { width: 100%; height: 210px; display: block; touch-action: pan-y; cursor: grab; }
  .card .src { color: var(--muted); font-size: 13px; }
  .card a { color: var(--accent); }
  .card a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
<h1>Toy trains: first test</h1>
<p class="note">Four companies' usual trains as toys, painted from 2025–26 photos. Drag a train sideways to turn it. The map draws them from the same code.</p>
<div id="sheet"></div>
<script>${code.replace(/<\/script/gi, '<\\/script')}</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`gallery: ${out} (${(page.length / 1024).toFixed(0)} kB)`);
