// PC equaliser card (Windows): a 10-band graphic EQ for everything the computer plays, applied through
// Equalizer APO (src-tauri/src/pc_eq.rs). Walks the user through the one-time setup when needed.
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
  if (!isDesktop || !card) return { refreshColors() {} };
  let status = null;
  const state = prefs.get('pcEq', { enabled: false, bands: FREQS.map(() => 0) });
  const preampOf = (g) => -Math.max(0, ...g);
  const ready = () => !!(status?.installed && status?.writable);

  const editor = createEqEditor($('pc-eq'), {
    bands: BANDS, mode: 'graphic', range: 12, step: 0.5,
    onChange: (g, final) => { state.bands = g; syncLabels(); schedule(final ? 0 : 180); },
  });
  const sw = switchControl($('pc-switch'), (on) => { state.enabled = on; sw.set(on); syncLabels(); schedule(0); });
  const presets = radioGroup($('pc-presets'), (id) => {
    const p = PC_PRESETS.find((x) => x.id === id);
    if (!p) return;
    state.bands = p.g.slice(); editor.set(state.bands);
    if (!state.enabled) { state.enabled = true; sw.set(true); }
    syncLabels(); schedule(0);
  });
  $('pc-presets').append(...PC_PRESETS.map((p) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip small'; b.setAttribute('role', 'radio'); b.dataset.value = p.id; b.textContent = p.label;
    return b;
  }));
  const devices = document.createElement('button');
  devices.type = 'button'; devices.className = 'chip small'; devices.textContent = 'Outputs';
  devices.title = 'Choose which outputs Equalizer APO works on';
  devices.addEventListener('click', () => invoke('pc_eq_configure').then(refresh).catch((e) => toast(String(e))));
  $('pc-switch').before(devices);

  function syncLabels() {
    const match = PC_PRESETS.find((p) => p.g.every((v, i) => v === state.bands[i]));
    presets.set(match?.id ?? null);
    $('pc-preamp').textContent = state.enabled ? `Preamp ${preampOf(state.bands).toFixed(1)} dB` : 'Off';
    editor.setEnabled(state.enabled && ready());
    sw.setEnabled(ready());
    presets.setEnabled(ready());
    devices.hidden = !status?.installed;
    prefs.set('pcEq', state);
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
      toast(`PC equaliser: ${e}`);
    }
  }

  async function refresh() {
    status = await invoke('pc_eq_status').catch(() => null);
    card.hidden = !status?.supported;
    if (!status?.supported) return;
    const setup = $('pc-setup');
    setup.hidden = ready();
    if (!status.installed) {
      $('pc-setup-text').textContent = 'The PC equaliser runs on Equalizer APO, a free system-wide equaliser. Install it, tick your headphones in the list it shows, then restart your PC.';
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
  refresh();
  window.addEventListener('focus', () => { if (!ready()) refresh(); });
  return { refreshColors: () => editor.refreshColors() };
}
