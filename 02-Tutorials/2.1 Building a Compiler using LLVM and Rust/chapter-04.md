# Building a Compiler with Rust and LLVM - 4

*Lexer (Part 1: hand-written)*

---

The **lexer** (tokenizer) turns raw source text into a stream of **tokens**. The code for this chapter lives in `source/part1-recursive-descent/01-lexer`.

---

## Goals of this chapter

- Define the **token set** for Lumina (keywords, identifiers, literals, symbols) so the parser has a single, clear interface to the source.
- Implement a **hand-written lexer** that scans the source once and produces a `Vec<Token>` ending with `Eof`.
- Support all tokens needed for the full language: arithmetic, comparisons, type definitions, match, ranges (`..`, `..=`), and for-loops.

---

## Code structure in this chapter

| File / area | Role |
|-------------|------|
| `01-lexer/src/token.rs` | **Token** enum and `is_keyword()`; defines the token set. |
| `01-lexer/src/lib.rs` | **`lex(source)`** – main entry; **`lex_int`**, **`lex_ident_or_keyword`**, **`keyword_to_token`** – helpers. |
| **No Cargo dependencies** on other Lumina crates | Lexer is the first stage; it only depends on the standard library. |

---

## Dependencies (Cargo.toml) for this chapter

The **01-lexer** crate has **no dependencies** (no other Lumina crates, no pest/inkwell):

```toml
[package]
name = "lumina-part1-lexer"
version = "0.1.0"
edition = "2021"
```

The parser (Chapter 5) will depend on this crate to get `Token` and `lex()`.

---

In this repo, the lexer supports:

- **keywords** (reserved words like `let`, `fn`, `if`, …)
- **identifiers** (e.g. `foo`, `bar_1`)
- **integer literals** (e.g. `42`)
- **string literals** (e.g. `"Hello, World!"`, with basic escapes)
- **symbols** (e.g. `+`, `*`, `/`, `%`, `(`, `)`, `->`)
- **ranges and loops** (e.g. `..`, `..=`, `for`, `in`)

---

## 4.1 Token definition

`source/part1-recursive-descent/01-lexer/src/token.rs`:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Token {
    Let,
    Fn,
    Type,
    Match,
    With,
    End,
    If,
    Then,
    Else,
    Ident(String),
    IntLit(i64),
    Eq,
    Arrow,
    Pipe,
    Lt,
    Gt,
    Comma,
    Semicolon,
    LParen,
    RParen,
    Plus,
    Minus,
    Star,
    Eof,
}

impl Token {
    pub fn is_keyword(s: &str) -> bool {
        matches!(
            s,
            "let" | "fn" | "type" | "match" | "with" | "end" | "if" | "then" | "else"
        )
    }
}
```

---

## 4.2 Update: sum types and match

The tokens **`Type`**, **`Match`**, **`With`**, **`End`**, **`Pipe`** (`|`), and **`Arrow`** (`->`) support **sum type definitions** and **match expressions**: e.g. `type Option = Some(i64) | None;` and `match x with | Some(v) -> v | None -> 0 end`.

---

## 4.3 Update: ranges (`..`, `..=`) and `for … in …`

To support ranges and `for` loops we added:

- **Keywords**: `for`, `in`
- **Range tokens**: `DotDot` for `..`, and `DotDotEq` for `..=`

Lexing `..` is done with a small lookahead when the lexer sees `.`:

- `.` followed by `.` becomes `DotDot`
- `..=` becomes `DotDotEq`
- a bare `.` is rejected (helpful error: “did you mean `..`?”)

---

## 4.4 The lexer

`source/part1-recursive-descent/01-lexer/src/lib.rs`:

```rust
mod token;

use std::iter::Peekable;
use std::str::CharIndices;

pub use token::Token;

#[derive(Debug, Clone)]
pub struct LexError {
    pub message: String,
    pub offset: usize,
}

