# Chapter 14: Crash Recovery

A database that loses committed data on a crash is not a database worth using. The Write-Ahead Log introduced in Chapter 10 was the foundation. This chapter extends it to actually *use* the log during startup — reading back committed transactions and redoing any writes that were not flushed to disk before the crash.

---

## Theory: the durability problem

Suppose a user issues:

```sql
INSERT INTO orders VALUES (42, 'laptop', 1299);
-- commit acknowledged to user
```

The executor writes the row to a buffer pool frame, logs a WAL record, and returns success to the user. But the buffer pool frame may not have been flushed to disk yet. If the process crashes at this moment, the data file has no record of row 42. The user was told the commit succeeded, but the data is gone. This violates **Durability** — the D in ACID.

### The Force-Log-at-Commit rule

The WAL solves this with a simple rule: **before acknowledging a commit to the user, flush the log record for that commit to disk**. The data page does not need to be flushed immediately — it can be written to disk lazily by the buffer pool's eviction policy. On restart, the recovery manager will redo the committed write from the log.

This is the **No-Force** policy: pages are not forced to disk at commit time. Combined with **Steal** (dirty pages can be evicted before commit), it gives maximum buffer pool flexibility at the cost of needing a redo pass on restart.

### ARIES: Analysis, Redo, Undo

The standard crash recovery algorithm is **ARIES** (Algorithm for Recovery and Isolation Exploiting Semantics), published by Mohan et al. in 1992. It has three passes:

**Pass 1 — Analysis**: Scan the log from the last checkpoint to the end. Build the set of transactions that were active at the time of the crash (neither committed nor aborted). Also determine which pages were dirty at crash time (the "dirty page table").

**Pass 2 — Redo**: Replay every log record for transactions that committed, in order, to bring the data pages back to the state they were in at the moment of the crash. Start from the earliest LSN in the dirty page table (the "redo point").

**Pass 3 — Undo**: Roll back every transaction that was active at the crash (did not commit). This is done in reverse log order, and each undo action writes a **Compensation Log Record** (CLR) so the undo is itself idempotent.

RustDB implements a simplified Analysis + Redo pass **for INSERT records only**. UPDATE and DELETE redo, and all Undo passes, are left as exercises. The WAL record types for UPDATE and DELETE do carry before-images (`before_bytes`), so the infrastructure for full Undo is in place.

### Limitation: the catalog is not persisted

RustDB's catalog is entirely in-memory. When the process restarts, the catalog is empty. **Recovery will silently skip any table not present in the catalog** — meaning rows for that table are not replayed even if their WAL records exist. Since `CREATE TABLE` statements are not logged, the catalog must be rebuilt by re-running DDL after restart. The practical utility of recovery is therefore limited until catalog persistence is added.

Persisting the catalog — storing it in special system tables on disk, the way PostgreSQL uses `pg_class` and `pg_attribute` — would make recovery fully automatic. This is left as a significant but tractable extension.

---

## Code walkthrough

> **Files modified in this chapter:** `wal.rs`, `executor.rs`, `repl.rs`

### New WAL record types

Two new variants are added to `WalRecord` in `source/src/wal.rs`:

```rust
// source/src/wal.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-14

Update {
    txn_id: u64,
    table: String,
    row_id: (u32, u16),
    before_bytes: Vec<u8>,
    after_bytes: Vec<u8>,
},
Delete {
    txn_id: u64,
    table: String,
    row_id: (u32, u16),
    before_bytes: Vec<u8>,
},
```

`Update` carries both the before-image and the after-image of the row. `Delete` carries only the before-image (the after-image is implicit: the row is gone). Both store the `row_id` so an undo pass could locate the slot.

The tag assignments:

| Tag | Type   |
|-----|--------|
| 0   | Begin  |
| 1   | Insert |
| 2   | Commit |
| 3   | Abort  |
| 4   | Update |
| 5   | Delete |

### `TransactionManager` logging helpers

```rust
pub fn log_update(
    &mut self,
    txn_id: u64,
    table: &str,
    row_id: (u32, u16),
    before_bytes: Vec<u8>,
    after_bytes: Vec<u8>,
) -> io::Result<()> {
    self.wal.append(&WalRecord::Update {
        txn_id, table: table.to_string(), row_id, before_bytes, after_bytes,
    })
}

pub fn log_delete(
    &mut self,
    txn_id: u64,
    table: &str,
    row_id: (u32, u16),
    before_bytes: Vec<u8>,
) -> io::Result<()> {
    self.wal.append(&WalRecord::Delete {
        txn_id, table: table.to_string(), row_id, before_bytes,
    })
}
```

