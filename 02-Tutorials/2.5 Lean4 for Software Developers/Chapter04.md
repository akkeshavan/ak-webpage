# Chapter 4: Proof Tactics

**Source file:** `source/Ch04_Tactics.lean`

---

## 4.1 Term Mode vs. Tactic Mode

In Chapter 3 we built proofs as **terms** — we wrote down a single expression whose type is the proposition we wanted to prove. This is called *term mode* and it is concise, but it requires you to know the complete proof in advance.

**Tactic mode** is an interactive alternative. You switch into it with the `by` keyword, and then write a series of *tactics* — instructions that transform the current proof state step by step. After each tactic, the goal changes, and you keep going until no goals remain.

The reason to prefer tactic mode: you can see the proof state in VS Code's Infoview at each step. For non-trivial proofs, this interactivity is essential.

---

## 4.2 Reading the Proof State

Every time you are in `by` mode, the Infoview shows something like:

```
p q : Prop
hp : p
hq : q
⊢ p ∧ q
```

- The lines above `⊢` are the **context** (hypotheses): names, their types
- The line after `⊢` is the **goal**: what you need to prove
- The symbol `⊢` is pronounced "entails" or "proves"

Tactics transform this state. Most tactics either change the goal, add to the context, or close the goal entirely.

---

## 4.3 Code Walkthrough

### [L4.1] intro: move a hypothesis into scope

```lean
theorem L4_1_intro_tactic (p : Prop) : p → p := by
  intro hp
  exact hp
```

The goal starts as `⊢ p → p`. `intro hp` moves the antecedent `p` into the context as `hp : p`. The goal becomes `⊢ p`.

**Before `intro`:**
```
p : Prop
⊢ p → p
```

**After `intro hp`:**
```
p : Prop
hp : p
⊢ p
```

You use `intro` at the start of any proof of an implication (`→`) or a universal quantification (`∀`). It is the tactic equivalent of "assume P".

---

### [L4.2] exact: close with a specific term

```lean
theorem L4_2_exact_tactic (p q : Prop) (hp : p) (_hq : q) : p := by
  exact hp
```

`exact e` closes the current goal if `e` has exactly the type of the goal. Here the goal is `⊢ p` and `hp : p` is in the context, so `exact hp` completes the proof.

`exact` is your most direct tactic: "the proof of this goal is this specific term."

---

### [L4.3] apply: work backwards from a conclusion

```lean
theorem L4_3_apply_tactic (p q : Prop) (h : p → q) (hp : p) : q := by
  apply h
  exact hp
```

`apply h` says "the goal can be proved using `h`, but `h` needs some arguments — turn those into new goals." Here `h : p → q` produces `q` if we supply `p`, so `apply h` transforms the goal `⊢ q` into `⊢ p`. Then `exact hp` closes it.

`apply` is backward reasoning: instead of "I have X, therefore Y", it says "I want Y, and I can get it from X via `h`". This is often more natural when writing proofs.

---

### [L4.4] assumption: automatic search in context

```lean
theorem L4_4_assumption_tactic (p q : Prop) (hp : p) (_hq : q) : p := by
  assumption
```

`assumption` looks through the entire context and closes the goal if any hypothesis matches. It is a lazy version of `exact` — useful when the answer is obvious but you do not want to look up its name.

---

### [L4.5] constructor: split a conjunction

```lean
theorem L4_5_constructor_tactic (p q : Prop) (hp : p) (hq : q) : p ∧ q := by
  constructor
  · exact hp
  · exact hq
```

`constructor` works on any type with a single constructor. For `P ∧ Q`, that constructor is `And.intro`, so the goal splits into two subgoals: `⊢ p` and `⊢ q`. The bullets `·` mark each subgoal's proof.

The Infoview after `constructor` shows two goals:
```
case left
...
⊢ p

case right
...
⊢ q
```

You then close each one in turn.

---

