# Chapter 3: Storing Data — Pages and the Disk Manager

Everything a database does ultimately comes down to reading and writing bytes on a storage device. This chapter builds the lowest layer of RustDB: a fixed-size page abstraction and the component that moves pages between disk and memory.

---

## The cost of disk I/O

Hard disks read data by spinning a platter and sweeping a read head over it. The dominant cost is not the data transfer itself — it is the **seek time** (moving the head to the right track) plus the **rotational latency** (waiting for the right sector to spin under the head). Combined, a random I/O on a spinning disk takes around 5–10 ms. At 10 ms per access, you can do at most 100 random reads per second.

SSDs are orders of magnitude faster for random I/O, but the fundamental observation still holds: **the operating system and the hardware deal with storage in fixed-size blocks**. The OS uses its virtual memory system in pages of 4 KiB. Storage controllers read and write in sectors. A database that ignores this and performs tiny, misaligned reads will waste most of its I/O bandwidth.

This is why every major database — SQLite, PostgreSQL, InnoDB — uses a **page-based storage model**: data is organised into fixed-size chunks (pages), and the engine always reads and writes exactly one page at a time.

---

## Theory: the page abstraction

### Page size

RustDB uses a page size of 4096 bytes (4 KiB), matching the Linux kernel's virtual-memory page size. This is the most common choice in production databases. PostgreSQL's default is 8 KiB; SQLite uses 4 KiB.

The size is a compile-time constant:

```rust
pub const PAGE_SIZE: usize = 4096;
```

Changing it requires recompiling — which is why most databases make it a build-time or creation-time parameter rather than a runtime one.

### Page numbering

Pages are identified by a zero-based integer `page_id: u32`. The physical offset of a page in the database file is simply:

```
offset = page_id × PAGE_SIZE
```

This makes random access O(1): to read page 42 you seek to byte `42 × 4096 = 172032` and read 4096 bytes.

### The database file as a flat array of pages

Think of the database file as a flat array of pages:

```
File layout:
  [ page 0 | page 1 | page 2 | page 3 | ... ]
   4096 B    4096 B    4096 B    4096 B
```

The `DiskManager` is the only component that knows about this layout. Everything above it talks in terms of `page_id` and page contents.

### Page types

In a real database, pages carry a type in their header:

- **Heap pages** — store rows
- **Internal pages** — store B-Tree routing nodes
- **Leaf pages** — store B-Tree key/value pairs
- **Overflow pages** — store large values that don't fit in a heap slot
- **Free-space map pages** — track which heap pages have room

RustDB uses a simplified scheme: we embed a "next page" pointer at the start of heap pages and let B-Tree nodes live entirely in memory. **None of the page types listed above appear as explicit types in RustDB's source** — they are context for understanding why production engines are more complex. Our `Page` struct is just 4096 raw bytes; the meaning is imposed by the code that reads and writes it.

---

## Code walkthrough

### `page.rs` — the `Page` struct

```rust
// source/src/page.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-03

pub const PAGE_SIZE: usize = 4096;

#[derive(Clone)]
pub struct Page {
    pub data: Box<[u8; PAGE_SIZE]>,
}

impl Page {
    pub fn new() -> Self {
        Page {
            data: Box::new([0u8; PAGE_SIZE]),
        }
    }

    pub fn clear(&mut self) {
        self.data.iter_mut().for_each(|b| *b = 0);
    }
}
```

`Page` is nothing more than 4096 bytes wrapped in a struct. The data is heap-allocated via `Box` because a 4096-byte array on the stack would eat through the default stack size quickly when many frames are created.

`#[derive(Clone)]` lets us copy a page's bytes — useful for WAL snapshots and tests.

---

### `disk_manager.rs` — reading and writing pages

```rust
// source/src/disk_manager.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-03

pub struct DiskManager {
    file: File,
    num_pages: u32,
}
```

`DiskManager` wraps a single `std::fs::File` and tracks how many pages have been allocated.

**Opening the file:**

```rust
pub fn new(path: &str) -> io::Result<Self> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(path)?;
    let len = file.metadata()?.len();
    let num_pages = (len / PAGE_SIZE as u64) as u32;
    Ok(DiskManager { file, num_pages })
}
```

`OpenOptions` opens an existing file or creates a new one. The page count is derived from the file size — no separate metadata file is needed.

**Reading a page:**

