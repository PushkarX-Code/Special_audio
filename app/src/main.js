// App entry: wires the controller (device state) to the tabbed UI, the menu bar panel and the desktop shell.
import { Controller } from './device/controller.js';
import { MockHeadphones } from './device/mock.js';
import { NativeHeadphones } from './device/native.js';
import { createMusicBar } from './ui/music.js';
import { ACCENTS, readLook, applyLook, saveLook } from './ui/look.js';
import { EQ_PRESETS, DOP } from './protocol/drafts.js';
import { createHero } from './ui/hero.js';
import { createLevels } from './ui/levels.js';
import { createMusicViz } from './ui/music-viz.js';
import { createBackground } from './ui/background.js';
import { createEqVisual } from './ui/eq-visual.js';
import { radioGroup, switchControl, dotRipple } from './ui/controls.js';
import { createDevPanel } from './ui/devpanel.js';
import { createUpdates } from './ui/updates.js';
import { isDesktop, invoke, emit, listen, watchSystemHeadphones, prefs } from './platform.js';

const $ = (id) => document.getElementById(id);
const app = document.querySelector('.app');
const controller = new Controller();
let mock = null;
document.documentElement.dataset.platform = isDesktop ? 'desktop' : 'web';

// ---- visuals ----
const sound = createLevels();
const hero = createHero($('hero-canvas'), sound);
const musicViz = createMusicViz($('music-viz'), sound);
const background = createBackground($('grid'));
const eqVisual = createEqVisual($('eq-canvas'));
const refreshColors = () => requestAnimationFrame(() => [hero, background, eqVisual, musicViz].forEach((v) => v.refreshColors()));