### [L4.6] cases: split a disjunction

```lean
theorem L4_6_cases_or (p q : Prop) (h : p ∨ q) : q ∨ p := by
  cases h with
  | inl hp => exact Or.inr hp
  | inr hq => exact Or.inl hq
```

`cases h` on `h : p ∨ q` splits into two branches:
- `inl` branch: Lean4 gives you `hp : p` and you prove the goal in a world where `p` holds
- `inr` branch: Lean4 gives you `hq : q` and you prove the goal where `q` holds

The `| inl hp =>` and `| inr hq =>` lines name the new hypothesis in each branch. This is exhaustive case analysis — you must handle both branches or the proof is incomplete.

---

### [L4.7] obtain: destructure a conjunction

```lean
theorem L4_7_obtain_and (p q : Prop) (h : p ∧ q) : q ∧ p := by
  obtain ⟨hp, hq⟩ := h
  exact ⟨hq, hp⟩
```

`obtain ⟨hp, hq⟩ := h` is pattern matching on a conjunction hypothesis. It splits `h : p ∧ q` into its two components:
- `hp : p`
- `hq : q`

Then `⟨hq, hp⟩` is an anonymous constructor — it builds `q ∧ p` from the two components in reverse order. Use `obtain` whenever you need to unpack a hypothesis that is a product type (conjunction, `∃`, etc.).

---

### [L4.8] have: name an intermediate result

```lean
theorem L4_8_have_tactic (p q r : Prop) (h1 : p → q) (h2 : q → r) (hp : p) : r := by
  have hq : q := h1 hp
  exact h2 hq
```

`have name : type := proof` adds a named intermediate result to the context. Here:

1. `have hq : q := h1 hp` applies `h1` to `hp` and names the result `hq : q`
2. `exact h2 hq` applies `h2` to `hq` to produce `r`

`have` is the tactic equivalent of a local variable. Use it to break long proofs into readable steps, or to name a subresult you will use more than once.

---

### [L4.9] rfl: reflexivity

```lean
theorem L4_9_rfl_tactic : (3 : Nat) + 4 = 7 := by rfl
```

`rfl` proves `a = b` when both sides reduce to the same normal form. `3 + 4 = 7` holds because Lean4 computes both sides and finds them equal. It works for any equational goal where both sides are definitionally equal — arithmetic on concrete numbers, function applications that normalize, definitional unfoldings. It fails when sides are *propositionally* but not *definitionally* equal (e.g., `a + b = b + a` for variables `a b`). For those, use `omega` or `ring`.

---

### [L4.10] simp: automated simplification

```lean
theorem L4_10_simp_tactic (n : Nat) : n + 0 = n := by simp
```

`simp` applies a library of pre-proved lemmas as rewriting rules, in a loop, until the goal is closed or no more rules apply. Here it knows `Nat.add_zero : ∀ n, n + 0 = n` and applies it immediately.

`simp` can also be given specific lemmas: `simp [myLemma1, myLemma2]`. This is useful when the default set does not work.

> **Warning:** `simp` proofs can break if the Mathlib lemma set changes. For stable code, use `simp only [specific_lemmas]` to pin exactly which lemmas apply.

---

### Marking your own lemmas for `simp`

```lean
def addTwo (n : Nat) : Nat := n + 2

@[simp]
theorem addTwo_zero : addTwo 0 = 2 := by simp [addTwo]

@[simp]
theorem addTwo_succ (n : Nat) : addTwo (n + 1) = addTwo n + 1 := by
  simp [addTwo]; ring
```

`@[simp]` is an *attribute* that registers a theorem in `simp`'s default rewriting set. After these definitions, calling plain `simp` on any goal involving `addTwo` will automatically apply `addTwo_zero` and `addTwo_succ` — you do not need to write `simp [addTwo_zero, addTwo_succ]` every time.

