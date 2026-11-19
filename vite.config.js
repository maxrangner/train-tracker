// Vite's settings (2026-11-17): only the version stamp. Every build (npm run dev, the phone build, the APK, the public
// site) carries the project's version (package.json) and the git commit it was built from, shown in Settings → About
// ("Version 0.2.0 (b430b05)"; "+" when the folder had uncommitted changes). How versions go up: docs/versions.md.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const git = cmd => { try { return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const commit = git('rev-parse --short HEAD') || 'unknown';
const changed = git('status --porcelain --untracked-files=no') !== '';

// No live link from the dev page back to this PC (Max, 2026-11-19): with it, the page reloaded itself every time the
// phone dropped the link (going out of the browser and back, the wifi napping), every 10-20 s at times. The cost: after
// a change in the code, the dev page is reloaded by hand. The public page and the app never had the link.
export default {
  server: { ws: false },
  define: {
    __VERSION__: JSON.stringify(version),
    __BUILD__: JSON.stringify(commit + (changed ? '+' : '')),
  },
};
