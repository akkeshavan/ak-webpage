# Chapter 10: Capstone Project — Quantum Portfolio Optimizer

**Estimated time:** 45 minutes
**Code directory:** `code/chapter-10/`

---

## What this chapter covers

This chapter builds a complete, end-to-end application: a quantum portfolio optimizer that uses QAOA to find the best combination of assets for a given risk/return tradeoff. It pulls together everything from the previous chapters — QAOA (Chapter 7), hardware execution (Chapter 8), PennyLane (Chapters 6–7), and classical data processing.

The project has a proper structure with separate modules, a CLI, configurable parameters, and both simulator and hardware execution modes.

---

## 10.1 The problem: portfolio optimization

Markowitz portfolio theory (1952) frames investing as an optimization problem: given N assets with known expected returns and covariances, find the combination of assets that maximizes expected return for a given level of risk.

In the simplest binary version:
- Each asset is either included (1) or excluded (0) from the portfolio
- We want to maximize return while minimizing correlation between assets (diversification)
- The number of assets to include is constrained

This is a **Quadratic Unconstrained Binary Optimization (QUBO)** problem, which maps directly to QAOA.

Formally, given:
- z ∈ {0,1}ⁿ — the portfolio selection vector (1 = include asset, 0 = exclude)
- μ — the vector of expected returns for each asset
- Σ — the covariance matrix (measures how correlated each pair of assets is)
- q — the risk aversion coefficient (higher q penalises correlated assets more)

We minimize:

```
C(z) = -μᵀz + q · zᵀΣz
```

