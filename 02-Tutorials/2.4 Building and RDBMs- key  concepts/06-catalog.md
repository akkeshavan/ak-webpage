# Chapter 6: Tables and the System Catalog

We have pages that can hold bytes, a buffer pool that caches them, and a type system that gives those bytes meaning. The missing piece is a structure that ties them together: something that knows "the table called `users` has columns `(id INT, name TEXT)` and its rows start on page 3." That is the catalog. But first, we need to decide how to organise rows within a page.

---

## The heap: the simplest table structure

The most straightforward way to store rows is in a **heap** — an unordered collection of rows spread across a chain of pages. There is no sorting, no clustering, no particular order. Rows are appended when inserted and scanned in physical order when queried.

Heaps are used by PostgreSQL as the default table storage format. Their advantages:

- Inserts are always appended — no page reorganisation, O(1) amortised
- Easy to implement
- Work well with secondary indexes (which provide the ordering when needed)

The disadvantage is full-table scan performance. Without an index, every row must be read. For large tables with selective queries, this is expensive. We will address it with the B-Tree index in Chapter 7.

---

## Theory: the slotted page

A naive approach would write rows end-to-end across the page, with a header tracking how many bytes have been used. This works until you add variable-length rows: how do you find row 5 if rows 1–4 are different lengths? You have to scan from the beginning.

The standard solution is the **slotted page** format:

```
┌────────────────────────────────────────────────────────┐
│ num_slots (u16) │ free_ptr (u16) │ slot dir ──────────► │
│                                  │ [off₀|len₀][off₁|len₁]│
│                                                          │
│                         (free space)                     │
│                                                          │
│ ◄────────── row data grows from page end ──── row₁ row₀ │
└────────────────────────────────────────────────────────┘
```

- The **header** at byte 0 stores `num_slots` (how many rows have been inserted into this page) and `free_ptr` (the byte offset where the next row will be written, counting down from the page end).
- The **slot directory** is a fixed-size array that grows upward from byte 4. Each slot entry is 4 bytes: a 2-byte offset and a 2-byte length pointing to the corresponding row's bytes at the end of the page.
- **Row data** grows downward from the end of the page.

This layout has nice properties:

- Given a slot number, finding the row is O(1): read the slot entry, seek to offset.
- Inserting a row doesn't move existing rows.
- A deleted slot sets `length = 0` — a tombstone — without shifting anything.
- The directory and data sections grow toward each other; insertion fails only when they meet.

---

## Theory: the table heap as a linked list

A single slotted page can hold at most `(PAGE_SIZE - header_bytes) / average_row_size` rows. Once it fills up, we need another page. RustDB links heap pages in a singly linked list:

```
page 2 ──next──► page 7 ──next──► page 11 ──next──► 0xFFFFFFFF (end)
  ↑
first_page_id
```

The first 4 bytes of each data page hold the `next_page_id` (or `0xFFFFFFFF` if it is the last page). The slotted page layout starts at byte 4.

When inserting, the heap walks the list looking for a page with free space. When none is found, it allocates a new page via the buffer pool and links it.

This design is deliberately simple. PostgreSQL maintains a **free-space map** (FSM) alongside each heap to track which pages have enough room for a given row size, avoiding the walk. We omit that optimisation here.

---

## Code walkthrough

### `heap.rs` — low-level page manipulation

```rust
// source/src/heap.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-06

// Layout constants
const HDR_NUM_SLOTS: usize = 0; // u16 at byte 0
const HDR_FREE_PTR:  usize = 2; // u16 at byte 2
const HEADER_BYTES:  usize = 4;
const SLOT_BYTES:    usize = 4; // [offset: u16][length: u16]
const NEXT_PAGE_BYTES: usize = 4;
```

The helper `page_insert` encapsulates the insertion algorithm:

```rust
fn page_insert(data: &mut [u8], record: &[u8]) -> Option<u16> {
    let num_slots = page_num_slots(data);
    let free_ptr  = page_free_ptr(data) as usize;
    let dir_end   = HEADER_BYTES + (num_slots as usize + 1) * SLOT_BYTES;

    if free_ptr < dir_end + record.len() {
        return None; // page full
    }

    let new_free_ptr = free_ptr - record.len();
    data[new_free_ptr..free_ptr].copy_from_slice(record);

    let slot_off = HEADER_BYTES + num_slots as usize * SLOT_BYTES;
    write_u16(data, slot_off,     new_free_ptr as u16);
    write_u16(data, slot_off + 2, record.len() as u16);

    write_u16(data, HDR_NUM_SLOTS, num_slots + 1);
    write_u16(data, HDR_FREE_PTR,  new_free_ptr as u16);

    Some(num_slots)
}
```

Note the invariant check: `free_ptr < dir_end + record.len()` ensures both the record data and the new slot directory entry fit.

### `TableHeap` — the public API

```rust
pub struct TableHeap {
    pub first_page_id: u32,
}

impl TableHeap {
    pub fn create(bp: &mut BufferPool) -> io::Result<Self>;
    pub fn open(first_page_id: u32) -> Self;
    pub fn insert(&self, row: &Row, bp: &mut BufferPool) -> io::Result<RowId>;
    pub fn scan(&self, schema: &Schema, bp: &mut BufferPool) -> io::Result<Vec<Row>>;
}
```

`RowId` is a type alias `(u32, u16)` — (page_id, slot_index). It is the stable address of a row and is stored in B-Tree index entries.

The `insert` method walks the linked list of pages, tries `page_insert` on each, and allocates a new page if all existing pages are full:

```rust
pub fn insert(&self, row: &Row, bp: &mut BufferPool) -> io::Result<RowId> {
    let record = row.serialize();
    let mut cur_id = self.first_page_id;
    loop {
        let fi = bp.fetch_page(cur_id)?;
        let next_id = dp_next(bp.page(fi).data.as_ref());

        let slot = {
            let data = bp.page_mut(fi).data.as_mut();
            page_insert(dp_slotted_mut(data), &record)
        };

        if let Some(slot) = slot {
            bp.unpin(cur_id, true);
            return Ok((cur_id, slot));
        }
        bp.unpin(cur_id, false);

        if next_id == u32::MAX {
            // Current page is full and is the last in the chain.
            // Allocate a fresh page, initialise it, and insert there.
            let (new_id, new_fi) = bp.new_page()?;
            {
                let data = bp.page_mut(new_fi).data.as_mut();
                dp_set_next(data, u32::MAX);       // new page has no successor
                init_page(dp_slotted_mut(data));   // zero header
                page_insert(dp_slotted_mut(data), &record); // always slot 0
            }
            bp.unpin(new_id, true);

            // Rewrite the old page's next pointer to link in the new page.
            let fi2 = bp.fetch_page(cur_id)?;
            dp_set_next(bp.page_mut(fi2).data.as_mut(), new_id);
            bp.unpin(cur_id, true);

            return Ok((new_id, 0));
        }
        cur_id = next_id;
    }
}
```

---

### `catalog.rs` — the system catalog

```rust
// source/src/catalog.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-06

pub struct TableMeta {
    pub name: String,
    pub schema: Schema,
    pub heap_root: u32,          // first page of the heap
    pub index: Option<BTree>,    // optional B-Tree on first column
}

pub struct Catalog {
    tables: HashMap<String, TableMeta>,
}
```

The catalog stores everything needed to work with a table:
- the schema (column names and types)
- the heap root page id (where to start a scan or insert)
- an optional B-Tree index

