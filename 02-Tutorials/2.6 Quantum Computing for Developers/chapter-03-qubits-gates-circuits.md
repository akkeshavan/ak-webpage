# Chapter 3: Qubits, Gates, and Circuits

**Estimated time:** 45 minutes
**Code directory:** `code/chapter-03/`
  
---

## What this chapter covers

Chapter 1 explained qubits conceptually. This chapter makes them concrete. You'll see how a qubit's state is written as a vector, what quantum gates actually are under the hood, how to build your first real circuits in Qiskit and PennyLane, and how to read a circuit diagram without guessing.

There's a bit of math here — but not much. If you can read a 2x2 array and understand what a function does, you have everything you need.

---

## 3.1 Superposition — what it actually means

This term gets misused enough that it's worth pinning down before any code.

**Superposition** is when a qubit has no definite value yet. Not "we don't know if it's 0 or 1." Not "it's secretly one of them." It genuinely has no fixed value until you measure it. Both possibilities coexist at the same time, and the qubit carries a probability of becoming each one when it finally lands.

A good way to picture it: imagine you're spinning a coin on a table. While it's spinning, you can't say it's heads or tails — it's kind of both. The instant it falls flat, it's one or the other. A qubit in superposition is like that spinning coin. Measuring it is like stopping the spin.

This matters for programming because it means you can't just "check" a qubit mid-computation. The act of checking — measuring — ends the superposition and gives you one definite classical value. After that, the quantum information is gone.

There's a second thing superposition lets you do: carry probability weights. The qubit doesn't just split 50/50 between 0 and 1. You can set it up so that, say, there's a 75% chance of measuring 0 and a 25% chance of measuring 1. Your circuit gates are the tools that adjust those weights.

---

## 3.2 Qubits as vectors

To write code that works, you need to know how a qubit's state is actually stored. The answer is a vector of two numbers.

A qubit's state looks like this:

```
|ψ⟩ = α|0⟩ + β|1⟩
```

Ignore the weird brackets for a second. What this says is: the qubit is in some mix of "0-ness" and "1-ness", with α controlling how much 0 and β controlling how much 1. They're both complex numbers, and they have to satisfy:

```
|α|² + |β|² = 1
```

This is just saying the probabilities add up to 1. If you measure, the probability of getting 0 is |α|² and the probability of getting 1 is |β|².

Written as column vectors, the two "pure" states look like:

```
|0⟩ = [1]      |1⟩ = [0]
      [0]             [1]
```

`|0⟩` is the state "definitely 0". `|1⟩` is "definitely 1". Any other state is somewhere between them.

### What is ket notation?

The `|⟩` symbols — called **ket notation** — are just a physicist's way of labelling quantum states. `|0⟩` means "the state we call zero." `|ψ⟩` means "some arbitrary state we're calling psi." You'll see this all over Qiskit docs and textbooks. It's just a naming convention, not magic.

### Two states worth memorising

These come up so often they have names:

```
|+⟩ = (|0⟩ + |1⟩) / √2
|-⟩ = (|0⟩ - |1⟩) / √2
```

`|+⟩` is equal superposition — exactly 50% chance of 0, 50% chance of 1. `|-⟩` is also 50/50, but the "1 component" has a negative sign, which means it has a different **phase**. Phase is invisible when you measure — both states give the same 50/50 result — but it matters enormously during computation because it controls how states interfere with each other. More on that in later chapters.

### What about phase?

Phase is the angle of a complex number. You can think of it like the direction a clock hand is pointing. Two states can have the same probability amplitudes but point in different directions. When those states interact (interfere), they either add up or cancel out depending on which way their phases point. It's the same idea as sound waves — two waves can reinforce each other or cancel each other depending on whether their peaks and troughs align. This interference is the engine behind quantum speedup.

### Two qubits together

When you have two qubits, the state space gets bigger. Two classical bits have 4 possible values (00, 01, 10, 11) and they hold exactly one at a time. Two qubits can be in a superposition of all four simultaneously:

```
|ψ⟩ = α|00⟩ + β|01⟩ + γ|10⟩ + δ|11⟩
```

This is why 300 qubits can hold more states simultaneously than there are atoms in the universe. The number of amplitudes doubles with every qubit you add.

---

## 3.3 Quantum gates — what they really are

A quantum gate is just a matrix. Applying a gate to a qubit means multiplying that matrix by the qubit's state vector. Once that clicks, a lot follows.