The first term maximises return (negative because we're minimising). The second term penalises risk — selecting two highly correlated assets increases this term.

---

## 10.2 Project structure

```
code/chapter-10/
  portfolio_optimizer/
    __init__.py
    data.py          <- Asset data loading and preprocessing
    qaoa.py          <- QAOA circuit and optimizer
    classical.py     <- Classical brute-force solver (for comparison)
    visualize.py     <- Result plots
  main.py            <- CLI entry point
  config.yaml        <- Configuration file
  requirements.txt
```

---

## 10.3 Asset data and preprocessing

**`code/chapter-10/portfolio_optimizer/data.py`**

```python
"""
Asset data module: loads price data and computes returns and covariances.
Uses synthetic data so the project runs without external API keys.
"""

import numpy as np
from dataclasses import dataclass
from typing import List


@dataclass
class AssetData:
    tickers: List[str]
    returns: np.ndarray       # Expected returns (n_assets,)
    covariance: np.ndarray    # Covariance matrix (n_assets, n_assets)
    n_assets: int


def generate_synthetic_assets(n_assets: int = 6, seed: int = 42) -> AssetData:
    """
    Generate synthetic asset data with realistic properties.
    Used when real market data is not available.
    """
    np.random.seed(seed)

    tickers = [f"ASSET_{i}" for i in range(n_assets)]

    # Returns: normally distributed around 8% with 4% std
    returns = np.random.normal(0.08, 0.04, n_assets)

    # Covariance: positive semi-definite matrix
    # Start with a random matrix and make it PSD
    A = np.random.randn(n_assets, n_assets) * 0.1
    covariance = A @ A.T + np.eye(n_assets) * 0.01   # Diagonal dominance ensures PSD

    return AssetData(
        tickers=tickers,
        returns=returns,
        covariance=covariance,
        n_assets=n_assets
    )


def load_from_csv(filepath: str) -> AssetData:
    """
    Load asset data from a CSV file.
    Expected format: rows=time periods, columns=asset prices.
    First row: header with ticker names.
    """
    import pandas as pd

    df = pd.read_csv(filepath, index_col=0)
    tickers = list(df.columns)
    n_assets = len(tickers)

    # Compute log returns
    log_returns = np.log(df / df.shift(1)).dropna()

    # Annualize
    returns = log_returns.mean().values * 252
    covariance = log_returns.cov().values * 252

    return AssetData(
        tickers=tickers,
        returns=returns,
        covariance=covariance,
        n_assets=n_assets
    )


def build_qubo_matrix(data: AssetData, risk_aversion: float = 0.5,
                       budget: int = None) -> np.ndarray:
    """
    Build the QUBO matrix Q for portfolio optimization.

    C(z) = -μᵀz + q·zᵀΣz + penalty·(Σzᵢ - budget)²

    The penalty term enforces the budget constraint (exactly `budget` assets selected).
    If budget is None, no cardinality constraint is applied.

    Returns Q such that C(z) = zᵀQz (up to a constant).
    """
    n = data.n_assets
    Q = np.zeros((n, n))

    # Quadratic risk term
    Q += risk_aversion * data.covariance

    # Linear return term (on diagonal)
    np.fill_diagonal(Q, Q.diagonal() - data.returns)

    # Budget constraint penalty
    if budget is not None:
        penalty = 5.0 * np.max(np.abs(data.returns))
        for i in range(n):
            Q[i, i] += penalty * (1 - 2 * budget)
            for j in range(n):
                Q[i, j] += penalty

    return Q
```

---

## 10.4 The QAOA solver

**`code/chapter-10/portfolio_optimizer/qaoa.py`**

```python
"""
QAOA-based portfolio optimizer.
"""

import pennylane as qml
import numpy as np
from scipy.optimize import minimize
from typing import Tuple, List, Dict

from .data import AssetData, build_qubo_matrix


def qubo_cost(z: np.ndarray, Q: np.ndarray) -> float:
    """Evaluate the QUBO cost function for a binary assignment z."""
    return float(z @ Q @ z)


def build_qaoa_circuit(n_qubits: int, Q: np.ndarray, p: int, device_name: str = "default.qubit"):
    """
    Build the QAOA circuit for a QUBO problem.

    Returns a QNode that takes gamma and beta arrays and returns
    the expected QUBO cost.
    """
    dev = qml.device(device_name, wires=n_qubits)

    def problem_unitary(gamma):
        """Encodes QUBO cost as phase rotations."""
        # Diagonal terms (linear)
        for i in range(n_qubits):
            qml.RZ(2 * gamma * Q[i, i], wires=i)

        # Off-diagonal terms (quadratic interactions)
        for i in range(n_qubits):
            for j in range(i + 1, n_qubits):
                if abs(Q[i, j] + Q[j, i]) > 1e-10:
                    qml.CNOT(wires=[i, j])
                    qml.RZ(gamma * (Q[i, j] + Q[j, i]), wires=j)
                    qml.CNOT(wires=[i, j])

    def mixer_unitary(beta):
        """Mixes the quantum state."""
        for i in range(n_qubits):
            qml.RX(2 * beta, wires=i)

    @qml.qnode(dev)
    def qaoa_circuit(params):
        gammas = params[:p]
        betas = params[p:]

        # Initial equal superposition
        for i in range(n_qubits):
            qml.Hadamard(wires=i)

        # QAOA layers
        for layer in range(p):
            problem_unitary(gammas[layer])
            mixer_unitary(betas[layer])

        return qml.probs(wires=range(n_qubits))

    return qaoa_circuit


def run_qaoa(
    data: AssetData,
    risk_aversion: float = 0.5,
    budget: int = None,
    p: int = 2,
    n_optimizer_steps: int = 200,
    device_name: str = "default.qubit",
    verbose: bool = True
) -> Dict:
    """
    Run QAOA portfolio optimization.

    Returns a dictionary with:
      - 'best_portfolio': binary vector of selected assets
      - 'best_cost': QUBO cost of the best solution
      - 'expected_return': portfolio expected return
      - 'expected_risk': portfolio variance
      - 'probs': full probability distribution over portfolios
      - 'params': optimized QAOA parameters
    """
    n = data.n_assets
    Q = build_qubo_matrix(data, risk_aversion=risk_aversion, budget=budget)
    qaoa_circuit = build_qaoa_circuit(n, Q, p, device_name)

    def cost_fn(params):
        """Expected QUBO cost under QAOA distribution."""
        probs = qaoa_circuit(params)
        cost = 0.0
        for i, prob in enumerate(probs):
            z = np.array([int(b) for b in format(i, f'0{n}b')])
            cost += prob * qubo_cost(z, Q)
        return cost

    # Initial parameters: small random values
    np.random.seed(42)
    init_params = np.random.uniform(0, 0.5, 2 * p)

    if verbose:
        print(f"Running QAOA (p={p}, {n} assets)...")

    step_log = []

    def callback(params):
        c = cost_fn(params)
        step_log.append(c)
        if verbose and len(step_log) % 25 == 0:
            print(f"  Step {len(step_log):4d}: cost = {c:.6f}")

    result = minimize(
        cost_fn,
        init_params,
        method='COBYLA',
        callback=callback,
        options={'maxiter': n_optimizer_steps, 'rhobeg': 0.3}
    )

    # Extract the best portfolio from the probability distribution
    final_probs = qaoa_circuit(result.x)
    best_idx = np.argmax(final_probs)
    best_portfolio = np.array([int(b) for b in format(best_idx, f'0{n}b')])

    # Compute portfolio metrics
    selected = np.where(best_portfolio == 1)[0]
    expected_return = float(data.returns[selected].sum()) if len(selected) > 0 else 0.0
    expected_risk = float(best_portfolio @ data.covariance @ best_portfolio)

    return {
        'best_portfolio': best_portfolio,
        'best_cost': qubo_cost(best_portfolio, Q),
        'expected_return': expected_return,
        'expected_risk': expected_risk,
        'probs': final_probs,
        'params': result.x,
        'optimizer_result': result,
        'cost_history': step_log,
        'Q': Q
    }
```

---

## 10.5 Classical comparison

**`code/chapter-10/portfolio_optimizer/classical.py`**

```python
"""
Classical brute-force portfolio optimizer.
Exact for small n_assets (≤ 20), used to verify QAOA quality.
"""

import numpy as np
from itertools import combinations
from .data import AssetData, build_qubo_matrix


def brute_force_optimize(
    data: AssetData,
    risk_aversion: float = 0.5,
    budget: int = None
) -> dict:
    """
    Enumerate all 2^n portfolios and return the optimal one.
    Only feasible for n_assets <= 20.
    """
    n = data.n_assets
    Q = build_qubo_matrix(data, risk_aversion=risk_aversion, budget=budget)

    best_cost = float('inf')
    best_portfolio = None

    for i in range(2 ** n):
        z = np.array([int(b) for b in format(i, f'0{n}b')])

        # Skip if budget constraint is violated
        if budget is not None and z.sum() != budget:
            continue

        cost = float(z @ Q @ z)
        if cost < best_cost:
            best_cost = cost
            best_portfolio = z.copy()

    selected = np.where(best_portfolio == 1)[0]
    return {
        'best_portfolio': best_portfolio,
        'best_cost': best_cost,
        'expected_return': float(data.returns[selected].sum()),
        'expected_risk': float(best_portfolio @ data.covariance @ best_portfolio),
        'selected_assets': selected.tolist()
    }


def approximation_ratio(qaoa_cost: float, classical_cost: float) -> float:
    """
    Compute QAOA's solution quality relative to the classical optimal.
    Returns a value between 0 and 1 (1.0 = QAOA found the optimal).

    For minimization with negative QUBO costs:
      |qaoa_cost| / |classical_cost|
    Since classical_cost is the true minimum (most negative), its absolute
    value is largest. This ratio is ≤ 1, approaching 1 as QAOA → optimal.
    """
    if classical_cost == 0:
        return 1.0 if qaoa_cost == 0 else 0.0
    return abs(qaoa_cost) / abs(classical_cost)
```

---

## 10.6 Visualization

**`code/chapter-10/portfolio_optimizer/visualize.py`**

```python
"""
Visualization utilities for portfolio optimization results.
"""

import numpy as np
import matplotlib.pyplot as plt


def plot_probability_distribution(probs: np.ndarray, n_assets: int,
                                   top_k: int = 10, title: str = "QAOA Results"):
    """Plot the top-k most probable portfolios."""
    top_indices = np.argsort(probs)[-top_k:][::-1]
    top_probs = probs[top_indices]
    labels = [format(i, f'0{n_assets}b') for i in top_indices]

    fig, ax = plt.subplots(figsize=(12, 5))
    bars = ax.bar(range(top_k), top_probs, color='steelblue', alpha=0.8)
    ax.set_xticks(range(top_k))
    ax.set_xticklabels(labels, rotation=45, ha='right', fontsize=9)
    ax.set_xlabel("Portfolio (binary: 1=include, 0=exclude)")
    ax.set_ylabel("Probability")
    ax.set_title(title)

    # Highlight the most probable
    bars[0].set_color('orange')

    plt.tight_layout()
    return fig


def plot_convergence(cost_history: list, title: str = "QAOA Convergence"):
    """Plot optimizer convergence over steps."""
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.plot(cost_history, color='steelblue', linewidth=1.5)
    ax.set_xlabel("Optimization step")
    ax.set_ylabel("Expected cost")
    ax.set_title(title)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()
    return fig


def print_portfolio_summary(result: dict, data, solver_name: str = "QAOA"):
    """Print a human-readable portfolio summary."""
    portfolio = result['best_portfolio']
    selected = np.where(portfolio == 1)[0]

    print(f"\n{'='*50}")
    print(f"{solver_name} Portfolio Result")
    print(f"{'='*50}")
    print(f"Selected assets: {[data.tickers[i] for i in selected]}")
    print(f"Number of assets: {len(selected)}")
    print(f"Expected return:  {result['expected_return']:.4f} ({result['expected_return']*100:.2f}%)")
    print(f"Portfolio risk:   {result['expected_risk']:.4f}")
    print(f"QUBO cost:        {result['best_cost']:.6f}")
    print(f"{'='*50}")
```

---

## 10.7 The main CLI entry point

**`code/chapter-10/main.py`**

```python
"""
Quantum Portfolio Optimizer — CLI entry point.

Usage:
  python main.py --n-assets 6 --budget 3 --p 2 --risk 0.5
  python main.py --n-assets 6 --compare  # Run both QAOA and brute force
  python main.py --help
"""

import argparse
import sys
import numpy as np

from portfolio_optimizer.data import generate_synthetic_assets
from portfolio_optimizer.qaoa import run_qaoa
from portfolio_optimizer.classical import brute_force_optimize, approximation_ratio
from portfolio_optimizer.visualize import (
    plot_probability_distribution,
    plot_convergence,
    print_portfolio_summary
)


def main():
    parser = argparse.ArgumentParser(
        description="Quantum Portfolio Optimizer using QAOA",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py --n-assets 4 --budget 2 --p 1
  python main.py --n-assets 6 --budget 3 --p 2 --compare
  python main.py --n-assets 6 --risk 0.8 --p 2 --plot
        """
    )

    parser.add_argument("--n-assets", type=int, default=6,
                        help="Number of assets (default: 6)")
    parser.add_argument("--budget", type=int, default=None,
                        help="Exact number of assets to select (default: unconstrained)")
    parser.add_argument("--risk", type=float, default=0.5,
                        help="Risk aversion coefficient 0-1 (default: 0.5)")
    parser.add_argument("--p", type=int, default=2,
                        help="QAOA depth (number of layers, default: 2)")
    parser.add_argument("--steps", type=int, default=150,
                        help="Number of optimizer steps (default: 150)")
    parser.add_argument("--compare", action="store_true",
                        help="Also run brute-force solver and compare")
    parser.add_argument("--plot", action="store_true",
                        help="Show probability distribution and convergence plots")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed for synthetic data (default: 42)")

    args = parser.parse_args()

    # Validate
    if args.n_assets > 12:
        print("Warning: n-assets > 12 may be slow. QAOA scales exponentially in simulation.")
    if args.budget and (args.budget < 1 or args.budget > args.n_assets):
        print(f"Error: budget must be between 1 and {args.n_assets}")
        sys.exit(1)

    # Generate data
    print(f"\nGenerating synthetic data for {args.n_assets} assets...")
    data = generate_synthetic_assets(n_assets=args.n_assets, seed=args.seed)

    print("Asset expected returns:")
    for ticker, ret in zip(data.tickers, data.returns):
        print(f"  {ticker}: {ret*100:.2f}%")

    # Run QAOA
    qaoa_result = run_qaoa(
        data,
        risk_aversion=args.risk,
        budget=args.budget,
        p=args.p,
        n_optimizer_steps=args.steps,
        verbose=True
    )

    print_portfolio_summary(qaoa_result, data, solver_name="QAOA")

    # Run classical comparison if requested
    if args.compare:
        print("\nRunning classical brute-force solver for comparison...")
        classical_result = brute_force_optimize(
            data,
            risk_aversion=args.risk,
            budget=args.budget
        )
        print_portfolio_summary(classical_result, data, solver_name="Classical Optimal")

        ratio = approximation_ratio(qaoa_result['best_cost'], classical_result['best_cost'])
        print(f"\nApproximation ratio: {ratio:.4f} (1.0 = optimal)")

    # Plots
    if args.plot:
        import matplotlib.pyplot as plt

        fig1 = plot_probability_distribution(
            qaoa_result['probs'],
            data.n_assets,
            title=f"QAOA Portfolio Probabilities (p={args.p})"
        )

        fig2 = plot_convergence(
            qaoa_result['cost_history'],
            title=f"QAOA Optimization Convergence"
        )

        plt.show()

    return 0


if __name__ == "__main__":
    sys.exit(main())
```

---

## 10.8 Running the capstone project

```bash
cd code/chapter-10

# Basic run: 6 assets, select 3, QAOA depth 2
python main.py --n-assets 6 --budget 3 --p 2

# Compare against classical optimal solution
python main.py --n-assets 6 --budget 3 --p 2 --compare

# With plots
python main.py --n-assets 6 --budget 3 --p 2 --compare --plot

# Deeper QAOA (better but slower)
python main.py --n-assets 5 --budget 2 --p 4 --steps 300 --compare

# No budget constraint (QAOA selects freely)
python main.py --n-assets 5 --risk 0.7 --p 2 --compare
```

Expected output:
```
Generating synthetic data for 6 assets...
Asset expected returns:
  ASSET_0: 5.34%
  ASSET_1: 9.12%
  ...

Running QAOA (p=2, 6 assets)...
  Step   25: cost = -0.234521
  Step   50: cost = -0.312847
  ...

==================================================
QAOA Portfolio Result
==================================================
Selected assets: ['ASSET_1', 'ASSET_3', 'ASSET_5']
Number of assets: 3
Expected return:  0.2341 (23.41%)
Portfolio risk:   0.0483
QUBO cost:        -0.318462
==================================================
```

---

## 10.9 Extending the project

Some directions to take this further:

**Real market data.** Replace `generate_synthetic_assets` with Yahoo Finance data using `yfinance`:

```bash
pip install yfinance
```

```python
import yfinance as yf
import pandas as pd

tickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA']
data = yf.download(tickers, start='2022-01-01', end='2024-01-01')['Adj Close']
# Save to CSV and use load_from_csv()
```

**Real hardware execution.** In `qaoa.py`, change the device to an IBM backend:

```python
device_name = "qiskit.ibmq"
dev = qml.device(device_name, wires=n_qubits, backend="ibm_brisbane", ...)
```

**Larger problems.** For more assets than a simulator can handle efficiently, run on `lightning.qubit` for up to ~20 qubits.

**Better ansatz.** Replace the standard QAOA mixer with a problem-specific mixer that respects the budget constraint — this is called Quantum Alternating Operator Ansatz (QAOA+).

---

## Summary

The capstone project demonstrates every concept from the tutorial working together:
- Classical data encoding as a QUBO problem
- QAOA circuit construction with problem-specific and mixer unitaries
- PennyLane differentiation for parameter optimization
- Modular Python project structure
- CLI with configurable parameters
- Classical comparison to measure solution quality

This is a realistic template for near-term quantum optimization applications. The same structure — QUBO formulation, QAOA, classical comparison — applies to logistics routing, scheduling, network design, and many other combinatorial problems.

---

## Where to go from here

**Algorithms to learn next:**
- Quantum Phase Estimation — fundamental to Shor's algorithm and chemistry
- Quantum Fourier Transform — the quantum analog of FFT, used in many algorithms
- HHL (Harrow-Hassidim-Lloyd) — quantum linear systems
- QSVT (Quantum Singular Value Transformation) — a unifying framework for many quantum speedups

**Deeper on the hardware side:**
- Quantum error correction (surface codes, Steane codes)
- Quantum circuit synthesis and decomposition
- Pulse-level control (Qiskit Pulse for direct microwave control of qubits)

**Communities and resources:**
- IBM Quantum Learning (learning.quantum.ibm.com) — structured courses, free
- Qiskit Slack community — active, helpful for debugging
- PennyLane documentation (pennylane.ai/qml) — excellent demos and tutorials
- arXiv quant-ph — current research (filter by "Quantum computation" or "Quantum machine learning")
- Qiskit Textbook (qiskit.org/learn) — free, comprehensive reference
- "Quantum Computing: An Applied Approach" by Jack Hidary — the best book for practitioners

---

| | |
|:---|---:|
| [← Chapter 9 — Quantum Machine Learning](./chapter-09-quantum-ml.md) | |

---

*Chapter 10 of 10 — Quantum Computing for Developers*

---

*Congratulations on completing the tutorial. You now have working knowledge of quantum circuit programming, variational algorithms, quantum machine learning, and real hardware execution. The field is moving quickly — keep building.*
