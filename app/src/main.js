// App entry: wires the controller (device state) to the tabbed UI, the menu bar panel and the desktop shell.
import { Controller } from './device/controller.js';
import { MockHeadphones } from './device/mock.js';
import { NativeHeadphones } from './device/native.js';
import { createMusicBar } from './ui/music.js';
import { readLook, applyLook, saveLook } from './ui/look.js';
import { EQ_PRESETS, DOP, CUSTOM_EQ_RANGE, CONTROL_SLOTS, CONTROL_ACTIONS, SLOT_ACTIONS } from './protocol/drafts.js';
import { createHero } from './ui/hero.js';
import { createLevels } from './ui/levels.js';
import { createMusicViz } from './ui/music-viz.js';
import { createBackground } from './ui/background.js';
import { createEqVisual } from './ui/eq-visual.js';
import { radioGroup, switchControl, dotRipple } from './ui/controls.js';
import { createUpdates } from './ui/updates.js';
import { addIcons } from './ui/icons.js';
import { createEqEditor } from './ui/eq-pro.js';
import { createPcEq } from './ui/pc-eq.js';
import { isDesktop, invoke, emit, listen, watchSystemHeadphones, prefs } from './platform.js';

const $ = (id) => document.getElementById(id);
const app = document.querySelector('.app');
const controller = new Controller();
document.documentElement.dataset.platform = isDesktop ? 'desktop' : 'web';

// ---- visuals ----
const sound = createLevels();
const hero = createHero($('hero-canvas'), sound);
const musicViz = createMusicViz($('music-viz'), sound);
const background = createBackground($('grid'));
const eqVisual = createEqVisual($('eq-canvas'));
const refreshColors = () => requestAnimationFrame(() => [hero, background, eqVisual, musicViz, hpEq, pcEq].forEach((v) => v.refreshColors()));

// ---- tabs ----
const tabs = [...document.querySelectorAll('.tab')];
// Tab switch: the highlight slides to the new tab, the view's cards rise in one after another.
const tabPill = document.querySelector('.tab-pill');
function moveTabPill() {
  const t = tabs.find((x) => x.getAttribute('aria-selected') === 'true');
  if (!t || !tabPill) return;
  tabPill.style.width = `${t.offsetWidth}px`; tabPill.style.height = `${t.offsetHeight}px`;
  tabPill.style.transform = `translate(${t.offsetLeft}px, ${t.offsetTop}px)`;
}
window.addEventListener('resize', moveTabPill);
document.fonts?.ready.then(() => { moveTabPill(); requestAnimationFrame(() => tabPill?.classList.add('ready')); });
function showView(name) {
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.view === name));
  moveTabPill();
  for (const v of document.querySelectorAll('.view')) {
    const show = v.id === `view-${name}`;
    if (show && v.hidden) {
      v.classList.remove('entering');
      void v.offsetWidth; // restart the animation
      v.querySelectorAll('.view-title, .card').forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, 8))));
      v.classList.add('entering');
    }
    v.hidden = !show;
  }
  prefs.set('view', name);
  if (name === 'sound') requestAnimationFrame(() => eqVisual.set(lastEqKey, controller.state.status === 'connected'));
}
tabs.forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  const i = tabs.indexOf(document.activeElement);
  if (i < 0 || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  const next = tabs[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
  next.focus();
  showView(next.dataset.view);
});
document.addEventListener('click', (e) => { const go = e.target.closest('[data-goto]'); if (go) showView(go.dataset.goto); });

// ---- toast ----
let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.dataset.show = 'false'), 3200);
}
document.addEventListener('toast', (e) => toast(e.detail));

