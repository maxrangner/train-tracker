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
// The fetcher's files for a phone on the home wifi (2026-11-23, The day): a fetcher running here with --serve answers
// only on this computer (127.0.0.1:8097), which the phone can't reach; the dev page hands them on under /fetcher/, so
// the phone's page uses #files=/fetcher/ (the page itself is http://192.168.x.x:<port>/). Only the dev server does this.
// FETCHER=http://127.0.0.1:<port> for a fetcher on another port.
const FETCHER = process.env.FETCHER ?? 'http://127.0.0.1:8097';

// A connection the browser drops halfway (a test browser closing, a phone leaving the wifi) is let go: until
// 2026-11-23 its "read ECONNRESET" had no listener and stopped the whole dev server (the 5181 page went away several
// times a day). The public site and the app are plain files: not affected.
const letGo = () => {};
const keepServing = {
  name: 'keep-serving',
  configureServer(server) { server.httpServer?.on('connection', socket => socket.on('error', letGo)); },
};

export default {
  plugins: [keepServing],
  server: { ws: false, proxy: { '/fetcher/': { target: FETCHER, changeOrigin: true, rewrite: p => p.replace(/^\/fetcher/, ''),
    configure(proxy) {
      proxy.on('error', (err, req, res) => { try { if (res && !res.headersSent && res.writeHead) res.writeHead(502); res?.end?.(); } catch { /* gone */ } });
      proxy.on('proxyReq', (proxyReq, req, res) => { req.on('error', letGo); res.on('error', letGo); proxyReq.on('error', letGo); });
    } } } },
  define: {
    __VERSION__: JSON.stringify(version),
    __BUILD__: JSON.stringify(commit + (changed ? '+' : '')),
  },
};