For example: the **X gate** (the quantum equivalent of NOT) is:

```
X = [0  1]
    [1  0]
```

Take the state |0⟩ = [1, 0] and multiply:

```
[0  1] × [1]  =  [0]  =  |1⟩
[1  0]   [0]     [1]
```

It flipped 0 to 1. Exactly what NOT should do.

- Applying two gates in a row means multiplying two matrices together. The order matters (matrix multiplication is not commutative).
- Running a circuit backwards means applying the inverse matrices — which always exist for quantum gates (unlike classical gates like AND, which throw away information).
- A gate that does nothing is the identity matrix. Any gate applied twice that equals identity undoes itself.

All quantum gates (except measurement) are **unitary matrices**. Unitary just means: the matrix doesn't lose any probability. Measure before and after — the total probability still sums to 1. Think of it as energy-conserving: nothing leaks out.

### Single-qubit gates

**X gate** — flips 0 to 1 and 1 to 0. Quantum NOT.

```
X = [0  1]
    [1  0]
```

**Hadamard gate (H)** — puts a qubit in equal superposition. This is the most used gate in quantum computing. Start with |0⟩, apply H, and you get |+⟩ — exactly 50% chance of 0 or 1 when measured.

```
H = 1/√2 × [1   1]
            [1  -1]
```

Start with |1⟩ and apply H? You get |-⟩. The probabilities are still 50/50 but the phase is flipped.

**Z gate** — does nothing to |0⟩, but flips the phase of |1⟩ (from +1 to -1). Invisible when you measure directly, but affects interference later.

```
Z = [1   0]
    [0  -1]
```

**Y gate** — combination of X and Z. Less common but needed for some algorithms.

**S and T gates** — these rotate the phase by specific angles (π/2 and π/4 respectively). Used mainly in error correction and certain algorithm constructions. You won't touch them much in the early chapters.

**Rotation gates (Rx, Ry, Rz)** — these are the workhorses of variational quantum algorithms. They rotate the qubit state by any angle θ around one of the three axes. The parameter θ is what you train when you're doing quantum machine learning — these are the "weights" of a quantum neural network.

```
Rx(θ) = [cos(θ/2)      -i·sin(θ/2)]
        [-i·sin(θ/2)    cos(θ/2)  ]
```

Don't memorise that. Just know: Rx(π) is the same as the X gate (a 180° rotation flips the qubit). Rx(0) does nothing.

### Two-qubit gates

Single-qubit gates alone can't create entanglement — that needs two-qubit gates.

**CNOT (Controlled-NOT, also called CX)**

This is the most important two-qubit gate. It takes two qubits: a **control** and a **target**. The rule is simple: if the control qubit is |1⟩, flip the target. If the control is |0⟩, do nothing.

```
CNOT = [1 0 0 0]
       [0 1 0 0]
       [0 0 0 1]
       [0 0 1 0]
```

Written out in plain English:
- |00⟩ → |00⟩  (control=0, nothing happens)
- |01⟩ → |01⟩  (control=0, nothing happens)
- |10⟩ → |11⟩  (control=1, target gets flipped)
- |11⟩ → |10⟩  (control=1, target gets flipped)

Now here's the trick that creates entanglement: put the control qubit in superposition (using H), then apply CNOT. The control is 50% likely to be 0 and 50% likely to be 1, so the CNOT "conditionally flips" the target in superposition. The result is two qubits that are now linked — you can't describe their states independently anymore. That's entanglement.

**SWAP** — swaps the states of two qubits. Comes up a lot in real hardware when two qubits that need to interact aren't physically adjacent to each other.

**CZ (Controlled-Z)** — if both qubits are |1⟩, apply a phase flip to the target. Functionally different from CNOT but used for the same kinds of entangling operations.

**Toffoli (CCX)** — a three-qubit gate with two controls and one target. Only flips the target if both controls are |1⟩. It's the quantum equivalent of AND, and it's how you build classical logic inside a quantum circuit.

---

## 3.4 The Bloch sphere

Visualising a qubit is awkward because its state involves complex numbers. But there's a trick: any single-qubit state can be mapped to a point on the surface of a sphere, called the **Bloch sphere**.

- The north pole is |0⟩
- The south pole is |1⟩
- Points on the equator are superpositions (50/50 probability)
- |+⟩ sits on the equator along the X axis
- |-⟩ sits on the equator on the opposite side

