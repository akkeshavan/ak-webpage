---
layout: post.njk
title: "When Does a Programming Language Become a Proof Assistant?"
date: 2026-11-28
permalink: /blog/when-does-a-language-become-a-proof-assistant/
---

*Or: How to Accidentally Build a Mathematician Out of a Compiler*

Every programming language is born with humble goals. Shuffle some bytes, print "Hello, World," crash spectacularly in production on a Friday — that is the whole dream.

Then somebody introduces a **type system**, and suddenly the atmosphere changes entirely.

Give it a few years and that modest little language has donned a tweed jacket, taken up muttering about logical foundations, and quietly become **Lean 4** or **Coq** — a proof assistant that will not compile so much as a function signature until you have produced a mathematical demonstration that reality coheres.

So how exactly does this happen? What follows is a stage-by-stage account of one type system's slow, slightly terrifying radicalisation.

---

## Stage 1: The Bouncer at the Door (Basic Static Types)

It all starts simply enough: `int` and `string`.

Think of basic static types as a courteous British bouncer posted at a pub entrance. What happens inside is none of their business — just come wearing shoes. Try adding `"cup of tea"` to `42` and the compiler draws itself up, murmurs *"My apologies, sir, incompatible categories,"* and blocks the door.

A fair number of foolish errors are stopped right there. Dividing by zero, reading past the end of an array, or depositing `-£50` into a customer's account — all of these remain perfectly acceptable to the compiler. It waves you through without comment, and the explosion comes later, at runtime, with great elegance.

---

## Stage 2: The Sum Type (Algebraic Data Types)

There is a quieter escalation that tends to slip past unnoticed before the truly alarming stages: **algebraic data types**.

"Algebraic" is an off-putting word for a simple concept. A type falls into one of two shapes:

- a **product type**: a record that carries *every* field simultaneously (think AND)
- a **sum type**: a tagged union that holds exactly *one* of its possible variants (think OR)

```
-- A product type: a point has BOTH an x AND a y
type Point = { x: Float, y: Float }

-- A sum type: a shape is EITHER a circle OR a rectangle OR a triangle
type Shape =
    | Circle(radius: Float)
    | Rectangle(width: Float, height: Float)
    | Triangle(base: Float, height: Float)
```

You have worked with product types throughout your career — they are ordinary structs. Sum types are the interesting part. When you pattern-match on a `Shape`, the compiler tracks precisely which variant you have, and it *insists* you cover every case. Leave out the `Triangle` arm? Compile error.

It reads like a small convenience until you notice what it wipes out: every bug in which an object occupies a state that should never exist. Take the classic example:

```
-- Without sum types: a network response modelled badly
type Response = {
    data:  String | null,
    error: String | null,
}
-- Nothing stops you from having BOTH data AND error set.
-- Or NEITHER. Your code has to defend against four states, two of which are nonsense.

-- With sum types: impossible states made unrepresentable
type Response =
    | Success(data: String)
    | Failure(error: String)
-- Now there are exactly two states, both meaningful. Done.
```

The compiler has stopped merely verifying types. It is now *imposing the semantics of your domain at the structural level*. That is a genuine philosophical leap hiding inside what looks like a minor syntax addition — and most developers walk right past it.

---

## Stage 3: The Last Exit Before Haskell (Higher-Kinded Types)

Up to this point, things have been manageable. `List<String>` is a list of strings. `Option<Int>` is an integer that might not be there. Any reasonable programmer can follow this.

Then someone notices a pattern.

`List<A>`, `Option<A>`, `Future<A>`, `Tree<A>` — they all have the same shape: a thing that wraps another thing, and you can transform the inner thing without disturbing the wrapper. Write a function to double every number in a list; write another to double the number inside an `Option`; write another for `Future`. Or — and here is the dangerous thought — write it *once*, for any wrapper whatsoever.

This requires abstracting not over a type, but over a *type constructor*: something that is not itself a complete type, but becomes one when handed an argument. `List` is not a type. `List<String>` is a type. `List` is a **higher-kinded type** — a type of kind `Type → Type`.

```
-- Regular type parameters stand for concrete types (Int, String, ...)
type Option<A>   -- A is a concrete type

-- A higher-kinded type parameter stands for a type CONSTRUCTOR
-- F<_> is not a type — it becomes one only when applied to something
interface Functor<F<_>> {
    map<A, B>(container: F<A>, transform: A -> B) -> F<B>
}

-- Implement it for List
instance Functor for List {
    map(xs: List<A>, f: A -> B) -> List<B> { ... }
}

-- Implement it for Option
instance Functor for Option {
    map(opt: Option<A>, f: A -> B) -> Option<B> { ... }
}

-- Now write ONE function that works for any Functor:
function doubleAll<F: Functor>(container: F<Int>) -> F<Int> {
    return map(container, x => x * 2)
}

doubleAll([1, 2, 3])   -- [2, 4, 6]
doubleAll(Some(5))     -- Some(10)
doubleAll(None)        -- None
-- Same function. Zero duplication.
```

