# Chapter 3: Propositions and First Proofs

**Source file:** `source/Ch03_Propositions.lean`

---

## 3.1 What is a Proposition?

In everyday mathematics, a proposition is a sentence that is either true or false: "all even numbers are divisible by 2", or "there is a largest prime number." In Lean4, a proposition is a **value of type `Prop`**.

The novel insight of Lean4 is that **a proof of a proposition is a term of that type**. To prove `P : Prop`, you construct a value of type `P`. This might sound abstract, but in practice it means: the Lean4 compiler is your proof checker, and writing a correct proof is exactly like writing a well-typed program.

This chapter covers the basic logical building blocks: `True`, `False`, conjunction (`∧`), disjunction (`∨`), implication (`→`), negation (`¬`), and biconditional (`↔`).

---

## 3.2 Code Walkthrough

### [L3.1] True

```lean
theorem L3_1_truth : True := trivial
```

`True` is the simplest proposition. It has exactly one proof: `trivial` (also writeable as `True.intro`). In logic, `True` is the proposition with no content — it is always provable and conveys no information.

You will rarely prove `True` directly. More often it appears as a trivial case in an inductive proof (for example, the empty list is "trivially sorted").

---

### [L3.2] False

```lean
#check False  -- False : Prop
```

`False` is the proposition with **no proofs**. It cannot be proved from nothing. However, if you have a proof of `False` as a *hypothesis*, you can derive anything — this is *ex falso* (from falsehood, anything follows).

In software terms, `False` is useful for ruling out impossible states. If your type system guarantees a state is unreachable, functions in that state take a `False` hypothesis and need not return a meaningful value.

---

### [L3.3] Reflexivity

```lean
theorem L3_3_reflexivity : (42 : Nat) = 42 := rfl
```

`rfl` is a term (not a tactic here) that proves `a = a` for any `a`. It is the proof of the reflexivity of equality. The colon in `(42 : Nat)` just disambiguates the type — Lean4 needs to know we mean natural number `42` rather than integer `42`.

---

### [L3.4] Conjunction — AND (∧)

```lean
theorem L3_4_and_intro (p q : Prop) (hp : p) (hq : q) : p ∧ q :=
  And.intro hp hq
```

This theorem takes four arguments: `p q : Prop` (two propositions), `hp : p` (a proof of `p` — note that `hp` is a variable whose *type* is `p`), and `hq : q` (a proof of `q`). It returns `p ∧ q`.

`And.intro hp hq` constructs a conjunction from its two parts, exactly like `Pair(left, right)` constructs a pair from its components. `P ∧ Q` is literally a structure type with two fields.

---

### [L3.5] Extracting the left part of a conjunction

```lean
theorem L3_5_and_left (p q : Prop) (h : p ∧ q) : p :=
  h.left
```

Given a proof `h` of `p ∧ q`, `.left` (equivalent to `And.left h`) extracts the proof of `p`. This is just like accessing a struct field.

---

### [L3.6] Extracting the right part

```lean
theorem L3_6_and_right (p q : Prop) (h : p ∧ q) : q :=
  h.right
```

Same idea — `.right` gives you the proof of `q`. Together, [L3.4]–[L3.6] are the *introduction* and *elimination* rules for conjunction.

---

### [L3.7] and [L3.8] Disjunction — OR (∨)

```lean
theorem L3_7_or_left  (p q : Prop) (hp : p) : p ∨ q := Or.inl hp
theorem L3_8_or_right (p q : Prop) (hq : q) : p ∨ q := Or.inr hq
```

To prove `P ∨ Q`, you need to provide either:
- `Or.inl hp` — a proof of `P` (choose the left branch), or
- `Or.inr hq` — a proof of `Q` (choose the right branch)

You only need to prove **one** of them. This matches the intuition: "it is raining or the street is wet" is proved by proving either half.

---

### [L3.9] Using a disjunction — case analysis

```lean
theorem L3_9_or_elim (p q r : Prop) (h : p ∨ q) (hp : p → r) (hq : q → r) : r :=
  h.elim hp hq
```

When you **have** a proof of `P ∨ Q` and want to derive `R`, you must handle **both** cases:
- If `P` holds, derive `R` (using `hp : P → R`)
- If `Q` holds, derive `R` (using `hq : Q → R`)

`h.elim hp hq` is Lean4's way of doing this split — the same exhaustive-match requirement you know from Rust or Haskell pattern matching.

---

### [L3.10] Implication — the identity function

```lean
theorem L3_10_identity (p : Prop) : p → p :=
  fun hp => hp
```

An implication `P → Q` is proved by writing a *function* that takes a proof of `P` and returns a proof of `Q`. Under the Curry-Howard correspondence, functions **are** implications.

`fun hp => hp` is the identity function: given `hp : P`, return it unchanged. This proves `P → P`: if `P` then `P`.

---

### [L3.11] Modus ponens

```lean
theorem L3_11_modus_ponens (p q : Prop) (h : p → q) (hp : p) : q :=
  h hp
```

