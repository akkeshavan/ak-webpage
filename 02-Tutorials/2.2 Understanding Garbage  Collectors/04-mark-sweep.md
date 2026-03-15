# Chapter 4: Building a Mark-and-Sweep GC

The mark-and-sweep algorithm is the simplest tracing garbage collector. It has two phases: **mark** (find live objects) and **sweep** (reclaim dead ones).

## Algorithm Overview

1. **Mark phase**: Starting from each root, traverse the object graph and set `marked = true` on every reachable object.
2. **Sweep phase**: Walk the list of all objects; free unmarked objects and unlink them; clear `marked` on survivors for the next collection.

```
Before GC:  roots → A → B    C, D (unreachable)
After mark: A.marked=1, B.marked=1
After sweep: C and D freed; A.marked=0, B.marked=0
```

---

## Full Source: gc.h

```c
/*
 * Mark-and-Sweep Garbage Collector
 * A simple, non-compacting stop-the-world GC.
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

typedef struct {
    Object* objects;
    int num_objects;
    int max_objects;
    Object* roots[MAX_ROOTS];
    int num_roots;
} Heap;

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

### Walkthrough of gc.h

#### MAX_ROOTS and ObjectType

We support up to 64 roots—pointers the program holds in local variables, globals, or registers. Think of roots as **anchors**: anything reachable by following pointers from an anchor is alive. A production GC would use a growable structure (e.g. a dynamic array or hash set); 64 is enough for our minimal object model.

`ObjectType` is a tag: `OBJ_INT` for leaf values, `OBJ_PAIR` for nodes that hold two references. Like a discriminated union: we need to know which "variant" we have before we can interpret `data`.

#### The Object struct

Every heap object has a **header** (metadata the GC needs) plus a **payload** (the actual data).

- **`next`**: Imagine a chain of paper clips. Each object is a clip; `next` is the link to the next clip. The heap keeps one big chain of *every object we've ever allocated*. During sweep, we walk this chain and remove dead objects. We don't need to search the heap—we have a complete inventory.

- **`marked`**: A single bit that answers "did we reach this object during the mark phase?" Initially false. After mark, it's true for every live object. During sweep we clear it so the next collection starts fresh.

- **`type`** and **`data`**: A discriminated union. For `OBJ_INT`, we use `data.value`. For `OBJ_PAIR`, we use `data.pair.head` and `data.pair.tail`. The GC only cares about following pointers, so it checks `type` and, for pairs, recursively processes `head` and `tail`.

#### The Heap struct

- **`objects`**: The head of the global object chain. New objects are **prepended**: we make the new object's `next` point at the current head, then set `objects` to the new object. That gives O(1) allocation and keeps the chain intact.

- **`num_objects`** and **`max_objects`**: We trigger GC when `num_objects >= max_objects`. It's a simple pressure check: "we've allocated a lot; maybe we can reclaim some."

- **`roots`** and **`num_roots`**: The roots array. When you call `heap_add_root(heap, obj)`, we store `obj` in `roots[num_roots]` and increment. When you call `heap_remove_root`, we remove it (by swapping with the last element for O(1) removal). Roots are the entry points for the mark phase—we start traversing the object graph from here.

---

## Full Source: gc.c

```c
/*
 * Mark-and-Sweep Garbage Collector - Implementation
 */

#include "gc.h"
#include <stdlib.h>
#include <stdio.h>

static void mark_object(Object* obj);
static void mark_phase(Heap* heap);
static void sweep_phase(Heap* heap);

Heap* heap_create(int max_objects) {
    Heap* h = (Heap*)malloc(sizeof(Heap));
    if (!h) return NULL;
    h->objects = NULL;
    h->num_objects = 0;
    h->max_objects = max_objects;
    h->num_roots = 0;
    return h;
}

void heap_destroy(Heap* heap) {
    Object* curr = heap->objects;
    while (curr) {
        Object* next = curr->next;
        free(curr);
        curr = next;
    }
    free(heap);
}

static void mark_object(Object* obj) {
    if (!obj || obj->marked) return;
    obj->marked = true;

    if (obj->type == OBJ_PAIR) {
        mark_object(obj->data.pair.head);
        mark_object(obj->data.pair.tail);
    }
}

static void mark_phase(Heap* heap) {
    for (int i = 0; i < heap->num_roots; i++) {
        mark_object(heap->roots[i]);
    }
}

static void sweep_phase(Heap* heap) {
    Object** curr = &heap->objects;
    while (*curr) {
        if (!(*curr)->marked) {
            Object* unreached = *curr;
            *curr = unreached->next;
            free(unreached);
            heap->num_objects--;
        } else {
            (*curr)->marked = false;
            curr = &(*curr)->next;
        }
    }
}

