// A small EventSource for Node (Node has none), so follow() in src/trafikverket.js runs unchanged in the fetcher.
// It reads Trafikverket's live stream the way tools/collect.mjs does. Unlike a browser's, it does not reconnect by
// itself: when the stream ends or breaks it says CLOSED, and follow() asks again from the last change (which it does
// for the page too when a stream closes).
export class NodeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static open = new Set();   // the streams now open (the live test breaks them: main.mjs --test-breaks)
  static bytes = 0;          // received on all streams so far (as sent: the stream is not compressed)

  // Break the stream as a lost connection would: it says CLOSED and follow() asks again.
  fail() { this.ctrl.abort(); }

  constructor(url) {
    NodeEventSource.open.add(this);
    this.url = url;
    this.readyState = NodeEventSource.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.ctrl = new AbortController();
    this.#run();
  }

  close() {
    this.readyState = NodeEventSource.CLOSED;
    NodeEventSource.open.delete(this);
    this.ctrl.abort();
  }

  async #run() {
    let lastEventId = '';
    try {
      const res = await fetch(this.url, { signal: this.ctrl.signal, headers: { Accept: 'text/event-stream' } });
      if (!res.ok) throw new Error(`stream answered ${res.status}`);
      if (this.readyState === NodeEventSource.CLOSED) return;
      this.readyState = NodeEventSource.OPEN;
      this.onopen?.({});
      const decoder = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        NodeEventSource.bytes += chunk.length;
        // Trafikverket sends \r\n. Replaced after joining: a \r\n split between two chunks, replaced per chunk, glued
        // two messages into one (tools/collect.mjs, 2026-11-12).
        buf = (buf + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const event = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const id = /^id:\s*(.+)$/m.exec(event)?.[1];
          if (id) lastEventId = id.trim();
          const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('');
          if (data && this.readyState === NodeEventSource.OPEN) this.onmessage?.({ data, lastEventId });
        }
      }
    } catch (e) {
      if (this.readyState === NodeEventSource.CLOSED) return;   // closed by us
      this.error = e.message;
    }
    if (this.readyState === NodeEventSource.CLOSED) return;
    this.readyState = NodeEventSource.CLOSED;
    NodeEventSource.open.delete(this);
    this.onerror?.({ message: this.error ?? 'the stream ended' });
  }
}
