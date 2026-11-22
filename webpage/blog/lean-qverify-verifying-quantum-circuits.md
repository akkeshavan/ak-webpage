---
layout: post.njk
title: "Is it possible to verify correctness of quantum circuits (programs)?"
date: 2026-11-22
---

*Building a bridge between Qiskit and Lean 4 so a proof assistant can check your quantum code.*

> **Code**: [akkeshavan/lean-qverify](https://github.com/akkeshavan/lean-qverify)

---

## The Bug That Doesn't Crash

Here is the thing about quantum circuits: when they go wrong, they don't tell you.

A classical bug throws an exception, produces a wrong value, fails a test. A quantum bug produces slightly wrong measurement statistics. Your Bell state preparation is off by a rotation angle of π/4? Every run gives you a result. The distribution is subtly skewed. You'd need thousands of shots and careful statistical analysis to notice — and by then you've already published your paper.

I've been thinking about this for a while. The standard approach is to simulate the circuit and check a few input states. But simulation has two problems. First, it only checks the inputs you thought to test. Second, it doesn't scale — simulating an n-qubit system requires tracking 2ⁿ amplitudes, which means 50 qubits needs more memory than exists on Earth. For anything interesting, full simulation is off the table.

So what do you do instead?

---

## Testing Isn't a Proof

The core issue is that a quantum circuit operates on a continuous space. Its inputs are unit vectors in a 2ⁿ-dimensional complex Hilbert space — which is a fancy way of saying there are infinitely many possible input states. Testing ten of them tells you those ten are fine. It tells you nothing about the other infinity.

Formal verification works differently. Instead of running the circuit on specific inputs, you write a mathematical statement about what the circuit should do — "measuring qubit 0 always gives 0 or 1 with equal probability" — and ask a proof assistant to verify that statement is true for every possible input, forever, with no exceptions. If the proof goes through, you have a guarantee. If it doesn't, you get a concrete counterexample telling you exactly which input breaks the property.

This is what I've been building: [lean-qverify](https://github.com/akkeshavan/lean-qverify), a tool that lets you write your circuit in Qiskit (like a normal person) and then have Lean 4's proof kernel check it against a formal specification.

---

## How It Works

The pipeline has three steps.

**Step 1: Write your circuit in Qiskit.** Nothing unusual here — just normal Qiskit code.

```python
from qiskit import QuantumCircuit
from lean_qverify import verify_circuit

qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)   # Bell state: H on qubit 0, then CNOT

result = verify_circuit(qc)
# VerifyResult(status='parsed', nQubits=2, nGates=2, warnings=[])
```

**Step 2: Export to OpenQASM 3.** The bridge calls `qiskit.qasm3.dumps()` and ships the result to the Lean side. QASM is a standard interchange format for quantum circuits — it's readable text, not a binary blob.

**Step 3: Lean 4 parses, elaborates, and checks.** A recursive-descent parser converts the QASM into a typed `QCircuit n` value where `n` is the qubit count. This isn't just parsing into a string — the qubit count is baked into the type, so an out-of-bounds CNOT is impossible to even express. Then you write a spec and Lean checks it.

For simple structural properties, the proof is automatic:

```lean
-- Does Bell prep use exactly 2 gates? Lean figures it out.
theorem bell_two_gates : bellPrep ⊨ .gateCount (fun _ => true) 2 := by
  simp [satisfies, countGates, bellPrep]
```

For measurement probabilities — "measuring qubit 0 on the Bell state gives 0 half the time" — Lean evaluates the unitary matrix symbolically and closes the goal with `norm_num`:

```lean
theorem bell_entangled :
    bellPrep ⊨ .measurementProb QState.ket00 0 false (1/2) :=
  bellPrep_entangled
```

---

## What You Can Actually Prove

The specification language covers five kinds of property:

- **Gate count** — does the circuit use at most k gates matching some predicate?
- **Depth** — does the parallel depth stay below k?
- **Unitary equivalence** — do two circuits implement the same transformation?
- **Measurement probability** — starting from a given state, does measuring qubit i give outcome b with probability ≥ p?
- **Conjunctions** — combine any of the above.

The library comes with 52 kernel-checked theorems. A few favourites:

**H∘H = I.** Applying a Hadamard gate twice returns you to where you started. Obvious by definition, but it's good to have the proof kernel agree.

**SWAP = CNOT∘CNOT∘CNOT.** The SWAP gate is equivalent to three CNOTs in sequence. This is a standard identity in quantum compilation. The proof closes automatically.

**100-qubit GHZ.** A GHZ state across 100 qubits: measuring qubit 0 gives 0 with probability ½. The dense simulator would need 2¹⁰⁰ amplitudes. Instead, lean-qverify dispatches to a [stabilizer tableau](https://arxiv.org/abs/quant-ph/0406196) backend — an O(n²) representation for Clifford circuits — and closes the proof in seconds.

**The parameter shift rule.** This one surprised me. The parameter shift rule is used in variational quantum algorithms to compute gradients: the gradient of a circuit with respect to a rotation angle θ equals `circuit(θ + π/2) − circuit(θ − π/2)`, scaled by a constant. Lean verifies this identity symbolically using the Euler decomposition of the rotation matrix and `ring`. It's the kind of theorem that feels like it should be true, and now it's proved.

---

## Two Modes

There are two ways to use this.

**Lane A** is fast automated checking. You write a circuit in Qiskit, ask the Python bridge to verify it, and get structural feedback (gate count, depth, warnings about out-of-bounds indices). When a spec fails, the bridge runs the circuit through Qiskit Aer and searches for a concrete input state that breaks the property. This is the entry point for most users — it's just a function call.

**Lane B** is a formal proof. You write a Lean theorem, build the project with `lake build`, and Lean's kernel checks it. If it builds, the proof is as guaranteed as it gets. This is what Lane A aspires to be when it grows up.

Right now most of the formal proofs live in Lane B. Lane A's automated verification is good at finding problems but can't yet close all the proof obligations automatically. That's the gap I'm working on.

---

## Limitations

This is an early experiment. It works — 52 theorems kernel-checked, no `sorry` in any of them — but there are gaps.

The density matrix formalism is stubbed out. Post-measurement state collapse is unimplemented. The stabilizer backend has 6 mathematical claims that are assumed rather than proved (they're standard results from the Aaronson–Gottesman paper; proving them in Lean is on the roadmap, it's just tedious).

And the Python bridge is not magic. The automated counterexample search only tells you a spec is broken; it doesn't tell you *why* or how to fix it. That still needs a human.

None of this affects the proved theorems. The 52 proofs are clean. Everything else is infrastructure that I'm filling in.

---

## Why Bother

Quantum hardware is getting serious. IBM has 1000+ qubit devices. Compilation pipelines for real hardware have bugs. Those bugs don't crash — they shift your expectation values by 3% and you blame the noise model.

Formal verification for quantum circuits is not a solved problem. This is one small experiment in the direction of "what if we tried." The lean-qverify library is on GitHub if you want to look, run the examples, or write a Lean theorem of your own.

It's very much a work in progress. But it's a working work in progress.
