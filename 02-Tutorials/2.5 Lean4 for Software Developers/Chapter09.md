# Chapter 9: Lean4 in the Software Development Life Cycle

**Source file:** `source/Ch09_SDLC.lean`

---

## 9.1 Where Does Formal Verification Fit?

Formal verification does not replace testing, code review, or agile practices. It sits alongside them, adding a layer of correctness that no amount of testing can provide: **mathematical certainty**.

Here is how verification maps to familiar SDLC phases:

| SDLC Phase | Verification Activity |
|---|---|
| **Requirements** | Write specifications as types and propositions |
| **Design** | Define data structures with invariants in types |
| **Implementation** | Write functions; proof obligations appear immediately |
| **Testing** | Theorems *are* the tests — but they cover all cases |
| **Code Review** | The type checker enforces contracts mechanically |
| **Documentation** | Theorems serve as living, executable documentation |

This chapter shows practical patterns for applying Lean4 in each phase.

---

## 9.2 Code Walkthrough

### [L9.1] Invariants encoded in types

```lean
structure BankAccount where
  balance    : Int
  non_neg    : balance ≥ 0
```

A `BankAccount` is a *structure* — Lean4's equivalent of a record or struct. It has two fields:
- `balance : Int` — the actual balance value
- `non_neg : balance ≥ 0` — **a proof** that the balance is non-negative

The invariant `balance ≥ 0` is not a runtime assertion. It is baked into the type. You cannot create a `BankAccount` with a negative balance any more than you can create a value of type `Nat` that is negative — the type system forbids it.

**Compare with the traditional approach:**
```python
class BankAccount:
    def __init__(self, balance):
        assert balance >= 0, "balance cannot be negative"
        self.balance = balance
```

The Python assertion runs at runtime and can be bypassed. The Lean4 proof runs at compile time and cannot.

---

### [L9.2] Creating an instance

```lean
def exampleAccount : BankAccount := { balance := 1000, non_neg := by omega }
```

We create a `BankAccount` with balance 1000. The second field `non_neg` must be a proof that `1000 ≥ 0`. We use `by omega` — a one-liner that the `omega` tactic discharges automatically.

Try replacing `1000` with `-10`. Lean4 will show a type error: `omega` cannot prove `-10 ≥ 0`, because that is false.

---

### [L9.3] Deposit: precondition-protected operation

```lean
def deposit (acct : BankAccount) (amount : Int) (h : amount > 0) : BankAccount :=
  { balance := acct.balance + amount,
    non_neg  := by linarith [acct.non_neg] }
```

The deposit function:
- Takes the account, an amount, and `h : amount > 0` (a proof the deposit is positive)
- Returns a new `BankAccount`
- Must prove the returned account's invariant: `acct.balance + amount ≥ 0`

The proof `by linarith [acct.non_neg]` works because:
- `acct.non_neg : acct.balance ≥ 0`
- `h : amount > 0`, so `amount ≥ 1`
- Therefore `acct.balance + amount ≥ 0 + 1 > 0 ≥ 0`

`linarith` handles this automatically, using the hypotheses. The compiler forces us to prove the invariant is maintained — we cannot write a deposit function that violates it, even accidentally.

---

### [L9.4] Withdrawal: strong preconditions

```lean
def withdraw (acct : BankAccount) (amount : Int)
    (_h_pos : amount > 0) (h_funds : amount ≤ acct.balance) : BankAccount :=
  { balance := acct.balance - amount,
    non_neg  := by linarith [acct.non_neg] }
```

Withdrawal requires **two** preconditions:
1. `_h_pos : amount > 0` — you cannot withdraw a negative amount (prefixed `_` because the proof is not used in the function body, only at the call site)
2. `h_funds : amount ≤ acct.balance` — you cannot overdraw

The invariant proof: `acct.balance - amount ≥ 0`. Since `amount ≤ acct.balance`, this follows directly. `linarith` handles it.

Any code that calls `withdraw` must supply both proofs. This eliminates the entire class of overdraft bugs — not by checking at runtime, but by making it structurally impossible.

---

### [L9.5] Proving deposit increases balance

