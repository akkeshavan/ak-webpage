# Chapter 5: Natural Numbers and Induction

**Source file:** `source/Ch05_Naturals.lean`

---

## 5.1 Why Natural Numbers?

Natural numbers are where the power of formal proof becomes most visible. Arithmetic properties that seem obvious — like "addition is commutative" — require actual proof when stated for *all* numbers. And those proofs reveal the underlying structure of how numbers work.

This chapter also introduces **proof by induction**, the fundamental technique for reasoning about recursive structures. If you understand induction in Lean4, you can prove properties of any recursive data type: lists, trees, and more.

---

## 5.2 The Peano Naturals

Lean4 defines natural numbers using **Peano axioms**:

- `Nat.zero` is a natural number
- If `n` is a natural number, then `Nat.succ n` (the *successor* of `n`) is also a natural number
- These are the **only** natural numbers

Every natural number is either zero or the successor of some other natural number. The number `3` is actually `Nat.succ (Nat.succ (Nat.succ Nat.zero))`. The familiar decimal notation is just syntactic sugar.

This recursive definition is why **induction** is the natural proof technique: you prove something for `zero`, and you prove that if it holds for `n` it also holds for `succ n`.

---

## 5.3 Code Walkthrough

### [L5.1] The constructors

```lean
#check Nat.zero    -- Nat.zero : Nat
#check Nat.succ    -- Nat.succ : Nat → Nat
```

`Nat.zero` is the number 0. `Nat.succ` takes a number and returns the next one. These are the two ways to build a natural number.

---

### [L5.2] Numbers are just notation

```lean
example : (3 : Nat) = Nat.succ (Nat.succ (Nat.succ Nat.zero)) := by rfl
```

`3` is notation for the fully-expanded Peano term. `rfl` proves this because Lean4 normalizes both sides to the same representation. Understanding this helps you read induction proofs — the `succ n` in an inductive step really does mean "one more than `n`."

---

### [L5.3] Arithmetic by evaluation

```lean
theorem L5_3_arithmetic : 5 + 7 = 12 := by rfl
```

For concrete numbers, arithmetic reduces by definition. `5 + 7` is defined recursively:

```
5 + 7 = succ(5 + 6) = succ(succ(5 + 5)) = ... = 12
```

After unfolding all the recursive steps, both sides are identical. `rfl` closes it.

---

### [L5.4] Proof by induction: n + 0 = n

```lean
theorem L5_4_add_zero (n : Nat) : n + 0 = n := by
  induction n with
  | zero      => rfl
  | succ n ih => rw [Nat.succ_add, ih]
```

This is a textbook induction proof. Let us walk through each part:

**The induction tactic:** `induction n with | zero => ... | succ n ih => ...` splits the proof into two cases:
- `zero` case: prove the statement with `n = 0`
- `succ n ih` case: prove it for `n + 1`, given that `ih` (the **inductive hypothesis**) says it holds for `n`

**Base case (`zero`):** We need `0 + 0 = 0`. This holds by definition, so `rfl` closes it.

**Inductive step (`succ n ih`):**
- `ih : n + 0 = n` — the inductive hypothesis; we are allowed to assume the property holds for `n`
- Goal: `Nat.succ n + 0 = Nat.succ n`

`Nat.succ_add` is a definitional lemma: `Nat.succ m + k = Nat.succ (m + k)`. `rw [Nat.succ_add]` rewrites the goal to `Nat.succ (n + 0) = Nat.succ n`, and then `rw [ih]` substitutes `n + 0` with `n`, leaving `Nat.succ n = Nat.succ n`, which is closed by definitional equality.

---

### [L5.5] Zero on the left

```lean
theorem L5_5_zero_add (n : Nat) : 0 + n = n := by
  induction n with
  | zero      => rfl
  | succ n ih => rw [Nat.add_succ, ih]
```

This is **not symmetric** with [L5.4]. Addition in Lean4 is defined by recursion on the **left** argument:
```
0 + n = n         (by definition)
(succ k) + n = succ (k + n)
```

So `0 + n = n` requires induction on `n` (the right argument), even though it looks trivial — even "obvious" arithmetic can require induction.

The proof structure is identical to [L5.4] but uses `Nat.add_succ` (the successor rule on the right argument) instead of `Nat.succ_add`.

---

### [L5.6] Associativity

```lean
theorem L5_6_add_assoc (a b c : Nat) : a + (b + c) = (a + b) + c := by
  induction a with
  | zero      => simp
  | succ a ih => rw [Nat.succ_add, Nat.succ_add, Nat.succ_add, ih]
```

