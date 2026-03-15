# Chapter 2: Grammar Representation and Parsing the Grammar File

**Previous:** [Chapter 1 — Introduction](01-introduction.md)

This chapter focuses on **reading an ANTLR4 grammar file** and turning it into an internal **grammar representation** (grammar IR) that the rest of our parser generator will use.

For the **reference implementation and CLI**, the end-to-end pipeline uses the **.grammar** format (with semantic actions) and **`grammar_loader`** (see §2.9). The .g4 format is supported as a subset for learning and optional parsing (§2.8); the generator consumes the same Grammar IR from either source.

## 2.1 Goals

- Parse a `.g4` file (ANTLR4 format) into a structured form.
- Build an **intermediate representation (IR)** that has:
  - Lexer rules (names, patterns, fragments).
  - Parser rules (rule name, alternatives, elements).
  - Clear separation between lexer and parser, and ordering for lexer rules.

We will **not** implement the full ANTLR4 spec in one go; we start with a **usable subset** and extend it as needed.

## 2.2 ANTLR4 Grammar File Structure (Subset)

A typical `.g4` file looks like:

```antlr
grammar Name;   // or lexer grammar / parser grammar

options { ... }
import ... ;

// Lexer rules: uppercase
TOKEN_NAME : 'literal' | [a-z] | [A-Z]+ ;
FRAGMENT   : 'x' ;   // fragment rule

// Parser rules: lowercase
ruleName   : alt1 | alt2 ;
another    : elem ( ',' elem )* ;
```

We need to support:

- **Grammar declaration:** `grammar X;`, optionally `lexer grammar` / `parser grammar`.
- **Lexer rules:** Name (uppercase), colon, definition (alternatives, ranges, literals, references to fragments).
- **Parser rules:** Name (lowercase), colon, alternatives with `|`, elements: rules, tokens, `(...)`, `(...)?`, `(...)*`, `(...)+`.
- **Comments** and **options/imports** can be skipped or parsed minimally at first.

## 2.3 Bootstrapping: How Do We Parse the Grammar?

We have a chicken-and-egg problem: we want to build a parser generator that reads grammars, but we need something to parse the grammar file. Options:

1. **Hand-written recursive descent** for the ANTLR4 grammar subset (recommended for learning).
2. Use an **existing** ANTLR4 (or other) tool to parse `.g4` and then generate our IR (pragmatic but hides the details).
3. A **minimal hand-written lexer + parser** just for our supported `.g4` subset.

For this tutorial we use **(1) or (3)**: a hand-written lexer and parser for our chosen `.g4` subset. That way we implement every step ourselves.

## 2.4 Grammar IR Design (Rust)

Define structures that represent what we need for code generation.

### 2.4.1 Lexer Rules

- **Name** (e.g. `ID`, `INT`).
- **Definition:** alternatives of **elements**.
- **Element:** literal string, character range `[a-z]`, character set `[abc]`, reference to another rule (e.g. fragment), `~` (negation).
- **Fragment flag:** fragment rules don’t become tokens; they are building blocks for other lexer rules.

```rust
pub struct LexerRule {
    pub name: String,
    pub fragment: bool,
    pub skip: bool,  // if true, don't emit a token (e.g. whitespace, comments)
    pub alternatives: Vec<LexerAlt>,  // list of alternative patterns
}

pub struct LexerAlt {
    pub elements: Vec<LexerElement>,
}

pub enum LexerElement {
    Literal(String),
    CharRange(char, char),
    CharSet(Vec<char>),
    RuleRef(String),
    Negated(Box<LexerElement>),
    OneOrMore(Box<LexerElement>),  // e.g. [0-9]+ for INT
}
```

### 2.4.2 Parser Rules

- **Name** (e.g. `expr`, `statement`).
- **Alternatives:** each alternative is a sequence of **parser elements**.
- **Parser element:** reference to parser rule, reference to lexer rule, literal, grouped element with `?` / `*` / `+`.

```rust
pub struct ParserRule {
    pub name: String,
    pub alternatives: Vec<ParserAlt>,
}

pub struct ParserAlt {
    pub elements: Vec<ParserElement>,
    /// Semantic action: Rust code for this alternative. $1, $2, ... refer to element values (see Ch. 4).
    pub action: Option<String>,
}

pub enum ParserElement {
    RuleRef(String),
    TokenRef(String),
    Literal(String),
    Group(Vec<ParserElement>),
    Optional(Box<ParserElement>),
    ZeroOrMore(Box<ParserElement>),
    OneOrMore(Box<ParserElement>),
}
```

### 2.4.3 Top-Level Grammar

