# Building a Compiler with Rust and LLVM - 13

*Part 2: Formal grammar and grammar-driven parsing (Pest)*

---

This chapter gives a **formal grammar** for the Lumina language (as implemented in Part 1 and supported by the compiler through Chapter 12), explains **why we use Pest** for Part 2, and suggests **alternatives**. Part 2 reimplements the **front-end** (lexer + parser) using a grammar file and Pest; the rest of the pipeline (type checking, code generation, runtime, CLI) is unchanged.

---

## Goals of this chapter

- Write a **formal grammar** (BNF-style) for Lumina: program, type definitions, type annotations, functions, statements, expressions, and lexical structure.
- Explain **why grammar-driven parsing** is useful and **why Pest** was chosen (pure Rust, PEG semantics, good fit as a second front-end).
- Suggest **alternatives** (lalrpop, nom/combine, ANTLR, hand-written).
- State **prerequisites** and the **Part 2 project layout** so readers can follow Chapters 14–22.

---

## Code structure in this chapter

| Section | Content |
|--------|--------|
| 13.1 | Formal grammar: program, top-level, type_def, type_ann, functions, statements, expressions, lexical (tokens) |
| 13.2 | Why grammar-driven parsing |
| 13.3 | Why Pest; alternatives |
| 13.4–13.6 | Prerequisites, project layout, summary |

There is **no code crate** for this chapter; it is reference and rationale. The grammar is the specification that Part 2’s lexer (Ch 15) and parser (Ch 16) implement.

---

## Dependencies (Cargo.toml) for this chapter

This chapter does **not** introduce a Cargo crate. It defines the grammar and the Part 2 layout. The first crate that uses **pest** and **pest_derive** is **01-lexer** (Chapter 15).

---

## 13.1 Formal grammar for Lumina

The grammar below describes the **syntax** of Lumina. We use a BNF-style notation: nonterminals in angle brackets, literals in quotes, `*` for zero-or-more, `+` for one-or-more, `?` for optional, `|` for alternation.

### 13.1.1 Program and top-level

```
<program>       ::= <type_def>* <top_level>

<top_level>     ::= <function_def>+ <trailing_main>?
                  | <trailing_main>

<trailing_main> ::= <stmt>+   /* wrapped in implicit fn main() -> unit { ... } */
```

- A program is zero or more type definitions followed by either a list of function definitions (and optionally trailing statements) or just trailing statements.
- Trailing statements are wrapped by the compiler in an implicit `main()`; if no function is defined and the file is a sequence of statements, that sequence becomes the body of `main`.

### 13.1.2 Type definitions and type annotations

```
<type_def>      ::= "type" <ident> "=" <type_ann> ";"

<type_ann>      ::= "i64" | "str" | "unit"
                  | "array" "<" <type_ann> ">" | "Array" "<" <type_ann> ">"
                  | <type_ann> "?"
                  | "{" <record_field> ( "," <record_field> )* "}"
                  | <ident>   /* named type or type parameter */
                  | <sum_variant> ( "|" <sum_variant> )*

<record_field>  ::= <ident> ":" <type_ann>

<sum_variant>   ::= <ident> ( "(" <type_ann> ( "," <type_ann> )* ")" )?
```

- **Primitives:** `i64`, `str`, `unit`.
- **Arrays:** `array<T>` or `Array<T>` (e.g. `Array<i64>`, `Array<User>`).
- **Optional:** `T?` (e.g. `i64?`).
- **Record (inline):** `{ name: Type, ... }`.
- **Named type:** identifier (type alias or type parameter).
- **Sum type:** `Variant1(T1, T2) | Variant2 | ...` (payload optional).

### 13.1.3 Functions

```
<function_def>  ::= "fn" <ident> <type_params>? "(" <params>? ")" "->" <type_ann> "{" <stmt>* "}"

<type_params>   ::= "<" <ident> ( "," <ident> )* ">"

<params>        ::= <param> ( "," <param> )*

<param>         ::= <ident> ":" <type_ann>
```

- Functions have a name, optional type parameters, zero or more parameters, a return type, and a body of statements.

### 13.1.4 Statements

```
<stmt>          ::= "let" <ident> ( ":" <type_ann> )? "=" <expr> ";"
                  | <expr> ";"
                  | "return" ( <expr> )? ";"
                  | "for" <ident> "in" <expr> "{" <stmt>* "}"
                  | <lvalue> "=" <expr> ";"

<lvalue>        ::= <ident> | <expr> "." <ident>   /* expr must be Var or FieldAccess */
```

