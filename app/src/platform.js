// Thin wrapper over the desktop app (Tauri). In a plain browser every call is a harmless no-op.
const T = window.__TAURI__;
export const isDesktop = !!T?.core;

export const invoke = (cmd, args) => (isDesktop ? T.core.invoke(cmd, args) : Promise.resolve(null));
export const emit = (event, payload) => (isDesktop ? T.event.emit(event, payload) : Promise.resolve());
export const listen = (event, cb) => (isDesktop ? T.event.listen(event, (e) => cb(e.payload)) : Promise.resolve(() => {}));

// Polls the devices the computer has connected (Bluetooth devices of any kind, plus the sound output)
// and calls onChange with the full list whenever something changes (battery included).
export function watchDevices(onChange, everyMs = 5000) {
  if (!isDesktop) return () => {};
  let last = '';
  let busy = false;
  const poll = async () => {
    if (busy) return;
    busy = true;
    try {
      const list = (await invoke('audio_devices')) ?? [];
      const key = JSON.stringify(list);
      if (key !== last) { last = key; onChange(list); }
    } catch { /* keep polling */ }
    busy = false;
  };
  poll();
  const id = setInterval(poll, everyMs);
  window.addEventListener('focus', poll);
  return () => { clearInterval(id); window.removeEventListener('focus', poll); };
}

// Small persistent settings (per computer). Storage can be unavailable; fall back to defaults.
export const prefs = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};
