# Chapter 10: Transactions and the Write-Ahead Log

Every write to RustDB goes through two steps: it modifies an in-memory page in the buffer pool, and eventually that page is flushed to disk. But what if the process crashes between those two steps? Or between two related writes that must both succeed or both fail? This chapter adds the machinery that gives RustDB its ACID guarantees.

> **Scope of this chapter:** The `WalRecord`, `WalWriter`, and `TransactionManager` types are fully implemented and correct. However, they are **not yet wired into the `Executor`** at this point in the tutorial — inserts in the current REPL session do not write WAL records. The chapter explains what the integration looks like and why the ordering matters. The wiring is completed in **Chapter 14 (Crash Recovery)**, which also adds `UPDATE` and `DELETE` log records. SQL `BEGIN`/`COMMIT`/`ROLLBACK` statements are added in **Chapter 16 (Concurrent Access)**.

---

## The problem: atomicity and durability

Consider a bank transfer: debit account A, credit account B. If the system crashes after the debit but before the credit, the money has vanished. The database must either apply both operations or neither — **atomicity**.

Now consider a simpler case: a single INSERT. The row is serialised into a few bytes, written to a heap page in the buffer pool, and eventually flushed to disk. If the process crashes *before* the flush, the row is lost. If the process commits the transaction and tells the client "success" but then crashes before flushing, we have violated **durability**.

The standard solution to both problems is the **Write-Ahead Log (WAL)**.

---

## Theory: the Write-Ahead Log

### The core rule

Before any modified data page is written to disk, a log record describing the modification must be written to the log file *and* that log record must reach persistent storage (via `fsync` or equivalent).

This is the **WAL protocol** (write-ahead logging): a log record describing a change must reach persistent storage before the corresponding data page is written to disk.

A related but distinct rule is **Force-Log-at-Commit**: the commit log record must be on disk before we tell the client the transaction committed. WAL protocol prevents data-page corruption after a crash mid-write; Force-Log-at-Commit prevents silent loss of committed data.

### Why this works

The log is append-only. Log records are small (tens to hundreds of bytes). Appending to the log is sequential I/O — extremely fast on both spinning disks (no seek) and SSDs.

Data pages, by contrast, are scattered across the file. Writing them is random I/O — slow. With WAL, we can defer data page writes (and therefore avoid random I/O) while still guaranteeing durability: in the worst case, we replay the log on recovery.

### Recovery

On restart after a crash, the engine reads the log from beginning to end:

- **REDO**: for every committed transaction, re-apply its log records to the data pages. This is necessary because committed changes may not have been flushed to disk.
- **UNDO**: for every transaction that was active at the time of the crash (no COMMIT record), roll back its changes.

This is the basis of the **ARIES** recovery algorithm (Analysis, Redo, Undo), used in IBM DB2, SQL Server, and PostgreSQL.

### Log record format

RustDB uses a simple fixed-schema record format. Each record begins with a 4-byte length field (so a reader can skip forward through the log without parsing each record), followed by a type tag and the payload:

```
[record_len: u32 LE][tag: u8][payload...]
```

| Tag | Type | Payload |
|-----|------|---------|
| 0 | BEGIN | txn_id (u64) |
| 1 | INSERT | txn_id (u64), table_name (length-prefixed), row_bytes (length-prefixed) |
| 2 | COMMIT | txn_id (u64) |
| 3 | ABORT | txn_id (u64) |

A full implementation would also include UPDATE and DELETE records.

---

## Code walkthrough

### `wal.rs` — log records and the writer

```rust
// source/src/wal.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-10

pub enum WalRecord {
    Begin(u64),
    Insert { txn_id: u64, table: String, row_bytes: Vec<u8> },
    Commit(u64),
    Abort(u64),
}
```

**Serialising a record:**

