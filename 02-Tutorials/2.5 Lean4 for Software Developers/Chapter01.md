# Chapter 1: What is Lean4?

**Source file:** `source/Ch01_Intro.lean`

---

## 1.1 The Two Lives of Lean4

Lean4 is a programming language and a **proof assistant** built by Microsoft Research and the Lean4 community. As a programming language it is fast and functional. But its most important use — and the focus of this tutorial — is as a **theorem prover**: a system that lets you write mathematical statements and then mechanically verify that your proofs of those statements are correct.

Why does this matter for software developers? Because a running test suite tells you that your code worked for the inputs you thought to test. A proof tells you it works for **every possible input, forever**. This is a qualitatively different guarantee.

This tutorial does not teach Lean4 as a general-purpose programming language. It teaches you to use Lean4 as a tool for:

- Stating precise specifications of what your code must do
- Writing formal proofs that your implementations satisfy those specs
- Encoding invariants directly into types so the compiler enforces them

---

## 1.2 The Central Idea: Proofs are Programs

The foundation of Lean4's logic is a deep mathematical equivalence called the **Curry-Howard correspondence**. The short version is:

> A **type** is a **proposition**. A **value** of that type is a **proof** of that proposition.

You already understand this intuitively in programming. The type `Bool` describes something that can be `true` or `false`. In Lean4, the type `1 + 1 = 2` describes a *proposition* — and "having a value of that type" means "having proved the proposition". When you write a function that returns a value of type `1 + 1 = 2`, you have constructed a proof.

This means Lean4's type checker **is** the proof verifier. When your code compiles, your proofs are correct.

---

## 1.3 Code Walkthrough

### [L1.1] Exploring types with `#check`

```lean
#check Nat        -- Nat : Type
#check Bool       -- Bool : Type
#check String     -- String : Type
```

`#check` is a command that prints the type of any expression. In VS Code with the Lean4 extension, the result appears in the **Lean Infoview** panel (usually on the right). You use `#check` constantly while exploring Lean4 — it is your compass.

`Nat`, `Bool`, `String` are all **types** — categories of values. `Nat` is the type of natural numbers (0, 1, 2, 3, …). Notice we are not writing code that runs; we are making queries to the type system.

---

### [L1.2] Propositions are also types

```lean
#check (1 + 1 = 2)   -- 1 + 1 = 2 : Prop
#check True           -- True : Prop
#check False          -- False : Prop
```

Here `Prop` (short for *Proposition*) is the type of logical statements. Just as `Nat` is the type of numbers, `Prop` is the type of claims that could be true or false. The statement `1 + 1 = 2` has type `Prop`. So does `True` (a proposition that is always true) and `False` (a proposition that is never true — it has no proof).

The crucial shift from everyday programming: **propositions are data** that you can pass around, return from functions, and prove.

---

### [L1.3] A proof is a value

```lean
theorem L1_3_one_plus_one : 1 + 1 = 2 := by rfl
```

This is your first theorem. Let's read it left to right:

- `theorem` — declares we are writing a proof
- `L1_3_one_plus_one` — the name we give this proof (so we can reuse it later)
- `: 1 + 1 = 2` — the proposition we are proving (the type)
- `:= by rfl` — the proof itself

`by` switches into **tactic mode** — a step-by-step proof style we cover in full in Chapter 4. For now, read `by rfl` as "prove this by checking both sides are equal." `rfl` (short for *reflexivity*) is a tactic that proves any goal of the form `a = b` when `a` and `b` reduce to the same expression. Since `1 + 1` evaluates to `2`, both sides are identical, and `rfl` closes the goal.

---

### [L1.4] More reflexivity

```lean
theorem L1_4_simple_arithmetic : 10 * 10 = 100 := by rfl
```

`10 * 10` reduces to `100` by the definition of multiplication, so `rfl` works here too. Lean4 does this computation at **compile time** — no special numeric solver needed.

---

### [L1.5] Proving True

```lean
theorem L1_5_truth_is_provable : True := trivial
```

`True` is a built-in proposition that is always provable. `trivial` is a tactic (or term) that closes any goal that is obviously true, including `True` and goals that follow directly from the definitions.

---

### [L1.6] Total functions

```lean
def L1_6_add (a b : Nat) : Nat := a + b
```

This defines a function `L1_6_add` that takes two natural numbers and returns a natural number. In Lean4, **all functions are total**: they must terminate and return a value for every possible input. This is enforced by the compiler.

This is different from most programming languages, where you can write infinite loops or functions that throw exceptions for some inputs. In Lean4, the type signature `Nat → Nat → Nat` is a **guarantee** that the function always halts and returns a natural number.