void heap_collect(Heap* heap) {
    mark_phase(heap);
    sweep_phase(heap);
}

void heap_add_root(Heap* heap, Object* obj) {
    if (heap->num_roots >= MAX_ROOTS) {
        fprintf(stderr, "Too many roots!\n");
        return;
    }
    heap->roots[heap->num_roots++] = obj;
}

void heap_remove_root(Heap* heap, Object* obj) {
    for (int i = 0; i < heap->num_roots; i++) {
        if (heap->roots[i] == obj) {
            heap->roots[i] = heap->roots[--heap->num_roots];
            return;
        }
    }
}

Object* heap_alloc(Heap* heap, ObjectType type) {
    if (heap->num_objects >= heap->max_objects) {
        heap_collect(heap);
    }
    if (heap->num_objects >= heap->max_objects) {
        return NULL;
    }

    Object* obj = (Object*)malloc(sizeof(Object));
    if (!obj) return NULL;

    obj->marked = false;
    obj->type = type;
    obj->next = heap->objects;
    heap->objects = obj;
    heap->num_objects++;
    return obj;
}

Object* new_int(Heap* heap, int value) {
    Object* obj = heap_alloc(heap, OBJ_INT);
    if (obj) obj->data.value = value;
    return obj;
}

Object* new_pair(Heap* heap, Object* head, Object* tail) {
    Object* obj = heap_alloc(heap, OBJ_PAIR);
    if (obj) {
        obj->data.pair.head = head;
        obj->data.pair.tail = tail;
    }
    return obj;
}
```

### Walkthrough of gc.c

#### heap_create

Allocates the `Heap` struct and initializes all fields to zero/NULL. No objects, no roots—an empty arena ready for allocation.

#### heap_destroy

Walks the object chain from `heap->objects` and frees each node. In a production GC we'd typically manage one or a few large blocks; here we use `malloc` per object for simplicity, so we must `free` each one.

#### mark_object — Following the object graph

Think of the object graph as a **maze of rooms** connected by doors. Each room is an object; the doors are `head` and `tail` (for pairs) or nothing (for integers). The mark phase is: "starting from the roots, explore every room we can reach and leave a chalk mark."

- **Base case 1 — `!obj`**: NULL means "no door here." Stop.
- **Base case 2 — `obj->marked`**: We've already been here. Stop. This prevents infinite recursion when the graph has **cycles** (e.g. A → B → A). It also avoids re-processing when multiple paths lead to the same object.
- **Mark**: `obj->marked = true` — leave our chalk mark.
- **Recurse**: If it's a pair, explore `head` and `tail`. This is **depth-first**: we go as deep as possible along one path before backtracking. The call stack does the backtracking for us.

**Example**: If we have `root → pair(1, pair(2, 3))`, we mark the root pair, then the `1`, then the inner pair, then `2`, then `3`. Every reachable object gets marked.

#### mark_phase

Iterates over `heap->roots` and calls `mark_object` on each. Roots are the entrances to the maze. If we don't start from every root, we might miss entire regions of the graph. After this loop, every live object has `marked == true`.

#### sweep_phase — The pointer-to-pointer trick

Sweep walks the object list and deletes unmarked objects. The tricky part: when we delete a node, we must update the pointer that *pointed* to it, or we break the chain. We use a **pointer-to-pointer** (`Object** curr`) to always know "the place that points at the current node."

- **`curr`** starts at `&heap->objects`. So `*curr` is the first node. `curr` is the "slot" that holds the pointer to the current node—either `heap->objects` or some node's `next` field.

- **When the current node is unmarked (dead)**: We want to remove it from the chain. The node after it is `unreached->next`. We set `*curr = unreached->next`—the slot now points to the next node, bypassing the dead one. Then we `free(unreached)` and decrement `num_objects`. Crucially, we *don't* advance `curr`: the slot we're editing now holds the next node, which might also be dead. We loop and check it.

- **When the current node is marked (alive)**: We clear `marked` for the next GC, then advance: `curr = &(*curr)->next`. Now `curr` points to the `next` slot of the current node, i.e. the slot that points to the following node. We move to the next iteration.

**Analogy**: Editing a chain of paper clips. `curr` is "the hand holding the clip that links to the current one." To remove a clip, you reconnect the previous link to the next clip and drop the current one. The pointer-to-pointer is that "previous link."

#### heap_collect

Simply `mark_phase(heap)` then `sweep_phase(heap)`. Order matters: we must mark before we sweep, or we'd free everything.

#### heap_add_root / heap_remove_root

`add_root` appends to the roots array. For `remove_root`, we could shift all elements down (O(n)), but we use a **swap trick**: swap the removed root with the last root, then decrement `num_roots`. Order doesn't matter for roots, so the swap is fine and gives O(1) removal.

#### heap_alloc — Allocation and GC trigger

1. **Check capacity**: If `num_objects >= max_objects`, run `heap_collect(heap)`. This is our only GC trigger—simulating "the heap is full."
2. **Recheck**: After GC, we might still be at capacity (everything was live). Then we return NULL (out of memory).
3. **Allocate**: `malloc(sizeof(Object))`, initialize `marked=false`, `type`, and `next = heap->objects`.
4. **Prepend**: Set `heap->objects = obj` and increment `num_objects`. The new object is now the head of the chain. Prepend is O(1) and doesn't require searching for a free slot—we always allocate fresh from the system.

#### new_int / new_pair

Thin wrappers: allocate via `heap_alloc`, then fill in the payload (`value` for ints, `head`/`tail` for pairs). They keep the API clean so callers don't touch the union directly.

---

## Full Source: main.c

```c
/*
 * Test program for the Mark-and-Sweep GC.
 */