Gates are rotations of this sphere:
- X gate: spin 180° around the X axis (north pole lands at south pole)
- H gate: spin 90° around Y, then 180° around X
- Rz(θ): spin θ radians around the Z axis

The Bloch sphere is genuinely useful for building intuition about single-qubit gates. The limitation is that it only works for one qubit — entangled multi-qubit states can't be drawn this way. But for single-qubit operations it's the clearest mental picture available.

Run `code/chapter-03/bloch_sphere.py` to generate visual plots of the states described above.

---

## 3.5 Building circuits in Qiskit

Enough theory. Here's how you actually write quantum code.

In Qiskit, a circuit is an object. You create it, add gates to it, and run it. Think of it like building a SQL query — you're constructing an instruction set that gets executed later, not running things line by line.

```python
from qiskit import QuantumCircuit

# Create a circuit with 2 qubits and 2 classical bits
# The classical bits are where measurement results go
qc = QuantumCircuit(2, 2)

# Add gates
qc.h(0)       # Hadamard on qubit 0 — puts it in superposition
qc.cx(0, 1)   # CNOT: qubit 0 controls qubit 1 — creates entanglement

# Measure both qubits and store results in the classical bits
qc.measure([0, 1], [0, 1])

print(qc.draw())
```

Output:
```
     ┌───┐      ░ ┌─┐
q_0: ┤ H ├──■───░─┤M├───
     └───┘┌─┴─┐ ░ └─┘┌─┐
q_1: ─────┤ X ├─░────┤M├
          └───┘ ░    └─┘
c: 2/══════════════════════
```

Let's walk through every symbol in this diagram, one at a time. Read left to right — that's time moving forward.

**The horizontal lines — `q_0:` and `q_1:`**

Each horizontal line represents one qubit moving through time, left to right. Think of it like a wire. At the far left, before any gates, both qubits start in state |0⟩ — the quantum equivalent of "off." Whatever happens to them is shown along that line.

**`┤ H ├` on q_0 — the Hadamard gate**

This is the first thing that happens. The box labelled `H` is the **Hadamard gate** being applied to qubit 0. Before this box: q_0 is definitely |0⟩. After this box: q_0 is in **superposition** — equal 50% chance of landing on 0 or 1 when measured. It's like the coin starting to spin. Nothing has happened to q_1 yet — its wire is just a straight line at this point.

**`■` (filled dot) on q_0 and `┤ X ├` on q_1 — the CNOT gate**

The filled dot `■` on q_0's wire and the `X` box on q_1's wire are connected by a vertical line. Together they form one single gate called **CNOT** (Controlled-NOT). It spans two qubits at once.

Here's what it does in plain English:
- The filled dot `■` marks the **control qubit** (q_0). It's the one making the decision.
- The `X` box marks the **target qubit** (q_1). It's the one that may or may not get flipped.
- Rule: **if the control is |1⟩, flip the target. If the control is |0⟩, do nothing.**

But wait — q_0 is currently in superposition, not definitively 0 or 1. So the flip happens "in superposition" too. The result: both qubits become **entangled**. They're now linked — you can't describe one without the other. Measuring one instantly determines the other.

**`░` — the barrier**

The dotted vertical line is just a visual separator. It does nothing to the qubits. It's a hint to Qiskit's compiler: "don't rearrange gates across this line." Useful for keeping the diagram readable and preventing unwanted optimisations. You can ignore it for now.

**`┤M├` — measurement**

These boxes at the right end of each qubit's wire are where the quantum state **collapses** to a definite classical value. The M stands for Measure. Up until this point, q_0 and q_1 have been living in quantum superposition. The moment you hit the measurement box, each qubit gives you either a 0 or a 1 — one definite classical result — and all the quantum information is gone.

**`c: 2/══` — the classical register**

The double horizontal line at the bottom is not a qubit. It's a **classical register** — ordinary storage for the measurement results. The `2/` means it holds 2 bits. The reason it's drawn with a double line (instead of a single one like the qubit wires) is just a visual convention: single lines carry quantum information, double lines carry classical bits. The small diagonal lines connecting the M boxes down to this register are where the measurement results get written.

**Putting it together**

So the full story of this circuit in plain English:

1. Both qubits start as |0⟩.
2. H is applied to q_0 — it enters superposition (neither 0 nor 1 yet).
3. CNOT uses q_0 as control and q_1 as target — because q_0 is in superposition, the two qubits become entangled.
4. Both are measured — each collapses to 0 or 1.
5. Results are stored in the classical register.

