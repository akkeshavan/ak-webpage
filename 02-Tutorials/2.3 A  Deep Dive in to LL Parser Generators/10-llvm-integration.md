# Chapter 10: Integrating with LLVM

**Previous:** [Chapter 9 — Interpreted Mode](09-interpreted-mode.md)

This chapter adds a **compilation path**: from the **same AST** we use for interpretation, we **generate LLVM IR** and use LLVM to produce native code. So the user can either **interpret** (Chapters 6–9) or **compile** (this chapter).

> **Implementation note:** The reference repo includes **`llvm_codegen.rs`**, which compiles the **expression** AST to LLVM IR **as text** (no LLVM/inkwell dependency). Full language and native binary are left as extensions. See [Implementation status](../docs/IMPLEMENTATION_STATUS.md).

## 10.1 Why LLVM?

- **LLVM** provides a portable IR, optimizations, and code generation for many architectures.
- We emit **LLVM IR** from our AST; then the LLVM toolchain compiles it to an object file or executable.
- In Rust we can use **inkwell** or **llvm-sys** (or similar) to generate IR programmatically.

## 10.2 High-Level Pipeline

- **Input:** Same as before: source → lexer → parser → AST.
- **New step:** **AST → LLVM IR** (code generator).
- **Then:** LLVM compiles IR to native (e.g. `llc`, `clang`, or LLVM C API) and link (e.g. with a small runtime for `print`/`write`/`readfile` or libc).

So we have two back ends:

1. **Interpreter:** AST → interpreter + runtime (Chapters 6–9).
2. **LLVM:** AST → LLVM IR → native executable (this chapter).

**CLI integration (Chapter 9):** The reference tool’s **`parser_gen compile <script> -o <out.ll>`** command parses a FullLang script, takes the first expression statement, converts it to the expression AST, and runs **`llvm_codegen::compile_expr_to_ir`** to write LLVM IR to a file. So the same pipeline (grammar → parser → AST) can feed either the interpreter or the LLVM codegen; currently only the **expression** part of the AST is compiled to IR. Extending to full programs (control flow, functions) is described later in this chapter.

## 10.3 Code Generation from AST

We need to map each AST construct to LLVM IR:

- **Literals:** Constants (integer, global string for string literals).
- **Variables:** Allocate (alloca) or use SSA values; load/store for assignment.
- **Binary/unary ops:** LLVM add, sub, mul, div, comparison, etc.
- **Control flow:** LLVM basic blocks, `br`, `cond_br` for if/else and loops.
- **Functions:** LLVM function with params and body; `ret` for return.
- **Calls:** `call` instruction; for stdlib we either emit IR that calls our own runtime (C/Rust functions) or inline simple ones.

We can start with the **expression language** (no control flow, no functions) and then extend to the **full language**.

## 10.4 Runtime for Compiled Code

Interpreted mode uses our **interpreter + runtime** (Rust/JS). For **compiled** code we need a **native runtime**: small C or Rust library that provides `print`, `write`, `readfile` and is linked with the generated code. So:

- Generated code calls **runtime functions** (e.g. `runtime_print`, `runtime_readfile`).
- We implement those in C or Rust and link them with the object file produced from our IR.

Alternatively we can emit IR that defines those helpers inline (e.g. `printf` for print), but a small runtime library keeps things clean and extensible.

## 10.5 Using LLVM from Rust

- **inkwell:** Safe bindings; we build an LLVM module, add functions, basic blocks, instructions, then write IR to file or run the LLVM pipeline.
- **Steps:** Create module → create builder → for each function in AST create LLVM function and fill body (blocks, instructions) → verify and emit `.ll` (text IR) or `.o` (object).

We don’t need to implement the full language in one go; start with integers, arithmetic, one function, then add control flow and I/O.

## 10.6 Build and Link

- Emit **LLVM IR** (text or bitcode).
- Run `clang script.ll runtime.o -o script` (or use LLVM’s API to run the full pipeline and link).
- Document how to build the runtime and link it with the generated code.

## 10.7 Output of This Chapter

- **Code generator:** AST → LLVM IR (at least for a subset of the language).
- **Runtime library** (C or Rust) for `print`/`write`/`readfile` used by compiled programs.
- **Instructions** for building and running the compiled output.

