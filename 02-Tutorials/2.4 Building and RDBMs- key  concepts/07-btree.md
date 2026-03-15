# Chapter 7: B-Tree Indexes

A full heap scan reads every row to find the ones that match a query. For a table with a million rows, that is a million deserialisation operations — even if only one row matches. An **index** solves this by pre-organising row locations by key value, so finding a row by key requires only O(log n) operations rather than O(n).

The B-Tree is the data structure that underlies nearly every database index in existence: PostgreSQL's `btree` index, InnoDB's clustered index, SQLite's table B-tree — all are B-Tree variants.

---

## Why not a binary search tree?

A balanced binary search tree (BST) like a red-black tree or AVL tree gives O(log₂ n) search. For n = 1,000,000 that is about 20 comparisons. Sounds fine — but the problem is cache efficiency.

Each node in a binary tree holds one key and two child pointers. In a typical implementation a node is 40–80 bytes. A page is 4096 bytes. One page holds about 50–100 BST nodes. To traverse 20 levels, you might load 20 different pages — 20 random disk reads.

A B-Tree solves this by being a *wide* tree. Each node holds many keys (and many children). The tree height drops dramatically, and each node fits neatly into one disk page. Traversing the tree requires loading only O(log_B n) pages, where B is the number of keys per node. For B = 100 and n = 1,000,000, that is `log₁₀₀(1,000,000) = 3` page reads.

---

## Theory: the B-Tree

### Definitions

Let `B` be the **minimum degree** (also called the order parameter). A B-Tree with minimum degree `B` satisfies:

1. Every node except the root has at least `B - 1` keys.
2. Every node has at most `2B - 1` keys.
3. An internal node with `k` keys has exactly `k + 1` children.
4. All leaf nodes are at the same depth.
5. Keys within each node are sorted in ascending order.

RustDB uses `B = 3`, so nodes hold between 2 and 5 keys. A real database would use `B` large enough to fill a page (B ≈ 100 for 8-byte keys in a 4 KiB page).

### Leaf vs. internal nodes

In RustDB's design:

- **Leaf nodes** store `(key, RowId)` pairs. `RowId` is the `(page_id, slot)` of the row in the heap.
- **Internal nodes** store only keys and child pointers. They are routing nodes — they tell the search which subtree to recurse into.

A search for key `k` descends from root to leaf, at each internal node choosing the subtree whose key range contains `k`.

### Search

```
search(node, k):
  i = first index where node.keys[i] >= k
  if node.is_leaf:
    if node.keys[i] == k: return node.values[i]
    else: return NOT FOUND
  else:
    recurse into node.children[i]
```

Height is O(log_B n), so search is O(log_B n) — very fast even for large n.

### Insertion (pre-emptive split)

The classic B-Tree insert splits nodes *on the way back up* when it finds a full node. A simpler, more cache-friendly approach is the **pre-emptive split** used by RustDB: when descending to insert, if we encounter a full node, we split it *before* recursing into it. This guarantees the parent always has room to absorb the promoted key without a second pass.

Split algorithm for a full node `C` with `2B - 1` keys:
1. Create a new node `R`.
2. Move the upper half of `C`'s keys to `R` (keys at indices `B..2B-1`).
3. If `C` is an internal node, move the upper half of its children to `R`.
4. Promote `C.keys[B-1]` (the median) into the parent.
5. Insert `R` as the child of the parent immediately after `C`.

After the split, `C` holds `B - 1` keys, `R` holds `B - 1` keys, and the median has moved up.

### Tree growth

A B-Tree grows upward. When the root is full and must be split, we create a new root with the old root as its only child, then split the old root. This is the only way the tree gains height, which is why all leaves remain at the same depth.

---

## Code walkthrough

### Node representation

```rust
// source/src/btree.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-07

const B: usize = 3;

struct Node {
    keys: Vec<i64>,
    values: Vec<RowId>,   // present only in leaf nodes
    children: Vec<Box<Node>>, // present only in internal nodes
    is_leaf: bool,
}
```

Using `Box<Node>` for children gives heap allocation and avoids recursive type size issues. In a disk-based B-Tree, each child would be a `page_id: u32` rather than a boxed pointer.

### Search

```rust
fn search(&self, key: i64) -> Option<RowId> {
    // partition_point returns the first index where keys[i] >= key
    let idx = self.keys.partition_point(|&k| k < key);
    if self.is_leaf {
        if idx < self.keys.len() && self.keys[idx] == key {
            Some(self.values[idx])
        } else {
            None
        }
    } else {
        self.children[idx].search(key)
    }
}
```

`partition_point` is a binary search that returns the insertion point — O(log(node size)) within each node.

### Insertion

```rust
// BTree::insert — the public entry point
pub fn insert(&mut self, key: i64, value: RowId) {
    if self.root.is_full() {
        // Grow upward: old root becomes child[0] of new root.
        let old = std::mem::replace(&mut self.root, Box::new(Node::new_internal()));
        self.root.children.push(old);
        self.root.split_child(0); // split the (now child) old root
    }
    self.root.insert_non_full(key, value);
    self.len += 1;
}
```

`insert_non_full` recurses down, splitting full nodes it encounters:

```rust
fn insert_non_full(&mut self, key: i64, value: RowId) {
    let mut i = self.keys.len();
    if self.is_leaf {
        // Maintain sorted order with a rightward shift.
        self.keys.push(0);
        self.values.push((0, 0));
        while i > 0 && self.keys[i - 1] > key {
            self.keys[i]   = self.keys[i - 1];
            self.values[i] = self.values[i - 1];
            i -= 1;
        }
        self.keys[i]   = key;
        self.values[i] = value;
    } else {
        // Walk backward to find the correct child index.
        while i > 0 && self.keys[i - 1] > key {
            i -= 1;
        }
        if self.children[i].is_full() {
            self.split_child(i);
            // split_child promoted keys[i] into this node.
            // If our key is larger than the new separator, move one right.
            if key > self.keys[i] {
                i += 1;
            }
        }
        self.children[i].insert_non_full(key, value);
    }
}
```

