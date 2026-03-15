# Chapter 1: Introduction to Parser Generators and ANTLR4‑Style LL Parsing

You should be comfortable reading BNF-style grammar rules and recursive code; familiarity with context-free grammars, lexing, and parsing is assumed. If you need a refresher, see e.g. [Crafting Interpreters – Parsing](https://craftinginterpreters.com/parsing-expressions.html) or a short CFG/BNF primer.

> **Scope and goal.**  
> This tutorial is about **understanding how LL / ANTLR4‑style parser generators work**, not about re‑implementing *all* of ANTLR4. We build a **small, ANTLR4‑inspired LL parser generator** in Rust that shows the core ideas: grammar IR, lexer generation, recursive‑descent parser generation with semantic actions, ASTs, an interpreter, and an LLVM backend. We **do not** aim for feature parity with ANTLR4’s ALL(\*) engine, grammar language, or tooling.  
>  
> **Lookahead:** We implement **LL(1)** only (one token of lookahead). ANTLR4 uses **LL(k)**‑style or **ALL(\*)** (adaptive, unbounded lookahead), which handles many more grammars. Because this is **a tutorial rather than a production tool**, we keep the generator simple and teach the core mechanics; extending to LL(k) is described conceptually in Chapter 4 but not implemented.

## 1.1 What Is a Parser Generator?

A **parser generator** is a tool that takes a **grammar** (a formal description of a language’s syntax) and produces **code** that can recognize and often analyze that language. Instead of hand-writing a lexer and parser for every new language or DSL, you describe the language in a grammar and let the generator produce the recognizer.

- **Input:** A grammar file (e.g., in BNF, EBNF, or ANTLR4’s `.g4` format).
- **Output:** Typically a **lexer** (tokenizer) and a **parser** that build a **parse tree** or **abstract syntax tree (AST)**.

Parser generators automate the heavy lifting of parsing and free you to focus on semantics, analysis, and code generation.

## 1.2 Why ANTLR4?

**ANTLR** (ANother Tool for Language Recognition) is one of the most widely used parser generators. **ANTLR4** introduced:

- **Adaptive LL(\*)** parsing: powerful, grammar-friendly parsing without many of the restrictions of classic LL(1) or LALR.
- **Grammar reuse** via imports and well-defined lexer/parser separation.
- **Multiple targets**: Java, C#, Python, JavaScript, Go, Swift, Rust (community), etc.
- **Parse trees and visitor/listener APIs** that make it easy to build ASTs and interpreters.

In spirit we follow ANTLR4’s **top‑down LL approach** and its grammar style. By building an **ANTLR4‑style LL parser generator** (not a full clone) we learn:

1. How to **read and interpret** an ANTLR4-style grammar.
2. How to **generate** a lexer and a parser in a target language.
3. How to **generate ASTs** and support multiple targets (e.g., Rust and JavaScript).
4. How to **drive** an interpreter (we’ll build it in Chapter 6) or a compiler (e.g., via LLVM in Chapter 10) from those ASTs.

## 1.3 Theory You Need

### 1.3.1 Context-Free Grammars (CFGs)

A **context-free grammar** is a set of **rules** of the form:

\[
A \rightarrow \alpha
\]

where \(A\) is a **nonterminal** and \(\alpha\) is a string of **terminals** and **nonterminals**. The **start symbol** is the nonterminal we use to derive full sentences.

- **Terminals:** Symbols that appear in the actual input (tokens: keywords, identifiers, literals, operators).
- **Nonterminals:** Symbols defined by rules; they stand for syntactic constructs (expressions, statements, declarations).

Parsing is the process of taking a sequence of tokens and finding a **derivation** (or a **parse tree**) that shows how the start symbol produces that sequence.

### 1.3.2 Lexer vs Parser

- **Lexer (scanner):** Turns raw text into a stream of **tokens**. It handles keywords, identifiers, numbers, strings, operators, and skips whitespace/comments. Output: list of `(token_type, value, location)`.
- **Parser:** Consumes the token stream and applies grammar rules to build a **parse tree** (or AST). It only sees token types (and sometimes literal values); it does not see raw characters.

So the pipeline is: **Source text → Lexer → Token stream → Parser → Parse tree / AST**.

### 1.3.3 Parse Trees vs ASTs

- **Parse tree (concrete syntax tree):** One node per grammar symbol and rule application. Reflects the grammar literally (every rule expansion is visible).
- **AST (abstract syntax tree):** A simplified tree that drops punctuation and redundant structure and keeps only what matters for semantics (expressions, statements, declarations). Better for interpretation and code generation.

Our generator will produce **ASTs** in the target language (Rust, JavaScript, etc.), not necessarily full parse trees.

### 1.3.4 LL vs LR (and What ANTLR4 Uses)

- **LL:** Parse **Left-to-right**, **Leftmost** derivation. The parser predicts which rule to use (top-down) before consuming tokens. **LL(1)** = one token lookahead; **LL(k)** = k tokens. Recursive descent is typically LL.
- **LR:** **Left-to-right**, **Rightmost** derivation. The parser shifts tokens onto a stack and reduces by grammar rules (bottom-up). **LR(1)** = one token lookahead; **LALR(1)** (Look-Ahead LR) is a practical variant with smaller tables than full LR(1). **LALR(k)** uses k tokens of lookahead.

So **LALR(1)** and **LALR(k)** are **bottom-up** techniques; they are **not** used by ANTLR4.

**What ANTLR4 uses:** **ALL(\*)** (Adaptive LL(\*)), a **top-down** algorithm. It is in the **LL family**, not the LR/LALR family. At each choice point the parser can use **unbounded lookahead** (in practice, as much as needed) and caches decisions in a DFA, so it handles many grammars that are not LL(1) or even LL(k) for fixed k. It also supports **left recursion** (via internal grammar rewriting). So when you feed ANTLR4 an ANTLR4 grammar, the generated parser is top-down LL-style, not LALR.

**In this tutorial:** We read **ANTLR4-style grammar files** (for small subsets) and also a simpler **`.grammar` format with actions**. Our *generated* parser uses **LL(1)** only: one token of lookahead, with FIRST-set–based choice between alternatives (see Chapter 4). We **do not** implement **LL(k)** or ANTLR4’s **ALL(\*)** (adaptive LL with unbounded lookahead), nor LALR, nor automatic left‑recursion handling. ANTLR4 is a full product and uses LL(k)/ALL(\*) to accept a wide range of grammars; here we stick to LL(1) because this is **a tutorial**, not a real product—the aim is to understand how LL parser generators work, not to match ANTLR4’s power.

## 1.4 What We Will Build: High-Level Architecture

Our parser generator will have these main components:

1. **Grammar front end**  
   - Read an ANTLR4-style `.g4` file for a **small subset**, and a simpler `.grammar` format with **semantic actions**.  
   - Parse these into an internal representation (grammar IR): rules, alternatives, lexer rules vs parser rules, plus optional per‑alternative actions.

2. **Lexer generator**  
   - From the lexer rules in the grammar, generate a **lexer** in the target language (Rust, JavaScript, etc.).  
   - Output: source code that turns text into a token stream.

3. **Parser generator**  
   - From the parser rules, generate a **parser** in the target language.  
   - Parser uses the generated lexer (or a compatible token stream) and produces an **AST**.

4. **AST generator**  
   - Define (or generate) **AST node types** in the target language.  
   - Parser builds instances of these nodes; same logical AST for Rust and JS, different syntax.

5. **Runtime (for interpretation)**  
   - When the target is “interpreted”, we provide a **runtime** in that same language (e.g., Rust runtime for Rust-generated parser).  
   - Runtime is **extensible**: users can register functions (e.g., `print`, `write`, `readfile`).  
   - The generated parser runs in **interpreted mode** using this runtime.

6. **LLVM integration (optional path)**  
   - From the same AST, generate LLVM IR and compile to native code instead of interpreting.

So the **input** is typically an **ANTLR4‑style grammar** (or the simplified `.grammar` format) plus source in the described language. The **output** is either:

- **Interpreted:** Generated parser + AST + runtime (Rust or JS) with stdlib, or  
- **Compiled:** Generated code that lowers AST to LLVM and produces an executable.

**Two ways to run programs (reference implementation):** (A) **Grammar path** — write a `.grammar` file with actions → run **`parser_gen gen`** → integrate the generated lexer and parser into your crate → you run source through them and feed the AST to the interpreter or LLVM. (B) **FullLang path** — use **`parser_gen run`** or **`parser_gen compile`** with the built-in **hand-written** FullLang parser (no grammar file). The CLI’s **run** and **compile** commands use (B); see Chapter 9 for details.

## 1.5 ANTLR4 Grammar File Format (Quick Tour)

ANTLR4 grammars are usually split into **lexer** and **parser** rules in one or two files.

- **Lexer rules:** Uppercase names, e.g. `ID`, `INT`, `PLUS`.  
  - Can use fragments for reusable pieces.  
  - Order and longest-match rule how tokens are recognized.

- **Parser rules:** Lowercase names, e.g. `expr`, `statement`, `program`.  
  - Use lexer symbols and other parser rules.  
  - Alternatives with `|`, optional with `?`, repetition with `*` and `+`, grouping with `()`.

Example (conceptual):

```antlr
grammar Expr;

// Lexer
INT  : [0-9]+ ;
PLUS : '+' ;
ID   : [a-zA-Z_][a-zA-Z0-9_]* ;

// Parser
expr   : expr PLUS expr | INT | ID ;
start  : expr EOF ;
```

Our tool will **read such a file** and then **generate** the lexer, parser, and AST in the chosen target language.

## 1.6 Tutorial Roadmap

- **Chapters 2–4:** Build the generator: grammar IR, lexer generator, parser and AST generation (Rust + one other language, e.g. JS).
- **Chapter 5:** A **simple expression language** to validate the pipeline end-to-end. The **reference** pipeline uses a **.grammar** file (with semantic actions); optional .g4 parsing is described in Chapter 2.
- **Chapter 6:** **Interpreter from ASTs**: design and implement evaluation of the expression (and later full) language.
- **Chapter 7:** A **full language** with functions, types, expressions, `for`, `if`/`else-if`/`else`.
- **Chapter 8:** **Runtime and stdlib**: extensible runtime with `print`, `write`, `readfile`, and user-defined functions.
- **Chapter 9:** **Interpreted mode**: generated parser + runtime in the same target (e.g., Rust) running together seamlessly.
- **Chapter 10:** **LLVM integration**: compiling the same AST to native code.

By the end you will have a small, working **LL parser generator**, inspired by ANTLR4, that:

- Accepts ANTLR4‑style grammars (for a subset) and a `.grammar` format with actions.
- Generates lexers and AST‑building parsers in Rust (and conceptually other targets).
- Supports both **interpretation** (with an extensible runtime) and **LLVM‑based** compilation for expressions.

It is **not** a drop‑in ANTLR4 replacement, but a teaching implementation that exposes the moving parts of ANTLR‑style LL parser generators.

---

**Next:** [Chapter 2 — Grammar Representation and Parsing the Grammar File](02-grammar-and-ir.md)
