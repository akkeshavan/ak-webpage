# Building a Compiler with Rust and LLVM - 2

*LLVM architecture deep dive: history, design, and Clang integration*

---

This chapter gives a thorough treatment of **LLVM**: how compilers were built **before** LLVM, how they are built **now** with LLVM, the **architecture** of LLVM (front-end, middle-end, back-end), and how **Clang** and C++ are integrated. We explain **why** LLVM has become the **standard** for building compilers and what advantages it offers. Everything is written in simple language with **small Rust examples** using **Inkwell** so you have a clear mental model before implementing the Lumina compiler in Parts 1 and 2.

Before diving into LLVM, we briefly introduce **Lumina** itself—the language we will compile—so you know what we are lowering to IR.

---

## Goals of this chapter

- Introduce **Lumina** (the language we will compile) and its types, expressions, and program structure.
- Explain how compilers were built **before** LLVM and **with** LLVM (front-end → IR → middle-end → back-end).
- Describe **LLVM architecture**: IR, pass manager, code generator, target machine, SSA, phi nodes.
- Show how **Clang** fits in as the C/C++ front-end and how we use **Inkwell** from Rust to generate IR.
- State **advantages** of LLVM and why it has become the standard.

There is **no separate code crate** for this chapter; the only code is a small Inkwell example (Section 2.6) that illustrates the same API used later in `source/part1-recursive-descent/04-codegen`.

---

## Code structure in this chapter

| Section | Content |
|--------|--------|
| 2.1 | Lumina language: types, expressions, statements, program structure |
| 2.2 | How compilers were built before LLVM: early hand-crafted (Fortran, COBOL), interpreters (Lisp), GCC and GNU history, need for a shared layer |
| 2.3 | Pipeline with LLVM: front-end → IR → middle-end → back-end |
| 2.4 | LLVM architecture: IR, pass manager, codegen, SSA, phi; **2.4.1** brief history of LLVM |
| 2.5 | Clang and C++ integration; emitting IR from Clang |
| 2.6 | **Code walkthrough:** Generating IR from Rust with Inkwell (minimal `add` function) |
| 2.7–2.8 | Advantages of LLVM; why it is the standard |
| 2.9 | Summary |

---

## 2.1 The Lumina Language

**Lumina** is a small, statically typed language designed to illustrate a full compiler pipeline. It supports the following.

**Types and type definitions**

- **Primitives:** `i64`, `str`, and `unit`.
- **Composite:** **Generic arrays** (`array<T>` or `Array<T>`, e.g. `Array<i64>`, `Array<str>`), optionals (`T?`), and **records** (struct-like: `{ name: Type, ... }`). Records can be defined inline or named via `type Name = { ... };`. The stdlib provides **`ArrayLen(arr)`** to get the length of an array for use in loops: `for i in 0..ArrayLen(arr) { ... }`..
- **Sum types (algebraic data types):** A type is one of several variants, each with an optional payload. For example:
  - `type Option = Some(i64) | None;`
  - `type Result = Ok(i64) | Err(str);`
  Constructors are called like `Some(42)` or `None` (no parentheses). Sum types enable pattern matching.

**Expressions**

- **Literals:** Integers, strings, arrays `[e1, e2, ...]`, and `null` (for optionals).
- **Variables** and **field access** on records (`base.field`).
- **Arithmetic:** `+`, `-`, `*`, `/`, `%` (modulus).
- **Comparisons:** `==`, `!=`, `<`, `<=`, `>`, `>=`.
- **Control flow:** `if e then e1 else e2 end`.
- **Loops:** `for var in range_expr do ... end` (range is `start..end` or `start..=end`).
- **Record literals:** `{ field: expr, ... }`.
- **Function calls:** `name(args...)`, including built-ins such as `println`, `print`, and standard-library helpers (e.g. `sqrt`, `max`, `min`, array operations).
- **Match expressions:** Exhaustive pattern matching on sum types:
  - `match expr with | Variant1(x) -> e1 | Variant2 -> e2 end`
  - Every variant of the sum type must appear exactly once; each arm can bind payload names and must produce a value of the same type. The compiler checks exhaustiveness and type consistency.

**Statements**

- **Let binding:** `let name [: Type] = expr;`
- **Assignment:** `lhs = rhs;` (where `lhs` is a variable or a record field).
- **Expression statement:** `expr;`
- **Return:** `return;` or `return expr;`
- **For loop:** `for var in range do stmts end`

**Program structure**

