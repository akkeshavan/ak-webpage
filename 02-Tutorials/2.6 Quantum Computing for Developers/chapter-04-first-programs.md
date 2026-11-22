# Chapter 4: Your First Real Quantum Programs

**Estimated time:** 45 minutes
**Code directory:** `code/chapter-04/`

---

## What this chapter covers

Time to build something. This chapter walks through four complete programs, each one demonstrating a genuinely quantum behavior that has no classical equivalent. You'll implement a quantum random number generator, explore Bell states in detail, build quantum teleportation, and work through superdense coding. Each program is explained circuit step by step.

---

## 4.1 Quantum Random Number Generator

Classical computers generate "random" numbers using pseudorandom algorithms — they look random but are deterministic given the same seed. Quantum measurement is genuinely random in a fundamental sense. No amount of knowledge about the initial state lets you predict the outcome.

The simplest possible quantum program:

```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

def quantum_random_bit():
    """Returns a single truly random bit using quantum superposition."""
    qc = QuantumCircuit(1, 1)
    qc.h(0)        # Superposition: equal probability of 0 and 1
    qc.measure(0, 0)

    sim = AerSimulator()
    result = sim.run(qc, shots=1).result()
    # get_counts() returns a dict like {'0': 1} or {'1': 1} —
    # keys are measurement bitstrings, values are how many times each appeared.
    # With shots=1 there is exactly one key. We take it and convert to int.
    return int(list(result.get_counts().keys())[0])

# Generate 20 random bits
bits = [quantum_random_bit() for _ in range(20)]
print(bits)
```

This is trivial but illustrates the point. Each bit is independently and genuinely random.

For a useful random number in a range:

```python
import math
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

def quantum_random_int(min_val, max_val):
    """Generate a random integer between min_val and max_val (inclusive)."""
    n_bits = math.ceil(math.log2(max_val - min_val + 1))

    qc = QuantumCircuit(n_bits, n_bits)
    qc.h(range(n_bits))   # Superposition on all qubits
    qc.measure(range(n_bits), range(n_bits))

    sim = AerSimulator()
    result = sim.run(qc, shots=1).result()
    bitstring = list(result.get_counts().keys())[0]
    value = int(bitstring, 2) % (max_val - min_val + 1) + min_val
    return value

# Roll a quantum die
print(quantum_random_int(1, 6))
```

---

## 4.2 Bell States — Entanglement in Detail

There are four Bell states, each representing maximally entangled pairs of qubits. They come up everywhere in quantum computing.

```
|Φ+⟩ = (|00⟩ + |11⟩) / √2   <- Most common, the "standard" Bell state
|Φ-⟩ = (|00⟩ - |11⟩) / √2
|Ψ+⟩ = (|01⟩ + |10⟩) / √2
|Ψ-⟩ = (|01⟩ - |10⟩) / √2
```

The difference between them is a phase and which values are correlated. Here's how to prepare all four:

```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

def bell_state(state='phi_plus'):
    """
    Prepare one of the four Bell states.
    state: 'phi_plus', 'phi_minus', 'psi_plus', 'psi_minus'
    """
    qc = QuantumCircuit(2, 2)

    # All Bell states start with H on qubit 0 and CNOT
    qc.h(0)
    qc.cx(0, 1)

    # Differentiate with X and Z gates
    if state == 'phi_minus':
        qc.z(0)
    elif state == 'psi_plus':
        qc.x(0)
    elif state == 'psi_minus':
        qc.x(0)
        qc.z(0)

    qc.measure([0, 1], [0, 1])
    return qc

sim = AerSimulator()

for name in ['phi_plus', 'phi_minus', 'psi_plus', 'psi_minus']:
    qc = bell_state(name)
    counts = sim.run(qc, shots=1000).result().get_counts()
    print(f"|{name}⟩: {counts}")
```

What you'll see:
- `phi_plus`: measurements are always 00 or 11 (correlated)
- `phi_minus`: same correlation, different phase (only visible with interference experiments)
- `psi_plus`: measurements are always 01 or 10 (anti-correlated)
- `psi_minus`: anti-correlated with phase difference

