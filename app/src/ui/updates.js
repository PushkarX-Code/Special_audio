// Updates, like macOS Software Update: the Update tab shows the version and what's new, and an update
// screen appears when a new version is found (on launch and every few hours). Nothing installs until
// the user clicks Update now. Desktop app only.
import { invoke, listen, isDesktop, prefs } from '../platform.js';

const EVERY_MS = 6 * 3600e3;

// Release notes are Markdown from the release page. Show the part above the first "---" line
// (below it are install instructions for new users). Built with textContent: no HTML from the network.
export function renderNotes(md, into) {
  into.replaceChildren();
  let list = null;
  for (const raw of (md ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^-{3,}$/.test(line)) break;
    if (!line) { list = null; continue; }
    let el;
    if (line.startsWith('#')) { el = document.createElement('h4'); el.textContent = line.replace(/^#+\s*/, ''); list = null; }
    else if (/^[-*]\s/.test(line)) {
      if (!list) { list = document.createElement('ul'); into.append(list); }
      el = document.createElement('li'); el.textContent = line.slice(2); list.append(el); continue;
    } else { el = document.createElement('p'); el.textContent = line; list = null; }
    into.append(el);
  }
  into.querySelectorAll('h4, li, p').forEach((n) => (n.textContent = n.textContent.replace(/\*\*(.+?)\*\*/g, '$1')));
  return into.childElementCount > 0;
}

export function createUpdates({ toast }) {
  if (!isDesktop) return null;
  const screen = document.getElementById('upd-screen');
  const panels = [document.querySelector('#view-update .upd'), screen.querySelector('.upd')];
  const badge = document.getElementById('update-badge');
  let current = '-';
  let update = null;   // {version, current, notes, date}
  let state = 'idle';  // idle | checking | latest | available | installing | error
  let error = '';
  let progress = null; // 0..1, or null when the size is unknown

  invoke('app_version').then((v) => { current = v; render(); });
  listen('update-progress', ({ done, total }) => { progress = total ? Math.min(1, done / total) : null; render(); });

  function render() {
    const v = update?.version;
    const title = {
      idle: 'Special Audio', checking: 'Checking for updates…', latest: 'Special Audio is up to date',
      available: `Special Audio ${v}`, installing: `Updating to ${v}…`, error: "Couldn't check for updates",
    }[state];
    const desc = {
      idle: `Version ${current}`, checking: `Version ${current}`, latest: `Version ${current}`,
      available: `A new version is available. You have ${current}.${update?.date ? ` Released ${update.date}.` : ''}`,
      installing: 'Special Audio restarts when it’s done.', error: error || 'Check your internet connection and try again.',
    }[state];
    for (const p of panels) {
      p.querySelector('[data-upd-title]').textContent = p.closest('#upd-screen') && state === 'available' ? 'Update available' : title;
      p.querySelector('[data-upd-desc]').textContent = p.closest('#upd-screen') && state === 'available' ? `Special Audio ${v} is ready. You have ${current}.` : desc;
      const current_el = p.querySelector('[data-upd-current]');
      if (current_el) current_el.textContent = current;
      const btn = p.querySelector('[data-upd-action]');
      btn.textContent = state === 'available' ? 'Update now' : state === 'installing' ? 'Updating…' : state === 'checking' ? 'Checking…' : 'Check now';
      btn.disabled = state === 'installing' || state === 'checking';
      btn.classList.toggle('solid', state === 'available' || state === 'installing');
      const notes = p.querySelector('[data-upd-notes]');
      const hasNotes = (state === 'available' || state === 'installing') && renderNotes(update?.notes, p.querySelector('[data-upd-notes-body]'));
      notes.hidden = !hasNotes;
      p.querySelector('[data-upd-notes-title]').textContent = `What's new in ${v ?? ''}`.trim();
      const bar = p.querySelector('[data-upd-progress]');
      bar.hidden = state !== 'installing';
      bar.dataset.indeterminate = String(progress == null);
      bar.firstElementChild.style.width = progress == null ? '' : `${Math.round(progress * 100)}%`;
      const later = p.querySelector('[data-upd-later]');
      if (later) later.disabled = state === 'installing';
    }
    badge.hidden = !(state === 'available' || state === 'installing');
  }

  async function check({ quiet }) {
    if (state === 'checking' || state === 'installing') return;
    state = 'checking'; render();
    try {
      update = await invoke('update_check');
      state = update ? 'available' : 'latest';
    } catch (e) {
      update = null;
      state = quiet ? 'idle' : 'error';
      error = String(e).slice(0, 160);
    }
    render();
    if (state === 'available' && quiet) {
      screen.hidden = false;
      if (document.hidden && prefs.get('notify', true)) {
        invoke('notify', { title: 'Special Audio update', body: `Version ${update.version} is ready. Open Special Audio to install it.` });
      }
    }
  }

  async function install() {
    state = 'installing'; progress = null; render();
    try {
      await invoke('update_install'); // restarts the app when done
    } catch (e) {
      state = 'available'; render();
      toast(`Update failed: ${String(e).slice(0, 120)}`);
    }
  }

  for (const p of panels) {
    p.querySelector('[data-upd-action]').addEventListener('click', () => (state === 'available' ? install() : check({ quiet: false })));
  }
  screen.querySelector('[data-upd-later]').addEventListener('click', () => { screen.hidden = true; });
  screen.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state !== 'installing') screen.hidden = true; });

  const auto = () => prefs.get('autoUpdate', true);
  setTimeout(() => auto() && check({ quiet: true }), 2500);
  setInterval(() => auto() && state !== 'available' && check({ quiet: true }), EVERY_MS);
  render();
  return { check };
}
