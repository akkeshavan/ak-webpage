# Chapter 8: Navigating Mathlib

**Source file:** `source/Ch08_Mathlib.lean`

---

## 8.1 What Is Mathlib?

Mathlib is the community-maintained mathematical library for Lean4. As of 2025, it contains over 200,000 theorems and definitions covering:

- Number theory (primes, divisibility, GCD, Euler's theorem)
- Algebra (groups, rings, fields, vector spaces, modules)
- Analysis (limits, continuity, derivatives, integration)
- Topology (open sets, compactness, metric spaces)
- Combinatorics and graph theory
- Linear algebra (matrices, determinants)
- Probability theory

For software developers, the immediately useful parts are:
- **Nat and Int theorems** — arithmetic properties you do not want to reprove
- **List theorems** — membership, sorting, mapping, filtering
- **Tactics** — `omega`, `ring`, `norm_num`, `simp`, `linarith`, `decide`
- **Order theory** — inequalities, lattices, bounded values

The key skill is knowing how to find what you need, rather than reproving things from scratch.

---

## 8.2 The Discovery Workflow

Before writing a proof, ask: "Has Mathlib already proved this?" The answer is yes more often than you expect.

**Workflow:**
1. State what you want to prove
2. Try automated tactics (`omega`, `ring`, `simp`, `norm_num`) — they cover 80% of routine goals
3. If stuck, use `exact?` or `apply?` in VS Code to search interactively
4. Search [Loogle](https://loogle.lean-lang.org) for theorems by name pattern or type signature
5. Import the specific Mathlib module that contains what you need

---

## 8.3 Code Walkthrough

### [L8.1] #check: your primary navigation tool

```lean
#check Nat.add_comm        -- ∀ (n m : ℕ), n + m = m + n
#check Nat.mul_comm        -- ∀ (m n : ℕ), m * n = n * m
#check List.length_append  -- ∀ (l₁ l₂ : List α), (l₁ ++ l₂).length = l₁.length + l₂.length
```

`#check` tells you a theorem's exact type. If you think a theorem like `Nat.add_comm` exists, `#check` it to confirm the exact form before applying it in a proof.

---

### [L8.2] exact?: search for a closing term

```lean
example (n : Nat) : n ≤ n := by
  exact le_refl n    -- exact? would have suggested this
```

In VS Code, place your cursor on `exact?` (typed literally) inside a `by` block. Lean4 searches all loaded theorems for one whose conclusion matches your current goal, and shows suggestions in the Infoview. Reach for it when you know a theorem exists for your goal but cannot recall its name.

---

### [L8.3] apply?: search for applicable lemmas

```lean
example (n : Nat) (h : n > 0) : n ≥ 1 := by
  omega
```

`apply?` is like `exact?` but for lemmas whose conclusion matches the goal modulo some remaining subgoals. Where `exact?` finds a complete proof, `apply?` finds a lemma that makes progress. For the example above, `omega` is cleaner, but `apply?` might suggest `Nat.one_le_iff_ne_zero`. Use it when you need a stepping-stone — something that moves you toward the goal without closing it.

---

### [L8.4] simp?: learn which lemmas simp uses

```lean
example (l : List Nat) : (l ++ []).length = l.length := by
  simp    -- simp? would print: simp only [List.append_nil]
```

`simp?` is `simp` that also prints a `simp only [...]` line showing exactly which lemmas it used. This is useful because it documents your proof, makes it more robust (specific lemmas are less likely to change than the default set), and shows you which Mathlib lemmas are relevant to your domain. A common workflow: prototype with `simp`, then replace with `simp only [...]` using the output of `simp?`.

---

### [L8.5] norm_num: concrete numeric statements

```lean
example : (2 : Nat) ^ 20 = 1048576 := by norm_num
example : (7 : Int) * 13 = 91 := by norm_num
example : (1 : Nat) / 2 = 0 := by norm_num
```

`norm_num` is Mathlib's workhorse for numeric facts. It handles:
- Integer and rational arithmetic
- Powers and roots
- Divisibility
- Concrete inequalities

It is faster than `decide` for large numbers because it uses efficient normalization algorithms rather than naive computation.

---

### [L8.6] decide: computation for decidable propositions

```lean
example : Nat.Prime 97 := by decide
example : Nat.gcd 48 18 = 6 := by decide
```

`decide` proves any proposition that is *decidable* — meaning there is a computable procedure to check it. For:
- Small number properties (primality of 97, gcd computation)
- Finite cases (sorting a small list, checking a property for a specific value)

`decide` is limited to finite, computable propositions. For infinite universals (`∀ n, ...`), use `omega`, `ring`, or induction.

---

### [L8.7] ring: polynomial identities

```lean
example (a b c : Int) : (a + b + c) ^ 2 =
    a ^ 2 + b ^ 2 + c ^ 2 + 2 * a * b + 2 * b * c + 2 * a * c := by ring
```

`ring` proves polynomial equalities over any commutative ring. It normalizes both sides into a canonical form (sum of monomials) and checks equality. This particular identity would take many steps to prove manually; `ring` handles it in one tactic. It covers any equality involving `+`, `-`, `*`, `^` and variables. It also works for `Nat`, though natural number subtraction has edge cases (since `Nat` is not a ring — subtraction saturates at 0).

---

### [L8.8] omega: linear arithmetic

```lean
example (n m : Int) (h1 : n > 0) (h2 : m > n) : m + n > 1 := by omega
```

`omega` automatically reasons about the hypotheses in context. It picks up `h1 : n > 0` and `h2 : m > n` and deduces `m + n > 1` without any hints. It covers addition, subtraction, multiplication by constants, integer and natural number constraints, and any number of hypotheses simultaneously — it is complete for linear integer arithmetic. It does not handle multiplication of variables, division (unless by a constant), real numbers, or non-linear terms.

---

### [L8.9] Lean4's prime number theory

```lean
#check Nat.Prime
-- Nat.Prime n means: n ≥ 2 and n has no divisors other than 1 and itself.
```

`Nat.Prime` is Mathlib's definition of primality — a predicate `Nat → Prop`. To use the prime number library you work with hypotheses `hp : Nat.Prime n` and apply the theorems below.

---

### [L8.10] Key prime number theorems

```lean
#check Nat.Prime.two_le      -- ∀ p, Nat.Prime p → 2 ≤ p
#check Nat.minFac_prime      -- ∀ n, 2 ≤ n → Nat.Prime n.minFac
```

A sample of Mathlib's prime library:
- `Nat.Prime.two_le`: every prime is at least 2
- `Nat.minFac_prime`: every number ≥ 2 has a prime factor
- `Nat.infinite_setOf_prime`: there are infinitely many primes
- `Nat.prime_def_lt_prime`: alternative characterization of primality

These represent a complete, machine-checked theory of primes that took mathematicians centuries to develop.

---

### [L8.11] Using a prime theorem in a proof

```lean
example (p : Nat) (hp : Nat.Prime p) : p ≥ 2 := hp.two_le
```

`hp.two_le` calls `Nat.Prime.two_le` on `hp`. This is dot notation: if `x : T` and `T.someTheorem` takes a `T` as its first argument, write `x.someTheorem`.

---

### [L8.12] Browsing the List library

```lean
#check List.length_append  -- length of concatenated lists
#check List.map_append     -- map distributes over append
#check List.mem_append     -- membership in a concatenated list
#check List.length_map     -- map preserves length
```

For list-heavy proofs, Mathlib's `List` namespace is your friend. Before writing a proof about lists, spend a few minutes checking what theorems exist. Common patterns:

| You want to prove... | Look for... |
|---|---|
| Property of `l1 ++ l2` | `List.*.append` |
| Property of `List.map f l` | `List.*.map` |
| `x ∈ l1 ++ l2` | `List.mem_append` |
| `(List.filter p l).length` | `List.length_filter` |

---

### [L8.13] Using a List theorem directly

```lean
example (l1 l2 : List Nat) (f : Nat → Nat) :
    List.map f (l1 ++ l2) = List.map f l1 ++ List.map f l2 :=
  List.map_append
```

`List.map_append` states that `map` distributes over `++`. We apply it directly — no proof needed, just use the existing theorem. In current Mathlib all three arguments (`f`, `l1`, `l2`) are implicit, so the term `List.map_append` alone unifies with the goal.

---

### [L8.14] Chaining Mathlib lemmas

```lean
example (l1 l2 : List Nat) (f : Nat → Nat) :
    (List.map f (l1 ++ l2)).length = l1.length + l2.length := by
  rw [List.map_append, List.length_append, List.length_map, List.length_map]
```

This proof chains four rewrites:
1. `List.map_append` — distribute map over `++`
2. `List.length_append` — length of `++` is sum of lengths
3. `List.length_map` (first) — length of `map f l1` is `l1.length`
4. `List.length_map` (second) — length of `map f l2` is `l2.length`

Each step is a known Mathlib theorem. The proof is entirely composed of reuse.

---

### [L8.15] BigOperators: summation notation

```lean
open BigOperators in
#check @Finset.sum
```

Mathlib's `BigOperators` namespace provides the ∑ (sum) notation over finite sets. `Finset.range n` is the set `{0, 1, ..., n-1}`. Summations over finite sets are computable and provable with `decide` or `norm_num`.

---

### [L8.16] Computing a sum

```lean
open BigOperators in
example : ∑ i ∈ Finset.range 5, (i : Nat) = 10 := by native_decide
```

The sum of 0+1+2+3+4 = 10. `native_decide` is a faster variant of `decide` that compiles to native code before evaluating — useful for larger computations.

---

### [L8.17] The closed-form sum formula

```lean
#check Finset.sum_range_id_mul_two
-- (∑ i ∈ Finset.range n, i) * 2 = n * (n - 1)
```

Mathlib has the Gauss formula in closed form. One subtlety: `Finset.range n` is `{0, 1, ..., n-1}` (the largest element is `n-1`), so the sum is `n*(n-1)/2`, not `n*(n+1)/2`. The formula uses natural number subtraction, which saturates at 0 for `n = 0`. Verify with `native_decide` on a few small values to build intuition before using it in a proof.

---

### [L8.18] The Loogle search tool

[Loogle](https://loogle.lean-lang.org) is a web search engine for Mathlib theorems. You can search by:

**Name pattern:** `List.length` — finds all theorems with `List.length` in the name

**Type pattern:** `_ ++ _ → _ ∈ _` — finds theorems about membership in appended lists

**Mixed:** `Nat.Prime, _ < _` — finds theorems connecting primality with ordering

Sample Loogle queries:
- `Nat.add_comm` — find commutativity of addition
- `List.Sorted, List.map` — sorted + map interaction
- `∀ n, _ ≤ n * _` — multiplication bounds

---

### [L8.19] Putting it together: the recommended workflow

When you need a Mathlib theorem, follow this sequence:

1. Try the automated tactics (`omega`, `ring`, `simp`, `norm_num`) — they close most routine goals without searching.
2. Use `exact?` or `apply?` in VS Code: Lean4 searches loaded theorems and shows matches in the Infoview.
3. Search [Loogle](https://loogle.lean-lang.org) by name pattern or type signature.
4. Import the specific Mathlib module that contains what you need.

Here is the workflow applied to a list membership fact:

```lean
example (x : Nat) (l1 l2 : List Nat) (h : x ∈ l1) : x ∈ l1 ++ l2 :=
  List.mem_append.mpr (Or.inl h)
```

`List.mem_append` states `x ∈ l1 ++ l2 ↔ x ∈ l1 ∨ x ∈ l2`. The `.mpr` direction converts `x ∈ l1 ∨ x ∈ l2 → x ∈ l1 ++ l2`. We supply `Or.inl h` because `h : x ∈ l1` satisfies the left disjunct.

The pattern is consistent throughout Mathlib: find the right `↔` theorem, then use `.mp` or `.mpr` depending on which direction you need.

---

## 8.4 Import Strategy

Mathlib is organized into modules. Each `import` adds a module's theorems to scope. Common imports for software verification:

```lean
import Mathlib.Tactic              -- all standard tactics (omega, ring, simp, etc.)
import Mathlib.Data.Nat.Basic      -- basic Nat theorems
import Mathlib.Data.Int.Basic      -- basic Int theorems
import Mathlib.Data.List.Basic     -- list operations
import Mathlib.Data.List.Sort      -- List.Sorted, mergeSort
import Mathlib.Data.Nat.Prime.Basic -- prime number theory
```

If you want everything and do not mind slower compilation, `import Mathlib` imports all of Mathlib at once. For production use, import only what you need.

---

## 8.5 When Not to Use Mathlib

Mathlib is a tool, not a crutch. Write your own proofs when:
- You are learning — working through the proof yourself builds understanding
- The property is specific to your domain — Mathlib will not have your `BankAccount` theorem
- You need to understand why something is true, not just that it is

Use Mathlib when:
- The property is standard mathematics (arithmetic, list operations, order theory)
- You need a lemma as a stepping stone to something more domain-specific
- You want to avoid maintenance burden on elementary properties

---

## Exercises

1. **Find with Loogle:** Go to [loogle.lean-lang.org](https://loogle.lean-lang.org) and search for `Nat.Prime, _ < _`. What theorems connect primality with ordering? Find one that states every prime is less than some other prime (i.e., there is no largest prime). What is its name?

2. **Use `simp?`:** In VS Code, add this to `source/Ch08_Mathlib.lean` and observe the Infoview output:
   ```lean
   example (l : List Nat) : ([] ++ l) = l := by simp?
   ```
   What lemma does `simp?` report? Replace `simp?` with `simp only [that_lemma]` and verify it still compiles.

3. **Chain rewrites:** Prove the general map composition law using `simp [List.map_map]`:
   ```lean
   example (f : Nat → Nat) (g : Nat → Nat) (l : List Nat) :
       List.map f (List.map g l) = List.map (f ∘ g) l := by
     simp [List.map_map]
   ```
   Then use `decide` to confirm the concrete case: `List.map (· + 1) (List.map (· * 2) [1, 2, 3]) = [3, 5, 7]`.
