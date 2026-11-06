/*
 * app.js: the circuit editor and result views. All physics lives in quantum.js.
 */
(function () {
  'use strict';
  const Q = window.QSim;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const MIN_QUBITS = 1, MAX_QUBITS = 5, MAX_MEASUREMENTS = 10, MIN_COLS = 8;
  const CELL = { w: 58, h: 58, left: 78, top: 22, box: 40 };
  const SHOT_CHOICES = [1, 10, 100, 1000, 10000];

  const S = {
    n: 2,
    ops: [],
    nextId: 1,
    selected: null,   // id of the selected op
    armed: null,      // palette gate placed by clicking a cell
    viewCol: null,    // step shown on the State tab; null means the end of the circuit
    branchView: 'avg',
    tab: 'state',
    shots: 1000,
    counts: {},       // sampled counts on the Run tab, by result key
    total: 0,
    picked: null,     // result selected on the Run tab
    flash: null,
    message: '',
    compare: { a: [0], b: [0, 1] },
    compareCounts: { a: {}, b: {} },
    compareTotal: 0,
    openLab: 0,
    undo: [],
  };

  // ---- Small helpers ----

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c != null && c !== false) el.append(c);
    }
    return el;
  }

  function s(tag, attrs = {}, parent) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (parent) parent.append(el);
    return el;
  }

  const $ = (id) => document.getElementById(id);
  const allQubits = () => Array.from({ length: S.n }, (_, i) => i);
  const qNames = (list) => list.map((q) => `q${q}`).join(', ');
  const sortedOps = () => S.ops.slice().sort((a, b) => a.col - b.col || Math.min(...a.qubits) - Math.min(...b.qubits));
  const lastCol = () => S.ops.reduce((m, o) => Math.max(m, o.col), -1);
  const percent = (p) => `${(p * 100).toFixed(p > 0 && p < 0.001 ? 2 : 1)}%`;

  let toastTimer;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /** Probability as an exact fraction when it is one, for the comparison table. */
  function formatProbability(p) {
    if (p < 1e-9) return '0';
    if (Math.abs(p - 1) < 1e-9) return '1';
    for (const d of [2, 3, 4, 6, 8, 16, 32, 64]) {
      const a = p * d;
      if (Math.abs(a - Math.round(a)) < 1e-9 && Math.round(a) > 0) {
        const gcd = (x, y) => (y ? gcd(y, x % y) : x);
        const g = gcd(Math.round(a), d);
        return `${Math.round(a) / g}/${d / g}`;
      }
    }
    return p.toFixed(3);
  }

  function formatComplex(re, im) {
    const f = (v) => v.toFixed(3);
    if (Math.abs(im) < 1e-6) return f(re);
    if (Math.abs(re) < 1e-6) return `${f(im)}i`;
    return `${f(re)} ${im < 0 ? '−' : '+'} ${f(Math.abs(im))}i`;
  }

  function matrixEntry([re, im]) {
    const mag = Math.hypot(re, im);
    if (mag < 1e-9) return '0';
    const phi = Math.atan2(im, re);
    const m = Q.formatMagnitude(mag);
    const body = m === '1' ? '' : m;
    if (Math.abs(phi) < 1e-9) return body || '1';
    if (Math.abs(Math.abs(phi) - Math.PI) < 1e-9) return `−${body || '1'}`;
    if (Math.abs(phi - Math.PI / 2) < 1e-9) return `${body}i`;
    if (Math.abs(phi + Math.PI / 2) < 1e-9) return `−${body}i`;
    return `${body}${body ? ' ' : ''}e^(i${Q.formatAngle(phi)})`;
  }

  const TWO_QUBIT_MATRICES = {
    CX: ['1', '0', '0', '0', '0', '1', '0', '0', '0', '0', '0', '1', '0', '0', '1', '0'],
    CZ: ['1', '0', '0', '0', '0', '1', '0', '0', '0', '0', '1', '0', '0', '0', '0', '−1'],
    SWAP: ['1', '0', '0', '0', '0', '0', '1', '0', '0', '1', '0', '0', '0', '0', '0', '1'],
  };

  // ---- Model changes ----

  function snapshot() {
    return JSON.stringify({ n: S.n, ops: S.ops, compare: S.compare });
  }

  /** Every edit goes through here so that undo, the URL and the views stay in step. */
  function commit(change) {
    const before = snapshot();
    change();
    compact();
    if (snapshot() !== before) {
      S.undo.push(before);
      if (S.undo.length > 100) S.undo.shift();
    }
    circuitChanged();
  }

  function circuitChanged() {
    S.viewCol = null;
    S.branchView = 'avg';
    resetSamples();
    writeHash();
    renderAll();
  }

  function resetSamples() {
    S.counts = {};
    S.total = 0;
    S.picked = null;
    S.flash = null;
    S.message = '';
    S.compareCounts = { a: {}, b: {} };
    S.compareTotal = 0;
  }

  /** Removes fully empty columns, so every step on the slider does something. */
  function compact() {
    const cols = [...new Set(S.ops.map((o) => o.col))].sort((a, b) => a - b);
    const index = new Map(cols.map((c, i) => [c, i]));
    S.ops.forEach((o) => { o.col = index.get(o.col); });
  }

  const spanOf = (qubits) => [Math.min(...qubits), Math.max(...qubits)];
  const overlaps = (a, b) => a[0] <= b[1] && b[0] <= a[1];

  /** Puts an op in a cell. If the cell is taken, later columns shift right. */
  function placeOp(op, col, qubits) {
    S.ops = S.ops.filter((o) => o.id !== op.id);
    const span = spanOf(qubits);
    if (S.ops.some((o) => o.col === col && overlaps(spanOf(o.qubits), span))) {
      S.ops.forEach((o) => { if (o.col >= col) o.col += 1; });
    }
    op.col = col;
    op.qubits = qubits;
    S.ops.push(op);
  }

  function addGate(gate, col, wire) {
    const g = Q.GATES[gate];
    if (gate === 'M' && S.ops.filter((o) => o.gate === 'M').length >= MAX_MEASUREMENTS) {
      toast(`This lab supports up to ${MAX_MEASUREMENTS} measurements per circuit.`);
      return;
    }
    if (g.arity === 2 && S.n < 2) return;
    const qubits = g.arity === 2 ? [wire, wire < S.n - 1 ? wire + 1 : wire - 1] : [wire];
    const op = { id: S.nextId++, gate, col, qubits };
    if (g.hasAngle) op.theta = Math.PI / 2;
    commit(() => {
      placeOp(op, col, qubits);
      S.selected = op.id;
    });
  }

  function removeOp(id) {
    commit(() => {
      S.ops = S.ops.filter((o) => o.id !== id);
      if (S.selected === id) S.selected = null;
    });
  }

  function setQubits(n) {
    if (n < MIN_QUBITS || n > MAX_QUBITS || n === S.n) return;
    commit(() => {
      S.n = n;
      S.ops = S.ops.filter((o) => o.qubits.every((q) => q < n));
      S.compare = { a: [0], b: Array.from({ length: n }, (_, i) => i) };
      S.selected = null;
    });
  }

  function measureAll() {
    const lastOnWire = (q) => sortedOps().filter((o) => o.qubits.includes(q)).pop();
    const needed = allQubits().filter((q) => { const op = lastOnWire(q); return !op || op.gate !== 'M'; });
    if (!needed.length) { toast('Every qubit already ends in a measurement.'); return; }
    if (S.ops.filter((o) => o.gate === 'M').length + needed.length > MAX_MEASUREMENTS) {
      toast(`This lab supports up to ${MAX_MEASUREMENTS} measurements per circuit.`);
      return;
    }
    const col = lastCol() + 1;
    commit(() => {
      needed.forEach((q) => S.ops.push({ id: S.nextId++, gate: 'M', col, qubits: [q] }));
    });
  }

  function measureOne(q) {
    const col = lastCol() + 1;
    commit(() => S.ops.push({ id: S.nextId++, gate: 'M', col, qubits: [q] }));
  }

  function undo() {
    const prev = S.undo.pop();
    if (!prev) return;
    const data = JSON.parse(prev);
    S.n = data.n;
    S.ops = data.ops;
    S.compare = data.compare;
    S.selected = null;
    circuitChanged();
  }

  function loadOps(n, list) {
    S.n = n;
    S.ops = list.map(([gate, qubits, col, theta]) => {
      const op = { id: S.nextId++, gate, qubits: qubits.slice(), col };
      if (theta !== undefined) op.theta = theta;
      return op;
    });
    S.selected = null;
  }

  function loadLab(lab) {
    commit(() => {
      loadOps(lab.n, lab.ops);
      S.compare = lab.compare
        ? { a: lab.compare.a.slice(), b: lab.compare.b.slice() }
        : { a: [0], b: Array.from({ length: lab.n }, (_, i) => i) };
    });
    S.tab = lab.tab;
    renderAll();
  }

  // ---- Shareable links: the whole circuit lives in the URL hash ----

  function writeHash() {
    const data = { n: S.n, o: sortedOps().map((o) => (o.theta !== undefined ? [o.gate, o.qubits, o.col, +o.theta.toFixed(6)] : [o.gate, o.qubits, o.col])) };
    const hash = `#c=${encodeURIComponent(JSON.stringify(data))}`;
    try { history.replaceState(null, '', hash); } catch (e) { location.hash = hash; }
  }

  function readHash() {
    const match = location.hash.match(/^#c=(.+)$/);
    if (!match) return false;
    try {
      const data = JSON.parse(decodeURIComponent(match[1]));
      const n = Number(data.n);
      if (!(n >= MIN_QUBITS && n <= MAX_QUBITS) || !Array.isArray(data.o)) return false;
      const valid = data.o.filter(([gate, qubits, col]) => Q.GATES[gate] && Array.isArray(qubits)
        && qubits.every((q) => Number.isInteger(q) && q >= 0 && q < n) && Number.isInteger(col) && col >= 0
        && qubits.length === (Q.GATES[gate].arity || 1) && (qubits.length < 2 || qubits[0] !== qubits[1]));
      loadOps(n, valid.slice(0, 200));
      S.compare = { a: [0], b: allQubits() };
      compact();
      return true;
    } catch (e) {
      return false;
    }
  }

  async function copyLink() {
    writeHash();
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copied. Anyone who opens it gets this circuit.');
    } catch (e) {
      toast('Could not reach the clipboard. Copy the address from your browser instead.');
    }
  }

  // ---- Palette ----

  const PALETTE_GROUPS = [
    ['Pauli', ['X', 'Y', 'Z']],
    ['Superposition', ['H']],
    ['Phase', ['S', 'Sdg', 'T', 'Tdg']],
    ['Rotation', ['Rx', 'Ry', 'Rz']],
    ['Two-qubit', ['CX', 'CZ', 'SWAP']],
    ['Measure', ['M']],
  ];

  const chipLabel = (gate) => Q.GATES[gate].label || gate;

  function renderPalette() {
    const root = $('palette');
    root.replaceChildren(...PALETTE_GROUPS.map(([name, gates]) => h('div', { class: 'palette-group' },
      h('span', {}, name),
      gates.map((gate) => {
        const g = Q.GATES[gate];
        const chip = h('button', {
          class: `gate-chip k-${g.kind}${S.armed === gate ? ' armed' : ''}`,
          type: 'button',
          title: `${g.name}: ${g.about}`,
          disabled: g.arity === 2 && S.n < 2,
          'aria-pressed': S.armed === gate ? 'true' : 'false',
          'data-gate': gate,
        }, chipLabel(gate));
        chip.addEventListener('pointerdown', (e) => startPaletteDrag(e, gate));
        chip.addEventListener('click', () => {
          if (dragJustEnded) return;
          S.armed = S.armed === gate ? null : gate;
          renderPalette();
          if (S.armed) toast('Click a cell on the circuit to place it. Press Esc when you are done.');
        });
        return chip;
      }))));
  }

  // ---- Circuit drawing ----

  const cellX = (c) => CELL.left + c * CELL.w + CELL.w / 2;
  const wireY = (q) => CELL.top + q * CELL.h + CELL.h / 2;

  function columnCount() {
    return Math.max(MIN_COLS, lastCol() + 3);
  }

  function drawPart(group, op, part, x, y) {
    const g = Q.GATES[op.gate];
    const b = CELL.box;
    const node = s('g', { 'data-op': op.id, 'data-part': part }, group);
    s('rect', { class: 'hit', x: x - CELL.w / 2 + 2, y: y - CELL.h / 2 + 2, width: CELL.w - 4, height: CELL.h - 4 }, node);
    if (op.gate === 'M') {
      s('rect', { class: 'gate-box', x: x - b / 2, y: y - b / 2, width: b, height: b, rx: 6 }, node);
      s('path', { class: 'meter', d: `M ${x - 12} ${y + 8} A 12 12 0 0 1 ${x + 12} ${y + 8}` }, node);
      s('path', { class: 'meter', d: `M ${x} ${y + 8} L ${x + 8} ${y - 7}` }, node);
    } else if (g.arity === 2) {
      if (op.gate === 'SWAP') {
        s('path', { class: 'swap-x', d: `M ${x - 8} ${y - 8} L ${x + 8} ${y + 8} M ${x + 8} ${y - 8} L ${x - 8} ${y + 8}` }, node);
      } else if (op.gate === 'CX' && part === 1) {
        s('circle', { class: 'target-ring', cx: x, cy: y, r: 13 }, node);
        s('path', { class: 'target-plus', d: `M ${x - 13} ${y} L ${x + 13} ${y} M ${x} ${y - 13} L ${x} ${y + 13}` }, node);
      } else {
        s('circle', { class: 'ctrl-dot', cx: x, cy: y, r: 7 }, node);
      }
    } else {
      s('rect', { class: 'gate-box', x: x - b / 2, y: y - b / 2, width: b, height: b, rx: 6 }, node);
      if (g.hasAngle) {
        s('text', { class: 'gate-text', x, y: y - 7 }, node).textContent = chipLabel(op.gate);
        s('text', { class: 'gate-angle', x, y: y + 10 }, node).textContent = Q.formatAngle(op.theta);
      } else {
        s('text', { class: 'gate-text', x, y }, node).textContent = chipLabel(op.gate);
      }
    }
  }

  function renderCircuit() {
    const svg = $('circuit');
    const cols = columnCount();
    const width = CELL.left + cols * CELL.w + 14;
    const height = CELL.top + S.n * CELL.h + 8;
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren();

    if (S.viewCol !== null && S.viewCol >= 0) {
      s('rect', { class: 'view-band', x: CELL.left + S.viewCol * CELL.w, y: 0, width: CELL.w, height }, svg);
    }
    for (let c = 0; c < cols; c++) {
      s('text', { class: 'col-num', x: cellX(c), y: 14 }, svg).textContent = c + 1;
    }
    for (let q = 0; q < S.n; q++) {
      const y = wireY(q);
      s('line', { class: 'wire', x1: CELL.left - 6, y1: y, x2: width - 6, y2: y }, svg);
      const label = s('text', { class: 'wire-label', x: 10, y: y + 5 }, svg);
      label.textContent = `q${q}`;
      const init = s('text', { class: 'wire-init', x: 38, y: y + 5 }, svg);
      init.textContent = '|0⟩';
    }
    s('rect', { class: 'drop-preview', id: 'drop-preview', x: 0, y: 0, width: 0, height: 0 }, svg);

    for (const op of S.ops) {
      const g = Q.GATES[op.gate];
      const future = S.viewCol !== null && op.col > S.viewCol;
      const group = s('g', { class: `op k-${g.kind}${future ? ' future' : ''}` }, svg);
      const x = cellX(op.col);
      if (op.qubits.length === 2) {
        s('line', { class: 'link', x1: x, y1: wireY(op.qubits[0]), x2: x, y2: wireY(op.qubits[1]) }, group);
      }
      op.qubits.forEach((q, part) => drawPart(group, op, part, x, wireY(q)));
      if (op.id === S.selected) {
        const [lo, hi] = spanOf(op.qubits);
        s('rect', {
          class: 'selected-ring', x: x - CELL.w / 2 + 3, y: wireY(lo) - CELL.h / 2 + 3,
          width: CELL.w - 6, height: wireY(hi) - wireY(lo) + CELL.h - 6, rx: 8,
        }, group);
      }
    }
  }

  // ---- Drag and drop ----

  let drag = null;
  let dragJustEnded = false;

  function cellAt(clientX, clientY) {
    const rect = $('circuit').getBoundingClientRect();
    const scroller = $('circuit-scroll').getBoundingClientRect();
    if (clientX < scroller.left || clientX > scroller.right || clientY < rect.top || clientY > rect.bottom) return null;
    const x = clientX - rect.left, y = clientY - rect.top;
    const col = Math.floor((x - CELL.left) / CELL.w);
    const wire = Math.floor((y - CELL.top) / CELL.h);
    if (col < 0 || wire < 0 || wire >= S.n) return null;
    return { col, wire };
  }

  function showPreview(cell, span) {
    const p = $('drop-preview');
    if (!p) return;
    if (!cell) { p.setAttribute('width', 0); return; }
    const [lo, hi] = span || [cell.wire, cell.wire];
    p.setAttribute('x', CELL.left + cell.col * CELL.w);
    p.setAttribute('y', CELL.top + lo * CELL.h);
    p.setAttribute('width', CELL.w);
    p.setAttribute('height', (hi - lo + 1) * CELL.h);
  }

  function startDrag(e, info) {
    e.preventDefault();
    drag = { ...info, startX: e.clientX, startY: e.clientY, moved: false, ghost: null };
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragCancel);
  }

  function startPaletteDrag(e, gate) {
    if (e.button !== 0 || e.currentTarget.disabled) return;
    startDrag(e, { kind: 'new', gate });
  }

  function previewSpan(cell) {
    if (drag.kind === 'new') {
      if (Q.GATES[drag.gate].arity !== 2) return null;
      return spanOf([cell.wire, cell.wire < S.n - 1 ? cell.wire + 1 : cell.wire - 1]);
    }
    const op = S.ops.find((o) => o.id === drag.id);
    if (!op || op.qubits.length !== 2) return null;
    const other = op.qubits[1 - drag.part];
    return spanOf([cell.wire, other]);
  }

  function onDragMove(e) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      const gate = drag.kind === 'new' ? drag.gate : S.ops.find((o) => o.id === drag.id).gate;
      drag.ghost = h('div', { class: `gate-chip gate-ghost k-${Q.GATES[gate].kind}` }, chipLabel(gate));
      document.body.append(drag.ghost);
    }
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY}px`;
    const cell = cellAt(e.clientX, e.clientY);
    showPreview(cell, cell && previewSpan(cell));
  }

  function endDragListeners() {
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragCancel);
    if (drag && drag.ghost) drag.ghost.remove();
  }

  function onDragCancel() {
    endDragListeners();
    drag = null;
    showPreview(null);
  }

  function onDragEnd(e) {
    endDragListeners();
    const d = drag;
    drag = null;
    showPreview(null);
    if (!d) return;
    if (!d.moved) {
      if (d.kind === 'move') {
        S.selected = d.id;
        renderCircuit();
        renderInspector();
      }
      return;
    }
    dragJustEnded = true;
    setTimeout(() => { dragJustEnded = false; }, 0);
    const cell = cellAt(e.clientX, e.clientY);
    if (d.kind === 'new') {
      if (cell) addGate(d.gate, cell.col, cell.wire);
      return;
    }
    const op = S.ops.find((o) => o.id === d.id);
    if (!cell) {
      removeOp(d.id);
      toast('Gate removed. Undo brings it back.');
      return;
    }
    const qubits = op.qubits.slice();
    if (qubits.length === 2 && qubits[1 - d.part] === cell.wire) {
      qubits.reverse();
    } else {
      qubits[d.part] = cell.wire;
    }
    commit(() => {
      placeOp(op, cell.col, qubits);
      S.selected = op.id;
    });
  }

  function wireCircuitEvents() {
    const svg = $('circuit');
    svg.addEventListener('pointerdown', (e) => {
      const node = e.target.closest('[data-op]');
      if (node && e.button === 0) {
        startDrag(e, { kind: 'move', id: Number(node.dataset.op), part: Number(node.dataset.part) });
        return;
      }
      if (!node && S.armed) {
        const cell = cellAt(e.clientX, e.clientY);
        if (cell) addGate(S.armed, cell.col, cell.wire);
        return;
      }
      if (!node && S.selected !== null) {
        S.selected = null;
        renderCircuit();
        renderInspector();
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (drag || !S.armed) return;
      const cell = cellAt(e.clientX, e.clientY);
      showPreview(cell);
    });
    svg.addEventListener('pointerleave', () => { if (!drag) showPreview(null); });
    svg.addEventListener('contextmenu', (e) => {
      const node = e.target.closest('[data-op]');
      if (node) {
        e.preventDefault();
        removeOp(Number(node.dataset.op));
      }
    });
  }

  // ---- Inspector ----

  function matrixView(gate, theta) {
    const g = Q.GATES[gate];
    if (gate === 'M') return null;
    const entries = g.arity === 2 ? TWO_QUBIT_MATRICES[gate] : g.matrix(theta).map(matrixEntry);
    const size = g.arity === 2 ? 4 : 2;
    return h('div', { class: 'matrix', style: `grid-template-columns: repeat(${size}, auto)`, 'aria-label': 'Gate matrix' },
      entries.map((e) => h('span', {}, e)));
  }

  function renderInspector() {
    const root = $('inspector');
    const op = S.ops.find((o) => o.id === S.selected);
    if (!op) {
      root.replaceChildren(
        h('h3', {}, 'Build your circuit'),
        h('ul', {},
          h('li', {}, 'Drag a gate onto a wire, or click a gate and then a cell.'),
          h('li', {}, 'Dropping on an occupied cell inserts a new column there.'),
          h('li', {}, 'Click a placed gate for details.'),
          h('li', {}, 'Drag a gate to move it. Drag a control or target dot to change its wire.'),
          h('li', {}, 'Drag a gate off the circuit, or right-click it, to delete.')),
      );
      return;
    }
    const g = Q.GATES[op.gate];
    const children = [h('h3', {}, g.name), h('p', { class: 'about' }, g.about), matrixView(op.gate, op.theta)];
    if (g.hasAngle) {
      const value = h('strong', { id: 'angle-value' }, Q.formatAngle(op.theta));
      const slider = h('input', {
        type: 'range', min: 0, max: 24, step: 1, value: Math.round(op.theta / (Math.PI / 12)), 'aria-label': 'Rotation angle θ',
      });
      slider.addEventListener('pointerdown', () => { S.undo.push(snapshot()); });
      slider.addEventListener('input', () => {
        op.theta = Number(slider.value) * Math.PI / 12;
        value.textContent = Q.formatAngle(op.theta);
        resetSamples();
        writeHash();
        const matrix = root.querySelector('.matrix');
        if (matrix) matrix.replaceWith(matrixView(op.gate, op.theta));
        renderCircuit();
        renderPanel();
      });
      children.push(h('label', {}, h('span', {}, 'Angle θ = ', value), slider));
    }
    if (g.arity === 2) {
      const makePicker = (labelText, part) => {
        const picker = h('select', { 'aria-label': labelText }, allQubits().map((q) => h('option', { value: q, selected: op.qubits[part] === q }, `q${q}`)));
        picker.addEventListener('change', () => {
          const chosen = Number(picker.value);
          const qubits = op.qubits.slice();
          if (qubits[1 - part] === chosen) qubits.reverse();
          else qubits[part] = chosen;
          commit(() => placeOp(op, op.col, qubits));
        });
        return h('label', {}, labelText, picker);
      };
      const symmetric = op.gate === 'SWAP';
      children.push(h('div', { class: 'qubit-pickers' },
        makePicker(symmetric ? 'Qubit A' : 'Control', 0),
        makePicker(symmetric ? 'Qubit B' : 'Target', 1)));
    }
    children.push(h('div', {}, h('button', { class: 'btn', type: 'button', onclick: () => removeOp(op.id) }, 'Delete gate')));
    root.replaceChildren(...children.filter(Boolean));
  }

  // ---- Step slider ----

  function renderScrub() {
    const root = $('scrub');
    const steps = lastCol() + 1;
    if (steps === 0) {
      root.replaceChildren(h('span', {}, 'All qubits start in |0⟩. Add a gate to begin.'));
      return;
    }
    const position = S.viewCol === null ? steps : S.viewCol + 1;
    const label = h('span', { id: 'scrub-label' }, scrubText(position, steps));
    const slider = h('input', { id: 'scrub-range', type: 'range', min: 0, max: steps, value: position, 'aria-label': 'Step through the circuit' });
    const go = (v) => {
      const next = Math.max(0, Math.min(steps, v));
      S.viewCol = next === steps ? null : next - 1;
      S.branchView = 'avg';
      if (S.tab !== 'state') S.tab = 'state';
      slider.value = next;
      label.textContent = scrubText(next, steps);
      renderCircuit();
      renderTabs();
      renderPanel();
    };
    slider.addEventListener('input', () => go(Number(slider.value)));
    root.replaceChildren(
      h('span', {}, 'Step through'),
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Previous step', onclick: () => go(Number(slider.value) - 1) }, '◀'),
      slider,
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Next step', onclick: () => go(Number(slider.value) + 1) }, '▶'),
      label,
    );
  }

  function scrubText(position, steps) {
    if (position === 0) return 'Start: before any gate';
    if (position === steps) return `End of circuit (step ${steps})`;
    return `After step ${position} of ${steps}`;
  }

  // ---- Result views ----

  function renderTabs() {
    document.querySelectorAll('.tab').forEach((t) => {
      t.setAttribute('aria-selected', t.dataset.tab === S.tab ? 'true' : 'false');
    });
  }

  function renderPanel() {
    const panel = $('panel');
    if (S.tab === 'state') panel.replaceChildren(...statePanel());
    else if (S.tab === 'measure') panel.replaceChildren(...measurePanel());
    else panel.replaceChildren(...comparePanel());
  }

  const recordKey = (b) => b.record.map((r) => r.bit).join('');
  const recordText = (b) => b.record.map((r) => `q${r.q}=${r.bit}`).join(', ');

  function blochCard(q, r, single) {
    const len = Q.blochLength(r);
    const p1 = (1 - r.z) / 2;
    let verdict;
    if (len > 1 - 1e-6) verdict = 'Pure: full-length arrow';
    else if (single) verdict = len < 1e-6 ? 'Maximally entangled' : 'Partly entangled';
    else verdict = len < 1e-6 ? 'Fully mixed on average' : 'Mixed on average';
    const angles = Q.blochAngles(r);
    let anglesText = 'no direction';
    if (len > 1e-6) {
      anglesText = `θ = ${Q.formatAngle(angles.theta)}`;
      if (angles.phi !== null) anglesText += `, φ = ${Q.formatAngle(angles.phi)}`;
    }
    return h('div', { class: 'bloch-card' },
      h('h4', {}, `q${q}`),
      Bloch.create(r, 170),
      h('div', { class: 'verdict' }, verdict),
      h('div', { class: 'facts' }, `P(1) = ${formatProbability(p1)} · |r| = ${len.toFixed(2)}`),
      h('div', { class: 'facts' }, anglesText));
  }

  function statePanel() {
    const branches = Q.simulate(S.n, sortedOps(), S.viewCol === null ? Infinity : S.viewCol);
    const out = [];
    const many = branches.length > 1;
    if (many) {
      const options = [['avg', 'Average over all results']].concat(
        branches.slice(0, 16).map((b, i) => [String(i), `${recordText(b)} (${percent(b.p)})`]));
      out.push(h('div', {},
        h('div', { class: 'section-title' }, 'A measurement has split this run into branches. Show:'),
        h('div', { class: 'chips' }, options.map(([value, text]) => h('button', {
          class: 'chip', type: 'button', 'aria-pressed': S.branchView === value ? 'true' : 'false',
          onclick: () => { S.branchView = value; renderPanel(); },
        }, text)))));
    }
    const chosen = !many ? branches[0] : S.branchView === 'avg' ? null : branches[Number(S.branchView)];

    if (chosen) {
      out.push(h('div', { class: 'state-line' },
        h('div', { class: 'section-title' }, many ? 'State on this branch' : 'Full state'),
        h('div', { class: 'ket' }, Q.formatKet(chosen.state, S.n))));
    } else {
      out.push(h('p', { class: 'muted' }, `Before reading the result, the qubits are in a statistical mixture of ${branches.length} possible states. The arrows below are probability-weighted averages, so they shrink towards the centre.`));
    }

    out.push(h('div', { class: 'bloch-row' }, allQubits().map((q) => blochCard(
      q,
      chosen ? Q.blochVector(chosen.state, S.n, q) : Q.averageBloch(branches, S.n, q),
      Boolean(chosen),
    ))));

    const size = 1 << S.n;
    const rows = [];
    for (let i = 0; i < size; i++) {
      let p = 0;
      if (chosen) p = chosen.state.re[i] ** 2 + chosen.state.im[i] ** 2;
      else branches.forEach((b) => { p += b.p * (b.state.re[i] ** 2 + b.state.im[i] ** 2); });
      if (p < 1e-9) continue;
      const bits = i.toString(2).padStart(S.n, '0');
      rows.push(h('tr', {},
        h('td', { class: 'ket-small' }, `|${bits}⟩`),
        chosen && h('td', {}, formatComplex(chosen.state.re[i], chosen.state.im[i])),
        chosen && h('td', {}, Q.formatAngle(Math.atan2(chosen.state.im[i], chosen.state.re[i]))),
        h('td', {}, formatProbability(p)),
        h('td', { class: 'bar-cell' }, h('div', { class: 'mini-bar', style: `width:${p * 100}%` }))));
    }
    out.push(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Basis state'),
        chosen && h('th', {}, 'Amplitude'),
        chosen && h('th', {}, 'Phase'),
        h('th', {}, 'Probability'),
        h('th', {}, ''))),
      h('tbody', {}, rows))));
    return out;
  }

  function runShots(branches, shots) {
    const counts = Q.sample(branches, shots);
    counts.forEach((c, i) => {
      if (c) {
        const key = recordKey(branches[i]);
        S.counts[key] = (S.counts[key] || 0) + c;
      }
    });
    S.total += shots;
    S.flash = null;
    S.message = `Ran ${shots.toLocaleString()} shot${shots === 1 ? '' : 's'}. Total: ${S.total.toLocaleString()}.`;
    renderPanel();
  }

  function measureOnce(branches) {
    const b = branches[Q.sampleOne(branches)];
    const key = recordKey(b);
    S.counts[key] = (S.counts[key] || 0) + 1;
    S.total += 1;
    S.picked = key;
    S.flash = key;
    S.message = `Shot ${S.total}: read ${recordText(b)}.`;
    renderPanel();
  }

  /** Says what happened to qubits that no measurement touched directly. */
  function unmeasuredNote(branches, branch, unmeasured) {
    if (!unmeasured.length) return 'Every qubit was measured.';
    const isDefinite = (r) => Math.abs(r.z) > 1 - 1e-9;
    const collapsed = unmeasured.filter((q) => isDefinite(Q.blochVector(branch.state, S.n, q))
      && !isDefinite(Q.averageBloch(branches, S.n, q)));
    const others = unmeasured.filter((q) => !collapsed.includes(q));
    const notes = [];
    if (collapsed.length) {
      notes.push(`${qNames(collapsed)} never met a measurement but now has a definite value, because it was correlated with what was read.`);
    }
    if (others.length) {
      notes.push(`Not measured: ${qNames(others)}. See its sphere for what is left.`);
    }
    return notes.join(' ');
  }

  function measurePanel() {
    const branches = Q.simulate(S.n, sortedOps());
    const hasM = S.ops.some((o) => o.gate === 'M');
    if (!hasM) {
      return [h('div', { class: 'empty' },
        h('h3', {}, 'No measurement in this circuit yet'),
        h('p', { class: 'muted' }, 'Until something reads the qubits, there are no results to show. Add a measurement to see the outcomes.'),
        h('div', { class: 'controls' },
          h('button', { class: 'btn primary', type: 'button', onclick: measureAll }, 'Measure all qubits'),
          allQubits().map((q) => h('button', { class: 'btn', type: 'button', onclick: () => measureOne(q) }, `Measure q${q} only`))))];
    }
    const labels = branches[0].record.map((r) => `q${r.q}`);
    const measured = [...new Set(branches[0].record.map((r) => r.q))];
    const unmeasured = allQubits().filter((q) => !measured.includes(q));

    const shotsPicker = h('select', { 'aria-label': 'Number of shots' }, SHOT_CHOICES.map((c) => h('option', { value: c, selected: c === S.shots }, c.toLocaleString())));
    shotsPicker.addEventListener('change', () => { S.shots = Number(shotsPicker.value); });

    const pickedBranch = branches.find((b) => recordKey(b) === S.picked) || branches[0];
    const pickedKey = recordKey(pickedBranch);

    const rows = branches.slice().map((b) => {
      const key = recordKey(b);
      const count = S.counts[key] || 0;
      const freq = S.total ? count / S.total : 0;
      return h('button', {
        class: `hist-row${key === pickedKey ? ' picked' : ''}${key === S.flash ? ' flash' : ''}`,
        type: 'button',
        title: `${recordText(b)}: exact ${percent(b.p)}${S.total ? `, sampled ${count.toLocaleString()} of ${S.total.toLocaleString()}` : ''}`,
        onclick: () => { S.picked = key; S.flash = null; renderPanel(); },
      },
      h('span', { class: 'bits' }, b.record.map((r) => h('span', {}, String(r.bit)))),
      h('span', { class: 'bar-track' },
        h('span', { class: 'bar-exact', style: `width:${b.p * 100}%` }),
        S.total ? h('span', { class: 'bar-sampled', style: `width:${freq * 100}%` }) : null),
      h('span', { class: 'num' }, percent(b.p)),
      h('span', { class: 'num' }, S.total ? percent(freq) : '–'));
    });

    const left = h('div', {},
      h('div', { class: 'hist-head' },
        h('span', { class: 'bits' }, labels.map((l) => h('span', {}, l))),
        h('span', {}, ''),
        h('span', { class: 'num' }, 'Exact'),
        h('span', { class: 'num' }, 'Sampled')),
      rows);

    const detail = h('div', { class: 'detail' },
      h('h3', {}, `If the result is ${recordText(pickedBranch)}`),
      h('div', {},
        h('div', { class: 'section-title' }, 'State afterwards'),
        h('div', { class: 'ket' }, Q.formatKet(pickedBranch.state, S.n, { dropGlobalPhase: true }))),
      h('div', { class: 'bloch-minis' }, allQubits().map((q) => h('div', { class: 'bloch-mini' },
        Bloch.create(Q.blochVector(pickedBranch.state, S.n, q), 110), `q${q}`))),
      h('p', { class: 'muted' }, unmeasuredNote(branches, pickedBranch, unmeasured)));

    return [
      h('div', { class: 'controls' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => measureOnce(branches) }, 'Measure once'),
        h('span', { class: 'fine' }, 'or'),
        shotsPicker,
        h('button', { class: 'btn', type: 'button', onclick: () => runShots(branches, S.shots) }, 'Run shots'),
        h('button', { class: 'btn', type: 'button', disabled: !S.total, onclick: () => { resetSamples(); renderPanel(); } }, 'Reset counts'),
        h('span', { class: 'muted', role: 'status' }, S.message)),
      h('div', { class: 'legend' },
        h('span', {}, h('i', { class: 'key-exact' }), 'Exact probability'),
        h('span', {}, h('i', { class: 'key-sampled' }), 'Sampled frequency')),
      h('div', { class: 'measure-grid' }, left, detail),
    ];
  }

  // ---- Compare tab ----

  function scenarioInsight(prep, sel, outcomes) {
    const rest = allQubits().filter((q) => !sel.includes(q));
    const k = outcomes.length;
    const possible = `${k} possible result${k === 1 ? '' : 's'}`;
    if (!rest.length) {
      return `${possible}. Every qubit is read, so the state collapses to one basis ket and no superposition is left.`;
    }
    const left = outcomes.map((o) => Q.remainingState(o.state, S.n, sel).state);
    const same = left.every((st) => Q.fidelity(st, left[0]) > 1 - 1e-9);
    const superposed = left.some((st) => {
      let terms = 0;
      for (let i = 0; i < st.re.length; i++) if (st.re[i] ** 2 + st.im[i] ** 2 > 1e-9) terms++;
      return terms > 1;
    });
    const tail = superposed ? `Superposition survives on ${qNames(rest)}.` : `No superposition is left on ${qNames(rest)}.`;
    if (k === 1) {
      return `${possible}: the outcome is already certain, so this measurement changes nothing. ${tail}`;
    }
    if (same) {
      return `${possible}. The state left on ${qNames(rest)} is the same whatever ${qNames(sel)} reads, so they were not entangled and the rest is undisturbed. ${tail}`;
    }
    return `${possible}. The state left on ${qNames(rest)} depends on the result, because they were entangled with ${qNames(sel)}. Averaged over results, their own statistics do not change (no-signalling). ${tail}`;
  }

  function scenarioCard(id, title, prep) {
    const sel = S.compare[id].slice().sort((a, b) => a - b);
    const outcomes = Q.measureSequence(prep, S.n, sel);
    const counts = S.compareCounts[id];
    const rest = allQubits().filter((q) => !sel.includes(q));
    const toggle = (q) => {
      const cur = S.compare[id];
      if (cur.includes(q) && cur.length === 1) {
        toast('A scenario needs at least one measured qubit.');
        return;
      }
      S.compare[id] = cur.includes(q) ? cur.filter((x) => x !== q) : cur.concat(q);
      S.compareCounts = { a: {}, b: {} };
      S.compareTotal = 0;
      renderPanel();
    };
    const showMinis = outcomes.length <= 8;
    const name = sel.length === S.n ? (S.n === 1 ? 'q0' : 'all qubits') : `${qNames(sel)} only`;
    return h('div', { class: 'scenario' },
      h('h3', {}, `${title}: measure ${name}`),
      h('div', { class: 'chips', role: 'group', 'aria-label': `${title} qubits` },
        h('span', { class: 'fine' }, 'Measure:'),
        allQubits().map((q) => h('button', {
          class: 'chip', type: 'button', 'aria-pressed': sel.includes(q) ? 'true' : 'false', onclick: () => toggle(q),
        }, `q${q}`))),
      h('p', { class: 'insight' }, scenarioInsight(prep, sel, outcomes)),
      outcomes.slice(0, 16).map((o) => {
        const key = o.bits.join('');
        const freq = S.compareTotal ? (counts[key] || 0) / S.compareTotal : 0;
        const leftover = rest.length ? Q.remainingState(o.state, S.n, sel) : null;
        return h('div', { class: 'outcome' },
          h('div', { class: 'outcome-head' },
            h('span', {}, sel.map((q, i) => `q${q}=${o.bits[i]}`).join(', ')),
            h('span', { class: 'num' }, `P = ${formatProbability(o.p)}${S.compareTotal ? ` · sampled ${percent(freq)}` : ''}`)),
          h('div', { class: 'bar-track', title: `Exact ${percent(o.p)}${S.compareTotal ? `, sampled ${percent(freq)}` : ''}` },
            h('span', { class: 'bar-exact', style: `width:${o.p * 100}%` }),
            S.compareTotal ? h('span', { class: 'bar-sampled', style: `width:${freq * 100}%` }) : null),
          leftover
            ? h('div', {}, h('span', { class: 'fine' }, `Left on ${qNames(leftover.qubits)}: `),
              h('span', { class: 'ket-small' }, Q.formatKet(leftover.state, leftover.qubits.length, { dropGlobalPhase: true })))
            : h('div', {}, h('span', { class: 'fine' }, 'Final state: '),
              h('span', { class: 'ket-small' }, `|${allQubits().map((q) => o.bits[sel.indexOf(q)]).join('')}⟩`)),
          showMinis && h('div', { class: 'bloch-minis' }, allQubits().map((q) => h('div', { class: 'bloch-mini' },
            Bloch.create(Q.blochVector(o.state, S.n, q), 72), `q${q}`))));
      }),
      outcomes.length > 16 && h('p', { class: 'fine' }, `Showing the first 16 of ${outcomes.length} results.`));
  }

  function sequentialTable(prep) {
    const qs = allQubits();
    const reversed = qs.slice().reverse();
    const joint = Q.jointProbabilities(prep, S.n, qs);
    const forward = Q.measureSequence(prep, S.n, qs);
    const backward = Q.measureSequence(prep, S.n, reversed);
    const stepsText = (o) => o.steps.map(formatProbability).join(' × ');
    const keyOf = (o, order) => qs.map((q) => o.bits[order.indexOf(q)]).join('');
    const backwardByKey = new Map(backward.map((o) => [keyOf(o, reversed), o]));
    const rows = forward.slice().sort((a, b) => b.p - a.p).slice(0, 16).map((o) => {
      const key = keyOf(o, qs);
      return h('tr', {},
        h('td', { class: 'ket-small' }, `|${key}⟩`),
        h('td', {}, formatProbability(joint[key])),
        h('td', {}, stepsText(o)),
        h('td', {}, stepsText(backwardByKey.get(key))));
    });
    const marginals = qs.map((q) => {
      const r = Q.measureQubit(prep, S.n, q).find((x) => x.bit === 1);
      return `q${q}: P(1) = ${formatProbability(r ? r.p : 0)}`;
    }).join('  ·  ');
    return h('div', {},
      h('h3', { style: 'font-size:.95rem;margin-bottom:2px' }, 'All at once vs one at a time'),
      h('p', { class: 'muted', style: 'margin-bottom:6px' },
        'Each product is the chain of conditional probabilities for reading the qubits in that order. Every row agrees: Z measurements on different qubits commute, so the order, or doing them together, cannot change the joint result.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {},
          h('th', {}, 'Result'),
          h('th', {}, 'All at once'),
          h('th', {}, qs.map((q) => `q${q}`).join(' → ')),
          h('th', {}, reversed.map((q) => `q${q}`).join(' → ')))),
        h('tbody', {}, rows))),
      forward.length > 16 && h('p', { class: 'fine' }, `Showing the 16 most likely of ${forward.length} results.`),
      h('p', { class: 'fine', style: 'margin-top:6px' }, `Measuring a single qubit gives the sum of the matching rows. ${marginals}`));
  }

  function comparePanel() {
    const prep = Q.preparedState(S.n, S.ops);
    const firstM = S.ops.reduce((c, o) => (o.gate === 'M' ? Math.min(c, o.col) : c), Infinity);
    const usedGates = S.ops.filter((o) => o.col < firstM).length;
    const dropped = S.ops.length - usedGates;
    const runBoth = () => {
      for (const id of ['a', 'b']) {
        const sel = S.compare[id].slice().sort((x, y) => x - y);
        const outcomes = Q.measureSequence(prep, S.n, sel);
        const counts = Q.sample(outcomes, S.shots);
        const next = {};
        outcomes.forEach((o, i) => { next[o.bits.join('')] = counts[i]; });
        S.compareCounts[id] = next;
      }
      S.compareTotal = S.shots;
      renderPanel();
    };
    const shotsPicker = h('select', { 'aria-label': 'Number of shots' }, SHOT_CHOICES.map((c) => h('option', { value: c, selected: c === S.shots }, c.toLocaleString())));
    shotsPicker.addEventListener('change', () => { S.shots = Number(shotsPicker.value); });

    const parts = [
      h('div', {},
        h('div', { class: 'section-title' }, 'Before any measurement'),
        h('div', { class: 'ket' }, Q.formatKet(prep, S.n)),
        h('p', { class: 'fine' }, dropped
          ? `Uses the ${usedGates} gate${usedGates === 1 ? '' : 's'} before the first M. The M and anything after it are set aside, so each scenario below can choose what to read.`
          : 'Uses every gate in the circuit. Pick what to read in each scenario below.')),
      h('div', { class: 'bloch-minis' }, allQubits().map((q) => h('div', { class: 'bloch-mini' },
        Bloch.create(Q.blochVector(prep, S.n, q), 110), `q${q}`))),
      h('div', { class: 'controls' },
        shotsPicker,
        h('button', { class: 'btn', type: 'button', onclick: runBoth }, 'Run shots in both scenarios'),
        S.compareTotal ? h('span', { class: 'legend' },
          h('span', {}, h('i', { class: 'key-exact' }), 'Exact'),
          h('span', {}, h('i', { class: 'key-sampled' }), `Sampled (${S.compareTotal.toLocaleString()} shots)`)) : null),
      h('div', { class: 'compare-grid' }, scenarioCard('a', 'Scenario A', prep), scenarioCard('b', 'Scenario B', prep)),
    ];
    if (S.n >= 2) parts.push(sequentialTable(prep));
    return parts;
  }

  // ---- Labs ----

  function renderLabs() {
    const root = $('labs');
    root.replaceChildren(
      h('h2', {}, 'Guided labs'),
      h('p', { class: 'fine' }, 'Each lab loads a circuit and asks you to predict before you run. Undo restores your previous circuit.'),
      ...window.LABS.map((lab, i) => {
        const open = S.openLab === i;
        const details = h('details', { class: 'lab', open },
          h('summary', {}, lab.title),
          h('div', { class: 'lab-body' },
            h('p', { class: 'goal' }, lab.goal),
            h('div', {}, h('button', { class: 'btn primary', type: 'button', onclick: () => loadLab(lab) }, 'Load this circuit')),
            h('ol', {}, lab.steps.map((t) => h('li', {}, t))),
            h('details', {}, h('summary', {}, 'Check your answer'), h('p', {}, lab.answer))));
        details.addEventListener('toggle', () => { if (details.open) S.openLab = i; });
        return details;
      }));
  }

  // ---- Page wiring ----

  function renderAll() {
    $('qubit-count').textContent = S.n;
    $('qubit-minus').disabled = S.n <= MIN_QUBITS;
    $('qubit-plus').disabled = S.n >= MAX_QUBITS;
    $('undo').disabled = !S.undo.length;
    $('clear').disabled = !S.ops.length;
    $('remove-measures').disabled = !S.ops.some((o) => o.gate === 'M');
    renderPalette();
    renderCircuit();
    renderInspector();
    renderScrub();
    renderTabs();
    renderPanel();
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('qml-theme', theme); } catch (e) { /* preference only */ }
    themeButtonText();
    Bloch.redrawAll();
  }

  function isDark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function themeButtonText() {
    $('theme-toggle').textContent = isDark() ? 'Light mode' : 'Dark mode';
  }

  function wirePage() {
    $('qubit-minus').addEventListener('click', () => setQubits(S.n - 1));
    $('qubit-plus').addEventListener('click', () => setQubits(S.n + 1));
    $('measure-all').addEventListener('click', measureAll);
    $('remove-measures').addEventListener('click', () => commit(() => {
      S.ops = S.ops.filter((o) => o.gate !== 'M');
      S.selected = null;
    }));
    $('undo').addEventListener('click', undo);
    $('clear').addEventListener('click', () => commit(() => { S.ops = []; S.selected = null; }));
    $('share').addEventListener('click', copyLink);
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      S.tab = t.dataset.tab;
      renderTabs();
      renderPanel();
    }));
    $('labs-toggle').addEventListener('click', () => {
      const hidden = $('layout').classList.toggle('labs-hidden');
      $('labs-toggle').textContent = hidden ? 'Show labs' : 'Hide labs';
      $('labs-toggle').setAttribute('aria-expanded', String(!hidden));
    });
    $('theme-toggle').addEventListener('click', () => setTheme(isDark() ? 'light' : 'dark'));
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      themeButtonText();
      Bloch.redrawAll();
    });
    document.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (e.key === 'Escape') {
        S.armed = null;
        S.selected = null;
        renderPalette();
        renderCircuit();
        renderInspector();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && S.selected !== null && tag !== 'INPUT' && tag !== 'SELECT') {
        e.preventDefault();
        removeOp(S.selected);
      }
    });
    window.addEventListener('hashchange', () => {
      if (readHash()) {
        resetSamples();
        renderAll();
      }
    });
  }

  function init() {
    try {
      const theme = localStorage.getItem('qml-theme');
      if (theme) document.documentElement.dataset.theme = theme;
    } catch (e) { /* preference only */ }
    wirePage();
    wireCircuitEvents();
    themeButtonText();
    if (!readHash()) {
      // First visit: a Bell pair, since it shows the point of the lab straight away.
      loadOps(2, [['H', [0], 0], ['CX', [0, 1], 1]]);
      S.tab = 'compare';
    }
    renderLabs();
    renderAll();
  }

  init();
})();