// ---- Look: theme + animation ----
const storedRaw = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const storeRaw = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const theme = radioGroup($('theme-chips'), (v) => applyTheme(v));
function applyTheme(v) {
  if (v === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = v;
  storeRaw('theme', v === 'system' ? null : v);
  theme.set(v);
  refreshColors();
  emit('sa-look', { theme: v, ...readLook() });
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshColors);
theme.set(document.documentElement.dataset.theme ?? 'system');

const motion = radioGroup($('motion-chips'), (v) => {
  if (v === 'reduced') document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;
  storeRaw('motion', v === 'reduced' ? 'reduced' : null);
  motion.set(v);
});
motion.set(document.documentElement.dataset.motion === 'reduced' ? 'reduced' : 'full');

// Accent colour, dot shape and glass style. Shared with the menu bar panel.
const look = readLook();
applyLook(look);
for (const [key, id] of [['dots', 'dots-chips'], ['glass', 'glass-chips']]) {
  const group = radioGroup($(id), (v) => {
    look[key] = v; saveLook(key, v); applyLook(look); group.set(v); refreshColors();
    emit('sa-look', { theme: document.documentElement.dataset.theme ?? 'system', ...look });
  });
  group.set(look[key]);
}
refreshColors();

// Visualizer on/off (this computer only)
const viz = radioGroup($('viz-chips'), (v) => setViz(v));
function setViz(v) {
  prefs.set('viz', v); viz.set(v);
  document.documentElement.dataset.viz = v;
  sound.setEnabled(v === 'on'); hero.wake(); musicViz.wake();
}
setViz(prefs.get('viz', 'on'));

// ---- connection ----
// ?preview: a simulated headphone, used to make the README screenshots. Not reachable from the app.
if (new URLSearchParams(location.search).has('preview')) setTimeout(() => controller.connect(new MockHeadphones()).catch(() => {}), 300);
$('bt-btn').addEventListener('click', () => invoke('open_bluetooth_settings'));
if (!isDesktop) $('bt-btn').hidden = true;

// Headphones connected in the OS (any brand).
// CMF Headphone Pro: open the private control channel automatically (desktop app).
const CMF = /CMF Headphone Pro/i;
let systemDevice = null;
let controlError = null;
let opening = false; // while the control channel opens, its errors show under the ring, not as a toast
const resync = () => controller.setSystemDevice(systemDevice);
async function openControls(dev) {
  if (!isDesktop || !dev?.address || !CMF.test(dev.name) || controller.session) return;
  controlError = null;
  opening = true;
  try {
    await controller.connect(new NativeHeadphones(dev));
  } catch (e) {
    controlError = e.message;
    resync();
  } finally {
    opening = false;
  }
}
watchSystemHeadphones((dev) => {
  const previous = systemDevice;
  systemDevice = dev;
  if (!dev && controller.state.kind === 'native') { controller.disconnect().then(resync); return; }
  resync();
  if (dev && dev.address !== previous?.address && controller.state.kind !== 'demo') openControls(dev);
});
$('retry-btn').addEventListener('click', () => openControls(systemDevice));
createMusicBar($('music'), 2000, (playing) => { sound.setPlaying(playing); hero.wake(); musicViz.wake(); });
$('contact-btn').addEventListener('click', () => {
  if (isDesktop) invoke('contact');
  else location.href = `mailto:${['email.puskar', 'gmail.com'].join('@')}?subject=Special%20Audio`;
});

// Notification when headphones connect (real devices only, not the simulated one).
let notifiedFor = null;
controller.subscribe((s) => {
  const name = s.status === 'connected' && s.kind !== 'demo' ? s.deviceName : null;
  if (name && name !== notifiedFor && prefs.get('notify', true)) {
    invoke('notify', { title: `${name} connected`, body: s.battery ? `Battery ${s.battery.level}%` : 'Ready to use' });
  }
  notifiedFor = name;
});

// ---- controls ----
const noise = radioGroup($('noise-seg'), (v) => controller.setNoise(v));
const levels = radioGroup($('anc-levels'), (v) => controller.setNoise('anc', v));
const spatial = radioGroup($('spatial-chips'), (v, btn) => { dotRipple(btn); controller.setSpatial(v); });

const presetChip = (p) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'radio'); b.dataset.value = p.id; b.dataset.icon = p.id === 'custom' ? 'sliders' : p.id; b.textContent = p.label;
  return b;
};
const CUSTOM_CHIP = { id: 'custom', label: 'Custom' };
$('eq-chips').append(...[...EQ_PRESETS, CUSTOM_CHIP].map(presetChip));
$('quick-eq').append(...[...EQ_PRESETS, CUSTOM_CHIP].map(presetChip));
addIcons();