---

### [L1.7] Proving a property of our function

```lean
theorem L1_7_add_commutes (a b : Nat) : L1_6_add a b = L1_6_add b a := by
  simp [L1_6_add]
  omega
```

Here we state and prove that `L1_6_add` is commutative. The proof has two steps:

1. `simp [L1_6_add]` — unfolds the definition of `L1_6_add`, replacing `L1_6_add a b` with `a + b`
2. `omega` — an automatic solver for linear arithmetic over natural numbers and integers. Once the goal is `a + b = b + a`, omega handles it in one step.

This is the core workflow: write a function, state a property, prove it.

---

### [L1.8] Universal quantification

```lean
theorem L1_8_forall_example : ∀ n : Nat, n + 0 = n := by
  intro n
  omega
```

The `∀` symbol (type it as `\forall`) means "for all". This theorem says: "for every natural number `n`, `n + 0 = n`." We will see more logical connectives — `∧` (and), `∨` (or), `¬` (not), `→` (implies) — in Chapter 3 when we cover propositions in depth.

The proof: `intro n` moves the universally quantified `n` into the local context. Then `omega` proves `n + 0 = n` automatically. A unit test checks this for a handful of values; this theorem covers every natural number.

---

### [L1.9] Existential statements

```lean
theorem L1_9_exists_example : ∃ n : Nat, n > 100 := by
  exact ⟨101, by omega⟩
```

The `∃` symbol (type it as `\exists`) means "there exists". This theorem says "there exists a natural number greater than 100."

To prove an existential, you **provide a witness** — a specific value that satisfies the condition. Here, `101` is the witness, and `by omega` proves `101 > 100`. The angle brackets `⟨101, by omega⟩` pack the witness and its proof together.

---

### [L1.10] Types as specifications

```lean
def L1_10_safe_divide (n : Nat) (d : Nat) (h : d ≠ 0) : Nat := n / d
```

Ordinary division-by-zero is a runtime error that tests might not catch. Here, we encode the requirement `d ≠ 0` directly into the **type signature** as a third argument `h`.

Any caller of `L1_10_safe_divide` must supply a proof that `d` is not zero. The type checker enforces this at **compile time** — it is literally impossible to call this function with a zero divisor.

---

### [L1.11] Inspecting the full signature

```lean
#check @L1_10_safe_divide
-- L1_10_safe_divide : (n : Nat) → (d : Nat) → d ≠ 0 → Nat
```

The `@` makes all implicit arguments explicit, so you see the full signature. Notice the third argument `d ≠ 0` is part of the type. The type **is** the contract.

---

### [L1.12] A theorem about our function

```lean
theorem L1_12_divide_le (n d : Nat) (_h : d ≠ 0) :
    L1_10_safe_divide n d _h ≤ n := by
  simp [L1_10_safe_divide]
  exact Nat.div_le_self n d
```

This proves that safe division always returns a value no larger than the numerator. The proof:

1. `simp [L1_10_safe_divide]` — unfolds the function definition
2. `exact Nat.div_le_self n d` — applies a theorem from Lean4's core library that `n / d ≤ n` for all natural numbers

`Nat.div_le_self` is already in the library; we just use it. The next chapter walks through setting up your environment so you can start writing proofs interactively.

---

### What does a failed proof look like?

```lean
-- This FAILS:
-- theorem L1_bad : 1 + 1 = 3 := by rfl
-- Error: type mismatch
--   rfl : 1 + 1 = 1 + 1
-- expected type
--   1 + 1 = 3
```

Lean4 tells you exactly what went wrong: `rfl` proved `1 + 1 = 1 + 1` (reflexivity always produces `a = a`), but the goal is `1 + 1 = 3`. The two sides do not reduce to the same value.

In VS Code, this appears as a red squiggle on the `rfl` token, and the Infoview shows the type mismatch. Learning to read these error messages is as important as learning to write proofs.

---

## Exercises

1. **Types as propositions:** What is the type of `True`? Of `False`? Of `1 + 1 = 3`? Use `#check` to find out. Which of these have proofs? Try `#check True.intro` — what does it say? Then try writing `example : 1 + 1 = 3 := by decide` — what error do you get?

2. **Your first theorem:** Write a theorem named `my_first` that proves `2 + 2 = 4` using `rfl`. Then write a second theorem `my_second` that proves `10 * 10 = 100`. Which tactics work here: `rfl`, `decide`, or `norm_num`? Try all three and observe the difference.

3. **Failing on purpose:** Try writing `theorem will_fail : 1 + 1 = 3 := by rfl`. What error does Lean4 produce in the Infoview? Understand what "type mismatch" means in this context before moving on.
