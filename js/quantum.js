/*
 * quantum.js: a small, exact statevector simulator. No DOM, no dependencies.
 *
 * Written to be read by students, so it favours clarity over speed.
 *
 * Convention (same as Nielsen & Chuang): q0 is the LEFTMOST qubit in a ket.
 *   |q0 q1 q2>, so in a 3-qubit state, |100> means q0=1.
 * Qiskit uses the opposite order (q0 rightmost). See the README.
 *
 * A state is { re: Float64Array, im: Float64Array } of length 2^n.
 * An op is { gate, qubits: [...], col, theta? }. Two-qubit gates list the
 * control first: { gate: 'CX', qubits: [control, target], col }.
 */
(function (root) {
  'use strict';

  const R = Math.SQRT1_2;
  const EPS = 1e-10;

  // A 2x2 matrix is [a, b, c, d] of [re, im] pairs: [[a, b], [c, d]].
  const GATES = {
    X: { name: 'Pauli-X (NOT)', kind: 'pauli', matrix: () => [[0, 0], [1, 0], [1, 0], [0, 0]],
      about: 'Flips |0⟩ and |1⟩. A π rotation about the X axis.' },
    Y: { name: 'Pauli-Y', kind: 'pauli', matrix: () => [[0, 0], [0, -1], [0, 1], [0, 0]],
      about: 'A π rotation about the Y axis. Flips the bit and adds a phase.' },
    Z: { name: 'Pauli-Z', kind: 'pauli', matrix: () => [[1, 0], [0, 0], [0, 0], [-1, 0]],
      about: 'A π rotation about the Z axis. Adds a −1 phase to |1⟩; probabilities do not change.' },
    H: { name: 'Hadamard', kind: 'clifford', matrix: () => [[R, 0], [R, 0], [R, 0], [-R, 0]],
      about: 'Creates superposition: |0⟩→|+⟩, |1⟩→|−⟩. A π rotation about the axis halfway between X and Z.' },
    S: { name: 'S (√Z)', kind: 'phase', matrix: () => [[1, 0], [0, 0], [0, 0], [0, 1]],
      about: 'A π/2 rotation about the Z axis.' },
    Sdg: { name: 'S†', label: 'S†', kind: 'phase', matrix: () => [[1, 0], [0, 0], [0, 0], [0, -1]],
      about: 'A −π/2 rotation about the Z axis. Undoes S.' },
    T: { name: 'T (π/8 gate)', kind: 'phase', matrix: () => [[1, 0], [0, 0], [0, 0], [R, R]],
      about: 'A π/4 rotation about the Z axis.' },
    Tdg: { name: 'T†', label: 'T†', kind: 'phase', matrix: () => [[1, 0], [0, 0], [0, 0], [R, -R]],
      about: 'A −π/4 rotation about the Z axis. Undoes T.' },
    Rx: { name: 'Rx(θ)', kind: 'rotation', hasAngle: true,
      matrix: (t) => [[Math.cos(t / 2), 0], [0, -Math.sin(t / 2)], [0, -Math.sin(t / 2)], [Math.cos(t / 2), 0]],
      about: 'Rotates the Bloch vector by θ about the X axis.' },
    Ry: { name: 'Ry(θ)', kind: 'rotation', hasAngle: true,
      matrix: (t) => [[Math.cos(t / 2), 0], [-Math.sin(t / 2), 0], [Math.sin(t / 2), 0], [Math.cos(t / 2), 0]],
      about: 'Rotates the Bloch vector by θ about the Y axis. From |0⟩ this gives P(1) = sin²(θ/2).' },
    Rz: { name: 'Rz(θ)', kind: 'rotation', hasAngle: true,
      matrix: (t) => [[Math.cos(t / 2), -Math.sin(t / 2)], [0, 0], [0, 0], [Math.cos(t / 2), Math.sin(t / 2)]],
      about: 'Rotates the Bloch vector by θ about the Z axis. Probabilities do not change.' },
    CX: { name: 'CNOT', kind: 'entangling', arity: 2, control: 'X',
      about: 'Flips the target when the control is 1. Acting on a superposed control, it creates entanglement.' },
    CZ: { name: 'Controlled-Z', kind: 'entangling', arity: 2, control: 'Z',
      about: 'Adds a −1 phase to |11⟩ only. Can entangle without changing any probability.' },
    SWAP: { name: 'SWAP', kind: 'entangling', arity: 2,
      about: 'Exchanges the states of two qubits.' },
    M: { name: 'Measurement', kind: 'measure',
      about: 'Measures in the Z basis: the qubit reads 0 or 1 at random and collapses to that value.' },
  };

  function zeroState(n) {
    const size = 1 << n;
    const state = { re: new Float64Array(size), im: new Float64Array(size) };
    state.re[0] = 1;
    return state;
  }

  function cloneState(s) {
    return { re: s.re.slice(), im: s.im.slice() };
  }

  /** Bit mask for qubit q: q0 is the most significant bit. */
  function maskOf(n, q) {
    return 1 << (n - 1 - q);
  }

  /** Applies a 2x2 matrix to qubit q, only where every bit in ctrlMask is set. */
  function applyMatrix(state, n, q, m, ctrlMask = 0) {
    const mask = maskOf(n, q);
    const { re, im } = state;
    const [[ar, ai], [br, bi], [cr, ci], [dr, di]] = m;
    for (let i = 0; i < re.length; i++) {
      if (i & mask) continue;
      if ((i & ctrlMask) !== ctrlMask) continue;
      const j = i | mask;
      const xr = re[i], xi = im[i], yr = re[j], yi = im[j];
      re[i] = ar * xr - ai * xi + br * yr - bi * yi;
      im[i] = ar * xi + ai * xr + br * yi + bi * yr;
      re[j] = cr * xr - ci * xi + dr * yr - di * yi;
      im[j] = cr * xi + ci * xr + dr * yi + di * yr;
    }
  }

  function applySwap(state, n, a, b) {
    const ma = maskOf(n, a), mb = maskOf(n, b);
    const { re, im } = state;
    for (let i = 0; i < re.length; i++) {
      if ((i & ma) && !(i & mb)) {
        const j = (i ^ ma) | mb;
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
  }

  /** Applies any non-measurement op in place. */
  function applyGate(state, n, op) {
    const g = GATES[op.gate];
    if (op.gate === 'SWAP') {
      applySwap(state, n, op.qubits[0], op.qubits[1]);
    } else if (g.arity === 2) {
      const target = GATES[g.control].matrix();
      applyMatrix(state, n, op.qubits[1], target, maskOf(n, op.qubits[0]));
    } else {
      applyMatrix(state, n, op.qubits[0], g.matrix(op.theta));
    }
  }

  /**
   * Measures one qubit. Returns one entry per possible result, each with its
   * Born-rule probability and the collapsed, renormalised state.
   */
  function measureQubit(state, n, q) {
    const mask = maskOf(n, q);
    const results = [];
    for (const bit of [0, 1]) {
      let p = 0;
      for (let i = 0; i < state.re.length; i++) {
        if (((i & mask) !== 0) === (bit === 1)) p += state.re[i] ** 2 + state.im[i] ** 2;
      }
      if (p < EPS) continue;
      const after = { re: new Float64Array(state.re.length), im: new Float64Array(state.re.length) };
      const norm = Math.sqrt(p);
      for (let i = 0; i < state.re.length; i++) {
        if (((i & mask) !== 0) === (bit === 1)) {
          after.re[i] = state.re[i] / norm;
          after.im[i] = state.im[i] / norm;
        }
      }
      results.push({ bit, p, state: after });
    }
    return results;
  }

  /**
   * Runs a circuit exactly. Each measurement splits the run into branches, so
   * the result is every possible history, not one random sample:
   *   [{ p, state, record: [{ q, bit, col }, ...] }, ...]
   * Only ops with col <= uptoCol are applied.
   */
  function simulate(n, ops, uptoCol = Infinity) {
    const ordered = ops.filter((o) => o.col <= uptoCol).sort((a, b) => a.col - b.col);
    let branches = [{ p: 1, state: zeroState(n), record: [] }];
    for (const op of ordered) {
      if (op.gate === 'M') {
        const next = [];
        for (const b of branches) {
          for (const r of measureQubit(b.state, n, op.qubits[0])) {
            next.push({
              p: b.p * r.p,
              state: r.state,
              record: b.record.concat({ q: op.qubits[0], bit: r.bit, col: op.col }),
            });
          }
        }
        branches = next;
      } else {
        for (const b of branches) applyGate(b.state, n, op);
      }
    }
    return branches;
  }

  /** The state produced by every gate that comes before the first measurement. */
  function preparedState(n, ops) {
    const firstM = ops.reduce((c, o) => (o.gate === 'M' ? Math.min(c, o.col) : c), Infinity);
    const state = zeroState(n);
    for (const op of ops.filter((o) => o.col < firstM).sort((a, b) => a.col - b.col)) {
      applyGate(state, n, op);
    }
    return state;
  }

  /**
   * Measures a set of qubits one after another, in the order given.
   * Returns [{ bits, p, steps, state }] where bits lines up with `qubits` and
   * steps holds the conditional probability of each successive result.
   */
  function measureSequence(state, n, qubits) {
    let outcomes = [{ bits: [], p: 1, steps: [], state }];
    for (const q of qubits) {
      const next = [];
      for (const o of outcomes) {
        for (const r of measureQubit(o.state, n, q)) {
          next.push({
            bits: o.bits.concat(r.bit),
            p: o.p * r.p,
            steps: o.steps.concat(r.p),
            state: r.state,
          });
        }
      }
      outcomes = next;
    }
    return outcomes;
  }

  /** Joint probabilities of `qubits` measured at once: Σ|amp|², no collapse needed. */
  function jointProbabilities(state, n, qubits) {
    const result = {};
    for (let i = 0; i < state.re.length; i++) {
      const p = state.re[i] ** 2 + state.im[i] ** 2;
      if (p < EPS) continue;
      const key = qubits.map((q) => ((i & maskOf(n, q)) ? '1' : '0')).join('');
      result[key] = (result[key] || 0) + p;
    }
    return result;
  }

  /** Bloch vector of qubit q, read from its reduced density matrix. |r|<1 means q is not pure. */
  function blochVector(state, n, q) {
    const mask = maskOf(n, q);
    let p0 = 0, p1 = 0, cr = 0, ci = 0; // c = ρ01
    for (let i = 0; i < state.re.length; i++) {
      const p = state.re[i] ** 2 + state.im[i] ** 2;
      if (i & mask) {
        p1 += p;
      } else {
        p0 += p;
        const j = i | mask;
        cr += state.re[i] * state.re[j] + state.im[i] * state.im[j];
        ci += state.im[i] * state.re[j] - state.re[i] * state.im[j];
      }
    }
    return { x: 2 * cr, y: -2 * ci, z: p0 - p1 };
  }

  /** Probability-weighted average Bloch vector over several branches. */
  function averageBloch(items, n, q) {
    const r = { x: 0, y: 0, z: 0 };
    for (const b of items) {
      const v = blochVector(b.state, n, q);
      r.x += b.p * v.x; r.y += b.p * v.y; r.z += b.p * v.z;
    }
    return r;
  }

  function blochLength(r) {
    return Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
  }

  /** Spherical angles of a Bloch vector: θ from |0⟩, φ around the equator. φ is null at a pole. */
  function blochAngles(r) {
    const len = blochLength(r);
    if (len < 1e-9) return { theta: 0, phi: null };
    const theta = Math.acos(Math.max(-1, Math.min(1, r.z / len)));
    if (Math.hypot(r.x, r.y) < 1e-9) return { theta, phi: null };
    const phi = Math.atan2(r.y, r.x);
    return { theta, phi: phi < -1e-9 ? phi + 2 * Math.PI : Math.max(phi, 0) };
  }

  /**
   * After `measured` have collapsed, the rest of the system is itself a pure
   * state. Returns it over the remaining qubits, in ascending qubit order.
   */
  function remainingState(state, n, measured) {
    const rest = [];
    for (let q = 0; q < n; q++) if (!measured.includes(q)) rest.push(q);
    const out = { re: new Float64Array(1 << rest.length), im: new Float64Array(1 << rest.length) };
    for (let i = 0; i < state.re.length; i++) {
      if (state.re[i] === 0 && state.im[i] === 0) continue;
      let k = 0;
      rest.forEach((q) => { k = (k << 1) | ((i & maskOf(n, q)) ? 1 : 0); });
      out.re[k] = state.re[i];
      out.im[k] = state.im[i];
    }
    return { state: out, qubits: rest };
  }

  /** |⟨a|b⟩|²: 1 means the same physical state, even with a different global phase. */
  function fidelity(a, b) {
    let r = 0, i = 0;
    for (let k = 0; k < a.re.length; k++) {
      r += a.re[k] * b.re[k] + a.im[k] * b.im[k];
      i += a.re[k] * b.im[k] - a.im[k] * b.re[k];
    }
    return r * r + i * i;
  }

  /** Draws `shots` samples from items with a .p field. Returns a count per index. */
  function sample(items, shots, rng = Math.random) {
    const counts = new Array(items.length).fill(0);
    for (let s = 0; s < shots; s++) {
      counts[sampleOne(items, rng)]++;
    }
    return counts;
  }

  function sampleOne(items, rng = Math.random) {
    let u = rng();
    for (let i = 0; i < items.length; i++) {
      u -= items[i].p;
      if (u < 0) return i;
    }
    return items.length - 1;
  }

  // ---- Formatting: amplitudes and kets as readable text ----

  /** Formats a positive real: 0.7071 → "1/√2", 0.5 → "1/2", otherwise a decimal. */
  function formatMagnitude(v) {
    if (Math.abs(v - 1) < 1e-6) return '1';
    const b = 1 / (v * v);
    const rb = Math.round(b);
    if (rb >= 2 && rb <= 64 && Math.abs(b - rb) < 1e-6) {
      const root = Math.round(Math.sqrt(rb));
      return root * root === rb ? `1/${root}` : `1/√${rb}`;
    }
    if (Math.abs(v * v - 0.75) < 1e-6) return '√3/2';
    return v.toFixed(3);
  }

  /** Formats an angle: multiples of π/12 as fractions of π, otherwise in radians. */
  function formatAngle(a) {
    const k = a / Math.PI * 12;
    const rk = Math.round(k);
    if (Math.abs(k - rk) > 1e-6) return a.toFixed(2);
    if (rk === 0) return '0';
    const gcd = (x, y) => (y ? gcd(y, x % y) : x);
    const g = gcd(Math.abs(rk), 12);
    const num = rk / g, den = 12 / g;
    const top = num === 1 ? 'π' : num === -1 ? '−π' : `${num < 0 ? '−' : ''}${Math.abs(num)}π`;
    return den === 1 ? top : `${top}/${den}`;
  }

  /** Splits a unit phase into a sign and the factor to print after the magnitude. */
  function formatPhase(phi) {
    let a = Math.atan2(Math.sin(phi), Math.cos(phi));
    if (Math.abs(a) < 1e-6) return { sign: 1, factor: '' };
    if (Math.abs(Math.abs(a) - Math.PI) < 1e-6) return { sign: -1, factor: '' };
    if (Math.abs(a - Math.PI / 2) < 1e-6) return { sign: 1, factor: 'i' };
    if (Math.abs(a + Math.PI / 2) < 1e-6) return { sign: -1, factor: 'i' };
    return { sign: 1, factor: `e^(i${formatAngle(a)})` };
  }

  /**
   * Writes a state in Dirac notation, for example "1/√2 (|00⟩ + |11⟩)".
   * dropGlobalPhase rotates the first term to be real and positive.
   */
  function formatKet(state, n, { dropGlobalPhase = false, maxTerms = 8 } = {}) {
    if (n === 0) return '';
    const terms = [];
    for (let i = 0; i < state.re.length; i++) {
      const mag = Math.hypot(state.re[i], state.im[i]);
      if (mag < 1e-6) continue;
      terms.push({ bits: i.toString(2).padStart(n, '0'), mag, phi: Math.atan2(state.im[i], state.re[i]) });
    }
    const offset = dropGlobalPhase && terms.length ? terms[0].phi : 0;
    const uniform = terms.every((t) => Math.abs(t.mag - terms[0].mag) < 1e-6);
    const prefix = uniform && terms.length > 1 ? formatMagnitude(terms[0].mag) : '';
    const shown = terms.slice(0, maxTerms);
    let text = '';
    shown.forEach((t, idx) => {
      const { sign, factor } = formatPhase(t.phi - offset);
      const mag = uniform ? (terms.length > 1 ? '' : (formatMagnitude(t.mag) === '1' ? '' : formatMagnitude(t.mag))) : formatMagnitude(t.mag);
      const coef = [mag === '1' ? '' : mag, factor].filter(Boolean).join(mag && factor ? ' ' : '');
      const body = `${coef}|${t.bits}⟩`;
      if (idx === 0) text += (sign < 0 ? '−' : '') + body;
      else text += (sign < 0 ? ' − ' : ' + ') + body;
    });
    if (terms.length > shown.length) text += ` + … (${terms.length - shown.length} more)`;
    return prefix ? `${prefix} (${text})` : text;
  }

  root.QSim = {
    GATES, EPS,
    zeroState, cloneState, maskOf, applyGate, measureQubit, simulate, preparedState,
    measureSequence, jointProbabilities, blochVector, averageBloch, blochLength, blochAngles,
    remainingState, fidelity, sample, sampleOne,
    formatMagnitude, formatAngle, formatKet,
  };
})(typeof window !== 'undefined' ? window : globalThis);
