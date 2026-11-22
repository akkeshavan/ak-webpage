# Chapter 9: Quantum Machine Learning

**Estimated time:** 45 minutes
**Code directory:** `code/chapter-09/`

---

## What this chapter covers

Quantum machine learning (QML) is one of the most active and hotly debated areas in quantum computing. This chapter covers the practical side: how to build quantum neural networks (QNNs) with PennyLane, what quantum kernels are and how to use them for classification, and how to connect quantum layers into a classical PyTorch model. It also covers the honest state of QML — what's real, what's speculative, and what you should be skeptical of.

---

## 9.1 A note on honesty

QML is surrounded by hype. No practical quantum advantage over classical ML has been demonstrated on real datasets, and scalability beyond small NISQ problems remains an open problem. What has been shown is that quantum circuits can express feature maps that are hard to simulate classically, and that they can act as universal function approximators for specific carefully-constructed problems.

The detailed limitations — barren plateaus, data loading bottlenecks, dequantization — are covered in §9.7. Read that section before drawing conclusions about whether a quantum model would help your problem.

Approach QML as an explorer learning a fast-moving field, not as an engineer deploying to production.

---

## 9.2 Data encoding — getting classical data into quantum circuits

Before a quantum circuit can process classical data, you need to encode that data as quantum states. This is one of QML's fundamental challenges — the encoding method affects expressiveness, trainability, and computational cost.

### Angle encoding

Encode each feature as a rotation angle. Simple and widely used.

```python
import pennylane as qml
import numpy as np

dev = qml.device("default.qubit", wires=4)

@qml.qnode(dev)
def angle_encoded_circuit(features):
    """Encode 4 features as RX rotations, one per qubit."""
    for i, feature in enumerate(features):
        qml.RX(feature, wires=i)
    return qml.state()

features = np.array([0.5, 1.2, 0.8, 0.3])
state = angle_encoded_circuit(features)
```

One feature per qubit. Not qubit-efficient but straightforward to implement and differentiate.

### Amplitude encoding

Encode n features into the amplitudes of log₂(n) qubits. Much more qubit-efficient but harder to implement and prepare.

```python
@qml.qnode(dev)
def amplitude_encoded_circuit(features):
    """
    Encode 2^4=16 features into the amplitudes of 4 qubits.
    Features must be normalized to unit norm.
    """
    norm = np.linalg.norm(features)
    qml.AmplitudeEmbedding(features / norm, wires=range(4), normalize=True)
    return qml.state()

features_16 = np.random.randn(16)
state = amplitude_encoded_circuit(features_16)
```

### Re-uploading

A powerful technique where features are re-used in multiple circuit layers. This gives the model more expressive capacity without additional qubits:

```python
@qml.qnode(dev)
def reuploading_circuit(features, weights):
    """
    Features are encoded in every layer alongside trainable weights.
    Provides rich expressiveness from few qubits.
    """
    n_layers = weights.shape[0]

    for layer in range(n_layers):
        # Encode features
        for i, feature in enumerate(features):
            qml.RX(feature, wires=i % 4)

        # Trainable rotations
        for i in range(4):
            qml.RY(weights[layer, i, 0], wires=i)
            qml.RZ(weights[layer, i, 1], wires=i)

        # Entangling layer
        qml.BasicEntanglerLayers(weights[layer:layer+1, :, :1], wires=range(4))

    return qml.expval(qml.PauliZ(0))
```

---

## 9.3 Quantum Neural Networks (QNN)

A QNN is a parameterized quantum circuit used as a machine learning model. It has:
- An encoding layer (data goes in)
- Trainable layers (parameters adjusted during training)
- A measurement (output)

Here's a complete binary classifier built as a QNN:

```python
import pennylane as qml
import pennylane.numpy as pnp   # pnp arrays support requires_grad for autograd
import numpy as np
from sklearn.datasets import make_moons
from sklearn.preprocessing import MinMaxScaler
from sklearn.model_selection import train_test_split

# Generate a simple 2D classification dataset
X, y = make_moons(n_samples=200, noise=0.1, random_state=42)
y = 2 * y - 1   # Convert labels to {-1, +1}

# Normalize features to [0, π]
scaler = MinMaxScaler(feature_range=(0, np.pi))
X_scaled = scaler.fit_transform(X)

X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.2)

# QNN definition
n_qubits = 2
n_layers = 3

dev = qml.device("default.qubit", wires=n_qubits)

@qml.qnode(dev, diff_method="backprop")
def qnn_circuit(x, weights):
    """
    A quantum neural network for binary classification.
    x: input features (2D)
    weights: trainable parameters shape (n_layers, n_qubits, 3)
    """
    # Data encoding
    qml.AngleEmbedding(x, wires=range(n_qubits), rotation='Y')

    # Trainable layers
    qml.StronglyEntanglingLayers(weights, wires=range(n_qubits))

    # Output: expectation value of Z on qubit 0
    return qml.expval(qml.PauliZ(0))

def classify(x, weights):
    """Returns +1 or -1 prediction."""
    return np.sign(float(qnn_circuit(x, weights)))

def cost(weights, X, y):
    """Mean squared error loss — uses qml.math.stack to stay autograd-compatible."""
    y_pm = 2 * np.array(y) - 1
    preds = qml.math.stack([qnn_circuit(x, weights) for x in X])
    return qml.math.mean((preds - y_pm) ** 2)

# Initialize weights — must be pnp.array with requires_grad=True for qml.grad
np.random.seed(42)
weights = pnp.array(np.random.randn(n_layers, n_qubits, 3) * 0.1, requires_grad=True)

# Training loop
grad_fn = qml.grad(cost, argnums=0)
learning_rate = 0.1
n_epochs = 50

print("Training QNN...")
print("-" * 40)

for epoch in range(n_epochs):
    grads = grad_fn(weights, X_train[:20], y_train[:20])   # Mini-batch
    weights = weights - learning_rate * grads

    if (epoch + 1) % 10 == 0:
        train_loss = cost(weights, X_train[:20], y_train[:20])
        train_preds = np.array([classify(x, weights) for x in X_train])
        train_acc = np.mean(train_preds == y_train)
        print(f"Epoch {epoch+1:3d}: loss={train_loss:.4f}, train_acc={train_acc:.3f}")

# Final evaluation
test_preds = np.array([classify(x, weights) for x in X_test])
test_acc = np.mean(test_preds == y_test)
print(f"\nTest accuracy: {test_acc:.3f}")
```

---

## 9.4 QNN as a PyTorch Layer

For real ML workflows, you want to plug a QNN into a PyTorch model. The full runnable version of this example is in `code/chapter-09/hybrid_torch.py`. Here's the structure:

```python
import torch
import torch.nn as nn
import pennylane as qml
import numpy as np

n_qubits = 4
n_layers = 2

dev = qml.device("default.qubit", wires=n_qubits)

# Weight shapes for qml.qnn.TorchLayer
weight_shapes = {"weights": (n_layers, n_qubits, 3)}

@qml.qnode(dev, diff_method="backprop", interface="torch")
def quantum_layer(inputs, weights):
    qml.AngleEmbedding(inputs, wires=range(n_qubits))
    qml.StronglyEntanglingLayers(weights, wires=range(n_qubits))
    return [qml.expval(qml.PauliZ(i)) for i in range(n_qubits)]

# Wrap as a PyTorch layer
qlayer = qml.qnn.TorchLayer(quantum_layer, weight_shapes)

# Hybrid classical-quantum model
class HybridModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.classical_pre = nn.Linear(2, n_qubits)   # Encode 2D input
        self.quantum = qlayer
        self.classical_post = nn.Linear(n_qubits, 1)  # Output layer
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        x = torch.tanh(self.classical_pre(x)) * np.pi  # Scale to good range for angles
        x = self.quantum(x)
        x = self.sigmoid(self.classical_post(x))
        return x

model = HybridModel()
optimizer = torch.optim.Adam(model.parameters(), lr=0.01)
loss_fn = nn.BCELoss()

# Training with PyTorch's standard loop
from sklearn.datasets import make_moons
from sklearn.preprocessing import MinMaxScaler

X_np, y_np = make_moons(n_samples=100, noise=0.1, random_state=42)
scaler = MinMaxScaler()
X_np = scaler.fit_transform(X_np)

X_tensor = torch.tensor(X_np, dtype=torch.float32)
y_tensor = torch.tensor(y_np, dtype=torch.float32).unsqueeze(1)

print("Training hybrid quantum-classical model...")
for epoch in range(20):
    optimizer.zero_grad()
    pred = model(X_tensor)
    loss = loss_fn(pred, y_tensor)
    loss.backward()
    optimizer.step()

    if (epoch + 1) % 5 == 0:
        accuracy = ((pred > 0.5).float() == y_tensor).float().mean()
        print(f"Epoch {epoch+1:2d}: loss={loss.item():.4f}, acc={accuracy.item():.3f}")
```

---

## 9.5 Quantum Kernels

