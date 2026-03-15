# Chapter 17: Improvements

RustDB works. You can create tables, insert rows, query with WHERE, join tables, recover from crashes, and run concurrent transactions. But several important pieces were intentionally left out to keep each chapter focused. This chapter hands those pieces to you.

Each section below follows the same format: **why it matters**, **the theory**, **the algorithm**, and **skeletal code** to get you started. None of this code is in the companion repository — these are your exercises.

---

## 1. Persisting the System Catalog

### Why it matters

Every time RustDB restarts, the catalog is empty. You must re-run `CREATE TABLE` statements before you can query anything. This means crash recovery is largely useless: even if the WAL replays your INSERTs, the tables those rows belong to do not exist in the catalog.

PostgreSQL stores its catalog in ordinary system tables (`pg_class`, `pg_attribute`, `pg_type`) — the same heap storage used for user data. SQLite stores the schema as rows in a special `sqlite_master` table. Both approaches use the storage engine to persist the schema, which is elegant: the catalog bootstraps itself.

### Theory

The simplest approach for RustDB is to reserve a fixed set of pages at the start of the database file for catalog storage. Page 0 becomes a **catalog header page** that records how many tables exist. Pages 1 through N store serialised `TableMeta` records.

On startup, before the REPL loop, `load_catalog` reads these pages and reconstructs the in-memory `Catalog`. On every `CREATE TABLE` or `DROP TABLE`, `save_catalog` rewrites the catalog pages.

An alternative — and the approach taken by SQLite and PostgreSQL — is to store the catalog as rows in a heap table, using a well-known root page ID (e.g., page 0 is always the root of the `__catalog__` heap). This is more elegant but requires the heap reader to work before the catalog is loaded, which means special-casing the bootstrap.

For RustDB, the reserved-pages approach is simpler and sufficient.

### Algorithm

```
STARTUP:
  if database file is new:
    allocate page 0 as catalog header (num_tables = 0)
    initialise buffer pool normally
  else:
    read page 0 → num_tables
    for i in 0..num_tables:
      read catalog page i+1 → deserialise TableMeta
      insert into Catalog

SAVE_CATALOG (called after CREATE TABLE / DROP TABLE):
  write num_tables to page 0
  for each TableMeta in catalog:
    serialise → write to catalog page (1-indexed)
  flush catalog pages

SERIALISE TableMeta:
  table_name: 4-byte length + UTF-8 bytes
  heap_root:  4 bytes (u32)
  num_columns: 4 bytes (u32)
  for each Column:
    name: 4-byte length + UTF-8
    data_type: 1 byte (0=Int, 1=Float, 2=Text, 3=Bool)
    nullable: 1 byte (0 or 1)
```

### Skeletal code

```rust
// source/src/catalog.rs

impl Catalog {
    /// Serialise the entire catalog to a flat byte vec.
    pub fn serialise(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let tables: Vec<&TableMeta> = self.tables.values().collect();
        out.extend_from_slice(&(tables.len() as u32).to_le_bytes());
        for meta in tables {
            // --- table name ---
            let name_bytes = meta.name.as_bytes();
            out.extend_from_slice(&(name_bytes.len() as u32).to_le_bytes());
            out.extend_from_slice(name_bytes);
            // --- heap root ---
            out.extend_from_slice(&meta.heap_root.to_le_bytes());
            // --- columns ---
            out.extend_from_slice(&(meta.schema.columns.len() as u32).to_le_bytes());
            for col in &meta.schema.columns {
                let col_bytes = col.name.as_bytes();
                out.extend_from_slice(&(col_bytes.len() as u32).to_le_bytes());
                out.extend_from_slice(col_bytes);
                let type_tag: u8 = match col.data_type {
                    DataType::Int   => 0,
                    DataType::Float => 1,
                    DataType::Text  => 2,
                    DataType::Bool  => 3,
                };
                out.push(type_tag);
                out.push(col.nullable as u8);
            }
        }
        out
    }

    /// Deserialise a catalog from bytes produced by `serialise`.
    pub fn deserialise(bytes: &[u8]) -> Option<Catalog> {
        // TODO: parse the byte stream following the same layout as serialise()
        // Use a cursor (offset: usize) that advances as you read each field.
        // Return None if the bytes are malformed.
        todo!()
    }
}

// In executor.rs — call after every DDL statement:
fn save_catalog(&mut self) -> io::Result<()> {
    let bytes = self.catalog.serialise();
    // Split bytes across PAGE_SIZE pages starting at page 0.
    // Write each chunk to the buffer pool via new_page() or fetch_page().
    todo!()
}

// In repl.rs — call before the REPL loop:
fn load_catalog(bp: &mut BufferPool) -> io::Result<Catalog> {
    // Read page 0, get num_tables, then read subsequent pages.
    // Concatenate the byte slices and call Catalog::deserialise().
    todo!()
}
```

