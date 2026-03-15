# Chapter 1: Introduction to Garbage Collection

Garbage collection is one of the most impactful ideas in programming language design. It removes an entire class of bugs—memory management errors—by automating what used to be the programmer's responsibility. This chapter explains why GC was invented, what problems it solves, and how it fits into the landscape of memory management and theoretical computer science.

## The Problem: Manual Memory Management is Hard

In languages like C, you allocate memory with `malloc` and free it with `free`. The rules seem simple: for every `malloc` there must be exactly one `free`, and you must free only when the memory is no longer needed. In practice, this is remarkably difficult.

**Memory leaks** occur when you forget to free. The program consumes more and more memory until it crashes or the system grinds to a halt. **Use-after-free** happens when you free too early—you reclaim memory that is still in use, leading to corruption and security vulnerabilities. **Double-free**—freeing the same block twice—can crash the program or open security holes.

These bugs are pervasive. Studies of real-world C/C++ codebases show that memory errors account for a large fraction of security vulnerabilities. The core issue is that *ownership*—who is responsible for freeing a piece of memory—is implicit and scattered across the code. As programs grow, tracking ownership becomes almost impossible.

## The Idea: Automate Reclamation

**Garbage collection** inverts the problem. Instead of the programmer deciding when to free, the runtime determines which objects are *no longer reachable* and reclaims them automatically. The programmer allocates; they never free. The system does the rest.

This shift has profound consequences. It eliminates whole categories of bugs. It changes how we design languages and APIs. It also introduces new concerns: pauses, throughput, memory overhead. But for many domains—from scripting languages to enterprise runtimes—the trade-off has been worth it.

## A Brief History

The idea of automatic memory reclamation dates to the 1950s. **John McCarthy** introduced garbage collection for Lisp (1959), where the dynamic, pointer-heavy nature of the language made manual management impractical. Lisp's cons cells and recursive structures demanded an automated solution.

Over the decades, GC evolved from simple mark-sweep to copying collectors, generational collection, and eventually concurrent and incremental algorithms. Modern runtimes—the JVM, V8, Go, .NET—use sophisticated collectors that combine multiple strategies. The theoretical foundations—reachability, tracing, reference counting—remain central.

## Types of Garbage Collectors

### Tracing vs. Reference Counting

**Tracing** collectors start from roots (pointers the program holds directly) and follow references to find all reachable objects. Everything not reached is garbage. Mark-sweep and copying collectors are tracing-based.

**Reference counting** assigns each object a count of how many pointers reference it. When the count drops to zero, the object is freed. No trace phase—but cycles (A → B → A) can never be reclaimed unless augmented with a cycle detector.

### Stop-the-World vs. Concurrent

**Stop-the-world** collectors pause the program during collection. Simple and correct, but pauses can be noticeable. **Concurrent** collectors run alongside the program, reducing pause times at the cost of complexity (write barriers, synchronization).

### Generational Collection

Most objects die young. **Generational** collectors divide the heap into young (nursery) and old generations. They collect the nursery frequently and the old generation rarely, exploiting this *generational hypothesis* to reduce work.

## The Theoretical Lens

Garbage collection sits at the intersection of programming languages, systems, and theoretical computer science.

**Reachability** is the key notion: an object is live iff it is reachable from the roots via pointer chains. This is a graph-reachability problem—we traverse the object graph from the roots. The GC must approximate "will this object be used again?" with "is it reachable?"—a conservative but tractable approximation.

**Correctness** for a GC means: never reclaim a reachable object, and eventually reclaim unreachable ones. The former is safety; the latter is liveness. Proving these properties, especially for concurrent collectors, draws on formal methods and concurrency theory.

**Complexity**—time and space—varies by algorithm. Mark-sweep is O(live objects) for marking and O(all objects) for sweeping. Copying is O(live objects) but needs 2× space. Generational collection amortizes cost by collecting the small nursery often.

## Further Reading: Theory and History

- **McCarthy, J. (1960).** "Recursive Functions of Symbolic Expressions and Their Computation by Machine, Part I." *CACM* 3(4). The original Lisp paper introducing GC.
- **Jones, R., Hosking, A., Moss, E. (2011).** *The Garbage Collection Handbook.* CRC Press. The definitive reference.
- **Bacon, D. et al. (2004).** "A Unified Theory of Garbage Collection." *OOPSLA*. Unifies tracing and reference counting in one framework.
- **Wilson, P. (1992).** "Uniprocessor Garbage Collection Techniques." *IWMM*. Survey of classic algorithms.
- **[Memory Management Reference](https://www.memorymanagement.org/)** — Concise overview of GC and related topics.

---

Next: [Chapter 2 — Setup](02-setup.md)