```lean
theorem L9_5_deposit_increases (acct : BankAccount) (amount : Int) (h : amount > 0) :
    (deposit acct amount h).balance > acct.balance := by
  simp [deposit]
  linarith
```

This theorem states a business rule: "a deposit always increases the balance." This is the kind of property that a QA team would test with a few sample values. Here we prove it for **all** accounts and **all** positive amounts.

`simp [deposit]` unfolds the function definition, and `linarith` handles the resulting arithmetic inequality using `h : amount > 0`.

---

### [L9.6] Proving withdrawal decreases balance

```lean
theorem L9_6_withdraw_decreases (acct : BankAccount) (amount : Int)
    (h1 : amount > 0) (h2 : amount ≤ acct.balance) :
    (withdraw acct amount h1 h2).balance < acct.balance := by
  simp [withdraw]
  linarith
```

Symmetric: "a withdrawal always decreases the balance." These two theorems together form the core specification of `BankAccount` — and they are proved, not assumed.

---

### [L9.7] Validated input types

```lean
def isValidEmail (s : String) : Bool := s.contains '@'

structure ValidEmail where
  address : String
  valid   : isValidEmail address = true
```

This pattern encodes input validation in the type:
- `isValidEmail` is a simple Boolean check
- `ValidEmail` is a structure that can only be built if the address passes the check

Any function taking a `ValidEmail` argument is guaranteed to receive a valid address. The validation happens at the point of construction, never at the point of use.

---

### [L9.8] Functions that accept only valid inputs

```lean
def sendEmail (recipient : ValidEmail) (body : String) : String :=
  s!"Sending to {recipient.address}: {body}"
```

`sendEmail` takes a `ValidEmail` — not a `String`. No guard clause needed inside the function. The type ensures validity before the function is even called. In a large codebase this propagates naturally: validate once at the boundary (user input), and the type carries that guarantee to every downstream caller.

A developer writing this code will immediately ask: how do you actually *build* a `ValidEmail` value? At the point where user input is received, call `isValidEmail` and branch on the result:

```lean
def parseEmail (s : String) : Option ValidEmail :=
  if h : isValidEmail s = true then
    some { address := s, valid := h }
  else
    none
```

The `if h : P then ... else ...` form — called *if-let with proof binding* — gives you `h : P` in the true branch, which is exactly the proof `ValidEmail` needs. Validation happens once at the boundary; the type system ensures it is never skipped downstream.

---

### [L9.9] Positive-valued types

```lean
structure PositiveInt where
  val     : Int
  pos     : val > 0
```

Similarly, `PositiveInt` is an integer that is provably positive. Any function accepting a `PositiveInt` can use the field `pos : val > 0` in its proofs without checking.

---

### [L9.10] Safe exponentiation

```lean
def safePow (base : PositiveInt) (exp : Nat) : PositiveInt :=
  { val := base.val ^ exp,
    pos := pow_pos base.pos exp }
```

`safePow` raises a `PositiveInt` to a power and returns a `PositiveInt`. The proof obligation — "positive raised to any power is positive" — is met by `pow_pos` from Mathlib. The type signature guarantees this function never returns a non-positive result.

---

### [L9.11] State machines as inductive types

```lean
inductive TrafficLight
  | red | yellow | green
  deriving DecidableEq
```

Model state machines as inductive types. Each constructor is a state. The `deriving DecidableEq` generates a decidable equality checker automatically. In most languages, state machines are implemented as enums or strings. Lean4's type system enforces **exhaustiveness**: you cannot forget to handle a state.

`deriving DecidableEq` asks Lean4 to automatically generate an equality-checking function for `TrafficLight`. Without it, you cannot write `if s = .red then ...` because Lean4 would not know how to compare states for equality. `deriving` is Lean4's mechanism for auto-generating instances of *type classes* — here, the `DecidableEq` type class. You will see `deriving Repr`, `deriving Inhabited`, and others in Lean4 code; each generates a different piece of functionality automatically.

---

### [L9.12] Exhaustive transition function

