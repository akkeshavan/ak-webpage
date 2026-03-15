# Chapter 11: Putting It All Together — A Working REPL

Every chapter has added one layer to the stack. This final chapter wires everything together into a program you can run, type SQL into, and get results from. It also steps back to see the full data flow from first keystroke to last byte written to disk.

---

## The complete system

Here is how a query flows through every layer we built:

```
User types: SELECT name FROM users WHERE id > 2

repl.rs         reads the line, detects trailing ';'
    │
    ▼
sql/lexer.rs    tokenises: [SELECT][Ident("name")][FROM][Ident("users")]
                           [WHERE][Ident("id")][Gt][IntLit(2)][Eof]
    │
    ▼
sql/parser.rs   builds AST:
                Statement::Select {
                    columns: ["name"],
                    table: "users",
                    condition: Some(Comparison { column: "id", op: Gt, value: Int(2) })
                }
    │
    ▼
executor.rs     1. catalog.get("users") → schema=(id INT, name TEXT), heap_root=0
                2. TableHeap::open(0).scan(&schema, &mut bp) → all rows
                3. filter: eval_condition for each row
                4. project: keep only "name" column
                5. return ResultSet::Rows
    │
    ▼
buffer_pool.rs  serves pages from cache; reads from disk on miss;
                evicts LRU unpinned frames when full
    │
    ▼
disk_manager.rs reads/writes 4096-byte pages at byte offset (page_id × 4096)
    │
    ▼
rustdb.db       the binary file on disk
```

---

## The REPL architecture

```rust
// source/src/repl.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-11

pub fn run() {
    let mut exec = match Executor::new(DB_FILE) {
        Ok(e) => e,
        Err(e) => { eprintln!("failed to open database: {}", e); return; }
    };

    let stdin = io::stdin();
    let mut input_buf = String::new(); // accumulates multi-line input

    loop {
        // Show continuation prompt "...> " when a statement is mid-input.
        if input_buf.is_empty() { print!("{}", PROMPT); }
        else { print!("...> "); }
        io::stdout().flush().unwrap();

        let mut line = String::new();
        match stdin.lock().read_line(&mut line) {
            Ok(0) => break,  // EOF (Ctrl-D)
            Ok(_) => {}
            Err(e) => { eprintln!("read error: {}", e); break; }
        }

        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }

        if trimmed.starts_with('.') {
            handle_meta(trimmed, &mut exec);
            continue;
        }

        input_buf.push(' ');
        input_buf.push_str(trimmed);

        // Execute once a trailing semicolon is seen.
        if input_buf.trim_end().ends_with(';') {
            let sql = input_buf.trim().to_string();
            input_buf.clear();
            execute_sql(&sql, &mut exec);
        }
    }

    println!("Bye.");
    if let Err(e) = exec.flush() { eprintln!("warning: flush failed: {}", e); }
}
```

### Multi-line input

SQL statements can span multiple lines. The REPL accumulates input in `input_buf` and only executes when it sees a `;`:

```rust
input_buf.push_str(trimmed);
if input_buf.trim_end().ends_with(';') {
    execute_sql(input_buf.trim(), &mut exec);
    input_buf.clear();
} else {
    print!("...> "); // continuation prompt
}
```

### Meta-commands

Lines starting with `.` are meta-commands — they are processed before the SQL pipeline:

```
.help     — show available commands
.tables   — list all tables in the catalog
.quit     — flush dirty pages and exit
```

Meta-commands are a convention borrowed from SQLite's CLI.

### Graceful shutdown

When the user types `.quit` or sends EOF (Ctrl-D), the REPL calls `exec.flush()` before exiting:

```rust
fn handle_meta(cmd: &str, exec: &mut Executor) {
    match cmd {
        ".quit" | ".exit" => {
            if let Err(e) = exec.flush() {
                eprintln!("warning: flush failed: {}", e);
            }
            std::process::exit(0);
        }
        // ...
    }
}
```

Without this, dirty pages cached in the buffer pool would be lost. In the current prototype the catalog is also in-memory only, so table definitions are not persisted across restarts — see the "What next?" section for how to fix this.

---

## A complete session

```
$ cargo run

RustDB v0.1  —  type .help for commands
Database file: rustdb.db

rustdb> CREATE TABLE users (id INT, name TEXT, age INT);
table 'users' created

rustdb> INSERT INTO users VALUES (1, 'alice', 30);
1 row inserted

rustdb> INSERT INTO users VALUES (2, 'bob', 25);
1 row inserted

rustdb> INSERT INTO users VALUES (3, 'carol', 35);
1 row inserted

rustdb> SELECT * FROM users;
id | name | age
---------------
1 | 'alice' | 30
2 | 'bob' | 25
3 | 'carol' | 35
(3 rows)

rustdb> SELECT name FROM users WHERE age > 28;
name
----
'alice'
'carol'
(2 rows)

rustdb> CREATE INDEX ON users (id);
index created on 'users.id' (3 entries)

rustdb> .tables
  users

rustdb> .quit
Bye.
```