### What to change in the existing code

- `Executor::new` should call `load_catalog` before returning.
- `exec_create_table` and `exec_drop_table` should call `save_catalog` after modifying the in-memory catalog.
- `DiskManager::new` must not zero-fill page 0 if it already exists (check file size first).

---

## 2. Persisting the B-Tree Index

### Why it matters

The current B-Tree lives entirely in RAM as `Box<Node>`. Every restart rebuilds it from scratch via `CREATE INDEX`. This has two consequences: startup is O(n) in the number of indexed rows, and if the index is not explicitly recreated the executor always falls back to a full scan.

A page-backed B-Tree stores each node in a buffer pool page. The node is serialised when the page is evicted and deserialised when it is fetched — exactly the same lifecycle as heap pages. This is how InnoDB, SQLite, and PostgreSQL's `btree` access method work.

### Theory

Each B-Tree node maps to one page. The page layout is:

```
Bytes 0-0:  is_leaf (u8, 0 or 1)
Bytes 1-2:  num_keys (u16)
Bytes 3-N:  keys  — num_keys × 8 bytes (i64, little-endian)
If leaf:
  Bytes N+1-M: values — num_keys × 6 bytes (page_id: u32 + slot: u16)
If internal:
  Bytes N+1-M: children — (num_keys + 1) × 4 bytes (page_id: u32)
```

A **root pointer page** (one reserved page per index, stored in `TableMeta`) holds the `page_id` of the current root node. When the root splits, a new root is allocated and the root pointer is updated.

### Algorithm

```
SEARCH(key, root_page_id, bp):
  fi = bp.fetch_page(root_page_id)
  node = Node::deserialise(bp.page(fi))
  bp.unpin(root_page_id, false)
  if node.is_leaf:
    binary_search node.keys for key → return node.values[idx]
  else:
    child_page_id = node.children[partition_point(node.keys, key)]
    return SEARCH(key, child_page_id, bp)

INSERT(key, value, root_page_id, bp):
  if root is full (num_keys == 2B-1):
    new_root_page_id = bp.new_page()
    // Write new root: is_leaf=false, num_keys=0, children=[root_page_id]
    split_child(new_root_page_id, 0, root_page_id, bp)
    update root pointer → new_root_page_id
    insert_non_full(new_root_page_id, key, value, bp)
  else:
    insert_non_full(root_page_id, key, value, bp)

INSERT_NON_FULL(page_id, key, value, bp):
  fi = bp.fetch_page(page_id)
  node = Node::deserialise(bp.page(fi))
  if node.is_leaf:
    insert key+value at correct sorted position
    serialise node → bp.page_mut(fi)
    bp.unpin(page_id, dirty=true)
  else:
    i = partition_point(node.keys, key)
    child_page = node.children[i]
    if child is full:
      split_child(page_id, i, child_page, bp)
      re-read node (it changed)
      if key > node.keys[i]: i += 1
    bp.unpin(page_id, dirty=false)
    insert_non_full(node.children[i], key, value, bp)
```

### Skeletal code

