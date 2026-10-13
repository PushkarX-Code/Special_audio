// System EQ card: a 10-band graphic EQ for everything the computer plays, on any output device.
// Windows: applied through Equalizer APO, with a one-time setup walk-through. macOS: built in, it runs
// inside the app, so it starts again whenever the app does (src-tauri/src/pc_eq.rs, mac_eq.rs).
import { createEqEditor } from './eq-pro.js';
import { radioGroup, switchControl } from './controls.js';
import { invoke, prefs, isDesktop } from '../platform.js';

const $ = (id) => document.getElementById(id);
const FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const BANDS = FREQS.map((f) => ({ freq: f, label: f >= 1000 ? `${f / 1000}k` : String(f) }));
const APO_PAGE = 'https://sourceforge.net/projects/equalizerapo/';

export const PC_PRESETS = [
  { id: 'flat', label: 'Flat', g: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'bass', label: 'Bass boost', g: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'warm', label: 'Warm', g: [3, 3, 2, 1, 0, 0, -1, -1, -2, -2] },
  { id: 'vocal', label: 'Vocal', g: [-2, -1, 0, 1, 3, 4, 3, 1, 0, -1] },
  { id: 'bright', label: 'Bright', g: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  { id: 'loud', label: 'Loudness', g: [5, 4, 2, 0, -1, 0, 1, 3, 4, 4] },
  { id: 'night', label: 'Night', g: [-3, -2, -1, 0, 1, 1, 0, -1, -2, -3] },
];

export function createPcEq({ toast }) {
  const card = $('card-pceq');
  if (!isDesktop || !card) return { refreshColors() {}, select() {}, ready: false, current: () => null, subscribe() {} };
  let status = null;
  const state = prefs.get('pcEq', { enabled: false, bands: FREQS.map(() => 0) });
  const preampOf = (g) => -Math.max(0, ...g);
  const ready = () => !!(status?.installed && status?.writable);

  const editor = createEqEditor($('pc-eq'), {
    bands: BANDS, mode: 'graphic', range: 12, step: 0.5,
    onChange: (g, final) => { state.bands = g; syncLabels(); schedule(final ? 0 : 180); },
  });
  const sw = switchControl($('pc-switch'), (on) => { state.enabled = on; sw.set(on); syncLabels(); schedule(0); });
  const listeners = new Set();
  function select(id) {
    const p = PC_PRESETS.find((x) => x.id === id);
    if (!p || !ready()) return;
    useCurve(p.g);
  }
  function useCurve(g) {
    state.bands = g.slice(); editor.set(state.bands);
    if (!state.enabled) { state.enabled = true; sw.set(true); }
    syncLabels(); schedule(0);
  }
  const presets = radioGroup($('pc-presets'), select);

  // Saved curves: click to use, right-click to delete.
  const myList = () => prefs.get('pcMyPresets', []);
  function renderMine() {
    $('pc-my-presets').replaceChildren(...myList().map((p, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip small'; b.textContent = p.name; b.title = 'Right-click to delete';
      b.addEventListener('click', () => ready() && useCurve(p.g));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const list = myList(); list.splice(i, 1); prefs.set('pcMyPresets', list); renderMine(); toast(`Deleted "${p.name}"`);
      });
      return b;
    }));
  }
  $('pc-preset-save').addEventListener('click', () => {
    const name = $('pc-preset-name').value.trim();
    if (!name) { $('pc-preset-name').focus(); return; }
    const list = myList().filter((p) => p.name !== name);
    list.push({ name, g: state.bands.slice() });
    prefs.set('pcMyPresets', list.slice(-12));
    $('pc-preset-name').value = '';
    renderMine(); toast(`Saved "${name}"`);
  });
  renderMine();
  $('pc-presets').append(...PC_PRESETS.map((p) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip small'; b.setAttribute('role', 'radio'); b.dataset.value = p.id; b.textContent = p.label;
    return b;
  }));
  const devices = document.createElement('button');
  devices.type = 'button'; devices.className = 'chip small'; devices.textContent = 'Outputs';
  devices.title = 'Choose which outputs Equalizer APO works on';
  devices.hidden = true;
  devices.addEventListener('click', () => invoke('pc_eq_configure').then(refresh).catch((e) => toast(String(e))));
  $('pc-switch').before(devices);

  function syncLabels() {
    const match = PC_PRESETS.find((p) => p.g.every((v, i) => v === state.bands[i]));
    presets.set(match?.id ?? null);
    $('pc-preamp').textContent = state.enabled ? `Preamp ${preampOf(state.bands).toFixed(1)} dB` : 'Off';
    editor.setEnabled(state.enabled && ready());
    sw.setEnabled(ready());
    presets.setEnabled(ready());
    $('pc-preset-save').disabled = !ready();
    devices.hidden = !status?.configurable;
    prefs.set('pcEq', state);
    listeners.forEach((cb) => cb());
  }

  let timer = 0;
  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(apply, ms);
  }
  async function apply() {
    if (!ready()) return;
    try {
      await invoke('pc_eq_apply', { enabled: state.enabled, preamp: preampOf(state.bands), bands: state.bands });
    } catch (e) {
      if (String(e) === 'permission') { await refresh(); return; }
      if (state.enabled) { state.enabled = false; sw.set(false); syncLabels(); }
      toast(String(e));
    }
  }

  async function refresh() {
    status = await invoke('pc_eq_status').catch(() => null);
    card.hidden = !status?.supported;
    if (!status?.supported) return;
    const setup = $('pc-setup');
    setup.hidden = ready();
    if (!status.installed) {
      $('pc-setup-text').textContent = 'The system EQ runs on Equalizer APO, a free system-wide equaliser. Install it, tick your devices in the list it shows, then restart your PC.';
      $('pc-setup-btn').textContent = 'Get Equalizer APO';
      $('pc-setup-btn').onclick = () => invoke('open_url', { url: APO_PAGE });
    } else if (!status.writable) {
      $('pc-setup-text').textContent = 'One last step: let Special Audio save its curve for Equalizer APO. Windows asks for permission once.';
      $('pc-setup-btn').textContent = 'Allow';
      $('pc-setup-btn').onclick = () => invoke('pc_eq_allow').then(refresh).then(() => ready() && schedule(0)).catch((e) => toast(String(e)));
    }
    syncLabels();
  }

  editor.set(state.bands);
  sw.set(state.enabled);
  // macOS: the EQ runs inside the app, so turn it back on at launch
  refresh().then(() => { if (status?.live && state.enabled && ready()) schedule(0); });
  window.addEventListener('focus', () => { if (!ready()) refresh(); });
  return {
    refreshColors: () => editor.refreshColors(),
    select,
    get ready() { return ready(); },
    // the preset matching the current curve while the EQ is on, else null
    current() { return state.enabled ? PC_PRESETS.find((p) => p.g.every((v, i) => v === state.bands[i]))?.id ?? null : null; },
    subscribe(cb) { listeners.add(cb); },
  };
}
