# Building a Compiler with Rust and LLVM - 8

*Runtime and standard library (tiny C wrapper)*

---

LLVM codegen gives us an object file, but to get a runnable program we still need a **`main()`** symbol and implementations of the **stdlib functions** the generated code calls (println, array ops, etc.). In this repo we use a C runtime that defines `main()` (which calls the generated entry, e.g. `lumina_main`), and implements all **stdlib** functions (println, print, sqrt, max, min, array new/append/get/set/len, unwrap). The code for this chapter lives in `source/part1-recursive-descent/05-runtime-stdlib`.

---

## Goals of this chapter

- Provide a **C runtime** that defines `main()` and calls the compiler-generated entry (e.g. `lumina_main`).
- **Implement** every stdlib function that the type checker and codegen expect: `lumina_println_i64`, `lumina_println_str`, `lumina_print*`, `lumina_sqrt`, `lumina_max`, `lumina_min`, array new/append/get/set/len for i64 and str (and for records via the i64 array), and optional unwrap helpers.
- Explain **how stdlib functions are exposed** end-to-end (type checker → codegen → runtime) so you can add new ones.
- Describe the **build pipeline** (IR → object → runtime.c → link).

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **05-runtime-stdlib/src/lib.rs** | **RUNTIME_C** – string containing the full C source. **PRINTLN_I64**, **PRINTLN_STR** (and similar) constants for use by codegen/tests. |
| **Runtime C** | `main()`; declarations for the generated entry; definitions for every `lumina_*` function (println, print, sqrt, max, min, array_*_new/append/get/set/len, unwrap). |
| **CLI** (Ch 12) | Writes RUNTIME_C to `.lum/runtime.c`, compiles with clang, links with `main.o`. |

---

## Dependencies (Cargo.toml) for this chapter

```toml
[package]
name = "lumina-part1-runtime"
version = "0.1.0"
edition = "2021"

[dependencies]
lumina-part1-codegen = { path = "../04-codegen" }
```

The runtime crate depends on **codegen** only to reference **ENTRY_FN_NAME** in tests (so test and runtime stay in sync). The actual runtime is a single C string; the CLI writes it to a file and compiles it.

---

## 8.1 Runtime C source

`source/part1-recursive-descent/05-runtime-stdlib/src/lib.rs` contains the runtime as a string constant (the CLI writes it to `.lum/runtime.c` and compiles it with `clang`):

```c
#include <stdio.h>
#include <stdint.h>

// Defined in the generated LLVM module.
void lumina_main(void);

void lumina_println_i64(int64_t x) {
    printf("%lld\n", (long long)x);
}

void lumina_println_str(const char* s) {
    printf("%s\n", s);
}

int main(void) {
    lumina_main();
    return 0;
}
```

The **full** runtime in `source/part1-recursive-descent/05-runtime-stdlib/src/lib.rs` (**RUNTIME_C**) defines the same entry and println/print, plus array helpers (new/append/get/set/len for i64 and str and records), `lumina_sqrt`, `lumina_max`, `lumina_min`, and optional unwrap helpers.

The compiler emits calls to `lumina_println_i64` and `lumina_println_str` (and `lumina_print` variants) for Lumina's `println`/`print` built-ins, including output from match expressions and other expressions. The runtime is the natural place to grow more standard library APIs (e.g. array helpers, math) as the language expands.

---

## 8.2 Generic arrays and ArrayLen

**Generic array types** in Lumina are written `array<T>` or `Array<T>` (e.g. `Array<i64>`, `Array<str>`). The type system treats any `Array<T>` uniformly; the compiler and runtime implement them for element types `i64` and `str` via type-specific C functions.

**Runtime layout:** Each array is a heap-allocated struct with `cap`, `len`, and a pointer to the element buffer. The generated code passes the array as an `int64_t` handle (pointer cast to integer). The C runtime defines:

- **`lumina_array_i64_new`** / **`lumina_array_str_new`** — allocate a new array, return handle.
- **`lumina_array_*_append`** — append one element (resizing if needed).
- **`lumina_array_*_get`** — return element at index.
- **`lumina_array_*_set`** — set element at index.
- **`lumina_array_i64_len`** / **`lumina_array_str_len`** — return the current length (number of elements) as `int64_t`.

**ArrayLen(arr) in the language:** The stdlib exposes a single name **`ArrayLen(arr)`** that takes one array argument and returns its length as an `i64`. The type checker resolves it by the argument type: if `arr` has type `Array<i64>`, the call becomes `array_i64_len`; if `Array<str>`, it becomes `array_str_len`. Codegen then emits a call to `lumina_array_i64_len` or `lumina_array_str_len`. This allows a **for** loop over indices: `for i in 0..ArrayLen(arr) { ... get(arr, i) ... }` without hard-coding the size.

**Arrays of records:** `Array<User>` (and arrays of other record types) are supported. The runtime reuses the i64 array: record pointers are stored as `int64_t` (pointer-sized). The type checker and codegen resolve `ArrayLen`, `get`, `append`, and `set` for `Array<Record>` the same way as for `i64` and `str`, with pointer↔i64 conversion at the boundaries. Functions can take and return record and array-of-record types.

---

## 8.3 How stdlib functions are exposed (end-to-end)

