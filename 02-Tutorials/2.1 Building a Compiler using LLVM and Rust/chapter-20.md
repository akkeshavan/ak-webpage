# Building a Compiler with Rust and LLVM - 20

*Part 2: GC integration (Boehm GC)*

---

**Garbage collection** in this series uses the **Boehm–Demers–Weiser** collector. Part 2 uses the **same** runtime as Part 1: the C runtime in `source/part1-recursive-descent/05-runtime-stdlib` uses `GC_MALLOC`, `GC_REALLOC`, and `GC_INIT`, and the CLI links with **libgc**. The parser (Pest or hand-written) does not affect how we allocate or collect; the shared runtime and codegen handle it.

This chapter mirrors **Chapter 9** (Part 1 GC): Boehm GC is implemented in the shared runtime; Part 2’s CLI compiles and links the same runtime C, so Lumina programs built with the Part 2 front-end are garbage-collected in the same way as Part 1.

---

## Goals of this chapter

- Confirm that Part 2 uses the **same Boehm GC runtime** as Part 1: same RUNTIME_C (GC_MALLOC, GC_REALLOC, GC_INIT), same link step (-lgc).
- Reuse the **same GC hook names** as Part 1 (lumina_alloc, lumina_push_root, lumina_pop_root) in the 06-gc crate; these are reserved for future precise GC designs.
- Clarify that Part 2’s codegen is Part 1’s, so there is **no Part 2-specific GC logic**.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **Part 1 runtime (05-runtime-stdlib)** | Same as Chapter 9: RUNTIME_C uses Boehm GC. Part 2 CLI depends on this crate and writes RUNTIME_C to `.lum/runtime.c`. |
| **Part 2 CLI** | Same build pipeline as Part 1: parse (Pest) → typecheck → codegen → object → write runtime C → compile runtime → link with -lgc. |
| **06-gc** | Same constants (ALLOC, PUSH_ROOT, POP_ROOT). Part 2 can depend on Part 1’s 06-gc crate for consistency. |

---

## 20.1 Boehm GC (same as Chapter 9)

The runtime in `05-runtime-stdlib` includes `<gc.h>`, uses `GC_MALLOC` and `GC_REALLOC` for array and string allocation, and calls `GC_INIT()` in `main()`. The Part 2 CLI links the executable with `-lgc` (and on macOS, uses the Homebrew libgc path when available). See **Chapter 9** for the full implementation details, installation instructions (`brew install bdw-gc`, `apt install libgc-dev`), and how Boehm’s conservative collection works.

---

## 20.2 Runtime hook names (same as Chapter 9)

```rust
pub const ALLOC: &str = "lumina_alloc";
pub const PUSH_ROOT: &str = "lumina_push_root";
pub const POP_ROOT: &str = "lumina_pop_root";
```

These are reserved for future use (e.g. a precise GC with explicit root tracking). With Boehm GC, allocation is done inside the runtime helpers; roots are found conservatively via stack scanning.

---

## 20.3 Summary

Part 2 reuses Part 1’s runtime and Boehm GC implementation. No Part 2-specific GC code; the shared runtime and link step provide garbage collection for both front-ends.

**Next:** **Chapter 21 — Optimization (Part 2)** (optional `opt` in `07-optimization`).
