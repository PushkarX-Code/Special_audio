// Dot-matrix visualizer in the music card: 16 columns of dots that light from the bottom up.
import { createLoop, fitCanvas, cssRgb, reducedMotion, dot } from './motion.js';
import { BANDS } from './levels.js';

const ROWS = 5;

export function createMusicViz(canvas, levels) {
  let w = 1, h = 1, fg = [242, 242, 242], accent = [215, 25, 33];
  const ctx = fitCanvas(canvas, (cw, ch) => { w = cw; h = ch; loop.start(); });
  const loop = createLoop((t) => {
    levels.update(t);
    ctx.clearRect(0, 0, w, h);
    const gap = Math.min(w / BANDS, h / ROWS), r = gap * 0.28;
    const x0 = (w - gap * (BANDS - 1)) / 2, y0 = h - (h - gap * (ROWS - 1)) / 2;
    const live = !reducedMotion();
    for (let c = 0; c < BANDS; c++) {
      const stack = live ? levels.bands[c] * ROWS : 0;
      for (let k = 0; k < ROWS; k++) {
        const lit = Math.min(1, Math.max(0, stack - k));
        const col = k === ROWS - 1 && lit > 0.5 ? accent : fg;
        ctx.fillStyle = `rgb(${col[0]} ${col[1]} ${col[2]} / ${0.12 + 0.8 * lit})`;
        ctx.beginPath(); dot(ctx, x0 + c * gap, y0 - k * gap, r); ctx.fill();
      }
    }
    return live && (levels.playing || levels.energy() > 0.002);
  });
  return {
    wake() { loop.start(); },
    refreshColors() { fg = cssRgb('--fg-rgb'); accent = cssRgb('--accent-rgb'); loop.start(); },
  };
}
