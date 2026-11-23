// Sends the monitor's mails (nodemailer, plain SMTP: a Gmail used only for this, with an app password; Max, 2026-11-16).
// Mails wait in a queue in memory and go in order; one that can't go (no internet, the mail server refusing) is tried
// again after 1, 2, 5, 10, then every 10 minutes, so mails made while the internet is out arrive when it is back.
// A late mail says when it was written. The queue keeps at most 100 (the oldest dropped first).
import nodemailer from 'nodemailer';

const WAITS = [60000, 120000, 300000, 600000];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function makeTransport(cfg) {
  const port = Number(cfg.MAIL_PORT ?? 465);
  return nodemailer.createTransport({
    // Always encrypted before the password goes (Codex's review, 2026-11-17): from the first byte on 465, otherwise the
    // server must switch to encryption first (requireTLS) or nothing is sent.
    host: cfg.MAIL_HOST, port, secure: (cfg.MAIL_SECURE ?? (port === 465 ? 'yes' : 'no')) === 'yes', requireTLS: true,
    auth: { user: cfg.MAIL_USER, pass: cfg.MAIL_PASS },
    connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 30000,
  });
}
// Logs in to the mail server and leaves, sending nothing (the self-check, monitor/self-check.mjs).
export const mailCheck = cfg => makeTransport(cfg).verify();

// version: the line every mail ends with ("Spårat 0.8.0 (commit abc1234)"; Max, 2026-11-23).
export function createMailer(cfg, log, { offline = () => false, version = null } = {}) {
  const need = ['MAIL_HOST', 'MAIL_USER', 'MAIL_PASS', 'MAIL_TO'];
  if (need.every(k => !cfg[k])) return null;                      // no mail settings: no mails (page and terminal only)
  for (const k of need) if (!cfg[k]) throw new Error(`mail needs ${k} in the settings file (or none of the MAIL_ lines)`);
  const transport = makeTransport(cfg);
  const queue = [];
  const stats = { sent: 0, failed: 0, waiting: 0, lastError: null, lastSentAt: null };
  let busy = false, tries = 0, timer = null;

  async function work() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const m = queue[0];
      try {
        if (offline()) throw new Error('test: no internet');
        const late = Date.now() - m.t > 2 * 60000;
        const written = new Date(m.t).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });
        const foot = [late ? `Written ${written}, sent late (no connection until now).` : null,
          `Spårat's monitor on the Linux PC (page: http://127.0.0.1:8092/ on that PC)${version ? `; ${version}` : ''}.`].filter(Boolean);
        await transport.sendMail({
          from: cfg.MAIL_FROM || `Spårat monitor <${cfg.MAIL_USER}>`, to: cfg.MAIL_TO,
          subject: `Spårat: ${m.subject}`,
          text: `${m.text}\n\n--\n${foot.join('\n')}`,
          // The daily summary also as a page with graphs (monitor/summary-mail.mjs); the text stays for mail programs
          // that show only text.
          ...(m.html ? { html: m.html.replace('<!--foot-->', foot.map(esc).join('<br>')) } : {}),
          date: new Date(m.t),
        });
        queue.shift(); stats.sent++; stats.lastSentAt = Date.now(); tries = 0;
        log(`mail sent: ${m.subject}`);
      } catch (e) {
        stats.failed++; stats.lastError = e.message;
        const wait = WAITS[Math.min(tries, WAITS.length - 1)];
        if (tries === 0 || tries % 6 === 0) log(`mail: ${e.message}; ${queue.length} waiting, trying again in ${wait / 60000} min`);
        tries++;
        clearTimeout(timer); timer = setTimeout(work, wait);
        break;
      }
    }
    stats.waiting = queue.length;
    busy = false;
  }

  return {
    send(m) {
      queue.push(m);
      while (queue.length > 100) queue.shift();
      stats.waiting = queue.length;
      if (!timer || tries === 0) work();
    },
    // After an internet loss, try at once rather than waiting out the pause.
    nudge() { if (queue.length) { clearTimeout(timer); timer = null; tries = 0; work(); } },
    stats: () => ({ ...stats }),
    close() { clearTimeout(timer); transport.close(); },
  };
}
