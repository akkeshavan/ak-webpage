# Chapter 3: Foundations — Memory and the Need for GC

To understand garbage collection, we need a clear mental model of memory, ownership, and liveness.

## The Problem: Who Owns Memory?

In C, you allocate with `malloc` and free with `free`. The programmer must track every allocation and free it exactly once. Mistakes cause:

- **Memory leaks**: Never freeing; memory grows without bound.
- **Use-after-free**: Freeing too early; the pointer is later dereferenced.
- **Double-free**: Freeing the same block twice.

**Garbage collection** automates deallocation. The runtime determines which objects are no longer needed and reclaims them. The programmer never calls `free`.

## Heap vs Stack

Memory is typically divided into:

- **Stack**: Local variables and function call frames. Lifetime is tied to the current function; when the function returns, stack memory is reclaimed automatically. No GC needed.
- **Heap**: Dynamic allocations. Objects can outlive the function that created them. *This* is what we manage with a GC.

The GC does not manage the stack; it only manages heap objects and must know which heap pointers the program still holds (roots).

## Roots and Reachability

The GC must answer: which heap objects are still in use?

We define:

- **Root**: A pointer the program holds directly—e.g., in a local variable, global, or register. Roots are the starting points for tracing.
- **Reachability**: An object is reachable if it is a root or reachable from a root by following pointers.

Anything unreachable is garbage and can be reclaimed.

```
  [Stack/Globals]  →  Root A  →  Object B  →  Object C
       (roots)                    (live)       (live)

  Orphan  →  Object D   (unreachable — garbage)
```

In our implementation, the programmer (or compiler) registers roots with `gc_add_root` and unregisters with `gc_remove_root`.

## Allocation Strategies

| Strategy         | How it works                               | Pros / Cons                                      |
|------------------|--------------------------------------------|--------------------------------------------------|
| **Bump allocator** | Move a pointer forward on each allocation  | Very fast; no per-object metadata. Needs copying or compaction to reclaim. |
| **Free list**    | Chain of free blocks; alloc splits one     | Reuses memory. Can fragment; needs bookkeeping.  |
| **Segregated**   | Different size classes                     | Reduces fragmentation; common in production.     |

Our mark-sweep GC uses `malloc` per object (implicit free list when we `free`). Our copying GC uses a bump allocator in the nursery.

## Trace vs Reference Counting

| Approach              | How it works                            | Trade-offs                                    |
|-----------------------|-----------------------------------------|-----------------------------------------------|
| **Tracing GC**        | Start from roots; traverse and mark     | Handles cycles. Pauses for collection.        |
| **Reference counting**| Each object has a count; free when 0    | No trace phase. Breaks on cycles; overhead on every store. |

We build **tracing** collectors. They handle cyclic data and are the basis of most language runtimes (JVM, Go, V8).

## Object Layout in Detail

Every GC object needs a header. Ours has:

- **`next`**: Used to chain objects. In mark-sweep, we maintain a linked list of all objects for the sweep phase. In copying GC, `next` is reused for forwarding pointers.
- **`marked`**: Boolean. Set during the mark phase to indicate the object is reachable. Cleared after sweep for the next collection.
- **`type`**: Discriminator for the payload—either `OBJ_INT` or `OBJ_PAIR`.
- **`data`**: Union. For integers, it holds the value. For pairs, it holds `head` and `tail` pointers.

The layout is C-compatible and matches what both GC implementations expect. Integers are leaves; pairs form the edges of the object graph.

## Full Source: include/gc_llvm.h

Here is the complete LLVM runtime API again, with a walkthrough of each function:

```c
#ifndef GC_LLVM_H
#define GC_LLVM_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void* gc_heap_t;
typedef void* gc_object_t;

typedef enum {
    GC_OBJ_INT  = 0,
    GC_OBJ_PAIR = 1
} gc_obj_type_t;

gc_heap_t gc_create(int max_objects);
void gc_destroy(gc_heap_t heap);
gc_object_t gc_alloc(gc_heap_t heap, gc_obj_type_t type);
void gc_add_root(gc_heap_t heap, gc_object_t obj);
void gc_remove_root(gc_heap_t heap, gc_object_t obj);
void gc_collect(gc_heap_t heap);
gc_object_t gc_new_int(gc_heap_t heap, int value);
gc_object_t gc_new_pair(gc_heap_t heap, gc_object_t head, gc_object_t tail);

#ifdef __cplusplus
}
#endif

#endif /* GC_LLVM_H */
```

**Function-by-function**:

- `gc_create(max_objects)`: Allocates and initializes a heap. For mark-sweep, `max_objects` triggers GC when exceeded. For copying GC, it is ignored.
- `gc_destroy(heap)`: Frees the heap and all remaining objects.
- `gc_alloc(heap, type)`: Allocates an object of the given type. May trigger GC if the heap is full.
- `gc_add_root(heap, obj)`: Registers `obj` as a root. The GC will trace from it.
- `gc_remove_root(heap, obj)`: Unregisters `obj` as a root. Call when the variable goes out of scope.
- `gc_collect(heap)`: Runs a full collection.
- `gc_new_int` / `gc_new_pair`: Convenience wrappers that allocate and initialize.

A compiler targeting LLVM would emit calls to these at allocation sites, scope entries, and scope exits.

## Summary

- GC automates heap deallocation.
- Roots + reachability define liveness.
- Tracing GC handles cycles.
- Objects need headers for mark/sweep or copying.
- The LLVM API provides an abstract interface; both GCs implement it.

Next: [Chapter 4 — Building a Mark-and-Sweep GC](04-mark-sweep.md).
