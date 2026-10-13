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
const NO_FEATURES = { anc: false, eq: false, customEq: false, spatial: false, lowLag: false, codec: false, controls: false };
const SUPPORTED_MODEL = 'B175';
const LOG_LIMIT = 400;

const initialState = () => ({
  status: 'idle',          // idle | connecting | connected | reconnecting
  kind: null,              // demo | serial | native | system (a device the OS has connected, no control channel)
  deviceKind: null,        // headphones, speaker, sound output, … (system devices)
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
  codec: null,             // aac | ldac
  controls: {},            // slot id -> action id (see CONTROL_SLOTS)
  features: { ...NO_FEATURES },
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
    this.experimental = false; // Settings → Experimental controls: draft commands on real hardware
    this.eqSetOp = DOP.SET_EQ;  // which EQ SET opcode works on this headphone (learned, see setEq)
    this.onEqOpLearned = null;
  }

  // Draft commands: always for the demo device; for real headphones only with Experimental controls on.
  #allowDraft() { return this.transport?.kind === 'demo' || (this.experimental && !!this.transport); }

  async setExperimental(on) {
    this.experimental = !!on;
    if (this.session) this.session.allowDraft = this.#allowDraft();
    if (this.state.status !== 'connected' || !this.session) return;
    this.#set({ features: this.#features() });
    if (on) await this.#readAll();
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
    s.allowDraft = this.#allowDraft();
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
    this.#set({ status: 'reconnecting', features: { ...NO_FEATURES } });
    this.#reconnect(transport, 0);
  }

  #reconnect(transport, attempt) {
    const delays = [800, 2000, 4000, 8000];
    if (attempt >= delays.length) {
      this.transport = null;
      this.#set({ ...initialState(), error: 'Lost the connection. Check the device is on and in range.' });
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
    const allowDraft = this.#allowDraft();
    if (this.state.readOnlyReason) return { ...NO_FEATURES };
    return {
      anc: isAllowed(OP.SET_ANC, { allowDraft }),
      eq: isAllowed(DOP.SET_EQ, { allowDraft }),
      spatial: isAllowed(DOP.SET_SPATIAL, { allowDraft }),
      lowLag: isAllowed(DOP.SET_LOW_LAG, { allowDraft }),
      customEq: isAllowed(DOP.SET_CUSTOM_EQ, { allowDraft }),
      codec: isAllowed(DOP.SET_CODEC, { allowDraft }),
      controls: isAllowed(DOP.SET_CONTROL, { allowDraft }),
    };
  }

  // Read everything we are allowed to read. Drafts are skipped on real hardware unless Experimental is on.
  async #readAll() {
    const allowDraft = this.#allowDraft();
    // The model reply format is unverified: a misread would lock every control, so real headphones skip it
    // (they are only opened when the OS reports the name "CMF Headphone Pro").
    const demo = this.transport?.kind === 'demo';
    const reads = [
      ...(demo ? [draftCmd.getModel()] : []), cmd.getFirmware(), cmd.getBattery(), cmd.getAnc(),
      draftCmd.getEq(), draftCmd.getCustomEq(), draftCmd.getSpatial(), draftCmd.getLowLag(),
      draftCmd.getCodec(), draftCmd.getControls(),
    ].filter((c) => isAllowed(c.command, { allowDraft }));
    for (const c of reads) {
      if (!this.session) return;
      await this.session.request(c).catch((e) => this.#log({ dir: 'err', label: e.message }));
    }
  }

  #apply(patch) {
    if (patch.model && patch.model !== SUPPORTED_MODEL) {
      this.#set({ model: patch.model, readOnlyReason: `This model's settings can't be changed here yet. Battery, details and the system EQ still work.` });
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
      // Some devices may not acknowledge a SET; the read-back below is what confirms it.
      await this.session.request(setCmd).catch((e) => this.#log({ dir: 'err', label: e.message }));
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
  // The two sources disagree on the EQ SET opcode. On real headphones: send the one that worked last time;
  // if the read-back doesn't show the new preset, try the other one once and remember it if it works.
  async setEq(id) {
    if (!this.state.features.eq) return;
    const real = this.transport?.kind !== 'demo';
    const ops = real ? [this.eqSetOp, this.eqSetOp === DOP.SET_EQ ? DOP.SET_EQ_ALT : DOP.SET_EQ] : [DOP.SET_EQ];
    for (const op of ops) {
      await this.#write(['eq'], { eq: id }, draftCmd.setEq(id, op), draftCmd.getEq());
      if (this.state.eq === id) {
        if (op !== this.eqSetOp) { this.eqSetOp = op; this.onEqOpLearned?.(op); }
        return;
      }
      if (!this.session) return;
    }
    if (real && this.session) this.#flash("The headphones didn't switch preset. This EQ command may not work on them yet.");
  }

  #flash(message) {
    this.#set({ error: message });
    setTimeout(() => this.state.error === message && this.#set({ error: null }), 3500);
  }
  setSpatial(mode) {
    if (!this.state.features.spatial) return;
    return this.#write(['spatial'], { spatial: mode }, draftCmd.setSpatial(mode), draftCmd.getSpatial());
  }
  setLowLag(on) {
    if (!this.state.features.lowLag) return;
    return this.#write(['lowLag'], { lowLag: on }, draftCmd.setLowLag(on), draftCmd.getLowLag());
  }
  // Bass / Mid / Treble in dB. Selects the custom slot, sends the bands, then reads them back.
  // While a write is in flight, newer values replace older ones, so dragging a slider never queues up.
  async setCustomEq(bands) {
    if (!this.state.features.customEq || !this.session || this.state.status !== 'connected') return;
    this.customQueued = bands.map(Number);
    this.pending.customEq = this.customQueued; this.pending.eq = 'custom'; this.#notify();
    if (this.customBusy) return;
    this.customBusy = true;
    try {
      while (this.customQueued && this.session) {
        const b = this.customQueued;
        this.customQueued = null;
        const log = (e) => this.#log({ dir: 'err', label: e.message });
        if (this.state.eq !== 'custom') await this.session.request(draftCmd.selectCustom(this.eqSetOp)).catch(log);
        await this.session.request(draftCmd.setCustomEq(b)).catch(log);
        if (!this.customQueued) {
          await this.session.request(draftCmd.getCustomEq()).catch(log);
          await this.session.request(draftCmd.getEq()).catch(log);
        }
      }
    } finally {
      this.customBusy = false;
      delete this.pending.customEq; delete this.pending.eq;
      this.#notify();
    }
  }

  // The headphones restart to switch codec; the reconnect reads the new value back.
  async setCodec(name) {
    if (!this.state.features.codec || !this.session || this.state.codec === name) return;
    this.#set({ codec: name });
    await this.session.request(draftCmd.setCodec(name)).catch((e) => this.#log({ dir: 'err', label: e.message }));
  }
  setControl(slot, action) {
    if (!this.state.features.controls) return;
    return this.#write(['controls'], { controls: { ...this.state.controls, [slot]: action } }, draftCmd.setControl(slot, action), draftCmd.getControls());
  }

  // Headphones the operating system has connected (any brand). Used when no control session is open.
  setSystemDevice(dev) {
    if (this.session) return;
    if (!dev) {
      if (this.state.kind === 'system') this.#set(initialState());
      return;
    }
    const battery = dev.battery == null ? null : { level: dev.battery, charging: false };
    const same = this.state.kind === 'system' && this.state.deviceName === dev.name && this.state.battery?.level === battery?.level
      && this.state.deviceKind === (dev.kind ?? null);
    if (!same) this.#set({ ...initialState(), status: 'connected', kind: 'system', deviceName: dev.name, deviceKind: dev.kind ?? null, battery });
  }

  refreshBattery() { return this.session?.request(cmd.getBattery()).catch(() => {}); }
}
