# Chapter 7: Variational Algorithms — VQE and QAOA

**Estimated time:** 60 minutes
**Code directory:** `code/chapter-07/`

---

## What this chapter covers

Variational quantum algorithms are the most practical class of near-term quantum algorithms. They're hybrid — a quantum circuit handles the expensive inner computation, and a classical optimizer adjusts the parameters. This chapter implements two of them in full: VQE (Variational Quantum Eigensolver) for quantum chemistry, and QAOA (Quantum Approximate Optimization Algorithm) for combinatorial optimization. Both run on today's NISQ hardware.

---

## 7.1 Why variational algorithms matter for NISQ

Most of the algorithms in Chapter 5 require fault-tolerant, error-corrected qubits to give their full theoretical speedup. Running Shor's algorithm on real hardware today gives garbage because the circuit is too deep and noise accumulates before you get a useful answer.

Variational algorithms were designed specifically for noisy hardware. The idea: keep the circuit short and shallow (low depth = less noise), and push the complexity into the classical optimization loop.

The tradeoff is that variational algorithms often don't have the clean, provable speedups of algorithms like Grover's. They're heuristic. They might find a good answer, or they might get stuck. But they run on today's hardware, and for problems where even an approximate quantum answer is useful — like molecular ground state energies — they're the right tool.

---

## 7.2 The variational principle

Both VQE and QAOA are based on the same underlying idea from quantum mechanics: the **variational principle**.

For a Hamiltonian H (a matrix describing a physical system), the variational principle says:

```
⟨ψ(θ)|H|ψ(θ)⟩ ≥ E₀
```

The expectation value of H in any quantum state is always greater than or equal to the ground state energy E₀. So if you can prepare a parameterized quantum state |ψ(θ)⟩ and minimize the expectation value by tuning θ, you're finding an approximation to the ground state.

This gives you an optimization problem: minimize `f(θ) = ⟨ψ(θ)|H|ψ(θ)⟩` over parameters θ. The quantum computer evaluates f(θ), and the classical computer adjusts θ using gradient descent or another optimizer.

---

## 7.3 VQE — Variational Quantum Eigensolver

VQE was proposed in 2014 for finding ground state energies of molecules — a problem that's classically intractable for large molecules but has enormous value in drug discovery and materials science.

The process:
1. Choose a molecule and construct its Hamiltonian (as a sum of Pauli operators)
2. Design a parameterized ansatz circuit (a circuit template with tunable parameters)
3. Measure the expectation value of the Hamiltonian using the circuit
4. Classical optimizer minimizes the expectation value by updating circuit parameters
5. Converged parameters give the approximate ground state energy

Here we implement VQE for the hydrogen molecule (H₂) — the simplest non-trivial chemistry problem and a standard benchmark.

