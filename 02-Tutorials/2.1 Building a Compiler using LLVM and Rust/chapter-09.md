# Building a Compiler with Rust and LLVM - 9

*GC integration: Boehm GC implementation*

---

Real languages need a clear **memory story**: who allocates heap data, and who frees it. Lumina has **heap-allocated** data (records, strings, arrays). This chapter describes how the runtime works **without** a GC (malloc-based), how it works **with** the **Boehm–Demers–Weiser** garbage collector, the **architecture** of Boehm GC, and a detailed example of `Array<User>` in nested functions. The code lives in `source/part1-recursive-descent/06-gc` (hook names) and `source/part1-recursive-descent/05-runtime-stdlib` (GC implementation).

---

## Goals of this chapter

- Explain in detail how the **runtime works without a GC** (malloc-based allocation, no freeing, memory lifecycle).
- Explain in detail how the **runtime works with Boehm GC** (GC_MALLOC/GC_REALLOC, automatic reclamation).
- Describe the **architecture of Boehm GC**: mark-sweep algorithm, conservative root scanning, phases.
- Implement **Boehm GC** in the C runtime and document installation.
- Give an **extended example** of `Array<User>` in nested functions, with step-by-step allocation and collection behaviour.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **06-gc/src/lib.rs** | Constants `ALLOC`, `PUSH_ROOT`, `POP_ROOT` for future precise GC; not used with Boehm. |
| **05-runtime-stdlib** | **RUNTIME_C** uses Boehm GC: `#include <gc.h>`, `GC_MALLOC`, `GC_REALLOC`, `GC_INIT()`. |
| **09-lum-cli** | Links with **-lgc**; on macOS uses `/opt/homebrew/lib/libgc.dylib` when present. |

---

## Dependencies and installation

The **06-gc** crate has **no dependencies**. The runtime is a C string; the CLI compiles it with clang and links with **libgc**.

**macOS:** `brew install bdw-gc`  
**Linux (Debian/Ubuntu):** `sudo apt install libgc-dev`

See Section 9.4 for implementation details.

---

## 9.1 How the runtime works without a GC

Before integrating Boehm GC, the runtime used **malloc** and **realloc** for heap allocation. Understanding this baseline clarifies what changes when we add a GC.

### Allocation flow (malloc-based)

When the generated code calls `lumina_array_i64_new`, the runtime does:

1. **Allocate the array struct** with `malloc(sizeof(lumina_arr_i64))`. The struct holds `cap`, `len`, and a pointer `data` to the element buffer.
2. **Allocate the element buffer** with `malloc(cap * sizeof(int64_t))`. Store the pointer in the struct.
3. **Return the struct pointer** cast to `int64_t` (the “handle” that Lumina code uses).

For **append**, when the buffer is full:

1. **Reallocate** the buffer with `realloc(data, new_cap * sizeof(int64_t))`.
2. Update the struct’s `cap` and `data`; add the new element.

For `lumina_array_str_new` and `lumina_array_str_append`, the pattern is the same: `malloc` for the struct and its buffer, `realloc` when growing.

### Memory lifecycle: no freeing

**Nothing is ever freed.** The runtime never calls `free`. Every allocation remains valid until the process exits. The OS reclaims all process memory when the program terminates.

**Implications:**

- **Correctness:** No use-after-free; no double-free. Any pointer returned from the runtime stays valid for the program’s lifetime.
- **Long-running programs:** Memory grows without bound. A loop that allocates arrays in each iteration will leak. For short-lived programs (scripts, CLI tools), this is often acceptable.
- **Root tracking:** Irrelevant. Without a collector, there is no need to distinguish “live” from “dead” objects.

### Data flow

When a function returns an `Array<User>` or a record pointer:

1. The caller receives an integer (the pointer cast to `i64`).
2. That value may be stored in a local, passed to another function, or appended to another array.
3. All such pointers remain valid until exit. No collector scans them; no collection runs.

So **without GC**, the runtime is simple: allocate on demand, never free, rely on process exit for reclamation.

---

## 9.2 How the runtime works with Boehm GC

With Boehm GC integrated, allocation and reclamation change as follows.

### Allocation flow (GC-based)

