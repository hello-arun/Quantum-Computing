/*
 * bloch.js: draws Bloch spheres on canvas. All spheres share one viewing
 * angle, so dragging any of them turns every sphere and they stay comparable.
 */
(function (root) {
  'use strict';

  const view = { yaw: -0.65, pitch: 0.32 };

  /** Orthographic projection: returns screen offsets (u right, v up) and depth d. */
  function project(x, y, z) {
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
    const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const x1 = x * cy - y * sy;
    const y1 = x * sy + y * cy;
    return { u: y1, v: z * cp - x1 * sp, d: x1 * cp + z * sp };
  }

  function colors() {
    const css = getComputedStyle(document.documentElement);
    const get = (name) => css.getPropertyValue(name).trim();
    return { line: get('--sphere-line'), back: get('--sphere-back'), text: get('--sphere-text'), accent: get('--accent'), surface: get('--surface') };
  }

  /** Draws a circle in 3D, front half solid and back half faint. */
  function ring(ctx, cx, cy, R, c, point) {
    const STEPS = 72;
    for (const front of [false, true]) {
      ctx.beginPath();
      ctx.strokeStyle = front ? c.line : c.back;
      let drawing = false;
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS * 2 * Math.PI;
        const [x, y, z] = point(t);
        const p = project(x, y, z);
        if ((p.d >= 0) === front) {
          const sx = cx + p.u * R, sy = cy - p.v * R;
          if (drawing) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
          drawing = true;
        } else {
          drawing = false;
        }
      }
      ctx.stroke();
    }
  }

  function draw(canvas) {
    const size = canvas._size;
    const r = canvas._vec;
    const dpr = root.devicePixelRatio || 1;
    if (canvas.width !== size * dpr) {
      canvas.width = canvas.height = size * dpr;
      canvas.style.width = canvas.style.height = `${size}px`;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const c = colors();
    const large = size >= 110;
    const R = size * (large ? 0.37 : 0.42);
    const cx = size / 2, cy = size / 2;

    ctx.lineWidth = 1;
    ctx.strokeStyle = c.line;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
    ring(ctx, cx, cy, R, c, (t) => [Math.cos(t), Math.sin(t), 0]);
    if (large) ring(ctx, cx, cy, R, c, (t) => [Math.cos(t), 0, Math.sin(t)]);

    // Axes
    const axes = [[[0, 0, 1], '|0⟩'], [[0, 0, -1], '|1⟩'], [[1, 0, 0], '|+⟩'], [[0, 1, 0], '|+i⟩']];
    ctx.font = `${large ? 12 : 9}px "Cambria Math", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [[x, y, z], label] of axes) {
      const p = project(x, y, z);
      ctx.strokeStyle = c.back;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + p.u * R, cy - p.v * R); ctx.stroke();
      const showLabel = large || z !== 0;
      if (showLabel) {
        ctx.fillStyle = c.text;
        const gap = large ? 1.2 : 1.16;
        ctx.fillText(label, cx + p.u * R * gap, Math.min(size - 6, Math.max(6, cy - p.v * R * gap)));
      }
    }

    // State vector
    const tip = project(r.x, r.y, r.z);
    const tx = cx + tip.u * R, ty = cy - tip.v * R;
    const len = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
    ctx.strokeStyle = ctx.fillStyle = c.accent;
    if (len > 0.02) {
      ctx.lineWidth = large ? 2.5 : 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(tx, ty, large ? 5 : 4, 0, 2 * Math.PI); ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = c.surface;
    ctx.stroke();
  }

  function redrawAll() {
    document.querySelectorAll('canvas.bloch').forEach(draw);
  }

  /** Creates a sphere canvas showing Bloch vector r. */
  function create(r, size = 150) {
    const canvas = document.createElement('canvas');
    canvas.className = 'bloch';
    canvas._vec = r;
    canvas._size = size;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Bloch vector x=${r.x.toFixed(2)}, y=${r.y.toFixed(2)}, z=${r.z.toFixed(2)}`);
    canvas.title = 'Drag to rotate all spheres';
    draw(canvas);
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      let lx = e.clientX, ly = e.clientY;
      const move = (m) => {
        view.yaw += (m.clientX - lx) * 0.012;
        view.pitch = Math.max(-1.5, Math.min(1.5, view.pitch + (m.clientY - ly) * 0.012));
        lx = m.clientX; ly = m.clientY;
        redrawAll();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    return canvas;
  }

  root.Bloch = { create, redrawAll };
})(window);
