# Building a Relational Database from Scratch

A hands-on tutorial that takes you from the theoretical foundations of the relational model all the way to a working SQL database engine, written in Rust.

---

## What you will build

By the end of this tutorial you will have a fully functional (though intentionally simple) relational database called **RustDB** that:

- stores data on disk in a paged binary format
- manages an in-memory buffer pool with LRU eviction
- serialises typed rows (INT, FLOAT, TEXT, BOOL)
- maintains a B-Tree index for fast key lookups
- parses a meaningful subset of SQL (CREATE TABLE, INSERT, SELECT with WHERE)
- enforces basic ACID properties with a Write-Ahead Log
- exposes an interactive REPL

All source code lives in the companion repository at
**[github.com/akkeshavan/db-tutorial-source](https://github.com/akkeshavan/db-tutorial-source)**.

---

## Prerequisites

- Basic familiarity with any programming language
- Rust installed (`rustup` — see Chapter 2)
- Comfort with the command line

---

## Part I — Building RustDB

| # | Title | Estimated time |
|---|-------|----------------|
| 1 | [Relational Databases](01-relational-databases.md) | 60 min |
| 2 | [Rust for Database Development](02-rust-setup.md) | 60 min |
| 3 | [Storing Data: Pages and the Disk Manager](03-pages-and-disk.md) | 75 min |
| 4 | [The Buffer Pool](04-buffer-pool.md) | 75 min |
| 5 | [Rows, Types, and Serialisation](05-rows-and-types.md) | 60 min |
| 6 | [Tables and the System Catalog](06-catalog.md) | 60 min |
| 7 | [B-Tree Indexes](07-btree.md) | 90 min |
| 8 | [Parsing SQL](08-sql-parser.md) | 90 min |
| 9 | [Query Execution](09-executor.md) | 75 min |
| 10 | [Transactions and the Write-Ahead Log](10-wal.md) | 75 min |
| 11 | [Putting It All Together: A Working REPL](11-repl.md) | 60 min |

## Part II — Extending RustDB

| # | Title | Estimated time |
|---|-------|----------------|
| 12 | [UPDATE and DELETE](12-update-delete.md) | 75 min |
| 13 | [DDL: DROP TABLE and ALTER TABLE](13-ddl.md) | 60 min |
| 14 | [Crash Recovery](14-recovery.md) | 90 min |
| 15 | [Multi-table JOINs](15-joins.md) | 90 min |
| 16 | [Concurrent Access](16-concurrency.md) | 90 min |
| 17 | [Improvements](17-improvements.md) | open-ended |

---

## How each chapter is structured

Every chapter follows the same pattern:

1. **Opening context** — the problem we are solving and why it matters
2. **Theory** — the computer-science concepts behind the solution
3. **Code walkthrough** — a guided tour of the implementation

Code listings always point back to the companion repository rather than being reproduced in full, so you can clone, run, and experiment without copying.