1. **`GC_INIT()`** is called at the start of `main()` before any allocation. This initializes the collector’s internal structures.
2. **Array struct** is allocated with `GC_MALLOC` instead of `malloc`. The returned pointer is in the GC-managed heap.
3. **Element buffer** is allocated with `GC_MALLOC`.
4. **Append (resize)** uses `GC_REALLOC` instead of `realloc`. The GC may move or extend the block; it preserves the object’s identity from the collector’s perspective.
5. **No `free`** is ever called. The collector reclaims memory when objects become unreachable.

### When does collection run?

Collection is **triggered by allocation**. When `GC_MALLOC` or `GC_REALLOC` is called and the allocator cannot satisfy the request from free lists, it:

1. Runs a **mark phase**: trace from roots (stack, registers, static data) and mark all reachable objects.
2. Runs a **sweep phase**: identify unmarked objects and return them to free lists.
3. Retries the allocation. If enough memory was reclaimed, the allocation succeeds.

The collector uses heuristics (e.g. allocation rate vs. heap size) to decide when to collect rather than always expanding the heap. The key point: **collection happens inside an allocation call**, so by the time `GC_MALLOC` returns, any unreachable objects have been reclaimed (or the heap was expanded).

### Root discovery (conservative)

Boehm GC does **not** require the compiler to emit `lumina_push_root` / `lumina_pop_root`. It discovers roots **conservatively** by scanning:

- The **stack** (from current stack pointer to a known bottom).
- **Registers** (saved and scanned as part of the mark phase).
- **Static/global data**.

Any word-aligned value that looks like a pointer into the GC heap is treated as a root. So local variables holding array handles, function arguments, and return values are found automatically. No compiler cooperation is needed.

---

## 9.3 Architecture of Boehm GC

Boehm GC is a **conservative, mark-sweep** collector. This section outlines its architecture.

### Mark-sweep algorithm

The collector conceptually operates in phases (the order can vary; the description below matches the usual allocation-triggered collection):

1. **Preparation:** Clear all mark bits. Every object is initially considered unreachable.
2. **Mark phase:** Starting from **roots**, trace all reachable objects. For each root, if it points into the GC heap, mark that object and push it onto a mark stack. Repeatedly pop from the mark stack, scan the object for pointers, and mark and push any unmarked targets. Continue until the mark stack is empty.
3. **Sweep phase:** Scan the heap. Unmarked objects are unreachable; return them to free lists for reuse. Marked objects remain allocated.
4. **Finalization (optional):** Objects registered for finalization that are now unreachable are enqueued for finalizer execution.

The mark phase performs a **graph traversal** of the reachable object graph. The sweep phase **reclaims** the complement of that graph.

### Conservative root scanning

In C (and C++), the compiler does not distinguish pointers from other integer-sized values. Boehm GC therefore uses a **conservative** strategy:

- Treat **every word** in the root segments (stack, registers, static data) as a **candidate pointer**.
- If a candidate’s value falls within the address range of a known GC heap object, treat it as a **root** and mark that object.
- If it falls outside the heap or into unallocated space, ignore it (or apply black-listing; see the Boehm GC documentation).

**Consequences:**

- **No false negatives:** Any actual pointer in a root will be found. Reachable objects are never incorrectly collected.
- **Possible false positives:** An integer that happens to match a heap address can be misidentified as a pointer, causing that object to be retained. In practice this is uncommon; the heap is usually sparse.
- **No object moving:** A copying or compacting collector would need to update all pointers when moving objects. With ambiguous roots, we cannot safely update them. Mark-sweep leaves objects in place, so no pointer updates are needed.

### Heap organization

The collector maintains its own allocator. It obtains large blocks from the OS (via `malloc`, `sbrk`, or `mmap`), subdivides them into objects of various sizes, and keeps free lists per size class. When an allocation request arrives:

- If the appropriate free list has a block, it is used.
- Otherwise, the collector may run a **collection** to replenish free lists.
- If still insufficient, it may request more memory from the OS.

Small objects are allocated in fixed-size “chunks”; large objects (above a threshold) are allocated as whole blocks. The design aims to keep the common-case allocation path fast.

### Summary of Boehm architecture

| Aspect | Behaviour |
|--------|-----------|
| **Algorithm** | Mark-sweep (non-copying) |
| **Roots** | Conservative scan of stack, registers, static data |
| **Trigger** | Allocation (when free lists are empty or heap threshold exceeded) |
| **Object movement** | None (objects stay in place) |
| **Compiler cooperation** | None required |

---

## 9.4 Boehm GC implementation in the runtime

