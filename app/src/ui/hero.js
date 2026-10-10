// Hero canvas: battery gauge made of dots, the connecting silhouette, and the noise-control ring.
// While music plays, the ring turns into a circular dot spectrum (bass at the bottom, treble at the top).
// The gauge dots are particles. Connecting: they fly into a headphone silhouette. Connected: they
// dissolve back into the ring and light up one by one to show the battery level.
import { createLoop, fitCanvas, cssRgb, reducedMotion, dot } from './motion.js';
import { BANDS } from './levels.js';

const N = 72;           // gauge dots
const RING_DOTS = 64;   // noise ring dots per layer
const R_GAUGE = 0.335;  // radii as a fraction of canvas size
const R_RING = 0.445;

// Headphone silhouette in unit space (centre 0,0; y down), exactly N points.
function silhouette() {
  const pts = [];
  const band = 26;
  for (let i = 0; i < band; i++) {
    const a = Math.PI * (1.06 + (0.88 * i) / (band - 1));
    pts.push([0.29 * Math.cos(a), 0.05 + 0.29 * Math.sin(a)]);
  }
  const perCup = (N - band) / 2;
  for (const side of [-1, 1]) pts.push(...roundedRect(side * 0.285, 0.15, 0.13, 0.25, 0.055, perCup));
  return pts;
}
// n points spaced evenly along a rounded rectangle's outline (centre cx, cy).
function roundedRect(cx, cy, w, h, r, n) {
  const sx = w - 2 * r, sy = h - 2 * r, arc = (Math.PI / 2) * r;
  const segs = [sx, arc, sy, arc, sx, arc, sy, arc];
  const total = segs.reduce((a, b) => a + b, 0);
  const corners = [[cx + sx / 2, cy - sy / 2], [cx + sx / 2, cy + sy / 2], [cx - sx / 2, cy + sy / 2], [cx - sx / 2, cy - sy / 2]];
  const out = [];
  for (let i = 0; i < n; i++) {
    let d = (i / n) * total, k = 0;
    while (d > segs[k]) d -= segs[k++];
    const side = k >> 1, u = d / segs[k];
    if (k % 2 === 0) { // straight edge: top, right, bottom, left (clockwise)
      const [ax, ay] = corners[(side + 3) % 4], [bx, by] = corners[side];
      const nx = [0, 1, 0, -1][side] * r, ny = [-1, 0, 1, 0][side] * r;
      out.push([ax + (bx - ax) * u + nx, ay + (by - ay) * u + ny]);
    } else { // corner arc
      const [ox, oy] = corners[side], a0 = -Math.PI / 2 + side * (Math.PI / 2) + u * (Math.PI / 2);
      out.push([ox + r * Math.cos(a0), oy + r * Math.sin(a0)]);
    }
  }
  return out;
}
const SILHOUETTE = silhouette();

const gaugePoint = (i, r = R_GAUGE) => {
  const a = -Math.PI / 2 + (i / N) * Math.PI * 2; // index 0 at 12 o'clock, clockwise
  return [r * Math.cos(a), r * Math.sin(a)];
};

