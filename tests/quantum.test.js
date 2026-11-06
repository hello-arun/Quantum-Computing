/* Physics checks for js/quantum.js. Results render into tests/index.html. */
(function () {
  'use strict';
  const Q = window.QSim;
  const results = [];

  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, msg: e.message }); }
  }
  function close(a, b, label = '', tol = 1e-9) {
    if (Math.abs(a - b) > tol) throw new Error(`${label} expected ${b}, got ${a}`);
  }
  function eq(a, b, label = '') {
    const x = JSON.stringify(a), y = JSON.stringify(b);
    if (x !== y) throw new Error(`${label} expected ${y}, got ${x}`);
  }
  function bloch(r, x, y, z, label = '') {
    close(r.x, x, `${label} x`); close(r.y, y, `${label} y`); close(r.z, z, `${label} z`);
  }

  // Builds ops from [gate, ...qubits] or [gate, qubit, theta] one column at a time.
  function ops(...list) {
    return list.map((l, col) => {
      const hasAngle = Q.GATES[l[0]].hasAngle;
      return hasAngle
        ? { gate: l[0], qubits: [l[1]], theta: l[2], col }
        : { gate: l[0], qubits: l.slice(1), col };
    });
  }
  const run = (n, ...list) => Q.simulate(n, ops(...list));
  const final = (n, ...list) => run(n, ...list)[0].state;

  // Seeded generator, so the random-circuit tests give the same result every run.
  function seeded(seed) {
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }
  function randomCircuit(n, length, rng) {
    const single = ['X', 'Y', 'Z', 'H', 'S', 'T', 'Sdg', 'Tdg', 'Rx', 'Ry', 'Rz'];
    const two = ['CX', 'CZ', 'SWAP'];
    const list = [];
    for (let i = 0; i < length; i++) {
      const a = Math.floor(rng() * n);
      if (n > 1 && rng() < 0.35) {
        const b = (a + 1 + Math.floor(rng() * (n - 1))) % n;
        list.push([two[Math.floor(rng() * two.length)], a, b]);
      } else {
        const g = single[Math.floor(rng() * single.length)];
        list.push(Q.GATES[g].hasAngle ? [g, a, rng() * 2 * Math.PI] : [g, a]);
      }
    }
    return list;
  }

  // ---- Gates ----
  test('starts in |0…0⟩', () => {
    const s = Q.zeroState(3);
    close(s.re[0], 1); close(Q.jointProbabilities(s, 3, [0, 1, 2])['000'], 1);
  });
  test('X|0⟩ = |1⟩', () => close(final(1, ['X', 0]).re[1], 1));
  test('Y|0⟩ = i|1⟩', () => { const s = final(1, ['Y', 0]); close(s.im[1], 1); close(s.re[1], 0); });
  test('HH = I', () => close(final(1, ['H', 0], ['H', 0]).re[0], 1));
  test('HZH = X', () => close(final(1, ['H', 0], ['Z', 0], ['H', 0]).re[1], 1));
  test('SS = Z and TT = S', () => {
    const a = final(1, ['H', 0], ['S', 0], ['S', 0]);
    const b = final(1, ['H', 0], ['Z', 0]);
    close(a.re[1], b.re[1]);
    const c = final(1, ['H', 0], ['T', 0], ['T', 0]);
    const d = final(1, ['H', 0], ['S', 0]);
    close(c.im[1], d.im[1]);
  });
  test('S† undoes S, T† undoes T', () => {
    close(final(1, ['H', 0], ['S', 0], ['Sdg', 0], ['H', 0]).re[0], 1);
    close(final(1, ['H', 0], ['T', 0], ['Tdg', 0], ['H', 0]).re[0], 1);
  });
  test('Ry(θ)|0⟩ gives P(1) = sin²(θ/2)', () => {
    for (const t of [0.3, Math.PI / 3, Math.PI / 2, 2.5, Math.PI]) {
      const p = Q.jointProbabilities(final(1, ['Ry', 0, t]), 1, [0])['1'] || 0;
      close(p, Math.sin(t / 2) ** 2, `θ=${t}`);
    }
  });
  test('Rx(π) and Rz(π) match X and Z up to global phase', () => {
    close(Q.fidelity(final(1, ['Rx', 0, Math.PI]), final(1, ['X', 0])), 1);
    close(Q.fidelity(final(1, ['H', 0], ['Rz', 0, Math.PI]), final(1, ['H', 0], ['Z', 0])), 1);
  });
  test('qubit order: q0 is the leftmost bit', () => {
    eq(Object.keys(Q.jointProbabilities(final(2, ['X', 0]), 2, [0, 1])), ['10']);
    eq(Object.keys(Q.jointProbabilities(final(2, ['X', 1]), 2, [0, 1])), ['01']);
  });
  test('CNOT respects control and target order', () => {
    eq(Object.keys(Q.jointProbabilities(final(2, ['X', 0], ['CX', 0, 1]), 2, [0, 1])), ['11']);
    eq(Object.keys(Q.jointProbabilities(final(2, ['X', 1], ['CX', 0, 1]), 2, [0, 1])), ['01']);
    eq(Object.keys(Q.jointProbabilities(final(2, ['X', 1], ['CX', 1, 0]), 2, [0, 1])), ['11']);
  });
  test('CNOT works across non-adjacent wires', () => {
    eq(Object.keys(Q.jointProbabilities(final(3, ['X', 0], ['CX', 0, 2]), 3, [0, 1, 2])), ['101']);
  });
  test('CZ only phases |11⟩', () => {
    const s = final(2, ['H', 0], ['H', 1], ['CZ', 0, 1]);
    close(s.re[0], 0.5); close(s.re[1], 0.5); close(s.re[2], 0.5); close(s.re[3], -0.5);
  });
  test('SWAP exchanges qubits', () => {
    eq(Object.keys(Q.jointProbabilities(final(2, ['X', 0], ['SWAP', 0, 1]), 2, [0, 1])), ['01']);
  });

  // ---- Bloch sphere ----
  test('Bloch axes: |0⟩, |1⟩, |+⟩, |−⟩, |+i⟩, |−i⟩', () => {
    bloch(Q.blochVector(Q.zeroState(1), 1, 0), 0, 0, 1, '|0⟩');
    bloch(Q.blochVector(final(1, ['X', 0]), 1, 0), 0, 0, -1, '|1⟩');
    bloch(Q.blochVector(final(1, ['H', 0]), 1, 0), 1, 0, 0, '|+⟩');
    bloch(Q.blochVector(final(1, ['X', 0], ['H', 0]), 1, 0), -1, 0, 0, '|−⟩');
    bloch(Q.blochVector(final(1, ['H', 0], ['S', 0]), 1, 0), 0, 1, 0, '|+i⟩');
    bloch(Q.blochVector(final(1, ['H', 0], ['Sdg', 0]), 1, 0), 0, -1, 0, '|−i⟩');
  });
  test('Rotation gates turn the Bloch vector the right way', () => {
    const t = 0.7;
    bloch(Q.blochVector(final(1, ['Ry', 0, t]), 1, 0), Math.sin(t), 0, Math.cos(t), 'Ry');
    bloch(Q.blochVector(final(1, ['Rx', 0, t]), 1, 0), 0, -Math.sin(t), Math.cos(t), 'Rx');
    bloch(Q.blochVector(final(1, ['H', 0], ['Rz', 0, t]), 1, 0), Math.cos(t), Math.sin(t), 0, 'Rz');
  });
  test('Bell pair: each qubit alone sits at the centre of its sphere', () => {
    const s = final(2, ['H', 0], ['CX', 0, 1]);
    bloch(Q.blochVector(s, 2, 0), 0, 0, 0, 'q0');
    bloch(Q.blochVector(s, 2, 1), 0, 0, 0, 'q1');
  });
  test('Product state: each qubit keeps a full-length vector', () => {
    const s = final(2, ['H', 0], ['Ry', 1, 1.1]);
    close(Q.blochLength(Q.blochVector(s, 2, 0)), 1);
    close(Q.blochLength(Q.blochVector(s, 2, 1)), 1);
  });

  // ---- Measurement ----
  test('Measuring |0⟩ is deterministic', () => {
    const b = run(1, ['M', 0]);
    eq(b.length, 1); close(b[0].p, 1); eq(b[0].record[0].bit, 0);
  });
  test('Measuring |+⟩ gives two branches of ½, each collapsed to a pole', () => {
    const b = run(1, ['H', 0], ['M', 0]);
    eq(b.length, 2);
    close(b[0].p, 0.5); close(b[1].p, 0.5);
    bloch(Q.blochVector(b[0].state, 1, 0), 0, 0, 1);
    bloch(Q.blochVector(b[1].state, 1, 0), 0, 0, -1);
  });
  test('Re-measuring gives the same result', () => {
    const b = run(1, ['H', 0], ['M', 0], ['M', 0]);
    eq(b.map((x) => x.record.map((r) => r.bit).join('')).sort(), ['00', '11']);
  });
  test('Measurement destroys interference: H M H M is uniform, H H M is not', () => {
    const with_ = run(1, ['H', 0], ['M', 0], ['H', 0], ['M', 0]);
    eq(with_.length, 4);
    with_.forEach((b) => close(b.p, 0.25));
    const without = run(1, ['H', 0], ['H', 0], ['M', 0]);
    eq(without.length, 1); eq(without[0].record[0].bit, 0);
  });
  test('Bell, measure q0 only: q1 is left in the matching pole', () => {
    const b = run(2, ['H', 0], ['CX', 0, 1], ['M', 0]);
    eq(b.length, 2);
    for (const br of b) {
      const expectedZ = br.record[0].bit === 0 ? 1 : -1;
      bloch(Q.blochVector(br.state, 2, 1), 0, 0, expectedZ);
    }
  });
  test('Bell, measure all: only 00 and 11', () => {
    const p = Q.jointProbabilities(final(2, ['H', 0], ['CX', 0, 1]), 2, [0, 1]);
    eq(Object.keys(p).sort(), ['00', '11']);
    close(p['00'], 0.5); close(p['11'], 0.5);
  });
  test('Product state: measuring q0 leaves q1 in |+⟩', () => {
    const s = final(2, ['H', 0], ['H', 1]);
    for (const o of Q.measureSequence(s, 2, [0])) {
      bloch(Q.blochVector(o.state, 2, 1), 1, 0, 0);
    }
  });
  test('CZ graph state: q0 outcome steers q1 to |+⟩ or |−⟩', () => {
    const s = final(2, ['H', 0], ['H', 1], ['CZ', 0, 1]);
    for (const o of Q.measureSequence(s, 2, [0])) {
      bloch(Q.blochVector(o.state, 2, 1), o.bits[0] === 0 ? 1 : -1, 0, 0);
    }
  });
  test('GHZ, measure q0: the other two collapse to |00⟩ or |11⟩', () => {
    const s = final(3, ['H', 0], ['CX', 0, 1], ['CX', 1, 2]);
    for (const o of Q.measureSequence(s, 3, [0])) {
      const rest = Q.remainingState(o.state, 3, [0]);
      eq(rest.qubits, [1, 2]);
      close(Q.jointProbabilities(rest.state, 2, [0, 1])[o.bits[0] ? '11' : '00'], 1);
    }
  });
  test('Deferred measurement: M then CNOT matches CNOT then M', () => {
    const early = Q.simulate(2, [
      { gate: 'H', qubits: [0], col: 0 }, { gate: 'M', qubits: [0], col: 1 },
      { gate: 'CX', qubits: [0, 1], col: 2 }, { gate: 'M', qubits: [1], col: 3 }]);
    const late = run(2, ['H', 0], ['CX', 0, 1], ['M', 0], ['M', 1]);
    const dist = (bs) => bs.map((b) => b.record.map((r) => r.bit).join('') + ':' + b.p.toFixed(6)).sort();
    eq(dist(early), dist(late));
  });
  test('uptoCol stops the simulation at that column', () => {
    const list = ops(['H', 0], ['M', 0]);
    eq(Q.simulate(1, list, 0).length, 1);
    eq(Q.simulate(1, list, 1).length, 2);
  });
  test('preparedState ignores the first measurement and everything after it', () => {
    const list = ops(['H', 0], ['M', 0], ['X', 0]);
    bloch(Q.blochVector(Q.preparedState(1, list), 1, 0), 1, 0, 0);
  });

  // ---- Laws that must hold for every circuit ----
  const rng = seeded(20261106);
  const cases = [];
  for (let i = 0; i < 40; i++) {
    const n = 1 + Math.floor(rng() * 5);
    cases.push({ n, list: randomCircuit(n, 4 + Math.floor(rng() * 16), rng) });
  }
  const norm = (s) => s.re.reduce((a, v, i) => a + v * v + s.im[i] * s.im[i], 0);
  const qubitsOf = (n) => Array.from({ length: n }, (_, i) => i);

  test('Random circuits stay normalised', () => {
    for (const c of cases) close(norm(final(c.n, ...c.list)), 1, 'norm');
  });
  test('Branch probabilities sum to 1 and each branch stays normalised', () => {
    for (const c of cases) {
      const measured = c.list.concat(qubitsOf(c.n).map((q) => ['M', q]));
      const bs = run(c.n, ...measured);
      close(bs.reduce((a, b) => a + b.p, 0), 1, 'Σp');
      bs.forEach((b) => close(norm(b.state), 1, 'branch norm'));
    }
  });
  test('Sequential measurement matches all-at-once, in any order', () => {
    for (const c of cases) {
      const s = final(c.n, ...c.list);
      const qs = qubitsOf(c.n);
      const atOnce = Q.jointProbabilities(s, c.n, qs);
      for (const order of [qs, qs.slice().reverse()]) {
        for (const o of Q.measureSequence(s, c.n, order)) {
          const key = qs.map((q) => o.bits[order.indexOf(q)]).join('');
          close(o.p, atOnce[key], `P(${key})`, 1e-8);
        }
      }
    }
  });
  test('Marginals: measuring one qubit matches summing the joint over the others', () => {
    for (const c of cases) {
      const s = final(c.n, ...c.list);
      const joint = Q.jointProbabilities(s, c.n, qubitsOf(c.n));
      for (const q of qubitsOf(c.n)) {
        let p1 = 0;
        for (const key in joint) if (key[q] === '1') p1 += joint[key];
        const r = Q.measureQubit(s, c.n, q).find((x) => x.bit === 1);
        close(r ? r.p : 0, p1, `q${q}`, 1e-8);
      }
    }
  });
  test('No-signalling: measuring q0 leaves the other qubits unchanged on average', () => {
    for (const c of cases) {
      if (c.n < 2) continue;
      const s = final(c.n, ...c.list);
      const outcomes = Q.measureSequence(s, c.n, [0]);
      for (let q = 1; q < c.n; q++) {
        const before = Q.blochVector(s, c.n, q);
        const after = Q.averageBloch(outcomes, c.n, q);
        bloch(after, before.x, before.y, before.z, `q${q}`);
      }
    }
  });
  test('Bloch vectors never exceed length 1', () => {
    for (const c of cases) {
      const s = final(c.n, ...c.list);
      qubitsOf(c.n).forEach((q) => {
        if (Q.blochLength(Q.blochVector(s, c.n, q)) > 1 + 1e-9) throw new Error('|r| > 1');
      });
    }
  });
  test('Sampling converges on the exact probabilities', () => {
    const items = [{ p: 0.25 }, { p: 0.75 }];
    const counts = Q.sample(items, 100000, seeded(7));
    close(counts[0] / 100000, 0.25, 'freq', 0.01);
  });

  // ---- Formatting ----
  test('Magnitudes print as exact forms where possible', () => {
    eq(Q.formatMagnitude(Math.SQRT1_2), '1/√2');
    eq(Q.formatMagnitude(0.5), '1/2');
    eq(Q.formatMagnitude(1 / Math.sqrt(3)), '1/√3');
    eq(Q.formatMagnitude(Math.sqrt(3) / 2), '√3/2');
    eq(Q.formatMagnitude(0.123), '0.123');
  });
  test('Angles print as fractions of π', () => {
    eq(Q.formatAngle(Math.PI / 2), 'π/2');
    eq(Q.formatAngle(3 * Math.PI / 4), '3π/4');
    eq(Q.formatAngle(-Math.PI / 4), '−π/4');
    eq(Q.formatAngle(Math.PI), 'π');
    eq(Q.formatAngle(0), '0');
    eq(Q.formatAngle(1), '1.00');
  });
  test('Kets print in Dirac notation', () => {
    eq(Q.formatKet(Q.zeroState(2), 2), '|00⟩');
    eq(Q.formatKet(final(1, ['H', 0]), 1), '1/√2 (|0⟩ + |1⟩)');
    eq(Q.formatKet(final(1, ['H', 0], ['Z', 0]), 1), '1/√2 (|0⟩ − |1⟩)');
    eq(Q.formatKet(final(2, ['H', 0], ['CX', 0, 1]), 2), '1/√2 (|00⟩ + |11⟩)');
    eq(Q.formatKet(final(1, ['Y', 0]), 1), 'i|1⟩');
    eq(Q.formatKet(final(1, ['H', 0], ['S', 0]), 1), '1/√2 (|0⟩ + i|1⟩)');
    eq(Q.formatKet(final(1, ['H', 0], ['T', 0]), 1), '1/√2 (|0⟩ + e^(iπ/4)|1⟩)');
    eq(Q.formatKet(final(1, ['Ry', 0, Math.PI / 3]), 1), '√3/2|0⟩ + 1/2|1⟩');
  });
  test('Dropping global phase: Y|0⟩ reads as |1⟩', () => {
    eq(Q.formatKet(final(1, ['Y', 0]), 1, { dropGlobalPhase: true }), '|1⟩');
  });

  // ---- Report ----
  const failed = results.filter((r) => !r.ok);
  document.getElementById('summary').textContent =
    failed.length ? `${failed.length} of ${results.length} FAILED` : `All ${results.length} tests passed`;
  document.getElementById('summary').className = failed.length ? 'fail' : 'pass';
  const out = document.getElementById('results');
  results.forEach((r) => {
    const div = document.createElement('div');
    div.className = r.ok ? 'pass' : 'fail';
    div.textContent = `${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `\n   ${r.msg}`}`;
    out.appendChild(div);
  });
  window.TEST_RESULTS = { total: results.length, failed: failed.map((r) => `${r.name}: ${r.msg}`) };
})();
