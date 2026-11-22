# Chapter 7: Proving Algorithm Correctness

**Source file:** `source/Ch07_Algorithms.lean`

---

## 7.1 What Does "Correct" Mean for an Algorithm?

In software development, we routinely talk about whether a sort is "correct" or a search is "correct." But what does that mean precisely?

For a **sorting algorithm**:
1. The output is in sorted (non-decreasing) order
2. The output contains exactly the same elements as the input (a permutation — nothing added, nothing dropped)

Both conditions are necessary. An algorithm that always returns an empty list satisfies condition 1 but obviously violates condition 2.

For a **search algorithm**:
1. **Soundness:** if it says the element is there, it really is (no false positives)
2. **Completeness:** if the element is there, the algorithm finds it (no false negatives)

In Lean4 we can state and prove all of these formally. This chapter does exactly that, for insertion sort and linear search.

---

## 7.2 Code Walkthrough

### [L7.1] Defining sortedness

```lean
def isSorted : List Nat → Prop
  | []           => True
  | [_]          => True
  | a :: b :: t  => a ≤ b ∧ isSorted (b :: t)
```

We define `isSorted` recursively over a list:
- **Empty list:** trivially sorted (vacuously true — nothing can be out of order)
- **Singleton:** trivially sorted (no pair of elements to compare)
- **Two or more elements `a :: b :: t`:** sorted if and only if `a ≤ b` (first two in order) AND the rest `b :: t` is also sorted

This is a *recursive specification*. It precisely captures what "sorted" means without any ambiguity.

---

### [L7.2] and [L7.3] Base cases

```lean
theorem L7_2_nil_sorted : isSorted [] := trivial
theorem L7_3_singleton_sorted (n : Nat) : isSorted [n] := trivial
```

Both the empty list and any singleton are sorted by definition. `trivial` is all you need — these are immediate from the definition.

---

### [L7.4] Checking concrete lists

```lean
example : isSorted [1, 2, 3, 5, 8] :=
  ⟨by omega, ⟨by omega, ⟨by omega, ⟨by omega, trivial⟩⟩⟩⟩
```

`isSorted [1, 2, 3, 5, 8]` unfolds to `1 ≤ 2 ∧ 2 ≤ 3 ∧ 3 ≤ 5 ∧ 5 ≤ 8 ∧ True`. Each `omega` handles one inequality and `trivial` closes the trailing `True`. Building this proof manually confirms the specification behaves as expected before attempting general proofs.

---

### [L7.5] Mathlib's general sorted predicate

```lean
#check @List.Pairwise        -- List.Pairwise : (α → α → Prop) → List α → Prop
#check @List.SortedLE        -- List.SortedLE : [Preorder α] → List α → Prop
```

Mathlib provides two general sorted predicates: `List.Pairwise r l` (every pair in order satisfies `r`) and `List.SortedLE l` (non-decreasing with respect to the preorder). `List.SortedLE` is equivalent to our `isSorted` for `Nat`. We define our own `isSorted` for pedagogical clarity, but in real Lean4 projects you would use these to access Mathlib's library of related theorems.

The `[Preorder α]` you see in `List.SortedLE`'s type is a *type class argument* — Lean4's mechanism for ad-hoc polymorphism. It means "this function requires an ordering instance for type `α`". Lean4 finds and fills in the instance automatically from its instance database; you do not supply it manually. You will see this pattern constantly in Mathlib. For now, read `[Preorder α]` as "for any type `α` that has a notion of ordering".

---

### [L7.6] Insertion into a sorted list

```lean
def insertSorted : Nat → List Nat → List Nat
  | n, []      => [n]
  | n, h :: t  => if n ≤ h then n :: h :: t else h :: insertSorted n t
```

`insertSorted n l` inserts `n` into the sorted list `l` in the correct position:
- If `l` is empty, return `[n]`
- If `l = h :: t`: if `n ≤ h`, insert at the front; otherwise put `h` first and recursively insert `n` into `t`

This is the core operation of insertion sort. Note the recursion decreases on `t` (the tail), guaranteeing termination.

---

### [L7.7] Building the sort

```lean
def insertionSort : List Nat → List Nat
  | []      => []
  | h :: t  => insertSorted h (insertionSort t)
```

`insertionSort` sorts a list by:
1. Recursively sorting the tail `t`
2. Inserting the head `h` into the correct position in the sorted tail

The recursion decreases on the list length (each call processes a shorter list), guaranteeing termination.

---

### [L7.8] Checking with examples

