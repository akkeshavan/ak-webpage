# Chapter 6: PennyLane — Differentiable Quantum Computing

**Estimated time:** 40 minutes
**Code directory:** `code/chapter-06/`

---

## What this chapter covers

PennyLane takes a fundamentally different approach from Qiskit. Where Qiskit thinks about circuits as programs to be compiled and run, PennyLane thinks about circuits as differentiable functions. This makes it the natural choice for variational algorithms and quantum machine learning — anywhere you need to optimize circuit parameters using gradient descent.

This chapter covers PennyLane's core model, its device system, how differentiation works, and how to connect it to Qiskit's backends when you need real hardware.

---

## 6.1 The key philosophical difference

Qiskit's workflow is: **build a circuit → transpile → run → get counts**.

PennyLane's workflow is: **define a quantum function → call it like Python → get values you can differentiate**.

In Qiskit, a circuit is a data structure. You build it, hand it to a runner, and get results back. In PennyLane, a quantum circuit is literally a Python function. You call it with arguments, it returns numerical values, and those values are differentiable with respect to the arguments.

For optimization this matters a lot. If you have a circuit that computes some cost function, PennyLane can compute the gradient of that cost with respect to every gate parameter — exactly, using a technique called the parameter-shift rule — and hand those gradients to a classical optimizer. That's the foundation of every variational quantum algorithm.

---

## 6.2 QNodes — the core abstraction

A **QNode** is a quantum function bound to a device. You create one with the `@qml.qnode` decorator:

```python
import pennylane as qml
import numpy as np

dev = qml.device("default.qubit", wires=2)

# PennyLane uses "wires" where Qiskit uses "qubits" — they mean the same thing.
# wires=0 is qubit 0, wires=[0, 1] is a two-qubit gate on qubits 0 and 1.

@qml.qnode(dev)
def my_circuit(theta, phi):
    qml.RX(theta, wires=0)
    qml.RY(phi, wires=1)
    qml.CNOT(wires=[0, 1])
    return qml.expval(qml.PauliZ(0))

# Call it exactly like a Python function
result = my_circuit(0.5, 1.2)
print(result)   # A single float: the expectation value of Z on qubit 0
```

The circuit takes `theta` and `phi` as arguments. These are the gate parameters. The function returns a scalar value — the expectation value of the Pauli Z measurement on qubit 0.

Now the interesting part:

```python
# Compute the gradient with respect to theta and phi
grad_fn = qml.grad(my_circuit)
dtheta, dphi = grad_fn(0.5, 1.2)
print(f"d/dtheta = {dtheta:.4f}")
print(f"d/dphi   = {dphi:.4f}")
```

That's it. `qml.grad` wraps the circuit and returns a function that computes exact gradients. You can use these gradients in any classical optimizer.

---

## 6.3 Devices in PennyLane

The device is what executes your circuit. You pick one when creating the QNode.

```python
# Local exact simulator (most common for development)
dev = qml.device("default.qubit", wires=4)

# High-performance C++ simulator (faster for larger circuits)
dev = qml.device("lightning.qubit", wires=20)

# Noisy simulation using density matrices
dev = qml.device("default.mixed", wires=4)

# Clifford simulator (only stabilizer circuits, but extremely fast)
dev = qml.device("default.clifford", wires=50)
```

Switching devices requires only changing one line. Your circuit code stays identical.

### Connecting to IBM hardware through PennyLane

This requires your IBM token and the `pennylane-qiskit` plugin:

```python
import os
from qiskit_ibm_runtime import QiskitRuntimeService

# Load your IBM credentials
service = QiskitRuntimeService(channel="ibm_quantum_platform")

# Use PennyLane with an IBM backend
dev = qml.device(
    "qiskit.ibmq",
    wires=5,
    backend="ibm_brisbane",  # Replace with an available backend name
    provider=service
)

@qml.qnode(dev)
def circuit():
    qml.Hadamard(wires=0)
    qml.CNOT(wires=[0, 1])
    return qml.probs(wires=[0, 1])

# This now runs on real IBM hardware
result = circuit()
print(result)
```

The circuit code is identical to the simulator version. The device change is the only difference. This portability is one of PennyLane's strongest features.

---

## 6.4 Differentiation methods

PennyLane supports multiple differentiation strategies. The right choice depends on your device and use case.

### Parameter-shift rule

The default method for quantum hardware. It computes exact gradients by running the circuit with shifted parameter values:

```
∂f/∂θ = [f(θ + π/2) - f(θ - π/2)] / 2
```

This requires two circuit evaluations per parameter per gradient computation. It's exact, works on real hardware, and is the standard method.

