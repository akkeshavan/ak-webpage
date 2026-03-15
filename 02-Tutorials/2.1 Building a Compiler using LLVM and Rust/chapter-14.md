# Building a Compiler with Rust and LLVM - 14

*Part 2: Installation*

---

This chapter sets up your development environment for **Part 2** of the Lumina compiler: the **grammar-driven** front-end using **Pest**. We install **Rust**, **LLVM**, and **Inkwell**, verify the toolchain, and create the Part 2 project layout. The same prerequisites and verification steps as Part 1 (Chapter 3) apply; only the project root and crate names differ. All Part 2 code lives in `source/part2-pest`.

---

## Goals of this chapter

- Install and verify **Rust**, **LLVM**, and **Inkwell** for Part 2 (same as Part 1).
- Create the **Part 2 project layout** (00-install through 09-lum-cli under `source/part2-pest`).
- Confirm the toolchain with the **00-install** crate: build, run, and test.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **part2-pest/00-install/** | Single crate for this chapter. |
| **00-install/Cargo.toml** | Depends only on **inkwell** (no Pest yet). |
| **00-install/src/main.rs** | Creates Context, module, i64 type, function; prints "Part 2: LLVM and Inkwell OK". |
| **00-install tests** | `inkwell_works` – create module, assert name. |

---

## Dependencies (Cargo.toml) for this chapter

```toml
[package]
name = "lumina-part2-install"
version = "0.1.0"
edition = "2021"

[dependencies]
inkwell = { version = "0.4", features = ["llvm17-0"] }
```

- **inkwell:** Same as Part 1 (Chapter 3). Verifies we can create LLVM modules from Rust. No **pest** dependency yet; that is added in 01-lexer (Chapter 15).

---

## 14.1 Prerequisites

You need the same toolchain as Part 1:

- **Rust** (rustc, cargo) via rustup  
- **LLVM 17 or 18** (libraries and llvm-config)  
- **Inkwell** Rust crate with the feature matching your LLVM version (e.g. `llvm17-0`)  
- **clang** for the CLI (runtime compilation and linking; on macOS, compiling emitted IR to an object file)

In the next chapter we add **pest** and **pest_derive** for the lexer and parser. The `00-install` crate only verifies Rust and LLVM/Inkwell so we can rely on them for codegen later.

---

## 14.2 Installing Rust and LLVM

Same as Chapter 3:

**Rust:**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustc --version
cargo --version
```

**macOS (Homebrew) – LLVM:**

```bash
brew install llvm@17
echo 'export PATH="/opt/homebrew/opt/llvm@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Linux (Ubuntu/Debian):**

```bash
wget https://apt.llvm.org/llvm.sh && chmod +x llvm.sh
sudo ./llvm.sh 17
sudo apt install llvm-17-dev libclang-17-dev clang-17
```

Verify LLVM: `llvm-config --version` (or `llvm-config-17` on some Linux setups).

---

## 14.3 Part 2 project layout

Create the directory structure under `source/part2-pest`:

```
source/part2-pest/
├── 00-install/          # This chapter: toolchain verification
├── 01-lexer/            # Chapter 15: Pest lexer grammar + tokens
├── 02-parser/           # Chapter 16: Pest parser grammar + AST
├── 03-typecheck/        # Chapter 17: Type checking (reuses Part 1)
├── 04-codegen/          # Chapter 18: Code generation (reuses Part 1)
├── 05-runtime-stdlib/   # Chapter 19: Runtime (same as Part 1)
├── 06-gc/               # Chapter 20: GC hooks (same as Part 1)
├── 07-optimization/     # Chapter 21: Optimization (same as Part 1)
├── 08-targets/          # Chapter 22: Multi-target (same as Part 1)
└── 09-lum-cli/          # Chapter 22: Lum CLI (Pest front-end)
```

Only the **front-end** (01-lexer, 02-parser) is implemented with Pest; from type checking onward we reuse Part 1’s crates or depend on the same interfaces.

---

## 14.4 The 00-install crate – Cargo.toml

Create `source/part2-pest/00-install/Cargo.toml`:

```toml
[package]
name = "lumina-part2-install"
version = "0.1.0"
edition = "2021"

[dependencies]
inkwell = { version = "0.4", features = ["llvm17-0"] }
```

**What this does:**

- **`name`:** Part 2 install crate; distinct from `lumina-part1-install` so both can live in the same workspace or be built independently.
- **`edition = "2021"`:** Uses Rust 2021 edition.
- **`inkwell`:** Rust bindings to LLVM. The **`llvm17-0`** feature links against LLVM 17; use **`llvm18-0`** if you have LLVM 18. Inkwell compiles C++ wrapper code and links to your LLVM install; `llvm-config` must be on PATH (or set `LLVM_SYS_170_PREFIX`).

No Pest dependency here: this crate only checks that the codegen stack (Rust + LLVM + Inkwell) works. Pest is added in the lexer crate (Chapter 15).

---

## 14.5 The 00-install crate – code walkthrough

Create `source/part2-pest/00-install/src/main.rs`:

```rust
use inkwell::context::Context;

fn main() {
    let context = Context::create();
    let module = context.create_module("lumina_part2_check");
    let i64 = context.i64_type();
    let fn_type = i64.fn_type(&[], false);
    let _main = module.add_function("main", fn_type, None);
    println!("Part 2: LLVM and Inkwell OK");
}
```

**Walkthrough:**

1. **`Context::create()`** – Creates an LLVM context. The context owns types and constants; one context per compilation is typical.
2. **`context.create_module("lumina_part2_check")`** – Creates a new LLVM module (the unit of compilation: functions, globals, etc.).
3. **`context.i64_type()`** – Gets the `i64` type; we use it for function signatures and later for Lumina’s integers.
4. **`i64.fn_type(&[], false)`** – Function type: returns `i64`, takes no arguments, not variadic. The empty slice is the parameter list.
5. **`module.add_function("main", fn_type, None)`** – Declares a function named `main` with that type. The `None` is for linkage (default external).
6. **`println!("Part 2: LLVM and Inkwell OK")`** – Confirms we got past LLVM/Inkwell setup.

If any of these fail (e.g. missing LLVM or wrong feature), the build or link step will error. Success means we can use Inkwell in later Part 2 crates (e.g. codegen) without changing the toolchain.

---

## 14.6 Tests – verifying Inkwell

Add a test in `source/part2-pest/00-install/src/main.rs` (or in `tests/` or a `#[cfg(test)]` module):

```rust
#[cfg(test)]
mod tests {
    use inkwell::context::Context;

    #[test]
    fn inkwell_works() {
        let context = Context::create();
        let module = context.create_module("test");
        assert!(module.get_name().to_str().unwrap() == "test");
    }
}
```

**What this does:**

- **`Context::create()`** and **`create_module("test")`** – Same as in `main`; ensures the test environment can load LLVM and create a module.
- **`module.get_name().to_str().unwrap() == "test"`** – Verifies the module has the expected name, so we know the API is working.

Run:

```bash
cd source/part2-pest/00-install
cargo build
cargo run
cargo test
```

You should see "Part 2: LLVM and Inkwell OK" and the test passing. If you get linker errors, ensure the Inkwell feature matches your LLVM version and that `llvm-config` is on PATH (or set the appropriate `LLVM_SYS_*_PREFIX`).

---

## 14.7 Troubleshooting

Same as Part 1 (Chapter 3):

- **"could not find llvm-config"**: Add LLVM’s `bin` to PATH; on Linux you may need `llvm-config-17`.
- **Linker errors**: Use the Inkwell feature that matches your LLVM version (`llvm17-0` or `llvm18-0`).
- **Inkwell build fails**: Set `LLVM_SYS_170_PREFIX` (or the equivalent for your version) to your LLVM install root.

---

## 14.8 Summary

Part 2’s installation mirrors Part 1: we set up Rust, LLVM, and Inkwell and verify them with the `00-install` crate. The **Cargo.toml** only depends on Inkwell (no Pest yet). The **main** and **test** code walk through creating an LLVM context, module, and function so we know the codegen path will work when we plug in the Pest front-end and Part 1’s type checker and code generator.

**Next:** **Chapter 15 — Lexer (grammar-driven)** (Pest lexer grammar and token stream in `01-lexer`).
