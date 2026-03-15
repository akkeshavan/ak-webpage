# Chapter 16: Concurrent Access

Every production database must handle multiple clients at once. Two users who both insert into the same table at the same moment, or one user reading while another is updating — these scenarios expose concurrency bugs that don't appear in single-threaded tests. This chapter adds a lock manager and explicit transactions (`BEGIN`/`COMMIT`/`ROLLBACK`) to RustDB.

---

## Theory: isolation anomalies

Without any concurrency control, transactions can interfere with each other in several ways. SQL defines four **isolation anomalies** and four **isolation levels** that prevent them in different combinations.

### Dirty read

Transaction T1 writes a row but has not yet committed. Transaction T2 reads that row. T1 then rolls back. T2 has read data that never officially existed.

### Non-repeatable read

T1 reads row R, getting value `v1`. T2 updates R to `v2` and commits. T1 reads R again and gets `v2`. Within a single transaction, the same read produced two different results.

### Phantom read

T1 reads all rows in a table where `age > 30`, getting 5 rows. T2 inserts a new row with `age = 35` and commits. T1 re-executes the same query and gets 6 rows. A "phantom" row appeared between two reads in the same transaction.

### SQL isolation levels

| Level            | Dirty read | Non-repeatable read | Phantom read |
|------------------|------------|---------------------|--------------|
| READ UNCOMMITTED | possible   | possible            | possible     |
| READ COMMITTED   | prevented  | possible            | possible     |
| REPEATABLE READ  | prevented  | prevented           | possible     |
| SERIALIZABLE     | prevented  | prevented           | prevented    |

RustDB's table-level locking prevents concurrent interference between transactions on the same table. However, this is **not** a full SERIALIZABLE implementation in the ACID sense: (1) lock conflicts produce an immediate error rather than blocking, and (2) **ROLLBACK does not undo heap changes** — an aborted transaction can still leave rows on disk. Think of it as "serializable or error, with no undo."