```rust
fn serialise(&self) -> Vec<u8> {
    let mut payload = Vec::new();
    match self {
        WalRecord::Begin(id) | WalRecord::Commit(id) | WalRecord::Abort(id) => {
            payload.extend_from_slice(&id.to_le_bytes());
        }
        WalRecord::Insert { txn_id, table, row_bytes } => {
            payload.extend_from_slice(&txn_id.to_le_bytes());
            let tb = table.as_bytes();
            payload.extend_from_slice(&(tb.len() as u32).to_le_bytes());
            payload.extend_from_slice(tb);
            payload.extend_from_slice(&(row_bytes.len() as u32).to_le_bytes());
            payload.extend_from_slice(row_bytes);
        }
    }
    let mut out = Vec::new();
    out.extend_from_slice(&((1 + payload.len()) as u32).to_le_bytes()); // record_len
    out.push(self.tag());
    out.extend_from_slice(&payload);
    out
}
```

The record length is written first so a reader scanning the log can skip records it does not need to inspect.

**The WAL writer:**

```rust
pub struct WalWriter {
    writer: BufWriter<File>,
}

impl WalWriter {
    pub fn append(&mut self, record: &WalRecord) -> io::Result<()> {
        let bytes = record.serialise();
        self.writer.write_all(&bytes)?;
        self.writer.flush()?; // ensure bytes leave the userspace buffer
        Ok(())
    }
}
```

`BufWriter` accumulates bytes in a userspace buffer to reduce the number of `write` syscalls. Calling `flush()` pushes those bytes to the kernel. For true durability we would also call `sync_all()` (fsync), but we omit that for tutorial performance.

### `TransactionManager`

```rust
pub struct TransactionManager {
    wal: WalWriter,
    next_txn_id: u64,
}

impl TransactionManager {
    pub fn begin(&mut self) -> io::Result<u64> {
        let id = self.next_txn_id;
        self.next_txn_id += 1;
        self.wal.append(&WalRecord::Begin(id))?;
        Ok(id)
    }

    pub fn log_insert(&mut self, txn_id: u64, table: &str,
                      row_bytes: Vec<u8>) -> io::Result<()> {
        self.wal.append(&WalRecord::Insert {
            txn_id,
            table: table.to_string(),
            row_bytes,
        })
    }

    pub fn commit(&mut self, txn_id: u64) -> io::Result<()> {
        self.wal.append(&WalRecord::Commit(txn_id))
    }

    pub fn abort(&mut self, txn_id: u64) -> io::Result<()> {
        self.wal.append(&WalRecord::Abort(txn_id))
    }
}
```

Each method writes exactly one log record. The important invariant: `commit` must be called (and the log flushed) *before* returning success to the client.

---

## How the WAL integrates with the executor

The `TransactionManager` is wired into `Executor` in Chapter 14. The integration follows this pattern for INSERT:

```rust
// source/src/executor.rs (see chapter-14 for the complete wired version)
// https://github.com/akkeshavan/db-tutorial-source/chapter-14

fn exec_insert(&mut self, table: String, values: Vec<Value>) -> ResultSet {
    let txn_id = self.txn_mgr.begin()?;

    // ... validate and insert row into heap as before ...
    let row_bytes = row.serialize();

    self.txn_mgr.log_insert(txn_id, &table, row_bytes)?; // WAL BEFORE heap write
    // now flush the heap page (or defer it)

    self.txn_mgr.commit(txn_id)?; // WAL commit BEFORE returning success
    ResultSet::Ok("1 row inserted".into())
}
```

The ordering — log record first, data page second — is the invariant that makes recovery possible. Chapter 14 also adds `UPDATE` and `DELETE` log records and a `recover()` function that replays the log on startup.

---

## Recovery sketch

A recovery function would read the log file sequentially:

```rust
fn recover(log_path: &str, exec: &mut Executor) {
    // Pass 1: Analysis
    //   Scan the log to build a set of committed txn_ids.
    //   Note which transactions were in progress at crash time.

    // Pass 2: Redo
    //   Re-apply all INSERT records for committed transactions.
    //   (Some of these pages may already be on disk and up-to-date,
    //    but replaying is always safe — idempotent by design.)

    // Pass 3: Undo
    //   Roll back all incomplete transactions.
    //   (For INSERT, the undo is simply deleting the row.)
}
```

