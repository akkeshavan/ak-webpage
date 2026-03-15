# Building a Compiler with Rust and LLVM - 11

*Generating code for different targets*

---

LLVM IR is **target-independent**. The same IR can be compiled to **x86-64**, **ARM**, **AArch64**, **WebAssembly**, and more. This chapter covers how to generate code for different targets using **target triples** and the target machine API (or **llc**), and how cross-compilation fits in. Code lives in `source/part1-recursive-descent/08-targets`.

---

## Goals of this chapter

- Define what a **target triple** is (arch-vendor-os-abi) and how we use it when emitting object files.
- Provide a **host_triple()** helper so the CLI (and tests) can default to the current platform.
- Explain **two ways** to get an object file: in-process (TargetMachine, as in Chapter 7) and external **llc**.
- Note **target-specific** considerations (calling conventions, ABI, cross-compilation needs).

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **08-targets/src/lib.rs** | **host_triple()** – returns a static string (e.g. `aarch64-apple-darwin`, `x86_64-unknown-linux-gnu`) based on `cfg!(target_arch)` and `cfg!(target_os)`. Optional: **compile_to_target** (e.g. run codegen + write_object_file with a given triple). |
| **04-codegen** | **write_object_file(typed, triple, path)** uses the triple to create the TargetMachine and emit the object file. |
| **09-lum-cli** | Calls **host_triple()** (or uses **08-targets**) when building so the object file matches the host (or a user-specified `--target`). |

---

## Dependencies (Cargo.toml) for this chapter

```toml
[package]
name = "lumina-part1-targets"
version = "0.1.0"
edition = "2021"
```

The **08-targets** crate has **no dependencies**. It only exports **host_triple()** (and possibly a helper that takes IR + triple and returns an object path). The CLI and codegen use it; codegen does the actual emission via Inkwell and the target machine API.

---

## 11.1 Target Triples

A **target triple** describes the target platform: `arch-vendor-os-abi`. Examples:

- `x86_64-unknown-linux-gnu` — Linux on x86-64
- `x86_64-apple-darwin` — macOS on x86-64
- `aarch64-apple-darwin` — macOS on Apple Silicon
- `wasm32-unknown-unknown` — WebAssembly

In this repo we primarily use target triples to choose how LLVM emits object files.

---

## 11.2 Choosing a host triple

`source/part1-recursive-descent/08-targets/src/lib.rs` provides a simple `host_triple()` helper:

```rust
pub fn host_triple() -> &'static str {
    if cfg!(target_arch = "x86_64") && cfg!(target_os = "macos") {
        "x86_64-apple-darwin"
    } else if cfg!(target_arch = "aarch64") && cfg!(target_os = "macos") {
        "aarch64-apple-darwin"
    } else if cfg!(target_arch = "x86_64") && cfg!(target_os = "linux") {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(target_arch = "aarch64") && cfg!(target_os = "linux") {
        "aarch64-unknown-linux-gnu"
    } else {
        "x86_64-unknown-linux-gnu"
    }
}
```

---

## 11.3 Emitting objects: two approaches

- **In-process (recommended for this repo)**: use LLVM’s target machine API (see Chapter 7’s `write_object_file`). This does not require `llc` to be installed on PATH.
- **External tool**: call `llc -mtriple ...` if you have LLVM tools installed.

To build for a different platform (e.g. build on x86 macOS for ARM Linux), we need:

1. **LLVM** with the target back-end (usually included).
2. **Linker** and **libraries** for the target (e.g. musl for Linux, or a cross-toolchain).

Example for `aarch64-unknown-linux-gnu`:

```bash
llc -mtriple=aarch64-unknown-linux-gnu -filetype=obj main.ll -o main.o
aarch64-linux-gnu-gcc main.o runtime.o -o main
```

From Rust we'd invoke the appropriate linker for the target.

---

## 11.4 Target-Specific Considerations

- **Calling conventions** differ (e.g. sysv, win64). LLVM handles this when we use the correct triple.
- **ABI** (alignment, struct layout) is target-specific. Our runtime C code should be compiled for the same target.
- **Intrinsics** (e.g. SIMD) may be target-specific; we stick to portable IR for simplicity.

---

## 11.4 Cross-compilation (high level)

Cross-compiling requires more than an object emitter: you also need a compatible linker and libraries for the target. We keep things focused on “emit an object for the host,” but the same triple mechanism extends naturally to other targets.

---

## 11.5 Selecting targets in the CLI

When we build the Lum CLI, we'll add a `--target` flag:

```rust
// The repo currently defaults to host_triple().
let triple = host_triple();
// use write_object_file(..., triple, ...)
```

The default is the host triple.

**Implementation walkthrough:** **host_triple()** is a pure function that matches on `cfg!(target_arch)` and `cfg!(target_os)` and returns the corresponding triple string. No LLVM calls happen in this crate. The **actual** emission is in 04-codegen: **write_object_file** takes the triple, creates a **TargetTriple**, sets it on the module, creates a **TargetMachine** for that triple, sets the module’s data layout from the target machine, then calls **write_to_file**. So “how it works” is: we choose a triple (here, from host_triple), pass it to write_object_file, and LLVM emits machine code for that target.

---

## 11.6 Tests

```rust
#[test]
fn target_x86() {
    let t = host_triple();
    assert!(!t.is_empty());
}

#[test]
fn target_arm() {
    let ir = generate_sample_ir();
    let result = compile_to_target(&ir, "aarch64-unknown-linux-gnu");
    // May skip if cross-toolchain not installed
    if result.is_ok() {
        assert!(result.unwrap().exists());
    }
}
```

---

## 11.8 Summary

LLVM IR is target-independent. In this repo we use the **in-process** target machine API (Chapter 7’s `write_object_file`) by default to emit object code; **llc** with `-mtriple` is available when you need to compile IR from the command line or target a different triple. Cross-compilation requires the appropriate linker and libraries. The Lum CLI will expose `--target` to select the output platform.

**Next:** **Chapter 12 — The Lum CLI** (`source/part1-recursive-descent/09-lum-cli`).
