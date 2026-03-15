# Building a Compiler with Rust and LLVM - 15

*Part 2: Lexer (grammar-driven with Pest)*

---

The **lexer** turns raw source text into a stream of **tokens**. In Part 2 we implement the lexer using a **Pest grammar**: we define token rules in a `.pest` file, and Pest produces a parser that recognizes those tokens. We then walk the parse pairs and convert them into the same **`Token`** enum used by Part 1 so the rest of the pipeline stays unchanged. Code for this chapter lives in `source/part2-pest/01-lexer`.

This chapter mirrors **Chapter 4** (Part 1 lexer) in scope: we support the same tokens (keywords, identifiers, integer and string literals, symbols, ranges, etc.) so that the Pest-based parser in Chapter 16 can accept the full Lumina language.

---

## Goals of this chapter

- Define the **token set** for Lumina (same as Part 1) and implement a **Pest grammar** that recognizes tokens (and skips whitespace).
- Produce a **`Vec<Token>`** (+ Eof) by walking the parse pairs and mapping each rule to the corresponding **Token** variant.
- So the rest of the pipeline (parser or downstream) sees the same token stream as Part 1 for the same source.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **01-lexer/grammar/lexer.pest** | Token rules: keywords, int_lit, str_lit, ident, two-char and one-char symbols; WHITESPACE (silent); top-level rule (e.g. tokens). |
| **01-lexer/src/lib.rs** | **#[derive(Parser)]**, **Rule**; **lex(source)** – parse with Pest, iterate pairs, **pair_to_token**; append **Eof**; **unescape** for strings. |
| **01-lexer Token enum** | Same variants as Part 1 (keywords, Ident, IntLit, StrLit, symbols, Eof, Unit). |

---

## 15.1 Cargo.toml and dependencies

`source/part2-pest/01-lexer/Cargo.toml`:

```toml
[package]
name = "lumina-part2-lexer"
version = "0.1.0"
edition = "2021"

[dependencies]
pest = "2"
pest_derive = "2"
```

**What each dependency does:**

- **`pest`:** Runtime for Pest. It loads the grammar (compiled from the `.pest` file), runs the parser, and returns a parse tree of **pairs** (rule + span + children).
- **`pest_derive`:** Procedural macro that generates the parser from the grammar. Your crate compiles the grammar at build time; no separate tool binary is needed.

The **Token** type can be defined in this crate to match Part 1’s token set, or we re-export a shared type. For simplicity we define a `Token` enum here that is compatible with what the Part 1 parser expects (so later we can either share a common token crate or convert in the parser crate).

---

## 15.2 Token definition (matching Part 1)

We need the same tokens as Part 1 (Chapter 4) so that the same language is accepted. In `src/token.rs` (or inline in `lib.rs`):

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Token {
    Let,
    For,
    In,
    Fn,
    Type,
    Match,
    With,
    End,
    If,
    Then,
    Else,
    Return,
    Null,
    Unit,
    Ident(String),
    IntLit(i64),
    StrLit(String),
    Eq,
    EqEq,
    Ne,
    Arrow,
    Pipe,
    Lt,
    Le,
    Gt,
    Ge,
    Comma,
    Colon,
    Semicolon,
    LParen,
    RParen,
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Dot,
    DotDot,
    DotDotEq,
    Typeof,
    Eof,
}
```

**Explanation:**

- **Keywords:** `Let` … `Return`, `Null` – reserved words; the grammar will treat them as distinct from identifiers.
- **Literals:** `IntLit(i64)`, `StrLit(String)` – integer and string values.
- **Ident:** `Ident(String)` – variable names, function names, type names (e.g. `User`, `array`).
- **Comparison:** `EqEq`, `Ne`, `Lt`, `Le`, `Gt`, `Ge` – used for `==`, `!=`, `<`, `<=`, `>`, `>=`.
- **Other symbols:** `Eq` (`=`), `Arrow` (`->`), `Pipe` (`|`), `Comma`, `Colon`, `Semicolon`, parentheses, braces, brackets, `Plus`, `Minus`, `Star`, `Slash`, `Percent`.
- **Range:** `Dot`, `DotDot` (`..`), `DotDotEq` (`..=`) – for `for i in start..end` and `start..=end`.
- **Typeof:** keyword for `typeof expr`.
- **Eof:** end-of-file; appended after the last token so the parser can detect end of input.

This matches the Part 1 lexer’s token set so the same grammar and AST can be used downstream.

---

## 15.3 Lexer grammar (Pest)

Create `source/part2-pest/01-lexer/grammar/lexer.pest` (or `src/grammar/lexer.pest` and include it via `pest_derive`). The grammar defines **rules** that recognize tokens; we use **silent rules** (prefix `_`) for whitespace so it doesn’t appear as tokens.

```pest
WHITESPACE = _{ " " | "\t" | "\n" | "\r" }