The correlation is the remarkable part. Measure the first qubit and instantly you know the second — not because you shared information, but because their states are entangled.

---

## 4.3 Quantum Teleportation

Quantum teleportation is one of the most mind-bending protocols in quantum computing. It transmits an unknown quantum state from one qubit to another using only an entangled pair and classical communication — two classical bits.

Important: this does NOT transmit information faster than light. The classical bits still travel at light speed or below. What's remarkable is that it works at all — you can transfer a qubit's state without ever measuring what that state is.

### The protocol

Three participants: Alice has a qubit in unknown state |ψ⟩ she wants to send. Alice and Bob each hold one qubit of an entangled Bell pair.

1. Alice entangles her message qubit with her half of the Bell pair using CNOT and H gates
2. Alice measures both her qubits (2 bits of classical information)
3. Alice sends those 2 bits to Bob over any classical channel
4. Bob applies corrections to his qubit based on what he received
5. Bob's qubit is now in state |ψ⟩

**Why do the corrections work?** When Alice makes her joint measurement on steps 2–3, the three-qubit entangled system collapses into one of four possible branches depending on her 2-bit result. In each branch, Bob's qubit ends up as a specific rotated version of the original state |ψ⟩. The corrections exactly undo that rotation:

| Alice measures | What happened to Bob's qubit | Bob applies |
|---|---|---|
| 00 | Nothing — already |ψ⟩ | Nothing |
| 01 | Got flipped (X applied) | X to un-flip it |
| 10 | Got phase-flipped (Z applied) | Z to un-flip it |
| 11 | Got both flips | X then Z |

Alice's 2 classical bits tell Bob exactly which branch the collapse fell into, so he knows exactly which correction to apply. The quantum state was never directly transmitted — it was reconstructed on Bob's side using the shared entanglement plus classical information.

```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
import numpy as np

def teleportation_circuit(theta=np.pi/3, phi=np.pi/4):
    """
    Teleport a qubit state defined by angles theta and phi.

    Qubit layout:
      q0: Alice's message qubit (state to teleport)
      q1: Alice's half of the Bell pair
      q2: Bob's half of the Bell pair

    Classical bits:
      c0, c1: Alice's measurement results
      c2: Verification measurement on Bob's qubit
    """
    qc = QuantumCircuit(3, 3)

    # --- Step 1: Prepare the state to teleport on qubit 0 ---
    # Using Ry and Rz to set an arbitrary state
    qc.ry(theta, 0)
    qc.rz(phi, 0)
    qc.barrier()

    # --- Step 2: Create Bell pair between Alice (q1) and Bob (q2) ---
    qc.h(1)
    qc.cx(1, 2)
    qc.barrier()

    # --- Step 3: Alice entangles her message qubit with her Bell qubit ---
    qc.cx(0, 1)
    qc.h(0)
    qc.barrier()

    # --- Step 4: Alice measures both her qubits ---
    qc.measure(0, 0)
    qc.measure(1, 1)
    qc.barrier()

    # --- Step 5: Bob applies corrections based on Alice's measurements ---
    # if_test is Qiskit 2.x's context manager for classical feed-forward.
    # It reads a classical bit and conditionally applies a gate.
    # If Alice's q1 measurement was 1, Bob applies X
    with qc.if_test((qc.clbits[1], 1)):
        qc.x(2)
    # If Alice's q0 measurement was 1, Bob applies Z
    with qc.if_test((qc.clbits[0], 1)):
        qc.z(2)

    # --- Step 6: Measure Bob's qubit to verify ---
    qc.measure(2, 2)

    return qc

# The circuit shows the structure clearly
qc = teleportation_circuit()
print(qc.draw())
```

To verify teleportation worked, you'd compare the final state of Bob's qubit to the original state of Alice's. Full verification code is in `code/chapter-04/teleportation.py`.

The teleportation protocol is also the foundation of quantum error correction and quantum networking. Worth understanding well.