The shift is π/2 — not a small ε as in classical finite differences — and the result is exact, not an approximation. Here's why: quantum rotation gates produce expectation values that are pure sinusoids of their parameters (of the form a·sin(θ) + b·cos(θ) + c, with no higher-frequency terms). For a pure sinusoid, evaluating at ±π/2 and taking the difference gives the exact derivative algebraically. There's no truncation error. On real hardware this is a big deal: you get exact gradients without needing to choose a step size, and the formula works equally well on a noisy quantum processor.

```python
import pennylane.numpy as pnp   # pnp.array supports requires_grad

dev = qml.device("default.qubit", wires=2)

@qml.qnode(dev, diff_method="parameter-shift")
def circuit(params):
    qml.RX(params[0], wires=0)
    qml.RY(params[1], wires=0)
    return qml.expval(qml.PauliZ(0))

# requires_grad=True marks these as differentiable parameters
params = pnp.array([0.5, 1.2], requires_grad=True)
grad = qml.grad(circuit)(params)
print(grad)
```

### Backpropagation

For simulators that support it, backpropagation (like in classical neural networks) is much faster:

```python
@qml.qnode(dev, diff_method="backprop")
def circuit(params):
    qml.RX(params[0], wires=0)
    qml.RY(params[1], wires=0)
    return qml.expval(qml.PauliZ(0))
```

Backprop is faster but only works with simulator devices, not real hardware.

### Finite differences (avoid for production)

Approximates gradients by small finite perturbations. Inaccurate and slow — mainly useful for debugging.

---

## 6.5 Integration with PyTorch and TensorFlow

PennyLane circuits can be embedded into PyTorch or TensorFlow computation graphs as layers. This is what makes hybrid quantum-classical neural networks possible.

### PyTorch integration

```python
import pennylane as qml
import torch

dev = qml.device("default.qubit", wires=2)

@qml.qnode(dev, diff_method="backprop", interface="torch")
def quantum_layer(inputs, weights):
    qml.AngleEmbedding(inputs, wires=range(2))
    qml.BasicEntanglerLayers(weights, wires=range(2))
    return qml.expval(qml.PauliZ(0))

# Use as part of a PyTorch model
inputs = torch.tensor([0.5, 1.2])
weights = torch.randn(3, 2, requires_grad=True)

result = quantum_layer(inputs, weights)
result.backward()   # Gradients flow through the quantum circuit
# How does .backward() work through a quantum circuit?
# PennyLane wraps the QNode as a PyTorch autograd.Function with a custom
# backward method. When .backward() is called, instead of tracing Python
# operations, PyTorch invokes PennyLane's backward, which runs the
# parameter-shift rule for each trainable parameter: evaluates the circuit
# at (θ + π/2) and (θ - π/2) and computes the exact gradient.
# Those gradients are passed back into PyTorch's gradient tape normally,
# so the rest of your model (linear layers, etc.) trains as usual.

print(f"Result: {result.item():.4f}")
print(f"Weight gradients: {weights.grad}")
```

### TensorFlow integration

```python
import tensorflow as tf

@qml.qnode(dev, diff_method="backprop", interface="tf")
def quantum_layer_tf(inputs, weights):
    qml.AngleEmbedding(inputs, wires=range(2))
    qml.BasicEntanglerLayers(weights, wires=range(2))
    return qml.expval(qml.PauliZ(0))

inputs = tf.constant([0.5, 1.2])
weights = tf.Variable(tf.random.normal([3, 2]))

with tf.GradientTape() as tape:
    result = quantum_layer_tf(inputs, weights)

grads = tape.gradient(result, weights)
print(grads)
```

---

## 6.6 Templates — pre-built circuit structures

PennyLane includes ready-made circuit structures for common patterns:

```python
import pennylane as qml
import numpy as np

dev = qml.device("default.qubit", wires=4)

@qml.qnode(dev)
def variational_circuit(weights, features):
    # Encode classical data as rotation angles
    qml.AngleEmbedding(features, wires=range(4))

    # Parameterized entangling layers
    qml.StronglyEntanglingLayers(weights, wires=range(4))

    return qml.expval(qml.PauliZ(0))

# Initialize weights: StronglyEntanglingLayers needs shape (layers, wires, 3)
weights = np.random.randn(3, 4, 3)
features = np.array([0.1, 0.5, 0.3, 0.9])

result = variational_circuit(weights, features)
print(f"Expectation value: {result:.4f}")
```

Templates to know:
- `qml.AngleEmbedding` — encode classical data as rotation angles
- `qml.AmplitudeEmbedding` — encode data as amplitudes (efficient but requires normalized input)
- `qml.BasicEntanglerLayers` — simple parameterized entangling layers
- `qml.StronglyEntanglingLayers` — more expressive entangling layers
- `qml.RandomLayers` — random circuit structure