An alternative to the variational circuit approach is the **quantum kernel** method. Instead of training a QNN end-to-end, you use the quantum circuit to compute a kernel function between data points, then plug that kernel into a classical SVM.

The kernel is the inner product between quantum feature map states:

```
K(xᵢ, xⱼ) = |⟨φ(xᵢ)|φ(xⱼ)⟩|²
```

This measures how "similar" two data points are in the quantum feature space. If the quantum feature map is hard to simulate classically, this gives access to kernel functions that classical algorithms cannot efficiently compute.

```python
import pennylane as qml
import numpy as np
from sklearn.svm import SVC
from sklearn.datasets import make_moons
from sklearn.preprocessing import MinMaxScaler
from sklearn.model_selection import train_test_split

# Dataset
X, y = make_moons(n_samples=100, noise=0.1, random_state=42)
scaler = MinMaxScaler(feature_range=(0, np.pi))
X = scaler.fit_transform(X)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

n_qubits = 2
dev = qml.device("default.qubit", wires=n_qubits)

def feature_map(x):
    """Encode a data point as a quantum state."""
    for i in range(n_qubits):
        qml.Hadamard(wires=i)
        qml.RZ(x[i], wires=i)
    for i in range(n_qubits - 1):
        qml.CNOT(wires=[i, i + 1])
    for i in range(n_qubits):
        qml.RZ(x[i], wires=i)

@qml.qnode(dev)
def kernel_circuit(x1, x2):
    """Compute kernel: |⟨φ(x1)|φ(x2)⟩|²"""
    feature_map(x1)
    # qml.adjoint(feature_map)(x2) runs the feature map for x2 in reverse,
    # with every gate replaced by its inverse (conjugate transpose).
    # After feature_map(x1) prepares |φ(x1)⟩, running adjoint(feature_map)(x2)
    # applies ⟨φ(x2)|. The probability of measuring |00...0⟩ is then
    # |⟨φ(x2)|φ(x1)⟩|² — the squared inner product that defines the kernel.
    qml.adjoint(feature_map)(x2)
    return qml.probs(wires=range(n_qubits))

def quantum_kernel(x1, x2):
    """Returns the kernel value between two points."""
    return kernel_circuit(x1, x2)[0]  # Probability of measuring |00...0⟩

def build_kernel_matrix(X1, X2):
    """Build the full kernel matrix."""
    n1, n2 = len(X1), len(X2)
    K = np.zeros((n1, n2))
    for i in range(n1):
        for j in range(n2):
            K[i, j] = quantum_kernel(X1[i], X2[j])
    return K

print("Computing quantum kernel matrix (this takes a moment)...")

K_train = build_kernel_matrix(X_train, X_train)
K_test = build_kernel_matrix(X_test, X_train)

# SVM with quantum kernel
svm = SVC(kernel='precomputed')
svm.fit(K_train, y_train)

train_score = svm.score(K_train, y_train)
test_score = svm.score(K_test, y_test)

print(f"Train accuracy: {train_score:.3f}")
print(f"Test accuracy:  {test_score:.3f}")
```

---

## 9.6 Transfer learning with pre-trained classical networks

A practical near-term strategy: use a classical pretrained model for feature extraction, then pass the extracted features to a small quantum circuit for final classification. The quantum circuit only handles a small, compressed feature space.

The pattern looks like this: take a pretrained model (say, ResNet18 from PyTorch), remove its classification head, and use it to produce a compact feature vector from each image. Then feed that feature vector into a small QNN — a circuit with 4–8 qubits — that acts as the final classifier.

```python
import torch
import torchvision.models as models
import pennylane as qml
import numpy as np

# Classical pretrained feature extractor
resnet = models.resnet18(weights="IMAGENET1K_V1")
resnet.fc = torch.nn.Identity()  # Remove classification head, keep 512-dim features
resnet.eval()

# Small QNN that operates on the compressed feature vector
n_qubits = 4
dev = qml.device("default.qubit", wires=n_qubits)

@qml.qnode(dev, interface="torch")
def small_qnn(features, weights):
    # features: a 4-dim vector compressed from the 512-dim ResNet output
    qml.AngleEmbedding(features, wires=range(n_qubits))
    qml.BasicEntanglerLayers(weights, wires=range(n_qubits))
    return qml.expval(qml.PauliZ(0))
```

The key steps in a full pipeline:
1. Pass each image through ResNet to get a 512-dimensional feature vector
2. Use a classical linear layer to compress that to 4 dimensions
3. Feed the 4 features into the QNN as rotation angles
4. Train only the compression layer and the QNN weights (ResNet stays frozen)

