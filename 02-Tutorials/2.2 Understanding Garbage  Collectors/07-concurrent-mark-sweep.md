# Chapter 7: Concurrent Mark-and-Sweep GC

This part adds a **third** implementation: the same mark-and-sweep algorithm as in Chapter 4, but with collection running in a **dedicated GC thread**. When the mutator triggers GC (e.g. at allocation over threshold), it signals the GC thread and blocks until the thread finishes mark and sweep.

From the mutator’s point of view it is still stop-the-world (it blocks until GC is done). The difference is **who does the work**: a separate thread runs the collector, which is the first step toward fully concurrent GC.

## Why a separate GC thread?

- **Structure**: Separates “mutator” code from “collector” code; the collector runs in one place (the GC thread).
- **Preparation for concurrency**: Real concurrent GCs use one or more collector threads; this version uses one and still pauses the mutator.
- **Same algorithm**: Mark and sweep are unchanged; only the coordination (mutex, condition variables) is new.

## Design

- **Mutator thread**: Allocates, adds/removes roots, and when over threshold calls `heap_collect()` (or triggers via `heap_alloc()`).
- **GC thread**: Blocked on a condition variable. When the mutator requests GC, the mutator signals the GC thread. The GC thread runs `mark_phase` and `sweep_phase`, then signals “done.” The mutator wakes and continues.
- **Synchronization**: A mutex protects the heap. The mutator holds it for allocation and root updates. For a collection, the mutator releases the lock, signals the GC thread, and waits on “done.” The GC thread holds the lock for the whole mark and sweep.

## Full Source: gc.h

```c
/*
 * Concurrent Mark-and-Sweep Garbage Collector
 * Collection runs in a dedicated GC thread.
 */

#ifndef GC_H
#define GC_H

#include <stddef.h>
#include <stdbool.h>

#define MAX_ROOTS 64

typedef enum {
    OBJ_INT,
    OBJ_PAIR
} ObjectType;

typedef struct Object {
    struct Object* next;
    bool marked;
    ObjectType type;
    union {
        int value;
        struct { struct Object* head; struct Object* tail; } pair;
    } data;
} Object;

typedef struct Heap Heap;

struct Heap {
    Object* objects;
    int num_objects;
    int max_objects;
    Object* roots[MAX_ROOTS];
    int num_roots;
    void* gc_mutex;
    void* gc_cond_request;
    void* gc_cond_done;
    void* gc_thread;
    volatile int gc_requested;
    volatile int gc_shutdown;
};

Heap* heap_create(int max_objects);
void heap_destroy(Heap* heap);
Object* heap_alloc(Heap* heap, ObjectType type);
void heap_add_root(Heap* heap, Object* obj);
void heap_remove_root(Heap* heap, Object* obj);
void heap_collect(Heap* heap);

Object* new_int(Heap* heap, int value);
Object* new_pair(Heap* heap, Object* head, Object* tail);

#endif /* GC_H */
```

The heap keeps the same logical fields as the single-threaded mark-sweep GC, plus:

- **gc_mutex**, **gc_cond_request**, **gc_cond_done**, **gc_thread**: Opaque pointers to `pthread_mutex_t`, `pthread_cond_t`, and `pthread_t` so the header stays free of `pthread.h`.
- **gc_requested**: Set by the mutator when it wants a collection; cleared by the GC thread when mark+sweep are done.
- **gc_shutdown**: Set in `heap_destroy` so the GC thread exits.

## Full Source: gc.c (excerpts and walkthrough)

### Thread and request handling

**Analogy**: The mutator is a worker; the GC thread is a janitor. When the worker's desk (heap) gets full, they flip a "please clean" sign (`gc_requested = 1`), ring a bell (signal `gc_cond_request`), and wait. The janitor wakes, cleans (mark + sweep), flips the sign back, rings another bell (signal `gc_cond_done`), and goes back to sleep. The worker wakes and continues. The worker never cleans—they just wait for the janitor to finish.

The GC thread runs in a loop:

1. Wait on `gc_cond_request` until `gc_requested` or `gc_shutdown` is set.
2. If `gc_shutdown`, exit.
3. Run `mark_phase(heap)` and `sweep_phase(heap)` (same as Chapter 4).
4. Clear `gc_requested`, signal `gc_cond_done`, release the mutex.

The mutator’s `request_gc(heap)`:

1. Take the mutex, set `gc_requested = 1`, signal `gc_cond_request`, release the mutex (or keep it depending on design; here we signal so the GC thread can run).
2. Wait on `gc_cond_done` until `gc_requested` is 0 (with the mutex as specified below).

So collection work runs entirely in the GC thread; the mutator only blocks until that work is finished.

### request_gc and heap_alloc

`request_gc` takes the mutex, sets `gc_requested = 1`, and signals the GC thread. It then waits in a loop on `gc_cond_done` until `gc_requested` becomes 0. The loop handles **spurious wakeups** (condition variables can sometimes wake without a signal); we only exit when we know GC has finished. The GC thread clears `gc_requested` right before signaling `gc_cond_done`, so when the mutator wakes it sees the cleared flag.

`heap_collect` is a thin wrapper that calls `request_gc`. In `heap_alloc`, when we're at capacity we must not hold the heap mutex while waiting for GC (the GC thread needs it). So we release the mutex, call `request_gc` (which does its own locking), and when it returns the GC thread has run. We then take the mutex again and retry allocation—hopefully GC freed some objects.

### heap_create and heap_destroy

- **heap_create**: Allocate the heap, create mutex and two condition variables, start the GC thread with `pthread_create(gc_thread_fn, heap)`. The thread runs until `gc_shutdown` is set.
- **heap_destroy**: Set `gc_shutdown = 1`, signal `gc_cond_request`, `pthread_join` the GC thread, then destroy mutex/cond, free all objects, and free the heap.

Mark and sweep code is unchanged from Chapter 4; only the locking and thread coordination are new.

## Build and test

Requires pthreads. From the repo root:

```bash
make -C source/concurrent-mark-sweep
./source/concurrent-mark-sweep/gc_test
```

Or add the concurrent target to the top-level `Makefile` and run `make test` to run all three GC tests.

## Trade-offs

| Aspect        | Concurrent (this part)        |
|---------------|-------------------------------|
| Algorithm     | Same as Chapter 4 (mark-sweep)    |
| Threading     | One dedicated GC thread       |
| Mutator pause | Still stop-the-world; mutator blocks until GC finishes |
| Complexity    | Higher: mutex, cond vars, thread lifecycle |
| Use case      | Stepping stone to true concurrent GC; cleaner separation of mutator vs collector |

Next: [Chapter 8 — Advanced Topics](08-advanced-topics.md).
