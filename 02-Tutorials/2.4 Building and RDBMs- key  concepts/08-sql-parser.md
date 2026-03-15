# Chapter 8: Parsing SQL

So far everything in RustDB has been about bytes and structures. Now we give the database a human-facing interface: SQL. This chapter builds the lexer and parser that transform a raw string like `SELECT name FROM users WHERE id = 1` into a structured object the executor can act on.

---

## The pipeline from text to AST

Parsing is traditionally split into two phases:

```
"SELECT name FROM users WHERE id = 1"
                │
                ▼
         ┌─────────────┐
         │    Lexer     │   Tokenises the raw string
         └─────┬───────┘
               │
         [SELECT] [Ident("name")] [FROM] [Ident("users")]
         [WHERE] [Ident("id")] [Eq] [IntLit(1)] [Eof]
               │
               ▼
         ┌─────────────┐
         │   Parser     │   Builds an AST from the token stream
         └─────┬───────┘
               │
               ▼
    Statement::Select {
        columns: ["name"],
        table: "users",
        condition: Some(Comparison { column: "id", op: Eq, value: Int(1) })
    }
```

The **lexer** (also called a tokeniser or scanner) handles the low-level details: stripping whitespace, recognising keywords, extracting numeric literals. The **parser** applies grammar rules to the token stream and builds the Abstract Syntax Tree (AST).

---

## Theory: lexing and parsing

### Regular expressions and lexers

Lexical rules are typically *regular* — they can be described by regular expressions and implemented with finite automata. Keywords (`SELECT`, `FROM`) are recognised by matching exact strings. Identifiers match `[a-zA-Z_][a-zA-Z0-9_]*`. Integer literals match `[0-9]+`.

Production lexers are often generated from a grammar file by tools like Flex (C) or Logos (Rust). RustDB's lexer is hand-written, which is clearer for a tutorial.

### Context-free grammars and parsers

Parser structure is described by a **context-free grammar (CFG)**. Here is a subset of RustDB's grammar in EBNF:

```
statement  = create_table | insert | select | create_index

create_table = "CREATE" "TABLE" ident "(" col_def ("," col_def)* ")"
col_def      = ident type ["PRIMARY" "KEY"]
type         = "INT" | "FLOAT" | "TEXT" | "BOOL"

insert       = "INSERT" "INTO" ident "VALUES" "(" value ("," value)* ")"

select       = "SELECT" projections "FROM" ident ["WHERE" condition]
projections  = "*" | ident ("," ident)*

condition    = or_cond
or_cond      = and_cond ("OR" and_cond)*
and_cond     = not_cond ("AND" not_cond)*
not_cond     = "NOT" not_cond | comparison
comparison   = ident op value
op           = "=" | "!=" | "<" | "<=" | ">" | ">="

value        = int_lit | float_lit | str_lit | "TRUE" | "FALSE" | "NULL"

create_index = "CREATE" "INDEX" "ON" ident "(" ident ")"
```

### Recursive descent parsing

The parser is a **recursive descent parser** — one function per grammar rule, each function calling other functions for sub-rules. This strategy is simple to implement and debug, and works well for LL(1) grammars (grammars parseable by looking one token ahead).

Operator precedence is encoded in the grammar itself. The condition grammar (`or_cond → and_cond → not_cond → comparison`) means OR binds less tightly than AND, which binds less tightly than NOT — exactly the standard SQL precedence.

---

## Code walkthrough

### `sql/lexer.rs` — the `Token` enum

```rust
// source/src/sql/lexer.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-08

pub enum Token {
    // Keywords
    Select, From, Where, Insert, Into, Values,
    Create, Table, Drop, And, Or, Not,
    Null, True, False, Int, Float, Text, Bool,
    Primary, Key, Index, On,
    // Punctuation
    LParen, RParen, Comma, Semicolon, Star,
    // Operators
    Eq, Ne, Lt, Le, Gt, Ge,
    // Literals
    IntLit(i64), FloatLit(f64), StrLit(String),
    // Identifiers and end-of-input
    Ident(String),
    Eof,
}
```

Keywords and identifiers are both sequences of letters, so the lexer reads a word and then checks whether it matches a known keyword:

```rust
fn lex_word(&mut self) -> Token {
    let mut word = String::new();
    while self.peek().map(|c| c.is_alphanumeric() || c == '_').unwrap_or(false) {
        word.push(self.advance().unwrap());
    }
    match word.to_ascii_uppercase().as_str() {
        "SELECT" => Token::Select,
        "FROM"   => Token::From,
        // ...
        _        => Token::Ident(word), // not a keyword → identifier
    }
}
```

The `to_ascii_uppercase()` call makes keyword matching case-insensitive without duplicating every variant.

String literals are delimited by single quotes and allow no escaping (a simplification for the tutorial):

```rust
fn lex_string(&mut self) -> Result<Token, String> {
    self.advance(); // consume opening '
    let mut s = String::new();
    loop {
        match self.advance() {
            None       => return Err("unterminated string literal".into()),
            Some('\'') => break,
            Some(c)    => s.push(c),
        }
    }
    Ok(Token::StrLit(s))
}
```

### `sql/ast.rs` — the AST types

```rust
// source/src/sql/ast.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-08

pub enum Statement {
    CreateTable { table: String, columns: Vec<ColumnDef> },
    Insert      { table: String, values: Vec<Value> },
    Select      { columns: Vec<String>, table: String, condition: Option<Condition> },
    CreateIndex { table: String, column: String },
}

pub enum Condition {
    Comparison { column: String, op: CompOp, value: Value },
    And(Box<Condition>, Box<Condition>),
    Or(Box<Condition>, Box<Condition>),
    Not(Box<Condition>),
}

pub enum CompOp { Eq, Ne, Lt, Le, Gt, Ge }
```

`Condition` is a recursive type, hence the `Box` wrappers — Rust requires recursive types to have a known, finite size, which `Box<T>` provides by heap-allocating the inner value.

### `sql/parser.rs` — the recursive descent parser

The `Parser` struct holds the token list and a cursor:

```rust
// source/src/sql/parser.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-08

pub struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}
```

Helper methods provide the basic primitives:

```rust
fn peek(&self) -> &Token { &self.tokens[self.pos] }

fn advance(&mut self) -> &Token {
    let t = &self.tokens[self.pos];
    if self.pos + 1 < self.tokens.len() { self.pos += 1; }
    t
}

fn expect(&mut self, expected: &Token) -> Result<(), String> {
    if self.peek() == expected {
        self.advance(); Ok(())
    } else {
        Err(format!("expected {:?}, got {:?}", expected, self.peek()))
    }
}
```

The top-level `parse` function dispatches on the first token:

```rust
pub fn parse(&mut self) -> Result<Statement, String> {
    let stmt = match self.peek().clone() {
        Token::Create => {
            self.advance(); // consume CREATE
            match self.peek().clone() {
                Token::Table => self.parse_create_table(),
                Token::Index => self.parse_create_index(),
                other => Err(format!("expected TABLE or INDEX, got {:?}", other)),
            }
        }
        Token::Insert => { self.advance(); self.parse_insert() }
        Token::Select => { self.advance(); self.parse_select() }
        other => Err(format!("unexpected token {:?}", other)),
    }?;
    // Consume optional trailing semicolon.
    if self.peek() == &Token::Semicolon { self.advance(); }
    Ok(stmt)
}
```

**Parsing WHERE conditions** illustrates the grammar-as-code pattern:

```rust
fn parse_condition(&mut self) -> Result<Condition, String> {
    self.parse_or()
}

fn parse_or(&mut self) -> Result<Condition, String> {
    let mut left = self.parse_and()?;
    while self.peek() == &Token::Or {
        self.advance();
        let right = self.parse_and()?;
        left = Condition::Or(Box::new(left), Box::new(right));
    }
    Ok(left)
}

fn parse_and(&mut self) -> Result<Condition, String> {
    let mut left = self.parse_not()?;
    while self.peek() == &Token::And {
        self.advance();
        let right = self.parse_not()?;
        left = Condition::And(Box::new(left), Box::new(right));
    }
    Ok(left)
}

fn parse_not(&mut self) -> Result<Condition, String> {
    if self.peek() == &Token::Not {
        self.advance();
        let inner = self.parse_not()?;
        return Ok(Condition::Not(Box::new(inner)));
    }
    self.parse_comparison()
}
```

