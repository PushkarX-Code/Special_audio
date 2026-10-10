// Sound levels for the visualizers: 16 bands, 0..1, bass first.
// Windows app: the real sound the computer is playing (Rust audio.rs sends 'audio-levels').
// Elsewhere, or until real levels arrive: a generated pulse, only while music is playing.
import { invoke, listen, isDesktop } from '../platform.js';

export const BANDS = 16;

export function createLevels() {
  const bands = new Float32Array(BANDS);   // smoothed, what the visualizers draw
  const target = new Float32Array(BANDS);
  let playing = false, enabled = true, lastReal = 0, lastTick = 0, lastStart = 0, started = false;

  listen('audio-levels', (arr) => {
    lastReal = performance.now();
    // the Rust side maps -60..0 dB to 0..1; most music sits high in that range, so stretch the top
    for (let i = 0; i < BANDS; i++) target[i] = Math.max(0, ((arr[i] ?? 0) - 0.3) / 0.7) ** 1.4;
  });

  const sync = () => {
    const want = isDesktop && enabled && playing && !document.hidden;
    if (want && performance.now() - lastStart > 3000 && performance.now() - lastReal > 1000) {
      lastStart = performance.now(); started = true;
      invoke('visualizer_start').catch(() => {}); // not supported on this system: the generated pulse stays
    } else if (!want && started) {
      started = false;
      invoke('visualizer_stop').catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', sync);

  return {
    bands,
    setPlaying(v) { playing = !!v; sync(); },
    setEnabled(v) { enabled = !!v; sync(); },
    // Call once per frame (several visualizers may call it; only the first call per frame counts).
    update(t) {
      const now = performance.now();
      if (now - lastTick < 8) return;
      const dt = Math.min(0.1, (now - lastTick) / 1000);
      lastTick = now;
      const real = now - lastReal < 400;
      if (playing && enabled && !real) {
        sync(); // the capture thread may have stopped (output device changed): start it again
        const beat = Math.max(0, Math.sin(t * Math.PI * 2 * 1.9)) ** 6;
        for (let i = 0; i < BANDS; i++) {
          const f = i / BANDS;
          target[i] = 0.18 + 0.22 * (1 - f) * beat + 0.16 * (0.5 + 0.5 * Math.sin(t * (2.1 + i * 0.7) + i * 1.3)) * (1 - f * 0.5);
        }
      } else if (!playing || !enabled) target.fill(0);
      for (let i = 0; i < BANDS; i++) {
        const k = target[i] > bands[i] ? 18 : 5; // fast rise, slow fall
        bands[i] += (target[i] - bands[i]) * Math.min(1, dt * k);
      }
    },
    energy() { let e = 0; for (const v of bands) e += v; return e / BANDS; },
    get playing() { return playing && enabled; },
  };
}
