// A tiny test page that logs every visitor: does a phone's request reach this computer at all?
// Run: node tools/hello.mjs [port=8099], then open http://<this computer's address>:8099 on the phone.
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8099);
createServer((req, res) => {
  console.log(`${new Date().toTimeString().slice(0, 8)} visit from ${req.socket.remoteAddress} ${req.method} ${req.url} ${req.headers['user-agent'] ?? ''}`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<meta name="viewport" content="width=device-width"><h1 style="font-family:system-ui">Hej! The phone reached the computer.</h1>');
}).listen(port, '0.0.0.0', () => console.log(`listening on ${port}`));
