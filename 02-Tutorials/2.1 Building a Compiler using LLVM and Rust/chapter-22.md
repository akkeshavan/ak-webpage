# Building a Compiler with Rust and LLVM - 22

*Part 2: Targets and the Lum CLI*

---

This chapter covers **multi-target** code generation and the **Lum CLI** for Part 2: the same commands as in Part 1 (`lum init`, `lum build`, `lum run`) but with the **Pest** front-end (lexer + parser) instead of the hand-written one. We reuse Part 1’s target triple logic and object emission; only the step that turns source into a typed program changes.

This chapter mirrors **Chapters 11 and 12**: target triples, emitting object files, and the full CLI with the same examples (Hello World, FizzBuzz, array of records and filter). Code lives in `source/part2-pest/08-targets` (if separate) and `source/part2-pest/09-lum-cli`.

---

## Goals of this chapter

- Provide the **same CLI commands** as Part 1: **lum init**, **lum build**, **lum run**, using the **Pest** front-end (parse → convert → typecheck → Part 1 codegen → object → runtime → link).
- Reuse Part 1’s **host_triple()** and **write_object_file** for target and object emission.
- Show the **same runnable examples** (Hello World, FizzBuzz, array of records) so users get identical behaviour with the grammar-driven front-end.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **08-targets** (optional) | Re-exports or wraps Part 1’s **host_triple**; or CLI depends on Part 1 targets directly. |
| **09-lum-cli** | Binary **lum**; subcommands init, build, run. **init_project** – create lum.toml, src/main.lum. **build_project** – read main.lum, typecheck (Part 2), codegen (Part 1), write IR, emit main.o, write runtime.c, compile, link. **run_project** – build then execute. |
| **Dependencies** | Part 2 parser, typecheck, codegen; Part 1 runtime, codegen, targets; clap, tempfile. |

---

## Dependencies (Cargo.toml) for this chapter

See **22.2** for the full **09-lum-cli** Cargo.toml and what each dependency does. Summary: **clap** (CLI), **tempfile** (tests), **lumina-part2-*** (parser, typecheck, codegen), **lumina-part1-** (runtime, codegen, targets).

---

## 22.1 Target triples (same as Chapter 11)

A **target triple** describes the target platform (e.g. `x86_64-apple-darwin`, `aarch64-apple-darwin`, `x86_64-unknown-linux-gnu`). Part 2 uses Part 1’s **host_triple()** (or equivalent) to choose the default target. The code generator and object emission are Part 1’s; we only need to pass the triple when calling `write_object_file`.

**Cargo.toml for 08-targets (optional):**

```toml
[package]
name = "lumina-part2-targets"
version = "0.1.0"
edition = "2021"

[dependencies]
lumina-part1-targets = { path = "../../part1-recursive-descent/08-targets" }
```

We can re-export `host_triple()` and any target-selection helpers from Part 1 so the Part 2 CLI depends on either Part 1’s targets crate or Part 2’s thin wrapper.

---

## 22.2 Lum CLI – Cargo.toml and dependencies

`source/part2-pest/09-lum-cli/Cargo.toml`:

```toml
[package]
name = "lumina-part2-lum-cli"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "lum"
path = "src/main.rs"

[dependencies]
clap = { version = "4", features = ["derive"] }
tempfile = "3"
lumina-part2-parser = { path = "../02-parser" }
lumina-part2-typecheck = { path = "../03-typecheck" }
lumina-part2-codegen = { path = "../04-codegen" }
lumina-part1-runtime = { path = "../../part1-recursive-descent/05-runtime-stdlib" }
lumina-part1-codegen = { path = "../../part1-recursive-descent/04-codegen" }
lumina-part1-targets = { path = "../../part1-recursive-descent/08-targets" }
```

**What each dependency does:**

- **clap:** Parses command-line arguments (`lum init`, `lum build`, `lum run`).
- **tempfile:** For tests that create temporary project directories.
- **lumina-part2-parser:** Parses `src/main.lum` with the Pest grammar (or we call typecheck which uses it).
- **lumina-part2-typecheck:** `typecheck(source)` → TypedProgram (parse + convert + Part 1 typecheck).
- **lumina-part2-codegen:** `compile(source)` or `compile_to_entry(source)` → IR string; may also need Part 1 codegen for `write_object_file`.
- **lumina-part1-runtime:** Runtime C source; the CLI writes it to `.lum/runtime.c` and compiles it.
- **lumina-part1-codegen:** For `write_object_file(typed, triple, path)` to emit `.lum/main.o`.
- **lumina-part1-targets:** For `host_triple()` so we know which triple to pass to object emission and (on macOS) to `clang`.

---

## 22.3 Commands (same as Chapter 12)

| Command | Description |
|---------|-------------|
| `lum init [dir]` | Create a new Lumina project (default: current directory). |
| `lum build` | Compile the project: parse → typecheck → codegen → object file → link with runtime → executable. |
| `lum run` | Build (if needed) and run the executable. |

