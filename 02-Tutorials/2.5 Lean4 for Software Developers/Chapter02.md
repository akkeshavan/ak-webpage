# Chapter 2: Setting Up Your Environment

**Source file:** `source/Ch02_Setup.lean`

---

## 2.1 What You Need

To follow this tutorial you need three things:

1. **Lean4** itself (installed via `elan`, the Lean version manager)
2. **Mathlib** (Lean4's mathematical library — a dependency in `lakefile.lean`)
3. **VS Code** with the Lean4 extension (for interactive proof development)

---

## 2.2 Step 1: Install elan and Lean4

`elan` is to Lean4 what `rustup` is to Rust — it manages Lean toolchains and switches between versions.

**macOS / Linux:**
```bash
curl -sSf https://raw.githubusercontent.com/leanprover/elan/main/elan-init.sh | sh
```

**Windows:** Download the installer from [https://github.com/leanprover/elan](https://github.com/leanprover/elan).

After installation, open a new terminal and verify:
```bash
elan --version
lean --version
```

---

## 2.3 Step 2: Create a Lake project

**Lake** is Lean4's build system and package manager (analogous to Cargo for Rust or Gradle for Java).

```bash
# Create the project directory
mkdir lean4-tutorial
cd lean4-tutorial

# Initialize a new Lake project
lake init lean4-tutorial
```

This generates `lakefile.lean`, `lean-toolchain`, and a starter `Main.lean`.

---

## 2.4 Step 3: Add Mathlib as a dependency

**Mathlib** is a community-maintained library containing hundreds of thousands of proved theorems covering number theory, algebra, analysis, topology, and more. For our purposes, it also provides essential *tactics* — proof automation tools like `omega`, `ring`, `simp`, and `norm_num`.

Edit `lakefile.lean` to match the one in this project:

```lean
import Lake
open Lake DSL

package «lean4-tutorial» where

require mathlib from git
  "https://github.com/leanprover-community/mathlib4.git"
```

Then run:
```bash
lake update          # downloads Mathlib and its dependencies
lake build           # compiles everything (takes 5-20 minutes first time)
```

> **Note on the toolchain:** Mathlib pins a specific Lean4 version. After `lake update`, Lake updates your `lean-toolchain` file automatically to the correct version. Always let Lake manage this file.

---

## 2.5 Step 4: Install VS Code and the Lean4 extension

1. Install [VS Code](https://code.visualstudio.com/)
2. Open VS Code, go to Extensions (`Cmd+Shift+X`), search **"lean4"**, install the official extension by `leanprover`
3. Open your project folder in VS Code: `code .`

When you open a `.lean` file, the extension compiles it in the background and shows a **spinning indicator** in the bottom bar. Once it finishes, you get:

- **Red squiggles** on errors
- The **Lean Infoview** panel (open it with `Ctrl+Shift+Enter`) showing the current proof state

Every time you place your cursor inside a `by` block, the Infoview shows you the **current goal** — what remains to be proved — and the **hypotheses** in scope.

---

## 2.6 Code Walkthrough

### [L2.1] Lean4 is running

```lean
#eval "Lean4 is running!"
```

`#eval` evaluates an expression and prints the result. If this produces output in the Infoview, your Lean4 installation works.

---

### [L2.2] Check the Lean version

```lean
#eval Lean.versionString
```

This prints the exact version of Lean4 you are running. Different Lean4 versions can have breaking changes; `lean-toolchain` pins the version so everyone on the team uses the same one.

---

### [L2.3] Verify Mathlib is available

```lean
#check @Nat.add_comm
```

`Nat.add_comm` is a theorem in Mathlib (and Lean4's core library). If `#check` returns its type without error, Mathlib is properly installed.

The `@` makes all implicit arguments explicit. The output is:
```
Nat.add_comm : ∀ (n m : ℕ), n + m = m + n
```

This is the formal statement that addition is commutative for natural numbers.

---

### [L2.4] Use omega end-to-end

```lean
example : ∀ n : Nat, n + 0 = n := by
  intro n
  omega
```

`example` is like `theorem` but anonymous — useful for testing without naming things. This proof uses two tactics in sequence:

1. `intro n` — introduces the universally quantified `n` into scope
2. `omega` — solves linear arithmetic automatically

If this compiles without error, the core tactic infrastructure is working.

---

### [L2.5] decide checks computation

```lean
example : (2 : Nat) ^ 8 = 256 := by decide
```

`decide` is a tactic that evaluates the goal computationally. `2^8 = 256` is a finite computation, so Lean4 just runs it and confirms the answer. If this compiles, Lean4 can execute kernel-level computations.

---

### [L2.6] norm_num for large numbers

```lean
example : (123456789 : Nat) * 2 = 246913578 := by norm_num
```

`norm_num` is Mathlib's numeric normalization tactic. It is much faster than `decide` for large arithmetic because it uses efficient algorithms rather than naive computation. This verifies that Mathlib's arithmetic tactics are loaded.

---

### [L2.7] simp with Mathlib lemmas

```lean
example (l1 l2 : List Nat) :
    (l1 ++ l2).length = l1.length + l2.length := by
  simp [List.length_append]
```

`simp` applies rewriting rules. Here we tell it to use `List.length_append`, a theorem in Mathlib that states exactly this property. This verifies that `simp` and Mathlib list lemmas are available.

---

### [L2.8] Browsing Mathlib with #check

```lean
#check List.length_append
#check Nat.Prime
#check Int.add_comm
```

Use `#check` liberally to explore what Mathlib contains before trying to prove something yourself. These three examples check:

- A list theorem
- The primality predicate
- A theorem about integer addition

If all three produce output without errors, Mathlib's core modules are accessible.

---

### [L2.9] The Infoview in action

```lean
example (p q : Prop) (hp : p) (hq : q) : p ∧ q := by
  constructor      -- goal splits: ⊢ p  and  ⊢ q
  · exact hp       -- closes first subgoal
  · exact hq       -- closes second subgoal
```

Open this file in VS Code and place your cursor on each line inside the `by` block. The Infoview panel shows:

**After `constructor`:**
```
case left
p q : Prop
hp : p
hq : q
⊢ p

case right
p q : Prop
hp : p
hq : q
⊢ q
```

**After `· exact hp`:**
```
case right
p q : Prop
hp : p
hq : q
⊢ q
```

**After `· exact hq`:** the Infoview shows nothing (all goals closed, proof complete).

Learning to read the Infoview fluently is central to working efficiently in Lean4.

---

## 2.7 Project File Reference

| File | Purpose |
|---|---|
| `lakefile.lean` | Declares the project and its dependencies |
| `lean-toolchain` | Pins the exact Lean4 version |
| `source/Ch*.lean` | Tutorial source files (one per chapter) |

---

## 2.8 Common Setup Problems

**"unknown package mathlib"** — Run `lake update` again. Mathlib must be downloaded before it is available.

**VS Code shows all imports as errors** — The extension needs to finish building Mathlib (the spinning indicator). On a first run this can take 10–20 minutes. Watch the progress in the output panel.

**Wrong Lean version** — Delete `lean-toolchain` and run `lake update`. Lake will write the correct version automatically based on Mathlib's requirements.

**Out of memory during build** — Mathlib is large. If the build fails with OOM, close other applications and retry. A machine with 16 GB RAM is comfortable; 8 GB can work with nothing else open.

---

## Exercises

1. **Verify your setup end-to-end:** Open `source/Ch02_Setup.lean` in VS Code. Place your cursor inside the `by omega` block in the `∀ n : Nat, n + 0 = n` example ([L2.4]). The Infoview should show the proof state before `omega` closes the goal. If you see the goal displayed, your setup is complete.

2. **Explore Mathlib:** Use `#check` to find the type of `Nat.sub_add_cancel`. What does it state? Under what condition does it apply? When would you reach for it in a proof?

3. **Broken import:** Add `import Mathlib.Data.Fake.Module` to the top of a test file. What error does Lean4 produce? Notice that the error appears at the import line itself — Lean4 validates imports at compile time, not at the point of use. How does this differ from a Python `ImportError`?
