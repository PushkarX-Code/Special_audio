// Demo headphone. Same interface as the real transports, speaks real frames, replies with realistic delays.
// Reply shapes follow docs/protocol-research.md. Where the real device's behaviour is unknown, the guess is marked.
import { encodeFrame, FrameParser } from '../protocol/frame.js';
import { OP, ANC_BYTES } from '../protocol/commands.js';
import { DOP, EQ_PRESETS, SPATIAL_BYTES, LOW_LAG_BYTES } from '../protocol/drafts.js';
import { IN } from '../protocol/parser.js';

const rand = (a, b) => a + Math.random() * (b - a);
const NOISE_CYCLE = ['anc', 'transparency', 'off']; // what the physical button cycles through

export class MockHeadphones {
  kind = 'demo';
  name = 'CMF Headphone Pro';

  constructor() {
    this.state = {
      battery: 82, charging: false, firmware: '1.0.0.27-demo', model: [0x75, 0xb1],
      noise: 'high', eq: 'dirac', spatial: 'off', lowLag: false,
    };
    this.dataCb = () => {};
    this.closeCb = () => {};
    this.open = false;
    this.parser = new FrameParser((f) => this.#handle(f));
    this.timers = new Set();
  }

  onData(cb) { this.dataCb = cb; }
  onClose(cb) { this.closeCb = cb; }

  async connect() {
    await new Promise((r) => setTimeout(r, 1400)); // long enough to show the connecting animation
    this.open = true;
    this.#every(45000, () => {
      this.state.battery = Math.max(1, this.state.battery - 1);
      this.#push(IN.BATTERY_PUSH, this.#batteryPayload());
    });
  }

  async disconnect() { this.#close('user'); }

  async send(bytes) {
    if (!this.open) throw new Error('demo device is not connected');
    this.parser.push(bytes);
  }

  // Dev panel helpers: things the real headphones can do on their own.
  pressNoiseButton() {
    const current = this.state.noise === 'off' || this.state.noise === 'transparency' ? this.state.noise : 'anc';
    const next = NOISE_CYCLE[(NOISE_CYCLE.indexOf(current) + 1) % NOISE_CYCLE.length];
    this.state.noise = next === 'anc' ? 'high' : next;
    this.#push(IN.ANC_PUSH, [0x01, ANC_BYTES[this.state.noise], 0x00]);
  }
  setBattery(level, charging = this.state.charging) {
    this.state.battery = Math.max(0, Math.min(100, level));
    this.state.charging = charging;
    this.#push(IN.BATTERY_PUSH, this.#batteryPayload());
  }
  dropConnection() { this.#close('lost'); }

  #close(reason) {
    if (!this.open) return;
    this.open = false;
    this.timers.forEach(clearInterval);
    this.timers.clear();
    this.parser.reset();
    this.closeCb(reason);
  }

  #every(ms, fn) { this.timers.add(setInterval(fn, ms)); }

  #batteryPayload() {
    // [count, deviceId 0x06, level | charging bit]
    return [0x01, 0x06, (this.state.battery & 0x7f) | (this.state.charging ? 0x80 : 0)];
  }

  #handle({ command, seq, payload }) {
    const s = this.state;
    const reply = (cmd, p = []) => this.#emitLater(encodeFrame(cmd, p, seq));
    // GET 0xC0xx -> reply 0x40xx with the same seq (S1, S2).
    // SET 0xF0xx -> ack 0x70xx with the same seq: GUESS from S2's 0x7040 / 0x7051 notifies. Capture will tell.
    const ack = () => reply((command & 0x0fff) | 0x7000);

    switch (command) {
      case OP.GET_BATTERY: return reply(IN.BATTERY_REPLY, this.#batteryPayload());
      case OP.GET_FIRMWARE: return reply(IN.FIRMWARE, [...s.firmware].map((c) => c.charCodeAt(0)));
      case OP.GET_ANC: return reply(IN.ANC_REPLY, [0x01, ANC_BYTES[s.noise], 0x00]);
      case OP.SET_ANC: {
        const name = Object.keys(ANC_BYTES).find((k) => ANC_BYTES[k] === payload[1]);
        if (name) s.noise = name;
        return ack();
      }
      case DOP.GET_MODEL: return reply(IN.MODEL, s.model);
      case DOP.GET_EQ: return reply(IN.EQ, [EQ_PRESETS.find((p) => p.id === s.eq).index]);
      case DOP.SET_EQ: {
        const p = EQ_PRESETS.find((x) => x.index === payload[0]);
        if (p) s.eq = p.id;
        return ack();
      }
      case DOP.GET_SPATIAL: return reply(IN.SPATIAL, SPATIAL_BYTES[s.spatial]);
      case DOP.SET_SPATIAL: {
        const m = Object.keys(SPATIAL_BYTES).find((k) => SPATIAL_BYTES[k][0] === payload[0]);
        if (m) s.spatial = m;
        return ack();
      }
      case DOP.GET_LOW_LAG: return reply(IN.LOW_LAG_REPLY, [s.lowLag ? LOW_LAG_BYTES.on : LOW_LAG_BYTES.off]);
      case DOP.SET_LOW_LAG: s.lowLag = payload[0] === LOW_LAG_BYTES.on; return ack();
      default: return; // unknown commands get no reply, like a real device would likely do
    }
  }

  #push(cmd, payload) { if (this.open) this.#emitLater(encodeFrame(cmd, payload, 0)); }

  // Reply after 40-140 ms and sometimes split the frame in two chunks, like a real serial stream.
  #emitLater(bytes) {
    setTimeout(() => {
      if (!this.open) return;
      if (Math.random() < 0.3 && bytes.length > 4) {
        const cut = Math.floor(rand(1, bytes.length - 1));
        this.dataCb(bytes.slice(0, cut));
        setTimeout(() => this.open && this.dataCb(bytes.slice(cut)), rand(5, 25));
      } else {
        this.dataCb(bytes);
      }
    }, rand(40, 140));
  }
}