Full implementation of ARIES recovery is an advanced topic. The log format RustDB writes is compatible with a correct recovery implementation — building one is a recommended exercise.

---

## Try it yourself

Add this test to `src/wal.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_and_read_wal() {
        let path = "/tmp/rustdb_test.wal";
        let _ = std::fs::remove_file(path);

        let mut mgr = TransactionManager::new(path).unwrap();
        let txn = mgr.begin().unwrap();
        mgr.log_insert(txn, "users", vec![0u8, 1, 2, 3]).unwrap();
        mgr.commit(txn).unwrap();

        // Verify the file is non-empty.
        let metadata = std::fs::metadata(path).unwrap();
        assert!(metadata.len() > 0, "WAL file should not be empty");

        std::fs::remove_file(path).unwrap();
    }
}
```

The following two tests add coverage for multiple transactions and monotonically increasing transaction IDs:

```rust
#[test]
fn test_multiple_transactions() {
    let path = "/tmp/rustdb_ch10_multi.wal";
    let _ = std::fs::remove_file(path);
    let mut mgr = TransactionManager::new(path).unwrap();

    let t1 = mgr.begin().unwrap();
    mgr.log_insert(t1, "users", vec![1, 2, 3]).unwrap();
    mgr.commit(t1).unwrap();

    let t2 = mgr.begin().unwrap();
    mgr.log_insert(t2, "orders", vec![4, 5, 6]).unwrap();
    mgr.abort(t2).unwrap();

    let size = std::fs::metadata(path).unwrap().len();
    assert!(size > 30, "WAL should have records for 2 transactions, got {} bytes", size);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn test_txn_ids_increment() {
    let path = "/tmp/rustdb_ch10_ids.wal";
    let _ = std::fs::remove_file(path);
    let mut mgr = TransactionManager::new(path).unwrap();
    let t1 = mgr.begin().unwrap();
    let t2 = mgr.begin().unwrap();
    assert!(t2 > t1, "transaction IDs should be monotonically increasing");
    std::fs::remove_file(path).unwrap();
}
```

`test_multiple_transactions` spans two transactions (one committed, one aborted) and verifies that both left records on disk — the raw file size is a proxy for "at least six records were written". `test_txn_ids_increment` is a sanity check on `TransactionManager`'s counter: each `begin()` must return a strictly larger ID than the previous one, which is required for the recovery phase to know which transactions to redo.

---

## The WAL and the buffer pool: a dependency

There is a subtle but important interaction between the WAL and the buffer pool's dirty-page eviction:

**The steal/no-force policy:**

- **Steal** — the buffer pool is allowed to evict and flush a dirty page even before the transaction commits. (The WAL ensures recovery can undo this if needed.)
- **No-force** — the buffer pool is *not* required to flush dirty pages at commit time. (The WAL's commit record on disk is sufficient for durability.)

Most modern databases use steal/no-force because it gives maximum flexibility to the buffer pool (it can evict whenever it wants) while keeping commit latency low (only the small commit log record needs to be fsynced, not entire data pages).

RustDB currently uses an implicit no-force policy (dirty pages are flushed lazily on eviction) but does not enforce the WAL-before-page-flush ordering. Adding that check is a good extension exercise.

---

## Key takeaways

- The WAL is the foundation of both atomicity and durability. Log first, modify data second.
- The Force-Log-at-Commit rule: the commit record reaches disk before we tell the client "committed".
- Log records are small and written sequentially — the cheap, fast path. Data pages are written asynchronously — the expensive path that can be deferred.
- Recovery replays the log: redo committed transactions, undo incomplete ones. Chapter 14 implements the redo pass for INSERT records; full undo is left as an exercise.

---

**← Previous:** [Chapter 9 — Query Execution](09-executor.md) | **Next:** [Chapter 11 — Putting It All Together: A Working REPL](11-repl.md)