```rust
// source/src/btree_paged.rs

use crate::buffer_pool::BufferPool;
use crate::page::PAGE_SIZE;

const B: usize = 3;
const MAX_KEYS: usize = 2 * B - 1;

pub type RowId = (u32, u16);

pub struct PagedBTree {
    pub root_page_id: u32,
    pub len: usize,
}

struct Node {
    is_leaf: bool,
    keys: Vec<i64>,
    values: Vec<RowId>,    // only meaningful if is_leaf
    children: Vec<u32>,   // page_ids, only meaningful if !is_leaf
}

impl Node {
    fn deserialise(page_data: &[u8; PAGE_SIZE]) -> Node {
        let is_leaf = page_data[0] != 0;
        let num_keys = u16::from_le_bytes([page_data[1], page_data[2]]) as usize;
        let mut keys = Vec::with_capacity(num_keys);
        let mut offset = 3usize;
        for _ in 0..num_keys {
            let k = i64::from_le_bytes(page_data[offset..offset+8].try_into().unwrap());
            keys.push(k);
            offset += 8;
        }
        // TODO: read values (if leaf) or children (if internal) from `offset` onward
        todo!()
    }

    fn serialise(&self, page_data: &mut [u8; PAGE_SIZE]) {
        page_data[0] = self.is_leaf as u8;
        let num_keys = self.keys.len() as u16;
        page_data[1..3].copy_from_slice(&num_keys.to_le_bytes());
        let mut offset = 3usize;
        for &k in &self.keys {
            page_data[offset..offset+8].copy_from_slice(&k.to_le_bytes());
            offset += 8;
        }
        // TODO: write values or children from `offset` onward
        todo!()
    }
}

impl PagedBTree {
    pub fn create(bp: &mut BufferPool) -> (u32, PagedBTree) {
        let (root_page_id, fi) = bp.new_page();
        // Initialise root as an empty leaf node
        let root = Node { is_leaf: true, keys: vec![], values: vec![], children: vec![] };
        root.serialise(bp.page_mut(fi).data.as_mut());
        bp.unpin(root_page_id, true);
        (root_page_id, PagedBTree { root_page_id, len: 0 })
    }

    pub fn search(&self, key: i64, bp: &mut BufferPool) -> Option<RowId> {
        Self::search_page(self.root_page_id, key, bp)
    }

    fn search_page(page_id: u32, key: i64, bp: &mut BufferPool) -> Option<RowId> {
        let fi = bp.fetch_page(page_id).ok()?;
        let node = Node::deserialise(bp.page(fi).data.as_ref());
        bp.unpin(page_id, false);
        if node.is_leaf {
            let idx = node.keys.partition_point(|&k| k < key);
            if idx < node.keys.len() && node.keys[idx] == key {
                Some(node.values[idx])
            } else {
                None
            }
        } else {
            let child_idx = node.keys.partition_point(|&k| k <= key);
            Self::search_page(node.children[child_idx], key, bp)
        }
    }

    pub fn insert(&mut self, key: i64, value: RowId, bp: &mut BufferPool) {
        // TODO: check if root is full (num_keys == MAX_KEYS),
        // if so allocate a new root page, split the old root, then insert.
        // Otherwise call insert_non_full(self.root_page_id, key, value, bp).
        todo!()
    }
}
```

### What to change in the existing code

- Add `btree_paged.rs` as a new module.
- Change `TableMeta` to store `index_root: Option<u32>` (a page ID) instead of `index: Option<BTree>`.
- Update `exec_create_index` to call `PagedBTree::create` and store `index_root` in the catalog.
- Update `exec_select` index lookup to call `PagedBTree::search`.
- Because nodes are now buffer pool pages, the index survives restarts automatically — no rebuild needed.

---

## 3. ALTER TABLE DROP COLUMN

### Why it matters

`ALTER TABLE ADD COLUMN` is already implemented using lazy NULL materialisation. The reverse — dropping a column — is harder because existing rows have bytes for the dropped column embedded between bytes for other columns, and RustDB's serialisation is positional.

### Theory

Two strategies:

**Lazy (skip-bytes):** Mark the column as dropped in the schema (`Column::dropped = true`). During deserialisation, read and discard the bytes for dropped columns. This is what PostgreSQL does via `pg_attribute.attisdropped`. It is fast (no table rewrite) but the dead bytes accumulate on disk indefinitely.

**Eager (table rewrite):** Scan every row in the heap, deserialise under the old schema, drop the column's value, re-serialise under the new schema, and write to a fresh heap. Swap the catalog's `heap_root` to point to the new heap. This is what `ALTER TABLE … SET DATA TYPE` does in PostgreSQL when the cast requires a rewrite.

The lazy approach is simpler. Implement it first.

### Algorithm (lazy approach)

```
DROP COLUMN col_name FROM table_name:
  1. Find column index i in schema.columns where name == col_name.
  2. Mark schema.columns[i].dropped = true.
     Do NOT remove the column from the vec — position matters for deserialisation.
  3. Update catalog (and persist if catalog persistence is implemented).

DESERIALISE ROW (updated to handle dropped columns):
  for each column in schema.columns:
    read bytes for the value (type tag + payload)
    if column.dropped:
      discard the value (do not add to row.values)
    else:
      push value to row.values
```

### Skeletal code