// ---- tabs ----
const tabs = [...document.querySelectorAll('.tab')];
function showView(name) {
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.view === name));
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${name}`;
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
$('accent-chips').append(...Object.entries(ACCENTS).map(([name, rgb]) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'swatch'; b.setAttribute('role', 'radio'); b.dataset.value = name;
  b.setAttribute('aria-label', name); b.style.setProperty('--swatch', `rgb(${rgb})`);
  return b;
}));
for (const [key, id] of [['accent', 'accent-chips'], ['dots', 'dots-chips'], ['glass', 'glass-chips']]) {
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
$('demo-btn').addEventListener('click', async () => {
  mock = new MockHeadphones();
  try { await controller.connect(mock); } catch (e) { toast(e.message); }
});
$('disconnect-btn').addEventListener('click', async () => { await controller.disconnect(); mock = null; resync(); });
$('bt-btn').addEventListener('click', () => invoke('open_bluetooth_settings'));
if (!isDesktop) $('bt-btn').hidden = true;

// Headphones connected in the OS (any brand). A demo session takes priority.
// CMF Headphone Pro: open the private control channel automatically (desktop app).
const CMF = /CMF Headphone Pro/i;
let systemDevice = null;
let controlError = null;
const resync = () => controller.setSystemDevice(systemDevice);
async function openControls(dev) {
  if (!isDesktop || !dev?.address || !CMF.test(dev.name) || controller.session) return;
  controlError = null;
  try {
    await controller.connect(new NativeHeadphones(dev));
  } catch (e) {
    controlError = e.message;
    resync();
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

// Notification when headphones connect (real devices only, not the demo).
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
  b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'radio'); b.dataset.value = p.id; b.textContent = p.label;
  return b;
};
$('eq-chips').append(...EQ_PRESETS.map(presetChip));
$('quick-eq').append(...EQ_PRESETS.map(presetChip));
const eq = radioGroup($('eq-chips'), (v) => controller.setEq(v));
const quickEq = radioGroup($('quick-eq'), (v) => controller.setEq(v));
const lowLag = switchControl($('lowlag-switch'), (on) => controller.setLowLag(on));

// Custom EQ: three sliders, plus presets the user names and saves on this computer.
const sliders = [...document.querySelectorAll('#custom-sliders input')];
const fmt = (v) => (v > 0 ? `+${v}` : String(v));
let sliderTimer = 0;
sliders.forEach((input) => input.addEventListener('input', () => {
  input.nextElementSibling.textContent = fmt(Number(input.value));
  const bands = sliders.map((i) => Number(i.value));
  eqVisual.set(bands, true);
  clearTimeout(sliderTimer);
  sliderTimer = setTimeout(() => controller.setCustomEq(bands), 120);
}));
function renderMyPresets() {
  const list = prefs.get('myPresets', []);
  $('my-presets').replaceChildren(...list.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip small'; b.textContent = p.name; b.title = `Bass ${fmt(p.bands[0])}, Mid ${fmt(p.bands[1])}, Treble ${fmt(p.bands[2])}. Right-click to delete.`;
    b.addEventListener('click', () => controller.setCustomEq(p.bands));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); list.splice(i, 1); prefs.set('myPresets', list); renderMyPresets(); toast(`Deleted "${p.name}"`); });
    return b;
  }));
}
$('preset-save').addEventListener('click', () => {
  const name = $('preset-name').value.trim();
  if (!name) { $('preset-name').focus(); return; }
  const list = prefs.get('myPresets', []).filter((p) => p.name !== name);
  list.push({ name, bands: sliders.map((i) => Number(i.value)) });
  prefs.set('myPresets', list.slice(-12));
  $('preset-name').value = '';
  renderMyPresets();
  toast(`Saved "${name}"`);
});
renderMyPresets();

// ---- settings ----
// Experimental controls: draft commands (EQ, spatial, low lag) on the real headphones. Off by default.
controller.eqSetOp = prefs.get('eqSetOp', DOP.SET_EQ);
controller.onEqOpLearned = (op) => prefs.set('eqSetOp', op);
const exp = switchControl($('exp-switch'), (on) => {
  prefs.set('experimental', on); exp.set(on); controller.setExperimental(on);
  if (on) toast('Experimental controls on. If something looks wrong, turn this off.');
});
exp.set(prefs.get('experimental', false));
controller.setExperimental(prefs.get('experimental', false));
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

createDevPanel({ controller, getMock: () => mock });

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

  $('status-text').textContent = connected && s.kind === 'demo' ? 'Demo' : STATUS_TEXT[s.status];
  $('device-name').textContent = s.status === 'idle' ? 'No headphones' : s.deviceName ?? 'Headphones';

  // hero: real battery when the headphones report it, otherwise "Connected"
  hero.setMode(connected ? 'connected' : busy ? 'connecting' : 'idle');
  hero.setBattery(connected && s.battery ? s.battery.level : connected ? -1 : null);
  hero.setNoise(controllable ? s.anc : null);
  const hasBattery = connected && !!s.battery;
  $('pct').textContent = hasBattery ? String(s.battery.level) : '';
  $('pct-unit').hidden = !hasBattery;
  $('pct-label').textContent = busy ? STATUS_TEXT[s.status] : !connected ? 'Offline' : !hasBattery ? 'Connected' : s.battery.charging ? 'Charging' : 'Battery';
  app.dataset.low = String(hasBattery && s.battery.level <= 20);
  app.dataset.nobattery = String(connected && !hasBattery);

  $('idle-row').hidden = s.status !== 'idle';
  $('session-row').hidden = s.kind !== 'demo' || s.status === 'idle';
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
  sliders.forEach((input, i) => {
    input.disabled = !(controllable && s.features.customEq);
    if (s.eq === 'custom' && document.activeElement !== input) { input.value = s.customEq[i]; input.nextElementSibling.textContent = fmt(s.customEq[i]); }
  });
  $('preset-save').disabled = !(controllable && s.features.customEq);

  lowLag.set(controllable && s.lowLag);
  lowLag.setEnabled(controllable && s.features.lowLag);

  for (const card of document.querySelectorAll('.card[data-feature]')) {
    card.dataset.locked = String(controllable && !s.features[card.dataset.feature]);
    card.dataset.unavailable = String(!controllable);
  }

  const details = [
    ['Name', s.deviceName ?? '-'],
    ['Model', s.model ?? (s.kind === 'demo' ? 'B175 (demo)' : '-')],
    ['Firmware', s.firmware ?? '-'],
    ['Battery', hasBattery ? `${s.battery.level}%` : '-'],
    ['Connection', s.kind === 'demo' ? 'Demo' : s.kind === 'system' ? 'Bluetooth (audio only)' : connected ? 'Bluetooth (full control)' : '-'],
  ];
  $('device-details').replaceChildren(...details.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));

  if (s.error && s.error !== lastError) toast(s.error);
  lastError = s.error;
});

showView(prefs.get('view', 'home'));
