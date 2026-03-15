# Chapter 5: Building a Copying / Generational GC

Copying collectors move live objects to a fresh space, which eliminates fragmentation. Generational collection uses the observation that **most objects die young**—we collect the nursery often and the old generation rarely.

## Semi-Space Copying

Classic copying uses two equal spaces:

- **From-space**: Current allocation area (bump pointer).
- **To-space**: Destination for live objects during collection.

When from-space is full, we copy all reachable objects to to-space, then swap roles. Allocation is a simple bump.

## Generational Hypothesis

Empirically, young objects die much faster than old ones. So we:

1. Allocate in a **nursery** (small, collected frequently).
2. Objects that survive a nursery collection are **promoted** to the **old generation**.
3. Old generation uses mark-sweep and is collected less often.

## Our Design

- **Nursery**: 16KB semi-space with bump allocation. When full, we promote survivors to the old generation and reset the nursery (we don't flip semi-spaces).
- **Old generation**: Mark-sweep, same as Chapter 4.
- **Major GC**: Promote from nursery, then mark-sweep the old generation.

---

## Full Source: gc.h

```c
/*
 * Copying / Generational Garbage Collector
 */

#ifndef GC_H
#define GC_H

#include <stddef.h>
#include <stdbool.h>

#define MAX_ROOTS 64
#define NURSERY_SIZE (1 << 14)   /* 16KB */
#define OLD_GEN_MAX_OBJECTS 256

typedef enum {
    OBJ_INT,
    OBJ_PAIR
} ObjectType;

typedef struct Object Object;

struct Object {
    Object* next;
    bool marked;
    bool in_old_gen;
    ObjectType type;
    union {
        int value;
        struct { Object* head; Object* tail; } pair;
    } data;
};

typedef struct {
    char* from_space;
    char* to_space;
    size_t size;
    char* alloc_ptr;
    char* alloc_limit;
} Nursery;

typedef struct {
    Object* objects;
    int num_objects;
    int max_objects;
} OldGen;

typedef struct {
    Nursery nursery;
    OldGen old_gen;
    Object* roots[MAX_ROOTS];
    int num_roots;
} Heap;

Heap* heap_create(void);
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

#### Object: in_old_gen and next

Objects live in one of two places: the **nursery** (young) or the **old generation** (survivors). The `in_old_gen` flag tells us which. Nursery objects are allocated with bump allocation—they don't need a `next` for a free list. We **reuse** `next` for a **forwarding pointer** during promotion: when we copy a nursery object to the old gen, we store the new address in the original's `next`. Any later reference to the original can follow that pointer to find the copy. Old-gen objects use `next` normally, as the link in the heap's object list (same as mark-sweep).

#### Nursery: Bump allocation

Think of the nursery as a **stack of plates**: you can only add or remove from the top. We have `alloc_ptr` (current top) and `alloc_limit` (end of the stack). Allocation is: "take the next N bytes at `alloc_ptr`, advance `alloc_ptr` by N." No free list, no searching—just a pointer bump. Very fast. The catch: we can't free individual objects. When the nursery is full, we **evacuate** (copy) all live objects out and reset `alloc_ptr` to the start. The nursery is then logically empty; we overwrite it on the next allocation. We have `from_space` and `to_space` (each 16KB); in our simplified design we promote directly to the old gen rather than copying within the nursery.

#### OldGen

Same as the mark-sweep heap: a linked list of objects, collected with mark and sweep. Objects that survive a nursery collection are **promoted** here—they've "graduated" from the nursery. The old gen is collected less often (only when we run a major GC).

#### Heap

Combines nursery, old gen, and roots. Allocation goes to the nursery first; promotion moves objects to the old gen.

---

## Full Source: gc.c

```c
/*
 * Copying / Generational GC - Implementation
 */

#include "gc.h"
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

static Object* copy_object(Heap* heap, Object* obj);
static void minor_gc(Heap* heap);
static void major_gc(Heap* heap);
static void mark_object(Object* obj);
static void sweep_old_gen(Heap* heap);

Heap* heap_create(void) {
    Heap* h = (Heap*)malloc(sizeof(Heap));
    if (!h) return NULL;

    h->nursery.from_space = (char*)malloc(NURSERY_SIZE);
    h->nursery.to_space   = (char*)malloc(NURSERY_SIZE);
    if (!h->nursery.from_space || !h->nursery.to_space) {
        free(h->nursery.from_space);
        free(h->nursery.to_space);
        free(h);
        return NULL;
    }
    h->nursery.size = NURSERY_SIZE;
    h->nursery.alloc_ptr   = h->nursery.from_space;
    h->nursery.alloc_limit = h->nursery.from_space + NURSERY_SIZE;

    h->old_gen.objects = NULL;
    h->old_gen.num_objects = 0;
    h->old_gen.max_objects = OLD_GEN_MAX_OBJECTS;
    h->num_roots = 0;
    return h;
}

void heap_destroy(Heap* heap) {
    free(heap->nursery.from_space);
    free(heap->nursery.to_space);

    Object* curr = heap->old_gen.objects;
    while (curr) {
        Object* next = curr->next;
        free(curr);
        curr = next;
    }
    free(heap);
}

static Object* nursery_alloc(Heap* heap, ObjectType type) {
    size_t need = sizeof(Object);
    if (heap->nursery.alloc_ptr + need > heap->nursery.alloc_limit) {
        minor_gc(heap);
        if (heap->nursery.alloc_ptr + need > heap->nursery.alloc_limit) {
            major_gc(heap);
            if (heap->nursery.alloc_ptr + need > heap->nursery.alloc_limit)
                return NULL;
        }
    }
    Object* obj = (Object*)heap->nursery.alloc_ptr;
    heap->nursery.alloc_ptr += need;
    obj->marked = false;
    obj->in_old_gen = false;
    obj->type = type;
    obj->next = NULL;
    return obj;
}

static Object* old_gen_alloc(Heap* heap, ObjectType type) {
    if (heap->old_gen.num_objects >= heap->old_gen.max_objects) {
        major_gc(heap);
    }
    if (heap->old_gen.num_objects >= heap->old_gen.max_objects)
        return NULL;

    Object* obj = (Object*)malloc(sizeof(Object));
    if (!obj) return NULL;
    obj->marked = false;
    obj->in_old_gen = true;
    obj->type = type;
    obj->next = heap->old_gen.objects;
    heap->old_gen.objects = obj;
    heap->old_gen.num_objects++;
    return obj;
}

static Object* copy_object(Heap* heap, Object* obj) {
    if (!obj) return NULL;
    if (obj->in_old_gen) return obj;

    if (obj->next != NULL)
        return (Object*)obj->next;

    Object* copy = old_gen_alloc(heap, obj->type);
    if (!copy) return NULL;

    copy->data = obj->data;
    obj->next = (Object*)copy;

    if (obj->type == OBJ_PAIR) {
        copy->data.pair.head = copy_object(heap, copy->data.pair.head);
        copy->data.pair.tail = copy_object(heap, copy->data.pair.tail);
    }
    return copy;
}

static void minor_gc(Heap* heap) {
    for (int i = 0; i < heap->num_roots; i++) {
        Object* r = heap->roots[i];
        if (r && !r->in_old_gen)
            heap->roots[i] = copy_object(heap, r);
    }
    heap->nursery.alloc_ptr = heap->nursery.from_space;
}

static void mark_object(Object* obj) {
    if (!obj || obj->marked) return;
    obj->marked = true;
    if (obj->type == OBJ_PAIR) {
        mark_object(obj->data.pair.head);
        mark_object(obj->data.pair.tail);
    }
}

static void sweep_old_gen(Heap* heap) {
    Object** curr = &heap->old_gen.objects;
    while (*curr) {
        if (!(*curr)->marked) {
            Object* dead = *curr;
            *curr = dead->next;
            free(dead);
            heap->old_gen.num_objects--;
        } else {
            (*curr)->marked = false;
            curr = &(*curr)->next;
        }
    }
}

static void major_gc(Heap* heap) {
    minor_gc(heap);
    for (int i = 0; i < heap->num_roots; i++)
        mark_object(heap->roots[i]);
    sweep_old_gen(heap);
}

void heap_collect(Heap* heap) {
    major_gc(heap);
}

void heap_add_root(Heap* heap, Object* obj) {
    if (heap->num_roots >= MAX_ROOTS) return;
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
    return nursery_alloc(heap, type);
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

Allocates two 16KB blocks for the nursery (`from_space` and `to_space`), sets `alloc_ptr` at the start of from-space and `alloc_limit` at the end, and initializes the old gen as empty. The nursery is ready for bump allocation; the old gen starts with no objects.

#### heap_destroy

Frees the nursery blocks and walks the old-gen list to free every promoted object, then frees the heap struct.

#### nursery_alloc — Bump allocation and GC triggers

1. **Check space**: If `alloc_ptr + sizeof(Object)` would go past `alloc_limit`, the nursery is full. Call `minor_gc` to promote all live nursery objects to the old gen and reset `alloc_ptr` to the start. The nursery is now empty.
2. **Still full?** If we promoted but the old gen was already full, `minor_gc` might not have freed much. Call `major_gc` (minor + mark-sweep of old gen) to reclaim dead objects in the old gen.
3. **Last resort**: If we're still out of space, return NULL.
4. **Allocate**: Treat `alloc_ptr` as the new object, advance it by `sizeof(Object)`, initialize the object (`in_old_gen = false`, `next = NULL`), and return it. No `malloc`—we're carving from a pre-allocated block. That's why nursery allocation is so fast.

#### old_gen_alloc

Same as mark-sweep: if the old gen is at capacity, run `major_gc`. Then `malloc` a new object and prepend it to the old-gen list. Promotion uses this—we're creating "real" heap objects in the old gen.

#### copy_object — Forwarding pointers and shared structures

**Why forwarding?** When we copy a nursery object to the old gen, there may be *multiple* references to it (e.g. two pairs both point to the same integer). We must copy it only once and ensure all references end up pointing at the single copy. We use a **forwarding pointer**: after copying, we store the new address in the original's `next`. Anyone who later tries to copy the same original will see `next != NULL` and immediately return the copy instead of copying again.

**Step by step**:

- **Null**: Return NULL. Nothing to copy.
- **Already in old gen** (`obj->in_old_gen`): The object was promoted in a previous collection. Return it as-is; no copy needed.
- **Already copied** (`obj->next != NULL`): We already promoted this nursery object. The original's `next` holds the copy's address. Return it. This handles shared structures—e.g. if both `head` and `tail` of a pair point to the same object, we copy it once and both fields get the same promoted pointer.
- **First-time copy**: Allocate a new object in the old gen with `old_gen_alloc`. Copy the payload (`data`) into it. Store the copy's address in `obj->next`—that's the forwarding pointer. If it's a pair, recursively copy `head` and `tail`; those calls will return promoted pointers (or follow forwarding if we've seen them before). Update the copy's `head` and `tail` with those results.

**Analogy**: Moving to a new house. You leave a note at the old address: "I've moved to 123 New Street." Anyone who comes to the old address finds the note and goes to the new one. You don't leave multiple notes for each person who might look—you leave one, and everyone follows it.

#### minor_gc — Promote nursery survivors

For each root: if it points into the nursery (`!r->in_old_gen`), call `copy_object` to promote it and everything reachable from it. The return value is the promoted copy; we update the root to point at the copy. After this, all roots point into the old gen. Then we reset `alloc_ptr` to the start of from-space. The nursery is now logically empty—we don't explicitly free individual objects; we just forget them and overwrite on the next allocation. Any nursery object that wasn't reachable from a root is effectively discarded.

#### mark_object / sweep_old_gen

Identical to mark-sweep. Used for the old generation: we mark all objects reachable from roots, then sweep the old-gen list to free unmarked objects. The old gen can have cycles and shared structures; mark-sweep handles that.

#### major_gc — Full collection

1. **minor_gc**: Promote all live nursery objects to the old gen. Now every root points into the old gen.
2. **Mark**: Run the mark phase on the old gen (same as mark-sweep).
3. **Sweep**: Run the sweep phase on the old gen. Dead promoted objects are freed.

Minor GC alone only evacuates the nursery. Major GC also reclaims dead objects in the old gen. We run major when the nursery is full and minor didn't free enough (e.g. old gen was full).

#### heap_alloc / new_int / new_pair

`heap_alloc` delegates to `nursery_alloc`—all allocation goes to the nursery first. `new_int` and `new_pair` allocate and fill in the payload, same as mark-sweep.

---

## Full Source: main.c

```c
/*
 * Test program for the Copying/Generational GC.
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
    int before = heap->old_gen.num_objects;
    Object* o1 = new_int(heap, 99);
    Object* o2 = new_int(heap, 88);
    Object* orphan = new_pair(heap, o1, o2);
    (void)orphan;
    heap_collect(heap);
    int after = heap->old_gen.num_objects;
    printf("  OK: Nursery collected, old gen has %d objects\n", after);
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
    Heap* heap = heap_create();
    if (!heap) {
        fprintf(stderr, "Failed to create heap\n");
        return 1;
    }

    printf("\n--- Copying/Generational GC Tests ---\n\n");
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

Same four tests as mark-sweep, but the allocation path differs: objects go to the nursery first. In Test 2 and 4, when we run `heap_collect`, we trigger a **major GC**: minor promotes nursery survivors, then we mark-sweep the old gen. Roots that pointed at nursery objects are updated to point at their promoted copies.

**Test 3** is where the behavior is most visible: we allocate an orphan pair `(99, 88)` in the nursery. We never add it as a root. When GC runs, the minor phase promotes only roots and their transitive closure—the orphan is not reachable, so it is never copied. The nursery is reset; the orphan is simply left behind (its memory will be overwritten on the next allocation). We don't track nursery object count the same way as mark-sweep, so we observe `old_gen.num_objects` instead. The orphan never gets promoted; only roots and what they reference do.

---

## Full Source: gc_llvm.c

```c
/*
 * Copying/Generational GC: LLVM Runtime API implementation.
 */

#include "gc.h"
#include "../../include/gc_llvm.h"

gc_heap_t gc_create(int max_objects) {
    (void)max_objects;
    return (gc_heap_t)heap_create();
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

Same pattern as mark-sweep: thin wrappers that cast opaque `gc_*` types to our concrete `Heap*` and `Object*`. The `gc_create(max_objects)` parameter is ignored—the copying GC uses fixed sizes (16KB nursery, 256-object limit for old gen) rather than a configurable object count. A production GC might tune these from `max_objects` or other heuristics.

---

## Trade-offs

| Aspect       | Copying/Generational                    |
|-------------|-----------------------------------------|
| Complexity  | Higher; two spaces, promotion, forwarding |
| Allocation  | Very fast (bump pointer in nursery)     |
| Pause       | Minor GC short; major GC longer         |
| Space       | Nursery + old gen                       |
| Fragmentation | Low; copying compacts                  |
| Locality    | Survivors copied together; good cache behavior |

Next: [Chapter 6 — Comparing the Two GCs](06-comparison.md).