Run `lum build` and `lum run` from the **project root** (directory containing `lum.toml` and `src/`).

---

## 22.4 Project structure (same as Chapter 12)

After `lum init`:

```
my-project/
├── lum.toml
├── src/
│   └── main.lum
└── .lum/          # build artifacts (gitignored)
```

---

## 22.5 Build implementation (implementation walkthrough)

**1. Read source:**

```rust
fn read_main_lum(project_dir: &Path) -> Result<String, Box<dyn std::error::Error>> {
    let path = project_dir.join("src/main.lum");
    std::fs::read_to_string(&path).map_err(|e| e.into())
}
```

**2. Parse, typecheck, codegen (Part 2 front-end):**

```rust
use lumina_part2_typecheck::typecheck;
use lumina_part1_codegen::{compile_program, write_object_file};
use lumina_part1_targets::host_triple;

fn build_project(project_dir: &Path) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let source = read_main_lum(project_dir)?;
    let typed = typecheck(&source).map_err(|e| e.to_string())?;  // Pest parse + convert + typecheck
    let ir = compile_program(&typed).map_err(|e| e.to_string())?;

    let lum_dir = project_dir.join(".lum");
    std::fs::create_dir_all(&lum_dir)?;
    let ir_path = lum_dir.join("main.ll");
    std::fs::write(&ir_path, &ir)?;

    let triple = host_triple();
    let obj_path = lum_dir.join("main.o");
    write_object_file(&typed, triple, &obj_path).map_err(|e| e.to_string())?;

    // Write runtime C, compile runtime.o, link main.o + runtime.o → main
    let runtime_src = lumina_part1_runtime::RUNTIME_C;
    let runtime_c = lum_dir.join("runtime.c");
    std::fs::write(&runtime_c, runtime_src)?;
    // run: clang -c runtime.c -o runtime.o; clang main.o runtime.o -o main
    compile_runtime_and_link(project_dir, &lum_dir, &obj_path)?;

    Ok(lum_dir.join("main"))
}
```

**How this achieves the goal:** The only “Part 2” step is **typecheck(&source)**. That internally uses the Part 2 parser (Pest), converts to Part 1 AST, and runs Part 1’s type checker. Everything else (IR, object file, runtime, link) is Part 1. On macOS you may need to compile `main.ll` with `clang -c -target <triple>` to get correct Mach-O metadata (same as Part 1 CLI).

---

## 22.6 Same examples as Chapters 3–12

**Hello World (Section 12.3):**

```lumina
println("Hello, World!");
```

**FizzBuzz (Section 12.4):**

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

**Array of records and filter (Section 12.5):**

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

Expected output: `2`. These programs are parsed by the **Pest** grammar (Chapter 16), typechecked by Part 1’s type checker (Chapter 17), and compiled by Part 1’s codegen (Chapter 18); the result runs with the same runtime as Part 1. To verify, use the same steps as **Chapter 12, Section 12.6 (Verification)**: create a project with `lum init`, then run each example in `src/main.lum` with `lum run` and check the expected output (Hello World, FizzBuzz, then `2` for the array-of-records example).

---

## 22.7 Tests

```rust
#[test]
fn init_creates_project() {
    let dir = tempfile::tempdir().unwrap();
    init_project(&dir.path().to_path_buf()).unwrap();
    assert!(dir.path().join("src/main.lum").exists());
    assert!(dir.path().join("lum.toml").exists());
}

#[test]
fn build_produces_executable() {
    let dir = tempfile::tempdir().unwrap();
    init_project(&dir.path().to_path_buf()).unwrap();
    std::fs::write(dir.path().join("src/main.lum"), "42").unwrap();
    let result = build_project(&dir.path().to_path_buf());
    assert!(result.is_ok());
    assert!(result.unwrap().exists());
}
```

Run:

```bash
cd source/part2-pest/09-lum-cli
cargo test
cargo run -- init /tmp/test-lum
cargo run -- run --manifest-path /tmp/test-lum
```

---

## 22.8 Summary

| Item | Purpose |
|------|--------|
| **Targets** | Reuse Part 1’s host_triple and object emission |
| **CLI Cargo.toml** | Part 2 parser/typecheck/codegen, Part 1 runtime/codegen/targets |
| **lum init** | Create lum.toml and src/main.lum |
| **lum build** | Parse (Pest) → typecheck → codegen → object → runtime → link |
| **lum run** | Build then execute .lum/main |
| **Examples** | Same as Chapters 3–12: Hello World, FizzBuzz, array of records |

Part 2’s Lum CLI is the same as Part 1’s except for the front-end: **Pest** lexer and parser produce the AST that, after conversion, feeds the same type checker and code generator. Users get the same language and the same behaviour with a grammar-driven implementation.

**Next:** **Chapter 23 — Part 3: Advanced Topics, Conclusion and Next Steps** (final chapter).