export function createHero(canvas, levels) {
  let size = 1;
  let fg = [242, 242, 242];
  let accent = [215, 25, 33];
  const ctx = fitCanvas(canvas, (w) => { size = w; loop.start(); });
  size = canvas.width;

  // particles start scattered so the first load assembles the ring
  const P = Array.from({ length: N }, (_, i) => {
    const a = Math.random() * Math.PI * 2, r = 0.2 + Math.random() * 0.35;
    const [tx, ty] = gaugePoint(i);
    const rm = reducedMotion();
    return { x: rm ? tx : Math.cos(a) * r, y: rm ? ty : Math.sin(a) * r, vx: 0, vy: 0, tx, ty, startAt: 0, lit: 0, litTarget: 0, litAt: 0 };
  });

  let mode = 'idle';      // idle | connecting | connected
  let level = null;       // battery 0-100 or null
  let noise = null;       // anc | transparency | off | null
  const ringW = { anc: 0, transparency: 0, off: 0, none: 1 };
  let modeSince = 0;
  let specW = 0;           // 0..1, how much the spectrum has replaced the noise ring

  function retarget(points, stagger) {
    const now = performance.now();
    P.forEach((p, i) => {
      [p.tx, p.ty] = points[i];
      p.startAt = now + (stagger ? i * stagger : 0);
      if (reducedMotion()) { p.x = p.tx; p.y = p.ty; p.vx = p.vy = 0; }
    });
  }

  function relight() {
    const now = performance.now();
    // level -1: connected but the headphones don't report battery. The whole ring glows softly.
    const lit = level == null || mode !== 'connected' ? 0 : level === -1 ? N : Math.round((level / 100) * N);
    P.forEach((p, i) => {
      const target = i < lit ? 1 : 0;
      if (target !== p.litTarget) { p.litTarget = target; p.litAt = now + (reducedMotion() ? 0 : i * 14); }
    });
  }

  const api = {
    setMode(next) {
      if (next === mode) return;
      mode = next;
      modeSince = performance.now() / 1000;
      if (mode === 'connecting') retarget(SILHOUETTE, 6);
      else retarget(P.map((_, i) => gaugePoint(i)), mode === 'connected' ? 9 : 4);
      relight();
      loop.start();
    },
    setBattery(v) { level = v; relight(); loop.start(); },
    setNoise(v) { noise = v; loop.start(); },
    wake() { loop.start(); },
    refreshColors() { fg = cssRgb('--fg-rgb'); accent = cssRgb('--accent-rgb'); loop.start(); },
  };

  const loop = createLoop((t, dt) => {
    const now = performance.now();
    const s = size, c = s / 2;
    ctx.clearRect(0, 0, s, s);
    const rm = reducedMotion();

    // --- noise ring: cross-fade between modes ---
    const want = noise ?? 'none';
    for (const k of Object.keys(ringW)) {
      const target = k === want ? 1 : 0;
      ringW[k] += (target - ringW[k]) * Math.min(1, dt * (rm ? 60 : 5));
    }
    levels?.update(t);
    const specOn = !rm && levels?.playing && mode !== 'connecting';
    specW += ((specOn ? 1 : 0) - specW) * Math.min(1, dt * 3);
    const ringFade = 1 - 0.8 * specW;
    const dotR = s * 0.0048;
    const ringDot = (x, y, a, r = dotR, col = fg) => {
      if (a <= 0.004) return;
      ctx.fillStyle = `rgb(${col[0]} ${col[1]} ${col[2]} / ${a})`;
      ctx.beginPath(); dot(ctx, c + x * s, c + y * s, r); ctx.fill();
    };
    for (let j = 0; j < RING_DOTS; j++) {
      const a = (j / RING_DOTS) * Math.PI * 2;
      const cos = Math.cos(a), sin = Math.sin(a);
      // idle / off: still and dim
      if (ringW.none > 0.01) ringDot(cos * R_RING, sin * R_RING, 0.07 * ringW.none * ringFade);
      // Off: a comet of dots slowly circles the ring, its tail fading behind it
      if (ringW.off > 0.01) {
        const behind = rm ? 9 : (((t * 0.85 - a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const tail = Math.max(0, 1 - behind / 1.4) ** 2;
        ringDot(cos * R_RING, sin * R_RING, (0.1 + 0.75 * tail) * ringW.off * ringFade, dotR * (1 + 1.3 * tail));
      }
      // ANC: tight ring pulsing inward, a slow wave travels around it
      if (ringW.anc > 0.01) {
        const pulse = rm ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.6 - j * 0.2);
        const r = R_RING - 0.028 * pulse;
        ringDot(cos * r, sin * r, (0.32 + 0.4 * pulse) * ringW.anc * ringFade, dotR * (0.9 + 0.35 * pulse));
      }
      // Transparency: rings open outward and fade
      if (ringW.transparency > 0.01 && j % 2 === 0) {
        for (let k = 0; k < 3; k++) {
          const ph = rm ? k / 3 : (t * 0.28 + k / 3) % 1;
          const r = R_RING - 0.02 + ph * 0.06;
          ringDot(cos * r, sin * r, (1 - ph) * 0.5 * ringW.transparency * ringFade);
        }
      }
      // Spectrum: up to 4 dots stacked outward per angle. Mirrored left/right.
      if (specW > 0.01) {
        const fromBottom = Math.abs(((a - Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / Math.PI; // 0 bottom, 1 top
        const bp = fromBottom * (BANDS - 1), b0 = Math.floor(bp), f = bp - b0;
        const v = levels.bands[b0] * (1 - f) + (levels.bands[Math.min(BANDS - 1, b0 + 1)] ?? 0) * f;
        const stack = v * 4;
        for (let k = 0; k < 4; k++) {
          const lit = Math.min(1, Math.max(0, stack - k));
          const r = R_RING - 0.004 + k * 0.016;
          const peak = k === 3 && lit > 0.5;
          ringDot(cos * r, sin * r, (k === 0 ? 0.12 : 0) * specW + (0.85 - k * 0.12) * lit * specW, dotR * (1.3 - k * 0.1), peak ? accent : fg);
        }
      }
    }

    // --- gauge particles ---
    const breathe = mode === 'idle' && !rm ? 1 + 0.012 * Math.sin(t * 1.4) : 1;
    const low = level != null && level >= 0 && level <= 20;
    let lead = -1;
    let moving = false;
    P.forEach((p, i) => {
      if (now >= p.startAt && !rm) {
        // spring toward target
        const k = 150, damp = 19; // snappier settle, no wobble
        p.vx += ((p.tx * breathe - p.x) * k - p.vx * damp) * dt;
        p.vy += ((p.ty * breathe - p.y) * k - p.vy * damp) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (Math.abs(p.vx) + Math.abs(p.vy) > 0.002) moving = true;
      }
      if (now >= p.litAt) p.lit += (p.litTarget - p.lit) * Math.min(1, dt * (rm ? 60 : 12));
      if (Math.abs(p.litTarget - p.lit) > 0.01) moving = true;
      if (p.litTarget === 1) lead = i;
    });

    const baseR = s * 0.0108;
    P.forEach((p, i) => {
      let a, r = baseR, col = fg;
      if (mode === 'connecting') {
        const shimmer = rm ? 0.75 : 0.55 + 0.35 * Math.sin(t * 5 - i * 0.35);
        a = shimmer;
        r = baseR * 0.85;
      } else {
        a = 0.13 + (level === -1 ? 0.37 : 0.87) * p.lit;
        if (low && p.lit > 0.05) col = accent;
      }
      ringDot(p.x, p.y, a, r, col);
    });

    // the single red hero dot marks the end of the battery fill
    if (mode === 'connected' && level !== -1 && lead >= 0 && P[lead].lit > 0.5) {
      const p = P[lead];
      const glow = rm ? 0.5 : 0.5 + 0.25 * Math.sin(t * 3);
      ringDot(p.x, p.y, 0.25 * glow, baseR * 2.4, accent);
      ringDot(p.x, p.y, 1, baseR * 1.15, accent);
    }

    // keep running while anything moves or a ring animates
    const ringAnimating = !rm && (ringW.anc > 0.01 || ringW.transparency > 0.01 || ringW.off > 0.01 || specW > 0.01 || specOn);
    const settling = Object.entries(ringW).some(([k, v]) => Math.abs(v - (k === want ? 1 : 0)) > 0.01);
    return moving || ringAnimating || settling || mode === 'connecting' || (mode === 'idle' && !rm) || t - modeSince < 1;
  });

  api.refreshColors();
  return api;
}