```lean
def nextLight : TrafficLight → TrafficLight
  | .red    => .green
  | .green  => .yellow
  | .yellow => .red
```

Every case is handled. If you add a new state to `TrafficLight` (e.g., `| flashing`) without updating `nextLight`, Lean4 gives a compile error: "non-exhaustive match." This is a *structural* guarantee — the same guarantee that algebraic data types give you in Haskell or Rust.

---

### [L9.13] Safety property: yellow always leads to red

```lean
theorem L9_13_yellow_to_red : nextLight .yellow = .red := by rfl
```

A pure fact about the transition function. Proved by `rfl` because the function literally says `| .yellow => .red`.

This is the simplest form of a *safety property*: "state X always goes to state Y." In a real traffic light controller, you would have properties like "green never follows red directly" or "the system cannot get stuck in green indefinitely."

---

### [L9.14] The cycle has period 3

```lean
theorem L9_14_cycle_period_3 (s : TrafficLight) : nextLight (nextLight (nextLight s)) = s := by
  cases s <;> rfl
```

Three transitions always return to the same state. `cases s` splits into three sub-goals (one per constructor), and `rfl` closes each because `nextLight` is a computed function:
- red → green → yellow → red ✓
- green → yellow → red → green ✓
- yellow → red → green → yellow ✓

`<;>` means "apply the following tactic to all remaining goals simultaneously."

---

### [L9.15]–[L9.17] A proven stack

```lean
structure Stack (α : Type) where
  data : List α

def Stack.push (s : Stack α) (x : α) : Stack α := { data := x :: s.data }
def Stack.peek (s : Stack α) (h : s.data ≠ []) : α := s.data.head h
def Stack.pop  (s : Stack α) (_ : s.data ≠ []) : Stack α := { data := s.data.tail }

theorem L9_17_push_peek (s : Stack α) (x : α) :
    (s.push x).peek (List.cons_ne_nil x s.data) = x := by
  simp [Stack.push, Stack.peek]
```

This is a generic stack with a key property: `push` then `peek` returns the pushed element. The proof is immediate via `simp` because the definitions reduce directly.

Notice `peek` and `pop` require a proof `h : s.data ≠ []` — the non-emptiness precondition. You cannot call `peek` on an empty stack. Compare with typical code that either throws a runtime exception or returns `null`. Here, the type system prevents the call entirely.

---

### [L9.18] Push guarantees non-emptiness

```lean
theorem L9_18_push_nonempty (s : Stack α) (x : α) :
    (s.push x).data ≠ [] := List.cons_ne_nil x s.data
```

After a `push`, the stack is guaranteed non-empty. This means you can call `peek` immediately after `push` without any emptiness check. The types carry this information forward.

---

### [L9.19] Specification-driven development

```lean
def SortSpec (sort : List Nat → List Nat) : Prop :=
  ∀ l : List Nat,
    (sort l).length = l.length ∧
    (sort l).SortedLE
```

This is the specification of a correct sort function as a proposition. **Write the spec first** — before the implementation. This is the theorem-proving equivalent of Test-Driven Development:

1. Write `SortSpec` — what must any correct sort function do?
2. Implement a sort function
3. Prove it satisfies `SortSpec`

If you cannot prove step 3, either your implementation is wrong or your spec is wrong. Either way, you discover the problem before shipping.

---

### [L9.20] Mathlib's mergeSort

```lean
#check @List.mergeSort              -- List.mergeSort : List α → (α → α → Bool) → List α
#check @List.sortedLE_mergeSort     -- sorted result
#check @List.length_mergeSort       -- length preserved
```

Mathlib provides `List.mergeSort` with full correctness proofs. Rather than implementing and proving your own sort, you can use this — knowing it has been formally verified.

---

### [L9.21] Proving mergeSort satisfies the spec

```lean
theorem L9_21_mergeSort_correct :
    SortSpec (fun l => l.mergeSort (fun x y => decide (x ≤ y))) := by
  intro l
  constructor
  · exact List.length_mergeSort l
  · exact List.sortedLE_mergeSort
```

