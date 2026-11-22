# Chapter 8: Running on Real Quantum Hardware

**Estimated time:** 40 minutes
**Code directory:** `code/chapter-08/`

---

## What this chapter covers

Up to this point you've been running on simulators. Simulators are perfect for development — they're fast, noiseless, and free. But real quantum hardware behaves differently. This chapter walks through submitting jobs to actual IBM quantum processors, understanding why results differ from simulation, using transpilation to map circuits to hardware topology, and applying noise mitigation techniques to get cleaner results.

---

## 8.1 What's different on real hardware

When you run a circuit on a simulator, it executes the exact gates you wrote, and the only randomness comes from measurement. Real quantum hardware introduces several additional sources of error:

**Gate errors.** Every gate operation has some probability of applying slightly wrong. Modern IBM hardware has two-qubit gate error rates around 0.1–1%. Run a 100-gate circuit and you've accumulated potentially several percent error.

**Readout errors.** Measuring a qubit isn't perfect either. A qubit in state |0⟩ can be misread as 1 with some probability (typically 1–3%), and vice versa.

**Decoherence.** Qubits lose their quantum state over time due to interactions with the environment. Two timescales matter: **T1** (energy relaxation) is how long before a qubit spontaneously flips — the qubit absorbs energy from the environment and transitions from |1⟩ to |0⟩. **T2** (dephasing) is how long before the relative phase between |0⟩ and |1⟩ drifts randomly — this destroys superposition even when no flip happens. T2 is always ≤ 2·T1. For modern superconducting qubits, T1 and T2 are in the range of microseconds to milliseconds. Circuits that take too long to execute lose coherence before they finish.

**Limited connectivity.** Physical qubits can't interact with every other qubit directly. They're connected in a specific graph called the **coupling map**. If your circuit uses a CNOT between two qubits that aren't neighbors on the coupling map, the compiler has to add SWAP gates to route one qubit to the other — which adds more gates, more depth, and more noise.

Understanding these constraints is the key to writing circuits that produce useful results on real hardware.

---

## 8.2 Connecting to real hardware

```python
from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2 as Sampler
from qiskit import QuantumCircuit
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

# Load your saved credentials
service = QiskitRuntimeService(channel="ibm_quantum_platform")

# List available backends and their status
for backend in service.backends():
    status = backend.status()
    print(f"{backend.name:<30} qubits={backend.num_qubits:<5} "
          f"pending={status.pending_jobs:<5}")
```

Pick a backend with few pending jobs. The queue can range from a few minutes to several hours depending on system load. For learning, prefer less popular systems — the results are equally valid.

```python
# Select a specific backend
backend = service.backend("ibm_brisbane")  # Replace with an available backend

# Inspect hardware properties
print(f"\nBackend: {backend.name}")
print(f"Qubits: {backend.num_qubits}")
print(f"Basis gates: {backend.basis_gates}")
print(f"Coupling map: {list(backend.coupling_map)[:10]}...")  # First few connections
```

---

## 8.3 Transpilation — mapping your circuit to hardware

Transpilation takes your logical circuit and compiles it down to the physical gates the hardware supports. This involves several steps:

1. **Unrolling** — replace abstract gates with basis gates the hardware supports
2. **Layout** — assign logical qubits to physical qubit positions
3. **Routing** — add SWAP gates to handle non-adjacent qubit interactions
4. **Optimization** — reduce circuit depth where possible

```python
from qiskit import QuantumCircuit
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

# A simple circuit to transpile
qc = QuantumCircuit(3, 3)
qc.h(0)
qc.cx(0, 1)
qc.cx(1, 2)
qc.measure_all()

# Transpile for the target backend
# optimization_level: 0 (none), 1 (light), 2 (medium), 3 (heavy — slow but best)
pm = generate_preset_pass_manager(
    optimization_level=2,
    backend=backend
)

transpiled = pm.run(qc)

print(f"Original circuit depth: {qc.depth()}")
print(f"Transpiled circuit depth: {transpiled.depth()}")
print(f"Original gates: {qc.count_ops()}")
print(f"Transpiled gates: {transpiled.count_ops()}")
print("\nTranspiled circuit:")
print(transpiled.draw())
```

The transpiled circuit will often be significantly deeper than your original. That's the cost of hardware constraints. Optimization level 3 takes longer to compile but produces shallower circuits, which is worth it before submitting to real hardware.

---

## 8.4 Submitting a job to real hardware

IBM's current API uses the `SamplerV2` primitive for circuit execution:

```python
from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2 as Sampler
from qiskit import QuantumCircuit
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

service = QiskitRuntimeService(channel="ibm_quantum_platform")
backend = service.least_busy(min_num_qubits=5)  # Auto-select least busy backend
print(f"Using backend: {backend.name}")

# Build your circuit
qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()

# Transpile
pm = generate_preset_pass_manager(optimization_level=2, backend=backend)
transpiled_qc = pm.run(qc)

# Submit to real hardware
sampler = Sampler(backend)

print("Submitting job to real hardware...")
print("(This will queue — check status with job.status())")

job = sampler.run([transpiled_qc], shots=1000)
print(f"Job ID: {job.job_id()}")
print("Job submitted. Use the job ID to retrieve results later.")

# Check status (non-blocking)
print(f"Current status: {job.status()}")
```

### Retrieving results later

You don't have to keep your script running while the job queues. Save the job ID and retrieve results later:

```python
from qiskit_ibm_runtime import QiskitRuntimeService

service = QiskitRuntimeService(channel="ibm_quantum_platform")

# Retrieve a previously submitted job
job = service.job("YOUR_JOB_ID_HERE")
print(f"Status: {job.status()}")

# Only retrieve if done
if job.status().name == "DONE":
    result = job.result()
    pub_result = result[0]
    counts = pub_result.data.meas.get_counts()
    print(f"Results: {counts}")
else:
    print("Job still running. Try again later.")
```

### Or block and wait

```python
# This blocks your script until the job completes
result = job.result()
counts = result[0].data.meas.get_counts()
print(f"Hardware results: {counts}")
```

For queue times over a few minutes, the non-blocking approach is strongly preferred.

---

## 8.5 Comparing hardware and simulator results

Run the same circuit on both and compare:

```python
from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2 as Sampler
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()

# Simulator run
sim = AerSimulator()
sim_result = sim.run(qc, shots=1000).result()
sim_counts = sim_result.get_counts()
print(f"Simulator: {sim_counts}")

# Real hardware run
service = QiskitRuntimeService(channel="ibm_quantum_platform")
backend = service.least_busy(min_num_qubits=5)

pm = generate_preset_pass_manager(optimization_level=2, backend=backend)
transpiled = pm.run(qc)

sampler = Sampler(backend)
job = sampler.run([transpiled], shots=1000)
hw_result = job.result()
hw_counts = hw_result[0].data.meas.get_counts()
print(f"Hardware:  {hw_counts}")
```

On the simulator, a Bell state gives nearly perfect 50/50 between '00' and '11', with zero '01' or '10'. On real hardware, you'll see some '01' and '10' — those are errors. The fraction of error states tells you something about the hardware's current noise level.

---

## 8.6 Noise mitigation

Error mitigation doesn't fix the underlying hardware errors but applies classical post-processing to reduce their impact on results. Qiskit Runtime has built-in mitigation options.

### Readout error mitigation

Corrects for qubit measurement errors using a calibration matrix:

```python
from qiskit_ibm_runtime import SamplerV2 as Sampler, Options

# Options for the sampler
options = Options()
options.resilience_level = 1  # Level 1: readout error mitigation

sampler = Sampler(backend, options=options)
job = sampler.run([transpiled], shots=1000)
result = job.result()
```

Resilience levels in Qiskit Runtime:
- Level 0: No mitigation
- Level 1: Readout error mitigation (TREX)
- Level 2: Zero-noise extrapolation (ZNE) — more aggressive, slower, uses more shots
- Level 3: Probabilistic error cancellation (PEC) — best quality, most shots needed

### Zero-Noise Extrapolation (ZNE)

ZNE is more powerful. It intentionally runs the circuit at multiple noise levels (by inserting pairs of inverse gates that cancel logically but increase physical noise), then extrapolates back to the zero-noise limit.

```python
from qiskit_ibm_runtime import EstimatorV2 as Estimator
from qiskit_ibm_runtime.options import EstimatorOptions
from qiskit.quantum_info import SparsePauliOp

options = EstimatorOptions()
options.resilience_level = 2  # Enables ZNE

estimator = Estimator(backend, options=options)

# Define an observable (what we're measuring)
observable = SparsePauliOp.from_list([("ZZ", 1.0)])

job = estimator.run([(transpiled, observable)])
result = job.result()
print(f"Mitigated expectation value: {result[0].data.evs}")
```

---

## 8.7 Noise simulation — test before you queue

Instead of waiting in a hardware queue to test noise behavior, you can simulate the noise of a specific backend locally using Aer's noise models:

```python
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel
from qiskit_ibm_runtime import QiskitRuntimeService

service = QiskitRuntimeService(channel="ibm_quantum_platform")
backend = service.backend("ibm_brisbane")

# Build a noise model matching the real backend
noise_model = NoiseModel.from_backend(backend)

# Run your circuit with this noise model — locally, instantly
noisy_sim = AerSimulator(noise_model=noise_model)

qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()

from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
pm = generate_preset_pass_manager(optimization_level=2, backend=noisy_sim)
transpiled = pm.run(qc)

result = noisy_sim.run(transpiled, shots=2000).result()
print("Noisy simulation results:", result.get_counts())
```

This is extremely useful for development. You get realistic noise behavior without the queue time.

---

## 8.8 Practical tips for hardware runs

**Start small.** Use the fewest qubits your algorithm needs. More qubits = more noise.

**Minimize circuit depth.** Every extra gate layer adds error. Use optimization_level=3 during transpilation.

**Choose the right backend.** Use `service.least_busy()` or check error rates on quantum.ibm.com. Error rates vary between systems and change over time as hardware is recalibrated.

**Run enough shots.** With hardware noise, statistical fluctuations add on top of quantum randomness. Use at least 1000 shots, more if you need precise probabilities.

**Use the noise simulator first.** Before submitting to real hardware, run with the backend's noise model locally to check your circuit behaves reasonably under realistic noise.

**Don't over-interpret noisy results.** A circuit that works perfectly on a simulator but gives 60% accuracy on hardware is not necessarily a failure — that might be the expected behavior given the circuit depth and error rates.

---

## 8.9 Running the code

There is one script in `code/chapter-08/`:

```bash
cd code/chapter-08
```

**`run_on_hardware.py`** — submits a Bell state circuit to real IBM hardware and compares the results against the ideal simulator and a noisy simulation. It supports three modes:

```bash
# Run ideal simulator only (no IBM account needed):
python run_on_hardware.py --sim-only

# Submit to real hardware (requires IBM account from Chapter 2):
python run_on_hardware.py

# Retrieve a previously submitted job:
python run_on_hardware.py --job-id YOUR_JOB_ID
```

The `--sim-only` mode runs immediately with no account needed. It shows the ideal Bell state result (close to 50% `|00⟩` and 50% `|11⟩`, with near-zero errors).

With a real IBM account, the script connects automatically, selects the least-busy backend, runs the noisy simulator locally (fast, no queue), then submits the real hardware job. It prints your job ID immediately — you don't have to keep the script running. Real hardware jobs typically queue for 5 to 60 minutes depending on system load.

Add `--wait` to block until the hardware results come back and print a three-way comparison:

```bash
python run_on_hardware.py --wait
```

What to look for in the hardware results: the ideal simulator shows 0% error (`|01⟩` and `|10⟩` never appear). The real hardware will show a small percentage of unexpected outcomes — typically 1–5%. That's the gate and readout noise covered in section 8.1. The noisy simulation (run locally using the backend's calibration data) gives a preview of roughly what to expect.

---

## Summary

Real quantum hardware runs your transpiled circuits on actual superconducting qubits cooled near absolute zero. The results have errors from gate imperfections, readout noise, and decoherence. Transpilation maps your circuit to hardware constraints, often adding SWAP gates that increase depth. Noise mitigation (readout correction, ZNE) applies post-processing to improve result quality. And noise simulation lets you test realistic behavior locally without waiting in queue.

Getting useful results from NISQ hardware takes careful circuit design, some understanding of how the hardware fails, and patience with queues and noise.

---

**Exercises**

1. Submit the Bell state circuit to real IBM hardware and compare the error rate (fraction of `01` and `10` results) to the simulator.
2. Run the same circuit at optimization_level=0 and optimization_level=3. Compare circuit depth and hardware accuracy.
3. Build a noise model from an IBM backend and simulate it locally. How close are the noisy simulation results to the real hardware results?
4. Use ZNE (resilience_level=2) on a GHZ state circuit and compare the mitigated vs unmitigated results.

---

**Next:** Chapter 9 puts quantum circuits to work in machine learning — quantum neural networks, quantum kernels, and building a binary classifier that runs on both simulators and real hardware.

---

| | |
|:---|---:|
| [← Chapter 7 — Variational Algorithms](./chapter-07-variational-algorithms.md) | [Chapter 9 — Quantum Machine Learning →](./chapter-09-quantum-ml.md) |

---

*Chapter 8 of 10 — Quantum Computing for Developers*
