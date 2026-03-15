# Building a Compiler with Rust and LLVM - 12

*The Lum CLI*

---

The **Lum CLI** is the user-facing tool for Lumina projects. It supports **`lum init`**, **`lum build`**, and **`lum run`**. Code lives in `source/part1-recursive-descent/09-lum-cli`.

---

## Goals of this chapter

- Provide a **single entry point** for users: create a project (**init**), compile it (**build**), and run it (**run**).
- **Wire the full pipeline:** read source → lex → parse → typecheck → codegen → object file → runtime C → link → executable.
- Show **complete runnable examples** (Hello World, FizzBuzz, array-of-records filter) that work with the current compiler.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **09-lum-cli/src/main.rs** | **Binary** entry; parses CLI (e.g. with **clap**): subcommands **init**, **build**, **run**. Dispatches to **init_project**, **build_project**, **run_project**. |
| **init_project(dir)** | Creates `src/`, `lum.toml`, `src/main.lum` (default content e.g. `42`). |
| **build_project(project_dir)** | Reads `src/main.lum`, calls parser → typecheck → codegen; writes `.lum/main.ll`; produces `.lum/main.o` (via write_object_file or clang on macOS); writes runtime C to `.lum/runtime.c`, compiles to `.lum/runtime.o`, links to `.lum/main`. |
| **run_project(project_dir)** | Calls **build_project**, then runs the resulting executable. |

---

## Dependencies (Cargo.toml) for this chapter

```toml
[package]
name = "lumina-part1-lum-cli"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "lum"
path = "src/main.rs"

[dependencies]
clap = { version = "4", features = ["derive"] }
tempfile = "3"
lumina-part1-parser = { path = "../02-parser" }
lumina-part1-typecheck = { path = "../03-typecheck" }
lumina-part1-codegen = { path = "../04-codegen" }
lumina-part1-runtime = { path = "../05-runtime-stdlib" }
lumina-part1-targets = { path = "../08-targets" }
```

- **clap:** Parses command-line arguments (init, build, run, and any flags like `--target`).
- **tempfile:** For tests that create temporary project directories.
- **lumina-part1-parser:** **parse(source)** to get **Program**.
- **lumina-part1-typecheck:** **TypeChecker::check_program** (or equivalent) to get **TypedProgram**.
- **lumina-part1-codegen:** **compile_program** for IR, **write_object_file** for the object file.
- **lumina-part1-runtime:** **RUNTIME_C** (or equivalent) to write `.lum/runtime.c`; optionally **ENTRY_FN_NAME**.
- **lumina-part1-targets:** **host_triple()** for the default target when emitting the object file.

---

## 12.1 Commands

| Command | Description |
|---------|-------------|
| `lum init [dir]` | Create a new Lumina project in the given directory (default: current) |
| `lum build` | Compile the project, producing an executable (run from project root) |
| `lum run` | Build and run the executable (run from project root) |

Run `lum build` and `lum run` from the **project root** (the directory that contains `lum.toml` and `src/`).

---

## 12.2 Project Structure

A Lumina project created by `lum init` looks like:

```
my-project/
├── lum.toml       # Project config (name, dependencies)
├── src/
│   └── main.lum   # Entry point
└── .lum/          # Build artifacts (optional, gitignored)
```

### Example: Initialize and build a project

From a directory where you want to create a new Lumina project (and with `lum` on your PATH, e.g. after `cargo build --release` in `source/part1-recursive-descent/09-lum-cli`):

```bash
# Create a new project in the current directory
lum init

# Or create it in a named directory
lum init my-app
cd my-app

# Build the project (produces .lum/main.ll, .lum/main.o, and .lum/main)
lum build

# Run the executable (builds if needed, then runs)
lum run
```

The default `src/main.lum` created by `lum init` contains a single expression `42`, which the compiler wraps in `println` and runs. After `lum run` you see `42` printed. The sections below show two complete programs you can paste into `src/main.lum` and run.

---

## 12.3 Complete example: Hello World

Replace the contents of `src/main.lum` with:

```lumina
println("Hello, World!");
```

Run from the project root:

```bash
lum run
```

Output:

```text
Hello, World!
```

The compiler wraps this in an implicit `main` that calls `println` and exits.

---

## 12.4 Complete example: FizzBuzz

This program defines a **function** `fizzbuzz(n)` that prints "Fizz" when `n` is divisible by 3, "Buzz" when divisible by 5, "FizzBuzz" when divisible by both, and the number otherwise. **Main** calls it in a **for** loop from 1 to 20 (inclusive). Divisibility is expressed with the **modulus operator** `%`: `n % k == 0` means “`n` is divisible by `k`”.

Replace `src/main.lum` with:

