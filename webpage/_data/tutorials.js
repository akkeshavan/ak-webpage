const path = require("path");

// Paths relative to repo root (parent of webpage/)
const REPO_ROOT = path.join(__dirname, "..", "..");

const tutorials = [
  {
    slug: "compiler-llvm-rust",
    title: "Building a Compiler using LLVM and Rust",
    folder: "02-Tutorials/2.1 Building a Compiler using LLVM and Rust",
    introSummary:
      "A practical, code-first guide to building a real compiler with Rust and LLVM (via Inkwell). You'll implement the full pipeline—source → tokens → AST → typed AST → LLVM IR → native executable—with a hand-written front-end first, then a grammar-driven one using pest. Each chapter is about an hour; in ~23 days you'll have a working Lumina compiler.",
    toc: [
      { title: "Chapter 1 — Introduction", file: "chapter-01.md" },
      { title: "Chapter 2 — LLVM Architecture Deep Dive", file: "chapter-02.md" },
      { title: "Chapter 3 — Part 1: Installation", file: "chapter-03.md" },
      { title: "Chapter 4 — Lexer (Hand-Written)", file: "chapter-04.md" },
      { title: "Chapter 5 — Parser (Hand-Written)", file: "chapter-05.md" },
      { title: "Chapter 6 — Type Checking", file: "chapter-06.md" },
      { title: "Chapter 7 — Code Generation", file: "chapter-07.md" },
      { title: "Chapter 8 — Runtime and Standard Library", file: "chapter-08.md" },
      { title: "Chapter 9 — GC Integration", file: "chapter-09.md" },
      { title: "Chapter 10 — Optimization", file: "chapter-10.md" },
      { title: "Chapter 11 — Generating Code for Different Targets", file: "chapter-11.md" },
      { title: "Chapter 12 — The Lum CLI", file: "chapter-12.md" },
      { title: "Chapter 13 — Part 2: Installation (Grammar-Driven with pest)", file: "chapter-13.md" },
      { title: "Chapter 14 — Lexer (Grammar-Driven with pest)", file: "chapter-14.md" },
      { title: "Chapter 15 — Parser (Grammar-Driven with pest)", file: "chapter-15.md" },
      { title: "Chapter 16 — Type Checking and Inference (Part 2)", file: "chapter-16.md" },
      { title: "Chapter 17 — Code Generation (Part 2)", file: "chapter-17.md" },
      { title: "Chapter 18 — Runtime and Standard Library (Part 2)", file: "chapter-18.md" },
      { title: "Chapter 19 — GC Integration (Part 2)", file: "chapter-19.md" },
      { title: "Chapter 20 — Optimization (Part 2)", file: "chapter-20.md" },
      { title: "Chapter 21 — Generating Code for Different Targets (Part 2)", file: "chapter-21.md" },
      { title: "Chapter 22 — The Lum CLI (Part 2)", file: "chapter-22.md" },
      { title: "Chapter 23 — Advanced Topics, Conclusion and Next Steps", file: "chapter-23.md" },
    ],
  },
  {
    slug: "garbage-collectors",
    title: "Understanding Garbage Collectors",
    folder: "02-Tutorials/2.2 Understanding Garbage  Collectors",
    introSummary:
      "Garbage collection removes a whole class of bugs by automating memory reclamation. This tutorial explains why GC was invented, how tracing and reference counting work, and walks through mark-sweep, copying/generational, and concurrent collectors—with theory and implementation so you can reason about real runtimes like the JVM and V8.",
    toc: [
      { title: "Chapter 1: Introduction", file: "01-Introduction.md" },
      { title: "Chapter 2: Setup", file: "02-setup.md" },
      { title: "Chapter 3: Foundations", file: "03-foundations.md" },
      { title: "Chapter 4: Mark-and-Sweep", file: "04-mark-sweep.md" },
      { title: "Chapter 5: Copying / Generational", file: "05-copying-generational.md" },
      { title: "Chapter 6: Comparison", file: "06-comparison.md" },
      { title: "Chapter 7: Concurrent Mark-and-Sweep", file: "07-concurrent-mark-sweep.md" },
      { title: "Chapter 8: Advanced Topics", file: "08-advanced-topics.md" },
      { title: "Appendix: Source & Repositories", file: "09-appendix.md" },
    ],
  },
  {
    slug: "ll-parser-generators",
    title: "A Deep Dive into LL Parser Generators",
    folder: "02-Tutorials/2.3 A  Deep Dive in to LL Parser Generators",
    introSummary:
      "Understand how ANTLR4-style LL parser generators work by building a small one in Rust. You'll implement grammar IR, lexer generation, recursive-descent parser generation with semantic actions, ASTs, an interpreter, and an LLVM backend—without reimplementing all of ANTLR4, but with enough to use and extend real grammars.",
    toc: [
      { title: "Introduction to Parser Generators", file: "01-introduction.md" },
      { title: "Grammar Representation and Parsing", file: "02-grammar-and-ir.md" },
      { title: "Lexer Generator", file: "03-lexer-generator.md" },
      { title: "Parser and AST Generation", file: "04-parser-ast-generation.md" },
      { title: "Simple Expression Language", file: "05-expression-language.md" },
      { title: "Building an Interpreter from ASTs", file: "06-interpreter-from-ast.md" },
      { title: "Full Language: Types, Functions, Control Flow", file: "07-full-language.md" },
      { title: "Runtime and Stdlib", file: "08-runtime-stdlib.md" },
      { title: "Interpreted Mode and Seamless Execution", file: "09-interpreted-mode.md" },
      { title: "Integrating with LLVM", file: "10-llvm-integration.md" },
    ],
  },
  {
    slug: "building-an-rdbms",
    title: "Building an RDBMS — Key Concepts",
    folder: "02-Tutorials/2.4 Building and RDBMs- key  concepts",
    introSummary:
      "A hands-on tutorial that takes you from the relational model to a working SQL database engine in Rust. By the end you'll have RustDB: paged storage, buffer pool, B-Tree indexes, SQL parsing (CREATE TABLE, INSERT, SELECT), a Write-Ahead Log for ACID, and an interactive REPL—with optional chapters on recovery, JOINs, and concurrency.",
    toc: [
      { title: "Introduction", file: "00-introduction.md" },
      { title: "Chapter 1: Relational Databases", file: "01-relational-databases.md" },
      { title: "Chapter 2: Rust for Database Development", file: "02-rust-setup.md" },
      { title: "Chapter 3: Storing Data — Pages and the Disk Manager", file: "03-pages-and-disk.md" },
      { title: "Chapter 4: The Buffer Pool", file: "04-buffer-pool.md" },
      { title: "Chapter 5: Rows, Types, and Serialisation", file: "05-rows-and-types.md" },
      { title: "Chapter 6: Tables and the System Catalog", file: "06-catalog.md" },
      { title: "Chapter 7: B-Tree Indexes", file: "07-btree.md" },
      { title: "Chapter 8: Parsing SQL", file: "08-sql-parser.md" },
      { title: "Chapter 9: Query Execution", file: "09-executor.md" },
      { title: "Chapter 10: Transactions and the Write-Ahead Log", file: "10-wal.md" },
      { title: "Chapter 11: Putting It All Together — A Working REPL", file: "11-repl.md" },
      { title: "Chapter 12: UPDATE and DELETE", file: "12-update-delete.md" },
      { title: "Chapter 13: DDL — DROP TABLE and ALTER TABLE", file: "13-ddl.md" },
      { title: "Chapter 14: Crash Recovery", file: "14-recovery.md" },
      { title: "Chapter 15: Multi-table JOINs", file: "15-joins.md" },
      { title: "Chapter 16: Concurrent Access", file: "16-concurrency.md" },
      { title: "Chapter 17: Improvements", file: "17-improvements.md" },
    ],
  },
];

// Flatten for 11ty pagination: every chapter as one item
const allChapters = tutorials.flatMap((t) =>
  t.toc.map((entry, index) => ({
    tutorialSlug: t.slug,
    tutorialTitle: t.title,
    title: entry.title,
    file: entry.file,
    folder: t.folder,
    index,
    totalChapters: t.toc.length,
  }))
);

module.exports = {
  list: tutorials,
  allChapters,
  repoRoot: REPO_ROOT,
};
