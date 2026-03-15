# Appendix (Chapter 9): Source Code and How to Run It

The source code lives in a separate repository: **[akkeshavan/gc-blog-source](https://github.com/akkeshavan/gc-blog-source)**. Clone it to build, test, and link with the GC implementations.

Below is the full layout and how to run it.

## Complete Directory Layout

```
gc-blog-source/
├── include/
│   └── gc_llvm.h              # LLVM runtime API
├── source/
│   ├── mark-sweep/
│   │   ├── gc.h               # Object and heap definitions
│   │   ├── gc.c               # Mark-and-sweep implementation
│   │   ├── gc_llvm.c          # LLVM API adapter
│   │   ├── main.c             # Test harness
│   │   └── Makefile
│   ├── copying-generational/
│   │   ├── gc.h
│   │   ├── gc.c
│   │   ├── gc_llvm.c
│   │   ├── main.c
│   │   └── Makefile
│   └── concurrent-mark-sweep/
│       ├── gc.h
│       ├── gc.c
│       ├── gc_llvm.c
│       ├── main.c
│       └── Makefile
├── examples/
│   └── llvm_integration.c     # Example using gc_* API
├── posts/                     # Blog series
│   ├── README.md
│   ├── 00-setup.md
│   ├── 01-foundations.md
│   ├── 02-mark-sweep.md
│   ├── 03-copying-generational.md
│   ├── 04-comparison.md
│   ├── 05-concurrent-mark-sweep.md
│   ├── 06-advanced-topics.md
│   └── 07-appendix.md
└── Makefile
```

## Build Commands

From the project root:

```bash
# Build all three GCs and their static libraries
make

# Run tests for all
make test

# Build LLVM integration example (links with any GC)
make llvm-example

# Run the examples
./examples/llvm_integration_ms
./examples/llvm_integration_cg

# Clean all build artifacts
make clean
```

## Per-GC Build

```bash
# Mark-and-Sweep
cd source/mark-sweep
make
./gc_test

# Copying/Generational
cd source/copying-generational
make
./gc_test

# Concurrent Mark-and-Sweep (requires pthreads)
cd source/concurrent-mark-sweep
make
./gc_test
```

## Linking with Your Program

1. Include the API header:
   ```c
   #include "gc_llvm.h"
   ```

2. Compile your code:
   ```bash
   clang -I/path/to/gc-blog-source/include -c your_program.c -o your_program.o
   ```

3. Link with one of the GC libraries:

   **Mark-and-Sweep:**
   ```bash
   clang your_program.o -L/path/to/gc-blog-source/source/mark-sweep -lgc_mark_sweep -o your_program
   ```

   **Copying/Generational:**
   ```bash
   clang your_program.o -L/path/to/gc-blog-source/source/copying-generational -lgc_copying -o your_program
   ```

   **Concurrent Mark-and-Sweep:**
   ```bash
   clang your_program.o -L/path/to/gc-blog-source/source/concurrent-mark-sweep -lgc_concurrent -o your_program -pthread
   ```

## Requirements

- **C compiler**: GCC or Clang
- **Make**
- **C11**: `-std=c11` (default in the Makefiles)
- **pthreads**: Required only for the concurrent mark-sweep GC

---

[← Back to Chapter 2 (Setup)](02-setup.md) | [Index](README.md)

---

*End of series.*