The C runtime lives in `source/part1-recursive-descent/05-runtime-stdlib/src/lib.rs` as the string constant **RUNTIME_C**. The CLI writes it to `.lum/runtime.c`, compiles with clang, and links with `-lgc`. Below we expose the full runtime and walk through it.

### Headers and constants

```c
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <gc.h>

#define LUMINA_ARRAY_INIT_CAP 8
#define INT64_MIN_AS_NULL ((int64_t)0x8000000000000000LL)

void lumina_main(void);
```

- **`<gc.h>`** — Boehm GC API (GC_MALLOC, GC_REALLOC, GC_INIT). All heap allocation goes through the GC.
- **LUMINA_ARRAY_INIT_CAP** — Initial capacity for new arrays (8 elements); doubled on each resize.
- **INT64_MIN_AS_NULL** — Sentinel for optional `i64` (Lumina `null` for `T?`).
- **lumina_main** — Declared here; defined by the generated code.

---

### I/O and math helpers

```c
void lumina_println_i64(int64_t x) { printf("%lld\n", (long long)x); }
void lumina_println_str(const char* s) { printf("%s\n", s); }
void lumina_print(const char* s) { printf("%s", s); }
void lumina_print_i64(int64_t x) { printf("%lld", (long long)x); }
int64_t lumina_sqrt(int64_t x) { return (int64_t)sqrt((double)x); }
int64_t lumina_max(int64_t a, int64_t b) { return a > b ? a : b; }
int64_t lumina_min(int64_t a, int64_t b) { return a < b ? a : b; }
```

The codegen emits calls to these from Lumina’s `println`, `print`, `sqrt`, `max`, and `min`. No GC involvement; they are pure helpers.

---

### Array structs

```c
typedef struct { size_t cap, len; int64_t *data; } lumina_arr_i64;
typedef struct { size_t cap, len; const char **data; } lumina_arr_str;
```

- **cap** — Allocated capacity (number of element slots).
- **len** — Current length (number of elements in use).
- **data** — Pointer to the element buffer (GC-managed heap). For `Array<i64>` and `Array<User>` we use `lumina_arr_i64` (record pointers are stored as `int64_t`); for `Array<str>` we use `lumina_arr_str`.

---

### Array of i64 (and records)

```c
int64_t lumina_array_i64_new(void) {
    lumina_arr_i64 *a = (lumina_arr_i64*)GC_MALLOC(sizeof(lumina_arr_i64));
    a->cap = LUMINA_ARRAY_INIT_CAP;
    a->len = 0;
    a->data = (int64_t*)GC_MALLOC((size_t)a->cap * sizeof(int64_t));
    return (int64_t)(uintptr_t)a;
}

void lumina_array_i64_append(int64_t h, int64_t v) {
    lumina_arr_i64 *a = (lumina_arr_i64*)(uintptr_t)h;
    if (a->len >= a->cap) {
        a->cap *= 2;
        a->data = (int64_t*)GC_REALLOC(a->data, (size_t)a->cap * sizeof(int64_t));
    }
    a->data[a->len++] = v;
}

int64_t lumina_array_i64_get(int64_t h, int64_t i) {
    return ((lumina_arr_i64*)(uintptr_t)h)->data[i];
}

void lumina_array_i64_set(int64_t h, int64_t i, int64_t v) {
    ((lumina_arr_i64*)(uintptr_t)h)->data[i] = v;
}

int64_t lumina_array_i64_len(int64_t h) {
    return (int64_t)((lumina_arr_i64*)(uintptr_t)h)->len;
}
```

**Walkthrough:**

1. **lumina_array_i64_new:** Allocates the array struct with `GC_MALLOC`, sets `cap` and `len`, allocates the element buffer with `GC_MALLOC`. Returns the struct pointer as `int64_t` (the Lumina “handle”). Both struct and buffer are GC-managed.

2. **lumina_array_i64_append:** Converts handle `h` back to a pointer. If the buffer is full (`len >= cap`), doubles `cap` and resizes the buffer with `GC_REALLOC`. Stores `v` at `data[len]` and increments `len`. `GC_REALLOC` may trigger collection if the heap is low.

3. **lumina_array_i64_get / set / len:** Straightforward indexing and length access. No allocation.

**Array&lt;User&gt;:** The same functions are used; record pointers are passed as `int64_t` (ptr-to-int in generated code).

