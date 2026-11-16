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