Because of the entanglement, the only possible outcomes are `00` (both land on 0) or `11` (both land on 1). You'll never see `01` or `10`. That's the Bell state.

One thing to watch: **Qiskit numbers its qubits from 0** starting at the top. When you see a result like `'01'`, the rightmost digit is qubit 0, the leftmost is qubit 1. This reversed ordering trips up almost everyone at first. Keep it in mind.

### Qiskit gate quick-reference

```python
qc.x(0)          # X (NOT) on qubit 0
qc.y(0)          # Y gate
qc.z(0)          # Z gate
qc.h(0)          # Hadamard (superposition)
qc.s(0)          # S gate (phase rotation π/2)
qc.t(0)          # T gate (phase rotation π/4)
qc.cx(0, 1)      # CNOT (control=0, target=1)
qc.cz(0, 1)      # CZ
qc.swap(0, 1)    # SWAP
qc.rx(0.5, 0)    # Rx rotation by 0.5 radians on qubit 0
qc.ry(0.5, 0)    # Ry rotation
qc.rz(0.5, 0)    # Rz rotation
qc.ccx(0, 1, 2)  # Toffoli: controls=0,1, target=2
```

### Running the circuit

```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])

sim = AerSimulator()
job = sim.run(qc, shots=1000)
result = job.result()
counts = result.get_counts()

print(counts)  # Something like: {'00': 507, '11': 493}
```

The `shots` parameter is how many times the circuit runs. Because quantum measurement is probabilistic, you run it many times to build up statistics. With 1000 shots on a Bell state, you'll get roughly half '00' and half '11', never '01' or '10' — the two qubits are entangled so they always agree.

**How many shots do you need?** It depends on what you're measuring:
- **1 shot** — only for deterministic protocols (like Deutsch-Jozsa or Bernstein-Vazirani, where the answer is always certain).
- **100–500 shots** — rough estimates during development. Fast, but noisy.
- **1000–4000 shots** — standard for learning and circuit verification. Good enough to see if probabilities match expectations.
- **8000+ shots** — when you need precise probability estimates, or when the effect you're measuring is small (e.g., a 52% vs 48% split).

On real hardware, more shots means longer run time and more queue usage. On simulators, it's essentially free. During this tutorial, `shots=1000` is the default unless stated otherwise.

### Looking at exact state (no measurement needed)

Sometimes you want to inspect the actual probability amplitudes rather than run the circuit and collect samples. The statevector simulator does this:

```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

# No measurement gates here — statevector captures the state before measurement
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.save_statevector()

sim = AerSimulator(method='statevector')
sv = sim.run(qc).result().get_statevector()
print(sv)
# [0.70710678+0.j, 0.+0.j, 0.+0.j, 0.70710678+0.j]
```

Python represents complex numbers with `j` for the imaginary unit (what mathematicians write as `i`). The `+0.j` means the imaginary component is zero for this circuit — these amplitudes happen to be real numbers. In general, quantum amplitudes are complex, and you will occasionally see results like `0.5+0.5j`. For now, `+0.j` just means "purely real, nothing imaginary."

Those four numbers are the amplitudes for |00⟩, |01⟩, |10⟩, and |11⟩. The values 0.707 and 0.707 appear at positions 0 and 3 (|00⟩ and |11⟩). Square them: 0.707² ≈ 0.5. So 50% probability of |00⟩, 50% of |11⟩, zero for the others. That's the Bell state exactly.

Use the statevector simulator constantly while learning — it lets you verify your circuit does what you think it does without statistical noise.

### Visualising results

```python
from qiskit.visualization import plot_histogram
import matplotlib.pyplot as plt

plot_histogram(counts)
plt.show()
```

---

## 3.6 Building circuits in PennyLane

PennyLane's approach feels quite different. Where Qiskit treats a circuit as a data structure you build and run, PennyLane treats it as a **Python function**. You define a function, decorate it with `@qml.qnode`, and call it directly. The return statement is what determines what you get out.

```python
import pennylane as qml

dev = qml.device("default.qubit", wires=2)

@qml.qnode(dev)
def bell_state():
    qml.Hadamard(wires=0)
    qml.CNOT(wires=[0, 1])
    return qml.probs(wires=[0, 1])

print(bell_state())  # [0.5, 0.0, 0.0, 0.5]
```