- **let:** binding with optional type annotation (required for empty array: `let result: Array<User> = [];`).
- **Expression statement:** e.g. `println(42);`
- **return:** with or without value.
- **for:** `for i in start..end { ... }` or `start..=end` or `start, next..end`.
- **Assignment:** to a variable or to a field (e.g. `x.field = value`).

### 13.1.5 Expressions (precedence from loose to tight)

We list expression levels from **lowest** to **highest** precedence. Each level can include the levels below it.

```
<expr>          ::= <expr_compare>   /* comparisons and below */
<expr_compare>  ::= <expr_range> ( ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) <expr_range> )*
<expr_range>    ::= <expr_add> ( ".." | "..=" | ( "," <expr_add> ".." ) ) <expr_add>?
<expr_add>      ::= <expr_mul> ( ( "+" | "-" ) <expr_mul> )*
<expr_mul>      ::= <expr_unary> ( ( "*" | "/" | "%" ) <expr_unary> )*
<expr_unary>    ::= <expr_primary> | ( "typeof" <expr_primary> )
<expr_primary>  ::= <int> | <string> | "null" | "unit"
                  | <ident> ( "(" <expr> ( "," <expr> )* ")" )?   /* call or var */
                  | "(" <expr> ")"
                  | "if" <expr> "then" <expr> "else" <expr>
                  | "[" ( <expr> ( "," <expr> )* )? "]"   /* array literal */
                  | "{" ( <record_field_expr> ( "," <record_field_expr> )* )? "}"   /* record literal */
                  | <expr> "." <ident>   /* field access */
                  | "match" <expr> "with" ( "|" <match_arm> )+ "end"

<record_field_expr> ::= <ident> ":" <expr>

<match_arm>     ::= <ident> ( "(" <ident> ( "," <ident> )* ")" )? "->" <expr>
```

- **Comparisons:** `==`, `!=`, `<`, `<=`, `>`, `>=` (left-associative).
- **Range:** `start..end` (exclusive), `start..=end` (inclusive), `start, next..end` (step = next − start).
- **Add/sub:** `+`, `-` (left-associative).
- **Mul/div/mod:** `*`, `/`, `%` (left-associative).
- **Primary:** literals, `unit`, `null`, variable, call, parenthesized expr, `if`–`then`–`else`, array literal, record literal, field access, `match`.
- **if** requires both **then** and **else** branches; use **`unit`** when the else branch has no meaningful value.
- **match:** `match e with | Variant(x) -> e1 | Other -> e2 end`; arms are exhaustive by variant.

### 13.1.6 Lexical structure (tokens)

```
<int>           ::= [0-9]+
<string>        ::= '"' ( <char> | '\' <escape> )* '"'
<escape>        ::= 'n' | 't' | 'r' | '"' | '\' | ...
<ident>         ::= ( [a-zA-Z] | "_" ) ( [a-zA-Z0-9] | "_" )*

/* Keywords (reserved) */
"let" | "for" | "in" | "fn" | "type" | "match" | "with" | "end"
| "if" | "then" | "else" | "return" | "null" | "typeof" | "unit"

/* Symbols */
"=" | "==" | "!=" | "->" | "|" | "<" | "<=" | ">" | ">="
| "," | ":" | ";" | "(" | ")" | "{" | "}" | "[" | "]"
| "+" | "-" | "*" | "/" | "%" | ".." | "..="
```

- Identifiers and keywords are as in the Part 1 lexer. The token `"unit"` is used as an expression producing the unit value (e.g. in the else branch of an **if**).
- String literals use double quotes and support common escapes.

### 13.1.7 Summary of the grammar

| Section        | Describes                                              |
|----------------|--------------------------------------------------------|
| Program        | Type definitions, functions, optional trailing main   |
| Type defs      | `type Name = ... ;` (record, alias, sum)              |
| Type annotations | i64, str, unit, Array&lt;T&gt;, T?, record, named, sum |
| Functions      | `fn name&lt;T&gt;(params) -> ret { stmts }`             |
| Statements     | let, expr;, return, for, assignment                   |
| Expressions    | Comparisons, ranges, add/sub, mul/div/mod, primaries |
| Lexical        | Integers, strings, identifiers, keywords, symbols       |

This grammar matches the language accepted by the Part 1 recursive-descent parser and type checker. Part 2’s goal is to accept the **same** language using a grammar-driven front-end.

