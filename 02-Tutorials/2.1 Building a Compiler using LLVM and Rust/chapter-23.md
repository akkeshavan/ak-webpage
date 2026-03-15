# Chapter 23 — Part 3: Advanced Topics, Conclusion and Next Steps

*Building a Compiler with Rust and LLVM*

This chapter is **Part 3**. It (1) takes a **deep dive** into LLVM IR and **MLIR**; (2) **summarizes** what you’ve learnt; (3) gives **ideas for extending** the Lumina grammar and language; and (4) points to **further resources** (LLVM, MLIR, parsing, Rust). It closes the series.

---

## 23.1 LLVM IR: Module Structure

A **module** is the top-level container. It holds:

- **Global variables** — `@glob = global i64 0`
- **Function declarations** — `declare void @external_fn(i64)`
- **Function definitions** — `define i64 @main() { ... }`

One module typically corresponds to one compilation unit (e.g. one source file). When linking, multiple modules (or their object files) are combined.

```llvm
; ModuleID = 'lumina'
source_filename = "main.lum"

@counter = global i64 0, align 8

define i64 @add(i64 %0, i64 %1) {
  ; ...
}
```

---

## 23.2 Functions and Signatures

A function has:

- **Name** — e.g. `@main`, `@add`, `@lumina_main`
- **Return type** — `i64`, `void`, `i8*`
- **Parameter types** — `(i64, i64)`
- **Basic blocks** — the body

```llvm
define i64 @add(i64 %a, i64 %b) {
entry:
  %sum = add i64 %a, %b
  ret i64 %sum
}
```

Parameters and locals in SSA form are **values** (virtual registers like `%a`, `%sum`), not memory locations. We use `alloca` only when we need an address (e.g. for mutable variables or taking a reference).

---

## 23.3 Basic Blocks

A **basic block** is a sequence of instructions with:

- **Single entry** — no jump into the middle
- **Single exit** — the last instruction is a **terminator** (`ret`, `br`, `switch`, `invoke`)

Control flow is a **graph** of blocks. The optimizer reasons about dominance, dominance frontiers, and loop structure using this graph.

```llvm
entry:
  %cond = icmp ne i64 %x, 0
  br i1 %cond, label %then, label %else

then:
  %a = add i64 %x, 1
  br label %merge

else:
  %b = add i64 %x, 2
  br label %merge

merge:
  %result = phi i64 [ %a, %then ], [ %b, %else ]
  ret i64 %result
```

---

## 23.4 SSA (Static Single Assignment)

Every non-terminator instruction assigns to a **unique** virtual register. Each register is **defined exactly once**. This makes data flow explicit and enables:

- **Constant propagation** — if a value is constant, replace all uses
- **Dead code elimination** — if a value is never used, remove its definition
- **Register allocation** — each SSA value maps to a register or spill slot

We cannot "update" a variable; we create new values. For mutable state we use `alloca`/`load`/`store` (memory) or structure the IR so phi nodes merge values at control-flow joins.

---

## 23.5 Phi Nodes

When control flow **merges** (e.g. after `if`/`else`), we need a single value representing the result from different paths. The **phi** instruction does this:

```llvm
%result = phi i64 [ %a, %then ], [ %b, %else ]
```

Meaning: if we came from block `%then`, `%result` is `%a`; if from `%else`, `%result` is `%b`. Phi nodes must be the **first** instructions in a block (before any non-phi).

**Why phi?** In SSA we cannot have two definitions for the same register. Phi "merges" values from predecessors without violating SSA.

---

## 23.6 Metadata

LLVM supports **metadata** for debug info, profiles, and custom annotations:

```llvm
!0 = !{i32 1, !"Debug Info Version", i32 3}
!1 = !DIFile(filename: "main.lum", directory: "/src")
```

We can attach metadata to instructions, values, or functions. Debuggers use it for source mapping.

---

## 23.7 Emitting IR from Rust (Inkwell)

When we use Inkwell to build IR, we are creating these structures programmatically:

```rust
let entry = context.append_basic_block(func, "entry");
builder.position_at_end(entry);
let sum = builder.build_int_add(a, b, "sum").unwrap();
builder.build_return(Some(&sum)).unwrap();
```

This produces a block with an `add` and a `ret`. For phi nodes:

```rust
let phi = builder.build_phi(context.i64_type(), "result").unwrap();
phi.add_incoming(&[(&then_val, then_block), (&else_val, else_block)]);
```

---

## 23.8 MLIR: What Is It?

**MLIR** (Multi-Level Intermediate Representation) is an extensible compiler infrastructure that sits **above** LLVM IR. It provides:

- **Dialects** — Custom IRs (e.g. `linalg` for linear algebra, `tensor` for tensors)
- **Operations** — Extensible op set; each dialect defines its own
- **Lowering** — Passes that transform one dialect to another, eventually reaching the **LLVM dialect**
- **Multi-level** — Keep high-level structure longer; optimize at the right abstraction