A Lumina stdlib function (e.g. `println`, `ArrayLen`, `get`, `sqrt`) is visible to the user by a **single name** (or overloaded name). Under the hood, three layers must agree: **type checker**, **codegen**, and **runtime**.

### 1. Type checker (03-typecheck)

- The type checker keeps a **prelude** (or built-in map): a mapping from **internal** function names to **(parameter types, return type)**.
- **Overloaded** names (e.g. `println`) are special-cased: when the type checker sees `println(expr)`, it typechecks `expr`, then chooses an **internal** name by type (e.g. `println_str` or `println_i64`) and looks up that name in the prelude.
- **Non-overloaded** names (e.g. `ArrayLen`, `get`, `append`, `sqrt`) are resolved by the number and types of arguments. For `ArrayLen(arr)`, the type of `arr` (e.g. `Array<i64>`) determines the chosen backend name (e.g. `array_i64_len`).
- So: the type checker **decides** which internal name (e.g. `println_i64`, `array_i64_len`) the call refers to and attaches that name to the **TypedExpr::Call** node.

### 2. Codegen (04-codegen)

- **`resolve_callee`** (or equivalent) maps the **internal** name to the **LLVM/C name** that the runtime defines: e.g. `println_i64` → `lumina_println_i64`, `array_i64_len` → `lumina_array_i64_len`.
- **`declare_runtime`** (run once when building the module) **declares** every such function in the LLVM module: name, parameter types, return type. So the generated code can `call @lumina_println_i64(i64 %x)` even though the definition lives in the C file.
- When we **compile** a `TypedExpr::Call(overload, args, ret_ty)`, we use the **resolved** LLVM name, convert the typed arguments to LLVM values (e.g. record pointer → ptr2int for append), and emit `build_call`.

### 3. Runtime (05-runtime-stdlib)

- The **C source** (e.g. **RUNTIME_C** in `lib.rs`) **defines** each of those symbols: e.g. `void lumina_println_i64(int64_t x) { ... }`, `int64_t lumina_array_i64_len(int64_t h) { ... }`.
- The CLI writes this C to `.lum/runtime.c`, compiles it to `runtime.o`, and links `main.o + runtime.o`. So at link time, every `call @lumina_*` is satisfied by the C implementation.

**Summary:** Type checker picks an internal name (and thus signature); codegen maps that to an LLVM name and declares it; runtime implements that LLVM name in C. All three must use the **same** names and **matching** signatures.

---

## 8.4 Exposing a new stdlib function: explicit steps

To expose a **new** stdlib function in Lumina (e.g. `abs` for integer absolute value), follow these steps.

1. **Runtime (05-runtime-stdlib)**  
   - In **RUNTIME_C**, add a C function with the **exact** name and signature the generated code will call, e.g.  
     `int64_t lumina_abs(int64_t x) { return x < 0 ? -x : x; }`  
   - Use the same naming: **`lumina_`** prefix and the same parameter/return types as in the next step.

2. **Codegen (04-codegen)**  
   - In **`resolve_callee`** (or the function that maps internal name → LLVM name), add an entry, e.g.  
     `"abs_i64" => "lumina_abs".into()`.  
   - In **`declare_runtime`**, add a declaration so the module knows the symbol:  
     `module.add_function("lumina_abs", i64.fn_type(&[i64.into()], false), None);`  
   - Ensure that when we compile a call to `abs_i64`, we pass a single i64 and use the return value as i64.

3. **Type checker (03-typecheck)**  
   - In the **prelude** (built-in function map), add the signature Lumina users will see. For a single overload:  
     e.g. `m.insert("abs".to_string(), (vec![Type::Int], Type::Int));`  
   - If you want **overloaded** `abs` (e.g. Int and Float later), you can either use one internal name for now (e.g. `abs_i64`) and have the type checker pick it when the argument is Int, or add a special case like `println`.

4. **Parser (02-parser)**  
   - No change needed if the function is called by a **normal** call syntax: `abs(x)`. The parser already parses `ident ( expr_list )`. Only if you want new **syntax** (e.g. a keyword) would you change the parser/lexer.

5. **Test**  
   - Write a small Lumina program that calls the new function (e.g. `println(abs(-42))`) and run `lum run` (or a test that compiles and checks IR contains `lumina_abs`).

**Try it yourself:** Add a stdlib function **`square(n: i64) -> i64`** that returns `n * n`. Implement it in the runtime as `lumina_square`, declare it in codegen, and register it in the type checker prelude as `square` with one `Int` parameter and `Int` return. Then run `println(square(7))` and confirm the output is `49`.

---

## 8.5 Build pipeline (what the CLI does)

When you run `lum build`, the CLI:

- emits LLVM IR to `.lum/main.ll` (for debugging / blog visibility)
- produces `.lum/main.o`: on **macOS**, the CLI compiles `main.ll` with `clang -c` so the Mach-O has the correct platform load command (no linker warning); on other platforms it uses LLVM’s target machine API (`write_object_file`)
- writes `.lum/runtime.c`, compiles it to `.lum/runtime.o` with `clang`
- links `.lum/main.o` + `.lum/runtime.o` into `.lum/main`

---

## 8.6 Summary

The runtime wrapper makes our generated LLVM code runnable by providing a `main()` that calls `lumina_main()`. Next we discuss GC integration hooks (still just placeholders in this repo).

**Next:** **Chapter 9 — GC Integration** (`source/part1-recursive-descent/06-gc`).
