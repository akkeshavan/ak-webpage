# Building a Compiler with Rust and LLVM - 19

*Part 2: Runtime and standard library*

---

The **runtime** is the small C (or C-compatible) layer that provides `main()` and the standard library functions the generated code calls (e.g. `lumina_println_i64`, `lumina_println_str`, array new/append/get/set/len). Part 2 uses the **same** runtime as Part 1: there is no separate “Part 2 runtime.” The generated IR is the same for the same Lumina program, so the same C runtime and linking steps apply.

This chapter mirrors **Chapter 8** (Part 1 runtime): we describe what the runtime provides, how arrays (including arrays of records) work, and how the CLI uses it. Code lives in `source/part2-pest/05-runtime-stdlib` if we copy or symlink it, or the Part 2 CLI simply depends on Part 1’s runtime crate.

---

## Goals of this chapter

- Confirm that Part 2 uses the **same runtime** as Part 1: the same C source (main, lumina_main, println, print, array APIs).
- Explain **dependencies**: the Part 2 CLI depends on Part 1’s runtime crate (or a copy) to write `.lum/runtime.c` and link.
- Describe the **build pipeline** (same as Ch 8): emit IR, emit object, write runtime.c, compile, link. Only the step that produces the typed program (Pest) differs from Part 1.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **Runtime** | Same as Chapter 8: C source with main(), lumina_* functions (println, array_*_new/append/get/set/len). No Part 2-specific runtime. |
| **Part 2 CLI** | Depends on **lumina-part1-runtime** (or 05-runtime-stdlib copy); writes RUNTIME_C to `.lum/runtime.c`, compiles with clang, links. |
| **Build pipeline** | Read main.lum → Pest parse → typecheck → codegen → main.o; write runtime.c → runtime.o; link → main. |

---

## 19.1 Cargo.toml and dependencies

The Part 2 **CLI** (Chapter 22) needs a runtime. Two options:

1. **Depend on Part 1’s runtime crate:**  
   `lumina-part1-runtime = { path = "../../part1-recursive-descent/05-runtime-stdlib" }`  
   The crate exposes the runtime C source as a string (or embedded file) so the CLI can write it to `.lum/runtime.c` and compile it with `clang`.

2. **Have a Part 2 copy:**  
   `source/part2-pest/05-runtime-stdlib` contains the same C source and the same Rust API as Part 1. Useful if you want Part 2 to build without referencing Part 1; otherwise a single shared crate is simpler.

For the blog we assume the Part 2 CLI depends on **Part 1’s runtime crate** so there is one canonical runtime.

---

## 19.2 Runtime C source (same as Chapter 8)

The runtime provides:

- **`void lumina_main(void);`** – entry point called from `main()` (name matches Part 1 codegen).
- **`lumina_println_i64(int64_t x)`** – prints an integer and newline.
- **`lumina_println_str(const char* s)`** – prints a string and newline.
- **`lumina_print_*`** – same without newline if used.
- **Array helpers:** `lumina_array_i64_new`, `lumina_array_i64_append`, `lumina_array_i64_get`, `lumina_array_i64_set`, `lumina_array_i64_len`, and the same for `str`. Arrays of records use the **i64** array (pointers stored as `int64_t`); the type checker and codegen handle pointer↔i64 conversion.

So: **no Part 2-specific runtime**. The same C file is compiled and linked for both Part 1 and Part 2 builds.

---

## 19.3 Build pipeline (what the CLI does)

When you run `lum build` (Part 2 CLI):

1. Read `src/main.lum`.
2. Parse with **Pest** (Part 2 lexer + parser).
3. Convert to Part 1 AST → typecheck (Part 1) → **TypedProgram**.
4. Codegen (Part 1) → LLVM IR → write `.lum/main.ll`.
5. Emit object file: on macOS, compile `main.ll` with `clang -c -target <triple>`; on other platforms, use Part 1’s `write_object_file` (target machine API).
6. Write Part 1’s runtime C to `.lum/runtime.c`, compile to `.lum/runtime.o` with `clang`.
7. Link `.lum/main.o` and `.lum/runtime.o` → `.lum/main`.

Only step 2 differs from Part 1 (Pest instead of hand-written parser). Steps 3–7 are the same.

**Implementation walkthrough:** There is no new runtime code in Part 2. The “implementation” is: the Part 2 CLI (Chapter 22) calls the same runtime crate as Part 1, gets the same C string (RUNTIME_C), writes it to `.lum/runtime.c`, and runs clang to produce runtime.o. So the runtime exposure is identical to Chapter 8 (type checker prelude, codegen declare_runtime and resolve_callee, runtime C definitions). Any repetition with Ch 8 is intentional so Part 2 readers see the full picture.

---

## 19.4 Summary

| Item | Purpose |
|------|--------|
| **Runtime** | Same C as Part 1: `main`, `lumina_main`, println, array APIs |
| **Arrays of records** | Same as Chapter 8: i64 array, pointer stored as int64_t |
| **CLI** | Uses Part 1 runtime crate; writes `runtime.c`, compiles, links |

Part 2 reuses Part 1’s runtime and build pipeline. Next we reuse GC hook names and optimization.

**Next:** **Chapter 20 — GC integration (Part 2)** (same hook names in `06-gc`).