```rust
pub struct Grammar {
    pub name: String,
    pub lexer_rules: Vec<LexerRule>,
    pub parser_rules: Vec<ParserRule>,
}
```

Order of `lexer_rules` matters (first match wins in typical lexers). Parser rule order is used for alternative ordering.

## 2.5 Implementing the Grammar Parser

Steps:

1. **Lexer for `.g4`:**
   - Tokens: identifier, string literal, `|`, `:`, `;`, `(`, `)`, `[`, `]`, `*`, `+`, `?`, `~`, etc.
   - Skip whitespace and line/block comments.

2. **Recursive descent parser for our subset:**
   - Parse `grammar Name;`.
   - For each rule:
     - If name is uppercase → lexer rule: parse `:`, then alternatives of lexer elements until `;`.
     - If name is lowercase → parser rule: same idea with parser alternatives and elements.
   - Handle `fragment` keyword before lexer rule name.

3. **Build IR:** Fill `Grammar`, `LexerRule`, `ParserRule`, and the element types as you parse.

## 2.6 Validation and Normalization

- **Lexer:** Check that fragment rules are only referenced by other lexer rules; token rules have at least one non-fragment definition.
- **Parser:** Check that rule references (parser or lexer) exist.
- **Start rule:** Identify which parser rule is the entry (e.g. first parser rule or one named `start`/`program`). Use it later for the generated parser entry point.

## 2.7 Output of This Stage

After this chapter we have:

- A **Grammar** value (in memory) built from a `.g4` file.
- No generated code yet—only the IR that the **lexer generator** (Chapter 3) and **parser/AST generator** (Chapter 4) will consume.

## 2.8 Using the IR Before a Full .g4 Parser Exists

Until we implement a complete parser for arbitrary `.g4` files, the tutorial uses a **hand-built grammar IR**: we construct `Grammar`, `LexerRule`, and `ParserRule` values in code (e.g. in tests or in a small helper). The integration test in `source/code/tests/integration_test.rs` shows how to build a minimal Expr-like grammar by hand and pass it to the lexer and parser generators.

Optionally, you can implement a **minimal .g4 parser** for a tiny subset (e.g. `grammar Name;` followed by a few rules like `INT : [0-9]+ ;`). The reference crate includes a minimal parser in `source/code/src/g4_parser.rs` that can parse a small subset of `.g4` and produce a `Grammar`; see that module for a starting point.

## 2.9 Grammar File with Semantic Actions (Reference Implementation)

The reference crate also supports a **.grammar** file format that includes **semantic actions** for each parser alternative. This allows the parser generator (Chapter 4) to emit a **full** parser that builds the AST by executing those actions.

### 2.9.1 Format

- **Optional header:** `grammar Name;`
- **Lexer rules:** `NAME : pattern ;` — pattern can be a literal in single quotes (`'+'`) or a character class (`[0-9]+`). Optionally `-> skip` for whitespace/comments.
- **Parser rules:** `ruleName : symbol symbol ... { action } ;` — symbols are UPPERCASE (token) or lowercase (rule ref). The **action** is Rust code in braces; `$1`, `$2`, … refer to the 1st, 2nd, … element’s value (parsed result or token).
- Multiple alternatives for the same rule: repeat the rule name with `|` or on a new line (e.g. `expr : term { $1 } ;` and `expr : term PLUS expr { ... } ;`).

Example (excerpt from `source/examples/grammars/Expr.grammar`):

```text
grammar Expr;
INT   : [0-9]+ ;
PLUS  : '+' ;
start : expr Eof { $1 } ;
expr  : term PLUS expr { Expr::Binary { left: Box::new($1), op: BinOp::Add, right: Box::new($3) } } ;
expr  : term { $1 } ;
factor : INT { Expr::Literal($1.text.parse().unwrap_or(0)) } ;
```

### 2.9.2 Loader

**`source/code/src/grammar_loader.rs`** provides:

- **`load_grammar(source: &str)`** — parse a string into a `Grammar` (lexer rules + parser rules with `ParserAlt.action` set from the `{ ... }` blocks).
- **`load_grammar_file(path: &Path)`** — read file and call `load_grammar`.

The loader parses lexer patterns (literals, `[range]+`), skips `//` and `/* */` comments, and for parser rules extracts the action by brace-matching so that nested `{ }` inside the action are handled correctly. The resulting `Grammar` is passed to the lexer generator (Chapter 3) and parser generator (Chapter 4) to produce a complete lexer and parser. When writing parser rules, use **right-recursive** forms (e.g. `expr : term PLUS expr | term`) to avoid left recursion; see **Chapter 4, §4.11** for details.

---

**Next:** [Chapter 3 — Lexer Generator](03-lexer-generator.md)