Modus ponens is the fundamental rule of deduction: if you know `P → Q` and you know `P`, then you know `Q`. In Lean4 this is simply **function application**: `h hp` applies the function `h : P → Q` to the argument `hp : P`, yielding a value of type `Q`. Proof rules correspond directly to program operations.

---

### [L3.12] Transitivity of implication

```lean
theorem L3_12_impl_trans (p q r : Prop) (h1 : p → q) (h2 : q → r) : p → r :=
  fun hp => h2 (h1 hp)
```

If `P → Q` and `Q → R`, then `P → R`. This is function composition: `h2 ∘ h1`. The proof literally is `fun hp => h2 (h1 hp)` — apply `h1` first, then `h2`.

---

### [L3.13] Negation

```lean
theorem L3_13_not_intro (p : Prop) (h : p → False) : ¬p :=
  h
```

In Lean4, `¬P` is **defined** as `P → False`. So a proof of `¬P` is a function that takes a proof of `P` and produces a proof of `False`. If you can show that assuming `P` leads to `False`, you have proved `P` is impossible.

---

### [L3.14] Contradiction

```lean
theorem L3_14_contradiction (p q : Prop) (hp : p) (hnp : ¬p) : q :=
  (hnp hp).elim
```

If you have both `p` and `¬p` in scope, you have a contradiction. `hnp hp` applies the function `hnp : p → False` to `hp : p`, giving a proof of `False`. From `False`, anything follows — `.elim` extracts any proposition from a proof of `False`.

---

### [L3.15] Classical double negation

```lean
theorem L3_15_double_neg (p : Prop) (h : ¬¬p) : p :=
  Classical.byContradiction (fun hnp => h hnp)
```

In **classical logic** (the default in Lean4), `¬¬P` implies `P`. The proof uses `Classical.byContradiction`: assume `¬P`, derive `False` (using `h : ¬¬P` and the assumed `¬P`), and conclude `P`.

> **Intuitionistic vs Classical:** Lean4 allows classical logic via `Classical.*` theorems. Classical logic includes the Law of Excluded Middle: for any `P`, either `P` or `¬P` holds. This is what we use in everyday mathematics.

---

### [L3.16] Biconditional (IFF)

```lean
theorem L3_16_iff_intro (p q : Prop) (hpq : p → q) (hqp : q → p) : p ↔ q :=
  Iff.intro hpq hqp
```

`P ↔ Q` ("P if and only if Q") is a pair of implications. `Iff.intro` takes both directions. This is the Lean4 equivalent of writing "P implies Q, and conversely Q implies P."

---

### [L3.17] Using an IFF

```lean
theorem L3_17_iff_mp (p q : Prop) (h : p ↔ q) (hp : p) : q :=
  h.mp hp
```

Given `h : P ↔ Q`, `h.mp` is the forward implication (`P → Q`), and `h.mpr` is the backward implication (`Q → P`). (`mp` stands for *modus ponens*.)

---

### [L3.18] And is commutative

```lean
theorem L3_18_and_comm (p q : Prop) : p ∧ q ↔ q ∧ p :=
  Iff.intro
    (fun h => And.intro h.right h.left)
    (fun h => And.intro h.right h.left)
```

This proves that conjunction is symmetric: `P ∧ Q ↔ Q ∧ P`. The proof in each direction is the same: given a pair `⟨a, b⟩`, return the swapped pair `⟨b, a⟩`. Both the forward and backward implications use the identical transformation.

Chapter 4 shows how to work with these connectives using the tactic system, which makes proofs significantly more readable for longer arguments.

---

### What happens with term-mode proof mistakes?

```lean
-- Wrong: supplying conjunction components in the wrong order
-- theorem wrong_and (p q : Prop) (hp : p) (hq : q) : p ∧ q :=
--   ⟨hq, hp⟩
-- Error: type mismatch
--   hq : q
-- expected type
--   p

-- Correct:
theorem and_correct (p q : Prop) (hp : p) (hq : q) : p ∧ q :=
  ⟨hp, hq⟩
```

The error message is precise: `hq : q` was provided where a value of type `p` was expected. In Lean4, the order inside `⟨_, _⟩` matters — the first component must prove the left conjunct, the second must prove the right. There is no runtime to catch this; the type checker catches it immediately.

---

## Exercises

1. **Biconditional:** Prove `p ↔ p` in term mode. (`Iff.intro` takes two function arguments — the forward and backward directions. Each direction is the identity function `fun h => h`.)

2. **Double negation (constructive direction):** Without using `Classical.byContradiction`, prove `p → ¬¬p` in term mode. This direction does not require classical logic — you only need to show that if `p` holds, then `¬p → False`. Write the proof.

3. **De Morgan (one direction):** Prove `¬(p ∨ q) → ¬p ∧ ¬q` in term mode. The hypothesis `h : ¬(p ∨ q)` is a function `p ∨ q → False`. Use it to build proofs of `¬p` and `¬q` separately, then combine with `And.intro`.
