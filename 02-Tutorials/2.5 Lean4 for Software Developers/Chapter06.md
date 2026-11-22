# Chapter 6: Proving Properties of Functions

**Source file:** `source/Ch06_Functions.lean`

---

## 6.1 From Functions to Contracts

Software developers write functions every day. But proving that a function is correct requires stating precisely what "correct" means — and that means writing down a **specification**.

In Lean4, specifications are propositions (types). You state what properties your function should have, then prove them. The result is not just "my tests pass" but "my function provably satisfies this mathematical property for all inputs."

This chapter covers:
- Simple output properties (evenness, monotonicity, injectivity)
- Encoding preconditions in types (eliminating runtime checks)
- Properties of functions over integers
- Termination guarantees

---

## 6.2 Code Walkthrough

### [L6.1] A pure function

```lean
def double (n : Nat) : Nat := n * 2
```

The simplest possible function: `double n = n * 2`. Pure, total, no effects. We will use this as our first subject for property proofs.

---

### [L6.2] double produces even numbers

```lean
theorem L6_2_double_even (n : Nat) : 2 ∣ double n :=
  ⟨n, by simp [double]; ring⟩
```

`2 ∣ double n` reads "2 divides `double n`". Divisibility `a ∣ b` is defined in Lean4 as `∃ k, b = a * k` — there exists a multiplier.

This is a term-mode proof. `2 ∣ double n` unfolds to `∃ k, double n = 2 * k`. The anonymous constructor `⟨n, ...⟩` provides the witness `k = n` directly. The second component `by simp [double]; ring` proves `double n = 2 * n`: `simp [double]` unfolds `double n` to `n * 2`, and `ring` proves `n * 2 = 2 * n`.

`double` is now formally verified to always return an even number.

---

### [L6.3] double is strictly monotone

```lean
theorem L6_3_double_monotone (a b : Nat) (h : a < b) : double a < double b := by
  simp [double]
  omega
```

If `a < b`, then `double a < double b`. Proof: unfold the definition, then `omega` handles `a * 2 < b * 2` from `a < b` using linear arithmetic. Monotonicity guarantees matter because sorting algorithms, binary search, and indexed data structures all depend on functions that preserve order.

---

### [L6.4] double is injective

```lean
theorem L6_4_double_injective : Function.Injective double := by
  intro a b h
  simp [double] at h
  omega
```

`Function.Injective f` means `∀ a b, f a = f b → a = b` — distinct inputs always produce distinct outputs. The proof:

1. `intro a b h` — introduce two arbitrary inputs and the hypothesis `h : double a = double b`
2. `simp [double] at h` — unfold `double` in `h`, giving `h : a * 2 = b * 2`
3. `omega` — concludes `a = b` from `a * 2 = b * 2`

The `at h` suffix tells `simp` to act on the hypothesis rather than the goal. Most tactics that rewrite or simplify accept this suffix.

---

### [L6.5] Preconditions encoded in types

```lean
def safeDiv (n d : Nat) (_ : d ≠ 0) : Nat := n / d
```

The third argument `_ : d ≠ 0` is a **proof argument**. The `_` signals that the proof is not used in the function body (the division just works correctly once we know `d ≠ 0`) but must still be supplied by the caller. At the call site, a caller must provide a proof that `d` is not zero. This is not a runtime check — it is a compile-time requirement enforced by the type system.

Compare this to the typical alternative:
```python
def divide(n, d):
    if d == 0:
        raise ValueError("division by zero")
    return n // d
```

In Python, you might forget the check, or the check might pass at compile time but a zero reaches it at runtime. In Lean4, the function **cannot be called** without a proof of `d ≠ 0`. The error is caught before the program runs.

---

### [L6.6] The result of safeDiv is bounded

```lean
theorem L6_6_safeDiv_le (n d : Nat) (h : d ≠ 0) : safeDiv n d h ≤ n :=
  Nat.div_le_self n d
```

`safeDiv n d h ≤ n` — integer division always gives a result no larger than the numerator. Proof: unfold the definition, then use the Mathlib theorem `Nat.div_le_self`.

This is a **postcondition**: a property guaranteed to hold after the function runs, for every valid input.

---

### [L6.7] Special case: division by 1

```lean
theorem L6_7_safeDiv_one (n : Nat) : safeDiv n 1 (by decide) = n := by
  simp [safeDiv]
```

Dividing any number by 1 returns the same number. The third argument `(by decide)` proves `1 ≠ 0` automatically at the call site — this is how you discharge a simple concrete precondition inline, without a separate lemma.

---

### [L6.8] Implementing absolute value

```lean
def myAbs (n : Int) : Int := if n ≥ 0 then n else -n
```