// Keywords (order can matter for longest match in some setups)
let_kw     = { "let" }
for_kw     = { "for" }
in_kw      = { "in" }
fn_kw      = { "fn" }
type_kw    = { "type" }
match_kw   = { "match" }
with_kw    = { "with" }
end_kw     = { "end" }
if_kw      = { "if" }
then_kw    = { "then" }
else_kw    = { "else" }
return_kw  = { "return" }
null_kw    = { "null" }
typeof_kw  = { "typeof" }
unit_kw    = { "unit" }

// Literals: @ = atomic (no inner whitespace), ~ = sequence
int_lit    = @{ ASCII_DIGIT+ }
str_lit    = @{ "\"" ~ (("\\" ~ ("n" | "t" | "r" | "\"" | "\\")) | (!"\"" ~ ANY))* ~ "\"" }
ident      = @{ (ASCII_ALPHA | "_") ~ (ASCII_ALPHANUMERIC | "_")* }

// Two-char symbols (before single-char so "==" is not "=" + "=")
arrow      = { "->" }
eq_eq      = { "==" }
ne         = { "!=" }
le         = { "<=" }
ge         = { ">=" }
dot_dot    = { ".." }
dot_dot_eq = { "..=" }

// Single-char symbols
eq         = { "=" }
pipe       = { "|" }
lt         = { "<" }
gt         = { ">" }
comma      = { "," }
colon      = { ":" }
semicolon  = { ";" }
lparen     = { "(" }
rparen     = { ")" }
lbrace     = { "{" }
rbrace     = { "}" }
lbracket   = { "[" }
rbracket   = { "]" }
plus       = { "+" }
minus      = { "-" }
star       = { "*" }
slash      = { "/" }
percent    = { "%" }
dot        = { "." }

// One token: any of the above (keywords before ident so "let" is not ident)
token = { let_kw | for_kw | in_kw | fn_kw | type_kw | match_kw | with_kw | end_kw
        | if_kw | then_kw | else_kw | return_kw | null_kw | typeof_kw | unit_kw
        | int_lit | str_lit | ident
        | arrow | eq_eq | ne | le | ge | dot_dot | dot_dot_eq
        | eq | pipe | lt | gt | comma | colon | semicolon
        | lparen | rparen | lbrace | rbrace | lbracket | rbracket
        | plus | minus | star | slash | percent | dot }

// Full input: start, repeated tokens (whitespace skipped by WHITESPACE), end
tokens = { SOI ~ token* ~ EOI }
```

**How this works:**

- **WHITESPACE:** The leading `_` makes it a **silent** rule: it is used to skip spaces/tabs/newlines between tokens but does not produce a pair. Pest allows inserting silent rules between tokens when you use the default `WHITESPACE` behaviour.
- **Keywords:** Each keyword is a separate rule so we can map them to the correct `Token` variant. Order in the `token` rule can matter: put keywords before `ident` so that e.g. `"let"` is parsed as `let_kw`, not `ident`.
- **int_lit:** `ASCII_DIGIT+` – one or more digits; we parse the slice to `i64` in Rust.
- **str_lit:** Simplified string with `\"` and basic escapes; in practice you may extend escapes. The `@` makes the rule atomic.
- **ident:** Letter or underscore followed by alphanumerics or underscores; no keyword should match this if keywords are tried first in `token`.
- **Two-character symbols:** `arrow`, `eq_eq`, `ne`, `le`, `ge`, `dot_dot`, `dot_dot_eq` must appear **before** single-character rules in the grammar so that e.g. `==` is one token, not two `=`.
- **tokens:** `SOI ~ token* ~ EOI` means “start of input, zero or more tokens (with optional whitespace between), end of input”. The top-level rule to parse is `tokens`.