#include "gc.h"
#include <stdio.h>
#include <assert.h>

static void test_basic_allocation(Heap* heap) {
    printf("Test 1: Basic allocation\n");
    Object* a = new_int(heap, 42);
    Object* b = new_int(heap, 100);
    assert(a && b);
    assert(a->type == OBJ_INT && a->data.value == 42);
    assert(b->type == OBJ_INT && b->data.value == 100);
    printf("  OK: Allocated two integers\n");
}

static void test_pair_and_roots(Heap* heap) {
    printf("Test 2: Pairs and roots\n");
    Object* a = new_int(heap, 1);
    Object* b = new_int(heap, 2);
    Object* p = new_pair(heap, a, b);
    assert(p && p->data.pair.head == a && p->data.pair.tail == b);

    heap_add_root(heap, p);
    heap_collect(heap);
    assert(p->type == OBJ_PAIR);
    assert(p->data.pair.head->data.value == 1);
    assert(p->data.pair.tail->data.value == 2);
    printf("  OK: Pair and referenced objects preserved after GC\n");
    heap_remove_root(heap, p);
}

static void test_reclamation(Heap* heap) {
    printf("Test 3: Reclamation of unreachable objects\n");
    int before = heap->num_objects;
    Object* orphan = new_pair(heap, new_int(heap, 99), new_int(heap, 88));
    heap_collect(heap);
    int after = heap->num_objects;
    assert(after < before);
    printf("  OK: Collected %d unreachable objects\n", before - after);
}

static void test_nested_structure(Heap* heap) {
    printf("Test 4: Nested pairs (list-like structure)\n");
    Object* last = new_int(heap, 3);
    Object* mid  = new_pair(heap, new_int(heap, 2), last);
    Object* list = new_pair(heap, new_int(heap, 1), mid);

    heap_add_root(heap, list);
    heap_collect(heap);

    assert(list->data.pair.head->data.value == 1);
    assert(list->data.pair.tail->data.pair.head->data.value == 2);
    assert(list->data.pair.tail->data.pair.tail->data.value == 3);
    printf("  OK: Nested structure preserved\n");
    heap_remove_root(heap, list);
}

int main(void) {
    Heap* heap = heap_create(8);
    if (!heap) {
        fprintf(stderr, "Failed to create heap\n");
        return 1;
    }

    printf("\n--- Mark-and-Sweep GC Tests ---\n\n");
    test_basic_allocation(heap);
    test_pair_and_roots(heap);
    test_reclamation(heap);
    test_nested_structure(heap);

    heap_destroy(heap);
    printf("\nAll tests passed!\n");
    return 0;
}
```

### Walkthrough of main.c

The heap is created with `max_objects = 8`—deliberately small so GC runs during the tests. In a real program you'd use a much larger threshold.

- **Test 1 — Basic allocation**: Creates two integers (42 and 100). Verifies they exist and hold the right values. No roots, no GC—just checks that allocation works. After this, the heap has 2 objects; neither is a root, but we don't run GC yet.

- **Test 2 — Pairs and roots**: Builds the structure `pair(1, 2)`—a pair whose `head` and `tail` point to two integers. We register the pair as a root with `heap_add_root(heap, p)`. Then we run `heap_collect`. During mark, we start from the root (the pair), mark it, then recursively mark the two integers. All three are live. During sweep, we free nothing (all were marked). We assert the pair's `head` and `tail` still point to the integers with values 1 and 2. Finally we call `heap_remove_root` so the pair is no longer a root—but we don't run GC again, so the objects remain allocated until the next test or program exit.

- **Test 3 — Reclamation**: We allocate a pair `(99, 88)` but never add it as a root. Nothing in the roots array points to it; it's an **orphan**. When we run GC, the mark phase never reaches it (no path from any root), so it stays unmarked. The sweep phase frees it and its two integer children. We assert `num_objects` decreased—typically by 3 (the pair plus two ints). This proves the GC actually reclaims unreachable memory.

- **Test 4 — Nested structure (transitive reachability)**: Builds a list-like structure `(1, (2, 3))`—the list [1, 2, 3] as nested pairs. We add only the outermost pair as a root. During mark, we traverse: root pair → 1, inner pair → 2, 3. All five objects are reachable *transitively* from the single root. GC preserves them. We traverse the structure and assert the values 1, 2, 3 in order. This demonstrates that reachability is transitive: if A is a root and A points to B and B points to C, then B and C are live even though only A is a root.

---

## Full Source: gc_llvm.c

```c
/*
 * Mark-and-Sweep GC: LLVM Runtime API implementation.
 */