The tutorial then has two complete paths: **interpreted** (parser + interpreter + runtime in the target language) and **compiled** (parser + AST → LLVM → native + small runtime).

---

## 10.8 Source Code: LLVM Code Generation

The reference crate implements **`llvm_codegen.rs`**: it walks the **expression** AST and emits LLVM IR **as a string** (no inkwell/LLVM dependency). You can extend it to full language and/or use **inkwell** (optional feature) to build IR in memory and run the LLVM pipeline.

### 10.8.1 Public API (`source/code/src/llvm_codegen.rs`)

```rust
pub fn compile_expr_to_ir(expr: &Expr, module_name: &str) -> Result<String, Box<dyn std::error::Error>>
```

- Writes a **`define i64 @main() { entry: ... ret i64 <value> }`** module.
- The **value** is the result of **`emit_expr(expr, out, 0)`**, which returns `(value_string, next_temp_index)`.

### 10.8.2 Emitting expressions (string-based)

- **`emit_expr(expr, out, temp)`** appends IR lines to `out` and returns `(result_value, next_temp)`.
- **Literal(n):** return `(n.to_string(), temp)` (e.g. `ret i64 42`).
- **Binary(left, op, right):** recursively emit left and right; then append one line: `  %tN = add|sub|mul|sdiv i64 L, R`; return `("%tN", temp+1)`.
- **Unary(Neg, operand):** emit operand; append `  %tN = sub i64 0, V`; return `("%tN", temp+1)`.
- **Ident:** error in expr-only mode (no allocas).

The generated IR is valid LLVM IR and can be written to a `.ll` file and compiled with `clang -x ir script.ll -o script` (or linked with a runtime).

### 10.8.3 Optional: inkwell (sketch)

For in-process LLVM (and eventual object-file emission), use the **inkwell** crate (optional feature `llvm`; requires an LLVM version feature and LLVM installed). The same algorithm applies: create module and builder, emit a `main` function, and for each expression node emit the corresponding LLVM IR via builder APIs (e.g. `build_int_add`). See the chapter sketch above (10.8 in older editions) for the inkwell-based structure.

### 10.8.4 Building and linking

- Emit IR to a `.ll` file (e.g. `std::fs::write("out.ll", compile_expr_to_ir(&expr, "m")?)`).
- Run `clang -x ir out.ll -o out` (or link with a small C runtime for `print`/I/O).

---

## 10.9 Code Walkthrough: Key Algorithms

### Algorithm 1: AST → LLVM IR

**Goal:** For each AST node, produce the equivalent LLVM IR (values and instructions).

- **Literal(n):** Emit a constant: `context.i64_type().const_int(n, true)`.
- **Binary(left, op, right):** Recursively emit `left` and `right` to get two `IntValue`s; then emit one instruction: `build_int_add`, `build_int_sub`, `build_int_mul`, `build_int_signed_div`. LLVM IR is in SSA form, so every value has a single definition.
- **Ident(name):** Look up `name` in a **symbol table** (alloca or parameter). Emit a `load` from that alloca. For a full language we’d create allocas at variable declaration/function entry and store on assignment.
- **Control flow (if/for/while):** Create basic blocks (e.g. `then_bb`, `else_bb`, `merge_bb`), emit `cond_br` or `br`, and position the builder in the right block. **Phi** nodes may be needed when different paths produce a value that is used later.

### Algorithm 2: Runtime for compiled code

Interpreted mode uses the Rust (or JS) runtime. For **compiled** code we need a **native** runtime: a small C or Rust library that exports functions like `runtime_print(int64_t)`, `runtime_readfile(const char*)`, and link that with the generated object. So the generated IR contains `call @runtime_print(i64 %result)` instead of interpreting a call.

### Algorithm 3: One pipeline, two back ends

- **Interpreter:** AST → `eval` / `exec` with Runtime (Chapters 6–9).
- **LLVM:** AST → `emit_expr` / `emit_stmt` → LLVM IR → object file → link with runtime → executable.

The **same** AST is consumed by both; only the back end (interpreter vs codegen) differs.

---

**End of tutorial.** You now have a roadmap for building an ANTLR4-like parser generator in Rust, with lexer generation, multi-target ASTs, a simple and a full language, an interpreter with an extensible runtime, and LLVM integration. From Chapter 3 onward, each chapter includes **source code** in `source/code/` and a **code walkthrough** of the key algorithms.
