# Chapter 5: Core Quantum Algorithms

**Estimated time:** 45 minutes
**Code directory:** `code/chapter-05/`

---

## What this chapter covers

This is where quantum computing stops being conceptual and becomes algorithmically interesting. The algorithms here have proven quantum speedups — not "might be faster someday" but mathematically proven lower bounds that no classical algorithm can beat. You'll implement Deutsch-Jozsa, Bernstein-Vazirani, and Grover's search — three algorithms that illustrate the three core mechanisms of quantum advantage: global function evaluation, interference-based extraction, and amplitude amplification.

---

## 5.1 Oracle-based algorithms

Most fundamental quantum algorithms are **oracle-based**. An oracle is a black-box function implemented as a quantum gate that you're allowed to query but not look inside. The quantum speedup comes from extracting information about the oracle using fewer queries than any classical algorithm could.

You have a function `f(x)` and you want to learn something about it. Classically, you have to call `f` for each input you want to test. Quantum algorithms can call the quantum oracle once and extract global information by exploiting superposition and interference.

Oracles are implemented as quantum circuits where the function's behavior is encoded in phase kickbacks or qubit flips. You'll see this pattern repeatedly.

---

## 5.2 Deutsch-Jozsa Algorithm

### The problem

You're given a black-box boolean function `f: {0,1}^n → {0,1}`. You're promised it's either:
- **Constant**: returns the same value for all inputs (always 0 or always 1)
- **Balanced**: returns 0 for exactly half the inputs and 1 for the other half

Classically, in the worst case, you need to call `f` at least 2^(n-1) + 1 times to be certain. For n=1000, that's an astronomical number of calls.

Deutsch-Jozsa does it in **one quantum query**.

This isn't a useful real-world problem — it's a pedagogical algorithm designed specifically to show that quantum computers can answer global questions about a function exponentially faster than classical computers.

### How it works

1. Initialize n qubits to |0⟩ and one ancilla qubit to |1⟩
2. Apply H to all qubits (put everything in superposition)
3. Apply the oracle (encodes function behavior as phase)
4. Apply H to the input qubits again (interference step)
5. Measure the input qubits

If the function is **constant**: all input qubits measure as 0
If the function is **balanced**: at least one input qubit measures as 1

The interference in step 4 is what makes this work. Constant functions produce constructive interference back to |0⟩. Balanced functions produce destructive interference there and constructive interference elsewhere.

```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

def constant_oracle(n):
    """Oracle for a constant function (always returns 0)."""
    # A constant-0 oracle applies no gates — and that's correct by design.
    # A function that always returns 0 never changes the ancilla qubit,
    # so the oracle literally does nothing. An empty circuit IS the oracle.
    oracle = QuantumCircuit(n + 1, name='constant_0')
    return oracle

def balanced_oracle(n):
    """Oracle for a balanced function using CNOT gates."""
    oracle = QuantumCircuit(n + 1, name='balanced')
    # CNOT from each input qubit to ancilla creates a balanced function
    for i in range(n):
        oracle.cx(i, n)
    return oracle

def deutsch_jozsa(oracle, n):
    """
    Run the Deutsch-Jozsa algorithm.
    Returns 'constant' or 'balanced'.
    """
    qc = QuantumCircuit(n + 1, n)

    # Step 1: Initialize ancilla to |1⟩
    qc.x(n)

    # Step 2: Hadamard on all qubits
    qc.h(range(n + 1))
    qc.barrier()

    # Step 3: Apply oracle — compose inlines the gates directly
    # (qc.append with named sub-circuits is not supported by Aer in Qiskit 2.x)
    qc.compose(oracle, qubits=range(n + 1), inplace=True)
    qc.barrier()

    # Step 4: Hadamard on input qubits (NOT the ancilla)
    qc.h(range(n))
    qc.barrier()

    # Step 5: Measure input qubits
    qc.measure(range(n), range(n))

    sim = AerSimulator()
    counts = sim.run(qc, shots=1).result().get_counts()
    result_bits = list(counts.keys())[0]

    # All zeros = constant, any ones = balanced
    return 'constant' if result_bits == '0' * n else 'balanced'

n = 4  # 4 input bits

# Test with constant oracle
result = deutsch_jozsa(constant_oracle(n), n)
print(f"Constant oracle: {result}")   # constant

# Test with balanced oracle
result = deutsch_jozsa(balanced_oracle(n), n)
print(f"Balanced oracle: {result}")   # balanced
```

