// Hands the fetcher's files from memory over plain HTTP on this computer (for working on the page: public-plan step 3
// and 4). The public is served by one.com, not by this. Same rules as there: any site may read (the apps need it), a
// missing name is never kept (it may exist a second later), and a name never changes content, so it may be kept.
// Both answer only on this computer (127.0.0.1), and a malformed address gets "400" instead of stopping the fetcher
// (Codex's review, 2026-11-17).
import { createServer } from 'node:http';
import { rmSync, chmodSync } from 'node:fs';

const pathOf = req => { try { return decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return null; } };

export function serve(shelf, port, status) {
  const server = createServer((req, res) => {
    const path = pathOf(req);
    if (path === null) { res.writeHead(400); return res.end(); }
    const name = path.slice(1);
    const head = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (name === 'status') {
      res.writeHead(200, { ...head, 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(status(), null, 1));
    }
    const f = shelf.get(name);
    if (!f) { res.writeHead(404, { ...head, 'Cache-Control': 'no-store' }); return res.end('{}'); }
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    res.writeHead(200, { ...head, 'Cache-Control': 'public, max-age=300', ...(gz ? { 'Content-Encoding': 'gzip' } : {}), Vary: 'Accept-Encoding' });
    res.end(gz ? f.gz : f.json);
  });
  server.listen(port, '127.0.0.1');
  return server;
}

// Only the status (counts, feeds, sizes), only to this computer. The monitor (monitor/main.mjs) reads it.
// A number: on 127.0.0.1 at that port (Windows, tests). A path: on a local socket file (the Linux service, plan step 2,
// 2026-11-17): no network address at all, so the service's fence can forbid every address on the PC itself; the file
// is readable by the fetcher's group only (the monitor's user is in it).
export function serveStatus(where, status) {
  const server = createServer((req, res) => {
    if (pathOf(req) !== '/status') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(status()));
  });
  if (/^\d+$/.test(String(where))) server.listen(Number(where), '127.0.0.1');
  else {
    const linux = process.platform !== 'win32';   // on Windows a path like \\.\pipe\name (tests only)
    if (linux) rmSync(where, { force: true });   // one left by an earlier run
    server.listen(where, () => { if (linux) chmodSync(where, 0o660); });
  }
  return server;
}