```python
import pennylane as qml
import pennylane.numpy as pnp
import numpy as np
from scipy.optimize import minimize

# The H2 Hamiltonian in the STO-3G minimal basis set
# Pre-computed from quantum chemistry — coefficients from the Bravyi-Kitaev mapping
#
# What does "Hamiltonian as Pauli operators" mean?
# A molecule's Hamiltonian is a matrix encoding its energy. For small systems
# that matrix can be exactly decomposed as a weighted sum of Pauli operators
# (I, X, Y, Z and their tensor products). Pauli operators are exactly what
# quantum computers can measure directly. Writing H this way lets us evaluate
# the molecular energy as a sum of measurable quantum observables — one
# circuit evaluation per Pauli term, then sum the results with their coefficients.
# The coefficients below come from the Bravyi-Kitaev mapping, which translates
# fermionic electron interactions into qubit operations.
H = (
    -0.8105479805373266  * qml.Identity(0)
    + 0.17218393261748292 * qml.PauliZ(0)
    - 0.22575349222402372 * qml.PauliZ(1)
    + 0.12091263261776641 * (qml.PauliZ(0) @ qml.PauliZ(1))
    + 0.16892753870087912 * (qml.PauliX(0) @ qml.PauliX(1))
    + 0.16892753870087912 * (qml.PauliY(0) @ qml.PauliY(1))
)

# Compute the exact ground state energy from the Hamiltonian matrix
# This is the classical reference we're trying to match
H_matrix = qml.matrix(H, wire_order=[0, 1])
exact_energy = float(np.linalg.eigvalsh(H_matrix).min())

dev = qml.device("default.qubit", wires=2)

def ansatz(params, wires):
    """
    Hardware-Efficient Ansatz: alternating rotations and entanglers.
    The parameters are the angles of the rotation gates —
    these are what the optimizer adjusts to minimize ⟨H⟩.
    """
    qml.RY(params[0], wires=wires[0])
    qml.RY(params[1], wires=wires[1])
    qml.CNOT(wires=[wires[0], wires[1]])
    qml.RY(params[2], wires=wires[0])
    qml.RY(params[3], wires=wires[1])

@qml.qnode(dev, diff_method="parameter-shift")
def cost_fn(params):
    """Circuit that computes ⟨H⟩ — the energy expectation value."""
    ansatz(params, wires=[0, 1])
    # qml.expval(H) here takes a full multi-term Hamiltonian, not just a single
    # Pauli. PennyLane measures each Pauli term in H separately and sums them
    # weighted by their coefficients — this is the generalisation of the
    # single-observable qml.expval(qml.PauliZ(0)) you've seen before.
    return qml.expval(H)

# scipy passes plain numpy arrays; wrap as pnp so qml.grad can compute gradients
def scipy_cost(params):
    return float(cost_fn(pnp.array(params, requires_grad=False)))

def scipy_jac(params):
    return np.array(qml.grad(cost_fn)(pnp.array(params, requires_grad=True)))

# Random starting point — VQE is sensitive to initialization
np.random.seed(42)
initial_params = np.random.randn(4)

energies = []

def callback(params):
    energies.append(scipy_cost(params))
    if len(energies) % 10 == 0:
        print(f"  Step {len(energies):3d}: Energy = {energies[-1]:.6f} Ha")

print("Running VQE for H2...")
print("-" * 40)

result = minimize(
    scipy_cost,
    initial_params,
    method='BFGS',
    jac=scipy_jac,
    callback=callback,
    options={'maxiter': 200}
)

print("-" * 40)
print(f"VQE ground state energy:  {result.fun:.6f} Ha")
print(f"Exact ground energy:      {exact_energy:.6f} Ha")
print(f"Error: {abs(result.fun - exact_energy):.6f} Ha")
```

A note on the energy: the value depends on the specific Hamiltonian coefficients and basis set used. The `code/chapter-07/vqe_hydrogen.py` script computes the exact ground state numerically from the Hamiltonian matrix itself, so the comparison is always self-consistent. VQE should converge to within chemical accuracy (0.0016 Ha) of the exact value.

### Choosing an ansatz

The ansatz is one of the key design choices in VQE. It needs to:
- Be expressible enough to represent the ground state (or close to it)
- Be shallow enough to run on noisy hardware without too much error
- Have enough parameters to converge

Common ansätze:
- **Hardware-Efficient Ansatz** — designed around hardware connectivity, shallow, practical
- **UCCSD (Unitary Coupled Cluster)** — based on quantum chemistry theory, more accurate but deeper
- **RYRZ** — alternating RY and RZ gates with CNOT entanglers, general purpose

For real chemistry, the `pennylane-qchem` package generates ansätze from molecular structure automatically:

```bash
pip install pennylane-qchem
```

---

## 7.4 QAOA — Quantum Approximate Optimization Algorithm

QAOA tackles combinatorial optimization problems. The classic example is **Max-Cut**: given a graph, partition the nodes into two groups to maximize the number of edges that cross between groups.

Max-Cut is NP-hard in general. QAOA finds good (not necessarily optimal) solutions and can run on current hardware.

### The Max-Cut problem

```
Graph: nodes {0, 1, 2, 3}, edges {(0,1), (1,2), (2,3), (0,3), (0,2)}

Goal: color each node red or blue to maximize edges between different colors
```

### How QAOA works