### `WalRecord::deserialise()`

Reading the log back requires deserialising each record. The format mirrors the serialisation in `serialise()`:

```rust
pub fn deserialise(bytes: &[u8]) -> Option<WalRecord> {
    if bytes.is_empty() { return None; }
    let tag = bytes[0];
    let payload = &bytes[1..];
    match tag {
        0 => { /* Begin: read u64 txn_id */ }
        1 => { /* Insert: txn_id, table_len, table, data_len, row_bytes */ }
        2 => { /* Commit: u64 txn_id */ }
        3 => { /* Abort: u64 txn_id */ }
        4 => { /* Update: txn_id, table, row_id, before_bytes, after_bytes */ }
        5 => { /* Delete: txn_id, table, row_id, before_bytes */ }
        _ => None,
    }
}
```

All fields are read as little-endian integers with length-prefixed byte arrays.

### `read_all()`

```rust
pub fn read_all(path: &str) -> io::Result<Vec<WalRecord>> {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    file.seek(SeekFrom::Start(0))?;
    let mut records = Vec::new();
    let mut len_buf = [0u8; 4];
    loop {
        match file.read_exact(&mut len_buf) {
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e),
        }
        let record_len = u32::from_le_bytes(len_buf) as usize;
        let mut record_buf = vec![0u8; record_len];
        file.read_exact(&mut record_buf)?;
        if let Some(rec) = WalRecord::deserialise(&record_buf) {
            records.push(rec);
        }
    }
    Ok(records)
}
```

The loop reads a 4-byte `record_len`, then reads exactly that many bytes into a buffer, and deserialises. `UnexpectedEof` at the start of the loop is a clean end-of-file. `UnexpectedEof` partway through a record would indicate a torn write (the crash happened mid-record) — for simplicity the loop treats this as end of file.

### `recover()`

```rust
pub fn recover(log_path: &str, exec: &mut crate::executor::Executor) -> io::Result<()> {
    let records = read_all(log_path)?;
    if records.is_empty() { return Ok(()); }

    // Pass 1 — Analysis: collect committed txn_ids.
    let committed: HashSet<u64> = records
        .iter()
        .filter_map(|r| if let WalRecord::Commit(id) = r { Some(*id) } else { None })
        .collect();

    // Pass 2 — Redo: re-insert rows for committed Insert records.
    for record in &records {
        if let WalRecord::Insert { txn_id, table, row_bytes } = record {
            if !committed.contains(txn_id) { continue; }
            let schema = match exec.catalog.get(table) {
                Some(m) => m.schema.clone(),
                None => continue, // table not in catalog — skip
            };
            if let Some(row) = crate::row::Row::deserialize_partial(row_bytes, &schema) {
                let _ = exec.exec_insert_raw(table.clone(), row);
            }
        }
    }

    Ok(())
}
```

The two-pass structure maps directly to ARIES: Analysis collects committed transaction IDs; Redo replays their effects.

`exec_insert_raw` is a helper defined in `executor.rs` that inserts a pre-built `Row` directly into the heap and catalog without writing any WAL record. It is the same as `exec_insert` except it skips the `txn_mgr.begin/log_insert/commit` calls. This is essential: if redo itself wrote WAL records, the next recovery run would replay those records too — an infinite loop. Using a WAL-silent path breaks the cycle.

### WAL integration in `exec_insert`

```rust
fn exec_insert(&mut self, table: String, values: Vec<Value>) -> ResultSet {
    // ... validate ...

    let row = Row::new(values.clone());
    let row_bytes = row.serialize();

    // WAL: Begin + Insert + Commit (auto-commit).
    let wal_txn = if let Some(ref mut tm) = self.txn_mgr {
        let tid = match tm.begin() { Ok(id) => id, Err(_) => 0 };
        let _ = tm.log_insert(tid, &table, row_bytes.clone());
        Some(tid)
    } else { None };

    let row_id = match heap.insert(&row, &mut self.bp) { ... };

    if let Some(tid) = wal_txn {
        if let Some(ref mut tm) = self.txn_mgr {
            let _ = tm.commit(tid);
        }
    }
    // ...
}
```

Each INSERT auto-commits: Begin → Insert record → actual heap write → Commit. The same pattern is used for UPDATE and DELETE. When explicit `BEGIN`/`COMMIT` transactions are added (Chapter 16), the WAL transactions span multiple statements.

### Wiring recovery in `repl.rs`

```rust
// source/src/repl.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-14

let mut exec = match Executor::new(DB_FILE) { ... };

// Attempt WAL recovery on startup.
if let Err(e) = wal::recover("rustdb.wal", &mut exec) {
    eprintln!("recovery warning: {}", e);
}
```

