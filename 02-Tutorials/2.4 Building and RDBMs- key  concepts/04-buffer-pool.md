# Chapter 4: The Buffer Pool

A database that reads from disk on every access would be unusably slow. Even with an SSD, a random page read takes microseconds — orders of magnitude slower than accessing a cache line in L1. The buffer pool solves this by keeping a pool of frequently accessed pages in RAM, fetching from disk only on a cache miss.

---

## The problem: disk is slow, RAM is limited

A page that has been read into memory should stay there as long as possible. But RAM is finite — a production database might have terabytes of data but only hundreds of gigabytes of RAM. When the pool is full and a new page must be loaded, something already in the pool must be evicted.

Which page should be evicted? Ideally, the one that will not be needed again for the longest time — the optimal algorithm (Bélády's algorithm). But we cannot see the future.

In practice, databases use a **recency heuristic**: the page that was used *least recently* is probably the one needed *least urgently*. This is the **Least Recently Used (LRU)** eviction policy. It is simple, well-understood, and works well for most access patterns.

---

## Theory: the buffer pool architecture

### Frames and the page table

The buffer pool maintains a fixed array of **frames**. Each frame is a slot that can hold exactly one page's worth of data plus metadata:

```
frames:
  [ frame 0 ] page_id=5,  pin_count=0, is_dirty=true
  [ frame 1 ] page_id=17, pin_count=2, is_dirty=false
  [ frame 2 ] page_id=—,  (free)
  ...
```

A **page table** (`HashMap<page_id, frame_index>`) maps logical page ids to the frame currently holding them. A cache hit is an O(1) lookup.

### The pin/unpin protocol

A caller that needs a page *pins* it — increments its pin count. Pinned pages may not be evicted, because the caller is actively using the underlying bytes. When done, the caller *unpins* the page. Only when `pin_count == 0` can a page be selected for eviction.

This is analogous to reference counting, but without automatic collection — the caller is responsible for calling `unpin`. Forgetting to unpin causes pool exhaustion (all frames pinned, nothing can be evicted). Over-aggressive unpinning (unpinning before you're done) is a bug but doesn't corrupt memory — the page just might not be in the same frame the next time you ask for it.

### The LRU list

When a frame is unpinned, it is placed at the MRU (most recently used) end of a doubly linked list. The LRU end holds the frames that have been idle longest. When eviction is needed, we scan from the LRU end and pick the first unpinned frame.

### Dirty pages

If a caller modified the page bytes, it passes `is_dirty = true` to `unpin`. The buffer pool sets the frame's dirty flag. When the frame is evicted, the pool writes the dirty page to disk before reusing the frame. Clean pages are simply discarded.

A page that is written to disk without first being recorded in the WAL could leave the database in an inconsistent state after a crash. The rule — **no dirty page may be flushed before its WAL record is flushed** — is called the **WAL protocol**. The current buffer pool does not enforce this ordering; the correct enforcement is added in Part II when the WAL is wired into the executor (Chapter 14).

---

## Code walkthrough

### The `Frame` struct

```rust
// source/src/buffer_pool.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-04

pub struct Frame {
    pub page: Page,
    pub page_id: Option<u32>,
    pub pin_count: u32,
    pub is_dirty: bool,
}
```

`page_id` is `Option<u32>` because a newly allocated frame hasn't been assigned to any page yet.

### The `BufferPool` struct

```rust
pub struct BufferPool {
    frames: Vec<Frame>,
    page_table: HashMap<u32, usize>,
    free_list: Vec<usize>,
    lru_list: Vec<usize>,
    pub disk: DiskManager,
}
```

- `free_list` — frames that have never been used; prefer these over eviction.
- `lru_list` — indices of unpinned frames in recency order; front = least recently used.

### `fetch_page` — the cache lookup

```rust
pub fn fetch_page(&mut self, page_id: u32) -> io::Result<usize> {
    // Cache hit
    if let Some(&fi) = self.page_table.get(&page_id) {
        self.frames[fi].pin_count += 1;
        self.lru_list.retain(|&x| x != fi); // remove from LRU list while pinned
        return Ok(fi);
    }
    // Cache miss — evict and load
    let fi = self.evict()?;
    self.disk.read_page(page_id, &mut self.frames[fi].page)?;
    self.frames[fi].page_id = Some(page_id);
    self.frames[fi].pin_count = 1;
    self.frames[fi].is_dirty = false;
    self.page_table.insert(page_id, fi);
    Ok(fi)
}
```

The return value is a frame index, not a reference. This is the borrow-checker dance described in Chapter 2: returning a frame index lets the caller then call `bp.page_mut(fi)` and `bp.unpin(page_id, dirty)` without conflicting borrows.

### `new_page` — allocating a fresh page

```rust
pub fn new_page(&mut self) -> io::Result<(u32, usize)> {
    let page_id = self.disk.allocate_page();
    let fi = self.evict()?;
    self.frames[fi].page.clear();
    self.frames[fi].page_id = Some(page_id);
    self.frames[fi].pin_count = 1;
    self.frames[fi].is_dirty = true;
    self.page_table.insert(page_id, fi);
    Ok((page_id, fi))
}
```

A new page starts dirty — it will need to be written to disk at some point, even though nothing has touched it yet. This ensures the page slot is reserved on disk once the frame is evicted.

### `unpin` — releasing a page

```rust
pub fn unpin(&mut self, page_id: u32, is_dirty: bool) {
    if let Some(&fi) = self.page_table.get(&page_id) {
        if self.frames[fi].pin_count > 0 {
            self.frames[fi].pin_count -= 1;
        }
        if is_dirty {
            self.frames[fi].is_dirty = true;
        }
        if self.frames[fi].pin_count == 0 {
            self.lru_list.retain(|&x| x != fi);
            self.lru_list.push(fi); // MRU end
        }
    }
}
```

Once `pin_count` drops to zero, the frame is eligible for eviction and is added to the MRU end of the LRU list.

### `evict` — the heart of the pool

```rust
fn evict(&mut self) -> io::Result<usize> {
    // 1. Prefer a frame from the free list (no I/O needed).
    if let Some(fi) = self.free_list.pop() {
        return Ok(fi);
    }
    // 2. Find the least recently used unpinned frame.
    let pos = self.lru_list.iter()
        .position(|&fi| self.frames[fi].pin_count == 0);
    let pos = pos.ok_or_else(|| {
        io::Error::new(io::ErrorKind::Other, "buffer pool full: all pages pinned")
    })?;
    let fi = self.lru_list.remove(pos);

    // 3. Flush to disk if dirty.
    let frame = &mut self.frames[fi];
    if frame.is_dirty {
        if let Some(old_id) = frame.page_id {
            self.disk.write_page(old_id, &frame.page)?;
        }
        frame.is_dirty = false;
    }

    // 4. Remove from page table.
    if let Some(old_id) = frame.page_id.take() {
        self.page_table.remove(&old_id);
    }
    Ok(fi)
}
```

The free list is drained first — evicting a page that has live data requires a disk write, which we avoid as long as there are truly free frames.

> **Rust note:** The lines `let frame = &mut self.frames[fi];` and then `self.disk.write_page(...)` look like they would conflict — two borrows of `self`. They don't. Rust's borrow checker performs *field-level analysis*: `frames` and `disk` are distinct struct fields, so borrowing one does not prevent accessing the other. This is Rust's *split borrow* feature at work.

---

## Limitations of RustDB's buffer pool

RustDB's implementation favours clarity over performance. A production pool would differ in several ways:

| Aspect | RustDB | Production |
|--------|--------|------------|
| Data structure | `Vec` with linear scan | Clock sweep or LRU-K with O(1) eviction |
| Locking | None (single-threaded) | Per-frame latches, page-level locking |
| Pre-fetching | None | Sequential scan hints, read-ahead |
| Eviction policy | LRU | Adaptive replacement (ARC) in some systems |
| WAL check | None | WAL record always flushed before dirty page |

---

## Try it yourself

Add this test inside a `#[cfg(test)]` block in `buffer_pool.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::disk_manager::DiskManager;

    #[test]
    fn fetch_and_unpin() {
        let path = "/tmp/rustdb_bp_test.db";
        let _ = std::fs::remove_file(path);
        let dm = DiskManager::new(path).unwrap();
        let mut bp = BufferPool::new(4, dm);

        // Allocate two pages.
        let (p0, fi0) = bp.new_page().unwrap();
        bp.page_mut(fi0).data[0] = 42;
        bp.unpin(p0, true);

        let (p1, _fi1) = bp.new_page().unwrap();
        bp.unpin(p1, false);

        // Fetch page 0 back and verify the byte we wrote.
        let fi = bp.fetch_page(p0).unwrap();
        assert_eq!(bp.page(fi).data[0], 42);
        bp.unpin(p0, false);

        bp.flush_all().unwrap();
        std::fs::remove_file(path).unwrap();
    }
}
```

The next two tests cover a persistence guarantee and the pool-full error path.

`test_flush_all_persists` opens a fresh pool, writes a sentinel byte to page 0, calls `flush_all`, drops the pool, then opens the file again from scratch through a second `DiskManager` and asserts the byte survived — confirming that `flush_all` actually reaches disk:

```rust
#[test]
fn test_flush_all_persists() {
    use crate::disk_manager::DiskManager;
    let path = "/tmp/rustdb_ch04_flush.db";
    let _ = std::fs::remove_file(path);
    {
        let dm = DiskManager::new(path).unwrap();
        let mut bp = BufferPool::new(4, dm);
        let (pid, fi) = bp.new_page().unwrap();
        bp.page_mut(fi).data[0] = 0xAB;
        bp.unpin(pid, true);
        bp.flush_all().unwrap();
    }
    let dm2 = DiskManager::new(path).unwrap();
    let mut bp2 = BufferPool::new(4, dm2);
    let fi = bp2.fetch_page(0).unwrap();
    assert_eq!(bp2.page(fi).data[0], 0xAB);
    std::fs::remove_file(path).unwrap();
}
```

`test_pool_exhaustion_error` creates a 2-frame pool, pins both frames, then verifies that fetching a page that is already resident still succeeds (no eviction needed) — exercising the fast-path through `page_table`:

```rust
#[test]
fn test_pool_exhaustion_error() {
    use crate::disk_manager::DiskManager;
    let path = "/tmp/rustdb_ch04_exhaust.db";
    let _ = std::fs::remove_file(path);
    let dm = DiskManager::new(path).unwrap();
    let mut bp = BufferPool::new(2, dm);
    let (p0, _fi0) = bp.new_page().unwrap();
    let (p1, _fi1) = bp.new_page().unwrap();
    // p0 is already in the pool — fetching it must succeed even though both frames are pinned.
    let result = bp.fetch_page(p0);
    assert!(result.is_ok());
    let _ = p1;
    std::fs::remove_file(path).unwrap();
}
```

---

## Key takeaways

- The buffer pool is the single most important performance component in a database. Almost everything else depends on it.
- Pin/unpin is a lightweight form of reference counting enforced by convention, not the type system.
- Dirty pages are always written to disk on eviction — the pool never silently discards modified data.
- The LRU list is maintained lazily: pages are only added to it when their pin count drops to zero.

---

**← Previous:** [Chapter 3 — Storing Data: Pages and the Disk Manager](03-pages-and-disk.md) | **Next:** [Chapter 5 — Rows, Types, and Serialisation](05-rows-and-types.md)