PennyLane calls qubit indices "wires." Same idea, different name. The result `[0.5, 0.0, 0.0, 0.5]` gives probabilities for each of the four possible 2-qubit outcomes: |00⟩=0.5, |01⟩=0, |10⟩=0, |11⟩=0.5.

### PennyLane gate reference

```python
qml.PauliX(wires=0)        # X gate
qml.PauliY(wires=0)        # Y gate
qml.PauliZ(wires=0)        # Z gate
qml.Hadamard(wires=0)      # H gate
qml.S(wires=0)             # S gate
qml.T(wires=0)             # T gate
qml.CNOT(wires=[0, 1])     # CNOT (first wire = control)
qml.CZ(wires=[0, 1])       # CZ
qml.SWAP(wires=[0, 1])     # SWAP
qml.RX(0.5, wires=0)       # Rx rotation by 0.5 radians
qml.RY(0.5, wires=0)       # Ry rotation
qml.RZ(0.5, wires=0)       # Rz rotation
qml.Toffoli(wires=[0,1,2]) # CCX / Toffoli
```

### What you get back depends on what you return

This is one of the bigger differences from Qiskit. In PennyLane the return statement isn't an afterthought — it's what determines what the circuit computes.

```python
# Probabilities of each basis state (like running with shots in Qiskit)
return qml.probs(wires=[0, 1])

# Expectation value — the average measurement outcome, as a single number
# Z gives +1 if the qubit is likely |0⟩, -1 if likely |1⟩
return qml.expval(qml.PauliZ(0))

# The full state vector — every amplitude, no measurement
return qml.state()

# Raw samples — individual shot-by-shot outcomes
return qml.sample(qml.PauliZ(0))
```

`qml.expval(qml.PauliZ(0))` is worth understanding because you'll see it constantly in later chapters. It returns a number between -1 and 1. If the qubit is definitely |0⟩, it returns +1. If definitely |1⟩, it returns -1. If in equal superposition, it returns 0. Think of it as a "how much 0 vs 1" dial. Variational algorithms minimise or maximise this value to find the right circuit parameters.

### Printing a circuit diagram in PennyLane

```python
print(qml.draw(bell_state)())
```

---

## 3.7 Circuit depth and width — why they matter on real hardware

Two numbers define how expensive a circuit is to run on real quantum hardware:

**Width** is the number of qubits. More qubits means the quantum state has more dimensions. For simulation on a classical computer, each additional qubit doubles the memory needed — going above 30 qubits on a laptop gets slow fast. On real hardware, more qubits means more things that can go wrong.

**Depth** is the number of time steps — how many layers of gates the circuit has. Every gate on real hardware adds noise. A circuit 500 layers deep on today's hardware is usually useless — the noise accumulates so badly the result is garbage. As a rough guide, current IBM hardware gives meaningful results up to about 50-100 layers for simple circuits, less for complex ones. Keeping circuits shallow is one of the most important practical skills in NISQ-era programming.

When you move to real hardware in Chapter 8, Qiskit's transpiler will automatically try to reduce depth while mapping your circuit to the physical qubits. But it can't work miracles — a circuit that's inherently deep will stay deep.

---

## 3.8 Worked example: the 3-qubit GHZ state

The **GHZ state** (Greenberger, Horne, and Zeilinger) extends the Bell state to three qubits:

```
|GHZ⟩ = (|000⟩ + |111⟩) / √2
```

Three qubits, all linked. Measure any one of them and all three instantly take on the same value. You can't know in advance which — 50% chance it's all-zeros, 50% chance it's all-ones — but whichever it is, all three agree.

Building it is straightforward: Hadamard on qubit 0, then CNOT from 0 to 1, then CNOT from 0 to 2.

**Qiskit:**

```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(3, 3)
qc.h(0)
qc.cx(0, 1)
qc.cx(0, 2)
qc.measure([0, 1, 2], [0, 1, 2])

sim = AerSimulator()
counts = sim.run(qc, shots=2000).result().get_counts()
print(counts)
# {'000': ~1000, '111': ~1000}
# No other outcomes appear. All three qubits are always in sync.
```

**PennyLane:**