---

## What the numbers look like on disk

After the session above, `rustdb.db` contains at least two pages:

- **Page 0**: the first (and only) heap page for `users`. Its slotted-page area holds the three serialised rows.
- Possibly **page 1** if the first page filled up (it won't for three short rows).

You can inspect the raw bytes:

```bash
xxd rustdb.db | head -20
```

The first four bytes of the page data area are the `next_page_id` (0xFF 0xFF 0xFF 0xFF = no next page). Bytes 4–5 are `num_slots` (03 00 in little-endian = 3). Bytes 6–7 are `free_ptr` — the boundary between free space and written data: it starts at 4096 (page end) and decrements with each inserted row.

---

## Architecture retrospective

| Layer | File | Role |
|-------|------|------|
| REPL | `repl.rs` | User I/O, multi-line buffering |
| Executor | `executor.rs` | Statement dispatch, scan-filter-project |
| SQL Parser | `sql/` | String → AST |
| B-Tree | `btree.rs` | O(log n) key lookup |
| Catalog | `catalog.rs` | Table metadata registry |
| Heap | `heap.rs` | Slotted-page row storage |
| Row / Types | `row.rs`, `types.rs`, `schema.rs` | Typed data, serialisation |
| Buffer Pool | `buffer_pool.rs` | LRU page cache |
| Disk Manager | `disk_manager.rs` | Raw file I/O |
| Page | `page.rs` | 4096-byte block |
| WAL | `wal.rs` | Append-only durability log |

Each layer knows only about the layers immediately below it. This clean dependency order is what makes it possible to test each component in isolation.

---

## What comes next

RustDB is a working foundation. Here are the natural next steps, roughly in order of difficulty:

### Persist the catalog across restarts
Serialise `Catalog` to a special "catalog page" (e.g., page 0 of the database file) on shutdown, and deserialise it on startup. Alternatively, store the catalog as special system tables in the same heap format.

### Persist the B-Tree to disk
Replace `Box<Node>` pointers with `page_id: u32` and serialise each node into a 4096-byte page. The `BufferPool` API is already designed for this.

### Implement WAL recovery
Add a `recover()` function that reads the WAL file and replays committed transactions on startup. The log format is already correct.

### Add UPDATE and DELETE
UPDATE requires reading a row, modifying it, and writing it back to the same slot (or a new slot if it grew). DELETE sets `slot.length = 0` (tombstone) and requires a VACUUM pass to reclaim space. Both need WAL records for undo.

### Implement a query planner
Add cost estimates to `TableMeta`: row count, average row size, column cardinality. Use these to decide when to use the B-Tree index vs. a sequential scan.

### Add JOIN support
A nested loop join evaluates every (outer, inner) row pair and keeps matching ones. A hash join builds a hash table on the inner relation. Implementing one or both is a significant but tractable extension.

### Add concurrent access
Introduce a lock manager (S/X locks per row or per page) and MVCC (version chains for each row). The WAL infrastructure already supports per-transaction records.

---

## Key takeaways

- The REPL is thin on purpose. Its only job is I/O and dispatching — all logic lives in the layer below it.
- The layered architecture pays off at the end: each component was tested independently, and wiring them together was straightforward.
- A working database in ~1000 lines of Rust demonstrates that the core concepts — pages, buffer pool, types, heap, index, parser, executor, WAL — are individually simple. The complexity of production databases comes from handling every edge case, every workload pattern, and every hardware failure mode.

---

## Congratulations

You have built a relational database from scratch. You now understand:

- Why databases use fixed-size pages and what a slotted page looks like
- How a buffer pool's LRU policy keeps hot data in RAM
- How typed values are serialised and deserialised without runtime overhead
- How a B-Tree provides O(log n) key lookup
- How a recursive-descent parser turns SQL text into an AST
- How the Volcano execution model composes scan, filter, and project
- How a Write-Ahead Log makes writes atomic and durable

The same ideas — scaled up enormously in complexity, performance, and correctness — underpin every database you have ever used.

---

**← Previous:** [Chapter 10 — Transactions and the Write-Ahead Log](10-wal.md) | **Next:** [Chapter 12 — UPDATE and DELETE](12-update-delete.md) | [Table of Contents](00-introduction.md)
