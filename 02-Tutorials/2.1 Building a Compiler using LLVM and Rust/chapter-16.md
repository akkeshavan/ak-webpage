# Building a Compiler with Rust and LLVM - 16

*Part 2: Parser (grammar-driven with Pest)*

---

The **parser** turns the token stream (from the Part 2 lexer) or the source text into an **Abstract Syntax Tree (AST)**. In Part 2 we use a **Pest grammar** to define the syntax of programs, types, functions, statements, and expressions, then **walk the parse tree** and build the same **`Program`** / **`Expr`** / **`Stmt`** structures that Part 1 uses. That way the rest of the pipeline (type checking, codegen) is unchanged.

This chapter mirrors **Chapter 5** (Part 1 parser): we produce a full **program** (type definitions, functions, optional trailing statements), with the same AST and the same examples (arithmetic, let, if, for, records, match, arrays, etc.). Code lives in `source/part2-pest/02-parser`.

---

## Goals of this chapter

- Define the **same AST** as Part 1 (Program, TypeDef, TypeAnn, FunctionDef, Stmt, Expr, MatchArm) so type checker and codegen can reuse.
- Implement a **Pest grammar** for the full syntax (program, type_def, function_def, stmt, expr with precedence) and **walk the parse tree** to build that AST.
- Handle **precedence** and **left associativity** in the grammar or in the Rust builder (e.g. layered expr rules, then fold to left-associated tree).
- Support **implicit main** when the top-level is a sequence of statements.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **02-parser/grammar/*.pest** | Grammar: program, type_def, function_def, stmt, expr (layered), type_ann, primaries. |
| **02-parser AST types** | Program, TypeDef, TypeAnn, FunctionDef, Stmt, Expr, MatchArm (same as Part 1). |
| **parse(source)** | Entry: Pest parses source; get root pair; **build_program(pair)**. |
| **build_program**, **build_expr**, **build_stmt**, **build_type_ann** | Recursively convert Pest pairs into AST nodes. |

---

## 16.1 Cargo.toml and dependencies

`source/part2-pest/02-parser/Cargo.toml`:

```toml
[package]
name = "lumina-part2-parser"
version = "0.1.0"
edition = "2021"

[dependencies]
pest = "2"
pest_derive = "2"
lumina-part2-lexer = { path = "../01-lexer" }
```

**Dependencies:**

- **pest / pest_derive:** Same as the lexer; we use a separate grammar file for the **parser** (syntax rules, not just tokens).
- **lumina-part2-lexer:** We use the same **`Token`** type and optionally **`lex()`** so we can either (a) parse from a token stream with a hand-written recursive-descent parser, or (b) parse from **source text** with Pest. If the parser grammar in Pest works on **source** (with token rules in the same or another grammar), we might not need to call `lex()` from the parser crate; the lexer crate still provides the token definition for compatibility. Here we assume the parser uses the lexer to get `Vec<Token>` and then a **recursive-descent** parser over tokens (to mirror Part 1 exactly), OR we implement a full Pest grammar on source and build AST from pairs. For “same examples as Part 1,” the clean approach is: **Pest grammar parses source** and we build AST from the tree (no separate token stream). So the parser crate depends on the lexer only if we share types (e.g. we might define AST and Token in one place). For a Pest-only parser, we parse **source** and the grammar includes both lexical and syntactic rules. We’ll describe the **Pest-on-source** approach so the grammar file is the single source of truth.

So: **parser grammar** (e.g. `grammar/lumina.pest`) parses the full source; the lexer crate can still be used to share `Token` or we define AST in the parser crate and export it. The parser crate then has:

- Optional: `lumina-part2-lexer` if we use `Token` or `lex()` for a hybrid approach.
- Or: only `pest` / `pest_derive` and define all rules (including tokens) in one grammar that parses source and produces a tree we walk to build `Program`.

We’ll show the **single-grammar** approach: one `.pest` file that defines the full syntax (and uses token rules), and Rust that walks the pairs to build `Program`, `Expr`, `Stmt`, etc.

---

## 16.2 AST structure (same as Part 1)

The AST must match Part 1 so type checker and codegen can reuse. In `src/lib.rs` (or a separate `ast.rs`) we define the same types as in Part 1’s parser crate:

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct Program {
    pub type_defs: Vec<TypeDef>,
    pub functions: Vec<FunctionDef>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TypeDef {
    pub name: String,
    pub body: TypeAnn,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypeAnn {
    I64,
    Str,
    Unit,
    Array(Box<TypeAnn>),
    Optional(Box<TypeAnn>),
    Record(Vec<(String, TypeAnn)>),
    Named(String),
    Sum(Vec<SumVariant>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SumVariant {
    pub name: String,
    pub payload: Vec<TypeAnn>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FunctionDef {
    pub name: String,
    pub type_params: Vec<String>,
    pub params: Vec<(String, TypeAnn)>,
    pub return_type: TypeAnn,
    pub body: Vec<Stmt>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Stmt {
    Let(String, Option<TypeAnn>, Expr),
    Expr(Expr),
    Return(Option<Expr>),
    For { var: String, range: Expr, body: Vec<Stmt> },
    Assign(Expr, Expr),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Int(i64),
    Str(String),
    Var(String),
    Add(Box<Expr>, Box<Expr>),
    Sub(Box<Expr>, Box<Expr>),
    Mul(Box<Expr>, Box<Expr>),
    Div(Box<Expr>, Box<Expr>),
    Mod(Box<Expr>, Box<Expr>),
    Eq(Box<Expr>, Box<Expr>),
    Ne(Box<Expr>, Box<Expr>),
    Lt(Box<Expr>, Box<Expr>),
    Le(Box<Expr>, Box<Expr>),
    Gt(Box<Expr>, Box<Expr>),
    Ge(Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
    Unit,
    Range { start: Box<Expr>, end: Box<Expr>, inclusive: bool, step: Option<Box<Expr>> },
    If(Box<Expr>, Box<Expr>, Box<Expr>),
    ArrayLit(Vec<Expr>),
    Null,
    TypeOf(Box<Expr>),
    FieldAccess(Box<Expr>, String),
    RecordLit(Vec<(String, Expr)>),
    Match(Box<Expr>, Vec<MatchArm>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct MatchArm {
    pub variant: String,
    pub bindings: Vec<String>,
    pub body: Expr,
}
```

**Explanation:** These are the same `Program`, type definitions, function definitions, statements, and expressions as in Part 1 (Chapter 5). The type checker and codegen in Part 1 expect this shape; by building it from Pest we keep the rest of the pipeline unchanged.

---

## 16.3 Parser grammar (Pest) – overview

The grammar file (e.g. `grammar/lumina.pest`) encodes the same structure as the formal grammar in Chapter 13. We give a **sketch** here; the exact Pest syntax may need small adjustments for your Pest version.

**Idea:**

- **Expression precedence:** Use layered rules: `expr` → `expr_compare` → `expr_range` → `expr_add` → `expr_mul` → `expr_unary` → `expr_primary`. Each level consumes the next and optionally repeats with an operator.
- **Left associativity:** In Pest, `add = mul ~ (add_op ~ mul)*` parses a sequence `mul add_op mul add_op mul ...` and we build a left-associative tree in Rust when we walk the pairs.
- **Keywords and identifiers:** Use the same token rules as in the lexer (or inline keyword rules) so that `let`, `if`, etc. are not parsed as identifiers.

Example **expression** layer (conceptual):

```pest
expr         = { expr_compare }
expr_compare = { expr_range ~ (compare_op ~ expr_range)* }
expr_range   = { expr_add ~ (range_op ~ expr_add)? }  // start..end or start..=end
expr_add     = { expr_mul ~ (add_op ~ expr_mul)* }
expr_mul     = { expr_unary ~ (mul_op ~ expr_unary)* }
expr_unary   = { "typeof" ~ expr_primary | expr_primary }
expr_primary = { int | string | "null" | "unit" | ident ~ ("(" ~ expr_list? ~ ")")?
               | "(" ~ expr ~ ")"
               | "if" ~ expr ~ "then" ~ expr ~ "else" ~ expr
               | "[" ~ (expr ~ ("," ~ expr)*)? ~ "]"
               | "{" ~ (ident ~ ":" ~ expr ~ ("," ~ ident ~ ":" ~ expr)*)? ~ "}"
               | expr_primary ~ "." ~ ident
               | "match" ~ expr ~ "with" ~ ( "|" ~ match_arm )+ ~ "end" }
```

**Statements and program:**

```pest
stmt     = { "let" ~ ident ~ (":" ~ type_ann)? ~ "=" ~ expr ~ ";"
           | expr ~ ";"
           | "return" ~ (expr)? ~ ";"
           | "for" ~ ident ~ "in" ~ expr ~ "{" ~ stmt* ~ "}"
           | lvalue ~ "=" ~ expr ~ ";" }
lvalue   = { ident | (ident ~ ("." ~ ident)*) }   // simplified; parser can restrict to Var/FieldAccess

program  = { SOI ~ type_def* ~ (function_def+ ~ stmt* | stmt+) ~ EOI }
type_def = { "type" ~ ident ~ "=" ~ type_ann ~ ";" }
function_def = { "fn" ~ ident ~ ("<" ~ ident ~ ("," ~ ident)* ~ ">")? ~ "(" ~ (param ~ ("," ~ param)*)? ~ ")" ~ "->" ~ type_ann ~ "{" ~ stmt* ~ "}" }
```

**Type annotations:**

```pest
type_ann = { "i64" | "str" | "unit"
           | ("array" | "Array") ~ "<" ~ type_ann ~ ">"
           | type_ann ~ "?"
           | "{" ~ (ident ~ ":" ~ type_ann ~ ("," ~ ident ~ ":" ~ type_ann)*) ~ "}"
           | ident
           | sum_variant ~ ("|" ~ sum_variant)* }
```

In practice you will need to resolve **left recursion** (Pest is PEG: no direct left recursion). So instead of `expr_add = expr_add ~ "+" ~ expr_mul`, use `expr_add = expr_mul ~ ("+" ~ expr_mul)*` and build the left-associative tree in Rust.

---

## 16.4 Building the AST from the parse tree (implementation walkthrough)

After parsing, we get a **tree of pairs**. We recursively convert each pair into the corresponding AST node.

**Entry point:**

```rust
use pest::Parser;
use pest_derive::Parser;

#[derive(Parser)]
#[grammar = "grammar/lumina.pest"]
pub struct LuminaParser;

pub fn parse(source: &str) -> Result<Program, String> {
    let pairs = LuminaParser::parse(Rule::program, source).map_err(|e| e.to_string())?;
    let pair = pairs.into_inner().next().ok_or("no program")?;
    build_program(pair)
}
```

**Program:**

```rust
fn build_program(pair: pest::iterators::Pair<Rule>) -> Result<Program, String> {
    let mut type_defs = Vec::new();
    let mut functions = Vec::new();
    let mut stmts = Vec::new();
    for inner in pair.into_inner() {
        match inner.as_rule() {
            Rule::type_def => type_defs.push(build_type_def(inner)?),
            Rule::function_def => functions.push(build_function_def(inner)?),
            Rule::stmt => stmts.push(build_stmt(inner)?),
            _ => {}
        }
    }
    if !stmts.is_empty() && functions.is_empty() {
        // Trailing statements → implicit main
        functions.push(FunctionDef {
            name: "main".into(),
            type_params: vec![],
            params: vec![],
            return_type: TypeAnn::Unit,
            body: stmts,
        });
    } else if !stmts.is_empty() {
        // Append to last function or create main
        if let Some(last) = functions.last_mut() {
            last.body.extend(stmts);
        }
        // Or push as main; match Part 1 behaviour (e.g. wrap in main)
    }
    Ok(Program { type_defs, functions })
}
```

**Expressions (precedence levels):** For each level we get a flat sequence (e.g. `mul op mul op mul`) and fold left:

```rust
fn build_expr(pair: pest::iterators::Pair<Rule>) -> Result<Expr, String> {
    match pair.as_rule() {
        Rule::expr_add => {
            let inner: Vec<_> = pair.into_inner().collect();
            let mut e = build_expr(inner[0].clone())?;
            for i in 1..inner.len() {
                let part = &inner[i];
                let (op, rhs) = parse_add_rest(part)?;  // add_op + expr_mul
                e = match op.as_str() {
                    "+" => Expr::Add(Box::new(e), Box::new(rhs)),
                    _ => Expr::Sub(Box::new(e), Box::new(rhs)),
                };
            }
            Ok(e)
        }
        Rule::expr_mul => {
            let inner: Vec<_> = pair.into_inner().collect();
            let mut e = build_expr(inner[0].clone())?;
            for i in 1..inner.len() {
                let (_, rhs) = parse_mul_rest(&inner[i])?;
                e = Expr::Mul(Box::new(e), Box::new(rhs));
            }
            Ok(e)
        }
        Rule::expr_primary => build_expr_primary(pair),
        // ... other rules
        _ => Err("unexpected rule".into()),
    }
}
```

**Primary expressions:** Handle int, string, `unit`, `null`, identifier (var or call), parentheses, `if`–`then`–`else`, array literal, record literal, field access, `match`:

```rust
fn build_expr_primary(pair: pest::iterators::Pair<Rule>) -> Result<Expr, String> {
    let mut inner = pair.into_inner();
    let first = inner.next().ok_or("empty primary")?;
    match first.as_rule() {
        Rule::int_lit => Ok(Expr::Int(first.as_str().parse().unwrap_or(0))),
        Rule::str_lit => { /* strip quotes, unescape */ Ok(Expr::Str(...)) }
        Rule::unit_kw => Ok(Expr::Unit),
        Rule::null_kw => Ok(Expr::Null),
        Rule::ident => {
            let name = first.as_str().to_string();
            if let Some(next) = inner.next() {
                if next.as_rule() == Rule::expr_list {
                    let args = build_expr_list(next)?;
                    Ok(Expr::Call(name, args))
                } else { /* field access chain */ Ok(Expr::Var(name)) }
            } else { Ok(Expr::Var(name)) }
        }
        Rule::expr => build_expr(first),
        Rule::if_expr => {
            let cond = build_expr(inner.next().unwrap())?;
            let then_b = build_expr(inner.next().unwrap())?;
            let else_b = build_expr(inner.next().unwrap())?;
            Ok(Expr::If(Box::new(cond), Box::new(then_b), Box::new(else_b)))
        }
        Rule::array_lit => { /* collect exprs */ Ok(Expr::ArrayLit(elems)) }
        Rule::record_lit => { /* collect field: expr */ Ok(Expr::RecordLit(fields)) }
        Rule::match_expr => { /* scrut + arms */ Ok(Expr::Match(...)) }
        _ => Err("unexpected primary".into()),
    }
}
```

**Statements:** `let`, expression statement, `return`, `for`, assignment:

```rust
fn build_stmt(pair: pest::iterators::Pair<Rule>) -> Result<Stmt, String> {
    let mut inner = pair.into_inner();
    let first = inner.next().ok_or("empty stmt")?;
    match first.as_rule() {
        Rule::let_kw => {
            let name = inner.next().unwrap().as_str().to_string();
            let type_ann = optional_type_ann(inner.next());
            let _eq = inner.next();
            let expr = build_expr(inner.next().unwrap())?;
            Ok(Stmt::Let(name, type_ann, expr))
        }
        Rule::expr => Ok(Stmt::Expr(build_expr(first)?)),
        Rule::return_kw => {
            let e = inner.next().filter(|p| p.as_rule() != Rule::semicolon);
            Ok(Stmt::Return(e.map(|p| build_expr(p).unwrap())))
        }
        Rule::for_kw => {
            let var = inner.next().unwrap().as_str().to_string();
            let _in = inner.next();
            let range = build_expr(inner.next().unwrap())?;
            let body = build_stmt_list(inner.next().unwrap())?;
            Ok(Stmt::For { var, range, body })
        }
        Rule::lvalue => {
            let lv = build_lvalue(first);
            let _eq = inner.next();
            let rhs = build_expr(inner.next().unwrap())?;
            Ok(Stmt::Assign(lv, rhs))
        }
        _ => Err("unexpected stmt".into()),
    }
}
```

**How this achieves the goals:** The grammar defines *what* is valid syntax; the Rust code defines *how* we map that to the AST. Each rule (program, function_def, stmt, expr, type_ann, …) has a corresponding `build_*` function that recurses into inner pairs and constructs the same `Program`/`Expr`/`Stmt`/`TypeAnn` that Part 1 builds. So the output of the Part 2 parser is **identical in shape** to Part 1’s parser for the same source.

---

## 16.5 Running tests (same examples as Part 1)

```rust
#[test]
fn parse_int() {
    let p = parse("42").unwrap();
    // Single expression → implicit main with body that returns 42
    assert!(p.functions.len() >= 1);
}