```rust
// source/src/schema.rs — extend Column

pub struct Column {
    pub name: String,
    pub data_type: DataType,
    pub nullable: bool,
    pub dropped: bool,   // NEW — true means this column has been dropped
}

impl Column {
    pub fn new(name: String, data_type: DataType) -> Self {
        Column { name, data_type, nullable: true, dropped: false }
    }
}

// source/src/row.rs — update deserialise_partial to skip dropped columns

pub fn deserialise_partial(bytes: &[u8], schema: &Schema) -> Option<Row> {
    let mut values = Vec::new();
    let mut offset = 0;
    for col in &schema.columns {
        if offset >= bytes.len() { break; }
        let (val, consumed) = Value::deserialize(&bytes[offset..])?;
        offset += consumed;
        if !col.dropped {
            values.push(val);   // only keep live columns
        }
        // if col.dropped: val is read and discarded — byte position advances correctly
    }
    // Pad any trailing live columns that are missing (for ADD COLUMN compatibility)
    let live_cols = schema.columns.iter().filter(|c| !c.dropped).count();
    while values.len() < live_cols { values.push(Value::Null); }
    Some(Row::new(values))
}

// source/src/executor.rs — add exec_alter_table variant

fn exec_drop_column(&mut self, table: String, column: String) -> ResultSet {
    match self.catalog.get_mut(&table) {
        None => ResultSet::Error(format!("table '{}' not found", table)),
        Some(meta) => {
            match meta.schema.columns.iter_mut().find(|c| c.name.eq_ignore_ascii_case(&column)) {
                None => ResultSet::Error(format!("column '{}' not found", column)),
                Some(col) => {
                    col.dropped = true;
                    ResultSet::Ok(format!("column '{}' dropped from '{}'", column, table))
                }
            }
        }
    }
}
```

### What to change in the existing code

- Add `dropped: bool` to `Column` and update all `Column::new` call sites.
- Update `AlterAction` to include `DropColumn(String)`.
- Add `DROP COLUMN` parsing to `parse_alter_table`.
- Update `scan` and `deserialise_partial` as shown above.
- Optional: add `VACUUM table_name` to physically rewrite the heap and remove dead bytes.

---

## 4. ROLLBACK Undo (UPDATE and DELETE)

### Why it matters

RustDB's current `ROLLBACK` writes an Abort WAL record and releases locks, but leaves the heap unchanged. Rows written by an aborted transaction remain on disk. This violates atomicity — one of the four ACID guarantees.

True undo requires replaying the `before_bytes` fields stored in the `Update` and `Delete` WAL records written by Chapter 14.

### Theory

ARIES undo works in reverse log order. For each log record belonging to the aborting transaction, in reverse chronological order:

- **Insert** record → delete the inserted row (tombstone it).
- **Update** record → restore the row to its `before_bytes`.
- **Delete** record → re-insert the row from its `before_bytes`.

Each undo action writes a **Compensation Log Record (CLR)**. A CLR says "I undid log record at LSN X" and points back to the previous log record for this transaction (the `undo_next_lsn`). If the process crashes during undo, recovery re-runs the undo pass but skips any log record that already has a CLR — making undo idempotent.

For RustDB, a simplified version without CLRs is sufficient for demonstrating the concept (with the caveat that crash-during-undo will re-do the undo from scratch rather than resuming).

### Algorithm

```
ROLLBACK(txn_id, exec, wal_records):
  // Collect all records for this transaction in reverse order
  txn_records = wal_records
    .filter(|r| r.txn_id() == txn_id)
    .reverse()

  for record in txn_records:
    match record:
      WalRecord::Insert { table, row_bytes, .. } =>
        // Find and tombstone this row.
        // Challenge: INSERT records don't store the RowId.
        // Solution: store RowId in the WAL Insert record (requires schema change).
        undo_insert(table, row_id, exec)

      WalRecord::Update { table, row_id, before_bytes, .. } =>
        // Restore the row to its before image.
        let schema = exec.catalog.get(table)?.schema
        let before_row = Row::deserialise_partial(&before_bytes, &schema)?
        exec.heap_for(table).update(row_id, &before_row, &mut exec.bp)

      WalRecord::Delete { table, row_id, before_bytes, .. } =>
        // Re-insert the deleted row.
        let schema = exec.catalog.get(table)?.schema
        let before_row = Row::deserialise_partial(&before_bytes, &schema)?
        exec.heap_for(table).insert(&before_row, &mut exec.bp)

  // Write WAL Abort record (already done by exec_rollback — keep it)
```

### Skeletal code

