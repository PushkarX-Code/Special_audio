// Real headphones through the desktop app's private channel (src-tauri/src/rfcomm.rs).
// Same interface as the demo device: connect, disconnect, send, onData, onClose.
import { invoke, listen } from '../platform.js';

export class NativeHeadphones {
  kind = 'native';

  constructor({ name, address }) {
    this.name = name;
    this.address = address;
    this.dataCb = () => {};
    this.closeCb = () => {};
    this.unlisten = [];
  }

  onData(cb) { this.dataCb = cb; }
  onClose(cb) { this.closeCb = cb; }

  async connect() {
    this.#stopListening();
    this.unlisten.push(await listen('rfcomm-data', (bytes) => this.dataCb(Uint8Array.from(bytes))));
    this.unlisten.push(await listen('rfcomm-closed', (reason) => { this.#stopListening(); this.closeCb(reason); }));
    try {
      await invoke('rfcomm_connect', { address: this.address });
    } catch (e) {
      this.#stopListening();
      throw new Error(String(e));
    }
  }

  async disconnect() {
    this.#stopListening();
    await invoke('rfcomm_disconnect');
    this.closeCb('user');
  }

  send(bytes) { return invoke('rfcomm_send', { bytes: Array.from(bytes) }); }

  #stopListening() { this.unlisten.splice(0).forEach((off) => off()); }
}
