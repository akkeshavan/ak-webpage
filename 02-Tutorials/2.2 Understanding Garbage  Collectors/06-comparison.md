# Chapter 6: Comparing the Two GCs

We compare the mark-and-sweep and copying/generational collectors we built and show how to use either via the LLVM API.

## Side-by-Side

| Aspect | Mark-and-Sweep | Copying/Generational |
|--------|----------------|----------------------|
| **Algorithm** | Mark reachable, sweep unmarked | Nursery: copy survivors. Old: mark-sweep |
| **Allocation** | `malloc` per object | Bump pointer (nursery); `malloc` for old gen |
| **Complexity** | Low | Higher |
| **Pause** | Stop-the-world; proportional to live set | Minor: proportional to nursery; Major: full heap |
| **Space** | No extra heap | Nursery (32KB) + old gen |
| **Fragmentation** | Can fragment | Copying compacts; low fragmentation |
| **Locality** | Objects stay where allocated | Survivors grouped; better cache behavior |
| **Throughput** | Moderate | Often higher; fast nursery allocation |

## When to Use Each

**Mark-and-Sweep** is a good fit when:

- Simplicity and small code size matter
- Pauses are acceptable
- Memory is constrained (no extra semi-space)
- Teaching or prototyping

**Copying/Generational** fits when:

- Short pauses for the common case (minor GC) are important
- Allocation throughput matters
- Extra space for the nursery is acceptable
- Building a production-style runtime (JVM, V8, Go)

## How Real Systems Combine Ideas

Modern runtimes blend these approaches:

- **JVM (G1, ZGC)**: Generational layout, concurrent/incremental mark, region-based copying
- **V8**: Generational (nursery + old); incremental mark; concurrent sweep
- **Go**: Tri-color concurrent mark; no generational; per-size-class allocation
- **OCaml**: Generational; minor = copying; major = mark-sweep

Our implementations are teaching tools; production GCs add concurrency, incremental collection, and sophisticated heuristics.

## LLVM Integration: Full Example

Both collectors implement the same `gc_llvm.h` API. You can swap backends without changing your program. Here is the full LLVM integration example:

### Full Source: examples/llvm_integration.c

```c
/*
 * Example: Using the GC runtime with LLVM-compiled code
 *
 * This simulates what a language frontend would emit when targeting LLVM.
 * The program uses the gc_* API; the same C can be compiled to LLVM IR
 * and linked with our GC runtime.
 *
 * Build with Mark-and-Sweep:
 *   make -C ../source/mark-sweep
 *   clang -I../include -c llvm_integration.c -o llvm_integration.o
 *   clang llvm_integration.o -L../source/mark-sweep -lgc_mark_sweep -o llvm_integration_ms
 *
 * Build with Copying GC:
 *   make -C ../source/copying-generational
 *   clang llvm_integration.o -L../source/copying-generational -lgc_copying -o llvm_integration_cg
 */

#include "gc_llvm.h"
#include <stdio.h>
#include <assert.h>

static void test_with_api(gc_heap_t heap) {
    gc_object_t a = gc_new_int(heap, 42);
    gc_object_t b = gc_new_int(heap, 100);
    assert(a && b);

    gc_object_t p = gc_new_pair(heap, a, b);
    assert(p);

    gc_add_root(heap, p);
    gc_collect(heap);
    /* p and its children are still live */
    gc_remove_root(heap, p);

    /* Orphan allocation - will be collected */
    (void)gc_new_pair(heap, gc_new_int(heap, 1), gc_new_int(heap, 2));
    gc_collect(heap);

    printf("LLVM integration test OK\n");
}

int main(void) {
    gc_heap_t heap = gc_create(64);
    if (!heap) {
        fprintf(stderr, "gc_create failed\n");
        return 1;
    }
    test_with_api(heap);
    gc_destroy(heap);
    return 0;
}
```

### Walkthrough

- **Opaque API**: The program never sees `Heap*` or `Object*`; it only uses `gc_heap_t` and `gc_object_t`. That keeps the interface stable across implementations.
- **Root management**: Before using `p` across a GC, we call `gc_add_root`. After we are done, we call `gc_remove_root`.
- **Orphan test**: We allocate a pair and two integers but never register them as roots. They become garbage; the next `gc_collect` reclaims them.
- **Build**: Compile this file once, then link with either `-lgc_mark_sweep` or `-lgc_copying` to choose the backend.

### Build Commands

```bash
# Using Mark-and-Sweep
clang -Iinclude -c examples/llvm_integration.c -o examples/llvm_integration.o
clang examples/llvm_integration.o -Lsource/mark-sweep -lgc_mark_sweep -o examples/llvm_integration_ms

# Using Copying/Generational
clang examples/llvm_integration.o -Lsource/copying-generational -lgc_copying -o examples/llvm_integration_cg
```

Or use the top-level Makefile:

```bash
make llvm-example
./examples/llvm_integration_ms
./examples/llvm_integration_cg
```

Next: [Chapter 7 — Concurrent Mark-and-Sweep](07-concurrent-mark-sweep.md).