QAOA alternates between two operators parameterized by angles γ (problem) and β (mixer):

- **Problem unitary** U(C, γ): encodes the cost function as phase rotations
- **Mixer unitary** U(B, β): mixes the quantum state (typically X rotations)

Starting from equal superposition, alternating p layers of these operators produces a state whose measurement is biased toward good solutions. More layers (larger p) gives better approximations.

```python
import pennylane as qml
import numpy as np
from scipy.optimize import minimize
import networkx as nx

# Define the graph
edges = [(0, 1), (1, 2), (2, 3), (0, 3), (0, 2)]
n_nodes = 4
n_qubits = n_nodes

G = nx.Graph()
G.add_edges_from(edges)

dev = qml.device("default.qubit", wires=n_qubits)

def qaoa_layer(gamma, beta):
    """One QAOA layer: problem unitary + mixer unitary."""
    # Problem unitary: phase kickback for each edge
    # The CNOT–RZ–CNOT pattern implements a ZZ interaction on qubits u and v.
    # The first CNOT XORs u into v; RZ rotates by 2γ on v; the second CNOT un-XORs.
    # Net effect: the state picks up phase e^{+2iγ} when u and v are in the same
    # partition (both 0 or both 1) and e^{-2iγ} when they're in different partitions.
    # This is exactly the cost function for an edge in Max-Cut encoded as a phase.
    for u, v in edges:
        qml.CNOT(wires=[u, v])
        qml.RZ(2 * gamma, wires=v)
        qml.CNOT(wires=[u, v])

    # Mixer unitary: X rotations on all qubits
    for wire in range(n_qubits):
        qml.RX(2 * beta, wires=wire)

@qml.qnode(dev)
def qaoa_circuit(params):
    """
    QAOA circuit with p layers.
    params: [gamma_1, beta_1, gamma_2, beta_2, ...]
    """
    p = len(params) // 2
    gammas = params[:p]
    betas = params[p:]

    # Initial state: equal superposition
    for wire in range(n_qubits):
        qml.Hadamard(wires=wire)

    # Apply p QAOA layers
    for i in range(p):
        qaoa_layer(gammas[i], betas[i])

    return qml.probs(wires=range(n_qubits))

def compute_cut_value(bitstring, edges):
    """Count the number of edges cut by a given node partition."""
    cut = 0
    for u, v in edges:
        if bitstring[u] != bitstring[v]:
            cut += 1
    return cut

def cost_fn(params):
    """Negative expected cut value (we minimize, so negate)."""
    probs = qaoa_circuit(params)
    cost = 0
    for i, prob in enumerate(probs):
        bits = format(i, f'0{n_qubits}b')
        cut = compute_cut_value(bits, edges)
        cost -= prob * cut
    return cost

# Run QAOA with p=2 layers
p = 2
np.random.seed(0)
initial_params = np.random.randn(2 * p) * 0.1

print("Running QAOA for Max-Cut...")
result = minimize(cost_fn, initial_params, method='COBYLA',
                  options={'maxiter': 200, 'rhobeg': 0.5})

# Get the probability distribution over solutions
final_probs = qaoa_circuit(result.x)

# Find the best solution
print("\nTop solutions found:")
solutions = []
for i, prob in enumerate(final_probs):
    bits = format(i, f'0{n_qubits}b')
    cut = compute_cut_value(bits, edges)
    solutions.append((bits, cut, prob))

solutions.sort(key=lambda x: (-x[1], -x[2]))
for bits, cut, prob in solutions[:5]:
    print(f"  Partition {bits}: cut={cut} edges, probability={prob:.3f}")

# The maximum possible cut for this graph
all_cuts = [(format(i, f'0{n_qubits}b'), compute_cut_value(format(i, f'0{n_qubits}b'), edges))
            for i in range(2**n_qubits)]
max_cut = max(c for _, c in all_cuts)
print(f"\nMaximum possible cut: {max_cut} edges")
```

### Increasing p for better results

