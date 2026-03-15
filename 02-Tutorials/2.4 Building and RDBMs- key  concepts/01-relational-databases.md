# Chapter 1: Relational Databases

Before we write a single line of Rust, it is worth understanding what problem we are actually solving. Databases are old — older than most of the programming languages you have used, and certainly older than the web. The decisions made by the pioneers of this field in the 1960s and 1970s still shape every table, every JOIN, and every `SELECT *` you write today.

This chapter is intentionally free of code. Its job is to give you a mental model that every subsequent chapter will build on.

---

## A note on scope

This tutorial builds a database called **RustDB**. It is a learning tool, not a production system.

PostgreSQL is roughly 1.4 million lines of code, developed over 30 years by hundreds of contributors. RustDB is roughly 2,000 lines. The gap is not a shortcoming — it is the point. A production database optimises for performance, correctness under adversarial workloads, backwards compatibility, and operational visibility. RustDB optimises for *readability*: every design decision is made to make the underlying concept as clear as possible.

What you will gain from this tutorial is not the ability to ship a database engine. What you will gain is the ability to *read* a database engine. After working through these chapters, concepts like buffer pool eviction, slotted pages, B-Tree splits, WAL protocol, and 2PL will no longer be abstract — you will have implemented each one yourself, made mistakes, fixed them, and seen the tests pass. That understanding transfers directly to working with PostgreSQL internals, reading the SQLite source, or designing storage layers in your own systems.

The goal, in short: **understand how relational databases work from the inside out**.

---

## A brief history

### The pre-relational era (1950s–1960s)

Early computers stored data in flat files — sequences of records written directly to magnetic tape or disk, one after another. To find a record you read the entire file from the beginning. Writing programs that worked with this data meant knowing the exact physical layout: which byte offset held which field, how records were separated, and so on. Business logic and storage logic were hopelessly entangled.

The first step toward structure was the **hierarchical model**, embodied in IBM's IMS (Information Management System, 1966). Data lived in trees: a parent record could have many children, and you navigated the tree by walking pointers. IMS is still running today inside some of the world's largest banks.

The **network model** (the CODASYL standard, 1969) generalised trees to graphs, letting a record have multiple parents. This was more expressive but required programmers to know the exact access paths to their data — change the physical structure, rewrite the programs.

### E.F. Codd and the relational model (1970)

In June 1970 Edgar F. Codd, a researcher at IBM, published a paper called *"A Relational Model of Data for Large Shared Data Banks"*. It is one of the most influential papers in computer science.

Codd's key insight was **data independence**: separate what data means from how it is physically stored. The relational model represented all data as simple **relations** (tables), and provided a small set of algebraic operations for querying them. Programs would describe *what* data they wanted, not *how* to navigate to it.

The model had three pillars:

1. **Structural** — data is organised as a set of relations, each with a fixed set of named, typed attributes (columns). Every row in a relation has exactly one value per column.
2. **Integrity** — rules like primary keys (uniqueness) and foreign keys (referential integrity) are enforced by the database, not by application code.
3. **Manipulative** — a declarative query language (which would eventually become SQL) expresses transformations of relations: select rows, project columns, join relations, union results.

Codd's model was greeted with scepticism at IBM — surely, the performance would be terrible compared to hand-tuned hierarchical access? He was proved spectacularly wrong.

### SQL and the commercial era (1970s–1990s)

IBM built a prototype relational system called **System R** in the mid-1970s, which pioneered query optimisation — the idea that the engine, not the programmer, chooses the best execution plan. System R introduced SQL (then called SEQUEL).

Meanwhile a small startup called **Relational Software, Inc.** shipped the first commercial relational database, Oracle, in 1979 — beating IBM's own commercial product (DB2, 1983) to market.

PostgreSQL traces its lineage to INGRES, another System R contemporary, developed at UC Berkeley by Michael Stonebraker. The **INGRES → Postgres → PostgreSQL** line is one of the longest-running open-source projects in existence.

