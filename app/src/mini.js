// Menu bar / tray panel. Shows the main window's state and sends commands back to it.
import { EQ_PRESETS } from './protocol/drafts.js';
import { radioGroup } from './ui/controls.js';
import { createHero } from './ui/hero.js';
import { emit, listen, invoke } from './platform.js';
import { createMusicBar } from './ui/music.js';
import { applyLook, readLook } from './ui/look.js';

const $ = (id) => document.getElementById(id);
const panel = document.querySelector('.mini-panel');
applyLook(readLook());
const ring = createHero($('m-canvas'));
createMusicBar($('m-music'), 3000);
const send = (type, value) => emit('sa-command', { type, value });

const noise = radioGroup($('m-noise'), (v) => send('noise', v));
$('m-eq').append(...EQ_PRESETS.map((p) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'chip small'; b.setAttribute('role', 'radio'); b.dataset.value = p.id; b.textContent = p.label;
  return b;
}));
const eq = radioGroup($('m-eq'), (v) => send('eq', v));
$('m-open').addEventListener('click', () => invoke('open_main'));

listen('sa-look', ({ theme, ...look }) => {
  if (theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  applyLook({ ...readLook(), ...look });
  requestAnimationFrame(() => ring.refreshColors());
});

listen('sa-state', (s) => {
  const connected = s.status === 'connected';
  const controllable = connected && s.kind !== 'system';
  panel.dataset.status = s.status;
  $('m-status').textContent = connected ? 'Connected' : s.status === 'idle' ? 'Not connected' : 'Connecting';
  $('m-name').textContent = s.status === 'idle' ? 'No headphones' : s.deviceName ?? 'Headphones';
  ring.setMode(connected ? 'connected' : s.status === 'idle' ? 'idle' : 'connecting');
  ring.setBattery(connected && s.battery ? s.battery.level : connected ? -1 : null);
  $('m-pct').textContent = connected && s.battery ? String(s.battery.level) : '';

  $('m-noise-wrap').hidden = !(controllable && s.features.anc);
  noise.set(s.anc);
  $('m-eq-wrap').hidden = !(controllable && s.features.eq);
  eq.set(s.eq);
  $('m-hint').hidden = connected;
});

emit('sa-hello');