---

## 4.4 Superdense Coding

Superdense coding is the reverse of teleportation. Instead of sending one qubit's state using 2 classical bits, you send **2 classical bits using 1 qubit** — as long as Alice and Bob share an entangled pair in advance.

This is genuinely impressive: a single qubit transmission carries 2 bits of classical information, which beats the classical limit of 1 bit per bit.

### The protocol

Alice wants to send one of four 2-bit messages: 00, 01, 10, or 11.

Alice and Bob share a Bell pair. Alice applies a local operation to her qubit based on the message she wants to send, then sends only her one qubit to Bob. Bob performs a joint measurement on both qubits and reads out the 2-bit message.

```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

def superdense_coding(message='10'):
    """
    Encode and decode a 2-bit message using superdense coding.
    message: '00', '01', '10', or '11'
    """
    assert message in ('00', '01', '10', '11'), "Message must be 2 bits"

    qc = QuantumCircuit(2, 2)

    # --- Setup: Create Bell pair ---
    # In practice, this is done in advance and the qubits distributed
    qc.h(0)
    qc.cx(0, 1)
    qc.barrier()

    # --- Alice's encoding ---
    # Alice only touches qubit 0 (her qubit)
    if message[1] == '1':
        qc.x(0)    # Flips: encodes the second bit
    if message[0] == '1':
        qc.z(0)    # Phase: encodes the first bit
    qc.barrier()

    # --- Bob's decoding ---
    # Bob applies the inverse Bell circuit to his two qubits
    qc.cx(0, 1)
    qc.h(0)
    qc.barrier()

    # Bob measures — he reads out Alice's original 2-bit message
    qc.measure([0, 1], [0, 1])

    return qc

sim = AerSimulator()

for msg in ['00', '01', '10', '11']:
    qc = superdense_coding(msg)
    counts = sim.run(qc, shots=100).result().get_counts()
    print(f"Sent: {msg} → Received: {list(counts.keys())[0]}")
```

Expected output:
```
Sent: 00 → Received: 00
Sent: 01 → Received: 01
Sent: 10 → Received: 10
Sent: 11 → Received: 11
```

The encoding is deterministic here (we know the message), so each run gives the same result. The quantum part is that Alice only needs to send one qubit to convey two bits of information.

---

## 4.5 PennyLane note on teleportation

PennyLane supports mid-circuit measurement and classical feed-forward via `qml.measure()` and `qml.cond()` (added in PennyLane 0.38+). The pattern looks like this:

```python
import pennylane as qml
import numpy as np

dev = qml.device("default.qubit", wires=3)

@qml.qnode(dev)
def teleport_and_verify(theta, phi):
    """
    Teleportation using PennyLane's dynamic circuit support.
    wires: 0=Alice's message, 1=Alice's Bell qubit, 2=Bob's Bell qubit
    """
    # Prepare the state to teleport on wire 0
    qml.RY(theta, wires=0)
    qml.RZ(phi, wires=0)

    # Create Bell pair between wires 1 and 2
    qml.Hadamard(wires=1)
    qml.CNOT(wires=[1, 2])

    # Alice's Bell measurement
    qml.CNOT(wires=[0, 1])
    qml.Hadamard(wires=0)

    # Measure Alice's qubits into classical bits
    m0 = qml.measure(0)
    m1 = qml.measure(1)

    # Bob applies corrections based on classical measurement results
    qml.cond(m1, qml.PauliX)(wires=2)
    qml.cond(m0, qml.PauliZ)(wires=2)

    # Return probabilities on Bob's qubit
    return qml.probs(wires=2)

probs = teleport_and_verify(np.pi / 3, np.pi / 4)
print(f"P(Bob measures 0): {probs[0]:.4f}")
print(f"P(Bob measures 1): {probs[1]:.4f}")
```

The key PennyLane primitives are `qml.measure()` (mid-circuit measurement that returns a classical value) and `qml.cond()` (applies a gate only if the classical value is True). This is PennyLane's equivalent of Qiskit's `if_test`.