Note the `shots=1` — we only need to run it once. That's the whole point. Classically, with n=4, you'd need up to 9 calls. Quantum: 1 call.

---

## 5.3 Bernstein-Vazirani Algorithm

### The problem

You're given a black-box function `f(x) = s·x mod 2`, where `s` is a hidden n-bit string and `·` is the bitwise dot product. Find `s`.

Classically, you need n queries — you test each bit position separately with input vectors like 1000..., 0100..., 0010...

Bernstein-Vazirani finds `s` in **one query**.

### How it works

The algorithm is almost identical to Deutsch-Jozsa, but the oracle encodes the hidden string differently. After the interference step, measuring the input qubits directly gives you `s`.

```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

def bv_oracle(hidden_string):
    """
    Create a Bernstein-Vazirani oracle for a hidden bitstring.
    hidden_string: e.g., '10110'
    """
    n = len(hidden_string)
    oracle = QuantumCircuit(n + 1, name=f'BV_{hidden_string}')

    for i, bit in enumerate(reversed(hidden_string)):
        if bit == '1':
            oracle.cx(i, n)

    return oracle

def bernstein_vazirani(hidden_string):
    """Find the hidden string in one quantum query."""
    n = len(hidden_string)
    oracle = bv_oracle(hidden_string)

    qc = QuantumCircuit(n + 1, n)
    qc.x(n)                    # Ancilla to |1⟩
    qc.h(range(n + 1))         # All in superposition
    qc.barrier()
    qc.compose(oracle, qubits=range(n + 1), inplace=True)
    qc.barrier()
    qc.h(range(n))             # Interference
    qc.measure(range(n), range(n))

    sim = AerSimulator()
    counts = sim.run(qc, shots=1).result().get_counts()
    measured = list(counts.keys())[0]
    # The oracle uses reversed(hidden_string) to align with Qiskit's
    # little-endian qubit ordering, so the result is already in the right order.
    return measured

secret = '10110'
found = bernstein_vazirani(secret)
print(f"Hidden string: {secret}")
print(f"Found:         {found}")
print(f"Correct: {secret == found}")
```

This works for any length string. Finding a 1000-bit hidden string takes one query. Classically: 1000 queries. One of the cleanest demonstrations of quantum advantage.

---

## 5.4 Grover's Search Algorithm

### The problem

Search an unstructured list of N items for the one that satisfies some condition. Classically, on average you check N/2 items before finding it — O(N) time.

Grover's Algorithm finds it in O(√N) queries. For N = 1 million, that's 1000 queries instead of 500,000. Not exponential speedup (like Deutsch-Jozsa), but a quadratic one that's proven to be optimal for unstructured search.

### How it works

The key mechanism is **amplitude amplification**. Start with all states in equal superposition (each has amplitude 1/√N). The algorithm iterates:

1. **Oracle flip**: flip the sign (phase) of the target state's amplitude
2. **Diffusion**: reflect all amplitudes around their average

After each iteration, the target state's amplitude grows while all others shrink. After approximately π/4 · √N iterations, the target state has amplitude close to 1 — measuring it gives the right answer with high probability.

To see why π/4 · √N: think of the quantum state as a point on a 2D circle. Initially it sits at a small angle θ₀ ≈ 1/√N from the "all wrong answers" plane, because the target starts with amplitude 1/√N out of N equal states. Each Grover iteration rotates this point by exactly 2·arcsin(1/√N) ≈ 2/√N radians toward the target. After k iterations the angle is (2k+1)/√N. You want to stop when that angle reaches π/2 (pointing straight at the target), which happens at k ≈ π/4 · √N. That's the geometric origin of the formula — it's not a heuristic, it's exact geometry.