// Noise control (i): what each mode does
$('noise-info-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = $('noise-info').hidden;
  $('noise-info').hidden = !open;
  $('noise-info-btn').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => {
  if (!$('noise-info').hidden && !e.target.closest('#noise-info')) { $('noise-info').hidden = true; $('noise-info-btn').setAttribute('aria-expanded', 'false'); }
});
const pickEq = (v) => (v === 'custom' ? controller.setCustomEq(hpEq.get()) : controller.setEq(v));
const eq = radioGroup($('eq-chips'), pickEq);
const quickEq = radioGroup($('quick-eq'), pickEq);
const lowLag = switchControl($('lowlag-switch'), (on) => controller.setLowLag(on));
const codec = radioGroup($('codec-chips'), (v) => {
  if (v === controller.state.codec) return;
  controller.setCodec(v);
  toast(`Switching to ${v.toUpperCase()}. Your headphones restart and reconnect.`);
});
const controlGroups = {};
$('control-rows').append(...CONTROL_SLOTS.map((slot) => {
  const row = document.createElement('div');
  row.className = 'control-row';
  const label = document.createElement('span'); label.className = 'label'; label.textContent = slot.label;
  const chips = document.createElement('div');
  chips.className = 'chips grid-chips'; chips.setAttribute('role', 'radiogroup'); chips.setAttribute('aria-label', slot.label);
  chips.append(...SLOT_ACTIONS[slot.id].map((a) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip small'; b.setAttribute('role', 'radio'); b.dataset.value = a; b.textContent = CONTROL_ACTIONS[a].label;
    return b;
  }));
  controlGroups[slot.id] = radioGroup(chips, (a) => controller.setControl(slot.id, a));
  row.append(label, chips);
  return row;
}));

// Custom EQ on the headphones: graph editor + precise cells, Compare (hear it flat), Flat, saved presets.
const fmt = (v) => (v > 0 ? `+${v}` : String(v));
const hpEq = createEqEditor($('hp-eq'), {
  bands: [
    { label: 'Bass', freq: 140, type: 'low', q: 0.8 },
    { label: 'Mid', freq: 980, type: 'peak', q: 0.7 },
    { label: 'Treble', freq: 3500, type: 'high', q: 1.0 },
  ],
  range: CUSTOM_EQ_RANGE, step: 0.5,
  onChange: (g, final) => {
    eqVisual.set(g, true);
    clearTimeout(hpTimer);
    hpDirty = true;
    hpTimer = setTimeout(() => { hpDirty = false; controller.setCustomEq(g); }, final ? 0 : 140);
  },
});
let hpTimer = 0, hpDirty = false;
let comparing = false;
$('hp-reset').addEventListener('click', () => { hpEq.set([0, 0, 0]); controller.setCustomEq([0, 0, 0]); });
$('hp-compare').addEventListener('click', () => {
  comparing = !comparing;
  $('hp-compare').setAttribute('aria-pressed', String(comparing));
  $('hp-compare').textContent = comparing ? 'Back to yours' : 'Compare';
  controller.setCustomEq(comparing ? [0, 0, 0] : savedForCompare);
  hpEq.setEnabled(!comparing);
});
let savedForCompare = [0, 0, 0];
function renderMyPresets() {
  const list = prefs.get('myPresets', []);
  $('my-presets').replaceChildren(...list.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip small'; b.textContent = p.name; b.title = `Bass ${fmt(p.bands[0])}, Mid ${fmt(p.bands[1])}, Treble ${fmt(p.bands[2])}. Right-click to delete.`;
    b.addEventListener('click', () => { hpEq.set(p.bands); controller.setCustomEq(p.bands); });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); list.splice(i, 1); prefs.set('myPresets', list); renderMyPresets(); toast(`Deleted "${p.name}"`); });
    return b;
  }));
}
$('preset-save').addEventListener('click', () => {
  const name = $('preset-name').value.trim();
  if (!name) { $('preset-name').focus(); return; }
  const list = prefs.get('myPresets', []).filter((p) => p.name !== name);
  list.push({ name, bands: hpEq.get() });
  prefs.set('myPresets', list.slice(-12));
  $('preset-name').value = '';
  renderMyPresets();
  toast(`Saved "${name}"`);
});
renderMyPresets();

// PC equaliser (Windows, Equalizer APO)
const pcEq = createPcEq({ toast });
document.addEventListener('click', (e) => { const url = e.target.closest('[data-open]')?.dataset.open; if (url) invoke('open_url', { url }); });