Unlike LLVM IR, which is fixed, MLIR lets you define your own operations and transformations.

---

## 23.9 Why MLIR?

LLVM IR is low-level and generic. For **domain-specific** compilers (e.g. machine learning, GPU, DSLs), you often want:

- **Higher-level ops** — e.g. `linalg.matmul` instead of loops and loads
- **Domain-specific optimizations** — fuse ops, tile loops, before lowering to loops
- **Multiple targets** — CPU, GPU, TPU; MLIR can lower to different back-ends

MLIR allows you to stay at a higher abstraction, apply domain passes, then lower to LLVM (or other targets like SPIR-V for GPUs).

---

## 23.10 Dialects and Operations

A **dialect** groups related operations. Example (simplified):

```mlir
// In the "arith" dialect
%c = arith.addi %a, %b : i64

// In the "func" dialect
func.func @main() -> i64 {
  %result = arith.constant 42 : i64
  func.return %result : i64
}
```

Each op has a **name** (e.g. `arith.addi`), **operands**, and **results**. Types are explicit.

---

## 23.11 Lowering to LLVM

MLIR includes an **LLVM dialect** that mirrors LLVM IR. A lowering pass transforms, e.g. `arith.addi` into `llvm.add`. The result can be exported to LLVM IR and then to machine code via `llc`.

```
High-level MLIR → Lowering passes → LLVM dialect → LLVM IR → Machine code
```

---

## 23.12 When to Use MLIR vs LLVM IR

| Use LLVM IR when | Use MLIR when |
|------------------|----------------|
| Building a general-purpose language compiler | Building a DSL, ML framework, or GPU compiler |
| You want a single, well-understood IR | You need domain-specific ops and optimizations |
| Simple pipeline: AST → IR → opt → codegen | Multi-stage lowering with domain passes |
| Targeting CPU (x86, ARM) primarily | Targeting CPU + GPU, custom accelerators |

For Lumina, LLVM IR is sufficient. MLIR shines for things like TensorFlow, IREE, and Halide.

---

## 23.13 Rust and MLIR

MLIR has C APIs; Rust bindings exist (e.g. `mlir-sys`, `melior`). Using MLIR from Rust is more involved than Inkwell. For most language compilers, LLVM IR remains the right choice.

---

## 23.14 Summary (Advanced Topics)

- **LLVM IR:** Modules (globals, functions), functions (blocks), basic blocks (instructions in SSA). Phi nodes merge values at control-flow joins. Understanding this helps you emit correct and optimization-friendly IR.
- **MLIR:** Dialects and multi-level lowering; use it when you need domain-specific IRs and transformations. For general-purpose languages like Lumina, LLVM IR is typically enough.

---

## 23.15 What You Have Learnt

You now have an end-to-end picture of building a small but real compiler with Rust and LLVM.

### Pipeline and architecture

- **Source → tokens → AST → typed AST → LLVM IR → object file → link with runtime → executable.** You implemented this pipeline and ran it via the **Lum CLI** (`lum init`, `lum build`, `lum run`).
- **LLVM’s role:** IR is the contract between front-end and back-end. You used **Inkwell** to build modules, functions, basic blocks, and SSA values (including phi nodes for control-flow merges). You emitted object files in-process (and on macOS, used clang for correct Mach-O metadata) and linked with a tiny C runtime.

### Two front-ends

- **Part 1:** Hand-written **lexer** (tokens) and **recursive-descent** (precedence-climbing) **parser** for the full Lumina grammar: expressions, statements, functions, records, sum types, match, arrays, for loops, and stdlib (println, ArrayLen, get, append, etc.).
- **Part 2:** **Grammar-driven** front-end with **Pest**: formal grammar, lexer and parser generated from it, then conversion to the same Part 1 AST so the rest of the pipeline (type checker, codegen, runtime, CLI) is shared. You saw how the same language can be implemented with different parsing strategies.

### Language and tooling

- **Lumina** supports: integers, strings, records, arrays (i64, str, records), optional types, sum types and match, functions, for loops, ranges, and a minimal stdlib. You type-checked and lowered all of this to LLVM IR.
- **Runtime and targets:** A C runtime provides `main()`, `lumina_main()`, println/print, array APIs, and optional unwrap. You used **host_triple()** and object emission for the host platform; optimization (opt) and multi-target (llc) were discussed.
- **Testing:** Unit tests in each crate; verification of Hello World, FizzBuzz, and array-of-records examples with `lum run`.

---

## 23.16 Extending the Grammar and Language

Here are concrete directions to grow Lumina; each implies grammar, type-checking, and codegen (and possibly runtime) changes.

### Syntax and expressions