- **Type definitions** at the top: `type Name = ... ;`
- **Functions:** `fn name[(type_params)](params) -> return_type { body }` with optional type parameters.
- A **main** entry point: either an explicit `fn main() { ... }` or a sequence of statements that are wrapped into a generated `main`.

Lumina is intentionally small so we can focus on the compiler: lexing, parsing, type checking, and **lowering to LLVM IR**. All of the features above are implemented in the Part 1 recursive-descent compiler and will be referenced when we describe IR generation.

---

## 2.2 How Compilers Were Built Before LLVM

Before LLVM became dominant, compilers followed a few distinct paths. Understanding that history clarifies why a shared, reusable IR and code generator matter.

### 2.2.1 Early hand-crafted compilers: one language, one machine

In the 1950s and 1960s, compilers were **hand-crafted for a specific language and a specific machine**. There was no portable IR; the compiler writer designed the entire pipeline—lexing, parsing, and especially **code generation**—around one architecture. Register layout, instruction selection, and calling conventions were baked in. Porting to a new CPU meant rewriting the back-end (or the whole compiler) from scratch.

**Fortran (1957)** — The first widely used high-level language compiler. John Backus and his team at IBM built it for the **IBM 704**. The compiler was a huge undertaking: it had to map Fortran's expressions, loops, and arrays to 704 machine code (fixed-point and floating-point instructions, index registers, memory layout). Success proved that high-level languages could produce efficient code, but the 704 was the only target. Other vendors later built their **own** Fortran compilers for their **own** machines (e.g. UNIVAC, CDC); each was a separate, machine-specific implementation. There was no shared "Fortran IR" or reusable code generator.

**COBOL (1959)** — Designed for business applications and **portability** ("write once, run anywhere"). In practice, **every manufacturer produced its own COBOL compiler** for its own hardware. The language standard (and later ANSI COBOL) defined syntax and semantics, but code generation—how you got from COBOL to IBM 360, Univac, or Honeywell machine code—was implemented independently by each vendor. Again: one language, many hand-crafted back-ends, no shared infrastructure. Adding a new architecture meant another full compiler effort.

So **optimization** and **code generation** were repeated, in different forms, for every (language, target) pair. The same ideas (register allocation, peephole optimization, instruction selection) were reimplemented again and again, with inconsistent quality and slow adoption of new CPUs.

### 2.2.2 Interpreters and Lisp

Not every early language was compiled to machine code. **Lisp** (1958, John McCarthy at MIT) was initially **interpreted**. Programs were represented as symbolic data structures (S-expressions); an **interpreter** walked the tree and executed operations (eval/apply). That avoided the cost of writing a separate code generator for every machine: one interpreter could run the same Lisp on any machine that hosted it. The trade-off was **performance**—interpretation is slower than native code—but Lisp's flexibility (code as data, dynamic typing, REPL) made interpreters a natural fit. Over time, Lisp systems evolved: bytecode interpreters, then **compilers** that turned Lisp into machine code (e.g. Lisp Machine compilers, later Common Lisp compilers). The idea of a **single, high-level representation** (trees or bytecode) that could be interpreted or compiled later influenced both virtual machines (Java, Python) and the later push for a **shared IR** in the compiler world.

### 2.2.3 GCC and the rise of portable toolchains

