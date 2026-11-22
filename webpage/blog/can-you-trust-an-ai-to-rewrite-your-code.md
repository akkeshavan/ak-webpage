---
layout: post.njk
title: "Can You Trust an AI to Rewrite Your Code?"
date: 2026-11-19
permalink: /blog/can-you-trust-an-ai-to-rewrite-your-code/
---

*Proving semantic equivalence between LLM-generated Rust and the C++ it came from.*

> **Code**: The full source for this project is on GitHub at [akkeshavan/equator](https://github.com/akkeshavan/equator).

---

## The Age of the AI Rewrite

Imagine you are the engineer tasked with migrating a production C++ codebase to Rust. It is 2026, the memory-safety memo has been circulating for a while, and management has "Just Decided". Fair enough.

So you do the sensible thing: you paste a function into an AI assistant, it spits out Rust, and it looks clean. Proper idiomatic Rust. Nice `match` arms, no raw pointers in sight, the sort of code that would sail through code review.

Then it ships to production, and something is subtly wrong.

Not crash-wrong. Not the-tests-fail wrong. The *kind* of wrong where a single-bit difference in a bit-shift direction produces a valid-looking result for 99.99% of inputs and silently corrupts data on the edge cases that matter.

This is the problem this article is about. Large language models are increasingly being used to port code from one language to another: C++ to Rust, Java to Kotlin, Python 2 to Python 3. The generated code often looks correct. It passes unit tests. It passes review. And yet it can be semantically wrong in ways that no amount of staring at it will reveal.

I built a tool to catch exactly these bugs using formal verification. No guessing, no fuzzing, no vibes. Mathematical proof. Here is how I did it.

---

## What Does "The Same" Actually Mean?

Before I can prove two programs equivalent, I need to settle on what "equivalent" actually means.

The obvious answer — "they produce the same output" — immediately runs into a problem: there are four billion possible 32-bit integers. You cannot test them all. And even if you could, functions with two 32-bit inputs give you around 18 quintillion combinations. Testing your way to correctness is not just slow; it is mathematically impossible for all but the simplest functions.

What I actually want is *semantic equivalence*: for every possible input, both programs return the same value. Not "for the inputs in my test suite" — for every input that physically exists.

Formal verification is the discipline that proves statements like this. Instead of running code, you reason about it mathematically. A program is described as a logical formula — "given input `x`, the output is `(x + 5) & 0xFF`" — and a solver is asked whether the two formulas can ever disagree.

This is where bit-vector theory comes in. Modern processors work in fixed-width arithmetic: 32-bit integers that overflow, shifts that have defined (or undefined) behaviour, comparisons that are signed or unsigned depending on the instruction. Bit-vector solvers treat programs exactly this way — no idealised infinite integers, just the gritty reality of how a CPU actually works.

If the solver finds no input where the two programs differ, it returns `UNSAT` — "unsatisfiable", meaning the attempted counterexample has no solution. That is the proof. The two programs are equivalent over all possible inputs.

If it finds one, it hands back the specific input values. That is the bug report.

---

## Enter Z3: The Solver That Knows Too Much

Z3 is a *Satisfiability Modulo Theories* (SMT) solver, which is a fancy way of saying it is a programme that can decide whether a logical formula has a solution — and if it does, it will tell you what that solution is.

It was built at Microsoft Research by Leonardo de Moura and Nikolaj Bjørner, first released in 2008, and has since become the solver of choice for formal verification, program analysis, security research, and competitive programming puzzles that have got slightly out of hand. It has been used to find security vulnerabilities in production software, verify operating system kernels, and power tools like Microsoft's SAGE fuzzer. For something built by a team of academics inside a software company, it has had a remarkably good career.

The "Modulo Theories" part is the clever bit. Pure Boolean satisfiability solvers — called SAT solvers — can only reason about true-or-false variables. SMT solvers extend this with *theories*: extra axioms about integers, real numbers, arrays, bit-vectors, and so on. When I ask Z3 whether two arithmetic expressions over 32-bit integers can ever produce different results, it knows exactly how 32-bit arithmetic works. No guessing, no sampling, no machine learning. A definitive yes or no.

### From C to Z3: a quick reference

Here is how everyday C/C++ constructs map to Z3 bit-vector expressions. This is exactly what my verifier does automatically, one LLVM IR instruction at a time:

```python
import z3

# Declare symbolic variables — like "int x, y;" in C
x = z3.BitVec('x', 32)
y = z3.BitVec('y', 32)

# Arithmetic (wraps on overflow, just like C integers)
z3_add  = x + y             # int32 addition
z3_sub  = x - y             # subtraction
z3_mul  = x * y             # multiplication

# Right shifts — this is where C++ → Rust translation bugs live
z3_lshr = z3.LShR(x, y)    # logical  right shift: >> on uint32_t  (fills vacated bits with 0)
z3_ashr = x >> y            # arithmetic right shift: >> on int32_t (fills with sign bit)

# Comparisons
unsigned_lt = z3.ULT(x, y)  # unsigned <  (uint32_t x < uint32_t y in C)
signed_lt   = x < y         # signed   <  (int32_t  x < int32_t  y in C)

# Ternary: result = cond ? a : b
min_val = z3.If(x < y, x, y)

# Ask Z3: can lshr and ashr ever produce different results?
s = z3.Solver()
s.add(z3_lshr != z3_ashr)   # assert they can differ somewhere
print(s.check())              # sat — yes, when the top bit of x is 1
print(s.model())              # e.g. x = 0x80000000 (= -2147483648 as signed i32)
```

That `sat` result is not academic. Any function that right-shifts a value which is `uint32_t` in C++ but becomes `i32` in idiomatic Rust will silently diverge on every input with the top bit set — half of all possible 32-bit values. Z3 surfaces this in milliseconds with a concrete counterexample.

A good place to go deeper is the [Z3 Programming Tutorial](https://microsoft.github.io/z3guide/programming/Z3%20Python%20-%20Readonly/Introduction), which covers the full Python API with interactive examples.

For my purposes — checking whether an AI's Rust translation matches the original C++ — Z3 is, frankly, overkill in the best possible way.

---

## Z3 Is Not the Only Option

Z3 gets most of the attention, but it is not the only SMT solver in the room. Here are the ones worth knowing.

**CVC5** is the successor to CVC4, developed by researchers at Stanford and the University of Iowa. It is particularly strong on string and floating-point theories, and is used heavily in formal methods research. If your code has a lot of string manipulation, CVC5 may be a better fit.

**Bitwuzla** is a newer solver optimised specifically for bit-vector and floating-point arithmetic, which makes it a natural choice for the kind of low-level code I am checking here. It has beaten Z3 on several bit-vector benchmarks and its Python bindings are clean. Worth watching.

**Yices 2**, from SRI International, is a veteran of the field: fast, well-tested, and excellent for linear arithmetic. It has been part of formal verification toolchains since the late 1990s and remains actively maintained.

**CBMC** (the C Bounded Model Checker) takes a completely different approach: rather than building formulas by hand, you point it at your C source code and it generates the verification conditions automatically. It handles loops by bounding their iteration count. For C-to-C equivalence checking specifically, CBMC is a first-class tool.

**Alive2** deserves a special mention because it does exactly what I built, but as a production tool inside the LLVM project itself. Alive2 checks that LLVM optimisation passes do not change the semantics of the code they transform. It works directly on LLVM IR, uses Z3 under the hood, and is the state of the art for this specific problem. What I built is essentially a simplified version of the same idea — assembled from scratch to understand how the pieces fit together, rather than to replace it.

---

## The Methodology: What I Built

Here is the pipeline, step by step.

**Step 1: Pick a target.** I chose [jsmn](https://github.com/zserge/jsmn) — a small, widely-used JSON tokenizer written in C. It is simple enough to fit in a blog post but complex enough to contain interesting behaviour: unsigned arithmetic, bit-shifting, switch statements, edge cases around integer overflow. I extracted nine pure functions — no side effects, no memory allocation, deterministic output — from its core logic.

**Step 2: Compile both to LLVM IR.** LLVM IR is the intermediate representation used by both clang++ (for C++) and rustc (for Rust). It is a typed, register-based assembly language that is close enough to machine code to be precise, but high-level enough to read. Crucially, it is the same language for both compilers, so I can compare them directly.

```bash
clang++ -O1 -emit-llvm -S targets/jsmn_targets.cpp -o targets/jsmn_cpp.ll
rustc -C opt-level=1 --crate-type=cdylib --emit=llvm-ir \
      --out-dir targets targets/jsmn_targets.rs
```

**Step 3: Parse the IR into Z3 formulas.** I wrote a Python tool using the `llvmlite` library that walks each instruction in an LLVM IR function and builds an equivalent Z3 bit-vector expression. `add i32 %a, %b` becomes a Z3 addition of two 32-bit symbolic values. `ashr i32 %x, %n` becomes an arithmetic right shift in Z3. Branch conditions fork the symbolic execution into separate path conditions; phi nodes merge them back. The whole thing is around 400 lines of Python in [equiv_check.py](https://github.com/akkeshavan/equator/blob/main/equiv_check.py).

**Step 4: Ask Z3 whether the two functions can disagree.** I assert that the C++ return value is not equal to the Rust return value, then call `solver.check()`. If Z3 says `unsat`, the assertion has no solution — meaning the two functions can never disagree — and that is my proof of equivalence. If Z3 says `sat`, it hands me the specific input values where they differ. That is the bug.

**Step 5: If divergent, feed the counterexample back for repair.** The CEGIS loop, described below.

The whole pipeline runs on my laptop in under a second per function. No network calls, no cloud, no waiting. Just Python, Z3, and LLVM IR.

---

## DeepSeek Ports jsmn: What Happened

I ran two different prompting strategies against DeepSeek and compared the results.

The **strict prompt** told DeepSeek to translate literally: same integer literals, same logic structure, no Rust standard library shortcuts, temperature zero. This produced mostly correct code. It is hard to introduce semantic bugs when doing a line-by-line translation — the AI is essentially a syntax converter.

The **loose prompt** told DeepSeek to write idiomatic Rust: use `match` expressions, use ranges, use standard library helpers, be expressive. Temperature 0.7. This is what a developer would actually do in practice — nobody wants a mechanically translated C++ function when idiomatic Rust would be cleaner and safer.

The loose prompt produced three real semantic bugs.

**Bug 1: `extend_sign` — shift direction.**
The C++ function sign-extends a value by left-shifting it up and then arithmetic-right-shifting it back down. The key step is the final shift: it must be an arithmetic right shift, which fills the vacated bits with the sign bit. DeepSeek's idiomatic Rust kept the variable as `u32` throughout, which made the compiler emit a logical right shift instead — one that fills with zeros. For the input `x=0x80, bits=8`, the C++ correctly returns `-128`. The Rust returned `128`. The Z3 counterexample appeared in 48 milliseconds.

**Bug 2: `bit_parity` — signed vs unsigned shifts.**
The parity function XOR-folds a 32-bit value using right shifts. All those shifts must be logical (unsigned right shifts). DeepSeek's idiomatic port operated in signed `i32` throughout, because that felt more natural. For inputs with the top bit set — anything above 2,147,483,647 when treated as unsigned — the right shift on a signed integer becomes an arithmetic shift that fills with sign bits rather than zeros. This corrupts the XOR fold entirely. Z3 found it immediately.

**Bug 3: `saturating_shl` — overflow semantics.**
The saturating left-shift function deliberately uses unsigned arithmetic to avoid signed overflow undefined behaviour. DeepSeek's idiomatic port used signed `i32` with what seemed like sensible overflow guards. The problem is that the Rust compiler added a "no signed wrap" hint to the shift, which lets LLVM assume the overflow cannot happen — defeating the guard entirely. The result passes for small inputs and silently breaks for large ones.

All three bugs were found by Z3 with specific counterexamples. The first was confirmed in under 50 milliseconds. No fuzzer, no randomness — a proof that caught what code review missed.

---

## The CEGIS Loop: History and What I Learned

CEGIS stands for Counterexample-Guided Inductive Synthesis. The name sounds like something a compiler engineer invented while sleep-deprived, but the idea is genuinely elegant.

It was introduced by Armando Solar-Lezama in his 2008 PhD thesis at MIT, titled *Program Synthesis by Sketching*. The problem he was solving was somewhat different: he wanted to automatically complete partial programs — called "sketches" — where the programmer had deliberately left holes. Rather than search the entire space of possible programs, the key insight was to iterate using examples. Each time a candidate program fails on a concrete test case, that example is added to the constraints and the search tries again. The space of valid programs shrinks with every example until only the correct one remains.

I applied the same idea to LLM repair:

1. Run the verifier. If EQUIV, I am done.
2. If DIVERGE, extract the counterexample: the specific input values and the two different outputs.
3. Build a prompt: "Here is the original C++ source, here is your Rust, here is a concrete input where they disagree. Fix the Rust so it matches for all inputs."
4. Ask DeepSeek. Take the new Rust function.
5. Repeat from step 1.

**What I learned.**

For `bit_parity` and `saturating_shl`, the loop converged in one or two iterations. DeepSeek, shown a concrete example like "for `x = 2,147,483,648 (0x80000000)`, the C++ returns 1 but your Rust returns 0", was able to diagnose the signed/unsigned mismatch and fix it. Concrete examples are remarkably effective at communicating the precise nature of a bug.

For `extend_sign`, the loop ran six iterations without converging. The root cause was a semantic gap in the model's understanding: the C++ function relies on LLVM's behaviour for shifts larger than 31 bits, which is undefined in C++ but deterministic in LLVM IR (the compiler emits bare shift instructions; Z3's bit-vector model defines the result as zero for shift amounts ≥ 32). DeepSeek consistently produced Rust code that masked the shift amount to the range [0, 31] — which is what the Rust compiler does for safety — creating a divergence that Z3 caught every single time.

The fix was a one-line guard I wrote by hand. When the LLM does not know what it does not know, I still need to close the loop.

The lesson: CEGIS works well for surface-level translation bugs — signed vs unsigned, wrong comparison operator, missing branch. It struggles when the bug arises from a genuine semantic difference between C++ undefined behaviour and Rust-defined behaviour. That category requires domain knowledge, not just examples.

---

## Where This Fits in Your SDLC

Formal equivalence checking sounds like academic machinery. But the pipeline I built has natural integration points in a real development workflow.

**As a CI gate for ported code.** If your team is migrating a module from C++ to Rust, you can run the equivalence checker as part of your CI pipeline. For every pull request that modifies a ported function, the checker compiles both versions to LLVM IR and runs Z3. A green light means you have a mathematical proof that the behaviour has not changed. A red light produces a specific input where the two diverge — not "the tests failed" but "here is the exact input that breaks it, and here are the two different values they return".

**As a migration audit before merge.** Before merging a large AI-assisted port, run the checker across all pure functions in the codebase. It will immediately identify which functions need human review and which are provably correct. This is a much better use of a code reviewer's time than staring at ten thousand lines of generated Rust hoping to spot a one-bit error.

**As a debugging companion.** Sometimes tests pass, the code looks right, but something is subtly wrong in production. If a ported function is suspected, the equivalence checker produces a counterexample in under a second. That counterexample often makes the bug immediately obvious in a way that reading the code does not.

**The honest limitations.** The current tool only works on *pure functions* — no memory, no pointers, no I/O, no global state. Real code has all of these. Extending to heap memory requires modelling memory as a Z3 array, which is significantly more complex. Loops require either bounded unrolling (check the first N iterations) or loop invariant synthesis (find a mathematical summary of what the loop does). Neither is trivial to automate.

The sweet spot right now is exactly the category of functions jsmn has: pure arithmetic and logic. These turn out to be surprisingly common at the boundaries of tokenisers, parsers, codecs, and cryptographic primitives — precisely the places where off-by-one errors and shift bugs tend to live and cause the most damage.

---

## Conclusion: The Road to a Full C++ → Rust Tool

I proved nine functions equivalent using LLVM IR and Z3, found three semantic bugs in an AI-ported codebase, and partially automated the repair loop using CEGIS. That is already useful. But the more interesting question is: what would it take to turn this into a production-grade tool?

Here is the roadmap as I see it.

**Handle memory.** The largest missing piece. Functions that read and write memory can be modelled with Z3's array theory — the heap becomes a symbolic mapping from addresses to bytes. This is exactly how tools like Alive2 and CBMC handle it. It is not impossible; it is work. The hardest part is aliasing: proving that two pointers do not refer to the same memory requires alias analysis, which is a whole field of its own.

**Handle loops.** Either bounded unrolling — prove equivalence for loops that run at most N iterations — or loop invariant synthesis: find a mathematical summary of what the loop does and prove that summary is equivalent. Active research exists on both fronts, and tools like SymDiff and UC-KLEE tackle this problem for real code.

**Identify pure functions automatically.** Right now I hand-pick the functions I want to check. A production tool should run a points-to analysis over the codebase and flag functions with no side effects automatically. LLVM already does this: the `memory(none)` attribute that appears in my IR dumps is exactly that annotation, inferred by clang at compile time.

**Integrate with the build system.** A CMake plugin, a Cargo test, a GitHub Action — any of these would make the tool invisible to developers. The workflow becomes: write Rust, push, see proof or counterexample. No manual LLVM IR wrangling required.

**Close the CEGIS loop.** The natural end-state is a single command: `port --prove my_module.cpp`. It calls the LLM to generate Rust, runs the equivalence checker, and iterates until proven or hands off to me with a minimal failing example. The LLM writes code; the solver proves it; I only intervene when the solver cannot converge.

The gap between "interesting research project" and "tool you can trust with a production codebase" is real but not insurmountable. The maths is already there. The LLMs are already there. The missing piece is engineering — which, fittingly, is exactly what tools like this exist to help with.

---

All the code from this project is on GitHub: [akkeshavan/equator](https://github.com/akkeshavan/equator). The verifier is around 400 lines of Python and runs on any laptop. Clone [jsmn](https://github.com/zserge/jsmn) separately as described in the README, then run `python3 equiv_check.py`. If you have a function you are not sure about, try it.