// ---- settings ----
// Full headphone control: EQ, custom EQ, spatial audio and low lag (draft commands). On by default.
controller.eqSetOp = prefs.get('eqSetOp', DOP.SET_EQ);
controller.onEqOpLearned = (op) => prefs.set('eqSetOp', op);
const exp = switchControl($('exp-switch'), (on) => setExperimental(on));
function setExperimental(on) {
  prefs.set('fullControl', on); exp.set(on); controller.setExperimental(on);
}
exp.set(prefs.get('fullControl', true));
controller.setExperimental(prefs.get('fullControl', true));
// Locked cards get a one-click unlock instead of sending people to Settings.
for (const card of document.querySelectorAll('.card[data-feature]')) {
  if (card.dataset.feature === 'anc') continue;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'pill small unlock-btn';
  b.textContent = 'Turn on';
  b.addEventListener('click', () => setExperimental(true));
  card.append(b);
}
// Reset all: app settings back to defaults, and the headphones' sound (EQ, custom EQ, spatial audio, low lag).
// Saved presets stay. Button actions and noise control are left as they are; nothing is factory reset.
const resetBtn = $('reset-btn');
let resetArmed = 0;
resetBtn.addEventListener('click', async () => {
  if (Date.now() - resetArmed > 4000) {
    resetArmed = Date.now(); resetBtn.textContent = 'Click again';
    setTimeout(() => { if (Date.now() - resetArmed >= 4000) resetBtn.textContent = 'Reset all'; }, 4000);
    return;
  }
  resetBtn.disabled = true; resetBtn.textContent = 'Resetting';
  const s = controller.state;
  if (s.status === 'connected') {
    if (s.features.customEq) await controller.setCustomEq([0, 0, 0]);
    if (s.features.eq) await controller.setEq(EQ_PRESETS[0].id);
    if (s.features.spatial) await controller.setSpatial('off');
    if (s.features.lowLag) await controller.setLowLag(false);
  }
  if (prefs.get('pcEq', null)?.enabled) await invoke('pc_eq_apply', { enabled: false, preamp: 0, bands: Array(10).fill(0) }).catch(() => {});
  if (isDesktop) await invoke('autostart_set', { on: false }).catch(() => {});
  try {
    for (const k of Object.keys(localStorage)) if (k !== 'eqSetOp' && !/presets/i.test(k)) localStorage.removeItem(k);
  } catch {}
  location.reload();
});
const notif = switchControl($('notif-switch'), (on) => { prefs.set('notify', on); notif.set(on); });
notif.set(prefs.get('notify', true));
const login = switchControl($('login-switch'), async (on) => {
  try { await invoke('autostart_set', { on }); login.set(on); } catch { toast('Could not change start at login'); }
});
if (isDesktop) {
  invoke('autostart_get').then((on) => login.set(!!on));
} else {
  document.querySelectorAll('.card[data-desktop]').forEach((el) => (el.hidden = true));
}


// ---- updates ----
createUpdates({ toast });
const autoUpd = switchControl($('autoupd-switch'), (on) => { prefs.set('autoUpdate', on); autoUpd.set(on); });
autoUpd.set(prefs.get('autoUpdate', true));

// ---- menu bar / tray panel bridge ----
// The panel is a separate window. It receives state from here and sends commands back.
const COMMANDS = {
  noise: (v) => controller.setNoise(v),
  level: (v) => controller.setNoise('anc', v),
  eq: (v) => controller.setEq(v),
  spatial: (v) => controller.setSpatial(v),
  lowLag: (v) => controller.setLowLag(v),
};
listen('sa-command', ({ type, value }) => COMMANDS[type]?.(value));
listen('sa-hello', () => emit('sa-state', publicState(controller.view())));
const publicState = (s) => ({
  status: s.status, kind: s.kind, deviceName: s.deviceName, battery: s.battery,
  anc: s.anc, ancLevel: s.ancLevel, eq: s.eq, spatial: s.spatial, lowLag: s.lowLag, features: s.features,
});

// ---- render ----
const STATUS_TEXT = { idle: 'Not connected', connecting: 'Connecting', reconnecting: 'Reconnecting', connected: 'Connected' };
let lastError = null;
let lastEqKey;

