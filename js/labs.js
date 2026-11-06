/*
 * labs.js: the guided experiments shown in the side panel.
 *
 * To add a lab, add an entry here. ops are [gate, qubits, column, theta?].
 * tab opens that result view; compare sets the two scenarios on the Compare tab.
 * Steps and answers are trusted HTML written by the instructor.
 */
window.LABS = [
  {
    title: '1. The Born rule',
    goal: 'Connect a rotation angle to measurement probabilities.',
    n: 1,
    ops: [['Ry', [0], 0, Math.PI / 3], ['M', [0], 1]],
    tab: 'measure',
    steps: [
      'The circuit applies Ry(π/3) to |0⟩. Predict P(1) before you run anything.',
      'Run 10 shots, then 1000 more. Watch the sampled bar settle on the exact bar.',
      'Click the Ry gate and move θ to π/2, then π. What happens to P(1)?',
    ],
    answer: 'P(1) = sin²(θ/2). At π/3 that is 1/4, at π/2 it is 1/2, and at π the result is 1 every time. A handful of shots can look far from the exact value; the frequency only converges with many shots.',
  },
  {
    title: '2. Gates turn the Bloch vector',
    goal: 'See single-qubit gates as rotations of the Bloch sphere.',
    n: 1,
    ops: [['H', [0], 0], ['S', [0], 1], ['T', [0], 2], ['X', [0], 3]],
    tab: 'state',
    steps: [
      'Use the step slider below the circuit to walk through each gate. Before each step, predict where the arrow will land.',
      'Which of these gates change P(1)? Which change only the angle φ?',
      'Drag any sphere to view it from another side.',
    ],
    answer: 'H takes |0⟩ to |+⟩ on the +X axis. S turns it 90° about Z to |+i⟩, then T turns it another 45°. Both are rotations about Z, so P(1) stays at 1/2 and only φ changes. X is a 180° rotation about the X axis, which flips φ to −φ.',
  },
  {
    title: '3. Phase is invisible to measurement',
    goal: 'Find out why two different states can give the same histogram.',
    n: 1,
    ops: [['H', [0], 0], ['Z', [0], 1], ['M', [0], 2]],
    tab: 'measure',
    steps: [
      'This circuit prepares |−⟩. Run 1000 shots and note the result.',
      'Delete the Z gate so the state is |+⟩ and run again. Can the histogram tell them apart?',
      'Now drop an H just before M, with and without the Z. What changes?',
    ],
    answer: 'Both |+⟩ and |−⟩ give 50/50, because a Z-basis measurement sees only |amplitude|². Adding H rotates the X axis onto the Z axis, so the same M now measures in the X basis: |+⟩ reads 0 every time and |−⟩ reads 1 every time.',
  },
  {
    title: '4. Measurement destroys interference',
    goal: 'See that collapse is a real, irreversible change to the state.',
    n: 1,
    ops: [['H', [0], 0], ['M', [0], 1], ['H', [0], 2], ['M', [0], 3]],
    tab: 'measure',
    steps: [
      'Predict the final M result. Without the middle M, HH = I gives 0 every time.',
      'Run 1000 shots. There are two bits: the first M, then the last M.',
      'Delete the middle M and run again.',
      'Undo that, then delete the second H so you have H M M. What do the two bits always do?',
    ],
    answer: 'With the middle M, all four results appear at 1/4 each: the collapse removes the phase relationship that lets the second H interfere back to |0⟩. Without it, the result is always 0. With H M M the two bits always agree, because re-measuring a collapsed qubit repeats the same answer.',
  },
  {
    title: '5. One qubit of a product state',
    goal: 'See that measuring one qubit leaves an unentangled neighbour alone.',
    n: 2,
    ops: [['H', [0], 0], ['H', [1], 0], ['M', [0], 1]],
    tab: 'compare',
    compare: { a: [0], b: [0, 1] },
    steps: [
      'The state is |+⟩|+⟩. Look at Scenario A: measure q0 only. What is left on q1 after each result?',
      'Look at Scenario B: measure both. How many results are there now?',
      'Use the Run measurements tab with the M on q0 only, then click each result and read the Bloch spheres.',
    ],
    answer: 'q1 stays in |+⟩ whichever result q0 gives, still in superposition with its arrow still on +X. Measuring both gives four results at 1/4 each. Without entanglement, a measurement only touches the qubit it is applied to.',
  },
  {
    title: '6. One qubit of a Bell pair',
    goal: 'Compare measuring one half of an entangled pair with measuring both.',
    n: 2,
    ops: [['H', [0], 0], ['CX', [0, 1], 1], ['M', [0], 2]],
    tab: 'compare',
    compare: { a: [0], b: [0, 1] },
    steps: [
      'Check the “before” spheres: where are the arrows, and why are they so short?',
      'Scenario A measures q0 only. What happens to q1 for each result? Compare it with Lab 5.',
      'Scenario B measures both. Which results never occur?',
      'Switch Scenario A to q1 only. Does anything change in the statistics?',
    ],
    answer: 'Each qubit alone sits at the sphere’s centre (|r| = 0): it is maximally mixed, because all its information is in the correlation. Reading q0 sends q1 straight to the matching pole, though no gate touched q1. Measuring both gives only 00 and 11. Averaged over q0’s results, q1 is still 50/50, so nothing can be signalled this way.',
  },
  {
    title: '7. All at once or one at a time?',
    goal: 'Check whether measuring together differs from measuring in sequence.',
    n: 3,
    ops: [['H', [0], 0], ['CX', [0, 1], 1], ['CX', [1, 2], 2]],
    tab: 'compare',
    compare: { a: [0], b: [0, 1, 2] },
    steps: [
      'This is a GHZ state. In Scenario A, what remains on q1 and q2 after q0 is read?',
      'Scroll to the “All at once vs one at a time” table. Compare the columns.',
      'Add an Ry(π/3) to q2 at the end of the circuit (remember to place it before any M). Do the columns still agree? Which conditional probabilities changed?',
    ],
    answer: 'After q0 is read, q1 and q2 are |00⟩ or |11⟩, with no superposition left. For this state, one measurement decides all three bits. The columns always agree: Z measurements on different qubits commute, so all-at-once equals one-at-a-time in any order. What changes between orderings is only how each probability is split into conditional steps, not the final joint probability.',
  },
  {
    title: '8. What the histogram cannot show',
    goal: 'Find entanglement that a measure-all histogram cannot detect.',
    n: 2,
    ops: [['H', [0], 0], ['H', [1], 0], ['CZ', [0, 1], 1]],
    tab: 'compare',
    compare: { a: [0], b: [0, 1] },
    steps: [
      'Scenario B measures both: four results at 1/4 each. Delete the CZ. Does the histogram change?',
      'Undo the delete, then read Scenario A. What is left on q1 after each result?',
      'Add an H to q1 after the CZ and look at Scenario B again.',
    ],
    answer: 'The measure-all histogram is uniform with or without CZ, since CZ changes only phases. But Scenario A shows q1 left in |+⟩ or |−⟩ depending on q0: the state is entangled. Adding H on q1 converts that phase correlation into a bit correlation, and only 00 and 11 remain. Choosing what to measure, and in what basis, decides what you can learn.',
  },
  {
    title: '9. Deferred measurement',
    goal: 'See when measuring earlier or later makes no statistical difference.',
    n: 2,
    ops: [['H', [0], 0], ['M', [0], 1], ['CX', [0, 1], 2], ['M', [1], 3]],
    tab: 'measure',
    steps: [
      'Here q0 is measured first, then used as the CNOT control. Run 1000 shots.',
      'Drag the first M to the right of the CNOT, so both measurements come last. Run again.',
      'On the State tab, step through both versions. Where do the two versions differ, even though the final statistics match?',
    ],
    answer: 'Both give only 00 and 11 at 1/2 each: moving a measurement past a gate that uses that qubit as a control does not change the statistics. This is the principle of deferred measurement. In between, the states differ: with the M late, the pair is entangled before it is read.',
  },
];