---

## 4.6 Running the code

Three fully working scripts live in `code/chapter-04/`. Each one runs standalone on the local Aer simulator — no IBM account needed.

```bash
cd code/chapter-04
```

**`qrng.py`** — the quantum random number generator. Generates single bits, integers in a range, floats, a statistical bias test, and random bytes. Demonstrates that quantum measurement is fundamentally random, not pseudorandom like Python's `random` module.

```bash
python qrng.py
```

**`bell_states.py`** — builds and measures all four Bell states. For each one it prints the exact statevector (showing the amplitudes as complex numbers), runs 2000 shots to collect statistics, and verifies that only the expected correlated outcomes appear. A good reference for the Bell state structure.

```bash
python bell_states.py
```

**`teleportation.py`** — the full teleportation protocol. Runs five test cases: teleporting |0⟩, |1⟩, |+⟩, |−⟩, and an arbitrary state. For each case it compares Alice's original state probabilities with Bob's measured probabilities and prints PASS/FAIL. Also prints the full circuit diagram at the end so you can see all the gates.

```bash
python teleportation.py
```

What to look for when running `teleportation.py`: all five cases should print `[PASS]`. The probability difference between Alice's target and Bob's result should be less than 0.05 (statistical tolerance over 2000 shots).

**`superdense_coding.py`** — the complete superdense coding protocol from section 4.4. Sends all four possible 2-bit messages (00, 01, 10, 11) and verifies each is correctly received. All four should print `[PASS]`. Also prints the circuit diagram for one message so you can see the encoding and decoding gates.

```bash
python superdense_coding.py
```

---

## 4.7 Common mistakes at this stage

A few things that trip people up:

**Bit ordering.** Qiskit uses little-endian bit ordering for measurement results. In a 3-qubit circuit, `q0` is the rightmost bit in the result string `'q2q1q0'`. So a result of `'001'` means q0=1, q1=0, q2=0. This is counterintuitive and causes a lot of confusion. PennyLane uses the opposite (big-endian) convention by default.

**Running without measurement.** If you run a circuit with no measurement gates in Qiskit using the standard sampler, you'll get an error or empty results. Either add `measure` gates or use the statevector simulator.

**shots=1 for teleportation verification.** With one shot you'll get one outcome. To verify a probabilistic protocol, run many shots and check the distribution.

**Expecting exact 50/50 splits.** With 1000 shots, you'll see something like 503/497. That's correct. Quantum computers are probabilistic. You need enough shots that statistical noise is smaller than the effect you're measuring.

---

## Summary

Four programs, each demonstrating something classically impossible:
- True randomness from quantum measurement
- Maximal entanglement between two qubits (Bell states)
- Transmitting a quantum state using only 2 classical bits (teleportation)
- Transmitting 2 classical bits using only 1 qubit (superdense coding)

These protocols are not just curiosities. Teleportation is the basis of quantum error correction and quantum networking. Superdense coding is the basis of certain quantum communication advantages. Bell states appear in virtually every interesting quantum algorithm.

---

**Exercises**

1. Modify the QRNG to generate a random floating-point number between 0 and 1 using 16 bits of quantum randomness.
2. Implement the four Bell states in PennyLane and verify the correct probability distributions.
3. Add statevector logging to the teleportation circuit to print Alice's original state and Bob's final state, and verify they match.
4. What happens to superdense coding if you skip the entanglement step at the start? Test it and explain the result.

---

**Next:** Chapter 5 covers real quantum algorithms with proven speedup — Deutsch-Jozsa, Bernstein-Vazirani, and Grover's search. These are where the conceptual power of quantum computing becomes concrete.

---

| | |
|:---|---:|
| [← Chapter 3 — Qubits, Gates, and Circuits](./chapter-03-qubits-gates-circuits.md) | [Chapter 5 — Core Quantum Algorithms →](./chapter-05-quantum-algorithms.md) |

---

*Chapter 4 of 10 — Quantum Computing for Developers*
