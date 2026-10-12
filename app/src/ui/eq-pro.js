// Pro EQ editor: a dot-matrix response graph with draggable band nodes, plus one precise cell per band
// (value, -/+ buttons, arrow keys, mouse wheel). Used for the headphone EQ (3 filters) and the PC EQ
// (10-point graphic EQ). The graph shows the real response: biquad filters for the headphones,
// a smooth curve through the points for the PC (that's how a graphic EQ interpolates).
import { createLoop, fitCanvas, cssRgb, dot } from './motion.js';

const FS = 48000;
const F_MIN = 20, F_MAX = 20000;

// RBJ audio EQ cookbook biquad, normalised [b0, b1, b2, a1, a2].
function biquad(type, f0, q, gain) {
  const A = 10 ** (gain / 40), w = (2 * Math.PI * f0) / FS, c = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'peak') {
    b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A;
  } else {
    const s = 2 * Math.sqrt(A) * al, k = type === 'low' ? 1 : -1;
    b0 = A * ((A + 1) - k * (A - 1) * c + s); b1 = 2 * k * A * ((A - 1) - k * (A + 1) * c); b2 = A * ((A + 1) - k * (A - 1) * c - s);
    a0 = (A + 1) + k * (A - 1) * c + s; a1 = -2 * k * ((A - 1) + k * (A + 1) * c); a2 = (A + 1) + k * (A - 1) * c - s;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function biquadDb([b0, b1, b2, a1, a2], f) {
  const w = (2 * Math.PI * f) / FS, c1 = Math.cos(w), c2 = Math.cos(2 * w), s1 = Math.sin(w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}
// Catmull-Rom through (log f, gain) points, flat beyond the ends.
function graphicDb(bands, gains, f) {
  const x = Math.log10(f), xs = bands.map((b) => Math.log10(b.freq));
  if (x <= xs[0]) return gains[0];
  if (x >= xs[xs.length - 1]) return gains[gains.length - 1];
  let i = 0;
  while (x > xs[i + 1]) i++;
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  const p0 = gains[Math.max(0, i - 1)], p1 = gains[i], p2 = gains[i + 1], p3 = gains[Math.min(gains.length - 1, i + 2)];
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

export function responseDb(mode, bands, gains, f) {
  if (mode === 'graphic') return graphicDb(bands, gains, f);
  return bands.reduce((sum, b, i) => sum + (gains[i] ? biquadDb(biquad(b.type, b.freq, b.q, gains[i]), f) : 0), 0);
}

const fmtFreq = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : String(f));
const fmtDb = (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

// bands: [{label, freq, type?, q?}], mode: 'filters' | 'graphic', range: ±dB, onChange(gains, final)
export function createEqEditor(root, { bands, mode = 'filters', range = 6, step = 0.5, onChange }) {
  root.classList.add('eqx');
  root.innerHTML = `<div class="eqx-graph"><canvas aria-hidden="true"></canvas></div><div class="eqx-cells"></div>`;
  const canvas = root.querySelector('canvas');
  let w = 1, h = 1, fg = [242, 242, 242], accent = [215, 25, 33];
  let gains = bands.map(() => 0);
  let shown = gains.slice(); // eased for drawing
  let enabled = true, dragging = -1, hover = -1;
  const ctx = fitCanvas(canvas, (cw, ch) => { w = cw; h = ch; loop.start(); });

  const pad = () => ({ l: w * 0.05, r: w * 0.03, t: h * 0.1, b: h * 0.16 });
  const xOf = (f) => { const p = pad(); return p.l + ((Math.log10(f) - Math.log10(F_MIN)) / (Math.log10(F_MAX) - Math.log10(F_MIN))) * (w - p.l - p.r); };
  const yOf = (db) => { const p = pad(); return p.t + ((range - db) / (2 * range)) * (h - p.t - p.b); };
  const dbOfY = (y) => { const p = pad(); return range - ((y - p.t) / (h - p.t - p.b)) * 2 * range; };
  const snap = (v) => Math.max(-range, Math.min(range, Math.round(v / step) * step));
  const rgba = (c, a) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`;

  const loop = createLoop((t, dt) => {
    let moving = false;
    shown = shown.map((v, i) => { const d = gains[i] - v; if (Math.abs(d) > 0.01) moving = true; return v + d * Math.min(1, dt * 14); });
    ctx.clearRect(0, 0, w, h);
    const dpr = w / Math.max(1, canvas.clientWidth);
    const gap = 7 * dpr, r = 1.05 * dpr;
    // dot grid
    ctx.fillStyle = rgba(fg, 0.09);
    for (let y = pad().t; y <= h - pad().b + 0.5; y += gap) for (let x = pad().l; x <= w - pad().r + 0.5; x += gap) { ctx.beginPath(); dot(ctx, x, y, r * 0.8); ctx.fill(); }
    // 0 dB and ±range/2 lines
    ctx.fillStyle = rgba(fg, 0.28);
    for (let x = pad().l; x <= w - pad().r; x += gap / 2) { ctx.beginPath(); dot(ctx, x, yOf(0), r * 0.7); ctx.fill(); }
    // axis labels
    ctx.fillStyle = rgba(fg, 0.42);
    ctx.font = `${9.5 * dpr}px "Space Mono", monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) ctx.fillText(fmtFreq(f), xOf(f), h - pad().b + 8 * dpr);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const d of [range, 0, -range]) ctx.fillText(`${d > 0 ? '+' : ''}${d}`, 2 * dpr, yOf(d));
    // response curve as dots
    const cur = enabled ? shown : shown.map(() => 0);
    for (let x = pad().l; x <= w - pad().r; x += gap / 2.2) {
      const f = 10 ** (Math.log10(F_MIN) + ((x - pad().l) / (w - pad().l - pad().r)) * (Math.log10(F_MAX) - Math.log10(F_MIN)));
      const db = Math.max(-range * 1.15, Math.min(range * 1.15, responseDb(mode, bands, cur, f)));
      const y = yOf(db);
      // fill: faint column from 0 dB to the curve
      ctx.fillStyle = rgba(fg, enabled ? 0.07 : 0.03);
      const y0 = yOf(0), dir = y < y0 ? -1 : 1;
      for (let yy = y0; dir < 0 ? yy > y : yy < y; yy += dir * gap) { ctx.beginPath(); dot(ctx, x, yy, r * 0.9); ctx.fill(); }
      ctx.fillStyle = rgba(fg, enabled ? 0.95 : 0.35);
      ctx.beginPath(); dot(ctx, x, y, r * 1.45); ctx.fill();
    }
    // band nodes
    bands.forEach((b, i) => {
      const x = xOf(b.freq), y = yOf(cur[i]);
      const on = i === dragging || i === hover;
      ctx.strokeStyle = rgba(on ? accent : fg, enabled ? 1 : 0.4);
      ctx.lineWidth = 1.6 * dpr;
      ctx.fillStyle = on ? rgba(accent, 0.9) : rgba(fg[0] > 128 ? [14, 14, 14] : [248, 248, 248], 0.92);
      ctx.beginPath(); ctx.arc(x, y, (on ? 7.5 : 6) * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    return moving || dragging >= 0;
  });

  // precise cells
  const cellsEl = root.querySelector('.eqx-cells');
  cellsEl.style.setProperty('--n', bands.length);
  const cells = bands.map((b, i) => {
    const el = document.createElement('div');
    el.className = 'eqx-cell';
    el.innerHTML = `<button type="button" class="eqx-step" data-d="1" aria-label="Raise ${b.label}">+</button>
      <output class="eqx-val" tabindex="0" role="slider" aria-label="${b.label}" aria-valuemin="${-range}" aria-valuemax="${range}"></output>
      <button type="button" class="eqx-step" data-d="-1" aria-label="Lower ${b.label}">−</button>
      <span class="eqx-name">${b.label}</span>`;
    el.addEventListener('click', (e) => { const d = e.target.closest('.eqx-step')?.dataset.d; if (d) bump(i, Number(d) * step, true); });
    const val = el.querySelector('.eqx-val');
    val.addEventListener('keydown', (e) => {
      const d = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 2, PageDown: -2 }[e.key];
      if (e.key === 'Home' || e.key === '0') { e.preventDefault(); setOne(i, 0, true); }
      else if (d) { e.preventDefault(); bump(i, d, true); }
    });
    el.addEventListener('wheel', (e) => { if (!enabled) return; e.preventDefault(); bump(i, e.deltaY < 0 ? step : -step, true); }, { passive: false });
    val.addEventListener('dblclick', () => setOne(i, 0, true));
    cellsEl.append(el);
    return el;
  });

  function renderCells() {
    cells.forEach((el, i) => {
      const v = gains[i], out = el.querySelector('.eqx-val');
      out.textContent = fmtDb(v);
      out.setAttribute('aria-valuenow', String(v));
      el.dataset.sign = v > 0 ? 'up' : v < 0 ? 'down' : 'zero';
      el.querySelectorAll('button').forEach((b) => (b.disabled = !enabled));
    });
  }
  function emit(final) { renderCells(); loop.start(); onChange?.(gains.slice(), final); }
  function setOne(i, v, final) { if (!enabled) return; gains[i] = snap(v); emit(final); }
  function bump(i, d, final) { setOne(i, gains[i] + d, final); }

  // dragging on the graph: nearest band by frequency
  const toCanvas = (e) => { const rc = canvas.getBoundingClientRect(); return [(e.clientX - rc.left) * (w / rc.width), (e.clientY - rc.top) * (h / rc.height)]; };
  const nearest = (x) => bands.reduce((best, b, i) => (Math.abs(xOf(b.freq) - x) < Math.abs(xOf(bands[best].freq) - x) ? i : best), 0);
  canvas.addEventListener('pointerdown', (e) => {
    if (!enabled) return;
    const [x, y] = toCanvas(e);
    dragging = nearest(x);
    canvas.setPointerCapture(e.pointerId);
    setOne(dragging, dbOfY(y), false);
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = toCanvas(e);
    if (dragging >= 0) setOne(dragging, dbOfY(y), false);
    else { const n = enabled ? nearest(x) : -1; if (n !== hover) { hover = n; loop.start(); } }
  });
  const end = () => { if (dragging >= 0) { dragging = -1; emit(true); } };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (hover !== -1) { hover = -1; loop.start(); } });

  renderCells();
  return {
    set(values) { if (dragging >= 0) return; gains = values.map((v) => snap(Number(v) || 0)); renderCells(); loop.start(); },
    get: () => gains.slice(),
    setEnabled(on) { enabled = !!on; root.dataset.disabled = String(!enabled); renderCells(); loop.start(); },
    refreshColors() { fg = cssRgb('--fg-rgb'); accent = cssRgb('--accent-rgb'); loop.start(); },
  };
}
