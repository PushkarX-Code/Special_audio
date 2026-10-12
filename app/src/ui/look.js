// Look settings shared by the main window and the menu bar panel: dot shape and glass. The accent is always Nothing red.
// Stored per computer; applied as data attributes on <html> that the CSS and canvases read.
export const ACCENTS = { red: '215 25 33', orange: '255 112 32', green: '40 200 110', blue: '60 130 255', white: '242 242 242' };
export const LOOK_KEYS = ['dots', 'glass'];
export const LOOK_DEFAULTS = { dots: 'round', glass: 'frosted' };

export function readLook() {
  const look = { ...LOOK_DEFAULTS };
  try { for (const k of LOOK_KEYS) look[k] = localStorage.getItem(`look.${k}`) ?? look[k]; } catch {}
  return look;
}

export function applyLook(look) {
  const root = document.documentElement;
  for (const k of LOOK_KEYS) root.dataset[k] = look[k];
  root.style.setProperty('--accent-rgb', ACCENTS.red);
}

export function saveLook(key, value) {
  try { localStorage.setItem(`look.${key}`, value); } catch {}
}