```lean
#eval insertSorted 3 [1, 2, 4, 5]      -- [1, 2, 3, 4, 5]
#eval insertionSort [5, 3, 1, 4, 2]   -- [1, 2, 3, 4, 5]
```

Always test with concrete examples before proving. These confirm:
- `insertSorted` inserts `3` between `2` and `4` in an already-sorted list
- `insertionSort` correctly sorts the list `[5, 3, 1, 4, 2]`

---

### [L7.9] Correctness Part 1: insertSorted produces sorted output

This is the hardest proof in the tutorial. The proof is by induction on `l`, but the inductive case splits into four sub-cases depending on whether `n ≤ a` and whether `t` is empty or has the form `b :: rest`. Read it with VS Code's Infoview open — the proof state changes significantly at each `split_ifs`.

```lean
theorem L7_9_insertSorted_sorted (n : Nat) (l : List Nat) (h : isSorted l) :
    isSorted (insertSorted n l) := by
  induction l with
  | nil => simp [insertSorted, isSorted]
  | cons a t ih =>
    simp only [insertSorted]
    split_ifs with hle
    · -- n ≤ a: insert at front, producing n :: a :: t
      cases t with
      | nil  => simp [isSorted, hle]
      | cons b rest =>
        simp only [isSorted]
        exact ⟨hle, by simpa [isSorted] using h⟩
    · -- n > a: a goes first, recurse on t
      cases t with
      | nil  =>
        -- t empty: result is [a, n], need a ≤ n
        simp only [insertSorted, isSorted]
        push Not at hle
        exact ⟨Nat.le_of_lt hle, trivial⟩
      | cons b rest =>
        -- t = b :: rest: case-split again on n ≤ b
        simp only [isSorted] at h
        simp only [insertSorted]
        split_ifs with hle2
        · -- n ≤ b: result head is n, need a ≤ n and isSorted (n :: b :: rest)
          simp only [isSorted]
          push Not at hle
          exact ⟨Nat.le_of_lt hle, hle2, h.2⟩
        · -- n > b: result head is b, need a ≤ b and isSorted (b :: insertSorted n rest)
          simp only [isSorted]
          refine ⟨h.1, ?_⟩
          have heq : insertSorted n (b :: rest) = b :: insertSorted n rest := by
            simp [insertSorted, if_neg hle2]
          rw [← heq]; exact ih h.2
```

**Base case (`l = []`):** `insertSorted n [] = [n]`, which is trivially sorted. `simp [insertSorted, isSorted]` closes it.

**Inductive case (`l = a :: t`):** `simp only [insertSorted]` unfolds the definition, then `split_ifs with hle` branches on whether `n ≤ a`:

**Branch 1 — `n ≤ a` (hle : n ≤ a):** The result is `n :: a :: t`. We sub-case on `t`:
- `t = []`: result is `[n, a]`, sorted because `n ≤ a`. `simp [isSorted, hle]` closes it.
- `t = b :: rest`: result is `n :: a :: b :: rest`. `isSorted` of this unfolds to `n ≤ a ∧ isSorted (a :: b :: rest)`. The first part is `hle`; the second is `h` (the hypothesis that `a :: b :: rest` is sorted). `simpa [isSorted] using h` extracts it.

**Branch 2 — `n > a` (hle : ¬ n ≤ a):** `push Not at hle` converts `¬ n ≤ a` to `a < n`. The result starts with `a`, so we need `a ≤ head(insertSorted n t)`. We sub-case on `t`:
- `t = []`: result is `[a, n]`. We need `a ≤ n`, which follows from `a < n` via `Nat.le_of_lt`.
- `t = b :: rest`: a second `split_ifs with hle2` on whether `n ≤ b`:
  - **`n ≤ b`**: `insertSorted n (b :: rest) = n :: b :: rest`, so result is `a :: n :: b :: rest`. We need `a ≤ n` (from `a < n`) and `n ≤ b` (from `hle2`) and `isSorted (b :: rest)` (from `h.2`).
  - **`n > b`**: `insertSorted n (b :: rest) = b :: insertSorted n rest`, so result is `a :: b :: insertSorted n rest`. We need `a ≤ b` (from `h.1`) and `isSorted (b :: insertSorted n rest)`.

    The last part is where `have heq` matters. The inductive hypothesis `ih` was generated for `t = b :: rest`, so `ih : isSorted (b :: rest) → isSorted (insertSorted n (b :: rest))`. But our goal after `refine ⟨h.1, ?_⟩` is `isSorted (b :: insertSorted n rest)` — which is *definitionally different* from `isSorted (insertSorted n (b :: rest))` even though they are equal. The `have heq` proves `insertSorted n (b :: rest) = b :: insertSorted n rest` (using `simp` with the `n > b` case of the definition), and `rw [← heq]` converts the goal to `isSorted (insertSorted n (b :: rest))`, at which point `exact ih h.2` closes it.