Each function handles exactly one level of precedence. `parse_or` is the *weakest* binding (called first), `parse_comparison` is the *strongest* (called last). Left-associativity for AND and OR is handled by the `while` loop that accumulates nested `And`/`Or` nodes from left to right.

---

## Using the parser

Add this quick test inside any module to exercise the parser end-to-end:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke() {
        let sql = "SELECT id, name FROM users WHERE id > 3";
        let stmt = Parser::new(sql).unwrap().parse().unwrap();
        println!("{:?}", stmt);
    }
}
```

`Parser::new` tokenises the input eagerly. `parse()` builds the AST from the stored token list.

---

## Try it yourself

Add a test to `src/sql/parser.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::sql::ast::{CompOp, Condition, Statement};
    use crate::types::Value;

    #[test]
    fn parse_select_with_where() {
        let sql = "SELECT id, name FROM users WHERE id = 42";
        let stmt = Parser::new(sql).unwrap().parse().unwrap();
        match stmt {
            Statement::Select { columns, table, condition } => {
                assert_eq!(columns, vec!["id", "name"]);
                assert_eq!(table.to_lowercase(), "users");
                match condition.unwrap() {
                    Condition::Comparison { column, op, value } => {
                        assert_eq!(column.to_lowercase(), "id");
                        assert_eq!(op, CompOp::Eq);
                        assert_eq!(value, Value::Int(42));
                    }
                    _ => panic!("wrong condition type"),
                }
            }
            _ => panic!("wrong statement type"),
        }
    }

    #[test]
    fn parse_create_table() {
        let sql = "CREATE TABLE orders (id INT PRIMARY KEY, amount FLOAT, note TEXT)";
        let stmt = Parser::new(sql).unwrap().parse().unwrap();
        match stmt {
            Statement::CreateTable { table, columns } => {
                assert_eq!(table.to_lowercase(), "orders");
                assert_eq!(columns.len(), 3);
                assert!(columns[0].primary_key);
            }
            _ => panic!("wrong statement type"),
        }
    }
}
```

The following four tests cover the other statement kinds and the error path:

```rust
#[test]
fn test_parse_insert() {
    let sql = "INSERT INTO users VALUES (1, 'alice', 30)";
    let stmt = Parser::new(sql).unwrap().parse().unwrap();
    match stmt {
        Statement::Insert { table, values } => {
            assert_eq!(table.to_lowercase(), "users");
            assert_eq!(values.len(), 3);
        }
        _ => panic!("expected Insert"),
    }
}

#[test]
fn test_parse_create_index() {
    let sql = "CREATE INDEX ON users (id)";
    let stmt = Parser::new(sql).unwrap().parse().unwrap();
    match stmt {
        Statement::CreateIndex { table, column } => {
            assert_eq!(table.to_lowercase(), "users");
            assert_eq!(column.to_lowercase(), "id");
        }
        _ => panic!("expected CreateIndex"),
    }
}

#[test]
fn test_parse_select_star() {
    let sql = "SELECT * FROM products";
    let stmt = Parser::new(sql).unwrap().parse().unwrap();
    match stmt {
        Statement::Select { columns, table, condition } => {
            assert!(columns.is_empty(), "SELECT * should produce empty columns vec");
            assert_eq!(table.to_lowercase(), "products");
            assert!(condition.is_none());
        }
        _ => panic!("expected Select"),
    }
}

#[test]
fn test_parse_error_unknown_token() {
    let result = Parser::new("FOOBAR baz").unwrap().parse();
    assert!(result.is_err(), "unknown statement should return Err");
}
```

`test_parse_select_star` confirms that `SELECT *` produces an **empty** `columns` vec — the convention used downstream in the executor to mean "project all columns". `test_parse_error_unknown_token` confirms the parser returns `Err` for completely unrecognised input rather than panicking.

---

## Key takeaways

- The lexer converts raw text into a flat token stream. It handles the messy details: whitespace, case, number parsing.
- The parser builds a tree from the token stream. One function per grammar rule keeps the code easy to read and debug.
- Operator precedence is expressed structurally: weaker operators are handled by outer functions, stronger ones by inner functions.
- The AST is a pure data structure. It has no knowledge of tables, schemas, or pages — that is the executor's job.

---

**← Previous:** [Chapter 7 — B-Tree Indexes](07-btree.md) | **Next:** [Chapter 9 — Query Execution](09-executor.md)