---

## 13.2 Why grammar-driven parsing?

Grammar-driven parsing means you write the language’s structure in a **declarative grammar** (rules and productions), and a **parser generator** (or library) produces the lexer/parser from it. Benefits:

- **Single source of truth:** The grammar file documents the language and drives the parser.
- **Precedence and associativity:** Encoded in the grammar (e.g. expression levels), reducing ad-hoc precedence tables in hand-written code.
- **Maintainability:** Adding new constructs often means adding rules rather than threading new cases through many parser functions.
- **Consistency:** Part 2 can mirror Part 1’s language exactly by implementing this formal grammar.

---

## 13.3 Why Pest (and not another tool)?

We use **Pest** for Part 2 for these reasons:

1. **Pure Rust, no separate binary:** You add `pest` and `pest_derive` to `Cargo.toml`; the grammar is compiled at `cargo build` time. There is no separate parser-generator executable (unlike ANTLR or Bison), so setup and CI are simple.
2. **PEG semantics:** Pest uses **Parsing Expression Grammars**. The grammar is read in a single, deterministic way (ordered choice, no ambiguity resolution). You don’t need to think about LR(1) vs LALR vs conflicts; what you write is what you get. That fits a blog focused on “grammar → AST → LLVM” rather than parser theory.
3. **Good fit for a “second front-end”:** Part 1 already has a hand-written lexer and parser. Part 2 should accept the same AST and plug into the same type checker and codegen. Pest’s rule-based style and `Pair` API make it straightforward to walk the parse tree and build the same `Program` / `Expr` / `Stmt` types that Part 1 uses (or a conversion layer to them).
4. **Rust ecosystem:** Pest is widely used in Rust projects, has good docs and examples, and integrates with `#[derive(Parser)]` and a simple grammar file (`.pest`).

### Alternatives you might use

- **lalrpop:** LR(1) parser generator in Rust. Gives you LR parsing and good error messages. Slightly more setup than Pest; grammar style differs (no PEG). Good if you prefer LR and want to avoid PEG’s ordered-choice semantics.
- **nom / combine:** Parser combinators in Rust. No separate grammar file; you write parsers as Rust functions. Very flexible and great for streaming or custom error handling. More code for a full language; no single “grammar document” unless you write one by hand.
- **ANTLR:** Mature, multi-target parser generator. Can generate Rust. Heavier dependency and toolchain; often used when you need multiple target languages or existing ANTLR grammars.
- **Hand-written recursive descent (Part 1):** Full control and no extra dependency. We keep it in Part 1 for contrast; Part 2 shows the grammar-driven alternative.

For this series, Pest keeps Part 2 concise and aligns with “one grammar file, logic in Rust.”

---

## 13.4 Prerequisites

- **Rust** (rustc, cargo) via rustup  
- **LLVM 17 or 18** (for codegen; same as Part 1)  
- **pest** and **pest_derive** crates (for the grammar-driven front-end)

---

## 13.5 Part 2 project layout

```
source/part2-pest/
├── 00-install/          # Toolchain verification (Rust, LLVM, Inkwell)
├── 01-lexer/            # Pest lexer grammar + token stream
├── 02-parser/            # Pest parser grammar + AST builder
├── 03-typecheck/         # Type checking (reuses Part 1 logic)
├── 04-codegen/           # Code generation (reuses Part 1)
├── 05-runtime-stdlib/    # Runtime (same as Part 1)
├── 06-gc/                # GC hook names (same as Part 1)
├── 07-optimization/      # Optional opt (same as Part 1)
├── 08-targets/           # Target triple (same as Part 1)
├── 09-lum-cli/           # Lum CLI wired to Pest front-end
└── grammar/              # Shared .pest grammar files (optional)
```

Only the **front-end** (lexer + parser) is implemented with Pest; from AST onward the pipeline is shared with Part 1.

---

## 13.6 Summary

We have a **formal grammar** for Lumina (program, types, functions, statements, expressions, and lexical structure) that matches the language implemented in Part 1. Part 2 uses **grammar-driven parsing** with **Pest** for a declarative, PEG-based front-end; alternatives include lalrpop, nom/combine, and ANTLR. The next chapters implement the lexer, parser, and rest of the Part 2 pipeline with the same examples as in Chapters 3–12, including code walkthroughs and dependency explanations.

**Next:** **Chapter 14 — Part 2 installation** (project setup and toolchain verification in `00-install`).