---

### [L7.10] Correctness: insertionSort produces sorted output

```lean
theorem L7_10_insertionSort_sorted (l : List Nat) : isSorted (insertionSort l) := by
  induction l with
  | nil       => simp [insertionSort, isSorted]
  | cons h t ih =>
    simp [insertionSort]
    exact L7_9_insertSorted_sorted h (insertionSort t) ih
```

This proof composes directly with [L7.9]:

- **Base case:** `insertionSort [] = []`, which is sorted trivially.
- **Inductive case:** `insertionSort (h :: t) = insertSorted h (insertionSort t)`.
  - `ih` tells us `insertionSort t` is sorted (the inductive hypothesis)
  - `L7_9_insertSorted_sorted` says inserting into a sorted list gives a sorted list
  - Combining: `insertSorted h (insertionSort t)` is sorted ✓

This is the beauty of compositional proofs: we proved [L7.9] independently, and [L7.10] reuses it with almost no additional work.

---

### [L7.11] Element count preservation

```lean
#check List.Perm    -- List.Perm : List α → List α → Prop
```

The full correctness condition for a sort is that the output is a *permutation* of the input — same elements, just reordered. `List.Perm l1 l2` is Mathlib's predicate for this: `l1` is a rearrangement of `l2`.

We prove the weaker property of **length preservation** here rather than a full permutation proof. Length preservation is a necessary condition (a list with different length cannot be a permutation) and tractable to prove in a few lines. A full `List.Perm` proof for insertion sort is significantly longer.

For production use, search Mathlib for `List.insertionSort_perm` or use `List.mergeSort` from Chapter 9, which ships with a full permutation proof. Mathlib's `List.Perm` has a rich associated theory: `List.Perm.length`, `List.Perm.mem_iff`, `List.Perm.append`, and more.

---

### [L7.12] Preservation of length

```lean
theorem L7_12_insertSorted_length (n : Nat) (l : List Nat) :
    (insertSorted n l).length = (n :: l).length := by
  induction l with
  | nil       => simp [insertSorted]
  | cons h t ih =>
    simp only [insertSorted]
    split_ifs
    · simp
    · simp [ih]
```

We prove that `insertSorted` preserves the total number of elements. This is weaker than a full permutation proof but easier to prove and still meaningful.

**Induction on `l`:**
- **Empty:** `insertSorted n [] = [n]`, length 1 = `(n :: []).length = 1`. `simp [insertSorted]` closes it.
- **`h :: t`:** `simp only [insertSorted]` exposes the `if n ≤ h` branch. `split_ifs` creates two subgoals:
  - `n ≤ h` branch: result is `n :: h :: t`, length = `(n :: h :: t).length`. `simp` closes it.
  - `n > h` branch: result is `h :: insertSorted n t`, length = `1 + (insertSorted n t).length`. The inductive hypothesis `ih` gives `(insertSorted n t).length = (n :: t).length`, so `simp [ih]` closes it.

---

### [L7.13] insertionSort preserves length

```lean
theorem L7_13_insertionSort_length (l : List Nat) :
    (insertionSort l).length = l.length := by
  induction l with
  | nil       => simp [insertionSort]
  | cons h t ih =>
    simp only [insertionSort]
    rw [L7_12_insertSorted_length]
    simp [ih]
```

Composed from [L7.12]: the total element count is preserved through the sort.

- **Empty:** immediate.
- **`h :: t`:** `insertionSort (h :: t) = insertSorted h (insertionSort t)`. By [L7.12], `(insertSorted h (insertionSort t)).length = (h :: insertionSort t).length`. After `rw`, the goal reduces to `(h :: insertionSort t).length = (h :: t).length`, which `simp [ih]` closes using the inductive hypothesis `ih : (insertionSort t).length = t.length`.

This is a necessary (though not sufficient) condition for the sort being a permutation.

---

### [L7.14] Linear search

```lean
def linearSearch (target : Nat) : List Nat → Option Nat
  | []      => none
  | h :: t  => if h = target then some h else linearSearch target t
```

Linear search scans the list from left to right. It returns `some target` if found, `none` if not. The return type `Option Nat` makes the "not found" case explicit in the type — no null pointer, no sentinel value.