Associativity of addition: `a + (b + c) = (a + b) + c`. We induct on `a`:
- **Base case:** `0 + (b + c) = (0 + b) + c`. Both sides simplify to `b + c` via [L5.5]-style reasoning. `simp` handles this.
- **Inductive step:** Assume `a + (b + c) = (a + b) + c` (the hypothesis `ih`). Prove `(a+1) + (b+c) = ((a+1) + b) + c`. `rw [Nat.succ_add]` is applied three times to strip the `succ` off each of the three `+` expressions, reducing the goal to `ih`, which closes it.

---

### [L5.7] When omega is faster

```lean
theorem L5_7_add_comm (a b : Nat) : a + b = b + a := by omega
```

The `omega` tactic is a decision procedure that can prove **any** linear arithmetic fact about `Nat` and `Int` automatically — no manual induction needed. Writing out the full inductive proof of `a + b = b + a` from first principles would take a page. `omega` does it in one line. Use `omega` for arithmetic facts; reach for explicit `induction` only when reasoning about the structure of a recursive **definition** (as in [L5.4]–[L5.6]).

---

### [L5.8] Inequalities

```lean
theorem L5_8_le_add_right (n m : Nat) : n ≤ n + m := by omega
```

For all `m ≥ 0`, `n` is at most `n + m`. This is intuitively obvious and `omega` handles it with no fuss. Note that for natural numbers, `m ≥ 0` is always true — there are no negative naturals — so adding any natural number can only increase or preserve the value.

---

### [L5.9] Transitivity

```lean
theorem L5_9_le_trans (a b c : Nat) (h1 : a ≤ b) (h2 : b ≤ c) : a ≤ c := by
  omega
```

If `a ≤ b` and `b ≤ c`, then `a ≤ c`. Again, `omega` handles this directly from the hypotheses.

Transitivity is a pattern you use constantly when chaining inequalities. In Lean4 proofs, you will accumulate a chain of `≤` facts in the context and then let `omega` conclude the final inequality from them.

---

### [L5.10] Strict inequality and its meaning

```lean
theorem L5_10_gt_means_succ (n : Nat) (h : n > 5) : n ≥ 6 := by omega
```

For natural numbers, `n > 5` means `n ≥ 6` (since there is no natural number between 5 and 6). Omega handles the discrete arithmetic automatically. This equivalence does NOT hold for real or rational numbers.

---

### [L5.11] Defining sumTo recursively

```lean
def sumTo : Nat → Nat
  | 0     => 0
  | n + 1 => (n + 1) + sumTo n
```

`sumTo n` computes `0 + 1 + 2 + ... + n`. The definition:
- `sumTo 0 = 0`
- `sumTo (n + 1) = (n + 1) + sumTo n`

This is a direct translation of the mathematical recursive definition. Lean4 accepts it because the argument `n` in the recursive call is strictly smaller (it is `n`, not `n + 1`), guaranteeing termination.

---

### [L5.12] Testing with #eval

```lean
#eval sumTo 0    -- 0
#eval sumTo 4    -- 10  (= 0+1+2+3+4)
#eval sumTo 10   -- 55
```

`#eval` computes values at development time. This is useful for checking that your recursive definition does what you intended before attempting a proof. If `sumTo 4` does not return `10`, the definition is wrong and any proof about it will be wrong too.

---

### [L5.13] The Gauss formula

```lean
theorem L5_13_gauss_formula (n : Nat) : 2 * sumTo n = n * (n + 1) := by
  induction n with
  | zero      => simp [sumTo]
  | succ n ih =>
    simp only [sumTo]
    nlinarith
```

This is the famous Gauss formula: the sum of integers from 0 to `n` equals `n(n+1)/2`. We state it as `2 * sumTo n = n * (n + 1)` to avoid natural-number division.

**Base case:** `2 * sumTo 0 = 0 * 1`. Both sides are 0. `simp [sumTo]` closes it.

**Inductive step:** Assume `2 * sumTo n = n * (n + 1)`. Prove `2 * sumTo (n + 1) = (n + 1) * (n + 2)`.

`simp only [sumTo]` unfolds the definition to give `2 * ((n + 1) + sumTo n) = (n + 1) * (n + 2)`. The goal then involves `n * (n + 1)` — a quadratic term. `linarith` handles only linear arithmetic and cannot proceed: it treats `n * (n + 1)` as an opaque product. `nlinarith` extends linear arithmetic by considering products of pairs of hypotheses. With `ih : 2 * sumTo n = n * (n + 1)` in scope, it can substitute and close the quadratic goal.

