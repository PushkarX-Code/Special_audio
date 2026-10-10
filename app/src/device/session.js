// A session wraps a transport (mock or real) and enforces the safety rules:
//   - every outgoing opcode passes the allowlist guard
//   - at most one command per 150 ms
//   - every command waits for the device reply (same seq), with a timeout and one retry
//
// Transport interface (mock.js and the real transports must match):
//   connect(): Promise<void>
//   disconnect(): Promise<void>
//   send(bytes: Uint8Array): Promise<void>
//   onData(cb), onClose(cb)
//   kind: 'demo' | 'serial' | 'native'
import { encodeFrame, FrameParser } from '../protocol/frame.js';
import { assertAllowed } from '../protocol/guard.js';

const MIN_GAP_MS = 150;
const REPLY_TIMEOUT_MS = 1000;
const RETRIES = 1;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Session {
  constructor(transport) {
    this.transport = transport;
    this.allowDraft = transport.kind === 'demo';
    this.seq = 0;
    this.queue = Promise.resolve();
    this.lastSend = 0;
    this.waiters = new Map(); // seq -> { resolve, expect }
    this.listeners = { frame: new Set(), tx: new Set(), close: new Set(), error: new Set() };
    this.closed = false;

    this.parser = new FrameParser(
      (f) => this.#onFrame(f),
      (err, head) => this.#emit('error', { message: `rx ${err}`, bytes: head }),
    );
    transport.onData((chunk) => this.parser.push(chunk));
    transport.onClose((reason) => {
      this.closed = true;
      this.waiters.forEach((w) => w.resolve(null));
      this.waiters.clear();
      this.#emit('close', reason);
    });
  }

  on(event, cb) { this.listeners[event].add(cb); return () => this.listeners[event].delete(cb); }
  #emit(event, data) { this.listeners[event].forEach((cb) => cb(data)); }

  connect() { this.closed = false; return this.transport.connect(); }
  disconnect() { return this.transport.disconnect(); }

  // Send one command and resolve with the device's reply frame. Rejects after timeout + one retry.
  request({ command, payload = [] }) {
    const name = assertAllowed(command, { allowDraft: this.allowDraft }); // throws before anything is queued
    const job = this.queue.then(() => this.#sendWithRetry(command, payload, name));
    this.queue = job.catch(() => {});
    return job;
  }

  async #sendWithRetry(command, payload, name) {
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (this.closed) throw new Error('not connected');
      const gap = this.lastSend + MIN_GAP_MS - Date.now();
      if (gap > 0) await wait(gap);

      this.seq = this.seq >= 250 ? 1 : this.seq + 1; // device wraps at 250 (S1, S2)
      const seq = this.seq;
      const bytes = encodeFrame(command, payload, seq);
      // A GET 0xC0xx is answered by 0x40xx (S1, S2). Used as a fallback match if the device does not echo seq.
      const expect = (command & 0xf000) === 0xc000 ? (command & 0x0fff) | 0x4000 : null;
      const reply = new Promise((resolve) => this.waiters.set(seq, { resolve, expect }));
      this.lastSend = Date.now();
      this.#emit('tx', { command, name, bytes, attempt });
      await this.transport.send(bytes);

      const frame = await Promise.race([reply, wait(REPLY_TIMEOUT_MS).then(() => undefined)]);
      this.waiters.delete(seq);
      if (frame) return frame;
      if (frame === null) throw new Error('connection closed');
      this.#emit('error', { message: `${name}: no reply${attempt < RETRIES ? ', retrying' : ''}` });
    }
    throw new Error(`${name}: device did not reply`);
  }

  #onFrame(frame) {
    // Unsolicited pushes (0xE0xx, 0x60xx) carry the device's own counter, so they never complete a request.
    const hi = frame.command >> 8;
    const isPush = hi === 0xe0 || hi === 0x60;
    let seq = isPush ? null : this.waiters.has(frame.seq) ? frame.seq : null;
    if (seq === null) for (const [s, w] of this.waiters) if (w.expect === frame.command) { seq = s; break; }
    if (seq !== null) { const w = this.waiters.get(seq); this.waiters.delete(seq); w.resolve(frame); }
    this.#emit('frame', frame);
  }
}