Two rules for `@[simp]` lemmas:
- The left-hand side should be a function applied to a constructor pattern (`double 0`, `double (n+1)`), not a free-form equation. This avoids ambiguity about which direction to rewrite.
- Avoid pairing lemmas that rewrite in opposite directions (e.g., `a = b` and `b = a` both marked `@[simp]`), as `simp` will loop.

`simp only` ignores `@[simp]` lemmas unless you explicitly list them — useful when you want to pin exactly which rewrites apply and prevent `simp` from doing too much.

---

### [L4.11] omega: linear arithmetic

```lean
theorem L4_11_omega_tactic (n m : Nat) (h : n < m) : n + 1 ≤ m := by omega
```

`omega` is a decision procedure for linear arithmetic over `Nat` and `Int`. It can solve any goal involving:
- Addition, subtraction, multiplication by a constant
- Comparisons: `<`, `≤`, `=`, `≥`, `>`
- Integer and natural number constraints

It uses the hypotheses in the context automatically. `omega` is remarkably powerful — it handles many arithmetic goals that would require manual case analysis.

---

### [L4.12] ring: algebraic identities

```lean
theorem L4_12_ring_tactic (a b : Int) : (a + b) ^ 2 = a ^ 2 + 2 * a * b + b ^ 2 := by
  ring
```

`ring` proves equalities in commutative (semi)rings: `Int`, `Nat`, `Real`, `Rat`, etc. It expands and normalizes both sides, then checks they are identical. It handles polynomials and power expressions, but not division, absolute value, or non-algebraic functions.

---

### [L4.13] norm_num: concrete numeric facts

```lean
theorem L4_13_norm_num_tactic : (2 : Nat) ^ 10 = 1024 := by norm_num
```

`norm_num` evaluates numeric expressions and proves facts about concrete numbers. It is faster and more powerful than `decide` for large numbers, and handles real-valued arithmetic (fractions, roots, etc.) that `decide` cannot touch.

---

### [L4.14] decide: computation-based proof

```lean
theorem L4_14_decide_tactic : 17 < 42 := by decide
```

`decide` proves any goal for which Lean4 can algorithmically determine the answer. The proposition must be *decidable* — there must be a computable procedure to check it. For propositions involving only concrete numbers and finite structures, `decide` works. For propositions with universally quantified variables over infinite types, it does not.

---

### [L4.15] contradiction: close from inconsistent hypotheses

```lean
theorem L4_15_contradiction_tactic (p : Prop) (hp : p) (hnp : ¬p) : False := by
  contradiction
```

`contradiction` looks for a pair of contradictory hypotheses (`h : P` and `h : ¬P`) and closes the goal automatically. The goal can be anything because from `False` anything follows.

---

### [L4.16] by_contra: proof by contradiction

```lean
theorem L4_16_by_contra (p : Prop) (h : ¬¬p) : p := by
  by_contra hnp
  exact h hnp
```

`by_contra hnp` assumes the **negation** of the current goal and names it `hnp`. The new goal is `⊢ False`. You then derive a contradiction (here, `h hnp` applies `h : ¬¬p` to `hnp : ¬p` yielding `False`).

Use `by_contra` when it is easier to reason about what happens if the goal is false, rather than proving it directly.

---

### [L4.17] A realistic proof

```lean
theorem L4_17_realistic_proof (n : Nat) (h : n > 0) : n * 2 > n := by
  have h1 : n * 2 = n + n := by ring
  rw [h1]
  omega
```

This proof combines three tactics into a readable argument:

1. **`have h1 : n * 2 = n + n := by ring`** — establish an arithmetic identity using `ring`
2. **`rw [h1]`** — rewrite the goal using `h1`, replacing `n * 2` with `n + n`. The `rw` (rewrite) tactic substitutes an equality
3. **`omega`** — the goal is now `n + n > n`, which `omega` solves from `h : n > 0`

This three-step structure — simplify, rewrite, automate — is a common pattern in real proofs.

---