Recovery runs once at startup, before the REPL loop begins. If the log file does not exist, `recover` returns `Ok(())` immediately.

---

## Try it yourself

Extend the existing WAL tests in `source/src/wal.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wal_update_delete_roundtrip() {
        let path = "/tmp/wal_upd_del_test.wal";
        let _ = std::fs::remove_file(path);

        let mut tm = TransactionManager::new(path).unwrap();

        let tid1 = tm.begin().unwrap();
        tm.log_insert(tid1, "orders", vec![0u8, 1, 2, 3]).unwrap();
        tm.commit(tid1).unwrap();

        let tid2 = tm.begin().unwrap();
        tm.log_update(
            tid2,
            "orders",
            (0, 0),
            vec![0u8, 1, 2, 3],         // before
            vec![0u8, 1, 2, 99],        // after
        ).unwrap();
        tm.commit(tid2).unwrap();

        let tid3 = tm.begin().unwrap();
        tm.log_delete(
            tid3,
            "orders",
            (0, 0),
            vec![0u8, 1, 2, 99],        // before
        ).unwrap();
        tm.commit(tid3).unwrap();

        // Read back and verify all three record types were stored.
        let records = read_all(path).unwrap();
        let inserts = records.iter().filter(|r| matches!(r, WalRecord::Insert { .. })).count();
        let updates = records.iter().filter(|r| matches!(r, WalRecord::Update { .. })).count();
        let deletes = records.iter().filter(|r| matches!(r, WalRecord::Delete { .. })).count();
        let commits = records.iter().filter(|r| matches!(r, WalRecord::Commit(_))).count();

        assert_eq!(inserts, 1);
        assert_eq!(updates, 1);
        assert_eq!(deletes, 1);
        assert_eq!(commits, 3);

        std::fs::remove_file(path).ok();
    }
}
```

Run with `cargo test wal_update_delete_roundtrip`.

`test_recovery_simulation` demonstrates the two-session crash-recovery pattern end-to-end. Session 1 creates a table, inserts a row, flushes the buffer pool, then drops without a clean shutdown. Session 2 opens a fresh executor (empty in-memory catalog), re-declares the schema (necessary because the catalog is not persisted), calls `recover()` to replay the committed WAL Insert record, and then verifies the table has at least one row:

```rust
#[test]
fn test_recovery_simulation() {
    use crate::executor::{Executor, ResultSet};
    let db_path = "/tmp/rustdb_ch14_recovery.db";
    let wal_path = "/tmp/rustdb_ch14_recovery.wal";
    // Session 1: create + insert, then simulate crash
    {
        let mut exec = Executor::new(db_path).unwrap();
        let run = |exec: &mut Executor, sql: &str| { ... };
        run(&mut exec, "CREATE TABLE users (id INT, name TEXT)");
        run(&mut exec, "INSERT INTO users VALUES (1, 'alice')");
        exec.flush().unwrap();
    }
    // Session 2: re-create schema, recover, verify
    {
        let mut exec = Executor::new(db_path).unwrap();
        let run = |exec: &mut Executor, sql: &str| { ... };
        run(&mut exec, "CREATE TABLE users (id INT, name TEXT)");
        let _ = crate::wal::recover(wal_path, &mut exec);
        match run(&mut exec, "SELECT * FROM users") {
            ResultSet::Rows { rows, .. } => assert!(!rows.is_empty()),
            _ => panic!(),
        }
    }
}
```

The key point the test illustrates: because the catalog is purely in-memory, re-creating the schema is a prerequisite for recovery. A production engine would persist the catalog (or deduce the schema from the WAL itself) to avoid this extra step.

---

## Key takeaways

- The Force-Log-at-Commit rule guarantees durability: the WAL record is flushed before acknowledging a commit, even if the data page is not yet on disk.
- ARIES' three passes (Analysis, Redo, Undo) provide a complete framework. RustDB implements Analysis and Redo; Undo requires before-images and CLRs.
- `read_all()` reads records sequentially, handling clean end-of-file gracefully. Torn writes at the very end of the log (incomplete last record) are treated as end-of-file.
- `exec_insert_raw` bypasses WAL logging to prevent a redo from generating new WAL records — an infinite-recursion trap to be aware of.
- Recovery is currently limited to tables already in the catalog. Full recovery requires persisting the catalog, which is the natural next step.

---

**← Previous:** [Chapter 13 — DDL: DROP TABLE and ALTER TABLE](13-ddl.md) | **Next:** [Chapter 15 — Multi-table JOINs](15-joins.md)