```lumina
fn fizzbuzz(n: i64) -> unit {
    if n % 15 == 0 then println("FizzBuzz")
    else if n % 3 == 0 then println("Fizz")
    else if n % 5 == 0 then println("Buzz")
    else println(n);
    return;
}

for i in 1..=20 {
    fizzbuzz(i);
}
```

Run:

```bash
lum run
```

Expected output:

```text
1
2
Fizz
4
Buzz
Fizz
7
8
Fizz
Buzz
11
Fizz
13
14
FizzBuzz
16
17
Fizz
19
Buzz
```

This uses **functions**, **for** loops with an inclusive range (`1..=20`), the **modulus** operator `%`, and **if** / **else if** expressions—all supported by the Part 1 compiler.

---

## 12.5 Complete example: Array of records and filter

This example shows **record types**, **arrays of records** (`Array<User>`), and a **function** that takes and returns an array of records. We define a `User` type with `name`, `age`, and `address`; build an array of users (some under 18, some 18+); and call `filter_adults(users)`, which returns a new array of users whose `age` is greater than 18. The loop uses **`ArrayLen(arr)`** from the stdlib to iterate by index. This program **runs** with the Part 1 compiler.

Replace `src/main.lum` with:

```lumina
type User = { name: str, age: i64, address: str };

fn filter_adults(users: Array<User>) -> Array<User> {
    let result: Array<User> = [];
    for i in 0..ArrayLen(users) {
        let u = get(users, i);
        if u.age > 18 then append(result, u) else unit;
    }
    return result;
}

let users: Array<User> = [
    { name: "Alice", age: 16, address: "1 Main St" },
    { name: "Bob", age: 22, address: "2 Oak Ave" },
    { name: "Carol", age: 14, address: "3 Elm Rd" },
    { name: "Dave", age: 25, address: "4 Pine Ln" }
];
let adults = filter_adults(users);
println(ArrayLen(adults));
```

**What this example illustrates:**

- **Arrays of records:** `Array<User>` (or `array<User>`) types an array whose elements are `User`. The Part 1 compiler supports `Array<i64>`, `Array<str>`, and **`Array<Record>`** (records stored as pointers; see Chapter 8). Functions can take and return array-of-record types.
- **Empty array with type:** `let result: Array<User> = [];` declares an empty array; the type annotation is required so the compiler knows the element type.
- **Array length:** **`ArrayLen(arr)`** is a stdlib function that returns the length as `i64`. Use it in a **for** loop: `for i in 0..ArrayLen(arr) { ... }` to iterate by index.
- **Filter function:** `filter_adults(users: Array<User>) -> Array<User>` takes an array of users and returns a new array with `age > 18`. In Lumina, **if**/**then**/**else** requires both branches to have the same type; when the then branch is a side effect (e.g. `append(result, u)`), use **`else unit`** so the else branch type matches.

Run from the project root: `lum run`. Expected output: `2` (two adults: Bob and Dave).

---

## 12.6 Verification (try the examples)

You can verify that the CLI and examples work by running the following from a shell (with `lum` on your PATH, e.g. after `cargo build --release` in `source/part1-recursive-descent/09-lum-cli`):

| Step | Action | Expected output |
|------|--------|-----------------|
| 1 | `lum init my-project && cd my-project` | Project created; directory contains `lum.toml` and `src/main.lum`. |
| 2 | Put `println("Hello, World!");` in `src/main.lum`, run `lum run` | `Hello, World!` |
| 3 | Replace `src/main.lum` with the **FizzBuzz** program from section 12.4, run `lum run` | Lines: `1`, `2`, `Fizz`, `4`, `Buzz`, … `FizzBuzz`, … `19`, `Buzz`. |
| 4 | Replace `src/main.lum` with the **array-of-records** program from section 12.5, run `lum run` | `2` |

If any step fails, check that you are in the project root (directory containing `lum.toml`) and that `lum` was built with the same Part 1 source (09-lum-cli and its dependencies).

### Alternative: ArrayLen with integers or strings

The same pattern works for `Array<i64>` and `Array<str>`. Example:

```lumina
let arr: Array<i64> = [10, 20, 30, 40];
for i in 0..ArrayLen(arr) {
    println(get(arr, i));
}
```

Output:

```text
10
20
30
40
```

Here `Array<i64>` is the type of an array of integers; `ArrayLen(arr)` returns `4`; and `get(arr, i)` returns the element at index `i`. The same pattern works for `Array<str>` (array of strings).

---

## 12.7 lum init (implementation walkthrough)

**init_project** creates the minimal project layout and default files:

```rust
pub fn init_project(dir: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(dir.join("src"))?;
    std::fs::write(dir.join("lum.toml"), "[project]\nname = \"my-lumina\"\nversion = \"0.1.0\"\n")?;
    std::fs::write(dir.join("src/main.lum"), "42\n")?;
    println!("Created Lumina project in {:?}", dir);
    Ok(())
}
```

