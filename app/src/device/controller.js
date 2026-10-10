// Owns the device session and the app state. The UI reads state and calls these methods; it never sees bytes.
// Rule: the UI shows what the device confirmed. A tap may show optimistically for 400 ms, then snaps to the
// confirmed value (which updates again when the device's reply lands).
import { Session } from './session.js';
import { cmd, OP } from '../protocol/commands.js';
import { draftCmd, DOP } from '../protocol/drafts.js';
import { parseFrame, INCOMING_NAMES } from '../protocol/parser.js';
import { isAllowed } from '../protocol/guard.js';
import { toHex } from '../protocol/frame.js';

const OPTIMISTIC_MS = 400;
const SUPPORTED_MODEL = 'B175';
const LOG_LIMIT = 400;

const initialState = () => ({
  status: 'idle',          // idle | connecting | connected | reconnecting
  kind: null,              // demo | serial | native | system (OS-connected headphones, no control channel)
  deviceName: null,
  model: null,
  firmware: null,
  battery: null,           // {level, charging}
  anc: null,               // anc | transparency | off
  ancLevel: null,          // high | mid | low | adaptive
  eq: null,
  spatial: null,
  lowLag: null,
  customEq: [0, 0, 0],     // bass, mid, treble in dB
  features: { anc: false, eq: false, customEq: false, spatial: false, lowLag: false },
  readOnlyReason: null,
  error: null,
});

export class Controller {
  constructor() {
    this.state = initialState();
    this.pending = {};        // key -> optimistic value
    this.subs = new Set();
    this.log = [];
    this.logSubs = new Set();
    this.session = null;
    this.transport = null;
    this.reconnectTimer = null;
  }

  // ---- state plumbing ----
  subscribe(fn) { this.subs.add(fn); fn(this.view()); return () => this.subs.delete(fn); }
  view() { return { ...this.state, ...this.pending, pending: { ...this.pending } }; }
  #set(patch) { Object.assign(this.state, patch); this.#notify(); }
  #notify() { const v = this.view(); this.subs.forEach((fn) => fn(v)); }

