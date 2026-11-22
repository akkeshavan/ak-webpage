---
layout: post.njk
title: "Crucible: An Eight-Layer Verification Pipeline for LLM-Ported Rust"
date: 2026-11-22
permalink: /blog/crucible-an-eight-layer-verification-pipeline/
---

*When Z3 alone is not enough: combining symbolic execution, differential fuzzing, Kani, Miri, Verus, and Lean4 to verify C++ → Rust ports end-to-end.*

> **Code**: The full source for this project is on GitHub at [akkeshavan/crucible](https://github.com/akkeshavan/crucible).

> **This post is Part 2 of a series.** [Part 1 — Can You Trust an AI to Rewrite Your Code?](../can-you-trust-an-ai-to-rewrite-your-code/) introduces the Z3 LLVM-IR equivalence checker and the CEGIS repair loop that Crucible builds on. Reading it first is recommended but not required — the relevant background is summarised in the Layer 2 section below.

---

## The Problem With "It Looks Right"

In a [previous post](../can-you-trust-an-ai-to-rewrite-your-code/) I described how I used Z3 and LLVM IR to prove semantic equivalence between LLM-generated Rust and the C++ it was ported from. Given a function pair, equator compiles both to LLVM IR, encodes the instructions as bit-vector constraints, and asks Z3 whether there exists any input that makes them disagree. If Z3 says no, the port is proven correct.

That post ended on a confident note. It should not have.

The confidence was warranted for the specific class of functions equator handles well: pure, integer-heavy, loop-free functions with no raw pointer arguments. For those, bit-vector equivalence checking works beautifully and the proof is watertight.

But in a real C++ → Rust migration, those functions are the easy ones. The hard ones look like this:

```c
extern "C" int sudo_strtomode(const char *cp) {
    if (cp == nullptr || *cp == '\0') return -1;
    char *ep = nullptr;
    long lval = strtol(cp, &ep, 8);         // parse as octal
    if (ep == cp || *ep != '\0') return -1;
    if (lval < 0 || lval > 0777) return -1;  // validate range [0, 0777]
    return (int)lval;
}
```

An LLM porting this writes:

```rust
Ok(n) if n >= 0 && n <= 0o776 => n as c_int,  // should be 0o777
```

One digit. It compiles. The tests pass, because the test suite checks `strtomode("755")` and `strtomode("644")`, not `strtomode("777")`. The bug lives in production until someone tries to chmod a file to world-writable, and the permission silently fails.

Equator cannot catch this because `sudo_strtomode` takes a `*const c_char`. Z3 treats pointers as opaque integers; it cannot model the bytes they point to. And even if it could, `strtol` is a C library call that the symbolic executor has no model for.

The Z3 approach is a powerful first layer. It is not a complete solution.

This post describes **Crucible**: an eight-layer verification pipeline that wraps equator's symbolic execution with seven additional layers, each designed to catch what the others miss. One of those layers — Layer 3.5 — uses [Verus](https://github.com/verus-lang/verus), a deductive verifier for Rust, to prove that the port's algorithmic core satisfies a formal mathematical specification. That is the layer that catches the `0o776` boundary error with a machine-checked proof rather than a test.

---

## Tools

The pipeline draws on the following open-source tools:

**[cargo clippy](https://doc.rust-lang.org/clippy/)** — Rust's official linter. Promotes every warning to an error to surface missing `unsafe` markers, undocumented preconditions, and C-migration anti-patterns.

**[clang-tidy](https://clang.llvm.org/extra/clang-tidy/)** — C++ static analyser. Checks the original source for undefined behaviour patterns before the Rust port is written.

**[Z3](https://github.com/Z3Prover/z3)** — Microsoft's SMT solver, the engine behind [equator](https://github.com/akkeshavan/equator). Used in L2 to prove bit-vector equivalence between LLVM IR compiled from both sources.

**[Kani](https://model-checking.github.io/kani/)** — Rust model checker. Exhaustively explores execution paths up to a bounded depth to prove absence of panics, overflows, and out-of-bounds accesses on symbolic inputs.

**[Verus](https://github.com/verus-lang/verus)** — Deductive verifier for Rust. Proves a function's postcondition holds for every possible input using SMT-backed ghost-code annotations (`spec fn` + `ensures`).

**[Miri](https://github.com/rust-lang/miri)** — Rust's MIR interpreter. Runs code under a strict memory model that enforces stacked-borrows aliasing rules, detecting use-after-free and uninitialized reads on concrete edge-case inputs.

**[Semgrep](https://semgrep.dev/)** — Lightweight code-pattern scanner. Runs a custom Crucible ruleset targeting patterns common in C-to-Rust migrations: unchecked shifts, bare slice indexing, undocumented unsafe blocks.

**[cargo-deny](https://embarkstudios.github.io/cargo-deny/)** — Dependency auditor. Checks the crate graph for known CVEs, licence violations, and banned crates.

**[ThreadSanitizer](https://clang.llvm.org/docs/ThreadSanitizer.html) + [Shuttle](https://github.com/awslabs/shuttle)** — Concurrency testing. TSan detects data races at runtime; Shuttle systematically explores execution interleavings to find deadlocks and atomicity violations.

**[Lean 4](https://lean-lang.org/) + Mathlib** — Proof assistant with a comprehensive mathematics library. The LLM generates omega-verified correctness theorems: for each function it writes an inline `theorem impl = spec` and proves it with `omega`. If the port has a bug, `omega` reports a machine-found counterexample and exits non-zero. Proof runs against a single shared Mathlib workspace downloaded once per machine.

---

## The Core Insight: Defence in Depth

No single verification tool catches all bugs. This is not a failure of the tools — it is a fundamental property of the problem. Formal tools are precise but have bounded scope. Dynamic tools have broad coverage but cannot prove absence. Static analysers catch idioms but miss semantics.

The right answer is not to find a better tool. It is to run all the tools.

Crucible applies this principle systematically. Each layer is independent, runs against the same two files (the original C++ and the Rust port), and produces structured findings that feed into a final verdict. The layers are ordered by cost: cheap static checks first, expensive model checkers later.

The eight layers are:

| # | Name | Tool | What it catches |
|---|------|------|-----------------|
| L1 | Static Analysis | `cargo clippy -D warnings` + clang-tidy | Rust idiom violations, unsafe FFI boundary marking, C migration anti-patterns |
| L2 | Semantic Equivalence | Z3 (via equator) + differential fuzzing fallback | Algorithmic divergence: wrong constants, flipped operators, boundary errors |
| L3 | Bounded Safety | Kani model checker | Memory safety on symbolic inputs: out-of-bounds, null dereference, arithmetic overflow |
| L3.5 | Algorithmic Correctness | Verus deductive verifier | Proof that the port's algorithmic core satisfies a formal spec derived from the C++ source |
| L4 | Dynamic UB | Miri interpreter | Stacked-borrows violations, use-after-free, uninitialized reads on concrete edge-case inputs |
| L5 | Supply Chain + Patterns | Semgrep + cargo-deny | Vulnerable dependencies, dangerous code patterns inherited from C migration |
| L6 | Concurrency | TSan + Shuttle | Data races, deadlocks, atomicity violations |
| L7 | Functional Correctness | Lean4 + Mathlib | omega-verified theorem: `impl args = spec args` for all inputs — exits non-zero when the port diverges from spec |

```
C++ source ──┐
              ├──▶  L1   clippy · clang-tidy          static analysis
Rust port   ──┘      │
                      ▼
                     L2   Z3  ──(pointer args)──▶  diff-fuzz   equivalence
                      │
                      ▼
                     L3   Kani                        bounded safety
                      │
                      ▼
                    L3.5  Verus                ★      algorithmic proof
                      │
                      ▼
                     L4   Miri                        dynamic UB
                      │
                      ▼
                     L5   Semgrep · cargo-deny         supply chain
                      │
                      ▼
                     L6   TSan · Shuttle               concurrency
                      │
                      ▼
                     L7   Lean 4 + Mathlib    ★        omega theorem
                      │
                      ▼
               crucible_report.json

★  LLM-generated formal annotations — human review of the generated spec is required before results are meaningful
```

The pipeline is invoked as a single command:

```bash
crucible run original.cpp port.rs --ci --verbose
```

It scaffolds all temporary build artifacts, invokes each layer, collects findings, and produces a JSON report.

**Crucible is a porting process, not a CI tool.** The intended usage is: run it once per function during a C++ → Rust migration, as a structured checklist with human review at the critical points. Two layers — L3.5 (Verus) and L7 (Lean4) — require that a human inspect the LLM-generated formal annotations before the result carries any weight. An LLM-generated spec that mis-states the intended behaviour will produce a vacuous proof: `omega` will close a goal that proves the wrong thing. Human review of the generated spec is not optional — it is the purpose of running those layers. That review is what makes this a migration workflow rather than an automated gate.

---

## Layer 1: Static Analysis

The first layer runs the Rust port through `cargo clippy` with every warning promoted to an error (`-D warnings`), plus clang-tidy on the C++ source.

This sounds mundane. It consistently produces the most *actionable* findings.

Consider what `clippy -D warnings` caught across our case studies:

- **`pub extern "C" fn` dereferencing a raw pointer without an `unsafe` marker.** A function that takes `*const c_char` and dereferences it inside the body must be declared `pub unsafe extern "C" fn`. Without the `unsafe`, there is no compiler-enforced contract that callers must ensure the pointer is valid.

- **Missing `# Safety` documentation on unsafe functions.** Every `unsafe fn` must document the invariants its callers are required to maintain: "caller must pass a valid, NUL-terminated pointer with lifetime extending beyond this call." Clippy enforces this.

- **Manual range checks that should use `RangeInclusive::contains`.** The pattern `x >= a && x <= b` is flagged in favour of `(a..=b).contains(&x)`. This is a stylistic lint, but it is also a correctness hint: the manual form is easy to get wrong when porting from C.

Layer 1 is stateless — it does not need to understand the C++ source, run any solvers, or model any behaviour. It is pure text analysis. It runs in under two seconds.

---

## Layer 2: Semantic Equivalence

This is equator, generalised.

The happy path works exactly as described in the [previous post](../can-you-trust-an-ai-to-rewrite-your-code/): compile both sources to LLVM IR, encode as Z3 bit-vector constraints, check for equivalence. If Z3 returns `UNSAT`, the port is proven correct for all inputs. If it returns `SAT`, the counterexample is fed to the LLM for a CEGIS repair loop.

The unhappy path is the new part.

**The pointer problem.** Many real functions take `const char*` or `const uint8_t*` arguments. Z3 cannot model pointed-to memory symbolically. Any function that calls `strlen`, `strcmp`, `strtol`, or `CStr::from_ptr` will cause the symbolic executor to fail.

When this happens, Crucible falls back to **differential fuzzing**: compile both C++ and Rust to native shared libraries via `clang++` and `rustc --crate-type=cdylib`, load them with Python's `ctypes`, and run a battery of edge-case inputs through both sides, comparing return values.

The input table is curated for common C migration patterns:

```python
_PTR_INPUTS = [
    b"ff", b"00", b"FF", b"AB", ...      # hex pairs (hexchar-style)
    b"yes", b"no", b"true", b"false", ... # boolean strings (strtobool-style)
    b"-1", b"0", b"255", b"256", ...      # decimal integers (strtol-style)
    b"777", b"0777", b"644", b"755", ...  # octal strings (permission parsers)
    b"8", b"9", b"garbage", b"\xff\xfe",  # invalid inputs
]
```

One implementation detail worth noting: Rust's `pub extern "C" fn` does *not* guarantee an unmangled export symbol unless `#[no_mangle]` is also present. Equator's function-name matching and ctypes' symbol lookup both fail silently if the IR contains mangled names. Crucible injects `#[no_mangle]` via regex into a temporary copy of the Rust source before every compilation. Without this, the layer reports false PASSes.

**LLM-generated inputs.** The static input table covers common C migration patterns, but every function has a domain-specific vocabulary of interesting inputs. Before the diff-fuzz loop runs, Crucible asks the LLM to generate 15 domain-specific byte-string inputs for the function: "this function is called `strtomode` and takes a `*const c_char` — generate octal permission strings." These are prepended to the static table, covering the function's specific domain without requiring a human to extend the table for each new function.

**Call graph propagation.** When any layer flags a function, Crucible computes the transitive callers of that function in the Rust source (via a lightweight regex call graph) and annotates the finding. A semantic divergence in `hexchar` becomes "hexchar diverges — transitive callers: iolog_write_record, sudoers_format_privilege." This is essential for prioritising which findings matter most in a migration involving hundreds of functions.

---

## Layer 3: Bounded Safety (Kani)

[Kani](https://model-checking.github.io/kani/) is a model checker for Rust. It treats inputs as symbolic variables and exhaustively explores all execution paths up to a bounded depth. For each public function in the Rust port, Crucible auto-generates a Kani harness:

```rust
#[kani::proof]
fn kani_sudo_strtomode() {
    let mut _buf_0: [u8; 32] = kani::any();
    _buf_0[31] = 0;  // NUL-terminate: bounds strlen/CStr within unwind limit
    let arg_0 = _buf_0.as_ptr() as *const std::os::raw::c_char;
    unsafe { sudo_strtomode(arg_0) };
}
```

The NUL-termination at `buf[31]` is deliberate. Without it, Kani's symbolic `strlen` traversal is unbounded and the checker reports a spurious memory-safety violation.

Kani shines on small, bounded functions. It found a genuine memory-safety concern in a Rust port that called `slice[0]` and `slice[1]` without checking that the input buffer was at least 2 bytes long. Its limitation here is loop-bound sensitivity: functions that iterate over strings hit the unwind bound before full coverage is achieved.

---

## Layer 3.5: Algorithmic Correctness (Verus)

This is the new layer.

[Verus](https://github.com/verus-lang/verus) is a deductive verifier for Rust. Rather than exploring bounded paths like Kani, Verus asks the SMT solver to prove that a function's postcondition holds for *every* possible input — no bound, no sampling. It is the same kind of proof that equator's Z3 layer attempts, but operating on Rust source with explicit contracts rather than on LLVM IR automatically extracted.

For each public function, Crucible asks the LLM to generate a Verus-annotated Rust file containing two things:

**A `spec fn`** — the mathematical ground truth derived from the C++ source:

```rust
spec fn strtomode_spec(n: int) -> int {
    if 0 <= n && n <= 511 { n } else { -1int }
}
```

**A pure core `fn`** — the algorithmic logic from the Rust port, stripped of the FFI boundary (`CStr::from_ptr`, null checks, etc.) and the parsing step (`strtol`). The stripping is deliberate: `strtol` is a standard library call assumed correct; the verifiable property is the range check and return value logic applied *after* parsing, starting from the already-parsed integer `n`. The pure core takes `n: i64` directly — Verus proves the range check and return value formula, not the conversion from string to integer:

```rust
fn strtomode_pure(n: i64) -> (result: i64)
    ensures result == strtomode_spec(n as int)
{
    if n >= 0 && n <= 0o776 {  // copied faithfully from the port — including the bug
        n
    } else {
        -1
    }
}
```

Verus then attempts to prove the postcondition. For the correct implementation (`n <= 0o777 = 511`), the proof closes immediately. For the buggy port (`n <= 0o776 = 510`), Verus rejects it:

```
error: postcondition not satisfied
  --> sudo_strtomode_verus.rs:11:17
   |
11 |         ensures result == strtomode_spec(n as int)
   |                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ failed this postcondition
...
   | if n >= 0 && n <= 510 { n } else { -1 }
   | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ at the end of the function body

verification results:: 0 verified, 1 errors
```

The key: Verus identifies that the case `n = 511` satisfies `strtomode_spec(511) = 511`, but the implementation returns `-1` for `511` because `511 <= 510` is false. It does not discover this by trying input `511` — it proves it algebraically, by showing the two branches are mutually exclusive in a way the postcondition requires them not to be.

**The separation of concerns is important.** Verus cannot directly verify `unsafe extern "C"` functions that operate on raw pointers — that is Kani's and Miri's job. What Verus verifies is the algorithm: once you have an integer `n`, does the range check and return value logic match the specification? This is exactly the class of error that an LLM introduces when it writes `0o776` instead of `0o777`.

**L7 (Lean4) vs L3.5 (Verus).** Both layers involve formal specs and an LLM. They verify different things with different machinery:

- L7 (Lean4 + Mathlib) generates an inline correctness theorem and uses `omega` to verify that the Rust implementation equals the mathematical spec *for all inputs*. `omega` is a linear arithmetic decision procedure: it either closes the goal (PASS) or reports a machine-found counterexample (FAIL). It does not use test cases.
- L3.5 (Verus) verifies that the Rust *source code* satisfies a Hoare-style postcondition using SMT automation. It inspects the actual program text, not an abstract model.

Both require the LLM to write the spec correctly. If the LLM mis-states the spec on both sides of the theorem, `omega` closes it vacuously. Human review remains essential.

**Lean4 → Verus spec handoff.** Before L3.5 runs, Crucible performs a pre-pass: it generates a Lean4 theorem file via the L7 logic (without invoking lean) and passes it to the Verus LLM prompt as a reference. This grounds the Verus `spec fn` in the same mathematical definition as L7's theorem, rather than having the LLM independently re-derive the spec from the C++ source. The two layers reinforce each other — L7 uses omega to check that impl = spec for all inputs; L3.5 uses Hoare logic to check that the Rust code satisfies the spec postcondition.

> **Manual review required.** The `spec fn` and `ensures` clause in the generated Verus file are LLM output. Crucible cannot verify that the spec correctly captures the intended behaviour — only that the implementation satisfies the spec *as written*. Before treating a Verus PASS as a meaningful correctness proof, a human must read the generated `spec fn` and confirm it encodes the right contract.

---

## Layer 4: Dynamic UB Detection (Miri)

[Miri](https://github.com/rust-lang/miri) is Rust's MIR interpreter. Unlike Kani, it is not symbolic — it runs code concretely — but under a strict memory model that enforces invariants the hardware does not: stacked-borrows aliasing rules, reads of uninitialized memory, and integer overflow in debug mode.

Crucible generates a `#[test]` driver for each function with edge-case inputs. For pointer arguments, it generates one call per entry in `_CSTR_EDGE_CASES`. One important subtlety: `*const c_char` (which is `*const i8`) requires `b"...\x00".as_ptr() as *const std::os::raw::c_char`, while `*const u8` requires `b"...\x00".as_ptr() as *const u8`. Conflating these produces a type-mismatch compile error. Crucible dispatches on the pointer element type to emit the right cast.

Miri consistently found the empty-string pre-condition violation before we arrived at it analytically: calling a function that contracts on `s[0]` and `s[1]` with a 1-byte NUL buffer causes Miri to report "dangling reference." The diagnostic is correct — the Rust port must validate that the input is at least 2 bytes before indexing into it.

---

## Layer 5: Supply Chain and Security Patterns

Layer 5 runs two tools.

**Semgrep** with a custom Crucible ruleset checks for patterns common in C-to-Rust migrations:

- Unchecked bit-shifts (`x >> n` without validating `n < bit_width`)
- Direct slice indexing without bounds check
- Unsafe block annotations without documented invariants

**cargo-deny** checks the dependency tree for known CVEs, license violations, and banned crates. For security-critical code, a supply chain finding in a transitive dependency is as serious as a logic bug in the ported function.

---

## Layer 6: Concurrency

Layer 6 applies ThreadSanitizer and [Shuttle](https://github.com/awslabs/shuttle) to the Rust port under a concurrent workload. Shuttle systematically explores the space of possible execution orders to find deadlocks and atomicity violations. For pure functions like those in our case studies, it correctly returns PASS. The layer is most valuable for ports of functions that touch global configuration, file descriptors, or signal handlers.

---

## Layer 7: Functional Correctness (Lean4 + Mathlib)

The final layer uses [Lean 4](https://lean-lang.org/) with [Mathlib](https://leanprover-community.github.io/mathlib4_docs/) to generate and check **omega-verified correctness theorems**. For each public function, the LLM writes an inline theorem that places the Rust implementation on the left-hand side and the C++ mathematical spec on the right-hand side:

```lean
import Mathlib.Tactic

-- Bug: port uses ≤ 510 (0o776), spec requires ≤ 511 (0o777)
theorem strtomode_spec_ok (n : Int) :
    -- Rust port: accepts 0..510
    (if 0 ≤ n ∧ n ≤ 510 then n else -1) =
    -- C++ spec: accepts 0..511
    (if 0 ≤ n ∧ n ≤ 511 then n else -1) := by omega
```

The `omega` tactic is a linear arithmetic decision procedure. It either:
- **Closes the goal** (exit 0) — the two expressions agree for every possible `n : Int`. This is a machine-checked proof that the LLM's extracted model of the implementation is correct. No test cases are needed; the proof covers all inputs of the extracted model.
- **Fails with a counterexample** (exit 1) — reports a witness value that makes the two sides differ.

For the `strtomode` example above, `omega` outputs:
```text
omega could not prove the goal:
a possible counterexample may satisfy the constraints
  510 < n ≤ 511
```
That is: `n = 511` is a witness. The port returns `-1` for input 511; the spec requires 511. Bug confirmed by exhaustive machine proof.

For bit-shift functions, the LLM converts shifts to multiplication before writing the theorem: `<< 7` becomes `* 128`, `<< 8` becomes `* 256`. This keeps the theorem in the linear fragment that `omega` handles.

The proofs run in a **shared Mathlib workspace** at `~/.crucible/lean-workspace/`, downloaded once per machine. All four case studies share the same pre-built `.olean` files; no per-proof download is needed. Set up once with:

```bash
mkdir -p ~/.crucible/lean-workspace
cp crucible/lean/lakefile.lean crucible/lean/lean-toolchain ~/.crucible/lean-workspace/
cd ~/.crucible/lean-workspace && lake update   # fetches ~8,600 cached oleans
```

The workspace path defaults to `~/.crucible/lean-workspace/` but can be overridden with the `CRUCIBLE_MATHLIB_DIR` environment variable — useful when sharing a workspace across multiple sibling projects on the same machine:

```bash
export CRUCIBLE_MATHLIB_DIR=$HOME/.crucible/lean-workspace
python3 crucible.py scan case_studies.toml --ci
```

L7's runner (`layers/lean4.py`) invokes `lake env lean <proof_file>` from that directory, giving every proof access to all of Mathlib without any per-run initialisation.

> **Manual review required.** The spec on the right-hand side of the theorem is LLM output. If the LLM incorrectly writes the spec — for instance, using `≤ 510` on both sides — `omega` closes the proof vacuously (both sides are identical) while the real bug goes undetected. Human review of the generated theorem is required before an L7 result is meaningful. That review — a human reading and signing off on the formal statement of what a function should compute — is itself a valuable step in a migration workflow.

---

## Case Studies

I ran Crucible against four function pairs drawn from real security-critical code. The tables below use the pipeline's four verdict labels: **PASS** (no finding), **AUTO_FIX** (finding recorded automatically in CI mode — includes confirmed divergences, omega counterexamples, and LLM synthesis failures where the tool's required input could not be generated correctly, e.g., a Lean4 theorem using an unsupported type), **REVIEW** (tool found something requiring human judgement — Verus postcondition failures, Kani unwind-bound hits, Miri UB), and **ABORT** (not seen in these studies).

### Case Study 1: `sudo_hexchar` (synthetic port)

**Function**: converts a 2-character hex string to an integer. Used in sudo's `iolog` subsystem.  
**Bug**: `b'A'..=b'F' => b - b'A' + 11` (should be `+ 10`).

| Layer | Verdict | Finding |
|-------|---------|---------|
| L1 | PASS | No static issues — `unsafe` markers and `# Safety` docs present |
| L2 | **AUTO_FIX** | `sudo_hexchar(b"FF")` → C++ 255, Rust 272 |
| L3 | REVIEW | Unwind bound hit on `strlen` (expected for pointer inputs) |
| L3.5 | REVIEW | Postcondition failure: `hexchar_pure('F','F')` returns 272, spec requires 255 |
| L4 | PASS | No UB on concrete edge-case inputs |
| L5 | REVIEW | Unsafe block without documented invariant; unchecked slice index |
| L6 | PASS | |
| L7 | AUTO_FIX | omega counterexample: `11 ≤ a ≤ 16` for `a = impl_result` when `65 ≤ n ≤ 70` |

L2 caught the bug by differential fuzz: `hexchar("FF")` → C++ 255, Rust 272. L3.5 caught it by proof: Verus showed `hexchar_pure(70, 70)` violates `ensures result == hexchar_spec(70, 70)` because `hexchar_spec(70, 70) = (5 * 16 + 5) = 255` but the implementation returns `(70 - 65 + 11) * 16 + (70 - 65 + 11) = 272`. L7 caught it independently: omega reported that when `65 ≤ n ≤ 70`, the impl returns `n - 54` but the spec requires `n - 55` — a machine-exhaustive proof that the uppercase-hex branch is universally wrong by exactly 1.

### Case Study 2: `adler32_scalar` (zlib, correct port)

**Function**: scalar Adler-32 checksum. Extracted from [zlib](https://github.com/madler/zlib) and [zlib-rs](https://github.com/trifectatechfoundation/zlib-rs).  
**No bug**: this is a faithful port. We wanted to see what the pipeline finds on correct code.

| Layer | Verdict | Finding |
|-------|---------|---------|
| L1 | PASS | No static issues |
| L2 | PASS | No divergence found |
| L3 | REVIEW | Unwind bound 10 too low for NMAX=5552 iteration loop |
| L3.5 | REVIEW | LLM generated `spec_bitand`/`spec_shr` calls that don't exist on Verus `int` |
| L4 | PASS | No UB |
| L5 | REVIEW | 3× unchecked bit-shifts from C migration; unsafe block |
| L6 | PASS | |
| L7 | AUTO_FIX | LLM generated a theorem using `Prod` (tuple) types; `omega` does not handle product-type goals — no code bug implied |

The interesting result here is L3.5. For a loop-intensive function with bitwise packing (`adler >> 16`, `adler & 0xffff`), the LLM generated Verus spec functions that called `spec_bitand` and `spec_shr` — methods that don't exist on Verus's `int` type. The spec file failed to typecheck before any postcondition was tested. This is a real limitation: the Verus LLM prompt ("NO LOOPS, NO STRINGS") correctly bars loops and string parsing, but doesn't yet bar bitwise ops in `spec fn` bodies. For pure accumulation functions like Adler-32, the right pure core is the single-step update formula (`(s1 + b) % 65521`), not the full loop. This is a prompt engineering fix, noted in the limitations section.

### Case Study 3: `sudo_strtomode` (sudo-rs, boundary off-by-one)

**Function**: parses an octal file permission string. Drawn from [sudo-project/sudo](https://github.com/sudo-project/sudo) with a Rust port in the style of [sudo-rs](https://github.com/trifectatechfoundation/sudo-rs).  
**Bug**: `n <= 0o776` instead of `n <= 0o777`. Mode `0777` (chmod 777) returns -1.

| Layer | Verdict | Finding |
|-------|---------|---------|
| L1 | PASS | No static issues — `unsafe` markers and `# Safety` docs present |
| L2 | **AUTO_FIX** | `sudo_strtomode(b"777")` → C++ 511, Rust -1 |
| L3 | REVIEW | Unwind bound hit on `strlen` (expected) |
| **L3.5** | **REVIEW** | **Postcondition `ensures result == strtomode_spec(n as int)` not satisfied** |
| L4 | PASS | No UB |
| L5 | PASS | |
| L6 | PASS | |
| L7 | AUTO_FIX | omega: `510 < n ≤ 511` is a counterexample — port returns -1 for n=511, spec requires 511 |

L2 catches the bug by input: `strtomode("777")` → C++ 511, Rust -1. L3.5 catches it by proof:

```text
error: postcondition not satisfied
  --> sudo_strtomode_verus.rs:11:17
   |
11 |         ensures result == strtomode_spec(n as int)
   |                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ failed this postcondition
```

Both L3.5 and L7 provide stronger guarantees than L2. The L2 fuzz result says "these two specific programs disagree on input `b'777'`". Verus says "the implementation cannot satisfy the specification for the input class `511 <= n`" — a proof about all inputs. L7 provides an equivalent statement from a different direction: `omega` reports `510 < n ≤ 511` as a counterexample witness, confirming by exhaustive integer arithmetic that input 511 makes the two sides differ. All three findings point to the same line in the port.

### Case Study 4: `mp4_read_fourcc` (mp4parse-rust, bit-shift off-by-one)

**Function**: reads a 4-byte big-endian four-character code from a byte buffer. FourCC identifiers label every box in an ISO 14496-12 file — `"ftyp"`, `"moov"`, `"mdat"`, etc. Drawn from [mp4parse-rust](https://github.com/mozilla/mp4parse-rust), Mozilla's Rust reimplementation of the MP4 box parser. A second function in the same file, `mp4_is_container_box`, was verified alongside it: given a 32-bit fourcc integer, it returns whether the box type is a known container (`moov`, `trak`, `mdia`, etc.) by checking membership in a fixed constant set.  
**Bug**: third byte shifted by 7 instead of 8: `(s[2] as u32) << 7` instead of `<< 8`. A realistic copy-paste error when porting C bitfield assembly.

| Layer | Verdict | Finding |
|-------|---------|---------|
| L1 | PASS | No static issues |
| L2 | **AUTO_FIX** | `mp4_read_fourcc(b'\x01\x02\x03\x04')` → C++ 16909060, Rust 16908676 |
| L3 | **PASS** | Memory safety verified — fixed 4-byte read has no unbounded traversal |
| **L3.5** | **REVIEW** | Postcondition `ensures result == (b0*0x1000000) + (b1*0x10000) + (b2*0x100) + b3` fails |
| **L4** | **REVIEW** | `from_raw_parts(buf, 4)` on a 2-byte input → dangling reference (genuine UB) |
| L5 | PASS | |
| L6 | PASS | |
| L7 | AUTO_FIX | omega: `c ≥ 1` is a counterexample for `mp4_read_fourcc` (b2≥1 makes `b2*128 ≠ b2*256`); `mp4_is_container_box` PASS |

Three things stand out in this result.

First: **L3 passes for the first time on a pointer function.** The previous three case studies all hit Kani's unwind bound because they involved string parsing with `strlen`. `mp4_read_fourcc` reads exactly 4 bytes — the symbolic execution is bounded at compile time, so Kani closes cleanly.

Second: **L2 caught the shift bug immediately**, without needing LLM-generated inputs. The static table now includes MP4 fourcc strings (`b"ftyp"`, `b"moov"`, etc.), but the first divergence came from `b'\x01\x02\x03\x04'` — a generic byte sequence. The diff is exactly `0x03 << 8 - 0x03 << 7 = 768 - 384 = 384 = 16909060 - 16908676`. ✓

Third: **L4 (Miri) found a secondary real bug.** The function unconditionally calls `std::slice::from_raw_parts(buf, 4)` after the null check but without validating that the buffer has at least 4 bytes. The Miri harness passed a 2-byte input; Miri caught the out-of-bounds slice construction as undefined behaviour. The C++ version has the same pre-condition in comments — the difference is that Miri makes the violation observable. This is a genuine finding, independent of the intentional shift bug.

---

## Infrastructure Discoveries

Running the pipeline against real code forced three fixes that are interesting in their own right.

**`extern "C"` without `#[no_mangle]` produces mangled IR symbols.** When compiling a Rust source to LLVM IR (for Z3 equivalence) or to a cdylib (for differential fuzzing), `pub extern "C" fn foo()` without `#[no_mangle]` produces a symbol named something like `_ZN9sudo_util15sudo_strtomodeE17hb3f7a5b3c8d9e1f2g` — not `sudo_strtomode`. Equator's function-name intersection and ctypes' symbol lookup both fail silently. The fix: inject `#[no_mangle]` via regex into a temporary copy of the Rust source before compilation.

**`*const u8` and `*const c_char` need different cast expressions.** When Miri's test generator produces byte-literal pointers, it must cast them to the actual argument type. `b"ff\x00".as_ptr() as *const std::os::raw::c_char` is correct for `c_char` arguments; `b"ff\x00".as_ptr() as *const u8` is correct for `u8` arguments. Using the wrong cast produces a compile error. The fix: dispatch on the pointer's element type when emitting the cast.

**The diff-fuzz input table must cover the function's domain.** The first version of `_PTR_INPUTS` covered hex pairs and boolean strings — good for `hexchar` and `strtobool`, useless for `strtomode`. The `0o776` bug was initially missed because `b"777"` was not in the table. After adding octal strings the divergence was found immediately. This is an honest limitation of input-guided differential testing: coverage depends on knowing the function's input domain.

---

## Generics and Templates

One of the most common questions about applying Crucible to a real codebase is: *what happens when the C++ code uses templates, or the Rust port uses generics?*

The honest answer is that formal verification tools — Z3, Kani, Verus, Lean4 — do not reason about generic code. They reason about concrete types. A Lean4 `structure` with an `Int` field is verifiable; a Lean4 `structure` with a type parameter is not (without substantially more proof engineering). A Kani harness can call `kani::any::<Point>()` for a concrete `Point`; it cannot call `kani::any::<T>()` for an arbitrary `T`.

This is not a bug. It is a fundamental property of how these tools work: they produce machine-verified proofs about specific programs, and "a program that handles all types" is a different — and much harder — object to verify than "a program that handles integers."

### Why the FFI Boundary Helps

The first observation is that the problem is smaller than it looks for C++ → Rust migrations. Functions exposed as `extern "C"` are *inherently monomorphic*. You cannot write:

```c
template<typename T>
extern "C" T transform(T input);  // illegal — C has no generics
```

The FFI boundary forces every function that crosses it into concrete type territory. This is why Crucible's pipeline works at all: by focusing on `pub extern "C" fn` pairs, we sidestep most of the generics problem by construction.

For C++ templates, the compiler instantiates them at their concrete call sites before emitting LLVM IR. By the time equator's symbolic executor sees the IR, `std::vector<uint8_t>` has been expanded to a specific layout, `std::min<int>` has been inlined, and there is nothing generic left. Z3 and the diff-fuzzer operate on this already-monomorphized code with no special handling.

### Where the Problem Re-Emerges: Struct Types

The harder case arises when a ported function takes a *struct* as an argument — either because the original C++ used a template struct for a data layout, or because the Rust port groups related parameters into a named type:

```c
// C++
struct Point { int32_t x; int32_t y; };
extern "C" Point translate(Point p, int32_t dx, int32_t dy);
```

```rust
// Rust port
#[repr(C)]
pub struct Point { pub x: i32, pub y: i32 }

pub extern "C" fn translate(p: Point, dx: i32, dy: i32) -> Point { ... }
```

Each layer of the pipeline previously saw the type name `"Point"` as an opaque string — not a Kani-arbitrary type, not a ctypes Structure, not a Lean4 structure. The differential fuzzer would skip the function (can't map `"Point"` to a ctypes type). Kani would fail to compile the harness (`kani::any::<Point>()` requires `Point: kani::Arbitrary`). Lean4 would have no definition to unpack into scalar theorems.

The solution is explicit **struct schema declarations** in `crucible.toml`:

```toml
[[struct]]
name   = "Point"
fields = [
  { name = "x", type = "i32" },
  { name = "y", type = "i32" },
]

[[struct]]
name     = "Shape"
kind     = "enum"
variants = [
  { name = "Circle", fields = [{ name = "r", type = "i64" }] },
  { name = "Rect",   fields = [{ name = "w", type = "i64" },
                                { name = "h", type = "i64" }] },
]

[[pair]]
label  = "transform_point"
cpp    = "src/transform.cpp"
rust   = "src/transform.rs"
struct = "Point"
```

The `struct` field in a `[[pair]]` entry names the declared types used by that function. Each layer then receives the schema and generates the appropriate layer-specific artefact from it.

### What Each Layer Does With the Schema

**Layer 2 (differential fuzzing)**: `tools/struct_schema.py` builds a Python `ctypes.Structure` subclass dynamically from the field definitions and registers it in the type table. For a `Point` with two `i32` fields, it generates:

```python
class Point(ctypes.Structure):
    _fields_ = [("x", ctypes.c_int32), ("y", ctypes.c_int32)]
```

Test inputs are drawn from a cartesian product of field-wise boundary values (`[-2147483648, -1, 0, 1, 2147483647]` per `i32` field), capped at 50 combinations. For enum structs, the generator sweeps each variant with its field boundary values.

**Layer 3 (Kani)**: Crucible injects `#[cfg_attr(kani, derive(kani::Arbitrary))]` before the struct definition in the Rust source, idempotently (re-injection is a no-op). The harness then uses `let arg: Point = kani::any();` — which Kani resolves via the derived instance. Structs with float fields get a comment warning that Kani bugs [#5080](https://github.com/model-checking/kani/issues/5080) and [#5168](https://github.com/model-checking/kani/issues/5168) may affect soundness for float values.

**Layer 3.5 (Verus)**: The schema is emitted as a Verus struct/enum definition and prepended to the LLM spec-generation prompt, alongside the C++ and Rust sources. For the `Point` example:

```rust
#[derive(PartialEq)]
#[verifier::ext_equal]
pub struct Point {
    pub x: i32,
    pub y: i32,
}
```

The LLM generates the pure-core function and spec function in terms of this concrete type. Field access in `ensures` clauses (`result.x == spec.x`) is unambiguous — no type inference from scratch.

**Layer 7 (Lean4)**: The schema becomes a Lean4 `structure` or `inductive` definition passed in the prompt alongside worked examples. For integer-field structs, theorems are written over the unpacked fields (`px py : Int`) rather than the struct type, keeping the goals in the linear fragment that `omega` handles:

```lean
structure Point where
  x : Int
  y : Int

theorem translate_spec_ok (px py dx dy : Int) :
    (px + dx, py + dy) = (px + dx, py + dy) := by omega
```

For enums, each variant is encoded as a tag integer plus payload scalars:

```lean
-- Shape enum with tag: 0 = Circle(r), 1 = Rect(w, h)
theorem shape_area_spec_ok (tag r w h : Int) :
    (if tag = 0 then r * r
     else if tag = 1 then w * h
     else 0) = ... := by omega
```

### Supported Field Types

The schema supports eight categories of field type:

| Category | TOML type key | ctypes | Kani | Lean4 | Verus |
|----------|--------------|--------|------|-------|-------|
| Signed integers | `i8` `i16` `i32` `i64` `isize` | `c_int8` … | `i8` … | `Int` | `i8` … |
| Unsigned integers | `u8` `u16` `u32` `u64` `usize` | `c_uint8` … | `u8` … | `Int` | `u8` … |
| Floats | `f32` `f64` | `c_float` / `c_double` | provisional ⚠ | AUTO_FIX | partial |
| Boolean | `bool` | `c_bool` | ✓ | `Bool` | `bool` |
| Pointers | `ptr_u8` `ptr_i8` … | `c_char_p` | nondeterministic | `List` | `Seq` |
| Fixed arrays | `array_u8_16` etc. | `c_uint8 * 16` | `[u8; 16]` | `Vector UInt8 16` | `Seq<u8>` |
| Nested structs | any declared name | resolved class | composed | referencing | referencing |
| Enums (with data) | `kind = "enum"` | tagged layout | ✓ | `inductive` | `enum` |

Float fields are the notable gap. Neither `omega` (Lean4 L7) nor Z3-backed `int`-spec-fns (Verus L3.5) can reason about floating-point arithmetic in general. For structs with float fields, L7 emits `-- AUTO_FIX: float fields cannot be verified with omega` and replaces the theorem with `theorem f_spec_ok : True := trivial` — a deliberate placeholder that flags the function for manual review rather than producing a spurious PASS.

### What Still Doesn't Work

**Fully polymorphic generics.** A Rust function `fn transform<T: Clone>(t: T) -> T` cannot be verified for all `T` — only for specific declared instantiations. Crucible does not synthesise instantiations automatically.

**Associated types and trait bounds.** When a struct carries a generic `type Error: std::error::Error`, Crucible has no way to reason about the type. These are fundamentally proof-theory questions (dependent types, typeclasses) that none of the tools in the pipeline answer automatically.

**Const generics.** A type `[u8; N]` where `N` is a const generic parameter is not representable in the schema. Each array size must be declared as a concrete `array_u8_16` or `array_i32_4` instantiation.

**`isize`/`usize` as standalone function arguments.** These types appear prominently in `(ptr, len)` pairs — `fn foo(buf: *const u8, len: usize)`. Passing arbitrary `usize` values to a function that uses `len` to slice a buffer of fixed size will produce a segmentation fault. The differential fuzzer explicitly refuses to bind functions with `isize`/`usize` scalar arguments (not in struct context), skipping them silently rather than crashing. The correct handling requires tracking the pointer/length relationship, which is a future extension.

The boundary is clear: Crucible handles the monomorphic, FFI-exposed subset of a codebase well, and extends to struct-typed arguments via explicit schema declarations. The parts that remain out of reach — open parametric polymorphism, dependent types, full trait-bounds reasoning — correspond to the parts of formal verification that are open research problems, not engineering gaps.

---

## Limitations

**L2 Z3 cannot prove equivalence of functions with pointer arguments.** The diff-fuzz fallback can find divergences but cannot prove absence. It is only as good as its input table.

**L3 Kani is impractical for loop-intensive functions.** The default unwind bound of 10 is too low for accumulation loops like Adler-32 (up to 5552 iterations per NMAX block). Kani is best suited to functions with loop bounds known at compile time.

**L3.5 Verus requires a pure scalar core without bitwise ops in `spec fn` bodies.** The LLM must extract the verifiable algorithmic logic from the FFI boundary. For functions whose interesting logic is inseparable from string parsing, the generated pure core may miss the actual bug. For loop-intensive functions with bitwise packing (e.g. Adler-32's `adler >> 16` / `& 0xffff`), the LLM tends to call non-existent Verus methods (`spec_bitand`, `spec_shr`) in spec functions — the spec fails to typecheck before any postcondition is tested. The prompt can be extended to ban bitwise ops in `spec fn` bodies and steer the LLM toward arithmetic equivalents.

**L7 omega does not handle product types (Prod) or non-linear arithmetic.** When the LLM generates a theorem using tuple return types (`(s1, s2)` as `Int × Int`) rather than separate scalar theorems, `omega` cannot decompose the goal and fails even if the implementation is correct (false positive). For functions like Adler-32 whose interesting structure involves `Nat` or `Int` accumulation, the correct form is to write separate theorems for each scalar component. The LLM sometimes uses tuples; the HITL loop or a prompt addendum can steer it toward scalar theorems. Similarly, `omega` does not handle goals involving multiplication of two variables (non-linear) — LLM must express bit-shifts as multiplication by constants (which is linear and omega-compatible).

**L7 and L3.5 verify LLM-extracted models, not the actual source.** The left-hand side of an L7 omega theorem and the pure core in an L3.5 Verus file are written by the LLM to summarise the Rust port. They are not formally extracted from the Rust AST. If the LLM mis-summarises the implementation — for example, omitting a branch, correcting a bug it noticed, or simplifying away an edge case — the proof is about a model that does not reflect the actual code. The formal machinery (omega, Verus SMT) guarantees that the proof is internally consistent, not that the model is faithful to the source. Human review of both the spec and the implementation side of every generated theorem is required.

**L7 omega and L2 Z3 have overlapping scope on pure scalar functions.** When a function takes only integer arguments and no pointers, both L2 (Z3 bit-vector equivalence on LLVM IR) and L7 (omega on the LLM's extracted Lean4 theorem) attempt to prove equivalence over all inputs. L2's result is strictly stronger for this case: it operates on actual compiled IR from both sources rather than an LLM summary. L7 adds meaningful independent value only for functions where Z3 fails (pointer arguments, calls to external library functions like `strtol`) — cases where L2 falls back to differential fuzzing and cannot prove absence of divergences.

**The `#[no_mangle]` regex injection is brittle.** Crucible injects `#[no_mangle]` via regex into a temporary copy of the Rust source before every compilation (L2 Z3 and diff-fuzz). The regex targets `pub [unsafe] extern "C" fn`. It will silently miss functions whose signatures span multiple lines, use macro expansion, have `#[cfg(...)]` guards that change the effective signature, or use a non-standard extern ABI spelling. When the regex misses a function, the layer skips it without any warning — a silent false PASS. Future work: parse the Rust source with `syn` rather than regex.

**L1 (Clippy) and L5 (Semgrep) have overlapping findings.** Both run static pattern matching on the Rust source. The same code pattern — e.g., a bare slice index `s[0]` without an explicit bounds check — may be flagged by both a Clippy lint and a custom Semgrep rule. In CI mode, duplicate findings inflate the apparent count. The pipeline does not deduplicate across layers. This is intentional (independent tools may add context), but users reviewing a report should expect overlapping findings at L1 and L5.

**The pipeline operates on function pairs, not full programs.** Crucible verifies individual functions in isolation. It does not model aliasing between functions, shared mutable state, or emergent behaviour from function composition.

---

## Future Work

**GitHub Actions integration.** The pipeline produces a machine-readable JSON report. Wrapping it in a GitHub Actions workflow would let teams run Crucible automatically on every pull request that touches ported code.

**Broader case studies.** The next targets are cryptographic primitives (a Rust port of a subset of OpenSSL's HMAC-SHA256) and deeper functions from [mp4parse-rust](https://github.com/mozilla/mp4parse-rust) with variable-length parsing and nested box structures. These will stress-test the pipeline on functions with complex control flow, recursive data structures, and non-trivial loop bounds.

---

## Conclusion

LLM-assisted C++ → Rust migration is here, it is productive, and it produces bugs that are invisible to the tools we normally use to find bugs. Unit tests do not cover all inputs. Code review does not catch off-by-one errors in constant tables. `cargo test` does not check semantic equivalence.

Crucible is an answer in the form of a pipeline: eight layers, each catching what the others miss, each with a clear explanation of its findings and its limitations. Four case studies across three real codebases show that the layers find different classes of bugs by different means:

- L1 (clippy) finds missing `unsafe` markers and undocumented preconditions — real FFI safety concerns — in under two seconds, on correct and incorrect ports alike.
- L2 (diff-fuzz) catches `hexchar("FF") → 272 instead of 255`, `strtomode("777") → -1 instead of 511`, and `mp4_read_fourcc("\x01\x02\x03\x04") → 16908676 instead of 16909060` by running concrete inputs through both compiled binaries.
- L3 (Kani) passes cleanly on fixed-size reads (`mp4_read_fourcc`), confirming Kani is well-suited to functions with bounded memory access — and correctly flags string-walking functions that exceed its unwind bound.
- L3.5 (Verus) catches all three intentional bugs by proof; `mp4_is_container_box` verified correctly without false positives. For `adler32`, the LLM generated spec functions using non-existent Verus methods (`spec_bitand`, `spec_shr`) — a prompt engineering failure that prevented the spec from typechecking, not a false positive from the verifier.
- L4 (Miri) found a secondary real bug in `mp4_read_fourcc`: `from_raw_parts(buf, 4)` on a short input is UB, independent of the shift bug.
- L7 (Lean4 + Mathlib) independently caught three of the four bugs using `omega` — a linear arithmetic decision procedure that exhaustively checks the integer domain. For `hexchar`, it pinpointed the upstream hex branch (`11 ≤ a ≤ 16`). For `strtomode`, it reported `510 < n ≤ 511` as the witness. For `mp4_read_fourcc`, it identified `b2 ≥ 1` as the trigger. All three findings are machine-checked proofs of the LLM's extracted model of the implementation, not sample-based tests.

The separation between L2, L3.5, and L7 is worth dwelling on. Differential fuzzing catches bugs you thought to test for. Verus catches bugs you did not think to test for, because it reasons about all inputs via Hoare logic. L7's omega closes the loop: it reasons exhaustively over the integer domain via linear arithmetic, independently confirming what L3.5 found by program logic. The three layers use completely different mathematical machinery, yet converge on the same bugs.

The pipeline is working on real code from real repositories. Five features that were listed as future work in an earlier draft — call graph propagation, LLM-driven input generation, the Lean4 → Verus spec handoff, omega-verified L7 theorems, and struct-typed argument support across all eight layers — are now implemented and running in the pipeline described above. The remaining open items are GitHub Actions integration and broader case studies.

The source is at [akkeshavan/crucible](https://github.com/akkeshavan/crucible). The equator library it builds on is at [akkeshavan/equator](https://github.com/akkeshavan/equator).
