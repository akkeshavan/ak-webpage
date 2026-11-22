# Chapter 2: Setting Up Your Development Environment

**Estimated time:** 45 minutes
**Code directory:** `code/chapter-02/`

---

## What this chapter covers

Getting your environment right is the most friction-heavy part of quantum development. Unlike a typical Python project, you're dealing with multiple SDKs, cloud accounts, API tokens, and both local simulators and remote hardware. This chapter walks through every step so you end up with a working setup you can trust.

By the end you'll have Qiskit and PennyLane installed, an IBM Quantum account with real hardware access, and three test scripts that verify everything is connected properly.

---

## 2.1 Python version and virtual environment

Check your Python version first:

```bash
python3 --version
```

You need **3.10 or higher**. Qiskit and PennyLane track recent Python releases closely, so any version from 3.10 onward should work. If you're installing Python fresh, pick the latest stable 3.x release.

If you need to update:
- **macOS:** `brew install python@3.11` (easiest path if you have Homebrew)
- **Ubuntu/Debian:** `sudo apt install python3.11 python3.11-venv`
- **Windows:** Download the installer from python.org — make sure to check "Add Python to PATH" during installation, or you'll spend an annoying hour debugging why `python3` isn't found

Virtual environments are non-negotiable here. Quantum SDKs have specific dependency trees and they will conflict with other packages in your system Python. Create a dedicated environment:

```bash
mkdir ~/quantum-dev
cd ~/quantum-dev
python3 -m venv qenv
```

Activate it:

```bash
# macOS and Linux
source qenv/bin/activate

# Windows PowerShell
qenv\Scripts\Activate.ps1

# Windows Command Prompt
qenv\Scripts\activate.bat
```

Your prompt should now show `(qenv)` at the start. Every install command in this tutorial assumes this environment is active. If you open a new terminal, activate it again before running anything.

Upgrade pip while you're at it:

```bash
pip install --upgrade pip
```

---

## 2.2 Installing Qiskit

Qiskit is split into modular packages. Here's what each one does and why you need it:

```bash
pip install qiskit qiskit-ibm-runtime qiskit-aer matplotlib pylatexenc
```

- `qiskit` — the core. Circuit construction, transpiler, gates, everything fundamental
- `qiskit-ibm-runtime` — the connector to IBM's cloud. Without this you can't touch real hardware
- `qiskit-aer` — a high-performance local simulator. This is what you'll use 90% of the time during development because it's instant and free
- `matplotlib` and `pylatexenc` — needed for circuit diagrams and visualizations. Optional, but you'll want them

Verify the install:

```bash
python3 -c "import qiskit; print(qiskit.__version__)"
```

You should see a version number printed. If you see an import error, make sure your virtual environment is active — it's the most common mistake at this stage.

---

## 2.3 Installing PennyLane

```bash
pip install pennylane pennylane-qiskit
```

`pennylane` is the core framework. `pennylane-qiskit` is the plugin that lets PennyLane circuits run on Qiskit backends — including IBM's real hardware. You'll use this later when you want to run PennyLane code on actual quantum computers.

If you plan to do the quantum ML chapters (Chapter 9), install the extras now:

```bash
pip install pennylane[torch]
```

This pulls in PyTorch integration. If you're a TensorFlow person, use `pennylane[tf]` instead. Either works for the tutorial.

Verify:

```bash
python3 -c "import pennylane as qml; print(qml.__version__)"
```

---

## 2.4 Other libraries you'll need

```bash
pip install numpy scipy sympy jupyter notebook scikit-learn networkx
```

NumPy shows up everywhere in quantum code — state vectors are arrays, probability distributions are arrays. SciPy provides the classical optimization routines that variational algorithms like VQE depend on. Sympy is useful when you want to work with symbolic expressions rather than numerical ones. Jupyter is optional but recommended for the chapters that involve circuit visualization, since Qiskit renders circuit diagrams inline in notebooks beautifully. scikit-learn is used in Chapter 9 for the quantum ML classifier. networkx is used in Chapter 7 for graph visualization in the QAOA example (optional but recommended).