  onLog(fn) { this.logSubs.add(fn); return () => this.logSubs.delete(fn); }
  #log(entry) {
    const e = { t: Date.now(), ...entry };
    this.log.push(e);
    if (this.log.length > LOG_LIMIT) this.log.shift();
    this.logSubs.forEach((fn) => fn(e));
  }

  // ---- connection ----
  async connect(transport) {
    clearTimeout(this.reconnectTimer);
    if (this.session) await this.disconnect();
    this.transport = transport;
    this.#set({ ...initialState(), status: 'connecting', kind: transport.kind, deviceName: transport.name ?? null });
    this.#attach(transport);
    try {
      await this.session.connect();
    } catch (err) {
      this.#detach();
      this.#set({ ...initialState(), error: err.message || String(err) });
      throw err;
    }
    this.#log({ dir: 'info', label: `connected (${transport.kind})` });
    this.#set({ status: 'connected', features: this.#features() });
    await this.#readAll();
  }

  async disconnect() {
    clearTimeout(this.reconnectTimer);
    const t = this.transport;
    this.transport = null; // marks the close as intentional
    this.#detach();
    this.pending = {};
    this.#set(initialState());
    if (t) await t.disconnect().catch(() => {});
  }

  #attach(transport) {
    const s = new Session(transport);
    s.on('tx', ({ name, bytes, attempt }) => this.#log({ dir: 'tx', label: name + (attempt ? ' (retry)' : ''), hex: toHex(bytes) }));
    s.on('frame', (f) => {
      const patch = parseFrame(f);
      this.#log({ dir: 'rx', label: INCOMING_NAMES[f.command] ?? `0x${f.command.toString(16).padStart(4, '0')}`, hex: toHex(f.raw) });
      if (patch) this.#apply(patch);
    });
    s.on('error', ({ message, bytes }) => this.#log({ dir: 'err', label: message, hex: bytes ? toHex(bytes) : '' }));
    s.on('close', (reason) => this.#onClose(reason));
    this.session = s;
  }

  #detach() { this.session = null; }

  #onClose(reason) {
    this.#detach();
    this.#log({ dir: 'info', label: `connection closed (${reason ?? 'unknown'})` });
    const transport = this.transport;
    if (!transport) return; // user asked for it
    this.pending = {};
    this.#set({ status: 'reconnecting', features: { anc: false, eq: false, customEq: false, spatial: false, lowLag: false } });
    this.#reconnect(transport, 0);
  }

  #reconnect(transport, attempt) {
    const delays = [800, 2000, 4000, 8000];
    if (attempt >= delays.length) {
      this.transport = null;
      this.#set({ ...initialState(), error: 'Lost the headphones. Check they are on and in range.' });
      return;
    }
    this.reconnectTimer = setTimeout(async () => {
      if (this.transport !== transport) return;
      try {
        this.#attach(transport);
        await this.session.connect();
        this.#log({ dir: 'info', label: 'reconnected' });
        this.#set({ status: 'connected', features: this.#features() });
        await this.#readAll();
      } catch {
        this.#detach();
        this.#reconnect(transport, attempt + 1);
      }
    }, delays[attempt]);
  }

  // Which controls can be written on this transport: real hardware gets CONFIRMED opcodes only.
  #features() {
    const allowDraft = this.transport?.kind === 'demo';
    if (this.state.readOnlyReason) return { anc: false, eq: false, customEq: false, spatial: false, lowLag: false };
    return {
      anc: isAllowed(OP.SET_ANC, { allowDraft }),
      eq: isAllowed(DOP.SET_EQ, { allowDraft }),
      spatial: isAllowed(DOP.SET_SPATIAL, { allowDraft }),
      lowLag: isAllowed(DOP.SET_LOW_LAG, { allowDraft }),
      // Custom EQ bytes are not confirmed for any source yet: demo device only.
      customEq: allowDraft,
    };
  }

  // Read everything we are allowed to read. Drafts are skipped on real hardware.
  async #readAll() {
    const allowDraft = this.transport?.kind === 'demo';
    const reads = [
      draftCmd.getModel(), cmd.getFirmware(), cmd.getBattery(), cmd.getAnc(),
      draftCmd.getEq(), draftCmd.getSpatial(), draftCmd.getLowLag(),
    ].filter((c) => isAllowed(c.command, { allowDraft }));
    for (const c of reads) {
      if (!this.session) return;
      await this.session.request(c).catch((e) => this.#log({ dir: 'err', label: e.message }));
    }
  }

  #apply(patch) {
    if (patch.model && patch.model !== SUPPORTED_MODEL) {
      this.#set({ model: patch.model, readOnlyReason: `Model ${patch.model} is not a CMF Headphone Pro. Controls are locked.` });
      this.#set({ features: this.#features() });
      return;
    }
    this.#set(patch);
  }

  // ---- controls ----
  // Optimistic for 400 ms, then show the confirmed state. After the SET is acknowledged, read the state
  // back so the UI reflects what the device actually did.
  async #write(keys, optimistic, setCmd, getCmd) {
    if (!this.session || this.state.status !== 'connected') return;
    Object.assign(this.pending, optimistic);
    this.#notify();
    const clear = () => { keys.forEach((k) => delete this.pending[k]); this.#notify(); };
    const timer = setTimeout(clear, OPTIMISTIC_MS);
    try {
      await this.session.request(setCmd);
      await this.session.request(getCmd);
    } catch (err) {
      this.#set({ error: `${err.message}` });
      setTimeout(() => this.state.error === err.message && this.#set({ error: null }), 3500);
    } finally {
      clearTimeout(timer);
      clear();
    }
  }

  setNoise(anc, level = this.state.ancLevel ?? 'high') {
    if (!this.state.features.anc) return;
    const byteName = anc === 'anc' ? level : anc;
    const optimistic = anc === 'anc' ? { anc, ancLevel: level } : { anc };
    return this.#write(['anc', 'ancLevel'], optimistic, cmd.setAnc(byteName), cmd.getAnc());
  }
  setEq(id) {
    if (!this.state.features.eq) return;
    return this.#write(['eq'], { eq: id }, draftCmd.setEq(id), draftCmd.getEq());
  }
  setSpatial(mode) {
    if (!this.state.features.spatial) return;
    return this.#write(['spatial'], { spatial: mode }, draftCmd.setSpatial(mode), draftCmd.getSpatial());
  }
  setLowLag(on) {
    if (!this.state.features.lowLag) return;
    return this.#write(['lowLag'], { lowLag: on }, draftCmd.setLowLag(on), draftCmd.getLowLag());
  }
  // Demo device only for now: the custom EQ command is not confirmed (see docs/protocol-research.md).
  setCustomEq(bands) {
    if (!this.state.features.customEq) return;
    this.#set({ customEq: bands.map(Number), eq: 'custom' });
  }

  // Headphones the operating system has connected (any brand). Used when no control session is open.
  setSystemDevice(dev) {
    if (this.session) return;
    if (!dev) {
      if (this.state.kind === 'system') this.#set(initialState());
      return;
    }
    const battery = dev.battery == null ? null : { level: dev.battery, charging: false };
    const same = this.state.kind === 'system' && this.state.deviceName === dev.name && this.state.battery?.level === battery?.level;
    if (!same) this.#set({ ...initialState(), status: 'connected', kind: 'system', deviceName: dev.name, battery });
  }

  refreshBattery() { return this.session?.request(cmd.getBattery()).catch(() => {}); }
}