---

### Array of str

```c
int64_t lumina_array_str_new(void) {
    lumina_arr_str *a = (lumina_arr_str*)GC_MALLOC(sizeof(lumina_arr_str));
    a->cap = LUMINA_ARRAY_INIT_CAP;
    a->len = 0;
    a->data = (const char**)GC_MALLOC((size_t)a->cap * sizeof(const char*));
    return (int64_t)(uintptr_t)a;
}

void lumina_array_str_append(int64_t h, const char* s) {
    lumina_arr_str *a = (lumina_arr_str*)(uintptr_t)h;
    if (a->len >= a->cap) {
        a->cap *= 2;
        a->data = (const char**)GC_REALLOC(a->data, (size_t)a->cap * sizeof(const char*));
    }
    a->data[a->len++] = s;
}

const char* lumina_array_str_get(int64_t h, int64_t i) {
    return ((lumina_arr_str*)(uintptr_t)h)->data[i];
}

void lumina_array_str_set(int64_t h, int64_t i, const char* s) {
    ((lumina_arr_str*)(uintptr_t)h)->data[i] = s;
}

int64_t lumina_array_str_len(int64_t h) {
    return (int64_t)((lumina_arr_str*)(uintptr_t)h)->len;
}
```

Same pattern as i64: struct and buffer allocated with `GC_MALLOC`, append uses `GC_REALLOC` when resizing. String pointers stored in `data` may point to string literals (in .rodata) or GC-managed allocations; the GC scans the array and treats them as roots for marking.

---

### Optional unwrap helpers

```c
int64_t lumina_unwrap_i64(int64_t opt) {
    return (opt == INT64_MIN_AS_NULL) ? 0 : opt;
}

const char* lumina_unwrap_str(int64_t opt) {
    return (opt == 0) ? "" : (const char*)(uintptr_t)opt;
}
```

Lumina’s `unwrap` for optionals: `T?` is represented as `int64_t` (value or sentinel). These helpers map the null sentinel to a default value. No GC allocation.

---

### main and GC startup

```c
int main(void) {
    GC_INIT();
    lumina_main();
    return 0;
}
```

**Walkthrough:** `GC_INIT()` must run before any `GC_MALLOC` or `GC_REALLOC`. It initializes the collector’s internal state. Then `lumina_main()` runs—the entry point generated from Lumina code. When it returns, the process exits and the OS reclaims all memory.

---

### Summary of GC usage

| Function | GC calls |
|----------|----------|
| lumina_array_i64_new | GC_MALLOC (struct), GC_MALLOC (buffer) |
| lumina_array_i64_append | GC_REALLOC (when resize) |
| lumina_array_str_new | GC_MALLOC (struct), GC_MALLOC (buffer) |
| lumina_array_str_append | GC_REALLOC (when resize) |
| main | GC_INIT() |
| All others | None |

---

## 9.5 Runtime hook names (for future use)

`source/part1-recursive-descent/06-gc/src/lib.rs` defines:

```rust
pub const ALLOC: &str = "lumina_alloc";
pub const PUSH_ROOT: &str = "lumina_push_root";
pub const POP_ROOT: &str = "lumina_pop_root";
```

These are reserved for a **precise** GC design: the compiler would emit `lumina_alloc` for allocations and wrap live pointers in `lumina_push_root` / `lumina_pop_root` around calls. With Boehm GC, we do **not** use these; allocation stays inside the runtime helpers, and Boehm finds roots conservatively.

---

## 9.6 Extended example: `Array<User>` in nested functions

This example shows multiple levels of nesting, several allocations, and when the GC might run. It is larger than the minimal example in earlier sections.

### Program

```lumina
type User = { name: str, age: i64, score: i64 };

fn make_user(name: str, age: i64, score: i64) -> User {
    return { name: name, age: age, score: score };
}

fn add_users_to(out: Array<User>, names: Array<str>) -> unit {
    for i in 0..ArrayLen(names) {
        let n = get(names, i);
        let u = make_user(n, i, i * 10);
        append(out, u);
    }
    return;
}

fn build_team(team_name: str) -> Array<User> {
    let members: Array<User> = [];
    let names: Array<str> = ["Alice", "Bob", "Carol"];
    add_users_to(members, names);
    return members;
}

fn main() -> unit {
    let team_a = build_team("A");
    let team_b = build_team("B");
    let team_c = build_team("C");
    println(ArrayLen(team_a));
    println(ArrayLen(team_b));
    println(ArrayLen(team_c));
    return;
}
```