You may need to adjust the grammar to your Pest version (e.g. `ASCII_DIGIT` / `ASCII_ALPHA` are in the `pest` predefined set). If your Pest version uses a different way to skip whitespace, the grammar file may use a different top-level structure (e.g. a rule that explicitly repeats `token` with optional whitespace).

---

## 15.4 Rust integration: generating the parser and mapping to Token

In `src/lib.rs` we (1) declare the grammar and (2) implement a function that runs the parser and converts pairs to `Token`.

```rust
use pest::Parser;
use pest_derive::Parser;

#[derive(Parser)]
#[grammar = "grammar/lexer.pest"]
pub struct LuminaLexer;

pub fn lex(source: &str) -> Result<Vec<Token>, String> {
    let pairs = LuminaLexer::parse(Rule::tokens, source)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for pair in pairs.into_inner() {
        if pair.as_rule() == Rule::token {
            if let Some(inner) = pair.into_inner().next() {
                out.push(pair_to_token(inner));
            }
        }
    }
    out.push(Token::Eof);
    Ok(out)
}

fn pair_to_token(pair: pest::iterators::Pair<Rule>) -> Token {
    use pest::iterators::Pair;
    match pair.as_rule() {
        Rule::let_kw => Token::Let,
        Rule::for_kw => Token::For,
        Rule::in_kw => Token::In,
        Rule::fn_kw => Token::Fn,
        Rule::type_kw => Token::Type,
        Rule::match_kw => Token::Match,
        Rule::with_kw => Token::With,
        Rule::end_kw => Token::End,
        Rule::if_kw => Token::If,
        Rule::then_kw => Token::Then,
        Rule::else_kw => Token::Else,
        Rule::return_kw => Token::Return,
        Rule::null_kw => Token::Null,
        Rule::typeof_kw => Token::Typeof,
        Rule::unit_kw => Token::Unit,
        Rule::int_lit => {
            let s = pair.as_str();
            Token::IntLit(s.parse().unwrap_or(0))
        }
        Rule::str_lit => {
            let s = pair.as_str();
            let inner = &s[1..s.len() - 1]; // strip quotes
            Token::StrLit(unescape(inner))
        }
        Rule::ident => Token::Ident(pair.as_str().to_string()),
        Rule::arrow => Token::Arrow,
        Rule::eq_eq => Token::EqEq,
        Rule::ne => Token::Ne,
        Rule::le => Token::Le,
        Rule::ge => Token::Ge,
        Rule::dot_dot => Token::DotDot,
        Rule::dot_dot_eq => Token::DotDotEq,
        Rule::eq => Token::Eq,
        Rule::pipe => Token::Pipe,
        Rule::lt => Token::Lt,
        Rule::gt => Token::Gt,
        Rule::comma => Token::Comma,
        Rule::colon => Token::Colon,
        Rule::semicolon => Token::Semicolon,
        Rule::lparen => Token::LParen,
        Rule::rparen => Token::RParen,
        Rule::lbrace => Token::LBrace,
        Rule::rbrace => Token::RBrace,
        Rule::lbracket => Token::LBracket,
        Rule::rbracket => Token::RBracket,
        Rule::plus => Token::Plus,
        Rule::minus => Token::Minus,
        Rule::star => Token::Star,
        Rule::slash => Token::Slash,
        Rule::percent => Token::Percent,
        Rule::dot => Token::Dot,
        _ => unreachable!(),
    }
}

fn unescape(s: &str) -> String {
    let mut out = String::new();
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(c) => { out.push('\\'); out.push(c); }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}
```

**Implementation walkthrough:**

