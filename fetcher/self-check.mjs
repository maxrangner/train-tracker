// The fetcher's self-check (plan to beta step 1, 2026-11-17; Codex's review): tries what the Linux service's
// protections must stop, and what the fetcher must still be able to do, and prints each result. Run it twice at install:
//   outside: node fetcher/main.mjs --self-check outside          (as yourself: the blocked things must work here)
//   inside:  the real service with the real settings: sudo touch /etc/sparat/self-check, then restart the service
//            (main.mjs --self-check-file /etc/sparat/self-check): the same things must now be blocked.
// So a "blocked" inside is only believed because the same thing worked outside (a sleeping or closed target proves
// nothing). Exit code 78: all as expected; 79: something was not (the service file doesn't restart on either).
// Targets (change with --router, --local): the router's page (192.168.50.1:80) and Syncthing's page on this PC
// (127.0.0.1:8384), both known to answer at home; writing to /etc (the service's whole disk is read-only: EROFS, which
// an ordinary refusal, EACCES, is not); the home folders (hidden inside the service).
import { readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';
import { folderCheck } from './upload.mjs';

const TRV_HOST = 'api.trafikinfo.trafikverket.se';

function tcp(hostPort) {
  const [host, port] = hostPort.split(/:(?=\d+$)/);
  return new Promise(res => {
    const s = connect({ host, port: Number(port) });
    const done = r => { clearTimeout(t); s.destroy(); res(r); };
    const t = setTimeout(() => done('no answer in 4 s'), 4000);
    s.on('connect', () => done('reachable'));
    s.on('error', e => done(e.code === 'EPERM' || e.code === 'EACCES' ? 'blocked by Linux' : e.code ?? e.message));
  });
}

export async function selfCheck(where, cfg, args) {
  const arg = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
  const inside = where === 'inside';
  const router = arg('--router', '192.168.50.1:80'), local = arg('--local', '127.0.0.1:8384');
  const rows = [];
  const row = (what, got, ok) => { rows.push(ok); console.log(`self-check ${ok ? 'ok  ' : 'FAIL'} ${what}: ${got}`); };
  console.log(`self-check (${inside ? 'inside the service: the first four must be blocked' : 'outside, as yourself: all must work'})`);

  // 1. The home folders.
  let home;
  try { home = readdirSync('/home').length ? `seen (${readdirSync('/home').length} folders)` : 'hidden (empty)'; } catch (e) { home = `hidden (${e.code})`; }
  row('home folders', home, inside ? home.startsWith('hidden') : home.startsWith('seen'));
  // 2. Writing outside its own folder.
  let wrote;
  try { writeFileSync('/etc/sparat-self-check', 'x'); unlinkSync('/etc/sparat-self-check'); wrote = 'written (!)'; } catch (e) { wrote = e.code; }
  row('writing to /etc', wrote === 'EROFS' ? 'blocked by Linux (read-only disk)' : wrote, inside ? wrote === 'EROFS' : wrote === 'EACCES');
  // 3. A device at home (the router's page) and 4. another program on this PC (Syncthing's page).
  for (const [what, target] of [[`a device at home (${router})`, router], [`another program on this PC (${local})`, local]]) {
    const got = await tcp(target);
    row(what, got, inside ? got === 'blocked by Linux' : got === 'reachable');
  }
  // 5. Name lookup and 6. Trafikverket, both needed everywhere.
  let dns;
  try { dns = `found (${(await lookup(TRV_HOST)).address})`; } catch (e) { dns = e.code ?? e.message; }
  row(`name lookup (${TRV_HOST})`, dns, dns.startsWith('found'));
  let trv;
  try { trv = `answers (HTTP ${(await fetch(`https://${TRV_HOST}/v2/data.json`, { signal: AbortSignal.timeout(10000), redirect: 'error' })).status})`; } catch (e) { trv = e.cause?.code ?? e.message; }
  row('Trafikverket over HTTPS', trv, trv.startsWith('answers'));
  // 7. one.com: log in and look at the folder (nothing written), when the settings are readable here.
  if (cfg.SFTP_HOST && cfg.SFTP_DIR) {
    let one;
    try { one = (await folderCheck(cfg)) ?? 'logged in; the folder is Spårat\'s'; } catch (e) { one = e.message; }
    row('one.com (log in, look at the folder)', one, one.startsWith('logged in'));
  } else console.log('self-check      one.com: skipped (no upload settings readable here)');

  const ok = rows.every(Boolean);
  console.log(`self-check ${ok ? 'done: all as expected' : 'done: NOT as expected, see FAIL above'}`);
  return ok ? 78 : 79;
}