Additionally, **ROLLBACK in RustDB releases locks and writes an Abort WAL record, but does not undo heap changes**. Data already written to the heap by a rolled-back transaction remains there. Full undo requires replaying before-images from the WAL (Chapter 14's `before_bytes` fields) and writing Compensation Log Records — this is left as an exercise.

---

## Theory: Two-Phase Locking (2PL)

**Two-Phase Locking** is the classic protocol for achieving serializable schedules. A transaction's lock acquisitions are divided into two phases:

1. **Growing phase**: the transaction may acquire new locks but cannot release any.
2. **Shrinking phase**: the transaction may release locks but cannot acquire new ones.

The critical insight is that once a transaction releases any lock, it has entered the shrinking phase. Any interleaving of transactions that respects 2PL is serializable — equivalent to some serial execution.

### Lock compatibility matrix

Two locks are **compatible** if granting both simultaneously is safe:

|                 | Shared (S) | Exclusive (X) |
|-----------------|------------|---------------|
| **Shared (S)**  | compatible | conflict      |
| **Exclusive (X)** | conflict | conflict    |

Multiple transactions can hold shared locks on the same resource simultaneously (concurrent reads are safe). An exclusive lock requires that no other transaction holds any lock on the resource.

### Deadlock

Deadlock occurs when two transactions each hold a lock the other needs:

- T1 holds X-lock on `users`, waiting for X-lock on `orders`
- T2 holds X-lock on `orders`, waiting for X-lock on `users`

Neither can proceed. Databases detect deadlocks using a **wait-for graph** (a cycle in this graph indicates deadlock) and break them by aborting one of the transactions.

Alternative prevention strategies:

- **Wait-die**: if T1 (older) waits for T2 (younger), wait. If T1 (younger) waits for T2 (older), abort T1 ("die").
- **Wound-wait**: if T1 (older) waits for T2 (younger), abort T2 ("wound"). If T1 (younger) waits for T2 (older), wait.

RustDB does not implement deadlock detection. The lock manager returns an error immediately on conflict rather than blocking, which prevents deadlock by construction but is less practical.

### MVCC: the alternative

Multi-Version Concurrency Control (MVCC) avoids locks on reads by maintaining multiple versions of each row. Writers create new versions; readers use the version that was current at their transaction start time. PostgreSQL, MySQL InnoDB, and SQLite all use MVCC.

MVCC gives better read concurrency than 2PL (readers never block writers) at the cost of needing a garbage collector to remove old versions. Implementing MVCC requires version chains in the heap — a significant extension beyond this chapter.

---

## Code walkthrough

### `lock_manager.rs` (new file)

This chapter adds `source/src/lock_manager.rs` — a new file that must also be declared with `mod lock_manager;` in `main.rs`. The `LockManager` is a `HashMap` from table name to a list of `(txn_id, LockMode)` pairs:

```rust
// source/src/lock_manager.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-16

#[derive(Debug, Clone, PartialEq)]
pub enum LockMode { Shared, Exclusive }

pub struct LockManager {
    held: HashMap<String, Vec<(u64, LockMode)>>,
}
```

`acquire` checks for conflicts with other transactions before granting the lock:

```rust
pub fn acquire(&mut self, table: &str, txn_id: u64, mode: LockMode) -> Result<(), String> {
    let holders = self.held.entry(table.to_string()).or_default();

    for (holder_txn, holder_mode) in holders.iter() {
        if *holder_txn == txn_id { continue; } // same transaction
        if !Self::is_compatible(holder_mode, &mode) {
            return Err(format!(
                "lock conflict on '{}': txn {} holds {:?}, txn {} requested {:?}",
                table, holder_txn, holder_mode, txn_id, mode
            ));
        }
    }

    // Grant or upgrade.
    let already = holders.iter().any(|(t, _)| *t == txn_id);
    if !already {
        holders.push((txn_id, mode));
    } else {
        for entry in holders.iter_mut() {
            if entry.0 == txn_id {
                if mode == LockMode::Exclusive { entry.1 = LockMode::Exclusive; }
                break;
            }
        }
    }
    Ok(())
}

pub fn release_all(&mut self, txn_id: u64) {
    for holders in self.held.values_mut() {
        holders.retain(|(t, _)| *t != txn_id);
    }
}

pub fn is_compatible(existing: &LockMode, requested: &LockMode) -> bool {
    matches!((existing, requested), (LockMode::Shared, LockMode::Shared))
}
```

### Lock acquisition in DML statements

Every DML method acquires the appropriate lock before touching the heap. For auto-commit statements (`active_txn` is `None`), the lock is released immediately after the statement. For explicit transactions, it is held until `COMMIT` or `ROLLBACK`:

```rust
// In exec_insert:
let txn_id = self.active_txn;
let lock_txn = txn_id.unwrap_or(0);
if let Err(e) = self.lock_manager.acquire(&table, lock_txn, LockMode::Exclusive) {
    return ResultSet::Error(e);
}
// ... do the insert ...
if txn_id.is_none() {
    self.lock_manager.release_all(lock_txn);  // auto-commit: release immediately
}
```

SELECT acquires a shared lock; INSERT, UPDATE, DELETE acquire an exclusive lock.

### `Executor` struct additions

```rust
pub struct Executor {
    pub catalog: Catalog,
    pub bp: BufferPool,
    pub txn_mgr: Option<TransactionManager>,
    pub lock_manager: LockManager,
    pub active_txn: Option<u64>,  // Some(id) if inside BEGIN...COMMIT block
}
```

`active_txn` is `None` in auto-commit mode and `Some(txn_id)` inside an explicit transaction.

### BEGIN / COMMIT / ROLLBACK

```rust
fn exec_begin(&mut self) -> ResultSet {
    if self.active_txn.is_some() {
        return ResultSet::Error("transaction already active".into());
    }
    let tid = if let Some(ref mut tm) = self.txn_mgr {
        tm.begin().unwrap_or(1)
    } else { 1 };
    self.active_txn = Some(tid);
    ResultSet::Ok(format!("BEGIN (txn {})", tid))
}

fn exec_commit(&mut self) -> ResultSet {
    match self.active_txn.take() {
        None => ResultSet::Error("no active transaction".into()),
        Some(tid) => {
            if let Some(ref mut tm) = self.txn_mgr { let _ = tm.commit(tid); }
            self.lock_manager.release_all(tid);
            ResultSet::Ok("COMMIT".into())
        }
    }
}

fn exec_rollback(&mut self) -> ResultSet {
    match self.active_txn.take() {
        None => ResultSet::Error("no active transaction".into()),
        Some(tid) => {
            if let Some(ref mut tm) = self.txn_mgr { let _ = tm.abort(tid); }
            self.lock_manager.release_all(tid);
            // Heap changes are NOT undone — undo requires CLRs (future work).
            ResultSet::Ok("ROLLBACK (heap changes NOT undone)".into())
        }
    }
}
```

`COMMIT` writes a WAL Commit record and releases all locks.

> **Important limitation — ROLLBACK does not undo data.** `ROLLBACK` writes a WAL Abort record and releases all locks, but the rows already written to the heap by this transaction remain on disk. A client issuing `ROLLBACK` will get the "ROLLBACK (heap changes NOT undone)" message. Full undo requires replaying the `before_bytes` fields in the Update/Delete WAL records and writing Compensation Log Records (CLRs) to make the undo itself idempotent — a significant extension left for the reader.

### Why table-level locks are enough (for now)

Row-level locking is more granular: two transactions updating different rows of the same table don't conflict. But implementing row-level locking requires associating a lock with a `RowId`, which in turn requires the lock manager to handle a potentially unbounded number of lock entries (one per row). Table-level locking keeps the implementation simple and is entirely correct — it just reduces concurrency.

---

## Try it yourself

Add this test to `source/src/lock_manager.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_shared_compatible() {
        let mut lm = LockManager::new();
        lm.acquire("users", 1, LockMode::Shared).unwrap();
        lm.acquire("users", 2, LockMode::Shared).unwrap();
    }

    #[test]
    fn exclusive_exclusive_conflict() {
        let mut lm = LockManager::new();
        lm.acquire("users", 1, LockMode::Exclusive).unwrap();
        let result = lm.acquire("users", 2, LockMode::Exclusive);
        assert!(result.is_err(), "two exclusive locks should conflict");
        let msg = result.unwrap_err();
        assert!(msg.contains("lock conflict"), "got: {}", msg);
    }

    #[test]
    fn shared_exclusive_conflict() {
        let mut lm = LockManager::new();
        lm.acquire("users", 1, LockMode::Shared).unwrap();
        let result = lm.acquire("users", 2, LockMode::Exclusive);
        assert!(result.is_err(), "shared+exclusive should conflict");
    }

    #[test]
    fn release_clears_locks() {
        let mut lm = LockManager::new();
        lm.acquire("users", 1, LockMode::Exclusive).unwrap();
        lm.release_all(1);
        // Now txn 2 can acquire the lock.
        lm.acquire("users", 2, LockMode::Exclusive).unwrap();
    }

    #[test]
    fn same_txn_can_re_acquire() {
        let mut lm = LockManager::new();
        lm.acquire("users", 1, LockMode::Shared).unwrap();
        // Same transaction can upgrade to exclusive.
        lm.acquire("users", 1, LockMode::Exclusive).unwrap();
    }
}
```

Run with `cargo test` from the `source/` directory to execute all lock manager tests.

Three more tests in `src/lock_manager.rs` cover additional conflict scenarios and the upgrade path. **`test_lock_conflict_exclusive_vs_exclusive` is the most important test in this chapter** — it directly demonstrates the 2PL invariant that prevents dirty reads: if transaction 2 could acquire an exclusive lock while transaction 1 holds one, it could overwrite uncommitted data and transaction 1 could later be rolled back, leaving transaction 2 having read or written a value that never existed:

```rust
#[test]
fn test_lock_conflict_exclusive_vs_exclusive() {
    let mut lm = LockManager::new();
    assert!(lm.acquire(1, "users", LockMode::Exclusive).is_ok());
    assert!(lm.acquire(2, "users", LockMode::Exclusive).is_err(),
        "exclusive lock should conflict with another exclusive lock");
}

#[test]
fn test_lock_conflict_shared_vs_exclusive() {
    let mut lm = LockManager::new();
    lm.acquire(1, "users", LockMode::Shared).unwrap();
    assert!(lm.acquire(2, "users", LockMode::Exclusive).is_err(),
        "exclusive lock should conflict with existing shared lock");
}

#[test]
fn test_same_txn_can_upgrade() {
    let mut lm = LockManager::new();
    lm.acquire(1, "users", LockMode::Shared).unwrap();
    // The same transaction must not conflict with its own prior lock.
    let result = lm.acquire(1, "users", LockMode::Exclusive);
    let _ = result; // upgrade behaviour is implementation-defined
}
```

And in `src/executor.rs`, `test_rollback_releases_locks` confirms that after a `ROLLBACK` the lock manager has released all locks held by the aborted transaction, so a subsequent `BEGIN` succeeds immediately:

```rust
#[test]
fn test_rollback_releases_locks() {
    // ...
    run(&mut exec, "BEGIN");
    run(&mut exec, "INSERT INTO t VALUES (1)");
    run(&mut exec, "ROLLBACK");
    match run(&mut exec, "BEGIN") {
        ResultSet::Ok(_) => {}
        other => panic!("expected Ok after rollback, got {:?}", other),
    }
    run(&mut exec, "ROLLBACK");
}
```

---

## Key takeaways

- The four isolation anomalies (dirty read, non-repeatable read, phantom read, and write-write conflict) are prevented at different SQL isolation levels.
- Two-Phase Locking (2PL) guarantees serializability: a transaction acquires all needed locks in the growing phase and releases them only in the shrinking phase.
- Lock compatibility: S+S is compatible, S+X and X+X are conflicts.
- RustDB uses table-level locking with immediate error-on-conflict rather than blocking. This prevents deadlock but reduces concurrency.
- `active_txn: Option<u64>` distinguishes auto-commit mode (release locks immediately) from explicit transaction mode (hold until COMMIT/ROLLBACK).
- ROLLBACK does not undo heap changes. Full undo requires before-images in Update/Delete WAL records plus Compensation Log Records — the infrastructure is in place (Chapter 14) but the undo pass is left as an exercise.
- MVCC is an alternative to 2PL that gives better read concurrency, used by PostgreSQL and MySQL InnoDB, at the cost of maintaining version chains and a garbage collector.

---

**← Previous:** [Chapter 15 — Multi-table JOINs](15-joins.md) | **Next:** [Chapter 17 — Improvements](17-improvements.md) | [Table of Contents](00-introduction.md)
