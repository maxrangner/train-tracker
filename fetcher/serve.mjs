// Hands the fetcher's files from memory over plain HTTP on this computer (for working on the page: public-plan step 3
// and 4). The public is served by one.com, not by this. Same rules as there: any site may read (the apps need it), a
// missing name is never kept (it may exist a second later), and a name never changes content, so it may be kept.
import { createServer } from 'node:http';

export function serve(shelf, port, status) {
  const server = createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
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
  server.listen(port);
  return server;
}

// Only the status (counts, feeds, sizes), only to this computer: 127.0.0.1 can't be reached from any other device.
// The monitor (monitor/main.mjs) reads it.
export function serveStatus(port, status) {
  const server = createServer((req, res) => {
    if (new URL(req.url, 'http://x').pathname !== '/status') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(status()));
  });
  server.listen(port, '127.0.0.1');
  return server;
}