Higher p (more QAOA layers) gives better approximation ratios but requires deeper circuits. The `code/chapter-07/qaoa_maxcut.py` script runs p=1, p=2, and p=3 automatically and prints the expected cut value and approximation ratio for each.

Typical output:

```
p= 1  expected_cut=  3.4211  approx_ratio=  0.8553
p= 2  expected_cut=  3.7892  approx_ratio=  0.9473
p= 3  expected_cut=  3.9341  approx_ratio=  0.9835
```

For most NISQ hardware, p=1 or p=2 is practical. Higher p means more circuit layers means more noise.

---

## 7.5 Barren plateaus — the optimizer's nemesis

One problem that every practitioner runs into is **barren plateaus**. For randomly initialized parameters in high-qubit circuits, the gradient landscape becomes exponentially flat. Gradients shrink exponentially with circuit width, making optimization effectively impossible.

Signs you've hit a barren plateau:
- Cost function barely changes across many optimization steps
- Gradients are very close to zero
- Results are no better than random

Mitigations:
- Layered initialization (initialize layer by layer)
- Correlation-aware initialization
- Smaller circuit depth
- Fewer qubits (the plateau width scales with qubit count)
- Local cost functions instead of global ones

This is an active research problem. For practical work, keep circuits small and start with physically-motivated initial parameters rather than pure random initialization.

---

## 7.6 Running the code

Two scripts live in `code/chapter-07/`. Both run locally on the simulator — no IBM account needed.

```bash
cd code/chapter-07
```

**`vqe_hydrogen.py`** — runs VQE on the H₂ molecule. It tries three random starting points (called "runs") and keeps the best result. For each run you'll see the step count and the energy it converged to:

```
Run 1: converged to -1.453476 Ha (in 47 steps)
Run 2: converged to -1.453476 Ha (in 52 steps)
Run 3: converged to -1.453476 Ha (in 38 steps)
```

After all three runs it prints whether the result is within chemical accuracy (0.0016 Ha) of the exact value. It also saves `vqe_convergence.png` — a graph showing how the energy drops from its random starting value down to the ground state as the optimizer iterates.

```bash
python vqe_hydrogen.py
```

**`qaoa_maxcut.py`** — runs QAOA on the 4-node Max-Cut graph with p=1, p=2, and p=3 layers. For each value of p it prints the expected cut value and the approximation ratio (how close it is to the known optimal cut of 4 edges). Higher p gives a better approximation at the cost of more circuit layers. It saves `qaoa_convergence.png` showing all three convergence curves side by side.

```bash
python qaoa_maxcut.py
```

What to look for: for p=1, expect an approximation ratio around 0.75. For p=2 and p=3, it should improve toward 1.0. The most probable partition printed for each p should match one of the optimal partitions identified by the brute-force classical check.

---

## Summary

Variational algorithms are currently the most practical path to useful quantum computation on NISQ hardware. They accept noisy results from shallow circuits and use classical optimization to work around the noise.

VQE finds ground state energies — a problem classical computers can't solve for large molecules. QAOA finds approximate solutions to NP-hard combinatorial problems. Both use the same structure: parameterized quantum circuit + classical optimizer.

Ansatz design and barren plateaus are the two unsolved problems. Neither has a clean answer yet.

---

**Exercises**

1. Modify the VQE ansatz to use 3 layers instead of 1 and see if the energy converges to a better value.
2. Run QAOA with p=1 and p=3 on the Max-Cut example and compare the approximation ratio.
3. Implement Max-Cut for a larger graph (6 nodes, 8 edges) and report the best solution QAOA finds vs the true optimal cut.
4. Try different classical optimizers for VQE (COBYLA, Nelder-Mead, gradient descent) and compare convergence speed.

---

**Next:** Chapter 8 covers running quantum programs on real IBM hardware — transpilation, noise, error mitigation, and reading results from actual quantum processors.

---

| | |
|:---|---:|
| [← Chapter 6 — PennyLane](./chapter-06-pennylane.md) | [Chapter 8 — Running on Real Hardware →](./chapter-08-real-hardware.md) |

---

*Chapter 7 of 10 — Quantum Computing for Developers*