This is elegant. It is also the stage at which an alarming number of developers quietly close their Haskell tutorial, make a cup of tea, and go back to writing Python.

The problem is not that higher-kinded types are hard to *use*. It is that they are hard to *explain*. The moment you write `F<_>` in a function signature and a colleague asks what it means, you find yourself saying "well, it's a type of kind `* → *`, which is to say a type constructor that..." — and by the time you have finished the sentence, your colleague has submitted a transfer request to the infrastructure team.

Java famously does not have higher-kinded types. Neither does Go. Kotlin added limited support. Scala has them, though the syntax is sufficiently unusual that the Scala community spent several years building a library (Cats) primarily to tame the experience. Haskell has them natively, cleanly, and uses them everywhere — which is exactly why Haskell has the reputation it has.

At this stage, the type system is no longer just preventing bugs. It is structuring *computation patterns* themselves as reusable abstractions. That is genuinely powerful. It is also, for a great many developers, the point where the cost-benefit calculation tips the wrong way and functional programming becomes something other people do.

---

## Stage 4: The Pedantic Accountant (Refinement Types)

At some point, the `-£50` bank balance conversation grows tiresome. The industry's response is **refinement types** — the approach taken in Liquid Haskell and F\* — which let you stick small logical predicates directly onto your types.

Instead of a bare `Int`, you now write things like:

```
-- A plain Int: compiler trusts you completely
type Age = Int

-- A refined Int: compiler demands proof
type Age = { n: Int | n >= 0 && n <= 150 }

-- A refined List: guaranteed non-empty
type NonEmptyList<T> = { xs: List<T> | length(xs) > 0 }

-- A refined index: guaranteed in bounds for a given list
type ValidIndex<T>(xs: List<T>) = { i: Int | 0 <= i && i < length(xs) }
```

To see the difference in practice, consider a `divide` function:

```
-- Liquid Haskell-style (pseudocode)
function divide(a: Int, b: { n: Int | n != 0 }) -> Int {
    return a / b
}

-- Now try calling it:
divide(10, 0)       -- Compile error: 0 does not satisfy n != 0
divide(10, x)       -- Compile error unless you first prove x != 0
divide(10, x) where x != 0  -- Fine. The proof is in the guard.
```

Behind the scenes the compiler has now taken on an SMT solver as a subcontractor whose job is to audit your arithmetic. Try passing something that could conceivably be zero to `divide`, and the compiler will not budge until you have added the guard that rules it out.

Your language has formally withdrawn its faith in you. The question it now asks is not *what shape* the data has but *what can be asserted* about it.

---

## Stage 5: The Full-Blown Philosopher (Dependent Types)

Then one day, someone poses a question that really ought to have come with a warning label: *"Why are types and values locked in separate compartments? What if a type could reference a value directly?"*

That question leads to **dependent types** — the point at which programming stops being programming and becomes, without ceremony, mathematics.

In a dependently typed language — Idris, Agda, Coq, Lean 4 — a type is not merely `List<String>` anymore. It can be `Vector<String, n>`, where `n` is a *concrete runtime integer* encoding the list's exact length. That length is not just stored in the data; it lives inside the type itself.

```
-- A vector whose LENGTH is part of its type
type Vector<T, n: Nat>   -- n is a value, not a type parameter

-- Append: the return type does arithmetic
function append<T>(
    xs: Vector<T, n>,
    ys: Vector<T, m>
) -> Vector<T, n + m>    -- the compiler verifies this arithmetic

-- Head: only callable on non-empty vectors
function head<T>(xs: Vector<T, n + 1>) -> T
-- You cannot call head on a Vector<T, 0>.
-- The type *is* the proof that the vector is non-empty.
-- There is no runtime check. There is no null. The mistake is simply unrepresentable.
```

The canonical example is indexing into an array safely:

```
-- A "Fin n" type represents any integer in the range [0, n-1]
type Fin(n: Nat)   -- values: 0, 1, ..., n-1

function safeIndex<T>(xs: Vector<T, n>, i: Fin(n)) -> T {
    return xs[i]   -- provably in bounds. No bounds check needed at runtime.
}

-- To call it, you must produce a Fin(n) — a value that is *by construction*
-- a valid index into a vector of length n.
safeIndex(myVec, 3)   -- only works if myVec has length > 3, proven at compile time
```

