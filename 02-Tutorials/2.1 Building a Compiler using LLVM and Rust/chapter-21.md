# Building a Compiler with Rust and LLVM - 21

*Part 2: Optimization*

---

**Optimization** is optional: we can run LLVM’s **opt** tool (or the equivalent pass manager) on the emitted IR to improve performance. Part 2 uses the **same** approach as Part 1: the IR we emit is identical for the same program, so **opt** behaves the same. We do not implement any Part 2-specific optimization logic.

This chapter mirrors **Chapter 10** (Part 1 optimization): optimization levels, running `opt` from Rust, and front-end practices that help the optimizer (clean SSA, phi nodes, loop structure). Code lives in `source/part2-pest/07-optimization` or we depend on Part 1’s crate.

---

## Goals of this chapter

- Reuse the **same optimization story** as Part 1: optional run of **opt** on emitted IR (O0–O3).
- No Part 2-specific optimization logic: the IR is the same for the same program, so **opt** behaves identically.
- (Optional) Part 2 crate that depends on Part 1’s optimization crate and re-exports **optimize_ir** and **OptLevel**, or the Part 2 CLI depends on Part 1’s crate directly.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **07-optimization** (optional) | Depends on Part 1’s **lumina-part1-optimization**; re-exports or wraps **optimize_ir**, **OptLevel**. |
| **Part 2 CLI** | After writing `.lum/main.ll`, can call **optimize_ir** to produce optimized IR, then compile that to an object file. |
| **Implementation** | Same as Ch 10: Command::new("opt").args([level, input, "-o", output]).status(). |

---

## 21.1 Cargo.toml and dependencies

Either:

- **Depend on Part 1:**  
  `lumina-part1-optimization = { path = "../../part1-recursive-descent/07-optimization" }`  
  and call its `optimize_ir(input_path, output_path, level)` after writing IR to a file.

Or:

- **Part 2 crate** that re-exports or wraps Part 1’s API so the Part 2 CLI can call it the same way.

---

## 21.2 Optimization levels (same as Chapter 10)

- **O0:** No optimization; fast compile, easy debugging.
- **O1:** Basic (inlining, constant propagation, DCE).
- **O2:** More aggressive (loop opts, vectorization).
- **O3:** Maximum optimization.

The Part 2 CLI can take a flag (e.g. `lum build --opt 2`) and run `opt -O2` on `.lum/main.ll` before compiling to object code, exactly like Part 1.

---

## 21.3 Implementation walkthrough (optional)

If the Part 2 CLI implements optimization in its own crate:

```rust
use std::path::Path;
use std::process::Command;

pub enum OptLevel { O0, O1, O2, O3 }

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
        .args([level.to_opt_arg(), input.as_os_str(), "-o", output.as_os_str()])
        .status()
        .map_err(|e| format!("failed to run opt: {e}"))?;
    if !status.success() {
        return Err(format!("opt failed with exit code: {status}"));
    }
    Ok(())
}
```

This is the same pattern as Part 1 (Chapter 10). The CLI would write IR to `.lum/main.ll`, call `optimize_ir` to produce `.lum/main_opt.ll`, then compile the optimized IR to an object file.

---

## 21.4 Summary

Part 2 reuses Part 1’s optimization story: same levels, same `opt` invocation, same IR. No Part 2-specific passes or logic.

**Next:** **Chapter 22 — Targets and the Lum CLI (Part 2)** (multi-target and `lum init` / `lum build` / `lum run` with Pest front-end).