### Allocation and control flow (step by step)

**1. `main` starts**

- No allocations yet.

**2. First call: `build_team("A")`**

- `build_team` allocates `members: Array<User> = []` → `lumina_array_i64_new` (GC_MALLOC for struct + buffer).
- `build_team` allocates `names: Array<str> = ["Alice","Bob","Carol"]` → `lumina_array_str_new` plus three appends (each append may allocate or grow).
- `add_users_to(members, names)` is called:
  - Loop iteration 0: `make_user("Alice", 0, 0)` returns a record (in our current codegen, records are stack-allocated; if they were heap-allocated, that would be another GC_MALLOC). `append(members, u)` → `lumina_array_i64_append`. The array buffer may need `GC_REALLOC` to grow.
  - Iterations 1 and 2: same pattern.

At any of these `GC_MALLOC` or `GC_REALLOC` calls, if the heap is full, a collection runs. The **roots** at that moment include:

- `members` (in `build_team`’s frame)
- `names` (in `build_team`’s frame)
- `out` and `names` (in `add_users_to`’s frame; they alias the same arrays)
- Any temporaries in registers or on the stack (e.g. the result of `make_user` before `append`)

The collector marks `members`, `names`, and all records stored in `members` (via the array’s `data` pointer). Anything else (e.g. from a previous call) that is unreachable is reclaimed.

**3. `build_team("A")` returns**

- `members` (now `team_a`) is returned to `main` and stored in `team_a`.
- `names` and any temporaries in `build_team` go out of scope. They are no longer in any stack frame. If a collection runs later, `names` is still reachable from `team_a`? No—`team_a` is the `members` array, not `names`. So `names` becomes unreachable and can be collected.

**4. Second call: `build_team("B")`**

- New `members` and `names` arrays are allocated.
- Again, `add_users_to` runs; three `make_user` calls and appends.
- If a collection runs during this, roots include the new `members` and `names`, plus `team_a` in `main` (which holds the first team’s array). So `team_a` stays live; the old `names` from the first `build_team` is unreachable and can be reclaimed.

**5. Third call: `build_team("C")`**

- Same pattern. Now `main` has `team_a`, `team_b`, `team_c` in locals.
- Any collection sees all three as roots (stack), so all three arrays and their contents stay live.

**6. `println` calls**

- These may allocate (e.g. for formatting). A collection during `println` would see `team_a`, `team_b`, `team_c` as roots. All remain live until `main` returns.

**7. `main` returns, process exits**

- Stack is torn down; the collector is no longer relevant. The OS reclaims all process memory.

### Summary of the example

| Moment | Live roots (conservative) | Possibly reclaimed |
|--------|---------------------------|---------------------|
| Inside `build_team("A")` | `members`, `names`, in-flight `make_user` result | Nothing from this program yet |
| Between `build_team("A")` and `build_team("B")` | `team_a` (in `main`) | `names` from first `build_team` |
| Inside `build_team("B")` | `team_a`, new `members`, new `names` | Old `names` from first call |
| After all three `build_team` calls | `team_a`, `team_b`, `team_c` | Intermediate `names` arrays from each `build_team` |

The GC ensures that `team_a`, `team_b`, and `team_c` (and the records they contain) stay live as long as `main` holds them. Temporary arrays like `names` become unreachable and are reclaimed when a collection runs, without any explicit `free` or root registration.

---

## 9.7 Summary

- **Without GC:** The runtime allocates with `malloc`/`realloc`, never frees. Memory grows until process exit. Simple and correct for short-lived programs.
- **With Boehm GC:** Allocation uses `GC_MALLOC` and `GC_REALLOC`; `GC_INIT()` runs at startup. Collection is triggered during allocation when the heap is full; roots are found conservatively from the stack, registers, and static data.
- **Boehm architecture:** Mark-sweep, conservative root scanning, no object movement. No compiler changes for root tracking.
- **Extended example:** `Array<User>` in nested functions shows multiple allocations, when roots are live, and when temporary structures become reclaimable.
- **Installation:** `brew install bdw-gc` (macOS) or `apt install libgc-dev` (Linux). Link with `-lgc`.

**Next:** **Chapter 10 — Optimization** (`source/part1-recursive-descent/07-optimization`).
