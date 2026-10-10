// Small dot-matrix picture of the EQ curve. It morphs column by column when the preset changes.
// The curves are illustrative shapes, not measured responses from the headphones.
import { createLoop, fitCanvas, cssRgb, reducedMotion, dot } from './motion.js';

const COLS = 28, ROWS = 7;
// bass -> treble, -1..1
export const EQ_SHAPES = {
  dirac: [0.12, 0.06, 0, 0.04, 0.1],
  pop: [0.3, 0.1, 0.38, 0.22, 0.3],
  rock: [0.55, 0.22, -0.18, 0.28, 0.48],
  classical: [0.22, 0.08, -0.06, 0.16, 0.38],
  electronic: [0.7, 0.32, -0.02, 0.2, 0.52],
  vocals: [-0.24, 0, 0.5, 0.36, 0.04],
  none: [0, 0, 0, 0, 0],
};

function sample(points, x) { // x 0..1, smooth interpolation through the control points
  const f = x * (points.length - 1), i = Math.min(points.length - 2, Math.floor(f)), u = f - i;
  const e = u * u * (3 - 2 * u);
  return points[i] + (points[i + 1] - points[i]) * e;
}

// Three bands (-6..6 dB) spread over the five control points.
function customShape([b, m, t]) {
  const n = (v) => (v / 6) * 0.8;
  return [n(b), (n(b) + n(m)) / 2, n(m), (n(m) + n(t)) / 2, n(t)];
}

export function createEqVisual(canvas) {
  let w = 1, h = 1, fg = [242, 242, 242];
  const ctx = fitCanvas(canvas, (W, H) => { w = W; h = H; loop.start(); });
  const cur = new Float32Array(COLS), tgt = new Float32Array(COLS), startAt = new Float32Array(COLS);
  let active = false;

  const loop = createLoop((t, dt) => {
    const now = performance.now();
    const rm = reducedMotion();
    let moving = false;
    for (let i = 0; i < COLS; i++) {
      if (now < startAt[i]) { moving = true; continue; }
      cur[i] += (tgt[i] - cur[i]) * Math.min(1, dt * (rm ? 60 : 10));
      if (Math.abs(tgt[i] - cur[i]) > 0.002) moving = true;
    }
    ctx.clearRect(0, 0, w, h);
    const gx = w / COLS, gy = h / ROWS, r = Math.min(gx, gy) * 0.17;
    for (let i = 0; i < COLS; i++) {
      const level = (cur[i] * 0.5 + 0.5) * (ROWS - 1); // row index of the curve
      for (let j = 0; j < ROWS; j++) {
        const row = ROWS - 1 - j;
        const d = Math.abs(row - level);
        const on = d < 0.5 ? 1 : d < 1.2 ? 0.35 : 0;
        const a = active ? 0.1 + 0.85 * on : 0.08 + 0.12 * on;
        ctx.fillStyle = `rgb(${fg[0]} ${fg[1]} ${fg[2]} / ${a})`;
        ctx.beginPath(); dot(ctx, Math.round(gx * (i + 0.5)), Math.round(gy * (j + 0.5)), r * (on > 0.9 && active ? 1.25 : 1)); ctx.fill();
      }
    }
    return moving;
  });

  return {
    // id: a preset name, or [bass, mid, treble] in dB for a custom EQ.
    set(id, isActive = true) {
      active = isActive && !!id;
      const shape = Array.isArray(id) ? customShape(id) : EQ_SHAPES[id] ?? EQ_SHAPES.none;
      const now = performance.now();
      for (let i = 0; i < COLS; i++) {
        tgt[i] = sample(shape, i / (COLS - 1));
        startAt[i] = now + (reducedMotion() ? 0 : i * 12);
      }
      loop.start();
    },
    refreshColors() { fg = cssRgb('--fg-rgb'); loop.start(); },
  };
}