This approach is sensible for NISQ hardware because the quantum circuit only sees 4 numbers — keeping the circuit small and the noise manageable. The classical backbone does the heavy feature lifting.

---

## 9.7 Current limitations of QML

Being realistic about where QML stands:

**Barren plateaus.** The same vanishing gradient problem from Chapter 7 applies here. Random QNN initialization leads to exponentially flat loss landscapes for large qubit counts. Active research is addressing this, but it's a fundamental challenge.

**Data loading bottleneck.** Loading N classical data points into a quantum circuit takes O(N) time classically, which can eliminate quantum speedups that are only polynomial.

**Dequantization.** Several prominent QML algorithms have been "dequantized" — shown to be efficiently simulable classically. If your data fits in RAM and is low-rank, many quantum kernel methods offer no advantage over classical equivalents.

**Noise.** On real NISQ hardware, shot noise and gate errors add variance that degrades model performance. Larger models amplify this.

None of this means QML is dead. It means you should be skeptical of claims, test carefully, and focus on problems where quantum feature maps might genuinely be hard to simulate classically.

---

## 9.8 Running the code

Two scripts live in `code/chapter-09/`. Both run on the local PennyLane simulator.

```bash
cd code/chapter-09
```

**`qnn_classifier.py`** — trains a 2-qubit QNN to classify the moons dataset (two interleaved half-circles — a classic non-linearly-separable problem). It then compares the QNN's accuracy against classical logistic regression.

As training runs, it prints a progress table every 10 epochs showing the loss and train/test accuracy:

```
 Epoch |     Loss | Train Acc | Test Acc
----------------------------------------------
    10 |   0.8234 |     0.750 |     0.725
    20 |   0.6901 |     0.825 |     0.800
    ...
    60 |   0.4123 |     0.875 |     0.850
```

After training it prints the final test accuracy and the logistic regression score for comparison. Then it saves `qnn_decision_boundary.png` — a plot showing the decision boundary the QNN learned, with the training and test data colored by class.

What to expect: the QNN typically reaches 80–90% test accuracy on this dataset. Logistic regression achieves similar accuracy (it's a simple dataset). This is expected — quantum advantage is problem-dependent, and the moons dataset is not one where a quantum model has a structural edge. The value of this exercise is building intuition for how QNNs train, not expecting them to outperform classical methods.

The script requires `scikit-learn` (installed in Chapter 2). If it's not installed, it generates synthetic two-class data as a fallback.

**`hybrid_torch.py`** — the hybrid classical-quantum model from section 9.4. A classical `Linear(2 → 4)` layer feeds into a 4-qubit `StronglyEntanglingLayers` circuit, then a `Linear(4 → 1)` output layer. Trains for 30 epochs on the moons dataset using PyTorch's Adam optimizer with gradients flowing through the quantum circuit via backpropagation.

```bash
python hybrid_torch.py
```

Requires `torch` in addition to `pennylane`:

```bash
pip install torch
```

---

## Summary

QML provides tools for using quantum circuits as components in machine learning pipelines. PennyLane's differentiation model makes this practical — circuits are functions, gradients flow through them, and they can be embedded directly into PyTorch or TensorFlow models.

Quantum kernels offer an alternative to end-to-end QNN training and may be more suitable for current NISQ hardware since they don't require deep variational circuits.

As of 2025, QML is research-stage. It's worth learning, building experiments with, and watching closely as hardware improves. Don't deploy it in production expecting it to outperform classical models on standard benchmarks.

---

**Exercises**

1. Train the QNN binary classifier from section 9.3 on the sklearn `digits` dataset (binary: 0 vs 1). Compare accuracy to a classical logistic regression.
2. Modify the quantum kernel to use 3 qubits and test whether accuracy improves on the moons dataset.
3. Build a hybrid model with a 2-qubit QNN as a middle layer between two linear layers. Does it learn the moons classification?
4. Implement the training loop using PennyLane's `qml.AdamOptimizer` instead of PyTorch's optimizer.

---

**Next:** Chapter 10 is the capstone — a complete end-to-end project: a quantum portfolio optimization tool that combines QAOA, classical preprocessing, and a command-line interface.

---

| | |
|:---|---:|
| [← Chapter 8 — Running on Real Hardware](./chapter-08-real-hardware.md) | [Chapter 10 — Capstone Project →](./chapter-10-capstone.md) |

---

*Chapter 9 of 10 — Quantum Computing for Developers*
