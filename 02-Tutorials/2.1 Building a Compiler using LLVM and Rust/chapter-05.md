# Building a Compiler with Rust and LLVM - 5

*Parser (Part 1: hand-written)*

---

The **parser** turns the token stream from the lexer into an **Abstract Syntax Tree (AST)**. In Part 1 we use a hand-written parser with precedence-aware routines for arithmetic and comparisons. The parser builds a full **program** (type definitions, functions, optional trailing statements). The crate’s public API is **`parse(source: &str) -> Result<Program, ParseError>`**. Code lives in `source/part1-recursive-descent/02-parser`.

---

## Goals of this chapter

- Define the **AST** (Program, TypeDef, TypeAnn, FunctionDef, Stmt, Expr, MatchArm) that the rest of the pipeline uses.
- Implement **recursive-descent parsing**: lex first, then walk tokens with a **Parser** (peek / advance) and build the tree.
- Encode **precedence** (e.g. comparisons looser than add/sub, add/sub looser than mul/div/mod, primaries tightest) and **associativity** (left for binary ops) via a binding-power or layered expression parser.
- Parse **top-level** structure: type definitions, function definitions, and optional trailing statements (wrapped in an implicit main).

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **AST types** (in `02-parser/src/lib.rs`) | `Program`, `TypeDef`, `TypeAnn`, `SumVariant`, `FunctionDef`, `Stmt`, `Expr`, `MatchArm`, `ParseError`. |
| **`parse(source)`** | Calls `lex(source)`, then `Parser::new(&tokens).parse_program()`. |
| **`Parser`** | Holds `tokens: &[Token]`, `pos: usize`; methods `peek()`, `advance()`, `expect_*` for terminals. |
| **`parse_program`** | Parses `type_def*`, then either `function_def+` and optional trailing stmts, or just trailing stmts (implicit main). |
| **`parse_expr_*`** | Layered: primary → unary → mul/div/mod → add/sub → range → compare; binding power or recursive calls encode precedence. |
| **`parse_stmt`**, **`parse_type_ann`** | Handle let, return, for, assignment; and i64, str, array, record, sum, etc. |

---

## Dependencies (Cargo.toml) for this chapter

```toml
[package]
name = "lumina-part1-parser"
version = "0.1.0"
edition = "2021"

[dependencies]
lumina-part1-lexer = { path = "../01-lexer" }
```

- **lumina-part1-lexer:** The parser takes **source** and calls **`lex(source)`** to get `Vec<Token>`, then parses that slice. So the only dependency is the lexer; no type checker or codegen yet.

---

## 5.1 AST Structure

Originally this chapter started with a tiny expression-only AST. The current AST includes:

- **Type definitions** at the top: `type Name = ... ;` (records, type aliases, or **sum types** like `Option = Some(i64) | None`)
- `Program { type_defs, functions }`
- `FunctionDef { name, type_params, params, return_type, body }`
- statements (`let`, expression statements, `return`, `for`, and assignment)
- expressions (arithmetic including `%` modulus, comparisons, calls, `if`, range, **record literals** and **field access**, **constructor calls** for sum types, and **match** `match expr with | Variant(x) -> e ... end`)

The range form is:

- `start..end` (exclusive)
- `start..=end` (inclusive)
- `start,next..end` (derived step \(= next - start\))

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Int(i64),
    Var(String),
    Add(Box<Expr>, Box<Expr>),
    Sub(Box<Expr>, Box<Expr>),
    Mul(Box<Expr>, Box<Expr>),
    Div(Box<Expr>, Box<Expr>),
    Mod(Box<Expr>, Box<Expr>),
    // ... plus comparisons, calls, if, range, records, match, etc.
}
```

---

## 5.2 Recursive Descent Basics

The parser holds a mutable slice of tokens and a position. We peek at the current token and advance by calling `advance()`:

```rust
pub struct Parser<'a> {
    tokens: &'a [Token],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn advance(&mut self) -> Option<&Token> {
        let t = self.tokens.get(self.pos);
        if t.is_some() {
            self.pos += 1;
        }
        t
    }
}
```

---

## 5.3 Expression Parsing with Precedence

The current parser keeps arithmetic precedence (mul/div/mod tighter than add/sub) and comparison precedence (comparisons looser than arithmetic).

### Update: range precedence

Ranges bind **looser than arithmetic** but **tighter than comparisons**. Practically:

- `1 + 2 .. 10` means `(1 + 2) .. 10`
- `1 .. 10 == 3` means `(1 .. 10) == 3` (and is rejected by the type checker, because ranges aren’t comparable)

Implementation-wise we insert a `parse_expr_range()` stage between arithmetic (`parse_expr_add`) and comparisons (`parse_expr_compare`).

### Update: top-level statements

When the file starts with a statement keyword like `for` or `let`, we parse a *sequence of statements* up to EOF and wrap them in an implicit:

- `fn main() -> unit { ... }`

We also allow **function definitions followed by top-level statements**; trailing statements are wrapped into an implicit `main()` (unless you already defined `main`, in which case we error).

```rust
fn parse_expr(&mut self) -> Result<Expr, ParseError> {
    self.parse_expr_bp(0)
}

