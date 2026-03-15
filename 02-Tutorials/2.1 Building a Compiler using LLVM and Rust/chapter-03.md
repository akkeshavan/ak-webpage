# Building a Compiler with Rust and LLVM - 3

*Part 1: Installation*

---

This chapter sets up your development environment for **Part 1** of the Lumina compiler: the recursive-descent parser and custom lexer. We install **Rust**, **LLVM**, and the **Inkwell** crate, verify the toolchain, and create the Part 1 project layout. All code lives in `source/part1-recursive-descent`.

---

## Goals of this chapter

- Install and verify **Rust** (rustup), **LLVM 17 or 18**, and **Inkwell** so we can generate LLVM IR from Rust.
- Create the **Part 1 project layout** (00-install through 09-lum-cli).
- Confirm the toolchain works by building and running the **00-install** crate and its test.

---

## Code structure in this chapter

| Section | Content |
|--------|--------|
| 3.1 | Prerequisites (Rust, LLVM, Inkwell, clang) |
| 3.2–3.3 | Installing Rust and LLVM (macOS, Linux, Windows notes) |
| 3.4 | Part 1 directory layout (crates 00–09) |
| 3.5 | **00-install crate:** Cargo.toml, main.rs, test; **code walkthrough** below |
| 3.6–3.7 | Troubleshooting, summary |

---

## Dependencies (Cargo.toml) for this chapter

The only crate we create in this chapter is **00-install**. Its `Cargo.toml` has **no parser or compiler dependencies**—only Inkwell so we can touch LLVM:

```toml
[package]
name = "lumina-part1-install"
version = "0.1.0"
edition = "2021"

[dependencies]
inkwell = { version = "0.4", features = ["llvm17-0"] }
```

- **inkwell:** Rust bindings to LLVM’s C API. The **`llvm17-0`** feature links against LLVM 17; use **`llvm18-0`** for LLVM 18. Build will invoke `llvm-config` (or use `LLVM_SYS_170_PREFIX`); the resulting binary can create modules and emit IR.

---

## 3.1 Prerequisites

You need:

- **Rust** (rustc, cargo) via rustup
- **LLVM 17 or 18** (libraries and llvm-config)
- **Inkwell** Rust crate with the feature matching your LLVM version
- **clang** (or another C compiler and linker) for the CLI: it compiles the runtime and links the executable; on macOS it also compiles emitted IR to an object file

---

## 3.2 Installing Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

Verify:

```bash
rustc --version
cargo --version
```

---

## 3.3 Installing LLVM

**macOS (Homebrew):**

```bash
brew install llvm@17
echo 'export PATH="/opt/homebrew/opt/llvm@17/bin:$PATH"' >> ~/.zshrc   # or ~/.bashrc
echo 'export LDFLAGS="-L/opt/homebrew/opt/llvm@17/lib"' >> ~/.zshrc    # or ~/.bashrc
echo 'export CPPFLAGS="-I/opt/homebrew/opt/llvm@17/include"' >> ~/.zshrc # or ~/.bashrc
source ~/.zshrc  # or: source ~/.bashrc
```

**Linux (Ubuntu/Debian):**

```bash
wget https://apt.llvm.org/llvm.sh && chmod +x llvm.sh
sudo ./llvm.sh 17
sudo apt install llvm-17-dev libclang-17-dev clang-17
```

**Windows:** Download from [releases.llvm.org](https://releases.llvm.org/), install to `C:\LLVM`, add `C:\LLVM\bin` to PATH. This series is not regularly tested on Windows; the steps below focus on macOS and Linux.

Verify:

```bash
llvm-config --version   # or llvm-config-17 on Linux
```

---

## 3.4 Creating the Part 1 Project Layout

Create the directory structure:

```
source/part1-recursive-descent/
├── 00-install/          # This chapter: toolchain verification
├── 01-lexer/            # Chapter 4: custom lexer
├── 02-parser/           # Chapter 5: recursive descent parser
├── 03-typecheck/        # Chapter 6: type checking
├── 04-codegen/          # Chapter 7: code generation
├── 05-runtime-stdlib/   # Chapter 8: runtime and stdlib
├── 06-gc/               # Chapter 9: GC integration
├── 07-optimization/     # Chapter 10: optimization
├── 08-targets/          # Chapter 11: multi-target
└── 09-lum-cli/          # Chapter 12: Lum CLI
```

---

## 3.5 The 00-install Crate

The `00-install` crate verifies that Rust, LLVM, and Inkwell work together. Create `source/part1-recursive-descent/00-install/Cargo.toml`:

```toml
[package]
name = "lumina-part1-install"
version = "0.1.0"
edition = "2021"

[dependencies]
inkwell = { version = "0.4", features = ["llvm17-0"] }
```

And `src/main.rs`:

```rust
use inkwell::context::Context;

fn main() {
    let context = Context::create();
    let module = context.create_module("lumina_check");
    let i64 = context.i64_type();
    let fn_type = i64.fn_type(&[], false);
    let _main = module.add_function("main", fn_type, None);
    println!("LLVM and Inkwell: OK");
}
```

Add a test to verify Inkwell/LLVM integration:

```rust
#[cfg(test)]
mod tests {
    use inkwell::context::Context;

    #[test]
    fn inkwell_creates_module() {
        let context = Context::create();
        let module = context.create_module("test");
        assert!(module.get_name().to_str().unwrap() == "test");
    }
}
```

Run:

```bash
cd source/part1-recursive-descent/00-install
cargo build
cargo run
cargo test
```

If you see "LLVM and Inkwell: OK" and tests pass, your environment is ready.

**Implementation walkthrough (00-install):**

1. **`Context::create()`** – Allocates an LLVM context (holds types and constants for one compilation).
2. **`context.create_module("lumina_check")`** – Creates a new module; the name appears in emitted IR.
3. **`context.i64_type()`** – Gets the `i64` type; we use it for the function signature.
4. **`i64.fn_type(&[], false)`** – Function type with zero parameters and return type `i64` (used for a minimal “main”).
5. **`module.add_function("main", fn_type, None)`** – Declares a function named `main` in the module. We don’t add a body; we only check that the API works. In the real pipeline, we’ll declare `lumina_main` (or `lumina_entry`) and build its body from the typed AST.
6. **Test `inkwell_creates_module`** – Creates a module with name `"test"` and asserts `get_name()` returns it, confirming the LLVM/Inkwell link works.

If you get linker errors, ensure the Inkwell feature (`llvm17-0` or `llvm18-0`) matches your installed LLVM version. Set `LLVM_SYS_170_PREFIX` if llvm-config is not on PATH.

---

## 3.6 Troubleshooting

- **"could not find llvm-config"**: Add LLVM's `bin` directory to PATH. On Linux, you may need `llvm-config-17`.
- **Linker errors**: Inkwell's feature must match your LLVM version exactly. Use `llvm17-0` for LLVM 17, `llvm18-0` for LLVM 18.
- **Inkwell build fails**: Set `LLVM_SYS_170_PREFIX` (or equivalent for your version) to your LLVM install root.

---

## 3.7 Summary

You have installed Rust, LLVM, and Inkwell, created the Part 1 project layout, and verified the toolchain with a minimal program. The `00-install` crate confirms that we can create LLVM modules from Rust.

**Next:** **Chapter 4 — Lexer** (custom lexer for Lumina in `01-lexer`).