```rust
pub fn read_page(&mut self, page_id: u32, page: &mut Page) -> io::Result<()> {
    let offset = page_id as u64 * PAGE_SIZE as u64;
    self.file.seek(SeekFrom::Start(offset))?;
    self.file.read_exact(page.data.as_mut())?;
    Ok(())
}
```

`read_exact` fills the entire buffer or returns an error — it never does a partial read. This is critical: a partially read page would contain uninitialised bytes mixed with valid data.

**Writing a page:**

```rust
pub fn write_page(&mut self, page_id: u32, page: &Page) -> io::Result<()> {
    let offset = page_id as u64 * PAGE_SIZE as u64;
    self.file.seek(SeekFrom::Start(offset))?;
    self.file.write_all(page.data.as_ref())?;
    self.file.flush()?;
    Ok(())
}
```

`flush()` pushes the bytes through the OS's write buffer to the kernel. For true durability, you would also call `file.sync_all()` (which maps to `fsync` on Linux), but we omit that here to keep I/O fast in the tutorial.

**Allocating a page:**

```rust
pub fn allocate_page(&mut self) -> u32 {
    let id = self.num_pages;
    self.num_pages += 1;
    id
}
```

This simply increments a counter. The physical bytes for the new page are not written to disk until the buffer pool flushes the corresponding dirty frame.

---

## How the pieces connect

The `DiskManager` is never called directly from application code. Only the `BufferPool` (next chapter) calls it. This separation of concerns means:

- Pages are never read twice if they are already in the cache.
- Writes are batched — dirty pages accumulate in memory and are flushed all at once.
- The rest of the engine never needs to manage file offsets.

---

## Try it yourself

Add the following test to `src/disk_manager.rs` (inside a `#[cfg(test)]` block):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::page::Page;

    #[test]
    fn test_page_roundtrip() {
        let path = "/tmp/rustdb_test.db";
        let _ = std::fs::remove_file(path);

        let mut dm = DiskManager::new(path).unwrap();
        let page_id = dm.allocate_page();

        let mut page = Page::new();
        page.data[0] = 42;
        page.data[4095] = 99;
        dm.write_page(page_id, &page).unwrap();

        let mut page2 = Page::new();
        dm.read_page(page_id, &mut page2).unwrap();

        assert_eq!(page2.data[0], 42);
        assert_eq!(page2.data[4095], 99);

        std::fs::remove_file(path).unwrap();
    }
}
```

Run with `cargo test disk_manager`. You should see `test disk_manager::tests::test_page_roundtrip ... ok`.

The test above confirms a single page round-trips correctly. The following test verifies that the `page_id × PAGE_SIZE` offset arithmetic is correct across **multiple** pages — each of the three pages must land at the right file offset and come back byte-perfect:

```rust
#[test]
fn test_multi_page_write_read() {
    // Allocate 3 pages, write distinct byte patterns to each, read back and verify.
    let path = "/tmp/rustdb_ch03_multi.db";
    let _ = std::fs::remove_file(path);
    let mut dm = DiskManager::new(path).unwrap();
    let mut pages: Vec<Page> = (0..3).map(|_| Page::new()).collect();
    for (i, pg) in pages.iter_mut().enumerate() {
        pg.data.fill(i as u8 + 1);
        let pid = dm.allocate_page();
        dm.write_page(pid, pg).unwrap();
    }
    let mut read_pg = Page::new();
    for i in 0u32..3 {
        dm.read_page(i, &mut read_pg).unwrap();
        assert!(read_pg.data.iter().all(|&b| b == i as u8 + 1));
    }
    std::fs::remove_file(path).unwrap();
}
```

Page 0 is filled with `0x01`, page 1 with `0x02`, page 2 with `0x03`. After writing, we seek to `page_id * 4096` before every read and confirm no bytes from adjacent pages bleed through.

---

## Key takeaways

- All database storage is fundamentally byte arrays. The page abstraction adds a unit and an address.
- 4096 bytes per page matches the OS page size, keeping I/O aligned and efficient.
- `page_id × PAGE_SIZE` gives the byte offset — O(1) random access with no indirection.
- The `DiskManager` is intentionally thin. Higher layers (the buffer pool) handle caching, eviction, and dirty tracking.

---

**← Previous:** [Chapter 2 — Rust for Database Development](02-rust-setup.md) | **Next:** [Chapter 4 — The Buffer Pool](04-buffer-pool.md)