1. **`#[derive(Parser)]` and `#[grammar = "grammar/lexer.pest"]`** – The `pest_derive` macro reads the `.pest` file and generates a parser with an enum `Rule` (one variant per rule name) and a `parse(rule, input)` method.
2. **`LuminaLexer::parse(Rule::tokens, source)`** – Runs the parser on the whole input. Returns an iterator over **pairs**; the top-level pairs correspond to the `tokens` rule. We use `into_inner()` to get the sequence of `token` matches (whitespace is already skipped by the silent rule).
3. **`pair.into_inner().next()`** – Each `token` pair has a single inner pair (the actual keyword, literal, or symbol rule). We pass that to `pair_to_token`.
4. **`pair_to_token`** – Matches on `pair.as_rule()` and builds the corresponding `Token`. For `int_lit` we parse the string to `i64`; for `str_lit` we strip quotes and unescape; for `ident` we copy the string.
5. **`out.push(Token::Eof)`** – Append end-of-file so the parser (in the next crate) can detect end of input the same way as Part 1.
6. **`unescape`** – Handles `\n`, `\t`, `\r`, `\"`, `\\` so string literals match Part 1 behaviour.

If the Pest grammar uses a different rule for the top-level (e.g. a single rule that lists all tokens with whitespace between), adjust the loop accordingly (e.g. iterate over `token` pairs directly). The important point is: **one Pest rule per token kind**, and a single pass that produces `Vec<Token>` + `Eof`.

---

## 15.5 Adding the Unit token

Part 1’s language includes a **unit** expression (e.g. `else unit`). The lexer must recognize the keyword **`unit`** and emit a token (e.g. `Token::Unit` if you add that variant, or a special `Ident("unit")` that the parser treats as unit). The grammar above includes `unit_kw` and `pair_to_token` maps it to `Token::Unit`; add `Unit` to the `Token` enum if it isn’t there yet.

---

## 15.6 Tests (same as Part 1)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lex_empty() {
        let r = lex("").unwrap();
        assert_eq!(r, vec![Token::Eof]);
    }

    #[test]
    fn lex_int() {
        let r = lex("42").unwrap();
        assert_eq!(r, vec![Token::IntLit(42), Token::Eof]);
    }

    #[test]
    fn lex_add() {
        let r = lex("1 + 2").unwrap();
        assert_eq!(r, vec![Token::IntLit(1), Token::Plus, Token::IntLit(2), Token::Eof]);
    }

    #[test]
    fn lex_let_and_ident() {
        let r = lex("let x = 1").unwrap();
        assert_eq!(r, vec![Token::Let, Token::Ident("x".into()), Token::Eq, Token::IntLit(1), Token::Eof]);
    }
}
```

Run:

```bash
cd source/part2-pest/01-lexer
cargo test
```

These mirror the kind of tests in Part 1 (Chapter 4): empty input, single integer, arithmetic, and a short keyword/ident/symbol sequence.

---

## 15.7 Summary

| Item | Purpose |
|------|--------|
| **Cargo.toml** | `pest` + `pest_derive` for grammar-driven lexing |
| **Token enum** | Same token set as Part 1 (keywords, literals, symbols, Eof) |
| **lexer.pest** | Token rules and whitespace; keywords before ident; two-char symbols before one-char |
| **lex()** | Parse with Pest, walk pairs, map to `Token`, append `Eof` |
| **pair_to_token** | One branch per rule; parse int/str and unescape strings |

The Pest lexer produces the same token stream as Part 1’s hand-written lexer for the same source, so the next step (parser) can either consume this `Vec<Token>` with a hand-written recursive-descent parser, or we can implement a Pest **parser** grammar that works on **source text** (and have the lexer as a separate pass that produces tokens for a token-based parser). For a clean mirror of Part 1, the usual approach is: **lexer** (Pest or not) produces `Vec<Token>`, and the **parser** (next chapter) consumes those tokens to build the AST. Alternatively, the parser can be Pest-based on the **source string** and use the same grammar file to define both tokenization and structure; then the “lexer” is just the token-producing view of that grammar. The chapter above assumes a separate lexer that outputs `Vec<Token>` so the parser in Chapter 16 can be written to use that token stream and match Part 1’s parser API.

**Next:** **Chapter 16 — Parser (grammar-driven)** (Pest parser grammar and AST builder in `02-parser`).
