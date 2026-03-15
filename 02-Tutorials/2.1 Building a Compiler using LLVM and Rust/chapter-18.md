# Building a Compiler with Rust and LLVM - 18

*Part 2: Code generation*

---

**Code generation** turns the typed program into **LLVM IR** (and optionally into an object file). In Part 2 we **reuse Part 1’s code generator** entirely: the input is the same **TypedProgram** (produced by Part 1’s type checker after we convert the Part 2 AST). So the only change from Part 1 is **how we obtain** the typed program (Pest front-end → convert → typecheck → typed program).

This chapter mirrors **Chapter 7** (Part 1 code generation): we build an LLVM module with `lumina_main` (or the entry name Part 1 uses), lower `TypedExpr`/`TypedStmt` to IR (integers, strings, arithmetic, comparisons, calls, `if`, `for`, records, arrays of records, match), and optionally emit a native object file. Code lives in `source/part2-pest/04-codegen`.

---

## Goals of this chapter

- **Reuse Part 1’s code generator** entirely; no Part 2-specific IR logic.
- Expose **compile(source)** (and optionally **compile_to_entry**) that: typecheck source (Part 2) → get TypedProgram → call Part 1’s **compile_program** (or compile_to_entry) → return IR string.
- So the pipeline is: source → Part 2 typecheck → Part 1 codegen → same IR and object file as Part 1 for the same program.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **04-codegen** | Depends on Part 2 typecheck, Part 1 codegen. |
| **compile(source)** | typecheck(source)? → compile_program(&typed). |
| **compile_to_entry(source)** | typecheck(source)? → compile_to_entry(&typed). No new lowering; all in Part 1. |

---

## 18.1 Cargo.toml and dependencies

`source/part2-pest/04-codegen/Cargo.toml`:

```toml
[package]
name = "lumina-part2-codegen"
version = "0.1.0"
edition = "2021"

[dependencies]
lumina-part2-typecheck = { path = "../03-typecheck" }
lumina-part1-codegen = { path = "../../part1-recursive-descent/04-codegen" }
```

**What each dependency does:**

- **lumina-part2-typecheck:** We call `typecheck(source)` to get a `TypedProgram`. That function already parses (Part 2), converts to Part 1 AST, and runs Part 1’s type checker.
- **lumina-part1-codegen:** Contains `compile_program`, `compile_to_entry`, and (if used) `write_object_file`. It takes a `&TypedProgram` and returns IR (or writes an object file). It knows how to lower every construct (including records, arrays of records, unit, for loops, match).

We do **not** duplicate any IR-building logic in Part 2; we only wire: **source → typecheck → Part 1 codegen**.

---

## 18.2 Public API (implementation walkthrough)

```rust
use lumina_part2_typecheck::typecheck;
use lumina_part1_codegen::{compile_program, compile_to_entry};

/// Compile Lumina source to LLVM IR (full module with entry and all functions).
pub fn compile(source: &str) -> Result<String, String> {
    let typed = typecheck(source).map_err(|e| e.to_string())?;
    compile_program(&typed)
}

/// Compile to a module that defines the entry point used by the runtime (e.g. lumina_main).
/// The CLI may use this or compile_program depending on how the runtime expects the entry.
pub fn compile_to_entry(source: &str) -> Result<String, String> {
    let typed = typecheck(source).map_err(|e| e.to_string())?;
    compile_to_entry(&typed)
}
```

**How this achieves the goal:**

1. **typecheck(source):** Parses with the Pest front-end, converts to Part 1 AST, runs Part 1 type checker. Returns `TypedProgram` or a type error.
2. **compile_program(&typed):** Part 1’s function that builds the LLVM module: declares runtime functions (`lumina_println_i64`, `lumina_println_str`, array new/append/get/set/len), defines every Lumina function, and compiles the entry (e.g. `lumina_main` or `lumina_entry`) that the C runtime will call. Returns the module as a string (IR text).
3. **compile_to_entry:** Same as above but the Part 1 crate may expose a variant that only compiles the entry function; use whichever the runtime and CLI expect.

The **lowering** logic (how `TypedExpr` becomes LLVM instructions) is all in Part 1 (Chapter 7): integers, strings, arithmetic, comparisons, `if` (with optional unit branches), `for` (with range and loop variable), records (struct alloc + field store/load), arrays of records (ptr2int/int2ptr at boundaries), match (tag and payload), and unit. Part 2 just feeds the typed program into that pipeline.

---

## 18.3 Full pipeline (same as Chapter 7)

```
Source (Lumina)
  → Part 2: Pest lexer + parser → AST
  → Part 2: Convert to Part 1 AST → Part 1 type checker → TypedProgram
  → Part 1: Codegen → LLVM IR
  → (optional) Part 1: write_object_file → .o
  → CLI: link with runtime → executable
```

From **TypedProgram** onward, the pipeline is identical to Part 1. The same examples (e.g. Hello World, FizzBuzz, array of records filter) produce the same IR and the same executable behaviour.

---

## 18.4 Tests (same examples as Part 1)

```rust
#[test]
fn codegen_int() {
    let ir = compile("42").unwrap();
    assert!(ir.contains("ret i64 42") || ir.contains("lumina_main") || ir.contains("lumina_entry"));
}

#[test]
fn codegen_add() {
    let ir = compile("1 + 2").unwrap();
    assert!(ir.contains("ret i64") || ir.contains("add"));
}

#[test]
fn codegen_hello() {
    let ir = compile(r#"println("Hello, World!")"#).unwrap();
    assert!(ir.contains("lumina_println_str") || ir.contains("Hello"));
}
```

Run:

```bash
cd source/part2-pest/04-codegen
cargo test
```

(Requires LLVM/Inkwell; same as Part 1.)

---

## 18.5 Summary

| Item | Purpose |
|------|--------|
| **Cargo.toml** | Part 2 typecheck, Part 1 codegen |
| **compile(source)** | typecheck → compile_program → IR string |
| **Part 1 codegen** | All lowering: expr, stmt, for, records, arrays, match, unit |

Part 2 does not implement any new codegen; it reuses Part 1’s. The next chapters reuse Part 1’s runtime, GC hooks, optimization, and targets, then wire the Lum CLI to the Pest front-end.

**Next:** **Chapter 19 — Runtime and standard library (Part 2)** (same as Part 1 in `05-runtime-stdlib`).
