# Building a Compiler with Rust and LLVM - 1

*Introduction: scope, layout, and environment setup*

---

This series is a practical, code-first guide to compiler construction with **Rust** and **LLVM** (via the **Inkwell** crate). To keep the early chapters **runnable** and **tight**, we start by implementing a small but real pipeline:

**source code → tokens → AST → typed AST → LLVM IR → native executable**

We build the compiler front-end **twice**:

- **Part 1**: hand-written lexer + precedence-climbing (recursive descent) parser
- **Part 2**: grammar-driven front-end using **pest** (a parser generator library for Rust)

Both parts reuse the same back-end ideas (type checking for the subset, LLVM IR generation, and a tiny runtime wrapper so you can actually run the result).

Each chapter is a small one which can be studied in an hour or so. In about 23 days, the user should be able to go though the content.

---

## 1.1 What This Blog Is About (and What It Isn’t)

### 1.1.1 Where is the code?

**This repository contains only the blog (the chapters you are reading).** The runnable compiler source code lives in a separate repository:

**[akkeshavan/llvm-blog-source](https://github.com/akkeshavan/llvm-blog-source)**

Clone that repo to follow along and run the commands in this series. Every path we mention—e.g. `source/part1-recursive-descent/01-lexer`, `source/part2-pest/02-parser`—refers to the directory layout inside **llvm-blog-source**. After cloning it you can `cd source/part1-recursive-descent/01-lexer && cargo test` and so on.

### 1.1.2 What you will build (in the source repo)

By the end of Part 1 you will have:

- **A lexer** that tokenizes a small Lumina subset (`source/part1-recursive-descent/01-lexer`)
- **A parser** that builds an AST for the full Lumina language, including sum types, match expressions, and the modulus operator (`%`) (`source/part1-recursive-descent/02-parser`)
- **A type checker** for the full language (`source/part1-recursive-descent/03-typecheck`)
- **A code generator** that emits LLVM IR for a function named `lumina_main` (`source/part1-recursive-descent/04-codegen`)
- **A tiny C runtime wrapper** that provides `main()` and prints the result (`source/part1-recursive-descent/05-runtime-stdlib`)
- **A CLI** (`lum init`, `lum build`, `lum run`) that builds and runs an executable (`source/part1-recursive-descent/09-lum-cli`)

Part 2 repeats the front-end using **pest**, then reuses the same typechecker/codegen/runtime/CLI approach.

### 1.1.3 Language choices: Rust, C, and C++

Most of the compiler is written in **Rust**: the lexer, parser, type checker, IR generator (via Inkwell), and CLI are all Rust. A few parts, however, use **C** or depend on **C++**:

- **C runtime** — The small runtime that provides `main()`, I/O, arrays, and GC integration is written in **C** (embedded in the `lumina_part1_runtime` crate and compiled to an object file). C is used because it links cleanly with the LLVM-generated code, the Boehm GC library exposes a C API, and C remains the lingua franca for system-level runtimes that must interface with arbitrary toolchains.
- **LLVM (C++)** — LLVM itself is implemented in **C++**. We use it through the Inkwell crate, which provides Rust bindings over LLVM’s C API and builds C++ glue code during compilation. We do not write C++ ourselves, but the dependency exists because LLVM is the industry-standard infrastructure for code generation and optimization, and it happens to be implemented in C++.

### 1.1.4 What we are deliberately postponing

Things like HM polymorphism, modules, a large standard library, closures, and a real GC are **excellent next steps**, but they’re not the starting point here. (We *do* implement **sum types** and **match expressions** in Part 1.) This repo focuses on getting you to a working end-to-end compiler pipeline quickly, with code you can run and modify.

---

## 1.2 Contents

- **Chapters 1–2**: orientation + LLVM mental model
- **Part 1 (Chapters 3–12)**: hand-written front-end + shared pipeline + CLI
- **Part 2 (Chapters 13–22)**: grammar-driven front-end using pest + shared pipeline + CLI
- **Part 3 (Chapter 23)**: **Advanced topics, conclusion and next steps** — LLVM IR internals, MLIR, summary of what you’ve learnt, ideas for extending Lumina, and links to further resources (single chapter; end of series)

In the [source repo](https://github.com/akkeshavan/llvm-blog-source), Part 1 chapter N (3–12) maps to directory `source/part1-recursive-descent/0(N-3)-...` (e.g. Chapter 4 → `01-lexer`, Chapter 12 → `09-lum-cli`); Part 2 (Chapters 13–22) uses `source/part2-pest/` with the same numbering.



---

## 1.3 Installation Instructions

You will need **Rust**, **LLVM** (for Inkwell), and **clang** (for compiling the runtime and linking the executable; on macOS, the CLI also uses clang to compile emitted IR to an object file). The instructions below focus on **macOS and Linux**; Windows is not regularly tested for this series—you may need to adapt paths and use a compatible C toolchain (e.g. Visual Studio Build Tools).

### Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Install C++ (and C) toolchain

You need a C/C++ compiler (e.g. **clang** or **g++**) to compile the runtime, link executables, and—on some setups—build Inkwell’s bindings to LLVM.

**macOS:**

Install the Xcode Command Line Tools (includes Apple Clang for C and C++):

```bash
xcode-select --install
```

If you prefer LLVM’s clang via Homebrew instead, it will be installed as part of **Install LLVM** below.

**Linux and Windows:**

- **Linux (Ubuntu/Debian):** Install `build-essential` (gcc, g++, make). See the [Ubuntu wiki — Compilers](https://help.ubuntu.com/community/CompilingEasyHowTo) or run `sudo apt install build-essential`. When you install LLVM below, `clang-17` may be used for the runtime.
- **Windows:** Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (or full Visual Studio) with the “Desktop development with C++” workload. See [Microsoft Docs — Install C++ on Windows](https://learn.microsoft.com/en-us/cpp/build/vscpp-step-0-installation).

### Install LLVM (recommended: LLVM 17)

You need LLVM development libraries that match the `inkwell` feature flag used in the crates (this repo uses `llvm17-0`).

**macOS (Homebrew):**

```bash
brew install llvm@17
```

Add LLVM tools to your PATH (pick the one that matches your shell):

```bash
# zsh
echo 'export PATH="/opt/homebrew/opt/llvm@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# bash
echo 'export PATH="/opt/homebrew/opt/llvm@17/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

**Linux (Ubuntu/Debian):**

```bash
wget https://apt.llvm.org/llvm.sh && chmod +x llvm.sh
sudo ./llvm.sh 17
sudo apt install llvm-17-dev libclang-17-dev clang-17
```

### Install Boehm GC

The Lumina runtime uses the **Boehm–Demers–Weiser** garbage collector for heap allocation. You must install the library before building and running Lumina programs.

**macOS (Homebrew):**

```bash
brew install bdw-gc
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt install libgc-dev
```

See **Chapter 9** for more details on GC integration.

### Verify

```bash
rustc --version
cargo --version
llvm-config --version   # may be llvm-config-17 on Linux
clang --version         # needed for runtime and linking (and on macOS for IR→object)
```

---

> **Info:** The code examples used in this blog have only been tested on macOS. On other platforms there may be build issues if some dependencies are not installed. Readers are expected to have enough technical expertise to install missing dependencies and set paths as needed.

## 1.4 Summary

You’ll build a small, end-to-end compiler pipeline in Rust using LLVM, first with a hand-written front-end and then with a grammar-driven front-end using pest. The early scope is intentionally modest so the code is runnable, testable, and easy to extend.

**Next:** **Chapter 2 — LLVM Architecture Deep Dive.**