```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

def grover_oracle(n_qubits, target):
    """
    Mark the target state by flipping its phase.
    target: integer representing the item to find
    """
    oracle = QuantumCircuit(n_qubits, name='oracle')
    target_bits = format(target, f'0{n_qubits}b')

    # Flip qubits where target has a 0 (so all become 1 for target)
    for i, bit in enumerate(reversed(target_bits)):
        if bit == '0':
            oracle.x(i)

    # Multi-controlled Z: flips phase only when all qubits are |1⟩
    oracle.h(n_qubits - 1)
    oracle.mcx(list(range(n_qubits - 1)), n_qubits - 1)
    oracle.h(n_qubits - 1)

    # Undo the bit flips
    for i, bit in enumerate(reversed(target_bits)):
        if bit == '0':
            oracle.x(i)

    return oracle

def grover_diffusion(n_qubits):
    """
    Grover diffusion operator: reflects amplitudes around the mean.
    """
    diffusion = QuantumCircuit(n_qubits, name='diffusion')

    diffusion.h(range(n_qubits))
    diffusion.x(range(n_qubits))
    diffusion.h(n_qubits - 1)
    diffusion.mcx(list(range(n_qubits - 1)), n_qubits - 1)
    diffusion.h(n_qubits - 1)
    diffusion.x(range(n_qubits))
    diffusion.h(range(n_qubits))

    return diffusion

def grovers_search(n_qubits, target):
    """
    Run Grover's search for target in a space of 2^n_qubits items.
    Returns measurement results as a count dictionary.
    """
    N = 2 ** n_qubits
    # Use int (floor), not round — for N=4, round gives 2 but the true optimum is 1
    n_iterations = max(1, int(np.pi / 4 * np.sqrt(N)))

    print(f"Searching {N} items for target={target}")
    print(f"Running {n_iterations} Grover iteration(s)")

    oracle = grover_oracle(n_qubits, target)
    diffusion = grover_diffusion(n_qubits)

    qc = QuantumCircuit(n_qubits, n_qubits)
    qc.h(range(n_qubits))     # Equal superposition over all states

    for _ in range(n_iterations):
        qc.compose(oracle, qubits=range(n_qubits), inplace=True)
        qc.compose(diffusion, qubits=range(n_qubits), inplace=True)

    qc.measure(range(n_qubits), range(n_qubits))

    sim = AerSimulator()
    counts = sim.run(qc, shots=1000).result().get_counts()
    return counts

# Search for item 6 in a list of 16 (4 qubits)
counts = grovers_search(n_qubits=4, target=6)

# Sort by count to see the most likely result
sorted_counts = sorted(counts.items(), key=lambda x: x[1], reverse=True)
for bitstring, count in sorted_counts[:5]:
    print(f"  {bitstring} ({int(bitstring, 2)}): {count} times")
```

Expected output: `0110 (=6)` should appear with much higher frequency than all other states. With 4 qubits (16 items), one Grover iteration gives ~78% success probability. More iterations improve this.

### Why not run it forever to get 100%?

Over-iterating is a real problem. If you run too many iterations, the amplitude oscillates — it grows past the target, then shrinks again. The optimal is π/4 · √N iterations. This is one of the weird behaviors that makes quantum algorithms feel fragile compared to classical ones.

---

## 5.5 Grover's in PennyLane

PennyLane has a built-in Grover's operator which simplifies the implementation:

```python
import pennylane as qml
import numpy as np

n_qubits = 4
target = 6
target_bits = format(target, f'0{n_qubits}b')

dev = qml.device("default.qubit", wires=n_qubits)

def oracle():
    """Mark the target state."""
    # Flip qubits where target has 0
    for i, bit in enumerate(target_bits):
        if bit == '0':
            qml.PauliX(wires=i)
    # Multi-controlled Z
    qml.ctrl(qml.PauliZ, control=list(range(n_qubits - 1)))(wires=n_qubits - 1)
    # Undo flips
    for i, bit in enumerate(target_bits):
        if bit == '0':
            qml.PauliX(wires=i)

@qml.qnode(dev)
def grover_circuit():
    # Initial superposition
    for wire in range(n_qubits):
        qml.Hadamard(wires=wire)

    # Grover iterations
    n_iter = round(np.pi / 4 * np.sqrt(2 ** n_qubits))
    for _ in range(n_iter):
        oracle()
        qml.GroverOperator(wires=range(n_qubits))  # Built-in diffusion

    return qml.probs(wires=range(n_qubits))

probs = grover_circuit()
found = np.argmax(probs)
print(f"Most likely state: {found} (target was {target})")
print(f"Success probability: {probs[target]:.3f}")
```