```rust
// source/src/wal.rs — add undo function

pub fn undo_transaction(
    txn_id: u64,
    log_path: &str,
    exec: &mut crate::executor::Executor,
) -> io::Result<()> {
    let records = read_all(log_path)?;

    // Collect records for this transaction in reverse order
    let mut txn_records: Vec<WalRecord> = records
        .into_iter()
        .filter(|r| r.txn_id() == txn_id)
        .collect();
    txn_records.reverse();

    for record in txn_records {
        match record {
            WalRecord::Insert { table, row_id, row_bytes } => {
                // TODO: tombstone the row at row_id
                // Requires storing RowId in the Insert WAL record (see note below)
                let _ = (table, row_id, row_bytes);
                todo!("extend WalRecord::Insert to include row_id")
            }
            WalRecord::Update { table, row_id, before_bytes, .. } => {
                let schema = match exec.catalog.get(&table) {
                    Some(m) => m.schema.clone(),
                    None => continue,
                };
                if let Some(before_row) = crate::row::Row::deserialize_partial(&before_bytes, &schema) {
                    let heap = crate::heap::TableHeap::open(
                        exec.catalog.get(&table).unwrap().heap_root
                    );
                    let _ = heap.update(row_id, &before_row, &mut exec.bp);
                }
            }
            WalRecord::Delete { table, row_id, before_bytes } => {
                let schema = match exec.catalog.get(&table) {
                    Some(m) => m.schema.clone(),
                    None => continue,
                };
                if let Some(before_row) = crate::row::Row::deserialize_partial(&before_bytes, &schema) {
                    let heap = crate::heap::TableHeap::open(
                        exec.catalog.get(&table).unwrap().heap_root
                    );
                    let _ = heap.insert(&before_row, &mut exec.bp);
                }
            }
            _ => {} // Begin, Commit, Abort — nothing to undo
        }
    }
    Ok(())
}

// source/src/executor.rs — call undo before releasing locks

fn exec_rollback(&mut self) -> ResultSet {
    match self.active_txn.take() {
        None => ResultSet::Error("no active transaction".into()),
        Some(tid) => {
            // Undo heap changes before releasing locks
            let _ = crate::wal::undo_transaction(tid, "rustdb.wal", self);
            if let Some(ref mut tm) = self.txn_mgr {
                let _ = tm.abort(tid);
            }
            self.lock_manager.release_all(tid);
            ResultSet::Ok("ROLLBACK".into())
        }
    }
}
```

> **Note:** The current `WalRecord::Insert` does not store the `RowId` returned by `heap.insert()`. To implement Insert undo, extend the record:
> ```rust
> Insert { txn_id: u64, table: String, row_id: (u32, u16), row_bytes: Vec<u8> }
> ```
> Then capture the `RowId` from `heap.insert()` in `exec_insert` and pass it to `log_insert`.

### What to change in the existing code

- Extend `WalRecord::Insert` to include `row_id: (u32, u16)`.
- Update `log_insert` signature and `exec_insert` to pass the RowId.
- Update `WalRecord::serialise` and `deserialise` for the new field.
- Call `undo_transaction` from `exec_rollback` before the Abort record is written.
- Update the `exec_rollback` result message from "ROLLBACK (heap changes NOT undone)" to "ROLLBACK" once undo is working.

---

## Where to go from here

Completing these four improvements gives you a database that is meaningfully more durable and correct than what Part I and Part II deliver:

| After this chapter | Capability gained |
|--------------------|-------------------|
| Catalog persistence | Tables survive restarts; recovery becomes fully useful |
| Paged B-Tree | Index survives restarts; no rebuild on startup |
| DROP COLUMN | Complete ALTER TABLE support |
| ROLLBACK undo | True ACID atomicity — aborted transactions leave no trace |

From there, the natural next frontiers are:

- **Row-level locking** — replace the table-level `LockManager` with a `HashMap<RowId, Vec<(txn_id, LockMode)>>`. The compatibility logic is identical; only the granularity changes.
- **Query planner** — add row-count statistics to `TableMeta`, implement a cost model, and choose between full scan and index lookup at runtime.
- **MVCC** — replace tombstone deletion with version chains, allowing readers and writers to proceed without blocking each other.
- **WAL checkpointing** — periodically record the set of dirty pages and active transactions so recovery does not need to replay the entire WAL from the beginning.

Each of these is a significant project. Each one builds directly on the foundations you have laid.

---

**← Previous:** [Chapter 16 — Concurrent Access](16-concurrency.md) | [Table of Contents](00-introduction.md)
