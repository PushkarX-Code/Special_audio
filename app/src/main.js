// App entry: wires the controller (device state) to the UI.
import { Controller } from './device/controller.js';
import { MockHeadphones } from './device/mock.js';
import { EQ_PRESETS } from './protocol/drafts.js';
import { createHero } from './ui/hero.js';
import { createBackground } from './ui/background.js';
import { createEqVisual } from './ui/eq-visual.js';
import { radioGroup, switchControl, dotRipple } from './ui/controls.js';
import { createDevPanel } from './ui/devpanel.js';

const $ = (id) => document.getElementById(id);
const app = document.querySelector('.app');
const controller = new Controller();
let mock = null;

// ---- visuals ----
const hero = createHero($('hero-canvas'));
const background = createBackground($('grid'));
const eqVisual = createEqVisual($('eq-canvas'));

// ---- theme: system -> light -> dark ----
const THEMES = ['system', 'light', 'dark'];
function applyTheme(theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try { theme === 'system' ? localStorage.removeItem('theme') : localStorage.setItem('theme', theme); } catch {}
  $('theme-btn').setAttribute('aria-label', `Theme: ${theme}`);
  requestAnimationFrame(() => [hero, background, eqVisual].forEach((v) => v.refreshColors()));
}
$('theme-btn').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme ?? 'system';
  applyTheme(THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(document.documentElement.dataset.theme ?? 'system'));
applyTheme(document.documentElement.dataset.theme ?? 'system');

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

// ---- connection buttons ----
// The hardware transport is the next phase (Web Serial in the browser, native Bluetooth in the desktop app).
const realTransport = null;
const connectBtn = $('connect-btn');
connectBtn.disabled = !realTransport;
if (!realTransport) { connectBtn.classList.remove('primary'); $('demo-btn').classList.add('primary'); }

connectBtn.addEventListener('click', async () => {
  if (!realTransport) return;
  try { await controller.connect(realTransport()); } catch (e) { toast(e.message); }
});
$('demo-btn').addEventListener('click', async () => {
  mock = new MockHeadphones();
  try { await controller.connect(mock); } catch (e) { toast(e.message); }
});
$('disconnect-btn').addEventListener('click', () => controller.disconnect());

// ---- controls ----
const noise = radioGroup($('noise-seg'), (v) => controller.setNoise(v));
const levels = radioGroup($('anc-levels'), (v) => controller.setNoise('anc', v));
const spatial = radioGroup($('spatial-chips'), (v, btn) => { dotRipple(btn); controller.setSpatial(v); });

$('eq-chips').append(...EQ_PRESETS.map((p) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'radio'); b.dataset.value = p.id; b.textContent = p.label;
  return b;
}));
const eq = radioGroup($('eq-chips'), (v) => controller.setEq(v));
const lowLag = switchControl($('lowlag-switch'), (on) => controller.setLowLag(on));

createDevPanel({ controller, getMock: () => mock });

// ---- render ----
const STATUS_TEXT = { idle: 'Not connected', connecting: 'Connecting', reconnecting: 'Reconnecting', connected: 'Connected' };
let lastError = null;
let lastEq = undefined;

controller.subscribe((s) => {
  const connected = s.status === 'connected';
  const busy = s.status === 'connecting' || s.status === 'reconnecting';
  app.dataset.status = s.status;
  $('status-text').textContent = connected && s.kind === 'demo' ? 'Demo' : STATUS_TEXT[s.status];
  $('device-name').textContent = s.status === 'idle' ? 'No device' : s.deviceName ?? 'Headphones';

  // hero
  hero.setMode(connected ? 'connected' : busy ? 'connecting' : 'idle');
  hero.setBattery(connected && s.battery ? s.battery.level : null);
  hero.setNoise(connected ? s.anc : null);
  const hasBattery = connected && s.battery;
  $('pct').textContent = hasBattery ? String(s.battery.level) : '';
  $('pct-unit').hidden = !hasBattery;
  $('pct-label').textContent = busy ? STATUS_TEXT[s.status] : !connected ? 'Offline' : hasBattery && s.battery.charging ? 'Charging' : 'Battery';
  app.dataset.low = String(!!(hasBattery && s.battery.level <= 20));

  $('connect-row').hidden = s.status !== 'idle';
  $('session-row').hidden = s.status === 'idle';
  $('hint').textContent = s.readOnlyReason
    ?? (s.status === 'idle' ? (realTransport ? 'Turn the headphones on and close Nothing X on your phone.' : 'Hardware connection arrives in the next build. Demo mode needs no headphones.') : '');

  // controls show confirmed state (or a <400 ms optimistic value from the controller)
  noise.set(connected ? s.anc : null);
  noise.setEnabled(connected && s.features.anc);
  levels.set(connected && s.anc === 'anc' ? s.ancLevel : null);
  levels.setEnabled(connected && s.features.anc);
  $('anc-levels').dataset.open = String(connected && s.anc === 'anc');

  spatial.set(connected ? s.spatial : null);
  spatial.setEnabled(connected && s.features.spatial);

  eq.set(connected ? s.eq : null);
  eq.setEnabled(connected && s.features.eq);
  const eqKey = connected ? s.eq : null;
  if (eqKey !== lastEq) { eqVisual.set(eqKey, connected); lastEq = eqKey; }

  lowLag.set(connected && s.lowLag);
  lowLag.setEnabled(connected && s.features.lowLag);

  for (const card of document.querySelectorAll('.card[data-feature]')) {
    card.dataset.locked = String(connected && !s.features[card.dataset.feature]);
  }

  $('fw').textContent = connected && s.firmware ? s.firmware : '--';

  if (s.error && s.error !== lastError) toast(s.error);
  lastError = s.error;
});