---

## 2.5 Creating your IBM Quantum account

IBM gives free access to real quantum hardware. The free tier is genuinely usable — you get access to several quantum processors with queued job submission. Here's the full account setup.

### Register

Go to **quantum.ibm.com** and click "Sign in", then "Create an IBMid". You'll need to provide your name, email, and a password. After submitting, check your inbox for a verification email and click the confirmation link.

Once you're logged in, IBM will ask you to set up your profile. Pick "Independent Developer" or "Student" for institution type — it doesn't affect your access. Accept the Terms of Service.

### Get your API token

1. Click your profile avatar in the top-right corner
2. Click "Account settings"
3. Scroll down to the "API token" section
4. Click "Generate new token" (or "Copy" if one already exists)
5. Copy it immediately — IBM only shows the full token once

The token is a long alphanumeric string. Treat it like a password. Don't put it in code you're committing to Git, don't share it, and don't post it anywhere public.

### Save the token using ibm_init.py

Rather than pasting your token directly into Python code — which risks accidentally committing it to Git — the tutorial provides `ibm_init.py`. This script reads the token from an environment variable and saves it to disk. Here's the full script so you can see exactly what it does:

```python
# code/chapter-02/ibm_init.py

import os
import sys
from qiskit_ibm_runtime import QiskitRuntimeService

TOKEN_ENV_VAR = "IBM_QUANTUM_TOKEN"

token = os.environ.get(TOKEN_ENV_VAR)

if not token:
    print(f"Error: {TOKEN_ENV_VAR} is not set in your environment.")
    print()
    print("Set it first, then re-run this script:")
    print()
    print("  macOS / Linux:")
    print(f'    export {TOKEN_ENV_VAR}="your_token_here"')
    print()
    print("  Windows PowerShell:")
    print(f'    $env:{TOKEN_ENV_VAR} = "your_token_here"')
    sys.exit(1)

if len(token.strip()) < 20:
    print("Error: token looks too short — it may have been copied incorrectly.")
    sys.exit(1)

print("Saving IBM Quantum credentials...")

try:
    QiskitRuntimeService.save_account(
        channel="ibm_quantum_platform",
        token=token.strip(),
        overwrite=True,
    )
except Exception as e:
    print(f"Failed to save credentials: {e}")
    sys.exit(1)

print("Done. Credentials saved to ~/.qiskit/qiskit-ibm.json")
print()
print("Next step: python ibm_connection_test.py")
```

Note the channel name: `ibm_quantum_platform`. IBM renamed this from the older `ibm_quantum` value in their 2024 SDK update. If you see an error saying `"Invalid channel value"`, this is why — make sure you're using the current name.

To run it, first set the environment variable in your terminal:

```bash
# macOS / Linux
export IBM_QUANTUM_TOKEN="your_token_here"

# Windows PowerShell
$env:IBM_QUANTUM_TOKEN = "your_token_here"

# Windows Command Prompt
set IBM_QUANTUM_TOKEN=your_token_here
```

To make this permanent, add the `export` line to your shell profile (`~/.zshrc` or `~/.bashrc`) so it's set automatically in every new terminal.

Then run the script:

```bash
cd code/chapter-02
python ibm_init.py
```

Expected output:
```
Saving IBM Quantum credentials...
Done. Credentials saved to ~/.qiskit/qiskit-ibm.json

Next step: python ibm_connection_test.py
```

The token is now stored in `~/.qiskit/qiskit-ibm.json`. Every script in the tutorial loads credentials from there automatically — no token handling in any of the code.

---

## 2.6 Verifying your IBM connection

Once `ibm_init.py` has run successfully, test the connection with:

```bash
python ibm_connection_test.py
```

This connects using the saved credentials, lists every backend on your account, and identifies the least busy system. Expected output looks something like:

```
Connecting to IBM Quantum...
Connected successfully.

Available backends:
-----------------------------------------------------------------
  ibm_brisbane                        qubits=127   queue=4     operational
  ibm_kyoto                           qubits=127   queue=12    operational
  ibm_osaka                           qubits=127   queue=2     operational
  ...
-----------------------------------------------------------------
Total backends available: 7

Least busy backend right now:
  ibm_osaka (127 qubits)
  Use this when submitting jobs to minimise queue time.

IBM connection test passed.
```

The exact backend names change as IBM upgrades their fleet. Systems with 127+ qubits are IBM Eagle or Heron processors. If you get an authentication error, re-run `ibm_init.py` — the most likely cause is the token being set incorrectly in the environment.

---

## 2.7 IBM's free tier — what you actually get

The Open (free) plan gives you:
- Access to a subset of IBM quantum systems — typically 5 to 7 of their processors
- Jobs run in a shared queue. Wait times vary from a few minutes to a few hours depending on system load
- Each job can run multiple circuits in a single submission
- The local Aer simulator has no limits at all — you can run as many jobs as you want instantly

For development, you'll almost exclusively use the local Aer simulator. Real hardware is reserved for the chapters that specifically discuss it, and for your final project. The queue wait is the main friction point with real hardware access on the free tier.

---

## 2.8 Why the environment variable approach

Setting `IBM_QUANTUM_TOKEN` in the environment and reading it via `ibm_init.py` is the correct way to handle credentials. Here's why it matters:

**Never paste your token into a Python file.** It's easy to do this once "just for testing," commit the file, push to GitHub, and spend the next hour rotating credentials after realising what you've done. Environment variables stay out of your code entirely.

**The `~/.qiskit/qiskit-ibm.json` file** is where Qiskit stores the saved credentials on disk. Once `ibm_init.py` writes it, all subsequent scripts load from there automatically — no token handling in any code. This file lives outside your project directory, so it won't be accidentally committed.

**For CI/CD pipelines or shared machines**, inject `IBM_QUANTUM_TOKEN` as a secret environment variable through your platform (GitHub Actions secrets, GitLab CI variables, etc.) and run `ibm_init.py` as a setup step.

**If you use a `.env` file** for local development rather than exporting directly:

```bash
pip install python-dotenv
```

Create `.env` in the project root (never commit this file):

```
IBM_QUANTUM_TOKEN=your_token_here
```

Then load it before running `ibm_init.py`:

```bash
# Load .env variables into the current shell, then run init
export $(cat .env | xargs) && python ibm_init.py
```

Or use the dotenv library directly in any script that needs it:

```python
from dotenv import load_dotenv
load_dotenv()   # Loads .env into os.environ before anything else reads it
```

The tutorial repository already includes a `.gitignore` that covers `.env`, `qenv/`, `__pycache__/`, and other files that should never be committed. You don't need to add anything — just don't override it.

---

## 2.9 PennyLane devices — how the framework thinks about backends

PennyLane uses the concept of a **device**. A device is just a backend — it could be a local simulator, a cloud simulator, or real hardware. You specify a device when you define a quantum function, and PennyLane handles the rest.

The main local devices you'll use:

- `default.qubit` — PennyLane's built-in statevector simulator. Exact results, no noise. Good for everything up to about 20 qubits before it gets slow
- `lightning.qubit` — a C++-backed version of the same. Significantly faster for larger circuits
- `default.mixed` — simulates noisy circuits using density matrices

No account is needed for any of these. They run locally, instantly, and are free. For the PennyLane chapters, you'll use `default.qubit` unless specified otherwise.

Chapter 8 uses Qiskit's native runtime (not PennyLane) to submit jobs to IBM hardware — that's intentional, since Qiskit gives you the most direct control over transpilation and noise models. If you later want to run PennyLane circuits on IBM hardware, the `qiskit.ibmq` device in `pennylane-qiskit` makes that a one-line change, as shown in the Chapter 6 device section.

---

## 2.10 Recommended editor setup

Any Python IDE works. A few notes:

**VS Code** is the most popular choice here. Install the Python extension and the Jupyter extension. The Jupyter extension lets you run `.ipynb` notebooks inside VS Code and renders Qiskit's circuit diagrams inline.

**Jupyter Lab** is worth having even if you prefer VS Code. Run `jupyter lab` from your quantum-dev directory and you get an interactive environment where you can iterate on circuits quickly. Qiskit's `qc.draw('mpl')` renders as an image inline, which is genuinely useful when you're learning circuit structure.

**PyCharm** works fine. Scientific mode gives you variable inspector support which helps with numpy arrays.

To test circuit visualization in Jupyter, create a notebook and run:

```python
from qiskit import QuantumCircuit

qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.draw('mpl')
```

If you see a circuit diagram rather than an error, your visualization stack is working.

---

## 2.11 Running the verification scripts

There are four scripts in `code/chapter-02/`. They must be run in the order shown below — `ibm_init.py` saves your credentials to disk and **must complete successfully before `ibm_connection_test.py` will work**.

```bash
cd code/chapter-02
```

**Step 1 — Check all packages are installed:**

```bash
python verify_installation.py
```

**Step 2 — Save your IBM credentials (run once):** 

```bash
export IBM_QUANTUM_TOKEN="your_token_here"
python ibm_init.py
```

> On Windows PowerShell use `$env:IBM_QUANTUM_TOKEN = "your_token_here"` instead of `export`.

**Step 3 — Verify the IBM connection:**
> `ibm_init.py` must have run successfully before this step.

```bash
python ibm_connection_test.py
```

**Step 4 — Verify PennyLane (no IBM account needed):**

```bash
python pennylane_test.py
```

All four should exit with no errors. Steps 1, 2, and 4 run entirely locally. Only step 3 makes a network call. If step 3 fails, go back and confirm step 2 printed `"Done. Credentials saved"` without errors.

---

## 2.12 Troubleshooting

**"ModuleNotFoundError: No module named 'qiskit'"**
Your virtual environment isn't active. Run `source qenv/bin/activate`.

**IBM connection fails with AuthenticationError**
Run `ibm_init.py` again — either the token was copied with extra whitespace, or it has expired. Go to quantum.ibm.com → Account Settings, regenerate the token, update your `IBM_QUANTUM_TOKEN` environment variable, and re-run `python ibm_init.py`.

**"No backends available" from IBM**
New IBM accounts sometimes take a few minutes to activate after email verification. Log into quantum.ibm.com in your browser and check if you can see systems listed there. If you can see them in the browser but not in Python, try `service.backends(min_num_qubits=5)` — querying with filters sometimes bypasses a caching issue.

**Matplotlib shows nothing or errors out**
On macOS outside of Jupyter: `pip install pyqt5`. On Linux: `pip install tk`. In Jupyter: `pip install ipympl` and add `%matplotlib inline` at the top of your notebook.

**PennyLane version conflict after installing pennylane-qiskit**
`pip install --upgrade pennylane pennylane-qiskit` — the plugin version needs to match the core version.

---

## Summary

At this point you should have a working environment with:
- Python 3.10+ in a clean virtual environment
- Qiskit, qiskit-ibm-runtime, and qiskit-aer installed and verified
- PennyLane and the Qiskit plugin installed
- An IBM Quantum account with `IBM_QUANTUM_TOKEN` set in your environment
- Credentials saved via `python ibm_init.py`
- Successful output from all four verification scripts

If any of that isn't true, don't move on yet. The next chapters assume a working setup and build on it.

---

**Next:** Chapter 3 covers the mathematical foundation — qubits as vectors, gates as matrices, building circuits, and visualizing quantum state. You'll write real circuits in both Qiskit and PennyLane.

---

| | |
|:---|---:|
| [← Chapter 1 — Introduction to Quantum Computing](./chapter-01-introduction.md) | [Chapter 3 — Qubits, Gates, and Circuits →](./chapter-03-qubits-gates-circuits.md) |

---

*Chapter 2 of 10 — Quantum Computing for Developers*