**GNU** (GNU's Not Unix) was launched in **1983** by **Richard Stallman** at MIT. His goal was a complete, freely distributable Unix-like system: kernel, utilities, and—critically—a **compiler**. Until then, Unix systems typically shipped with proprietary compilers; Stallman wanted a **free** compiler that could build the rest of GNU and that users could study and modify.

**GCC** (GNU Compiler Collection) began as the **GNU C Compiler** in **1987**. It was designed to support **multiple targets** (different CPUs) and, over time, **multiple languages** (C, C++, Fortran, Ada, etc.). Unlike the old Fortran/COBOL world, a **single** codebase generated code for many architectures; front-ends produced a common internal representation (GENERIC, then GIMPLE), and the back-end (RTL, then later SSA-based) handled machine-specific code generation. That made GCC the **de facto standard** compiler on **Linux** and many Unix-like systems in the **1990s** and **early 2000s**. Distributions shipped GCC by default; most open-source C/C++ code was built with it. GCC's success proved that a **portable, multi-target, multi-language** toolchain was feasible and that free software could compete with commercial compilers. (GCC remains central today; we mention it here as the dominant pre-LLVM model that LLVM later complemented and, in some domains, displaced.)

### 2.2.4 The need for a shared layer

So before LLVM, you had: **(1)** early hand-crafted compilers (one language, one machine; Fortran, COBOL); **(2)** interpreters (e.g. Lisp) that avoided machine-specific codegen but paid in performance; **(3)** portable toolchains (GCC) with a shared IR and many targets. Even with GCC, **optimization** and **code generation** were expensive to extend and maintain, and integrating new languages or new targets was heavy. The **optimization** and **code generation** phases are hard and expensive. If every language and target had its own implementation, the same ideas were reimplemented again and again: inconsistent quality, slow progress on new CPUs, and a high barrier to creating new languages. The need for a **shared, reusable** layer between language-specific work and machine-specific work was clear. LLVM is the successful answer.

---

## 2.3 How Compilers Are Built Now With LLVM

With LLVM, the pipeline is **split** into three stages:

```
  Source (Lumina, C++, Swift)  →  [ Front-end ]  →  LLVM IR  →  [ Middle-end ]  →  [ Back-end ]  →  Machine code
        (we build in Rust)           (LLVM optimizes)              (LLVM codegen)
```

- **Front-end:** Lexer, parser, type checker; **lowering** the AST to **LLVM IR**. We emit IR; LLVM does not know the source language.
- **Middle-end:** Optimization passes (inlining, constant propagation, DCE, SROA, GVN). Same passes for every front-end. IR is in **SSA form**.
- **Back-end:** Instruction selection, register allocation; emits assembly or object code. One IR targets x86, ARM, AArch64, WebAssembly.

The **IR** is the **contract**: produce valid LLVM IR, and LLVM optimizes and generates code. The IR is language-independent, target-independent, and well-documented.

---

## 2.4 LLVM Architecture in Detail

**LLVM** is a **compiler infrastructure**: libraries and tools for building compilers. Its core insight is a **single, well-defined IR** as the boundary between language and machine.

**Key components:**
- **IR:** `Module` (top-level), `Function`, `BasicBlock`, `Instruction`, `Value`, `Type`. Serialized to `.ll` (text) or `.bc` (bitcode).
- **Pass Manager:** Runs analysis and transformation passes (inlining, constant propagation, etc.).
- **Code Generator:** Target descriptions, instruction selection, register allocation. Output: assembly or object code.
- **TargetMachine:** Encapsulates target triple (e.g. `x86_64-pc-linux-gnu`) and ABI options.

**SSA (Static Single Assignment):** Every value is defined exactly once. When control flow merges (e.g. after `if`/`else`), we use **phi** instructions:

```llvm
merge:
  %result = phi i64 [ %a, %then_block ], [ %b, %else_block ]
```

### 2.4.1 A brief history of LLVM

**LLVM** started in **2000** at the **University of Illinois at Urbana–Champaign**, led by **Chris Lattner**. The goal was a modular, reusable compiler infrastructure: a well-defined **IR**, optimization passes that work on that IR, and **retargetable** code generation so that adding a new CPU or a new language did not require rewriting the whole stack. The project was open-sourced in 2003 and grew steadily.

**Apple** adopted LLVM in the **mid-2000s** for use in its toolchain. It funded the development of **Clang** (a new C/C++/Objective-C front-end for LLVM, replacing GCC in many Apple workflows) and used LLVM for Just-In-Time compilation in OpenGL and for **Swift**, which was designed to use LLVM IR from the start. That adoption gave LLVM broad visibility and industrial backing.

Today LLVM is a **cross-company, open-source** project (LLVM Foundation), with contributions from Apple, Google, Microsoft, and many others. It underpins **Clang**, **Swift**, **Rust** (rustc), **Julia**, and countless research and product compilers. Its library-first design—optimizer and code generator usable in-process, not only as a command-line tool—makes it the standard choice for new compilers and JITs. The history of hand-crafted and GCC-era compilers (Section 2.2) led to this: one shared IR, one shared optimizer, many front-ends and many targets.

---

## 2.5 How Clang and C++ Fit In

**Clang** is the C/C++/Objective-C front-end for LLVM. It parses source, builds an AST, performs semantic analysis, and **lowers** to LLVM IR. The **clang++** driver runs: preprocess → compile (to IR) → optimize → codegen → assemble → link. You can emit IR with `clang++ -emit-llvm -S -c file.cpp -o file.ll`.

When we build Lumina in Rust, we use **Inkwell** (bindings to LLVM's C API) to construct IR the same way Clang does—by creating modules, functions, basic blocks, and instructions. LLVM treats our IR identically.

---

## 2.6 Generating IR from Rust with Inkwell (code walkthrough)

The example below (from `source/part1-recursive-descent/04-codegen`) shows how we create a minimal LLVM module in Rust. **How it works:**

```rust
use inkwell::context::Context;
use inkwell::module::Module;

fn main() {
    let context = Context::create();
    let module = context.create_module("lumina");
    let i64_type = context.i64_type();
    let fn_type = i64_type.fn_type(&[i64_type.into(), i64_type.into()], false);
    let fn_val = module.add_function("add", fn_type, None);
    let entry = context.append_basic_block(fn_val, "entry");
    let builder = context.create_builder();
    builder.position_at_end(entry);
    let a = fn_val.get_nth_param(0).unwrap().into_int_value();
    let b = fn_val.get_nth_param(1).unwrap().into_int_value();
    let sum = builder.build_int_add(a, b, "sum").unwrap();
    builder.build_return(Some(&sum)).unwrap();
    println!("{}", module.print_to_string().to_string());
}
```

This produces IR like:

```llvm
define i64 @add(i64 %0, i64 %1) {
entry:
  %sum = add i64 %0, %1
  ret i64 %sum
}
```

**Implementation walkthrough:**

1. **`Context::create()`** – Creates the LLVM context (owns types and constants).
2. **`context.create_module("lumina")`** – Creates a module (the top-level unit: functions, globals).
3. **`context.i64_type()`** – Gets the `i64` type for parameters and return.
4. **`i64_type.fn_type(&[i64_type.into(), i64_type.into()], false)`** – Builds the function type: two `i64` parameters, returns `i64`, not variadic.
5. **`module.add_function("add", fn_type, None)`** – Declares the `add` function in the module.
6. **`context.append_basic_block(fn_val, "entry")`** – Adds a single basic block named `"entry"`.
7. **`context.create_builder()`** and **`builder.position_at_end(entry)`** – Builder is used to emit instructions; we position it at the end of the entry block.
8. **`fn_val.get_nth_param(0/1)`** – Gets the parameter values (SSA values); we cast to `IntValue` for integer ops.
9. **`builder.build_int_add(a, b, "sum")`** – Emits an `add i64` instruction; the result is an SSA value named `"sum"`.
10. **`builder.build_return(Some(&sum))`** – Emits `ret i64 %sum`.
11. **`module.print_to_string()`** – Serializes the module to IR text.

**Context** holds LLVM state; **Module** is the compilation unit; **Builder** emits instructions. Our Lumina compiler will use this same API to lower typed AST nodes to IR. Lumina emits a single entry function **`lumina_main()`** (or `lumina_entry()` in some setups) that the C runtime calls from `main`.

---

## 2.7 Advantages of LLVM

- **Reuse across languages and targets:** One optimizer, many languages (Clang, Swift, Rust, Julia, Lumina). One back-end, many targets (x86, ARM, WebAssembly).
- **SSA simplifies optimization:** Use-def chains are explicit; passes like GVN and constant propagation are effective.
- **Libraries, not just tools:** We link LLVM into our compiler; we can run the pass manager and code generator in-process. JIT compilers and static analyzers use the same API.
- **Open source and ecosystem:** Documentation, bindings (Inkwell for Rust), industry adoption (Apple, Google, Microsoft).

---

## 2.8 Why LLVM Has Become the Standard

**Apple** uses LLVM for Swift and Clang. **Rust** (rustc) uses LLVM as its back-end. **Swift, Julia**, and many domain compilers and toolchains build on LLVM. In practice this means:

- **Interoperability:** Our Lumina executables can link with C libraries; same ABI, same code generator.
- **Tooling:** Debuggers and profilers work with LLVM-generated code.
- **Industry alignment:** Compiler engineers are expected to know LLVM.

Building Lumina on LLVM is technically sound and aligned with how compilers are built today.

---

## 2.9 Summary

- **Lumina** is a small, statically typed language with primitives (i64, str, unit), records, arrays, optionals, **sum types**, and **match expressions**; type definitions and functions (including main) form a program.
- **Before LLVM:** Monolithic compilers tied to one language and one target; limited reuse.
- **With LLVM:** Front-end (emits IR) → middle-end (optimizes) → back-end (codegen). The IR is the only interface.
- **LLVM IR:** Modules, functions, basic blocks, SSA, phi nodes. Pass manager and code generator are shared.
- **Clang** lowers C/C++ to IR; we use **Inkwell** in Rust to do the same for Lumina.
- **Advantages:** Reuse, SSA, libraries, ecosystem. LLVM has become the standard for building compilers.

**Next:** Part 1 begins with **Chapter 3 — Part 1: Installation** (Rust, LLVM, Inkwell, and the Part 1 project layout in `source/part1-recursive-descent`).