In production databases the catalog is itself stored in special system tables (PostgreSQL's `pg_class`, `pg_attribute`, etc.) so it survives restarts. RustDB keeps the catalog in a `HashMap` and rebuilds it on restart — which is acceptable for a prototype where we don't require durability across sessions.

```rust
impl Catalog {
    pub fn create_table(&mut self, meta: TableMeta) -> Result<(), String> {
        let name = meta.name.to_ascii_lowercase();
        if self.tables.contains_key(&name) {
            return Err(format!("table '{}' already exists", name));
        }
        self.tables.insert(name, meta);
        Ok(())
    }
    pub fn get(&self, name: &str) -> Option<&TableMeta> { ... }
    pub fn get_mut(&mut self, name: &str) -> Option<&mut TableMeta> { ... }
}
```

Table names are normalised to lowercase on both insert and lookup, giving case-insensitive semantics consistent with the SQL standard.

---

## Try it yourself

Add this test block to `src/heap.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer_pool::BufferPool;
    use crate::disk_manager::DiskManager;
    use crate::row::Row;
    use crate::schema::{Column, Schema};
    use crate::types::{DataType, Value};

    #[test]
    fn heap_insert_and_scan() {
        let path = "/tmp/rustdb_heap_test.db";
        let _ = std::fs::remove_file(path);
        let dm = DiskManager::new(path).unwrap();
        let mut bp = BufferPool::new(16, dm);

        let schema = Schema::new(vec![
            Column::new("id",   DataType::Int),
            Column::new("name", DataType::Text),
        ]);

        let heap = TableHeap::create(&mut bp).unwrap();

        for i in 0..5i64 {
            let row = Row::new(vec![
                Value::Int(i),
                Value::Text(format!("user_{}", i)),
            ]);
            heap.insert(&row, &mut bp).unwrap();
        }

        let rows = heap.scan(&schema, &mut bp).unwrap();
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[2].values[0], Value::Int(2));

        std::fs::remove_file(path).unwrap();
    }
}
```

Run with `cargo test heap`.

The following test exercises the linked-list page chain directly. Each row is roughly 50 bytes (an `Int` plus a 30-character `Text`). At `PAGE_SIZE = 4096` bytes with a 4-byte next-pointer header and a 4-byte slot directory entry per row, a single page holds about 60 rows. Inserting 100 rows must therefore overflow into a second page. `insert()` allocates a new page and writes the outgoing `next_page_id` pointer into the previous page's header. `scan()` follows that chain and must return all 100 rows:

```rust
#[test]
fn test_multipage_insert() {
    use crate::disk_manager::DiskManager;
    use crate::buffer_pool::BufferPool;
    use crate::schema::{Column, Schema};
    use crate::types::{DataType, Value};
    use crate::row::Row;
    let path = "/tmp/rustdb_ch06_multipage.db";
    let _ = std::fs::remove_file(path);
    let dm = DiskManager::new(path).unwrap();
    let mut bp = BufferPool::new(16, dm);
    let schema = Schema::new(vec![
        Column::new("id", DataType::Int),
        Column::new("data", DataType::Text),
    ]);
    let heap = TableHeap::create(&mut bp).unwrap();
    let n = 100usize;
    let long_str = "x".repeat(30);
    for i in 0..n {
        let row = Row::new(vec![Value::Int(i as i64), Value::Text(long_str.clone())]);
        heap.insert(&row, &mut bp).unwrap();
    }
    let rows = heap.scan(&schema, &mut bp).unwrap();
    assert_eq!(rows.len(), n, "all {} rows should be scanned back", n);
    std::fs::remove_file(path).unwrap();
}
```

If the pointer write or the chain traversal in `scan` is off by even one byte, some rows will be silently lost. This test would catch that.

---

## Key takeaways

- The slotted page format gives O(1) access to any row by slot number, regardless of variable-length column sizes.
- Heap pages are linked in a simple singly-linked list. Insertions walk the list; full scans walk the same list.
- The system catalog is the single source of truth for table metadata. Every other subsystem looks up the catalog to know what schemas and heap roots exist.
- `RowId = (page_id, slot)` is the physical row address — stable as long as the row is not moved (we don't support UPDATE, so rows are never moved).

---

**← Previous:** [Chapter 5 — Rows, Types, and Serialisation](05-rows-and-types.md) | **Next:** [Chapter 7 — B-Tree Indexes](07-btree.md)