fn parse_expr_bp(&mut self, min_bp: u8) -> Result<Expr, ParseError> {
    let mut lhs = self.parse_primary()?;
    loop {
        let op = match self.peek() {
            Some(Token::Plus) => {
                self.advance();
                BinOp::Add
            }
            Some(Token::Minus) => {
                self.advance();
                BinOp::Sub
            }
            Some(Token::Star) => {
                self.advance();
                BinOp::Mul
            }
            _ => break,
        };
        let (l_bp, r_bp) = op.precedence();
        if l_bp < min_bp {
            break;
        }
        let rhs = self.parse_expr_bp(r_bp)?;
        lhs = match op {
            BinOp::Add => Expr::Add(Box::new(lhs), Box::new(rhs)),
            BinOp::Sub => Expr::Sub(Box::new(lhs), Box::new(rhs)),
            BinOp::Mul => Expr::Mul(Box::new(lhs), Box::new(rhs)),
        };
    }
    Ok(lhs)
}

fn parse_primary(&mut self) -> Result<Expr, ParseError> {
    match self.advance() {
        Some(Token::IntLit(n)) => Ok(Expr::Int(*n)),
        Some(Token::Ident(s)) => Ok(Expr::Var(s.clone())),
        Some(Token::LParen) => {
            let e = self.parse_expr()?;
            match self.advance() {
                Some(Token::RParen) => Ok(e),
                _ => Err(ParseError::Unexpected("expected )".into())),
            }
        }
        _ => Err(ParseError::Unexpected("expected primary expression".into())),
    }
}

enum BinOp {
    Add,
    Sub,
    Mul,
}

impl BinOp {
    fn precedence(&self) -> (u8, u8) {
        match self {
            BinOp::Add | BinOp::Sub => (1, 2),
            BinOp::Mul => (3, 4),
        }
    }
}
```

The “binding power” loop builds a left-associated AST while preserving precedence:

- `*`, `/`, and `%` bind tighter than `+` / `-`
- parentheses recurse back into `parse_expr()`

**Implementation walkthrough:**

1. **`parse(source)`** – Lexes with `lex(source)`; builds `Parser { tokens, pos: 0 }`; calls `parse_program()`.
2. **`parse_program`** – While current token is `Type`, parse type defs. Then either parse one or more function defs (and optionally trailing stmts) or parse a sequence of stmts and wrap them in an implicit `main()`.
3. **Expression parsing** – **`parse_expr`** (or **`parse_expr_bp(0)`**) is the entry. **`parse_expr_bp(min_bp)`** parses a primary (int, ident, call, parenthesized expr, if, array literal, record literal, match, etc.), then in a loop peeks at binary operators. Each operator has a left and right binding power; if `min_bp` is greater than the left binding power, the loop stops (so tighter ops are parsed first when we call with higher `min_bp`). Otherwise we consume the op, parse the RHS with the op’s right binding power, and combine into a new AST node (e.g. `Add`, `Mul`). Result: left-associative tree with correct precedence.
4. **Ranges** – A dedicated **`parse_expr_range`** (or equivalent) sits between add/sub and comparisons so that `1 + 2 .. 10` is `(1+2)..10` and ranges can be used in `for i in start..end`.
5. **Statements** – **`parse_stmt`** handles `let` (optional type annotation), expression statement, `return`, `for var in range { body }`, and assignment (LHS variable or field, then `=`, then expr).
6. **Types and functions** – **`parse_type_ann`** parses i64, str, unit, array&lt;T&gt;, T?, record `{ ... }`, named type, sum variants. **`parse_function_def`** parses `fn name &lt;type_params&gt; ( params ) -> return_type { body }`.

---

## 5.4 Running tests

```bash
cd source/part1-recursive-descent/02-parser
cargo test
```

---

## 5.5 Summary

We now have an AST for the full Lumina language, including sum types and match expressions. Next we’ll typecheck that AST.

**Next:** **Chapter 6 — Type Checking** (`source/part1-recursive-descent/03-typecheck`).