pub fn lex(source: &str) -> Result<Vec<Token>, LexError> {
    let mut tokens = Vec::new();
    let mut it = source.char_indices().peekable();

    loop {
        while it.peek().map(|(_, c)| c.is_ascii_whitespace()) == Some(true) {
            it.next();
        }
        if let Some(&(i, c)) = it.peek() {
            let tok = match c {
                '0'..='9' => lex_int(&mut it).map_err(|msg| LexError {
                    message: msg,
                    offset: i,
                })?,
                'a'..='z' | 'A'..='Z' | '_' => lex_ident_or_keyword(&mut it),
                '=' => {
                    it.next();
                    Token::Eq
                }
                '|' => {
                    it.next();
                    Token::Pipe
                }
                '-' => {
                    it.next();
                    if it.peek().map(|(_, c)| *c) == Some('>') {
                        it.next();
                        Token::Arrow
                    } else {
                        Token::Minus
                    }
                }
                '<' => {
                    it.next();
                    Token::Lt
                }
                '>' => {
                    it.next();
                    Token::Gt
                }
                ',' => {
                    it.next();
                    Token::Comma
                }
                ';' => {
                    it.next();
                    Token::Semicolon
                }
                '+' => {
                    it.next();
                    Token::Plus
                }
                '*' => {
                    it.next();
                    Token::Star
                }
                '(' => {
                    it.next();
                    Token::LParen
                }
                ')' => {
                    it.next();
                    Token::RParen
                }
                _ => {
                    return Err(LexError {
                        message: format!("unexpected character: {:?}", c),
                        offset: i,
                    });
                }
            };
            tokens.push(tok);
        } else {
            break;
        }
    }
    tokens.push(Token::Eof);
    Ok(tokens)
}

fn lex_int(it: &mut Peekable<CharIndices>) -> Result<Token, String> {
    let mut digits = String::new();
    while it.peek().map(|(_, c)| c.is_ascii_digit()) == Some(true) {
        if let Some((_, c)) = it.next() {
            digits.push(c);
        }
    }
    digits
        .parse::<i64>()
        .map(Token::IntLit)
        .map_err(|_| "invalid integer".to_string())
}

fn lex_ident_or_keyword(it: &mut Peekable<CharIndices>) -> Token {
    let mut s = String::new();
    while it
        .peek()
        .map(|(_, c)| c.is_ascii_alphanumeric() || *c == '_')
        == Some(true)
    {
        if let Some((_, c)) = it.next() {
            s.push(c);
        }
    }
    if Token::is_keyword(&s) {
        keyword_to_token(&s)
    } else {
        Token::Ident(s)
    }
}

fn keyword_to_token(s: &str) -> Token {
    match s {
        "let" => Token::Let,
        "type" => Token::Type,
        "match" => Token::Match,
        "with" => Token::With,
        "end" => Token::End,
        "fn" => Token::Fn,
        "if" => Token::If,
        "then" => Token::Then,
        "else" => Token::Else,
        _ => Token::Ident(s.to_string()),
    }
}
```

**Implementation walkthrough:**

1. **`lex(source)`** – Entry point. Uses `source.char_indices().peekable()` to walk the string. Loops: skip whitespace, then dispatch on the current character.
2. **Dispatch:** Digits → **`lex_int`** (collect digits, parse to `i64`, return `IntLit(n)`). Letters/underscore → **`lex_ident_or_keyword`** (collect ident, then if it matches a keyword return that token else `Ident(s)`). Single chars (`=`, `|`, `<`, `>`, `,`, `;`, `+`, `*`, `(`, `)`) → consume and return the corresponding token. `-` → if next is `>`, consume both and return `Arrow`, else return `Minus`. (In the full repo, `"` triggers string lexing; `.` with lookahead gives `..` or `..=`.)
3. **`lex_int`** – Reads consecutive digits, parses with `str::parse::<i64>()`, returns `Token::IntLit(n)` or an error for overflow/invalid.
4. **`lex_ident_or_keyword`** – Reads consecutive alphanumerics and `_`; then if the string is in the keyword set, **`keyword_to_token`** returns the keyword token; otherwise `Token::Ident(s)`.
5. After the loop, **`Token::Eof`** is pushed so the parser can detect end of input.
6. **`LexError.offset`** is a byte offset into the source (useful for error reporting; can be converted to line/column later).

---

## 4.5 Running tests

```bash
cd source/part1-recursive-descent/01-lexer
cargo test
```

---

## 4.6 Summary

We now have a lexer that produces a `Vec<Token>` ending in `Token::Eof`. Next we’ll turn those tokens into an AST.

**Next:** **Chapter 5 — Parser** (`source/part1-recursive-descent/02-parser`).