A correct dependently typed program has no array-out-of-bounds exceptions — not because anything intercepted them at runtime, but because the compiler demonstrated, before the program ever ran, that reaching an invalid index is impossible.

---

## Stage 6: The Curry-Howard Revelation (Welcome to Lean 4)

Once types can range over values, arithmetic, and logical structure, something unexpected comes into view — a precise, famous symmetry called the **Curry-Howard correspondence**:

| Programming | Mathematics |
|---|---|
| A type | A proposition (a statement to be proved) |
| A value of that type | A proof of that proposition |
| A function `A -> B` | An implication: if A then B |
| A product type `(A, B)` | A conjunction: A and B |
| A sum type `A \| B` | A disjunction: A or B |
| An empty type (no values) | A false statement (no proof exists) |

None of this is analogy. The correspondence is exact and formal. In a dependently typed language, every type is at once a data type *and* a proposition. Every program that type-checks is simultaneously a computation *and* a proof of the proposition it encodes.

Here is what it looks like when you sit down in Lean 4 and actually *use* it as a proof assistant:

```
-- Claim: reversing a list twice gives back the original list
-- This is a TYPE. It is a proposition.
theorem reverse_reverse (xs : List α) : reverse (reverse xs) = xs := by
    induction xs with
    | nil        => rfl          -- base case: empty list trivially holds
    | cons x xs ih =>
        simp [reverse, ih]       -- inductive step: simplify using the hypothesis

-- If Lean accepts this, you have not written a test.
-- You have produced a proof that holds for EVERY list,
-- of EVERY length, containing EVERY possible element type,
-- including lists longer than the number of atoms in the observable universe.
```

Nobody much cares whether the binary runs. Getting the code through the type checker *is* the deliverable.

### The leap from dependent types to Lean 4

What actually changes in that last step, and why it matters:

**In Idris or Agda**, dependent types give you the vocabulary to *state* propositions as types and *build* proofs as programs. The mental model is still largely a programmer's: write functions, manipulate terms, let the proof emerge.

**In Lean 4**, a complete *tactic language* sits on top of all of this. Rather than constructing the proof term in one go — which for a non-trivial theorem can be enormous and nearly unreadable — you hand the system a sequence of *proof obligations*: `intro`, `apply`, `induction`, `simp`, `omega`. Lean builds the underlying term from those steps and verifies each one as it goes.

```
-- Direct proof term style (like Idris/Agda): you build the whole structure at once
proof_of_commutativity := fun n m => Nat.add_comm n m

-- Tactic style (Lean 4's superpower): you work interactively, step by step
theorem add_comm (n m : Nat) : n + m = m + n := by
    induction n with
    | zero      => simp           -- 0 + m = m + 0, trivially
    | succ n ih => simp [ih]      -- (n+1) + m = m + (n+1), using inductive hypothesis
```

Tactic mode is what turns Lean 4 from an interesting experiment into a tool that working mathematicians actually use. Theorems with hundreds of intermediate steps are routine. The [Lean Mathlib library](https://leanprover-community.github.io/mathlib4_docs/) holds over 100,000 theorems written this way.

The question posed to the compiler has changed entirely. It is no longer *"does this run?"* but *"is this true?"* — and the answer comes back as either a proof certificate or a precise account of where your reasoning went wrong.

---

## The Verdict

A programming language crosses into proof-assistant territory the moment the question you put to the compiler shifts from *"Will this run?"* to *"Is this true?"*

| Stage | What it checks | What slips through |
|---|---|---|
| Basic types | Shape of data | Wrong values, wrong logic |
| Algebraic types | Structural exhaustiveness | Incorrect values within valid shapes |
| Higher-kinded types | Computation patterns as abstractions | Your colleagues' patience |
| Refinement types | Logical predicates on values | Properties requiring induction |
| Dependent types | Relationships between values and types | Nothing: unrepresentable states are impossible |
| Proof assistant | Mathematical truth | Incorrect axioms (but those are your problem) |

Basic types verify that your pipes connect. Algebraic types rule out the configurations that should never be connected in the first place. Refinement types certify that the pressure stays within acceptable bounds. Dependent types require a stamped structural-engineering report demonstrating the building remains standing for the next thousand years — and they will not let you open a single valve until they have it in hand.

Lean 4 provides the capstone: it takes that certificate, slides it back across the desk, and asks you to prove the certificate itself is valid.

What is worth noting is that none of this is exclusive to formal mathematicians. Each time you reach for a `NonEmptyList` over a plain `List`, each time a sum type replaces a nullable field, each time you push an invariant into the type signature rather than leaving it as a runtime assertion — you are on the same road, just not yet at the far end.

You are, knowingly or not, turning your compiler into a mathematician.