An integer's absolute value: if `n` is non-negative, return `n`; otherwise return `-n`. This uses Lean4's `if-then-else` expression — the branches are terms that must have the same type.

Note we work over `Int` (integers) rather than `Nat` (naturals), since negative numbers only make sense for integers.

---

### [L6.9] Absolute value is non-negative

```lean
theorem L6_9_abs_nonneg (n : Int) : myAbs n ≥ 0 := by
  simp only [myAbs]
  split_ifs with h
  · linarith
  · push Not at h; linarith
```

The proof uses `split_ifs` to case-split on the `if n ≥ 0` condition:

**Case `h : n ≥ 0`:** `myAbs n = n`, so goal becomes `n ≥ 0`, which is exactly `h`. `linarith` closes it.

**Case `h : ¬(n ≥ 0)`:** `push Not at h` rewrites `h` from `¬(n ≥ 0)` to `n < 0`. Then `myAbs n = -n`, so goal becomes `-n ≥ 0`, i.e., `n ≤ 0`. Since `n < 0`, this follows by `linarith`.

`omega` is a complete decision procedure for linear arithmetic over `Nat` and `Int` — it always correctly decides whether a linear statement holds. `linarith` proves linear inequalities by finding a linear combination of hypotheses that witnesses the conclusion; it is not a complete procedure and can fail on goals `omega` would handle. On `Nat` and `Int`, reach for `omega` first; use `linarith` when working with `Real` or `Rat` types where `omega` is unavailable.

---

### [L6.10] Absolute value of a negative number

```lean
theorem L6_10_abs_neg (n : Int) (h : n < 0) : myAbs n = -n := by
  simp only [myAbs, if_neg (by linarith : ¬ n ≥ 0)]
```

Given `h : n < 0`, we know `¬ n ≥ 0`. `simp only` is given two things: the definition `myAbs` to unfold, and `if_neg (by linarith : ¬ n ≥ 0)` which immediately resolves the `if` to its `else` branch by providing a proof that the condition is false. The result is `-n = -n`, which `simp` closes as `rfl`.

This is more direct than splitting all branches with `split_ifs` — when you already know which branch is active, you can pass the proof of the condition (or its negation) directly to `simp only`.

---

### [L6.11] Characterizing when absolute value is zero

```lean
theorem L6_11_abs_zero_iff (n : Int) : myAbs n = 0 ↔ n = 0 := by
  simp only [myAbs]
  split_ifs with h
  · constructor
    · intro heq; linarith
    · intro heq; linarith
  · push Not at h
    constructor
    · intro heq; linarith
    · intro heq; simp [heq]
```

This IFF theorem captures a complete characterization: `|n| = 0` if and only if `n = 0`. The proof splits both the `if` branch and the IFF direction, handling four sub-cases.

This pattern — proving `f x = constant ↔ x = something` — is common in specification work. It completely characterizes when a function hits a specific output.

---

### [L6.12] Clamping to a range

```lean
def clamp (lo hi val : Int) : Int :=
  if val < lo then lo else if val > hi then hi else val
```

`clamp` restricts `val` to the interval `[lo, hi]`. This is used everywhere: graphics coordinates, slider values, array indices. Three branches:
1. If `val < lo`: return `lo` (the lower bound)
2. Else if `val > hi`: return `hi` (the upper bound)
3. Else: `val` is already in range, return it unchanged

---

### [L6.13] Lower bound guarantee

```lean
theorem L6_13_clamp_lower (lo hi val : Int) (h : lo ≤ hi) : clamp lo hi val ≥ lo := by
  simp only [clamp]
  split_ifs with h1 h2
  · linarith
  · linarith
  · linarith
```

`clamp` always returns at least `lo`. The proof splits all three `if` branches:
1. `val < lo` branch: returns `lo ≥ lo` (reflexivity, closed by `linarith`)
2. `val > hi` branch: returns `hi`. Since `h : lo ≤ hi`, we have `hi ≥ lo`. `linarith`.
3. Otherwise: returns `val`. Since we are in the "not less than lo, not greater than hi" region, `val ≥ lo`. `linarith`.

---

### [L6.14] Upper bound guarantee

```lean
theorem L6_14_clamp_upper (lo hi val : Int) (h : lo ≤ hi) : clamp lo hi val ≤ hi := by
  simp [clamp]
  split_ifs with h1 h2
  · linarith
  · linarith
  · push Not at h2; linarith
```

Symmetrically, `clamp` always returns at most `hi`. Together, [L6.13] and [L6.14] prove that `clamp` satisfies its complete specification: `lo ≤ clamp lo hi val ≤ hi`.

