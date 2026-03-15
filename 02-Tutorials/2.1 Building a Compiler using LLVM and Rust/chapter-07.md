# Building a Compiler with Rust and LLVM - 7

*Code generation (Part 1: LLVM IR + object emission)*

---

**Code generation** turns the **TypedProgram** into **LLVM IR** (and optionally into a native object file). In this repo it (1) builds an LLVM module that defines the entry point **`lumina_main`** (or `lumina_entry`) and all user + stdlib functions, and (2) can emit a native **object file** in-process via LLVM’s target machine API. The code lives in `source/part1-recursive-descent/04-codegen`.

---

## Goals of this chapter

- **Lower** the typed AST to LLVM IR: every TypedExpr and TypedStmt becomes a sequence of LLVM instructions (SSA form, basic blocks, phi nodes where needed).
- **Declare** runtime/stdio functions (println, print, array new/append/get/set/len, etc.) in the module so generated code can call them.
- **Implement** lowering for integers, strings, arithmetic, comparisons, calls, `if`, `for` (with ranges), records (alloc, field access), arrays (including arrays of records with ptr2int/int2ptr), match, and unit.
- **Emit** an object file (e.g. for the CLI) using the target machine API and a target triple.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **`compile_program(program)`** | Entry: build module, declare runtime, define all Lumina functions, set entry (e.g. lumina_main), return IR string. |
| **`build_module`** | Creates Context and Module; calls **`declare_runtime`**; for each function in the program, builds function with **`compile_stmt_list`** for the body. |
| **`declare_runtime`** | Adds external function declarations (lumina_println_i64, lumina_println_str, array_*_new/append/get/set/len, etc.) so the generated code can call them. |
| **`compile_expr`**, **`compile_stmt`** | Recursively lower TypedExpr/TypedStmt to builder calls (load/store, arithmetic, branches, phi, calls). |
| **`compile_for`** | Lowers a for-loop over a range into preheader, loop header, body block, increment, and merge block with phi for the loop variable. |
| **`write_object_file`** | Sets module triple and data layout, creates TargetMachine, writes object file to disk. |

---

## Dependencies (Cargo.toml) for this chapter

```toml
[package]
name = "lumina-part1-codegen"
version = "0.1.0"
edition = "2021"

[dependencies]
inkwell = { version = "0.4", features = ["llvm17-0"] }
lumina-part1-typecheck = { path = "../03-typecheck" }
```

- **inkwell:** To build LLVM IR (Context, Module, Builder, types, instructions) and to emit object files (Target, TargetMachine, write_to_file).
- **lumina-part1-typecheck:** We consume **TypedProgram**, **TypedExpr**, **TypedStmt**, **Type** to drive lowering; we do not parse or typecheck again.

---

## 7.1 Emitting LLVM IR (updated)

`source/part1-recursive-descent/04-codegen/src/lib.rs`:

**Update:** codegen now compiles a full typed program, not a single expression. The entry function is:

- `pub const ENTRY_FN_NAME: &str = "lumina_main";`

and the public entry point is:

- `compile_program(program: &TypedProgram) -> Result<String, String>`

The helper `build_module` constructs the function body and returns a ready-to-print LLVM module.

---

## 7.2 Lowering a `TypedExpr` to LLVM instructions

The current `compile_expr` returns an optional LLVM value (because `unit`-typed expressions don’t produce a value) and supports:

- integers and strings
- arithmetic (including modulus `%`, lowered to LLVM `srem`) and comparisons
- function calls and `if` expressions

---

## 7.4 Update: lowering `for` + ranges to LLVM CFG

Ranges are currently a **compile-time construct** used by `for` loops (not a heap object).

A `for i in start..=end { ... }` loop is lowered into basic blocks roughly like:

- **preheader**: compute `start`, `end`, and `step`
- **loop**: a PHI node `i` selects `start` (first iteration) or `i_next` (next iterations)
- **cond**: compute the loop condition; if the step is positive we use `i <= end` (or `< end`), otherwise `i >= end` (or `> end`)
- **body**: compile the loop body with `i` bound in the environment
- **inc**: compute `i_next = i + step` and jump back to loop
- **after**: continue execution after the loop

This gives correct behavior for:

- `1..10` (exclusive, step +1)
- `1..=10` (inclusive, step +1)
- `1,2..10` (derived step \(= 2-1 = +1\))
- `100,98..0` (derived step \(= 98-100 = -2\))

**Implementation walkthrough:**

1. **`compile_program(program)`** – Creates a Context and Module; calls **`declare_runtime(module, context)`** to add declarations for all C runtime functions (println, array_*, etc.). Then iterates over the program’s functions: for each, creates an LLVM function with the right signature (parameter types from TypedProgram: i64, ptr for str/record, etc.), creates an entry block, positions the builder, runs **`compile_stmt_list`** on the body. The last statement of the entry (or the block that contains it) must end with a return; we compile Return(expr) to build_return. For the **entry** function (e.g. main), we compile the body that calls user main or runs top-level statements.
2. **`compile_expr(expr)`** – Returns `Option<BasicValueEnum>` (None for unit). **Int** → const_int. **Str** → global constant + pointer cast. **Var** → load from pointer in env (we alloca in the entry block when we see a let). **Add/Sub/Mul/Div/Mod** → build_int_add/sub/mul/sdiv/srem. **Call** → resolve callee name to the LLVM name (e.g. println_i64 → lumina_println_i64); convert args (e.g. record → ptr2int for array append); build_call; if return type is record, int2ptr the result. **If** → create then/else/merge blocks, build conditional branch, compile both branches, phi at merge. **For** → compile range (start, end, step), create loop blocks, phi for loop variable, compile body with var in env, build back-edge. **Record literal** → alloca struct, store each field; return pointer. **Array literal** → call array_*_new, then for each element call append (with ptr2int for records). **Match** → compile scrutinee, then branch on tag and compile each arm.
3. **`write_object_file`** – Target::initialize_all(); create TargetTriple from the string (e.g. aarch64-apple-darwin); set module triple and data layout from the target machine; call target_machine.write_to_file(module, Object, path).

---

## 7.3 Emitting a native object file (`write_object_file`)

The CLI (Chapter 12) needs a real object file to link. We can do that in-process using LLVM’s target machine API:

```rust
pub fn write_object_file(expr: &TypedExpr, triple: &str, out_path: &Path) -> Result<(), String> {
    let context = Context::create();
    let module = build_module(&context, expr)?;

    Target::initialize_all(&InitializationConfig::default());
    let target_triple = TargetTriple::create(triple);
    module.set_triple(&target_triple);

    let target = Target::from_triple(&target_triple).map_err(|e| e.to_string())?;
    let target_machine = target
        .create_target_machine(
            &target_triple,
            "generic",
            "",
            OptimizationLevel::None,
            RelocMode::Default,
            CodeModel::Default,
        )
        .ok_or("failed to create target machine")?;

    let data_layout = target_machine.get_target_data().get_data_layout();
    module.set_data_layout(&data_layout);

    target_machine
        .write_to_file(&module, FileType::Object, out_path)
        .map_err(|e| e.to_string())
}
```

---

## 7.4 Running tests

```bash
cd source/part1-recursive-descent/04-codegen
cargo test
```

---

## 7.5 Summary

We can now emit LLVM IR for the full Lumina program (including records, sum types, and match) and produce a native object file. Next we’ll add a tiny runtime wrapper so we can link and run the result.

**Next:** **Chapter 8 — Runtime and Standard Library** (`source/part1-recursive-descent/05-runtime-stdlib`).
