# Chapter 8: Advanced Topics

This post outlines extensions beyond our simple collectors. These ideas appear in production runtimes like the JVM, V8, and Go.

## Incremental GC

**Problem**: Mark-sweep pauses scale with the live set. On large heaps, collection can stall the mutator for hundreds of milliseconds.

**Idea**: Interleave collection work with mutator execution. Do a small amount of marking per allocation or time slice.

**Mechanisms**:

- **Write barrier**: When the mutator stores a pointer, we may need to record it so the incremental mark phase doesn't miss it. Common styles: Dijkstra (black→white stores), Steele (black→black, gray→white), or hybrid.
- **Tri-color marking**: Objects are white (unvisited), gray (visited, children not yet processed), or black (fully processed). The barrier ensures we never "lose" a pointer from black to white—any such store either grays the target or records it for later.

**Trade-off**: Shorter, more frequent pauses, but extra overhead (barrier on every pointer store) and more complex correctness reasoning.

## Concurrent GC

**Problem**: Even incremental GC pauses the mutator during some phases (e.g., root scanning, finalization).

**Idea**: Run the collector on a separate thread (or threads) alongside the mutator.

**Challenges**:

- **Consistency**: The mutator allocates, stores pointers, and uses objects while the collector traverses. We need synchronization (read/write barriers) so the collector sees a consistent view of the heap.
- **Memory management**: Allocation during concurrent sweep; handling objects that become garbage mid-collection.

**Examples**: ZGC (mostly concurrent), G1 (concurrent mark), Go (concurrent mark-sweep).

## Region-Based GC (G1, ZGC)

**Idea**: Divide the heap into regions. Track liveness per region. Reclaim or evacuate entire regions instead of individual objects.

**Benefits**:

- **Bounded pause**: Evacuate a bounded number of regions per pause.
- **Flexibility**: Mix copying (evacuation) with mark-sweep for different regions.
- **Concurrency**: Mark regions concurrently; compact in small steps.

## Remembered Sets and Write Barriers

In a generational GC, the old generation can hold pointers into the nursery. When we collect the nursery, we must find these **inter-generational pointers** without scanning the entire old generation.

**Remembered set**: A per-region or per-generation structure recording where such pointers live. When we collect the nursery, we treat the remembered set as extra roots.

**Write barrier**: When storing a pointer from old → young, we add the store location to the remembered set. This is the "write" part of the barrier; the "read" part (if any) handles concurrent access.

Our copying GC assumes roots are the only way to reach nursery objects. A production generational GC would add a write barrier and remembered set for old→young pointers.

## LLVM Statepoints and Stack Maps

For **precise** GC (knowing exactly which stack slots and registers hold pointers), we need metadata.

- **Stack map**: At each safepoint (potential GC point), record which slots and registers contain GC references.
- **LLVM `gc.statepoint`**: Intrinsic representing a safepoint. The backend emits a stack map.
- **GC plugin**: Custom LLVM pass that interprets the stack map and enumerates roots during collection.

Our implementations use **explicit roots** (`gc_add_root` / `gc_remove_root`), which is simpler but requires the compiler to emit those calls at scope boundaries. Statepoints allow the runtime to find roots automatically from stack maps.

## Bounded Pause: Metronome, ZGC

**Metronome-style**: Fixed time slice per GC increment; mutator runs between slices. Pauses are bounded by the slice size.

**ZGC**: Uses load barriers and colored pointers to allow very low-pause concurrent compaction. No stop-the-world pause for marking or relocation in the common case. Suitable for heaps in the terabyte range.

## Further Reading

- *The Garbage Collection Handbook* (Jones et al.) — comprehensive reference
- *A Unified Theory of Garbage Collection* (Bacon et al.) — unifying view of tracing and reference counting
- LLVM: [Statepoints](https://llvm.org/docs/Statepoints.html), [Garbage Collection](https://llvm.org/docs/GarbageCollection.html)
- V8 blog, JVM GC tuning guides

---

Next: [Appendix — Source and Repositories](09-appendix.md).