This pair of theorems is an example of a **sandwich proof**: the output is bounded below by one theorem and bounded above by another.

---

### [L6.15] Recursive functions must terminate

```lean
def factorial : Nat → Nat
  | 0     => 1
  | n + 1 => (n + 1) * factorial n
```

Lean4 checks that every recursive function terminates. For `factorial`, the argument decreases from `n + 1` to `n` at each step, so it must eventually reach `0`. Lean4 verifies this **structurally**: in each recursive call, the argument is a strict sub-term of the input.

If you try to write a non-terminating function, Lean4 rejects it:
```lean
-- THIS DOES NOT COMPILE:
def loop (n : Nat) : Nat := loop n  -- Error: failed to synthesize decreasing measure
```

---

### [L6.16] Factorial is always positive

```lean
theorem L6_16_factorial_pos (n : Nat) : factorial n > 0 := by
  induction n with
  | zero      => simp [factorial]
  | succ n ih =>
    simp only [factorial]
    exact Nat.mul_pos (Nat.succ_pos n) ih
```

Proof by induction:
- **Base case:** `factorial 0 = 1 > 0`. `simp [factorial]` unfolds the base case and closes the resulting `1 > 0` goal.
- **Inductive step:** `simp only [factorial]` unfolds `factorial (n+1)` to `(n+1) * factorial n`. We need `(n+1) * factorial n > 0`.
  - `Nat.succ_pos n` gives `n + 1 > 0`
  - `ih` gives `factorial n > 0`
  - `Nat.mul_pos` combines them: product of two positives is positive

---

### [L6.17] Factorial is non-decreasing

```lean
theorem L6_17_factorial_mono (n : Nat) : factorial n ≤ factorial (n + 1) := by
  simp only [factorial]
  exact Nat.le_mul_of_pos_left _ (Nat.succ_pos n)
```

`factorial (n+1) = (n+1) * factorial n ≥ factorial n` because `n+1 > 0` always holds for `Nat` (there is no `n` such that `n + 1 = 0`), so multiplying by it can only increase the value. No `n ≥ 1` precondition is needed — `Nat.succ_pos n` proves `n + 1 > 0` unconditionally.

---

## 6.3 The Specification Mindset

The key shift this chapter teaches is thinking in terms of **properties**, not just implementations:

| Implementation | Specification |
|---|---|
| `def double n := n * 2` | `2 ∣ double n` (always even) |
| `def safeDiv n d h := n / d` | `safeDiv n d h ≤ n` (bounded) |
| `def clamp lo hi val := ...` | `lo ≤ clamp lo hi val ≤ hi` |
| `def factorial n := ...` | `factorial n > 0` (always positive) |

Writing these properties *before* writing the implementation (or immediately after) forces you to think clearly about what your function should do. This discipline — which mirrors Test-Driven Development — catches design errors before they become bugs.

In the next chapter we apply this same discipline to algorithms: sorting and search.

---

## 6.4 Common Tactic Mistakes

**Using `push_neg` instead of `push Not`:**

```lean
-- Error in current Mathlib:
-- push_neg at h  -- unknown tactic 'push_neg'

-- Correct:
push Not at h
```

`push_neg` was the old name; `push Not` is the current one. They do the same thing: push negations inward through `∧`, `∨`, `∀`, `∃`, `¬¬`, turning e.g. `¬(n ≥ 0)` into `n < 0`.

**Using `simp` where `simp only` is needed:**

`simp` applies its entire lemma database in a loop. Sometimes this over-simplifies: it closes a goal you wanted to inspect, or rewrites away structure needed by the next tactic. `simp only [lemma1, lemma2]` applies exactly the listed lemmas and stops. When `simp` behaves unexpectedly, switch to `simp only` and add lemmas one at a time until the goal is in the shape you want.

**`split_ifs` vs. `if_neg`/`if_pos`:**

`split_ifs` generates one subgoal per branch of every `if` in the goal. If you already know which branch is active, passing `if_neg h` or `if_pos h` directly to `simp only` is cleaner and avoids an unreachable subgoal.

---

## Exercises

1. **Injection proof:** Prove that `double` is injective: `∀ m n : Nat, double m = double n → m = n`. Unfold `double` with `simp` and close with `omega`.

2. **Clamp bounds:** Using the `clamp` definition from [L6.12], prove that `lo ≤ clamp lo hi n` for all `n`, assuming `lo ≤ hi`. (Hint: `simp only [clamp]`, then `split_ifs` with `h1 h2`, and `linarith` in each branch.)

3. **Absolute value is non-negative:** Prove `∀ n : Int, myAbs n ≥ 0` without looking at [L6.9]. Try writing the proof yourself, then compare to the source.