### Reading Lean4 error messages

When a tactic fails, the Lean Infoview shows a specific error. Here are the most common ones and what they mean.

**`apply` when `exact` is needed:**
```lean
-- This FAILS:
-- theorem try_apply (p : Prop) (hp : p) : p := by
--   apply hp
-- Error: function expected at hp, term has type p
-- (apply expects something of the form A → B, not a bare term)

-- Correct:
theorem use_exact (p : Prop) (hp : p) : p := by
  exact hp
```

**`rfl` when sides aren't definitionally equal:**
```lean
-- This FAILS for variable n:
-- theorem rfl_fail (n : Nat) : n + 0 = n := by
--   rfl
-- Error: type mismatch
--   rfl : n + 0 = n + 0
-- expected type
--   n + 0 = n
-- (n + 0 and n are propositionally equal but not the same expression)

-- Correct — simp or omega handles this:
theorem add_zero_correct (n : Nat) : n + 0 = n := by simp
```

**`omega` when the goal is nonlinear:**
```lean
-- This FAILS:
-- theorem omega_fail (n : Nat) (h : n ≥ 1) : n * n ≥ n := by
--   omega
-- Error: omega could not find a solution
-- (omega only handles linear terms; n * n is quadratic)

-- Correct:
theorem sq_ge_self (n : Nat) (h : n ≥ 1) : n * n ≥ n := by nlinarith
```

The general pattern: when a tactic fails, read the error message first. It tells you what the tactic tried to prove and what it actually got. The mismatch points to which tactic — or which lemma — you need instead.

---

## 4.4 Tactic Quick Reference

| Tactic | When to use |
|---|---|
| `intro h` | Goal is `P → Q` or `∀ x, P x`; introduces `h : P` |
| `exact e` | You know exactly what term proves the goal |
| `apply h` | Backward reasoning with `h : A → goal` |
| `assumption` | Goal is identical to some hypothesis |
| `constructor` | Goal is `P ∧ Q` or an inductive with one constructor |
| `cases h` | Hypothesis `h` is `P ∨ Q` or an inductive |
| `obtain ⟨a,b⟩ := h` | Unpack `h : P ∧ Q` or `h : ∃ x, P x` |
| `have n : T := e` | Name an intermediate result |
| `rfl` | Goal is `a = a` (definitionally) |
| `simp [l]` | Simplify goal with lemma list `l` |
| `omega` | Linear arithmetic over `Nat` / `Int` |
| `ring` | Polynomial equality in a commutative ring |
| `norm_num` | Concrete numeric facts |
| `decide` | Any decidable proposition (concrete, finite) |
| `contradiction` | Contradictory hypotheses in context |
| `by_contra h` | Proof by contradiction |
| `rw [h]` | Rewrite goal using equality `h` |

---

## Exercises

1. **Tactic sequence:** Prove `∀ n m : Nat, n < m → n + 1 ≤ m` using exactly three tactics in sequence: `intro`, then `intro`, then `omega`. Open it in VS Code and watch the goal change after each tactic in the Infoview.

2. **Constructor and cases:** Prove `(p ∧ q) → (q ∧ p)` in tactic mode. Use `intro` to bring the hypothesis into scope, `obtain` to unpack it, and `exact` with an anonymous constructor to close the goal.

3. **Chain `have` steps:** Given `h1 : a < b`, `h2 : b < c`, `h3 : c < d` (all `Nat`), prove `a + 2 < d`. Use three `have` statements to name intermediate results (`a < c`, `a < d`, and the final bound), then close with `omega`. This mirrors how long proofs are structured.

4. **Mark and use `@[simp]`:** Define `def triple (n : Nat) := n + n + n`. Add `@[simp]` to the lemmas `triple 0 = 0` and `triple (n + 1) = triple n + 3`. Then prove `triple 5 = 15` using just `simp` with no arguments. Verify in the Infoview that `simp` closes the goal in one step.
