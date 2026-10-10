// Shared motion helpers: reduced-motion flag and an animation loop that pauses when the window is hidden.

const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
// System setting, or the app's own Look → Animation → Calm.
export const reducedMotion = () => rm.matches || document.documentElement.dataset.motion === 'reduced';
export const onReducedMotionChange = (fn) => rm.addEventListener('change', fn);

const loops = new Set();

export function createLoop(frame) {
  let id = 0;
  let last = 0;
  const loop = {
    running: false,
    start() {
      if (loop.running || document.hidden) { loop.running = true; return; }
      loop.running = true;
      last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (frame(now / 1000, dt) === false) { loop.running = false; id = 0; return; }
        id = requestAnimationFrame(tick);
      };
      id = requestAnimationFrame(tick);
    },
    stop() { loop.running = false; cancelAnimationFrame(id); id = 0; },
    _pause() { cancelAnimationFrame(id); id = 0; },
    _resume() { if (loop.running && !id) { loop.running = false; loop.start(); } },
  };
  loops.add(loop);
  return loop;
}

document.addEventListener('visibilitychange', () => {
  loops.forEach((l) => (document.hidden ? l._pause() : l._resume()));
});

// Canvas that tracks its CSS size at device pixel ratio. Calls onResize(width, height, dpr).
export function fitCanvas(canvas, onResize) {
  const ctx = canvas.getContext('2d');
  const apply = (force = false) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (force || canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      onResize?.(w, h, dpr);
    }
  };
  new ResizeObserver(() => apply()).observe(canvas);
  // first call after the caller has finished setting up (its loop may not exist yet)
  queueMicrotask(() => apply(true));
  return ctx;
}

// One dot, round or square (Look → Dot shape). Snapped to whole pixels so still dots stay crisp.
export function dot(ctx, x, y, r) {
  if (document.documentElement.dataset.dots === 'square') {
    const s = Math.max(1, Math.round(r * 1.7));
    ctx.rect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

// Read a "r g b" token from CSS custom properties.
export function cssRgb(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
}