---

### [L5.14] Borrowing from Mathlib

```lean
#check Nat.add_comm      -- ∀ (n m : ℕ), n + m = m + n
#check Nat.mul_comm      -- ∀ (m n : ℕ), m * n = n * m
#check Nat.div_le_self   -- ∀ (n k : ℕ), n / k ≤ n
```

Before proving any arithmetic property from scratch, search Mathlib. These three theorems cover commutativity of addition, commutativity of multiplication, and the divisor bound on division — all already proved and ready to use.

---

### [L5.15] Reusing Mathlib directly

```lean
theorem L5_15_mul_comm (a b : Nat) : a * b = b * a :=
  Nat.mul_comm a b
```

We do not need to prove commutativity of multiplication — `Nat.mul_comm` is already in the library. We just apply it. This is not cheating; this is good engineering. A proof assistant's value scales with the library it sits on.

---

### [L5.16] The infinite primes theorem

```lean
#check Nat.infinite_setOf_prime
```

This is an example of the mathematical depth available in Mathlib. `Nat.infinite_setOf_prime` states that the set of prime numbers is infinite — a result that took Euclid a page-long proof, already formalized and available to use in one line.

We do not use this theorem directly in the tutorial, but it illustrates the kind of foundation you have access to.

---

## 5.4 The Induction Principle

The `induction` tactic embodies the **principle of mathematical induction**:

> To prove `P(n)` for all natural numbers `n`:
> 1. Prove `P(0)` (base case)
> 2. Assuming `P(n)`, prove `P(n + 1)` (inductive step)

In Lean4, this is not an axiom you trust — it is a theorem derived from the definition of `Nat`. The `induction` tactic is simply case analysis on the structure of a natural number, where the `succ` case automatically provides the inductive hypothesis.

The same principle generalizes to any inductively-defined type — lists, trees, and the state machines we will see in Chapter 9. Once you understand induction on `Nat`, everything else follows the same pattern.

---

## 5.5 What Happens When the Wrong Tactic Is Used?

Attempting `linarith` on the Gauss sum goal fails:

```lean
-- This does NOT work:
-- theorem bad_gauss (n : Nat) : 2 * sumTo n = n * (n + 1) := by
--   induction n with
--   | zero      => simp [sumTo]
--   | succ n ih =>
--       simp only [sumTo]
--       linarith  -- Error: linarith failed to find a contradiction
--                 -- (the goal involves n * (n+1), which is nonlinear)
```

`linarith` sees `n * (n + 1)` as an opaque product and cannot factor or expand it. The fix is `nlinarith`, which considers products of pairs of hypotheses — with `ih` in scope, it can substitute `2 * sumTo n = n * (n + 1)` and close the goal.

Similarly, using `rw` where `simp` is needed (or vice versa) is a common source of confusion:
- `simp [lemma]` applies `lemma` as a rewrite rule repeatedly until no more apply — it can over-simplify and close goals you wanted to inspect
- `rw [lemma]` applies a single rewrite step and stops — use it when you want fine-grained control over what changes

In [L5.4]–[L5.6], `simp [Nat.succ_add]` would attempt to apply `Nat.succ_add` as a simp lemma repeatedly, which can cause looping if the lemma rewrites in a direction that recreates its own left-hand side. `rw` applies it exactly once and stops safely.

---

## Exercises

1. **Commutativity of multiplication:** Lean4's `Nat.mul_comm` states `∀ m n, m * n = n * m`. Prove it for `m = 3, n = 5` using `decide`. Then try to prove the general `theorem : ∀ m n : Nat, m * n = n * m` — what tactic works here? (`omega` does not handle multiplication of variables; try `ring`.)

2. **Stronger induction:** Prove that `sumTo n ≤ n * n` for all `n`. You may use the Gauss formula from L5.13 (`2 * sumTo n = n * (n + 1)`) as a lemma. (Hint: from `2 * sumTo n = n * (n+1)` and `n + 1 ≤ n + n` for `n ≥ 1`, derive the bound. Handle `n = 0` separately.)

3. **Define and prove:** Define `countdown : Nat → List Nat` that returns `[n, n-1, ..., 1, 0]`. Prove that `(countdown n).length = n + 1` by induction.