We prove that `List.mergeSort` satisfies our `SortSpec` by:
1. Introducing the list `l`
2. Splitting the conjunction (`constructor`)
3. Proving length preservation using `List.length_mergeSort`
4. Proving sortedness using `List.sortedLE_mergeSort`

Both proofs are one-liners using Mathlib theorems. The hard work was done by the Mathlib authors; we just connect their theorems to our specification.

---

### What if the invariant proof fails?

```lean
-- This FAILS — omega cannot prove -10 ≥ 0:
-- def badAccount : BankAccount := { balance := -10, non_neg := by omega }
-- Error: omega could not close the goal: -10 ≥ 0

-- This FAILS at the type level, not at runtime:
-- def overdraft (acct : BankAccount) : BankAccount :=
--   { balance := acct.balance - 999999, non_neg := by linarith [acct.non_neg] }
-- Error: linarith failed to find a contradiction
--        (acct.balance - 999999 may be negative; the proof is not available)
```

The second example shows the real value: attempting to write a function that could overdraft the account produces a *compile error*, not a runtime exception. The proof obligation `non_neg` is the mechanism that makes the invariant structural — you cannot bypass it by accident or in a future refactor.

---

## 9.3 When to Use Formal Verification

Formal verification has costs (proof effort, learning curve) and benefits (absolute correctness guarantees). It is most valuable when:

**High-value targets:**
- Security-critical code (authentication, cryptography, access control)
- Financial calculations (balances, interest, rounding)
- Protocol implementations (network protocols, serialization formats)
- State machines and controllers (especially safety-critical systems)
- Core library code used by many callers

**Practical entry points:**
- Start with invariants in types (like `BankAccount.non_neg`) — no proof effort, just type design
- Add preconditions to dangerous functions (like `safeDiv`) — eliminates runtime checks
- Prove key properties of core algorithms — catch design bugs before they ship
- Use `decide` to check concrete specifications — fast and automatic

**Where testing is sufficient:**
- UI interactions (hard to specify formally)
- Performance properties
- Network behavior under adversarial conditions
- Third-party system integration

---

## 9.4 Lean4 in CI/CD

Lean4 proofs check exactly like types — if the file compiles, the proofs are correct. This means:

```bash
lake build    # compiles all proofs; nonzero exit code means a proof failed
```

You can add this as a CI step alongside your test suite. A failing proof is as visible as a failing test, and it means something fundamentally different: a mathematical guarantee has been violated.

**Integration pattern:**
1. Write Lean4 specifications alongside (or inside) your existing codebase
2. Run `lake build` in CI
3. Any proof failure blocks the merge
4. Proofs serve as executable, machine-checked documentation

This is the future of software quality engineering: not just "tests pass" but "properties proved."

---

## Exercises

1. **Extend BankAccount:** Add an `interest` function that multiplies the balance by a factor `r : Int` where `r ≥ 1`. Prove that applying `interest` with `r ≥ 1` to an account with positive balance produces an account with a larger balance. (Hint: `linarith` with the non-negativity and positivity hypotheses should close the goal.)

2. **Traffic light extension:** Add a fourth state `| flashing` to `TrafficLight`. Update `nextLight` — Lean4 will give a compile error if you omit a case. Decide what `flashing` transitions to. Then state and attempt to prove whether the cycle period is still 3, or determine the new period.

3. **Stack sequence:** Using the `Stack` from L9.15–L9.18, prove: if you `push x` then `push y`, then `pop` once, the resulting stack has `x` at the top. That is, `(s.push x |>.push y |>.pop (List.cons_ne_nil y _)).peek ... = x`. (Hint: `simp [Stack.push, Stack.pop, Stack.peek]` may close it directly.)

4. **Specify and verify:** Define `def max3 (a b c : Nat) : Nat := max a (max b c)`. Write a `Max3Spec` proposition stating that the result is `≥ a`, `≥ b`, `≥ c`, and equals one of `a`, `b`, or `c`. Prove that `max3` satisfies `Max3Spec`. (Hint: `omega` or `simp [Nat.le_max_left, Nat.le_max_right]` handles the inequality goals; use `by_cases` or `omega` for the "equals one of" part.)
