# Chapter 2: Rust for Database Development

Writing a database is one of the hardest things you can do in software. You are managing raw memory, binary file formats, concurrent access, and subtle correctness invariants — all at the same time. The language you choose matters enormously.

This chapter explains why Rust is an excellent fit for this problem, sets up the project, and gives you a mental map of the architecture we are about to build.

> **Prerequisite note:** You do not need to be a Rust expert, but basic familiarity with the syntax will help. If Rust is new to you, skim the first four chapters of [The Rust Book](https://doc.rust-lang.org/book/) before continuing — it is free online and takes about two hours.

---

## Why Rust?

Database engines have traditionally been written in C (SQLite, the PostgreSQL core) or C++ (RocksDB, InnoDB). Both give you precise control over memory layout and zero-overhead abstractions. Both also let you shoot yourself in the foot in spectacular ways: use-after-free bugs, data races, buffer overflows.

Rust offers the same performance characteristics as C/C++ but with a fundamentally different safety model enforced at compile time.

### Ownership eliminates whole classes of bugs

In C you might write:

```c
char *buf = malloc(PAGE_SIZE);
free(buf);
memcpy(buf, src, PAGE_SIZE); // use after free — undefined behaviour
```

The Rust ownership system makes this a compile-time error. When `buf` is freed (dropped), the compiler guarantees you cannot use it again. No runtime cost, no garbage collector — just a type system clever enough to track resource lifetimes.

For a buffer pool, this matters deeply. You need to hand out mutable references to page data, ensure those references are not held after the page is evicted, and guarantee that only one caller writes to a frame at a time. Rust's borrow checker enforces all of this.

### Fearless concurrency

Rust's type system distinguishes between data that is safe to share (`Sync`) and data that is safe to send between threads (`Send`). A bug that would be a data race in C — two threads writing to the same buffer without synchronisation — is a compile-time error in Rust.

We will not implement concurrency in this tutorial, but building on a Rust foundation means you could add it without rewriting the codebase from scratch.

### Zero-cost abstractions

Rust's iterators, closures, and trait objects compile to the same machine code you would write by hand. The `Vec<u8>` returned by `Value::serialize()` is no slower than a manually managed array. The ergonomics of high-level code come at no runtime price.

### No garbage collector

A GC introduces unpredictable pause times — exactly what you cannot afford in a database that promises sub-millisecond query latency. Rust manages memory deterministically through its ownership rules.

---

## Theory: the architecture we are building

Before touching the keyboard, internalise this layered diagram. Every chapter corresponds to one or two layers:

```
┌─────────────────────────────────────────────┐
│                    REPL                      │  Chapter 11
│  (read-eval-print loop, user interface)      │
├─────────────────────────────────────────────┤
│                  Executor                    │  Chapter 9
│  (interprets AST, drives operators)          │
├─────────────────────────────────────────────┤
│              SQL Parser / AST                │  Chapter 8
│  (lexer → tokens → AST nodes)               │
├──────────────────┬──────────────────────────┤
│  B-Tree Index    │  System Catalog + Heap    │  Chapters 7, 6
│  (key → RowId)   │  (metadata, row storage)  │
├──────────────────┴──────────────────────────┤
│        Rows, Types, Serialisation            │  Chapter 5
│  (Value enum, Row struct, binary encoding)  │
├─────────────────────────────────────────────┤
│               Buffer Pool                    │  Chapter 4
│  (LRU cache of frames, pin/unpin protocol)  │
├─────────────────────────────────────────────┤
│             Disk Manager / Pages             │  Chapter 3
│  (raw file I/O, fixed-size page abstraction)│
└─────────────────────────────────────────────┘
                    disk
```

Chapter 6 covers both the slotted-page heap format and the system catalog in one pass; Chapter 7 adds the B-Tree index on top of that foundation.

The **Write-Ahead Log** (Chapter 10) cuts across multiple layers — it intercepts writes at the executor level and flushes to a separate log file before any data page is modified.

---

## Setting up the project

### Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Verify:

```bash
rustc --version   # latest stable (1.7x or later)
cargo --version
```

RustDB uses `partition_point`, `split_off`, and `BufWriter` — all stable since Rust 1.56. Any current stable toolchain will work.

### Clone the companion repository

```bash
git clone https://github.com/akkeshavan/db-tutorial-source
cd db-tutorial-source/source
```

### Chapter source snapshots

Each chapter from 3 onward has a self-contained snapshot under `source/chapter-NN/`. You can work from the snapshot that matches the chapter you are on, or from the main `source/` folder which has the complete implementation. Run `cargo test` from whichever directory you choose:

```bash
cd source/chapter-03   # just page.rs + disk_manager.rs
cargo build && cargo test

cd source              # full final implementation
cargo build && cargo test
```

### Project layout

```
source/
├── Cargo.toml          # package manifest
└── src/
    ├── main.rs         # entry point → repl::run()
    ├── page.rs         # Page struct, PAGE_SIZE constant
    ├── disk_manager.rs # raw file I/O
    ├── buffer_pool.rs  # LRU buffer pool
    ├── types.rs        # Value enum, DataType enum
    ├── schema.rs       # Column, Schema
    ├── row.rs          # Row struct, serialisation
    ├── heap.rs         # slotted-page heap storage
    ├── catalog.rs      # TableMeta, Catalog
    ├── btree.rs        # in-memory B-Tree index
    ├── executor.rs     # statement execution, ResultSet
    ├── wal.rs          # WalRecord, WalWriter, TransactionManager
    ├── repl.rs         # interactive REPL
    └── sql/
        ├── mod.rs      # re-exports Parser
        ├── lexer.rs    # Lexer, Token enum
        ├── ast.rs      # Statement, Condition, ColumnDef, CompOp
        └── parser.rs   # recursive-descent Parser
```

### Build and run

```bash
cargo build             # compile (debug mode)
cargo run               # start the REPL
cargo build --release   # optimised build
```

The first build downloads nothing — RustDB has zero external dependencies. Everything is built from the standard library.

> **About the `dead_code` warnings:** `cargo build` will print several warnings like `warning: method 'search' is never used`. These are intentional. Tutorial code defines helper functions (such as `btree.search()` and `row::deserialize()`) that are explained in each chapter but not all called from the REPL's main execution path. They will be exercised in the `#[cfg(test)]` blocks and in later chapters. You can safely ignore these warnings while working through the tutorial.

### Run the tests

There are no dedicated test files in the initial scaffold; tests are added at the end of each module in `#[cfg(test)]` blocks as the codebase grows. Run them with:

```bash
cargo test
```

---

## Code walkthrough: `main.rs`

The entry point is deliberately minimal:

```rust
// source/src/main.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-16

mod btree;
mod buffer_pool;
mod catalog;
mod disk_manager;
mod executor;
mod heap;
mod page;
mod repl;
mod row;
mod schema;
mod sql;
mod types;
mod wal;

fn main() {
    repl::run();
}
```

Each `mod` declaration tells the compiler to compile and link the corresponding file. The only thing `main` does is delegate to the REPL, which in turn owns the `Executor`, which owns the `BufferPool` and `Catalog`.

---

## Key Rust patterns used throughout RustDB

### `Result<T, E>` for error handling

RustDB uses `std::io::Result<T>` (which is `Result<T, std::io::Error>`) for any operation that touches the disk, and `Result<T, String>` for parsing and validation errors. The `?` operator propagates errors up the call stack without boilerplate.

```rust
pub fn read_page(&mut self, page_id: u32, page: &mut Page) -> io::Result<()> {
    let offset = page_id as u64 * PAGE_SIZE as u64;
    self.file.seek(SeekFrom::Start(offset))?;  // ? propagates io::Error
    self.file.read_exact(page.data.as_mut())?;
    Ok(())
}
```

### Enums as tagged unions

Rust enums are algebraic data types. `Value` is a perfect example — it is exactly one variant at runtime, and `match` exhaustively handles every case:

```rust
pub enum Value {
    Int(i64),
    Float(f64),
    Text(String),
    Bool(bool),
    Null,
}
```

This is how we represent SQL's type system without null pointer tricks or runtime type tags stored in a separate field.

### Ownership and the borrow checker

The buffer pool's API is shaped by the borrow checker. We cannot return a `&mut Page` from `fetch_page` because that would keep the borrow of `self` alive for the duration the caller holds the reference — making it impossible to call `unpin` afterward. Instead, `fetch_page` returns a frame *index* (a plain `usize`) and the caller uses `bp.page_mut(fi)` to get the mutable reference:

```rust
let fi = bp.fetch_page(page_id)?;
let data = bp.page_mut(fi).data.as_mut();
// ... modify data ...
bp.unpin(page_id, true);
```

This pattern threads the needle between safety and usability.

---

## What to do now

1. Clone the repository and run `cargo build`. It should compile cleanly (see the note on `dead_code` warnings above).
2. Run `cargo run` to start the REPL. Try `.help` and `.tables`.
3. Skim the file listing above. You do not need to read the code yet — just get familiar with the names.

---

**← Previous:** [Chapter 1 — Relational Databases](01-relational-databases.md) | **Next:** [Chapter 3 — Storing Data: Pages and the Disk Manager](03-pages-and-disk.md)