#include "gc.h"
#include "../../include/gc_llvm.h"

gc_heap_t gc_create(int max_objects) {
    if (max_objects <= 0) max_objects = 256;
    return (gc_heap_t)heap_create(max_objects);
}

void gc_destroy(gc_heap_t heap) {
    heap_destroy((Heap*)heap);
}

gc_object_t gc_alloc(gc_heap_t heap, gc_obj_type_t type) {
    ObjectType t = (type == GC_OBJ_PAIR) ? OBJ_PAIR : OBJ_INT;
    return (gc_object_t)heap_alloc((Heap*)heap, t);
}

void gc_add_root(gc_heap_t heap, gc_object_t obj) {
    heap_add_root((Heap*)heap, (Object*)obj);
}

void gc_remove_root(gc_heap_t heap, gc_object_t obj) {
    heap_remove_root((Heap*)heap, (Object*)obj);
}

void gc_collect(gc_heap_t heap) {
    heap_collect((Heap*)heap);
}

gc_object_t gc_new_int(gc_heap_t heap, int value) {
    return (gc_object_t)new_int((Heap*)heap, value);
}

gc_object_t gc_new_pair(gc_heap_t heap, gc_object_t head, gc_object_t tail) {
    return (gc_object_t)new_pair((Heap*)heap, (Object*)head, (Object*)tail);
}
```

### Walkthrough of gc_llvm.c

The LLVM runtime API uses opaque types (`gc_heap_t`, `gc_object_t`) so that a compiler can emit calls without depending on our concrete struct layout. This file is the **adapter**: it implements the `gc_*` functions by calling our `heap_*` and `new_*` functions and casting the opaque pointers to `Heap*` and `Object*`. The same API can be implemented by the copying GC or the concurrent GC—the compiler doesn't care which is linked. This is the standard pattern for pluggable runtimes.

---

## The Boehm–Demers–Weiser (Boehm) GC

Our implementation uses **explicit root registration** (you call `heap_add_root` and `heap_remove_root`). The **Boehm GC** takes a different approach: it is a **conservative** garbage collector that works with unmodified C and C++ code.

### How Boehm Differs

- **Conservative root finding**: Instead of explicit roots, Boehm scans the stack, registers, and global data. Any word that *looks* like a heap pointer (plausible address range, alignment) is treated as a potential root.
- **No compiler support required**: You can drop the Boehm GC into an existing C/C++ program without changing the compiler or emitting root calls.
- **Trade-off**: Boehm may retain some garbage (false positives: integers that look like pointers). It avoids freeing live objects (no false negatives). Our collector is precise: roots are exact, so we never retain extra garbage.

### Same Phases, Different Roots

Both use the same high-level algorithm (mark from roots, sweep unmarked). The difference is *how roots are found*: we use explicit registration; Boehm uses conservative scanning.

### Further Reading

- [Boehm GC homepage](https://www.hboehm.info/gc/) — Project overview and documentation
- [Boehm GC on GitHub](https://github.com/ivmai/bdwgc) — Source code repository
- [Simple GC vs. Boehm GC](https://www.hboehm.info/gc/complexity.html) — Boehm’s notes on conservative vs. precise collection

---

## Trade-offs

| Aspect         | Mark-and-Sweep                    |
|----------------|-----------------------------------|
| Complexity     | Low; easy to implement            |
| Pause          | Stop-the-world; proportional to live set |
| Space          | No extra semi-space               |
| Fragmentation  | Can increase over time            |
| Compaction     | None; objects stay in place       |

Next: [Chapter 5 — Building a Copying/Generational GC](05-copying-generational.md).