- **create_dir_all(dir.join("src"))** – Ensures `src/` exists.
- **write(lum.toml)** – Writes project metadata (name, version).
- **write(src/main.lum)** – Puts a default program (e.g. `42`) so the user can run immediately. The compiler will wrap top-level expressions in an implicit main that calls println or uses the value as the entry return.

---

## 12.8 lum build (implementation walkthrough)

The build process: read `src/main.lum`, parse, type-check, generate LLVM IR, produce an object file, compile the tiny runtime wrapper, then link an executable.

**Object file for `main.o`:** On **macOS**, the CLI compiles `.lum/main.ll` with `clang -c -target <triple>` so the emitted Mach-O has the correct platform load command and the system linker doesn’t warn. On other platforms it uses LLVM’s in-process `write_object_file`. See the [source repo](https://github.com/akkeshavan/llvm-blog-source) for the full implementation (e.g. `ir_to_object_macos` and the `cfg!(target_os = "macos")` branch in `build_project`).

Simplified outline:

```rust
// After writing artifacts_dir.join("main.ll") with the IR:
let obj_path = artifacts_dir.join("main.o");
let triple = host_triple();
if cfg!(target_os = "macos") {
    // clang -c -target <triple> main.ll -o main.o (correct Mach-O metadata)
    ir_to_object_macos(&ir_path, &obj_path, triple)?;
} else {
    write_object_file(&typed, triple, &obj_path)
        .map_err(|e| format!("object emission failed: {e}"))?;
}
// Then: write runtime.c, compile with clang -c, link main.o + runtime.o → main
```

**How build works end-to-end:** (1) Read `src/main.lum` into a string. (2) **parse(source)** → Program. (3) **typecheck(program)** (or TypeChecker::check_program) → TypedProgram. (4) **compile_program(&typed)** → IR string; write to `.lum/main.ll`. (5) Get **host_triple()**; call **write_object_file(&typed, triple, .lum/main.o)** (or on macOS run clang on main.ll to produce main.o with correct Mach-O metadata). (6) Write **RUNTIME_C** to `.lum/runtime.c`; run clang to compile runtime.c → runtime.o. (7) Link main.o and runtime.o → `.lum/main`. The rest of the pipeline (runtime C, compile, link) is unchanged.

---

## 12.9 lum run (implementation walkthrough)

```rust
pub fn run_project(project_dir: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let exe = build_project(project_dir)?;
    let output = Command::new(&exe).output()?;
    if !output.status.success() {
        return Err(format!("program exited with: {}", output.status).into());
    }
    print!("{}", String::from_utf8_lossy(&output.stdout));
    Ok(())
}
```

**How run works:** **run_project** calls **build_project** to ensure the executable is up to date, then runs the binary with **Command::new(&exe).output()**, checks the exit status, and prints stdout. So **lum run** is “build if needed, then execute.”

---

## 12.10 CLI Structure with clap

```rust
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "lum")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Init {
        #[arg(default_value = ".")]
        dir: PathBuf,
    },
    Build,
    Run,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Init { dir } => lumina_part1_lum_cli::init_project(&dir)?,
        Commands::Build => {
            let _exe = lumina_part1_lum_cli::build_project(&PathBuf::from("."))?;
        }
        Commands::Run => lumina_part1_lum_cli::run_project(&PathBuf::from("."))?,
    }
    Ok(())
}
```

---

## 12.11 Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_creates_project() {
        let dir = tempfile::tempdir().unwrap();
        init_project(&dir.path().to_path_buf()).unwrap();
        assert!(dir.path().join("src/main.lum").exists());
        assert!(dir.path().join("lum.toml").exists());
    }

    #[test]
    fn build_produces_ir() {
        let dir = tempfile::tempdir().unwrap();
        init_project(&dir.path().to_path_buf()).unwrap();
        assert!(build_project(&dir.path().to_path_buf()).is_ok());
    }
}
```

Run `cargo test` in `source/part1-recursive-descent/09-lum-cli` (requires LLVM for `build_produces_ir`). Part 1 has **no workspace root**: run `cargo test` (or `cargo build`) **in each crate** (e.g. 01-lexer, 02-parser, 03-typecheck, 04-codegen, 09-lum-cli) when testing the full pipeline.

---

## 12.12 Summary

The Lum CLI provides `lum init`, `lum build`, and `lum run`. It orchestrates the full pipeline and produces a runnable executable under `.lum/`. Part 1 is complete.

**Next:** **Chapter 13 — Part 2: Installation** (grammar-driven setup in `source/part2-pest/00-install`).