---

## 5.6 Running the code

Three scripts live in `code/chapter-05/`. All run locally on the Aer simulator — no IBM account needed. Each one runs all test cases automatically and prints PASS/FAIL for each.

```bash
cd code/chapter-05
```

**`deutsch_jozsa.py`** — tests four oracle types (constant-0, constant-1, balanced parity, balanced random) across four input sizes (n=1, 2, 4, 8). Every case should print `[PASS]`. Then prints the circuit diagram for n=3 so you can see the full structure. Notice that even for n=8 (256 possible inputs), the algorithm uses exactly one query.

```bash
python deutsch_jozsa.py
```

**`bernstein_vazirani.py`** — tests eight hidden strings from length 1 to 16 bits. Quantum recovers each hidden string in one query. Classical would need n queries (n = length of string). All eight should print `[PASS]`. The 16-bit case is the most striking: quantum uses 1 query, classical would need 16.

```bash
python bernstein_vazirani.py
```

**`grovers_search.py`** — runs Grover's search on four problem sizes (N=4, 8, 16, 32) and then demonstrates the amplitude oscillation problem for N=16. Watch the P(success) values: for N=4 with 1 optimal iteration, P=1.000. For N=32 with 4 iterations, P≈0.998. Then the oscillation demo shows what happens when you run too many iterations — the probability rises, peaks, then falls again.

```bash
python grovers_search.py
```

The oscillation output at the end of `grovers_search.py` is particularly worth studying. It makes the "don't over-iterate" rule concrete — you can see P(success) go from 0.96 at iteration 3, down to 0.13 at iteration 6, back up to 0.99 at iteration 9.

**`pennylane_grover.py`** — the PennyLane version from section 5.5 with `qml.GroverOperator`. Runs the same search problem at several sizes, then shows the amplitude oscillation side by side with a bar chart printed in text. A good comparison against the Qiskit implementation to see how the same algorithm looks in a different framework.

```bash
python pennylane_grover.py
```

---

## Summary

Three algorithms, three mechanisms:

**Deutsch-Jozsa** — global property of a function extracted in one query by having the interference of all inputs cancel or reinforce based on the function type.

**Bernstein-Vazirani** — hidden string encoded in the phase structure of a function, extracted in one query by letting the phases interfere into a direct measurement of the answer.

**Grover's search** — amplitude amplification. The target state is boosted iteratively until it dominates the probability distribution. Quadratic speedup for any unstructured search.

These algorithms work on simulators because they're short circuits. On real hardware, noise limits the number of Grover iterations you can run meaningfully — on current NISQ devices, a few iterations is typically the practical limit.

---

**Exercises**

1. Run Grover's search for a 3-qubit space (8 items) and plot the success probability vs number of iterations from 1 to 6. Watch it oscillate.
2. Implement a version of Bernstein-Vazirani that tests a random 8-bit hidden string and verifies the result.
3. Modify the Deutsch-Jozsa oracle to implement a different balanced function (not just parity) and confirm the algorithm still identifies it correctly.
4. For Grover's with n=6 (64 items), how many iterations give the highest success probability? Verify with simulation.

---

**Next:** Chapter 6 introduces PennyLane in depth — its differentiation model, how it differs from Qiskit philosophically, and why it's the go-to choice for variational quantum algorithms and quantum machine learning.

---

| | |
|:---|---:|
| [← Chapter 4 — Your First Quantum Programs](./chapter-04-first-programs.md) | [Chapter 6 — PennyLane →](./chapter-06-pennylane.md) |

---

*Chapter 5 of 10 — Quantum Computing for Developers*
