# Quantum Measurement Lab

A hands-on companion for a quantum computing course. Students design a circuit, place measurements, and see what measuring one qubit does compared with measuring all of them, with live Bloch spheres alongside.

It runs entirely in the browser, with nothing to install and no internet connection needed.

## Run it

**Students:** open the course's hosted link (see [Publish for your class](#publish-for-your-class)), or download this repository and double-click `index.html`.

**Instructors**, to work on it locally:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## What students can do

| View | What it shows |
|---|---|
| **Circuit designer** | 1–5 qubits. Pauli, H, S, T, rotation, CNOT, CZ and SWAP gates, and measurement. Drag to place, move and delete. Click a gate to see its matrix or set its angle. |
| **State & Bloch spheres** | The state in Dirac notation, the amplitudes and phases, and one Bloch sphere per qubit. The step slider walks through the circuit gate by gate. |
| **Run measurements** | Exact probabilities next to sampled frequencies. *Measure once* shows a single collapse, and clicking any result shows the state it leaves behind. |
| **Compare: one qubit vs all** | Two measurement choices side by side on the same state: every possible result, what each leaves on the unmeasured qubits, and a table comparing all-at-once with one-at-a-time. |

Measurements can go anywhere, not only at the end. The simulator follows every possible result exactly, so mid-circuit measurement works too.

## Guided labs

The side panel loads each circuit and asks students to predict before they run. Answers are hidden until a student opens them.

| # | Lab | Main idea |
|---|---|---|
| 1 | The Born rule | P(1) = sin²(θ/2) |
| 2 | Gates turn the Bloch vector | Gates are rotations; Z-axis rotations change only φ |
| 3 | Phase is invisible to measurement | \|+⟩ and \|−⟩ give the same histogram until an H is added |
| 4 | Measurement destroys interference | H M H M is uniform, H H M is not, and re-measuring repeats |
| 5 | One qubit of a product state | An unentangled neighbour is left alone |
| 6 | One qubit of a Bell pair | Reading q0 fixes q1, yet nothing can be signalled |
| 7 | All at once or one at a time? | Z measurements on different qubits commute |
| 8 | What the histogram cannot show | CZ entanglement is invisible to a measure-all histogram |
| 9 | Deferred measurement | Moving a measurement past a control keeps the statistics |

A possible order: labs 1–3 for measurement and the Bloch sphere, lab 4 for collapse, then labs 5–8 for multi-qubit measurement. Lab 9 works as an extension.

**Sharing a circuit:** *Copy link* puts the whole circuit in the URL, so you can post a link to any circuit in your course materials.

**Adding a lab:** add an entry to [js/labs.js](js/labs.js). The format is described at the top of the file.

## Conventions to tell your students

- **Qubit order:** q0 is the leftmost qubit in a ket, so |10⟩ means q0 = 1. This matches Nielsen & Chuang. **Qiskit uses the reverse order**, so its results will read backwards compared with this lab.
- **Measurement basis:** M always measures in the Z basis. To measure in the X basis, add H before M. For the Y basis, add S† and then H.
- **Bloch vector length:** a qubit's arrow is computed from its reduced density matrix, so a qubit entangled with others has an arrow shorter than 1. Both qubits of a Bell pair sit at the centre.
- **Average view:** on the State tab, after a measurement, *Average over all results* shows the mixture before anyone reads the result. Pick a specific result to see the collapsed state.
- **Compare tab:** it uses the gates before the first M, then applies each scenario's own measurements. M gates in the circuit and anything after them are set aside there.

## Project layout

```
index.html              Page structure
css/style.css           Styles, including light and dark themes
js/quantum.js           The simulator: exact, no dependencies, written to be read
js/bloch.js             Bloch sphere drawing
js/app.js               Circuit editor and result views
js/labs.js              Guided lab content
tests/index.html        Open in a browser to run the physics tests
tests/quantum.test.js   The tests themselves
```

The tests cover gate actions, Bloch axes and collapse, and run laws that must hold for every circuit on randomly generated circuits: normalisation, all-at-once matching sequential measurement in any order, marginals, and no-signalling.

## Publish for your class

The site is static, so GitHub Pages can host it directly. Push to GitHub, then go to **Settings → Pages**, and under *Build and deployment* choose **Deploy from a branch**, with `main` and `/ (root)`. Students can then use the link on any device.