controller.subscribe((s) => {
  emit('sa-state', publicState(s));
  const connected = s.status === 'connected';
  const busy = s.status === 'connecting' || s.status === 'reconnecting';
  const controllable = connected && s.kind !== 'system';
  app.dataset.status = s.status;
  app.dataset.controllable = String(controllable);

  $('status-text').textContent = STATUS_TEXT[s.status];
  $('device-name').textContent = s.status === 'idle' ? 'No headphones' : s.deviceName ?? 'Headphones';

  // hero: real battery when the headphones report it, otherwise "Connected"
  hero.setMode(connected ? 'connected' : busy ? 'connecting' : 'idle');
  hero.setBattery(connected && s.battery ? s.battery.level : connected ? -1 : null);
  hero.setNoise(controllable ? s.anc : null);
  const hasBattery = connected && !!s.battery;
  $('pct').textContent = hasBattery ? String(s.battery.level) : '';
  $('pct-unit').hidden = !hasBattery;
  $('side-status').textContent = connected ? 'Connected' : busy ? 'Connecting' : 'Offline';
  $('pct-label').textContent = busy ? STATUS_TEXT[s.status] : !connected ? 'Offline' : hasBattery && s.battery.charging ? 'Charging' : '';
  app.dataset.low = String(hasBattery && s.battery.level <= 20);
  app.dataset.nobattery = String(connected && !hasBattery);

  $('idle-row').hidden = s.status !== 'idle';
  const isCmf = CMF.test(s.deviceName ?? '');
  const systemHint = s.kind !== 'system' ? ''
    : !isCmf ? 'Full controls are available for the CMF Headphone Pro.'
      : !isDesktop ? '' : controlError ? `Couldn't open the controls. ${controlError}` : 'Opening the headphone controls…';
  $('hint').textContent = s.readOnlyReason
    ?? (s.status === 'idle' ? (isDesktop ? 'Turn your headphones on and connect them in Bluetooth settings.' : 'Download the desktop app to connect your headphones.') : systemHint);
  $('retry-btn').hidden = !(s.kind === 'system' && isCmf && controlError);

  // Sound / Hi-Fi notice for headphones without a control channel
  const notice = !connected ? 'Connect your headphones to use these controls.'
    : s.kind !== 'system' ? ''
      : isCmf ? 'Connecting to the headphone controls. Check the Home tab if this stays.'
        : 'Full controls are available for the CMF Headphone Pro.';
  document.querySelectorAll('[data-notice]').forEach((el) => { el.textContent = notice; el.hidden = !notice; });

  // controls show confirmed state (or a <400 ms optimistic value from the controller)
  noise.set(controllable ? s.anc : null);
  noise.setEnabled(controllable && s.features.anc);
  levels.set(controllable && s.anc === 'anc' ? s.ancLevel : null);
  levels.setEnabled(controllable && s.features.anc);
  $('anc-levels').dataset.open = String(controllable && s.anc === 'anc');

  spatial.set(controllable ? s.spatial : null);
  spatial.setEnabled(controllable && s.features.spatial);

  eq.set(controllable ? s.eq : null);
  eq.setEnabled(controllable && s.features.eq);
  quickEq.set(controllable ? s.eq : null);
  quickEq.setEnabled(controllable && s.features.eq);
  const eqKey = !controllable ? null : s.eq === 'custom' ? s.customEq : s.eq;
  if (JSON.stringify(eqKey) !== JSON.stringify(lastEqKey)) { eqVisual.set(eqKey, controllable); lastEqKey = eqKey; }
  const customOn = controllable && s.features.customEq;
  hpEq.setEnabled(customOn && !comparing);
  if (!comparing && !hpDirty && !s.pending.customEq) { hpEq.set(s.customEq); savedForCompare = s.customEq.slice(); }
  $('hp-reset').disabled = !customOn; $('hp-compare').disabled = !customOn;
  $('preset-save').disabled = !(controllable && s.features.customEq);

  codec.set(controllable ? s.codec : null);
  codec.setEnabled(controllable && s.features.codec);
  for (const [slot, g] of Object.entries(controlGroups)) {
    g.set(controllable ? s.controls?.[slot] ?? null : null);
    g.setEnabled(controllable && s.features.controls);
  }
  lowLag.set(controllable && s.lowLag);
  lowLag.setEnabled(controllable && s.features.lowLag);

  for (const card of document.querySelectorAll('.card[data-feature]')) {
    card.dataset.locked = String(controllable && !s.features[card.dataset.feature]);
    card.dataset.unavailable = String(!controllable);
  }

  const details = [
    ['Name', s.deviceName ?? '-'],
    ['Model', s.model ?? (CMF.test(s.deviceName ?? '') ? 'B175' : '-')],
    ['Firmware', s.firmware ?? '-'],
    ['Codec', s.codec ? s.codec.toUpperCase() : '-'],
    ['Battery', hasBattery ? `${s.battery.level}%` : '-'],
    ['Connection', s.kind === 'system' ? 'Bluetooth (audio only)' : connected ? 'Bluetooth (full control)' : '-'],
  ];
  $('device-details').replaceChildren(...details.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));

  // connection errors are already shown under the ring; toast everything else once
  if (s.error && s.error !== lastError && !opening && s.error !== controlError) toast(s.error);
  lastError = s.error;
});

showView(prefs.get('view', 'home'));
