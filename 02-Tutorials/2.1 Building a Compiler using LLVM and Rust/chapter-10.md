# Building a Compiler with Rust and LLVM - 10

*Optimization*

---

LLVM provides a rich set of **optimization passes** that transform IR to improve performance. This repo keeps optimization **optional**: the Lumina compiler emits IR for the full language (records, sum types, match, loops), and we can run LLVM’s **opt** on that IR to get faster code; we do not require `opt` on PATH for the basic build. The code for this chapter lives in `source/part1-recursive-descent/07-optimization`.

---

## Goals of this chapter

- Introduce **optimization levels** (O0–O3) and how they affect the kind of passes LLVM runs.
- Show how to **run `opt` from Rust** (e.g. after writing IR to a file) so the CLI or tests can optionally optimize before codegen.
- Summarize **key passes** (inlining, constant propagation, DCE, GVN, SROA, loop opts) and **front-end practices** (clean SSA, phi nodes, loop structure) that help the optimizer.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **07-optimization/src/lib.rs** | **OptLevel** enum (O0–O3), **`to_opt_arg()`**; **`optimize_ir(input_path, output_path, level)`** – runs `opt` as a subprocess. |
| **Tests** | Write minimal IR to a temp file, call **optimize_ir**, assert output exists and contains expected content; skip gracefully if `opt` is not on PATH. |

---

## Dependencies (Cargo.toml) for this chapter

```toml
[package]
name = "lumina-part1-optimization"
version = "0.1.0"
edition = "2021"

[dev-dependencies]
tempfile = "3"
```

There are **no runtime dependencies** on other Lumina crates. **tempfile** is used in tests to create a temporary directory for input/output IR files. The CLI (Chapter 12) can depend on this crate and call **optimize_ir** after emitting IR if the user requests an optimization level.

---

## 10.1 Optimization Levels

LLVM uses optimization levels analogous to `-O0`, `-O1`, `-O2`, `-O3`:

- **O0:** No optimization; fast compilation, easy debugging.
- **O1:** Basic optimizations (inlining, constant propagation, DCE).
- **O2:** More aggressive (loop optimizations, vectorization).
- **O3:** Maximum optimization; may increase compile time.

We can pass `-O2` to `opt` when processing our IR, or configure the pass manager programmatically.

---

## 10.2 Running opt from Rust

The simplest approach: emit IR to a file, run `opt`, then compile/link.

```rust
use std::path::Path;
use std::process::Command;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OptLevel {
    O0,
    O1,
    O2,
    O3,
}

impl OptLevel {
    pub fn to_opt_arg(&self) -> &'static str {
        match self {
            OptLevel::O0 => "-O0",
            OptLevel::O1 => "-O1",
            OptLevel::O2 => "-O2",
            OptLevel::O3 => "-O3",
        }
    }
}

pub fn optimize_ir(input: &Path, output: &Path, level: OptLevel) -> Result<(), String> {
    let status = Command::new("opt")
        .args([level.to_opt_arg()])
        .arg(input)
        .arg("-o")
        .arg(output)
        .status()
        .map_err(|e| format!("failed to run opt: {e}"))?;

    if !status.success() {
        return Err(format!("opt failed with exit code: {status}"));
    }
    Ok(())
}
```

---

## 10.3 Key passes (conceptual)

| Pass | Effect |
|------|--------|
| **Inlining** | Replace calls with callee body; enables further optimizations |
| **Constant propagation** | Replace uses of constants with the value |
| **DCE (Dead Code Elimination)** | Remove unreachable or unused code |
| **GVN (Global Value Numbering)** | Eliminate redundant computations |
| **SROA (Scalar Replacement of Aggregates)** | Promote struct fields to SSA values where possible |
| **Loop optimizations** | Unrolling, invariant code motion |

Our job is to emit **clean IR** so these passes can work. For example, avoid unnecessary alloca/load/store pairs; use SSA values directly when possible.

---

## 10.5 Front-End Considerations

- **Use phi nodes correctly** at merge points so SSA form is preserved.
- **Avoid redundant casts** that confuse the optimizer.
- **Expose loop structure** (e.g. proper loop headers and latches) for loop passes.
- **Only use `nsw`/`nuw`** if your language defines overflow as undefined behavior. If your language uses wrapping or checked arithmetic, these flags are not correct.

Example: marking add as no signed wrap:

```rust
builder.build_int_add(a, b, "sum")
    .map_err(|e| e.to_string())?;
// With nsw:
// builder.build_int_add(a, b, "sum")
//     .and_then(|v| v.as_instruction())
//     .map(|i| i.set_has_no_signed_wrap(true));
```

---

## 10.6 Measuring Optimization Impact

We can run `optimize_ir` on a minimal IR file and assert that `opt` produces output. The test in `source/part1-recursive-descent/07-optimization/src/lib.rs` looks like this (it skips if `opt` is not on PATH):

```rust
#[test]
fn optimize_ir_produces_output() {
    let dir = tempfile::tempdir().expect("temp dir");
    let input_path = dir.path().join("in.ll");
    let output_path = dir.path().join("out.ll");

    let ir = r#"
define void @lumina_main() {
entry:
  ret void
}
"#;
    std::fs::File::create(&input_path)
        .expect("create in.ll")
        .write_all(ir.trim().as_bytes())
        .expect("write ir");

    let result = optimize_ir(&input_path, &output_path, OptLevel::O2);
    if let Err(e) = &result {
        if e.contains("failed to run opt") || e.contains("No such file") {
            eprintln!("skipping: opt not on PATH or LLVM not installed: {e}");
            return;
        }
    }
    result.expect("optimize_ir");

    assert!(output_path.exists(), "opt should produce output file");
    let out_content = std::fs::read_to_string(&output_path).expect("read output");
    assert!(
        out_content.contains("lumina_main") || out_content.contains("void"),
        "output should contain our function or signature"
    );
}
```

The crate uses `tempfile` as a dev-dependency for this test. Run `cargo test` in `07-optimization` (with `opt` on your PATH) to verify.

**Implementation walkthrough:** **`optimize_ir`** builds a `Command` for `opt`, passes the level (e.g. `-O2`), the input path, and `-o` plus the output path. It runs the command and checks the exit status. The Lumina compiler itself does not implement any passes; it only emits IR. So “how the implementation works” here is: we emit IR (from 04-codegen), write it to a file, invoke the external **opt** tool, and read the optimized IR (or feed it to the next step, e.g. compile to object). Front-end quality (SSA, phi nodes, no redundant alloca/load/store) is what lets these passes be effective.

---

## 10.7 Summary

LLVM’s optimizer does the heavy lifting. If you have the `opt` tool available, you can run it from Rust to optimize emitted IR. The most important front-end contribution is emitting simple, SSA-friendly IR and being explicit about language semantics (especially overflow).

**Next:** **Chapter 11 — Generating Code for Different Targets** (multi-target in `08-targets`).