### Splitting a child

```rust
fn split_child(&mut self, ci: usize) {
    let mid = B - 1;
    let mut right = Box::new(if self.children[ci].is_leaf {
        Node::new_leaf()
    } else {
        Node::new_internal()
    });

    let left = &mut self.children[ci];
    let median_key = left.keys[mid];

    right.keys = left.keys.split_off(mid + 1);
    if left.is_leaf {
        right.values = left.values.split_off(mid + 1);
        left.keys.truncate(mid);
        left.values.truncate(mid);
    } else {
        left.keys.truncate(mid); // discard median from internal node
        right.children = left.children.split_off(mid + 1);
    }

    self.keys.insert(ci, median_key);
    self.children.insert(ci + 1, right);
}
```

`Vec::split_off` splits a vector at an index — elements at and beyond the index go into the new vector, elements before stay. This is exactly what we need for the split.

---

## How the index is used

The executor's `CREATE INDEX` statement builds a B-Tree by scanning the heap and inserting every `(key, RowId)` pair:

```rust
// source/src/executor.rs
for (i, row) in rows.iter().enumerate() {
    if let Value::Int(key) = &row.values[col_idx] {
        btree.insert(*key, (heap_root_page, i as u16));
    }
}
```

> **Simplification note:** `(heap_root_page, i as u16)` uses the ordinal position of the row in the scan result as the slot index, which is only correct when all rows fit on the first heap page. A production implementation would use `scan_with_ids()` (introduced in Chapter 12) to obtain the real `(page_id, slot_index)` RowId for each row.

On subsequent lookups the executor could use `btree.search(key)` to get the `RowId` directly, then fetch just that page+slot — avoiding a full scan. The current `executor.rs` always does a sequential scan for simplicity, but the index structure is correct and ready for the optimisation.

> **Important limitation:** RustDB's B-Tree stores `i64` keys only. `CREATE INDEX` silently produces an empty index if the indexed column is not `INT`. For example, `CREATE INDEX ON users (name)` will succeed but index no rows. Support for other key types would require a generic key type or an enum key — a natural extension exercise.

---

## Try it yourself

Add this test to `src/btree.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_and_search() {
        let mut tree = BTree::new();
        for i in [5, 3, 7, 1, 4, 6, 8, 2] {
            tree.insert(i, (0, i as u16));
        }
        // Every key should be findable.
        for i in 1..=8i64 {
            let rid = tree.search(i).expect("key not found");
            assert_eq!(rid.1, i as u16);
        }
        // Missing key should return None.
        assert_eq!(tree.search(99), None);
    }

    #[test]
    fn entries_are_sorted() {
        let mut tree = BTree::new();
        for i in [9, 2, 7, 4, 1, 8, 3, 6, 5] {
            tree.insert(i, (0, 0));
        }
        let entries: Vec<i64> = tree.entries().into_iter().map(|(k, _)| k).collect();
        let mut sorted = entries.clone();
        sorted.sort();
        assert_eq!(entries, sorted);
    }
}
```

Run with `cargo test btree`.

The next test triggers a **root split**. With `B = 3`, a node is full when it holds `2B - 1 = 5` keys. Inserting five sorted keys fills the root leaf. The sixth insert hits `BTree::insert`'s root-split path: the old root becomes a child of a new internal root, and `split_child(0)` promotes the median key upward. All six keys must still be searchable after the split:

```rust
#[test]
fn test_split_and_height() {
    let mut tree = BTree::new();
    let keys = vec![10i64, 20, 30, 40, 50];
    for &k in &keys {
        tree.insert(k, (0, k as u16));
    }
    // One more insert splits the root.
    tree.insert(25, (0, 25));
    for &k in &[10i64, 20, 25, 30, 40, 50] {
        assert!(tree.search(k).is_some(), "key {} should be found after split", k);
    }
    assert_eq!(tree.search(99), None);
}
```

`test_large_tree_all_keys_found` inserts 200 sequential keys and confirms every one is still reachable. With B = 3 and 200 keys, the tree grows to at least three levels and triggers dozens of splits — a good stress test of the recursive insertion and search paths:

```rust
#[test]
fn test_large_tree_all_keys_found() {
    let mut tree = BTree::new();
    let n = 200i64;
    for i in 0..n {
        tree.insert(i, (0, i as u16 % 1000));
    }
    for i in 0..n {
        assert!(tree.search(i).is_some(), "key {} missing", i);
    }
    assert_eq!(tree.search(n), None);
}
```

RustDB uses a B+-tree-style leaf split: the median key is **copied** into the parent as a routing separator while remaining in the left leaf, so every key is always findable by traversal to a leaf. Internal-node splits use the classic approach where the median moves up.

---

## Key takeaways

- A B-Tree is wide and shallow. Height ≈ log_B(n) means 2–4 page reads for typical table sizes.
- The minimum degree `B` is chosen so a node fills one disk page, minimising page loads per traversal.
- Pre-emptive splitting eliminates the need for a second upward pass after insertion.
- In RustDB the B-Tree is in-memory; moving it to disk would require serialising each node into a 4096-byte page and using `page_id` instead of `Box<Node>` pointers.

---

**← Previous:** [Chapter 6 — Tables and the System Catalog](06-catalog.md) | **Next:** [Chapter 8 — Parsing SQL](08-sql-parser.md)