**MySQL** emerged in 1995 as a fast, permissively licensed alternative. **SQLite** (2000), designed by D. Richard Hipp, took a different approach: no server process, no network protocol — the entire engine is a C library linked directly into the application. SQLite is probably the most widely deployed database in the world, embedded in phones, browsers, and operating systems.

---

## The relational model in detail

### Relations, tuples, and attributes

In formal terms:

- A **relation** is a set of tuples. In practice, it's a table.
- A **tuple** is an ordered list of values. In practice, it's a row.
- An **attribute** is a named, typed component of a tuple. In practice, it's a column.

A key property: a relation is a *set*, which means tuples are unordered and no two tuples are identical. (SQL tables are multisets in practice — they allow duplicate rows unless you add a `UNIQUE` constraint — but the underlying theory assumes sets.)

### Keys

A **superkey** is any set of attributes whose values uniquely identify a tuple within the relation. A **candidate key** is a minimal superkey (no subset of it is also a superkey). A **primary key** is the candidate key the designer chose as the official identifier.

A **foreign key** is an attribute (or set of attributes) in one relation that references the primary key of another. This is the mechanism by which relations are related to each other — hence "relational".

### The relational algebra

Codd identified eight operations on relations (some are derivable from others, but each has a useful named identity). Every SQL query can be expressed using them:

| Operation | SQL equivalent | Description |
|-----------|---------------|-------------|
| σ (select) | `WHERE` | Filter rows by a predicate |
| π (project) | `SELECT col,...` | Keep only specified columns |
| ρ (rename) | `AS` | Rename a relation or attribute |
| ∪ (union) | `UNION` | Combine two compatible relations |
| − (difference) | `EXCEPT` | Rows in first but not second |
| × (product) | `CROSS JOIN` | All pairwise combinations |
| ⋈ (join) | `JOIN` | Product filtered by a condition |
| ÷ (division) | (complex subquery) | Find values related to all of another set |

The query optimiser's job is to take a parse tree built from these operations and find the cheapest evaluation order — the one that minimises disk I/O and CPU time. This is an NP-hard problem in the general case, which is why query planners are so complex.

---

## ACID: the promise every transaction must keep

A database is useful precisely because multiple clients can read and write it concurrently, and because its contents survive power failures. These guarantees are captured by the acronym **ACID**:

### Atomicity

A transaction either commits fully or not at all. If a transfer between bank accounts crashes halfway through — debit done, credit not yet — the database must roll back to the state before the transfer started, as if nothing happened.

Atomicity is typically implemented with a **Write-Ahead Log (WAL)**. Before modifying any data page, the engine writes a log record describing the change. On recovery, uncommitted transactions are rolled back using these records.

### Consistency

A transaction moves the database from one valid state to another. "Valid" is defined by constraints: primary keys, foreign keys, `CHECK` clauses, `NOT NULL`. The database enforces these; application code can rely on them.

### Isolation

Concurrent transactions see a consistent view of the database, as though they ran serially. Without isolation, you get anomalies:

- **Dirty read** — transaction B reads a value written by transaction A before A commits.
- **Non-repeatable read** — transaction B re-reads a row and gets a different value because A committed between the two reads.
- **Phantom read** — transaction B re-executes a query and gets additional rows because A inserted them.

The SQL standard defines four isolation levels — READ UNCOMMITTED, READ COMMITTED, REPEATABLE READ, SERIALIZABLE — which trade correctness for performance. Modern systems (PostgreSQL, CockroachDB) use **Multi-Version Concurrency Control (MVCC)** to provide snapshot isolation without blocking readers.

### Durability

Once a transaction commits, its effects survive crashes. This requires that the commit record reaches persistent storage — typically via `fsync` — before returning success to the client.

---

## How a query travels through a real database

Understanding the pipeline from SQL text to query result is key to understanding what we will build. Here is the path a query takes in a system like PostgreSQL:

```
SQL text
    │
    ▼
┌─────────┐
│  Lexer  │  Breaks the string into tokens (keywords, identifiers, literals)
└────┬────┘
     │
     ▼
┌─────────┐
│ Parser  │  Builds an Abstract Syntax Tree (AST) from the token stream
└────┬────┘
     │
     ▼
┌──────────────┐
│   Analyser   │  Resolves names, checks types, looks up the catalog
└──────┬───────┘
       │
       ▼
┌────────────────┐
│  Query Planner │  Generates candidate execution plans, estimates costs
└──────┬─────────┘
       │
       ▼
┌───────────────┐
│   Executor    │  Runs the chosen plan using operators (scan, filter, join)
└──────┬────────┘
       │
       ▼
┌──────────────┐
│ Storage Layer │  Reads/writes pages via the buffer pool and disk manager
└──────────────┘
```

RustDB will implement every layer of this pipeline, though we will omit the query planner (we will always do a sequential scan unless an index is available) and keep the analyser minimal.

---

## What this tutorial covers

### Implemented — you will build this

| Feature | Chapters |
|---------|---------|
| Fixed-size pages and disk I/O | 3 |
| LRU buffer pool | 4 |
| Typed values, rows, and schemas | 5 |
| Slotted-page heap storage and system catalog | 6 |
| B-Tree index (integer keys) | 7 |
| SQL parser: `CREATE TABLE`, `INSERT`, `SELECT … WHERE`, `CREATE INDEX` | 8 |
| Query execution: scan → filter → project | 9 |
| Write-Ahead Log (record format, writer, transaction manager) | 10 |
| Interactive REPL | 11 |
| `UPDATE` and `DELETE` | 12 |
| `DROP TABLE`, `TRUNCATE`, `ALTER TABLE ADD COLUMN` | 13 |
| Crash recovery (INSERT redo pass) | 14 |
| Multi-table `JOIN` (nested loop) | 15 |
| Concurrency: table-level locking, `BEGIN` / `COMMIT` / `ROLLBACK` | 16 |

### Deliberately not implemented

These features are left out of the tutorial. Each one is a significant engineering undertaking in its own right and would obscure the foundational concepts that are the tutorial's goal.

| Feature | Why it is out of scope | Starter guide |
|---------|----------------------|---------------|
| Query planner / optimiser | Requires cost estimation, statistics, and plan search — an engine unto itself | — |
| Row-level locking | Requires per-row lock tracking; table-level locking demonstrates the same 2PL concept | — |
| Full crash recovery (UPDATE/DELETE redo + undo) | Undo requires Compensation Log Records; infrastructure is in place but the pass is left as an exercise | — |
| Persistent system catalog | Storing schema on disk is straightforward but adds complexity without new concepts | Chapter 17 |
| Persistent B-Tree (page-backed) | The in-memory B-Tree demonstrates the algorithm; page-backed storage would duplicate buffer pool concepts | Chapter 17 |
| `ALTER TABLE DROP COLUMN` | Requires skip-bytes deserialisation or full table rewrite | Chapter 17 |
| `UPDATE` / `DELETE` undo on `ROLLBACK` | Requires replaying WAL before-images; infrastructure is in place, undo pass is not | Chapter 17 |
| Concurrent multi-threaded access | Rust's ownership model would require `Arc<Mutex<…>>` refactoring across the board | — |
| SQL `NULL` semantics (three-valued logic) | RustDB stores `NULL` but does not implement full three-valued `WHERE` evaluation | — |

---

## Further reading

- E.F. Codd, *"A Relational Model of Data for Large Shared Data Banks"*, CACM 1970 — the original paper. Short and readable.
- C.J. Date, *An Introduction to Database Systems* — comprehensive reference for the relational model.
- Andy Pavlo's CMU 15-445 lecture notes (freely available online) — the best university-level introduction to database internals.
- *Architecture of a Database System*, Hellerstein, Stonebraker & Hamilton — a long-form technical survey of how real engines are built.

---

**Next:** [Chapter 2 — Rust for Database Development](02-rust-setup.md)

---

*[Table of Contents](00-introduction.md)*
