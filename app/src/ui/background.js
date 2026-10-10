// Subtle dot grid behind everything, drifting a few pixels with the pointer (parallax).
import { createLoop, fitCanvas, cssRgb, reducedMotion, dot } from './motion.js';

const SPACING = 22;  // css px
const SHIFT = 10;    // max parallax offset, css px

export function createBackground(canvas) {
  let w = 1, h = 1, dpr = 1, fg = [242, 242, 242];
  const ctx = fitCanvas(canvas, (W, H, D) => { w = W; h = H; dpr = D; loop.start(); });
  const pos = { x: 0, y: 0 }, target = { x: 0, y: 0 };

  window.addEventListener('pointermove', (e) => {
    if (reducedMotion()) return;
    target.x = (e.clientX / window.innerWidth - 0.5) * -2 * SHIFT;
    target.y = (e.clientY / window.innerHeight - 0.5) * -2 * SHIFT;
    loop.start();
  }, { passive: true });

  const loop = createLoop((t, dt) => {
    pos.x += (target.x - pos.x) * Math.min(1, dt * 4);
    pos.y += (target.y - pos.y) * Math.min(1, dt * 4);
    const step = SPACING * dpr;
    const ox = ((pos.x * dpr) % step + step) % step, oy = ((pos.y * dpr) % step + step) % step;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = `rgb(${fg[0]} ${fg[1]} ${fg[2]} / 0.075)`;
    const r = 0.9 * dpr;
    ctx.beginPath();
    for (let y = oy - step; y < h + step; y += step) {
      for (let x = ox - step; x < w + step; x += step) dot(ctx, x, y, r);
    }
    ctx.fill();
    return Math.abs(target.x - pos.x) + Math.abs(target.y - pos.y) > 0.05; // stop when settled
  });

  return {
    refreshColors() { fg = cssRgb('--fg-rgb'); loop.start(); },
  };
}