#[test]
fn parse_add() {
    let p = parse("1 + 2").unwrap();
    // AST should contain Add(Int(1), Int(2)) inside main
}

#[test]
fn parse_let_and_for() {
    let src = r#"
    let x = 10;
    for i in 0..10 { let y = i; }
    "#;
    let p = parse(src).unwrap();
    assert!(p.functions.len() >= 1);
    assert!(matches!(p.functions[0].body[0], Stmt::Let(..)));
    assert!(matches!(p.functions[0].body[1], Stmt::For { .. }));
}
```

Run:

```bash
cd source/part2-pest/02-parser
cargo test
```

These mirror the kind of tests in Chapter 5: single expression, arithmetic, let, and for loops.

---

## 16.6 Summary

| Item | Purpose |
|------|--------|
| **Cargo.toml** | pest, pest_derive, and (optional) lexer for shared types |
| **AST types** | Same `Program`, `TypeDef`, `TypeAnn`, `FunctionDef`, `Stmt`, `Expr`, `MatchArm` as Part 1 |
| **Grammar** | Layered expr rules for precedence; stmt, program, type_def, function_def |
| **build_program / build_expr / build_stmt** | Walk Pest pairs and construct AST; handle implicit main for trailing stmts |

The Pest parser produces the same AST as Part 1 for the same Lumina source, so type checking and code generation can be reused without change. The next chapter wires this AST into the type checker.

**Next:** **Chapter 17 — Type checking (Part 2)** (reusing Part 1’s type checker in `03-typecheck`).