---

## 6.7 Circuit inspection tools

```python
import pennylane as qml
import numpy as np

dev = qml.device("default.qubit", wires=3)

@qml.qnode(dev)
def circuit(theta):
    qml.RX(theta, wires=0)
    qml.CNOT(wires=[0, 1])
    qml.RY(theta / 2, wires=2)
    return qml.expval(qml.PauliZ(0))

# Print circuit diagram
print(qml.draw(circuit)(0.5))

# Get circuit as a tape (internal representation).
# qml.workflow.construct_tape is an internal PennyLane API — it works in
# PennyLane 0.38+ but may change between versions. It is useful for debugging
# but avoid it in production code; prefer qml.draw() for circuit inspection.
tape = qml.workflow.construct_tape(circuit)(0.5)
print(f"Number of operations: {len(tape.operations)}")
print(f"Number of trainable params: {tape.num_params}")

# Draw with matplotlib
fig, ax = qml.draw_mpl(circuit)(0.5)
import matplotlib.pyplot as plt
plt.show()
```

---

## 6.8 Running the code

There's one script in `code/chapter-06/`:

```bash
cd code/chapter-06
python pennylane_gradients.py
```

**`pennylane_gradients.py`** walks through five differentiation demonstrations:

1. **Basic gradient with `qml.grad`** — computes d⟨Z⟩/dθ for five values of θ and checks each against the analytic result (-sin θ). Every line should print `OK`.

2. **Multi-parameter gradient** — a 4-parameter circuit. Prints the gradient vector. You can see which parameters actually affect the output and which don't (some will be exactly 0 depending on the circuit structure).

3. **Jacobian** — three observables, two parameters. Prints the 3×2 Jacobian matrix showing how each observable changes with each parameter. This is the building block for multi-output optimizers.

4. **Parameter-shift vs finite differences** — runs both methods and shows the difference is around 10⁻¹³. This confirms that parameter-shift gives exact gradients, not approximations.

5. **Gradient descent optimization** — starts at θ=0.1 where ⟨Z⟩≈1, and runs 20 gradient descent steps to minimize toward θ=π where ⟨Z⟩=-1. Watch the values converge. This is the exact same loop that VQE uses — just one parameter here instead of many.

The whole script runs in a few seconds. A good exercise: change the `lr` (learning rate) in section 5 from 0.3 to 0.01 and watch how many steps it takes to converge.

---

## 6.9 Qiskit vs PennyLane — when to use which

These SDKs aren't competitors — they're complementary tools with different strengths.

**Use Qiskit when:**
- You need fine-grained control over circuit compilation and transpilation
- You're targeting specific IBM hardware topologies
- You want the most mature ecosystem and community resources
- You're implementing oracle-based algorithms or fixed circuits
- You need detailed noise models and error mitigation

**Use PennyLane when:**
- You're doing variational algorithms (VQE, QAOA) and need gradients
- You're building quantum machine learning models
- You want framework-agnostic code that runs on multiple backends
- You're integrating quantum layers into PyTorch or TensorFlow models
- You want a cleaner, more Pythonic API

In practice, many projects use both. PennyLane for algorithm development and ML work, Qiskit for hardware execution and optimization.

---

## Summary

PennyLane's differentiation capability is the feature that sets it apart. Quantum circuits become differentiable functions, which unlocks gradient-based optimization. This is the core primitive for everything in the next few chapters — variational algorithms and quantum machine learning.

The device abstraction means your circuit code is hardware-agnostic. Switching from local simulation to IBM hardware to AWS Braket is a one-line change.

---

**Exercises**

1. Write a PennyLane circuit with 3 parameters and use `qml.grad` to compute all three gradients. Verify by computing finite-difference approximations manually.
2. Implement the same Bell state circuit in Qiskit and PennyLane. Run both on the same IBM backend (use the Qiskit device in PennyLane) and compare results.
3. Build a 4-qubit circuit using `StronglyEntanglingLayers` and run it on `lightning.qubit`. Measure how much faster it is than `default.qubit` for 1000 shots.
4. Create a PyTorch model that has one classical linear layer followed by a PennyLane quantum layer. Run it with random inputs.

---

**Next:** Chapter 7 puts PennyLane's differentiation to work in two of the most important near-term quantum algorithms: VQE for quantum chemistry simulation and QAOA for combinatorial optimization.

---

| | |
|:---|---:|
| [← Chapter 5 — Core Quantum Algorithms](./chapter-05-quantum-algorithms.md) | [Chapter 7 — Variational Algorithms →](./chapter-07-variational-algorithms.md) |

---

*Chapter 6 of 10 — Quantum Computing for Developers*