```python
import pennylane as qml

dev = qml.device("default.qubit", wires=3)

@qml.qnode(dev)
def ghz():
    qml.Hadamard(wires=0)
    qml.CNOT(wires=[0, 1])
    qml.CNOT(wires=[0, 2])
    return qml.probs(wires=[0, 1, 2])

print(ghz())
# [0.5, 0., 0., 0., 0., 0., 0., 0.5]
# Index 0 = |000⟩, index 7 = |111⟩. Everything else is zero.
```

---

## 3.9 Running the code

The three scripts in `code/chapter-03/` each demonstrate a different part of this chapter. Run them from the chapter's code directory:

```bash
cd code/chapter-03
```

**`gates_demo.py`** — walks through every gate from section 3.3 in Qiskit. It prints the matrix for each gate, applies it to a starting state, shows the output statevector, and finishes with a 1000-shot Bell state measurement. This is the best script to run first — it makes the matrix-times-vector idea concrete.

```bash
python gates_demo.py
```

**`pennylane_circuits.py`** — the same circuits built in PennyLane. Covers the Bell state, GHZ state, a parameterized circuit, and prints circuit diagrams for all of them. Good for seeing side-by-side how PennyLane and Qiskit express the same thing differently.

```bash
python pennylane_circuits.py
```

**`bloch_sphere.py`** — generates a visual plot of six different qubit states on the Bloch sphere (|0⟩, |1⟩, |+⟩, |−⟩, and two rotation states). Saves `bloch_sphere_states.png` in the same directory. Open it after running.

```bash
python bloch_sphere.py
```

If you want to skip the visualization and just check the numbers, `gates_demo.py` and `pennylane_circuits.py` print everything to the terminal.

---

## 3.10 Reusing circuits as building blocks (Qiskit)

As circuits get more complex, you'll want to define sub-circuits and compose them — same idea as writing functions instead of repeating code.

```python
from qiskit import QuantumCircuit

# Define a reusable entangler block
entangler = QuantumCircuit(2, name='entangle')
entangler.h(0)
entangler.cx(0, 1)

# Use it twice in a larger circuit
# qc.compose(..., inplace=True) inlines the sub-circuit's gates directly.
# Prefer compose over qc.append — append with named sub-circuits is not
# supported by the Aer simulator in Qiskit 2.x.
main = QuantumCircuit(4)
main.compose(entangler, qubits=[0, 1], inplace=True)   # Entangle qubits 0 and 1
main.barrier()                                          # Visual separator — no effect on computation
main.compose(entangler, qubits=[2, 3], inplace=True)   # Entangle qubits 2 and 3
main.draw()
```

`barrier()` draws a vertical line in the circuit diagram to visually separate stages. It tells the transpiler "don't rearrange gates across this boundary." Useful for clarity and sometimes for preventing the compiler from making an optimisation you don't want.

---

## Summary

Qubits hold state as two complex numbers (amplitudes). Those numbers represent the probability of measuring 0 or 1, and also carry phase information that controls interference. Gates are matrices that transform those amplitudes. Circuits are sequences of gates that steer the quantum state toward an answer you want.

On the programming side: Qiskit is object-oriented (build a circuit, run it, get results), and PennyLane is functional (define a quantum function, call it, get values). The underlying physics is identical — just two different APIs on top of the same model.

The most important things to take away:
- Measurement is final and destroys the quantum state
- Gates are reversible matrix operations
- Depth is the enemy on real hardware — keep circuits shallow
- Use the statevector simulator liberally while learning

---

**Exercises**

1. Build a circuit that puts qubit 0 in |+⟩ and qubit 1 in |-⟩. Run it with 1000 shots — what do you expect? Does the result match?
2. Apply H twice to a qubit starting in |0⟩. What should happen? Verify with the statevector simulator.
3. Write the 4-qubit GHZ state in both Qiskit and PennyLane. What output do you expect and what do you get?
4. Apply CNOT with the control in |+⟩ and the target in |0⟩. Print the statevector. What does it tell you about the resulting state?
5. Explore circuit depth: create a circuit with 10 H gates in a row. Check the depth using `qc.depth()`. Then transpile it and check the depth again.

---

**Next:** Chapter 4 puts these tools to work on real quantum programs — a genuine random number generator, quantum teleportation, and superdense coding.

---

| | |
|:---|---:|
| [← Chapter 2 — Setting Up Your Environment](./chapter-02-setup.md) | [Chapter 4 — Your First Quantum Programs →](./chapter-04-first-programs.md) |

---

*Chapter 3 of 10 — Quantum Computing for Developers*
