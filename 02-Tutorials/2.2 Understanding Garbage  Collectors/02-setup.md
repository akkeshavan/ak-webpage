# Chapter 2: Setup

Before building garbage collectors from scratch, we need a minimal toolchain and project structure. This series uses **C (C11)** for the implementations and is designed to integrate with the **LLVM runtime**.

## Why C?

- **Direct memory control**: A GC manages heap memory. We need to allocate objects, traverse pointers, and free memory. C gives us explicit control over layout (`sizeof`, struct packing) and allocation (`malloc`/`free`).
- **Portability**: C compiles on every platform. Our code runs with GCC, Clang, and integrates with LLVM-produced binaries.
- **LLVM integration**: The C ABI is the common interface for runtimes. LLVM-compiled code (from any language) links to C libraries without extra glue.

## Prerequisites

- **C compiler**: `gcc` or `clang` (we use C11: `-std=c11`)
- **Make**: For building
- **LLVM** (optional): For compiling to IR (`clang -S -emit-llvm`), linking, and advanced integration

On macOS with Xcode Command Line Tools:

```bash
clang --version   # Should show clang
make --version
```

## Getting the Source

The source code is in a separate repo: **[akkeshavan/gc-blog-source](https://github.com/akkeshavan/gc-blog-source)**. Clone it to get the implementations.

## Project Layout

```
gc-blog-source/
├── include/
│   └── gc_llvm.h           # LLVM runtime API
├── source/
│   ├── mark-sweep/         # GC implementation 1
│   │   ├── gc.h, gc.c
│   │   ├── gc_llvm.c
│   │   ├── main.c
│   │   └── Makefile
│   └── copying-generational/  # GC implementation 2
│       ├── gc.h, gc.c
│       ├── gc_llvm.c
│       ├── main.c
│       └── Makefile
├── examples/
│   └── llvm_integration.c
└── Makefile
```

## Build & Run

```bash
# Build both GCs
make

# Run tests
make test

# Build LLVM integration example
make llvm-example
./examples/llvm_integration_ms    # Mark-and-Sweep
./examples/llvm_integration_cg    # Copying/Generational
```

## Minimal Object Model

Both GCs share the same conceptual object model. Every object has a **header** and a **payload**:

| Field     | Purpose                                                        |
|-----------|----------------------------------------------------------------|
| `next`    | Link in the heap's object list (for sweep) or forwarding      |
| `marked`  | Reachability flag; set during mark phase                      |
| `type`    | `OBJ_INT` or `OBJ_PAIR`                                       |
| `data`    | Either an `int` value or `{head, tail}` for a pair            |

Objects form a graph: integers are leaves; pairs hold references to other objects. The GC must find all objects reachable from **roots** (stack variables, globals) and reclaim the rest.

## Test Harness

Each GC has a `main.c` that runs four tests:

1. **Basic allocation**: Create integers and pairs; verify they exist.
2. **Pairs and roots**: Register a pair as a root; run GC; verify the pair and its children are preserved.
3. **Reclamation**: Allocate an object that is never a root; run GC; verify it is collected.
4. **Nested structure**: Build a list `(1, (2, 3))`; register the list as root; run GC; traverse and verify.

These tests exercise allocation, root registration, marking, sweeping (or copying), and reclamation.

## Full Source: include/gc_llvm.h

The LLVM runtime API is defined in a single header. This is the contract that both GC implementations satisfy:

```c
/*
 * GC Runtime API for LLVM Integration
 *
 * This header defines the contract between LLVM-compiled code and the
 * garbage collector runtime. A language frontend targeting LLVM would
 * emit calls to these functions. Link your LLVM output with the
 * appropriate GC library (libgc_mark_sweep.a or libgc_copying.a).
 */

#ifndef GC_LLVM_H
#define GC_LLVM_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Opaque heap handle. Implementation-specific. */
typedef void* gc_heap_t;

/* Opaque object reference. In our implementation this is Object*. */
typedef void* gc_object_t;

/* Object type tag for allocation. Must match ObjectType in gc.h. */
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

**Walkthrough**:

- `gc_heap_t` and `gc_object_t` are opaque pointers. The caller never dereferences them; they're passed to the API.
- `gc_create` returns a heap; `gc_destroy` frees it. `max_objects` is a hint for mark-sweep; copying GC ignores it.
- `gc_alloc` allocates by type; `gc_new_int` and `gc_new_pair` are convenience wrappers.
- `gc_add_root` and `gc_remove_root` register and unregister roots. The compiler must emit these at scope entry and exit.
- `gc_collect` triggers a full collection.

The `extern "C"` block ensures C++ name mangling doesn't apply, so the symbols match when linking.

Next: [Chapter 3 — Foundations](03-foundations.md).
