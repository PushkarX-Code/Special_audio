// Music control bar: what's playing, plus previous / play-pause / next. Desktop app only.
import { invoke, isDesktop } from '../platform.js';

const ICONS = {
  previous: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6v12M18 6l-8 6 8 6z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5.5" width="3.6" height="13" rx="1.2" fill="currentColor"/><rect x="13.4" y="5.5" width="3.6" height="13" rx="1.2" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 6v12M6 6l8 6-8 6z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};

// root contains [data-music-title], [data-music-artist] and buttons with data-action previous|toggle|next.
export function createMusicBar(root, everyMs = 2000) {
  if (!isDesktop || !root) return;
  const title = root.querySelector('[data-music-title]');
  const artist = root.querySelector('[data-music-artist]');
  const toggle = root.querySelector('[data-action="toggle"]');
  root.querySelector('[data-action="previous"]').innerHTML = ICONS.previous;
  root.querySelector('[data-action="next"]').innerHTML = ICONS.next;
  let playing = false;

  const render = (np) => {
    root.hidden = !np;
    if (!np) return;
    title.textContent = np.title;
    artist.textContent = np.artist || np.source || '';
    playing = np.playing;
    toggle.innerHTML = playing ? ICONS.pause : ICONS.play;
    toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    root.dataset.playing = String(playing);
  };

  let busy = false;
  const poll = async () => {
    if (busy || document.hidden) return;
    busy = true;
    try { render(await invoke('now_playing')); } catch { render(null); }
    busy = false;
  };

  root.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'toggle') { playing = !playing; toggle.innerHTML = playing ? ICONS.pause : ICONS.play; }
    await invoke('media_control', { action });
    setTimeout(poll, 350);
  });

  poll();
  setInterval(poll, everyMs);
  window.addEventListener('focus', poll);
}