---

### [L7.15] Soundness: no false positives

```lean
theorem L7_15_search_sound (target : Nat) (l : List Nat) :
    linearSearch target l = some target → target ∈ l := by
  induction l with
  | nil       => simp [linearSearch]
  | cons h t ih =>
    simp only [linearSearch]
    split_ifs with heq
    · intro; simp [heq]
    · intro hfound
      exact List.mem_cons.mpr (Or.inr (ih hfound))
```

**Reading the theorem:** "if `linearSearch` returns `some target`, then `target` is in `l`."

**Proof by induction on `l`:**
- **Empty list:** `linearSearch target [] = none ≠ some target`, so the hypothesis is vacuously false. `simp [linearSearch]` closes it.
- **`h :: t`:** split on whether `h = target`:
  - **Yes:** result is `some h = some target`. Since `h = target`, we have `target ∈ h :: t` (by `List.mem_cons`, taking the `inl` branch).
  - **No:** result is `linearSearch target t`. If this equals `some target`, by the inductive hypothesis `ih`, `target ∈ t`. Then `target ∈ h :: t` by `List.mem_cons`, taking the `inr` branch.

---

### [L7.16] Completeness: no false negatives

```lean
theorem L7_16_search_complete (target : Nat) (l : List Nat) (h : target ∈ l) :
    linearSearch target l = some target := by
  induction l with
  | nil       => simp at h
  | cons x t ih =>
    simp only [linearSearch]
    by_cases heq : x = target
    · simp [heq]
    · simp only [if_neg heq]
      apply ih
      rcases List.mem_cons.mp h with rfl | hmem
      · exact absurd rfl heq
      · exact hmem
```

**Reading the theorem:** "if `target` is in `l`, then `linearSearch` finds it."

**Proof by induction on `l`:**
- **Empty list:** `target ∈ []` is impossible. `simp at h` derives `False` from `h` and closes the goal.
- **`x :: t`:** `simp only [linearSearch]` exposes the `if x = target` branch. `by_cases heq : x = target` splits:
  - **Head match (`x = target`):** `simp [heq]` simplifies `if x = target` to `true` and the result to `some x = some target`.
  - **No match (`x ≠ target`):** `simp only [if_neg heq]` removes the dead branch. We then `apply ih`, which requires proving `target ∈ t`. We use `rcases List.mem_cons.mp h` to split `target ∈ x :: t`:
    - `rfl` branch: `target = x`. But `heq : x ≠ target` contradicts this — `exact absurd rfl heq` closes it.
    - `hmem` branch: `target ∈ t`. This is exactly what `ih` needs.

---

## 7.3 Two Sides of Every Algorithm

Every algorithm has two correctness properties — soundness and completeness:

| Algorithm | Soundness | Completeness |
|---|---|---|
| Sort | Output is sorted | Output is a permutation of input |
| Search | If found, it's there | If it's there, it's found |
| Parser | Parsed text is valid | All valid texts are parsed |
| Type checker | Typed programs are correct | All correct programs are typeable |

Lean4 lets you state and prove both. Many bugs in real systems violate exactly one of these: a parser that accepts invalid input (unsound), or a search that misses valid results (incomplete).

Writing both theorems for your algorithm forces you to think about both failure modes before they become bugs in production.

---

## Exercises

1. **Early-exit search on sorted lists:** Define `sortedSearch (target : Nat) : List Nat → Option Nat` that, like `linearSearch`, scans left to right, but short-circuits and returns `none` as soon as it encounters an element greater than `target` (valid because the list is sorted). Prove soundness: if `sortedSearch target l = some target` then `target ∈ l`. (Hint: the proof structure is the same as [L7.15] — induction, `split_ifs`, `simp`.)

2. **Reverse preserves length:** Prove `∀ l : List Nat, (List.reverse l).length = l.length` by induction on `l`. Use `List.length_reverse` to check your answer — but write the induction proof by hand first to build intuition. (Hint: in the `cons` case, `List.reverse (h :: t) = List.reverse t ++ [h]`, so you need `List.length_append`.)

3. **insertionSort is idempotent:** Conjecture: `∀ l, insertionSort (insertionSort l) = insertionSort l`. Prove it for the base case and sketch the inductive argument. The key lemma you would need is: "inserting `n` into a sorted list that already contains `n` in the correct position returns the list unchanged." This is challenging to prove fully — the exercise is to identify what helper lemmas are required and state them, even if you leave their proofs as `sorry`.
