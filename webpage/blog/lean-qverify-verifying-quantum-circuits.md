---
layout: post.njk
title: "Formally Verifying Quantum Circuits: 52 Machine-Checked Proofs with Lean 4"
date: 2026-11-23
permalink: /blog/lean-qverify-verifying-quantum-circuits/
---

*What if a proof assistant could guarantee your quantum circuit is correct — not just for inputs you tested, but for every possible input, forever?*

> **Code**: [akkeshavan/lean-qverify](https://github.com/akkeshavan/lean-qverify)

---

## The Bug That Doesn't Crash

Here is a property of quantum bugs that makes them uniquely annoying: they don't throw exceptions.

A classical bug is polite. It segfaults, raises an exception, or returns the wrong type. You notice it, fix it, and move on.

A quantum bug produces slightly wrong measurement statistics. Your Bell state preparation is off by a rotation of π/4? Every run still gives you a result. The distribution is subtly skewed — maybe 52% zeros instead of 50%. You'd need thousands of shots and careful statistical analysis to even notice. By the time you find it, you've already published the paper, run the experiment, or deployed the circuit to actual hardware.

I wanted to do something about this. The result is [lean-qverify](https://github.com/akkeshavan/lean-qverify): a Lean 4 library that formally proves properties of quantum circuits — not by running them, but by mathematical proof that holds for every possible input, forever.

If you want to skip ahead: clone the repo, run `lake build` inside the [`theorems/`](https://github.com/akkeshavan/lean-qverify/tree/main/theorems) directory, and Lean's kernel will independently verify all 50 theorems on your machine in under 10 minutes. No trust required — the kernel checks the proof from scratch.

This post explains what that means, how it works, and what 52 machine-checked theorems actually look like.

---

## First: What Is a Quantum Circuit?

If you're a software developer who hasn't touched quantum computing before, here's the one-paragraph version.

A classical computer operates on bits — 0 or 1. A quantum computer operates on **qubits** — things that can be 0, 1, or a superposition: a weighted mixture of both at once, described by two complex numbers. When you measure a qubit in superposition, it collapses to 0 or 1 with probabilities determined by those complex numbers.

A **quantum circuit** is a sequence of **gates** applied to qubits — the quantum equivalent of logic gates. The most common ones:

- **H (Hadamard)**: puts a qubit into a 50/50 superposition. Applying it twice returns the qubit to its original state (H∘H = I).
- **X (Pauli-X)**: flips a qubit, like a NOT gate.
- **CNOT (controlled-NOT)**: flips a "target" qubit only if a "control" qubit is in state 1. This creates entanglement.
- **RZ(θ)**: rotates a qubit around the Z-axis by angle θ. These are the continuous parameters in variational quantum algorithms.

Mathematically, each gate is a **2×2 unitary matrix** (a complex matrix whose inverse equals its conjugate transpose). A circuit on *n* qubits is a product of **2ⁿ × 2ⁿ** unitary matrices. The state of the system is a vector of 2ⁿ complex amplitudes. Measurement probabilities are squared magnitudes of those amplitudes.

This is why simulation is hard: a 50-qubit circuit requires tracking 2⁵⁰ — roughly one quadrillion — complex numbers. Full simulation of anything interesting is off the table.

---

## Why Testing Doesn't Work

The standard approach to circuit validation is to simulate it on a few input states and check that the output looks right.

This has two fundamental problems.

**Problem 1: You can't cover the input space.** Quantum circuits operate on *continuous* inputs — the input is a unit vector in a 2ⁿ-dimensional complex Hilbert space. That's a space with infinitely many possible inputs. Testing ten of them tells you those ten are fine. It tells you nothing about the infinity you didn't test.

**Problem 2: Simulation doesn't scale.** Tracking the full state of an *n*-qubit system requires 2ⁿ complex numbers. That's fine for 5 qubits (32 numbers). It's impractical for 50 qubits (1 quadrillion numbers) and physically impossible beyond ~60 qubits. Real quantum hardware today has hundreds to thousands of qubits.

Formal verification sidesteps both problems. Instead of running the circuit on specific inputs, you write a mathematical statement — "measuring qubit 0 always gives 0 or 1 with equal probability" — and ask a proof assistant to verify that statement is true for *all* possible inputs, by logical deduction from the circuit's definition. No simulation required. If the proof goes through, you have an unconditional guarantee.

---

## Lean 4: The Proof Checker

The proof assistant I'm using is **Lean 4**, built by Leonardo de Moura at Microsoft Research and now at AWS. Lean is both a programming language and a proof assistant: you can write programs in it, state theorems about them, and prove those theorems interactively. Lean's **kernel** is a small, trusted piece of code that checks whether a proof is valid — it either accepts the proof or rejects it, with no grey area.

The key property: if Lean's kernel accepts a proof, that proof is correct. No "probably correct." No "correct up to implementation bugs in the solver." Correct.

Lean ships with **Mathlib4**, a community-maintained library of formalized mathematics covering real and complex analysis, linear algebra, topology, number theory, and more. For lean-qverify, I rely on Mathlib for complex matrix multiplication, trigonometric identities, and the `norm_num` and `ring` tactics — automated solvers for numeric and algebraic goals.

---

## How lean-qverify Works

The library has three parts.

**Part 1: A circuit model.** Circuits are represented as `List Gate`, where each gate carries its type and qubit indices. The qubit count is baked into the type: `QCircuit 2` is a circuit on 2 qubits, `QCircuit 3` on 3. An out-of-bounds CNOT is impossible to even express — the type checker catches it at compile time.

```lean
-- A Bell state circuit: H on qubit 0, then CNOT(0→1)
def bellPrep : QCircuit 2 :=
  [Gate.H 0, Gate.CNOT 0 1]
```

**Part 2: A specification language.** You describe what the circuit should do using a `satisfies` relation (written `⊨`). Specs can say things like:

- `gateCount (· matches CNOT) 1` — the circuit uses exactly 1 CNOT
- `depth ≤ 2` — the circuit has parallel depth at most 2
- `measurementProb QState.ket00 0 false (1/2)` — starting from |00⟩, measuring qubit 0 gives 0 with probability ≥ 1/2

**Part 3: Proofs.** For each spec, Lean checks whether the circuit satisfies it. For structural properties (gate count, depth), `simp` closes the goal automatically by unfolding definitions. For measurement probabilities, Lean evaluates the unitary matrix symbolically and uses `norm_num` to close arithmetic goals.

The result is a theorem — a named, kernel-checked proof that holds for all inputs.

---

## What the Proofs Actually Look Like

Here's the Bell state entanglement theorem, one of the nine Bell state proofs in the library:

```lean
-- From theorems/BellState.lean — the independent verification wrapper.
-- Lean's kernel checks that LeanQVerify.bellPrep_entangled has exactly this type.
example : bellPrep ⊨ .measurementProb QState.ket00 0 false (1/2) :=
  LeanQVerify.bellPrep_entangled
```

The *proof* works by unfolding the circuit into its 4×4 unitary matrix, computing the matrix-vector product with the |00⟩ input vector, squaring the first amplitude to get a probability, and asking `norm_num` to verify that the result is ≥ 1/2. For a 2-qubit circuit, this is about 20 lines of Lean.

For gate algebra — identities like H∘H = I — the proofs are even shorter because `simp` can close them directly from the matrix definitions:

```lean
-- H applied twice is the identity.
theorem H_H_eq_id : [Gate.H 0, Gate.H 0] ≅ [] := by
  simp [gateEquiv, embedGate1_self_inverse]
```

---

## The 52 Theorems

The library contains 52 machine-checked theorems across the project. 50 live in the independent `theorems/` sub-package — these are the ones a reviewer can verify with a standalone `lake build`. The remaining 2 are worked examples in the companion book. The 50 independent theorems fall into seven groups.

**Bell states (T1–T9):** Nine theorems about the simplest entangled state — that it uses 2 gates, has depth ≤ 2, and that the joint measurement probabilities are P(|00⟩) ≥ 1/2, P(|11⟩) ≥ 1/2, P(|01⟩) = 0, P(|10⟩) = 0. These are the theorems that confirm Bell entanglement: the two qubits are perfectly correlated.

**GHZ and teleportation (T10–T12):** The GHZ state is a 3-qubit generalization of Bell entanglement, used in quantum communication. Quantum teleportation transmits the full quantum state of a qubit using an entangled pair and 2 classical bits. These three theorems verify structural properties of both circuits.

**Hardware-efficient ansatz (T13–T18):** A hardware-efficient ansatz (HEA) is a circuit architecture designed to be efficiently implementable on real quantum hardware — alternating layers of single-qubit rotations and CNOTs. Six theorems verify gate counts, depth, and two algebraic reduction properties: at zero rotation angles, the HEA reduces to a plain CNOT chain.

**Gate algebra (T19–T28):** The core library of quantum gate identities. These are the quantum equivalents of Boolean algebra laws:

- H² = X² = Y² = Z² = I (every Pauli gate and Hadamard is its own inverse)
- CNOT² = I (CNOT applied twice cancels out)
- HXH = Z (Hadamard conjugates X into Z — the two Pauli axes are related by this transformation)
- HZH = X (and conversely)
- RZ(0) = I (a zero-angle rotation does nothing)
- RZ(θ) ∘ RZ(φ) = RZ(θ+φ) (rotation angles add)
- SWAP = CNOT∘CNOT∘CNOT (the SWAP gate is equivalent to three CNOTs)

**Grover's algorithm (T29):** Grover's algorithm searches an unsorted database of N items in O(√N) steps — a quadratic speedup over classical search. Theorem T29 verifies that after one Grover step on a 2-qubit system, the probability of measuring the target state is ≥ 0.99. The proof evaluates a 4×4 matrix numerically using `norm_num`.

**Density matrices and QASM (T30–T38):** The density matrix formalism extends quantum mechanics to mixed states (statistical mixtures of pure quantum states), needed for modeling noise and decoherence. T30–T31 prove that the basic density matrix operations preserve the required mathematical structure (Hermitian, positive semi-definite, trace 1). T32–T35 prove counting theorems for parameterized circuit families. T36–T38 prove that the QASM parser is sound — if the checker says a program is well-formed, the formal `wellFormed` predicate holds.

**Variational circuits (T39–T50):** This is the new group, the main contribution. I'll explain it in detail below.

---

## Variational Quantum Algorithms: The New Frontier

The theorems in groups 1–6 are about fixed circuits. The theorems in group 7 are about *parametric* circuits — circuits where some gate angles are variables rather than constants.

This matters because the most exciting near-term applications of quantum computing — quantum chemistry simulation, combinatorial optimization, machine learning — use **variational quantum algorithms (VQAs)**. The idea: parameterize a circuit with a vector of rotation angles θ, run it on quantum hardware, measure an observable (like energy), and classically optimize θ to minimize the measurement. It's gradient descent, but the function you're optimizing is computed on a quantum computer.

The critical question for VQAs: *how do you compute the gradient of a circuit with respect to its angles?* You can't use automatic differentiation — the circuit runs on hardware, not in memory. The answer is the **parameter shift rule**.

---

## The Parameter Shift Rule

The parameter shift rule is the central result in group 7. Here's the intuition.

Consider a circuit with a single rotation gate RZ(θ). The measurement outcome is some real function f(θ). What is f'(θ) — the derivative with respect to θ?

The parameter shift rule says:

```text
f'(θ) = [f(θ + π/2) − f(θ − π/2)] / 2
```

You evaluate the circuit twice — once with θ shifted up by π/2 and once shifted down — take the difference, divide by 2, and that's the gradient. No finite differences, no approximation. The exact gradient, computed on the hardware itself.

The underlying algebraic identity is a theorem about the rotation matrix RZ(θ):

```text
RZ(θ + π/2) − RZ(θ − π/2) = −i√2 · Z · RZ(θ)
```

where Z is the Pauli-Z gate. This is the identity that Theorem T49 (`param_shift_Rz`) proves in Lean 4.

Here's what the proof does, stripped to its core:

1. Expand RZ(θ + π/2) and RZ(θ − π/2) using the Euler decomposition of the matrix exponential: exp(iθ/2) = cos(θ/2) + i·sin(θ/2).
2. Compute the matrix difference symbolically.
3. Use `ring` — Lean's algebraic simplifier — to verify that the result equals −i√2 · Z · RZ(θ).

The tricky part in Lean is managing the coercion from real numbers to complex numbers. The expression `exp(-i·(θ/2))` looks innocent, but Lean needs to know whether to coerce θ first and then divide, or divide first and then coerce — and the two orderings elaborate to different normal forms, so the proof strategy has to match the elaboration. This is the kind of detail that formal verification forces you to get exactly right.

---

## The Hybrid ZX + Symbolic Framework

The 12 variational theorems use a two-layer architecture I call the **hybrid ZX + symbolic framework**.

**Layer 1 — ZX-calculus:** The ZX-calculus is a graphical language for quantum circuits invented by Coecke and Duncan (2008). Instead of matrices, you draw circuits as graphs of "spiders" — nodes connected by wires — and reason about them by graphical rewriting rules. The key rules:

- **Spider fusion:** two spiders of the same colour merge, adding their phases.
- **Colour change:** a Hadamard gate converts a Z-spider into an X-spider and vice versa.
- **Identity removal:** a zero-phase spider with two wires disappears.

These rules let you simplify circuits graphically without ever computing a matrix product. The lean-qverify library encodes the key ZX lemmas — like `zSpiderMat_phase_Rz` (a Z-spider with phase θ implements RZ(θ)) — as Lean theorems.

**Layer 2 — Symbolic trig algebra:** For theorems involving rotation angles, we use the matrix representation directly and close goals with Euler decomposition + `ring`. The parameter shift rule is the centrepiece.

The two layers are independent: the Clifford skeleton of a circuit (the part involving only H, CNOT, X, Z — no rotation angles) is handled by ZX rewriting; the rotation angles are handled by symbolic algebra. This separation means you can reason about structure and angles separately, without mixing concerns.

The key bridge theorem is **T43: H · RZ(θ) · H = RX(θ)**. Sandwiching an RZ rotation between two Hadamard gates produces an RX rotation (rotation around the X-axis instead of Z). This is exactly the colour-change rule from ZX-calculus, expressed as a matrix identity and proved in Lean:

```lean
theorem H_Rz_H_eq_Rx (θ : ℝ) : H_mat * Rz_mat θ * H_mat = Rx_mat θ
```

The proof of this theorem took longer than it should have. The 2×2 matrix entries reduce to expressions involving `exp(±i·θ/2)`, which need to be rewritten using cos(θ/2) and sin(θ/2) via the Euler identity. Lean's `fin_cases` tactic generates four subgoals (one per matrix entry), but it introduces `Fin.mk k h` constructor indices rather than the numeric literals `0` and `1`, which blocks `simp` from firing. The fix: add two local normalization lemmas before calling `simp`:

```lean
have hfin0 : ∀ h : 0 < 2, (⟨0, h⟩ : Fin 2) = 0 := fun _ => Fin.ext rfl
have hfin1 : ∀ h : 1 < 2, (⟨1, h⟩ : Fin 2) = 1 := fun _ => Fin.ext rfl
```

This kind of detail is what formal verification looks like in practice: not grand theorems falling from the sky, but careful negotiation with the elaborator, one definitional equality at a time.

---

## Zero Sorry: What That Means

In Lean, `sorry` is a placeholder that lets you skip a proof. A theorem proved with `sorry` is not actually proved — it's assumed. The lean-qverify library has a strict rule: **none of the 52 proved theorems use `sorry`**.

You can verify this:

```bash
# From the repo root — should produce no output
grep -Ern "^\s*sorry\s*$|:=\s*sorry" \
  LeanQVerify/Circuit/Identities.lean \
  LeanQVerify/Circuit/Variational.lean \
  LeanQVerify/ZX/HybridRules.lean \
  ...
```

The repo does have 6 `sorry` stubs, all in `Stabilizer/Sound.lean`. These are for a single unresolved mathematical claim — stabilizer-state uniqueness under Z measurement — that is a known result from the Aaronson–Gottesman paper but hasn't been transcribed into Lean yet. These stubs are **not** in any proved theorem's dependency chain. You can check: `#print axioms T49` on the parameter shift rule shows only `Classical.choice`, `propext`, `Quot.sound`, and `funext` — the standard Lean 4 axioms that every proof uses.

The independent `theorems/` sub-package makes this checkable by anyone. It's a separate Lean project that imports the library and states each theorem as:

```lean
-- T49: parameter shift rule
example : ∀ θ : ℝ,
    Rz_mat (θ + π/2) - Rz_mat (θ - π/2) =
    (-Complex.I * Real.sqrt 2) • (Z_mat * Rz_mat θ) :=
  param_shift_Rz
```

If you run `lake build` in that directory and it succeeds, every one of the 52 statements has been verified by Lean's kernel on your machine.

---

## The Python Bridge

The library also includes a Python bridge for people who want to use it without writing Lean.

```python
from qiskit import QuantumCircuit
from lean_qverify import verify_circuit

qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)

result = verify_circuit(qc)
# VerifyResult(status='parsed', nQubits=2, nGates=2, warnings=[])
```

The pipeline: Qiskit circuit → OpenQASM 3 → Lean parser → structural verification. For simple structural properties, the Python bridge reports results immediately. For measurement probability specs, it falls back to Qiskit Aer simulation for concrete inputs when the automatic Lean proof doesn't close.

This is the entry point for most users. The formal Lean proofs are what the Python bridge aspires to be when it grows up.

---

## Limitations

This is an early experiment.

The stabilizer backend — which lets you verify Clifford circuits without computing their full exponentially-large matrix — has the 6 unproved claims mentioned above. They don't affect any current theorem, but they do limit the backend's formal soundness guarantee. This is also where **Problem 2** from the opening bites back: the symbolic matrix unfolding used in proofs like `bellPrep_entangled` and Grover works fine for small circuits, but scaling behavioral proofs to 50+ qubits requires a sound stabilizer (or ZX rewriting) backend. Finishing those 6 stubs is what closes the gap between "proofs about small circuits" and "proofs about circuits of arbitrary size."

Post-measurement state collapse is not modelled. The density matrix formalism handles mixed states and unitary evolution, but measuring a qubit and conditioning on the outcome (the "if the measurement was 0, do this next" pattern) requires partial trace and projection operators that are stubbed out.

The Python bridge's automated verification is good at finding structural problems but can't yet close all proof obligations automatically. Closing a measurement probability spec still requires writing a Lean proof by hand.

None of this affects the 52 proved theorems. Those proofs are clean.

---

## Why This Matters

Quantum hardware is getting serious. IBM has 1,000+ qubit devices. Compilation pipelines for real hardware have bugs. Those bugs don't crash — they shift your expectation values by 3% and you blame the noise model.

Formal verification for quantum circuits is not a solved problem. The main prior work is SQIR and VOQC (Coq, 2021), which verified quantum compilers for a specific set of algorithms. lean-qverify is different in two ways: it targets Lean 4 with Mathlib4 rather than Coq, and it covers variational quantum algorithms — the class of algorithms most likely to run on near-term hardware — including, to my knowledge, the first machine-checked proof of the parameter shift rule in Lean 4.

It's also just useful to have a library of kernel-checked quantum identities. When you write a quantum compiler and want to know whether H∘RZ(θ)∘H = RX(θ), there's now a formal proof you can point to. Not "I ran it on 100 inputs." A proof.

The library is on GitHub. If you're familiar with Lean 4, the `theorems/` directory is the place to start: each theorem is stated there in plain form, and `lake build` verifies all 52 in under 10 minutes.

---

*Next up: closing the 6 stabilizer sorry stubs, extending the parameter shift rule to multi-qubit gates, and working toward a formally verified quantum compiler.*

---

## Resources

- **[akkeshavan/lean-qverify](https://github.com/akkeshavan/lean-qverify)** — the library. `lake build` verifies all 52 theorems from scratch.
- **[theorems/](https://github.com/akkeshavan/lean-qverify/tree/main/theorems)** — the independent verification sub-package. Each theorem is stated in plain form; build it to get your own machine-checked certificate.
- **[Lean 4](https://lean-lang.org/)** — the proof assistant. Free, open source, runs on macOS, Linux, and Windows.
- **[Mathlib4](https://leanprover-community.github.io/mathlib4_docs/)** — the community mathematics library lean-qverify builds on.
- **[ZX-calculus for the working quantum computer scientist](https://arxiv.org/abs/2012.13966)** — van de Wetering (2020). The best introduction to the graphical rewriting framework used in the variational theorems.
- **[Parameter shift rule](https://arxiv.org/abs/1811.11184)** — Schuld et al. (2019). The original paper proving the analytic gradient rule that T49 formalises.