- **Infix operators:** Add more operators (e.g. `&&`, `||`, `^`, `<<`, `>>`) and assign precedence in the grammar (Part 1 parser and Part 2 Pest grammar) and in the type checker (e.g. bool or int).
- **Block expressions:** Allow blocks to yield a value (e.g. `let x = { let a = 1; a + 2 };`) so the last expression is the block’s type and value.
- **String interpolation:** Extend string literals with embedded expressions (e.g. `"Hello, {name}!"`) and lower to concatenation or a runtime call.

### Types and semantics

- **Generics / parametric polymorphism:** Allow `fn id<T>(x: T) -> T` and instantiate at call sites; extend the type checker with type variables and substitution.
- **Modules and visibility:** Add a module system (e.g. `mod foo { ... }`, `use foo::bar`) and scope rules; grammar for module boundaries and imports.
- **Closures:** Introduce lambda expressions that capture environment; extend the type system (function types, capture lists) and codegen (closure layout, calling convention).
- **Traits / interfaces:** Define traits and impl blocks; type checker resolves trait bounds and method dispatch (vtable or monomorphisation).

### Control flow and stdlib

- **While loops:** Add `while cond { ... }`; grammar, type check (cond must be int or bool if you add bool), and codegen (branch and back-edge).
- **Break and continue:** In for/while, add `break` and `continue`; codegen with branch to loop exit or loop header.
- **Standard library:** Expand the runtime (e.g. file I/O, more math, string split/join) and expose names in the type-checker prelude.

### Grammar and tooling

- **Error recovery:** In the parser, add recovery points so multiple syntax errors are reported in one run.
- **Incremental parsing:** For editors, consider an incremental or partial parse (e.g. for syntax highlighting and outline) without re-parsing the whole file.
- **Formatting:** Define a canonical style for Lumina and implement a formatter (e.g. `lum fmt`) that parses and re-emits.

Start small (e.g. one new operator or `while`), then layer on types and features.

---

## 23.17 Further Resources

Use these to go deeper into LLVM, MLIR, and related topics.

### LLVM

- **LLVM Language Reference Manual** — [https://llvm.org/docs/LangRef.html](https://llvm.org/docs/LangRef.html)  
  Authoritative IR reference: instructions, types, metadata, attributes.

- **LLVM Programmer’s Manual** — [https://llvm.org/docs/ProgrammersManual.html](https://llvm.org/docs/ProgrammersManual.html)  
  Coding standards, important APIs, and how to navigate the codebase.

- **Inkwell (Rust bindings)** — [https://github.com/TheDan64/inkwell](https://github.com/TheDan64/inkwell)  
  Documentation and examples for generating IR from Rust.

- **LLVM Tutorial: Kaleidoscope** — [https://llvm.org/docs/tutorial/](https://llvm.org/docs/tutorial/)  
  Classic C++ tutorial; concepts (AST, IR, codegen, JIT) transfer to Rust/Inkwell.

### MLIR

- **MLIR Documentation** — [https://mlir.llvm.org/docs/](https://mlir.llvm.org/docs/)  
  Dialects, operations, lowering, and Toy tutorial.

- **MLIR Tutorial (Toy language)** — [https://mlir.llvm.org/docs/Tutorials/Toy/](https://mlir.llvm.org/docs/Tutorials/Toy/)  
  End-to-end example of a small language in MLIR.

- **Rust and MLIR** — [melior](https://github.com/raviqqe/melior), [mlir-sys](https://github.com/raviqqe/mlir-sys)  
  Rust bindings for MLIR (more involved than Inkwell; useful if you target MLIR).

### Parsing and compilers

- **Pest (PEG parser)** — [https://pest.rs/](https://pest.rs/)  
  Grammar syntax, API, and book for the parser generator used in Part 2.

- **Crafting Interpreters** — [https://craftinginterpreters.com/](https://craftinginterpreters.com/)  
  Interpreters and bytecode; many ideas (AST, scopes, control flow) apply to compilers.

- **Modern Compiler Implementation in ML / Java / C** — (Appel)  
  Standard textbook for compilation phases, type checking, and code generation.

### Rust and tooling

- **Rust Book** — [https://doc.rust-lang.org/book/](https://doc.rust-lang.org/book/)  
  For deepening Rust while implementing compiler data structures and passes.

- **clap (CLI)** — [https://docs.rs/clap](https://docs.rs/clap)  
  Used in the Lum CLI; useful for adding subcommands and flags.

---

## 23.18 Summary

You have built two full compilers for Lumina (hand-written and grammar-driven front-ends), wired them to LLVM IR and a C runtime, and run them with the Lum CLI. You have explored LLVM IR internals and MLIR, seen how to extend the grammar and language, and where to look next for more depth.

**End of the series.** Happy compiling—and enjoy extending Lumina and exploring the resources above.
