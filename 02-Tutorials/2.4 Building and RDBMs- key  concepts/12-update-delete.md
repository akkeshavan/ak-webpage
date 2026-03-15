# Chapter 12: UPDATE and DELETE

INSERT is the easy operation: append a record to the end of a page and write a slot entry. UPDATE and DELETE are harder because they require reaching into the middle of existing data. This chapter adds both operations to RustDB — touching the heap storage layer, the SQL parser, and the executor.

---

## Theory: why mutation is harder than insertion

### The tombstone pattern

A naïve implementation of DELETE might shift all subsequent records on a page to fill the gap. But this breaks every `RowId` pointing into that page — all callers would need updating. Real databases use **tombstones** instead: mark the slot as logically deleted, leave the bytes in place, and let future compaction (not implemented here) reclaim the space.

In RustDB's slotted page layout the tombstone is simple: **set the slot's `length` field to 0**. The scan code already skips slots with `length == 0`, so deleted rows are invisible to all future reads.

```
Slot directory (4 bytes per entry):
  [offset: u16][length: u16]

Tombstone:
  [offset: u16][0: u16]   ← length = 0 means "deleted"
```

### In-place update vs. move-to-new-slot

UPDATE has two cases:

1. **New serialised bytes fit in the existing slot** (same size or smaller): overwrite in place. The `RowId` stays the same.
2. **New bytes are larger**: the slot cannot grow because adjacent records are packed above it. The solution is to tombstone the old slot and insert the updated row as a new record. The row gets a new `RowId`.

This is the simplest correct strategy. Production databases use additional techniques:

- **Forwarding pointers**: the old slot stores a pointer to the new location, so indexes and cursors that cached the old `RowId` still work.
- **TOAST** (PostgreSQL): oversized values are stored in a separate "overflow" page.
- **Update-in-place with free-space management**: compaction within the page to make room.

RustDB uses the tombstone-and-reinsert approach because it is easy to implement correctly and sufficient for a tutorial.

### Index maintenance on update and delete

When a row is updated or deleted, every index that indexes a column of that row must be updated too. In RustDB the B-Tree index is keyed on the first column. For DELETE we should remove the key; for UPDATE we should remove the old key and insert the new one.

RustDB's B-Tree does not implement deletion (it is a known simplification). On UPDATE, the executor inserts the new key and new `RowId` — the old entry becomes stale but harmless, because the heap row it pointed to has been tombstoned or moved.

> **Warning:** Repeated UPDATE and DELETE on an indexed table will continuously grow the B-Tree with stale entries. The index remains *correct* for lookups (stale entries point to tombstoned rows which are skipped) but grows without bound. The index is safe for demo purposes; a production implementation would require B-Tree deletion to be added.

---

## Code walkthrough

> **Files modified in this chapter:** `heap.rs`, `row.rs`, `sql/lexer.rs`, `sql/ast.rs`, `sql/parser.rs`, `executor.rs`

### `heap.rs`: `delete()`

```rust
// source/src/heap.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-12

pub fn delete(&self, row_id: RowId, bp: &mut BufferPool) -> io::Result<()> {
    let (page_id, slot) = row_id;
    let fi = bp.fetch_page(page_id)?;
    {
        let data = bp.page_mut(fi).data.as_mut();
        let slotted = dp_slotted_mut(data);
        let num_slots = page_num_slots(slotted);
        if slot < num_slots {
            let slot_off = slot_dir_offset(slot);
            // Set length to 0 (tombstone), leave offset as-is.
            write_u16(slotted, slot_off + 2, 0);
        }
    }
    bp.unpin(page_id, true);
    Ok(())
}
```

The page is fetched, the slot directory entry for `slot` has its length zeroed, and the page is unpinned as dirty. The existing `page_get()` function returns `None` for length-0 slots, so `scan()` skips them automatically.

### `heap.rs`: `scan_with_ids()`

The `scan()` method previously returned only rows; the executor now also needs `RowId`s to pass to `delete()` and `update()`. A new `scan_with_ids()` method returns `Vec<(RowId, Row)>`. `scan()` is reimplemented as a thin wrapper:

```rust
pub fn scan(&self, schema: &Schema, bp: &mut BufferPool) -> io::Result<Vec<Row>> {
    Ok(self.scan_with_ids(schema, bp)?.into_iter().map(|(_, r)| r).collect())
}

pub fn scan_with_ids(
    &self,
    schema: &Schema,
    bp: &mut BufferPool,
) -> io::Result<Vec<(RowId, Row)>> {
    let mut rows = Vec::new();
    let mut cur_id = self.first_page_id;

    loop {
        let fi = bp.fetch_page(cur_id)?;
        let (next_id, num_slots) = {
            let data = bp.page(fi).data.as_ref();
            (dp_next(data), page_num_slots(dp_slotted(data)))
        };

        for slot in 0..num_slots {
            let maybe_row = {
                let data = bp.page(fi).data.as_ref();
                page_get(dp_slotted(data), slot)
                    .and_then(|bytes| Row::deserialize_partial(bytes, schema))
            };
            if let Some(mut r) = maybe_row {
                // Pad missing columns with Null (for ALTER TABLE ADD COLUMN).
                while r.values.len() < schema.columns.len() {
                    r.values.push(crate::types::Value::Null);
                }
                rows.push(((cur_id, slot), r));
            }
        }

        bp.unpin(cur_id, false);
        if next_id == u32::MAX { break; }
        cur_id = next_id;
    }

    Ok(rows)
}
```

Two details worth noting:

1. `deserialize_partial` is used instead of `deserialize`. It reads as many values as the bytes contain, stopping at end-of-buffer rather than failing when the schema has more columns than the stored bytes (needed for Chapter 13's `ALTER TABLE ADD COLUMN`).
2. Missing trailing values are padded with `Value::Null` to match the schema length.

### `heap.rs`: `update()`

```rust
pub fn update(
    &self,
    row_id: RowId,
    new_row: &Row,
    bp: &mut BufferPool,
) -> io::Result<RowId> {
    let (page_id, slot) = row_id;
    let new_bytes = new_row.serialize();

    // Check whether the new bytes fit in the existing slot.
    let fits = {
        let fi = bp.fetch_page(page_id)?;
        let data = bp.page(fi).data.as_ref();
        let slotted = dp_slotted(data);
        let slot_off = slot_dir_offset(slot);
        let old_len = read_u16(slotted, slot_off + 2) as usize;
        bp.unpin(page_id, false);
        new_bytes.len() <= old_len
    };

    if fits {
        // Overwrite in place; zero-pad if the new bytes are shorter.
        let fi = bp.fetch_page(page_id)?;
        {
            let data = bp.page_mut(fi).data.as_mut();
            let slotted = dp_slotted_mut(data);
            let slot_off = slot_dir_offset(slot);
            let offset = read_u16(slotted, slot_off) as usize;
            let old_len = read_u16(slotted, slot_off + 2) as usize;
            slotted[offset..offset + new_bytes.len()].copy_from_slice(&new_bytes);
            if new_bytes.len() < old_len {
                for b in &mut slotted[offset + new_bytes.len()..offset + old_len] {
                    *b = 0;
                }
            }
            write_u16(slotted, slot_off + 2, new_bytes.len() as u16);
        }
        bp.unpin(page_id, true);
        Ok(row_id)
    } else {
        // Tombstone old slot and insert new row.
        self.delete(row_id, bp)?;
        self.insert(new_row, bp)
    }
}
```

The first fetch (with `unpin(..., false)`) is a read-only size check. Only if the new row fits do we re-fetch the page for writing.

### `executor.rs`: `exec_update()`

```rust
fn exec_update(
    &mut self,
    table: String,
    assignments: Vec<(String, Value)>,
    condition: Option<Condition>,
) -> ResultSet {
    let (schema, heap_root) = match self.catalog.get(&table) {
        Some(m) => (m.schema.clone(), m.heap_root),
        None => return ResultSet::Error(format!("table '{}' not found", table)),
    };

    let heap = TableHeap::open(heap_root);
    let rows_with_ids = match heap.scan_with_ids(&schema, &mut self.bp) {
        Ok(r) => r,
        Err(e) => return ResultSet::Error(e.to_string()),
    };

    // Resolve column names to indices once.
    let mut assign_map: Vec<(usize, Value)> = Vec::new();
    for (col_name, new_val) in &assignments {
        match schema.column_index(col_name) {
            Some(idx) => assign_map.push((idx, new_val.clone())),
            None => return ResultSet::Error(format!("column '{}' not found", col_name)),
        }
    }

    let mut count = 0usize;
    for (row_id, row) in rows_with_ids {
        if !condition.as_ref()
            .map(|c| eval_condition(c, &row, &schema))
            .unwrap_or(true)
        {
            continue;
        }

        let mut new_values = row.values.clone();
        for (idx, val) in &assign_map {
            new_values[*idx] = val.clone();
        }
        let new_row = Row::new(new_values);

        let heap2 = TableHeap::open(heap_root);
        match heap2.update(row_id, &new_row, &mut self.bp) {
            Ok(_) => {}
            Err(e) => return ResultSet::Error(e.to_string()),
        };

        count += 1;
    }

    ResultSet::Ok(format!("{} row{} updated", count, if count == 1 { "" } else { "s" }))
}
```

The scan happens first, producing `(RowId, Row)` pairs. For each row that passes the WHERE filter, a new `Row` is constructed with the assignment values substituted, and `heap.update()` is called with the original `RowId`.

### `executor.rs`: `exec_delete()`

```rust
fn exec_delete(&mut self, table: String, condition: Option<Condition>) -> ResultSet {
    let (schema, heap_root) = match self.catalog.get(&table) {
        Some(m) => (m.schema.clone(), m.heap_root),
        None => return ResultSet::Error(format!("table '{}' not found", table)),
    };

    let heap = TableHeap::open(heap_root);
    let rows_with_ids = match heap.scan_with_ids(&schema, &mut self.bp) {
        Ok(r) => r,
        Err(e) => return ResultSet::Error(e.to_string()),
    };

    let to_delete: Vec<_> = rows_with_ids
        .into_iter()
        .filter(|(_, row)| {
            condition.as_ref()
                .map(|c| eval_condition(c, row, &schema))
                .unwrap_or(true)
        })
        .collect();

    let count = to_delete.len();
    for (row_id, _row) in to_delete {
        let heap2 = TableHeap::open(heap_root);
        if let Err(e) = heap2.delete(row_id, &mut self.bp) {
            return ResultSet::Error(e.to_string());
        }
    }

    ResultSet::Ok(format!("{} row{} deleted", count, if count == 1 { "" } else { "s" }))
}
```

The scan and filter happen up front, collecting all `RowId`s to delete. The deletion pass then tombstones each matching row.

### SQL parser changes

`sql/lexer.rs` gains three new keywords:

```rust
Update,
Set,
Delete,
```

`sql/ast.rs` gains two new statement variants:

```rust
Update {
    table: String,
    assignments: Vec<(String, Value)>,
    condition: Option<Condition>,
},
Delete {
    table: String,
    condition: Option<Condition>,
},
```

`sql/parser.rs` adds `parse_update()` and `parse_delete()`:

```rust
fn parse_update(&mut self) -> Result<Statement, String> {
    let table = self.expect_ident()?;
    self.expect(&Token::Set)?;
    let mut assignments = Vec::new();
    loop {
        let col = self.expect_ident()?;
        self.expect(&Token::Eq)?;
        let val = self.parse_value()?;
        assignments.push((col, val));
        if self.peek() == &Token::Comma { self.advance(); } else { break; }
    }
    let condition = if self.peek() == &Token::Where {
        self.advance();
        Some(self.parse_condition()?)
    } else { None };
    Ok(Statement::Update { table, assignments, condition })
}

fn parse_delete(&mut self) -> Result<Statement, String> {
    self.expect(&Token::From)?;
    let table = self.expect_ident()?;
    let condition = if self.peek() == &Token::Where {
        self.advance();
        Some(self.parse_condition()?)
    } else { None };
    Ok(Statement::Delete { table, condition })
}
```

---

## Try it yourself

Add this test to `source/src/executor.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::sql::Parser;

    fn run(exec: &mut Executor, sql: &str) -> ResultSet {
        let stmt = Parser::new(sql).unwrap().parse().unwrap();
        exec.execute(stmt)
    }

    fn row_count(rs: ResultSet) -> usize {
        match rs {
            ResultSet::Rows { rows, .. } => rows.len(),
            _ => panic!("expected Rows"),
        }
    }

    #[test]
    fn update_and_delete() {
        let _ = std::fs::remove_file("/tmp/upd_del_test.db");
        let _ = std::fs::remove_file("/tmp/upd_del_test.wal");
        let mut exec = Executor::new("/tmp/upd_del_test.db").unwrap();

        run(&mut exec, "CREATE TABLE products (id INT, name TEXT, price INT)");
        run(&mut exec, "INSERT INTO products VALUES (1, 'apple', 100)");
        run(&mut exec, "INSERT INTO products VALUES (2, 'banana', 200)");
        run(&mut exec, "INSERT INTO products VALUES (3, 'cherry', 300)");

        // Update apple's price to 150.
        let rs = run(&mut exec, "UPDATE products SET price = 150 WHERE id = 1");
        match rs {
            ResultSet::Ok(msg) => assert!(msg.contains("1 row"), "got: {}", msg),
            _ => panic!("expected Ok"),
        }

        // Delete banana.
        let rs = run(&mut exec, "DELETE FROM products WHERE id = 2");
        match rs {
            ResultSet::Ok(msg) => assert!(msg.contains("1 row"), "got: {}", msg),
            _ => panic!("expected Ok"),
        }

        // Select all — should have 2 rows.
        let rs = run(&mut exec, "SELECT * FROM products");
        assert_eq!(row_count(rs), 2);

        // Verify the update: apple should have price 150.
        let rs = run(&mut exec, "SELECT * FROM products WHERE id = 1");
        match rs {
            ResultSet::Rows { rows, .. } => {
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0].values[2], crate::types::Value::Int(150));
            }
            _ => panic!("expected rows"),
        }

        std::fs::remove_file("/tmp/upd_del_test.db").ok();
        std::fs::remove_file("/tmp/upd_del_test.wal").ok();
    }
}
```

Run it with `cargo test update_and_delete`.

Two more tests cover the reinsert path and post-delete insertion:

`test_update_larger_row_forces_reinsert` (in `src/heap.rs`) updates a short `"hi"` string with a 200-character string. Because the new serialised bytes exceed the old slot size, `heap.update()` must tombstone the old slot and call `insert()` — so the returned `RowId` will differ from the original. After the operation `scan` must return exactly one row with the new content:

```rust
#[test]
fn test_update_larger_row_forces_reinsert() {
    // ... (see source/chapter-12/src/heap.rs)
    let row = Row::new(vec![Value::Text("hi".into())]);
    let rid = heap.insert(&row, &mut bp).unwrap();
    let big_row = Row::new(vec![Value::Text("x".repeat(200))]);
    let new_rid = heap.update(rid, &big_row, &mut bp).unwrap();
    assert_ne!(rid, new_rid, "larger row should get a new slot");
    let rows = heap.scan(&schema, &mut bp).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].values[0], Value::Text("x".repeat(200)));
}
```

`test_delete_then_insert_reuses_space` (in `src/executor.rs`) deletes row 1, inserts row 3, then selects all. Row 1 must be absent and rows 2 and 3 must both appear — confirming that tombstoned slots do not ghost-surface on future scans:

```rust
#[test]
fn test_delete_then_insert_reuses_space() {
    // ...
    run(&mut exec, "DELETE FROM t WHERE id = 1");
    run(&mut exec, "INSERT INTO t VALUES (3)");
    match run(&mut exec, "SELECT * FROM t") {
        ResultSet::Rows { rows, .. } => {
            let ids: Vec<i64> = rows.iter()
                .map(|r| match r.values[0] { Value::Int(i) => i, _ => -1 })
                .collect();
            assert!(!ids.contains(&1));
            assert!(ids.contains(&2) && ids.contains(&3));
        }
        _ => panic!(),
    }
}
```

---

## Key takeaways

- Tombstones (slot `length = 0`) make deletion safe without invalidating other `RowId`s on the same page.
- In-place update works when the new serialised row is not larger than the old one. Otherwise the old slot is tombstoned and the row is reinserted, getting a new `RowId`.
- `scan_with_ids()` returns `(RowId, Row)` pairs; the executor needs the `RowId` to call `heap.delete()` and `heap.update()`.
- Index maintenance is simplified here: B-Tree deletion is not implemented, so stale index entries can remain. A full implementation would remove the old key on every update/delete.
- The scan-then-modify pattern (collect all target rows first, then mutate) avoids the classic "Halloween problem" where rows moved during an update are scanned again.

---

**← Previous:** [Chapter 11 — Putting It All Together: A Working REPL](11-repl.md) | **Next:** [Chapter 13 — DDL: DROP TABLE and ALTER TABLE](13-ddl.md)
