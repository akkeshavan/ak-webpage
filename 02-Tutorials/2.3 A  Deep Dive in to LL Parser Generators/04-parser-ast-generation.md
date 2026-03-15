# Chapter 4: Parser and AST Generation

**Previous:** [Chapter 3 — Lexer Generator](03-lexer-generator.md)

This chapter implements the **parser generator** and **AST generation**. Given the parser rules from the grammar IR and the lexer we generate, we emit a **parser** that produces an **AST** in the target language (Rust and one other, e.g. JavaScript).

## 4.1 Parser Strategy

We use **recursive descent**: one function per parser rule. Each function:

- Reads tokens from the lexer (or token stream).
- Chooses an alternative based on **lookahead** (first token(s) of each alternative).
- For each element: match a token, call another rule, or handle `?` / `*` / `+` with loops.

We need **lookahead** to resolve alternatives. For many grammars, one token is enough (LL(1)); for others we may need more (we can start with LL(1) and extend later).

## 4.2 AST Design

The AST should represent the **meaningful** structure, not every grammar symbol:

- **Expression nodes:** Binary op (left, op, right), unary op, literal, identifier.
- **Statement nodes:** If, For, Assignment, ExpressionStatement, etc.
- **Declaration nodes:** Function, Variable (with type and name).

We have two approaches:

1. **Grammar-driven:** Generate AST node types from the grammar (e.g. one node type per rule or per alternative). Quick but can be verbose.
2. **Curated:** Define a fixed AST schema for our “standard” language (expression + full language) and map grammar rules to these node types. Cleaner for interpreters and codegen.

For this tutorial we use a **hybrid**: we define a small **AST schema** (enums/structs) and the **generated parser** builds instances of that schema. The schema is the same conceptually for Rust and JS; only the syntax differs.

When the generator cannot compute disjoint FIRST sets for a rule’s alternatives, it emits a **skeleton** (consuming elements but not choosing by lookahead); see §4.6.1. For reliable parsers, use grammars with clear first tokens or add semantic actions so the intended alternative is chosen.

## 4.3 AST Schema (Conceptual)

### 4.3.1 Expression Language (Early Chapters)

- `Expr`: Literal(num), Ident(name), Binary(left, op, right), Unary(op, operand).

### 4.3.2 Full Language (Later)

- **Expr:** as above + Call(name, args), Index(expr, index), etc.
- **Stmt:** Block(stmts), If(cond, then_branch, else_branch), For(init, cond, step, body), While(cond, body), Return(expr?), Assign(name, expr), ExprStmt(expr).
- **Decl:** Fn(name, params, return_type?, body), Var(name, type?, init?).
- **Program:** list of declarations and statements.

The **generator** emits code that constructs these nodes when the parser matches the corresponding rules.

## 4.4 Generating the Parser (Rust)

- **Input:** Grammar IR (parser rules + lexer token set).
- **Output:** Rust module with:
  - Types for AST nodes (or use a shared AST crate).
  - Parser struct holding token stream and current index.
  - One function per parser rule: `fn parse_expr(&mut self) -> Result<Expr, ParseError>`.
  - Helper: `fn expect(&mut self, kind: TokenKind) -> Result<(), ParseError>`.
  - For alternatives: `fn peek(&self) -> TokenKind`; choose branch by lookahead.

Mapping from rule to code:

- `rule_ref` → call `parse_rule_ref()`.
- `token_ref` → `expect(ThatToken)`.
- `literal` → `expect(LiteralToken)` (generated lexer has a token for that literal).
- `e1 e2` → parse e1, then e2.
- `(e1 | e2)` → if peek matches e1 then parse e1 else parse e2.
- `e?` → if peek matches e then parse e.
- `e*` → while peek matches e, parse e.
- `e+` → parse e once, then while peek matches e, parse e.

**Left recursion** (e.g. `expr : expr '+' term`) is **not** allowed in plain recursive descent; it leads to infinite recursion. See **§4.11 Left recursion** for a detailed explanation and how to avoid it (right-recursive grammar, iterative style, or precedence climbing).

## 4.5 Generating the Parser in JavaScript (or Another Language)

Same structure:

- AST nodes: plain objects or classes, e.g. `{ type: 'Binary', left, op, right }`.
- Parser: object with token array and index, `parseExpr()`, `expect(kind)`, `peek()`.
- Same mapping from grammar elements to code.

We want **one** grammar → **one** logical parser/AST design → **multiple** target implementations.

## 4.6 Error Reporting

- On mismatch: record **position** (line, column) and **expected** vs **found** token.
- Optionally: resync (skip until a known safe token) for better error recovery. Can be added later.

## 4.6.1 Reference generator: actions vs skeleton

When the grammar includes **semantic actions** (e.g. from a `.grammar` file loaded by `grammar_loader`), the reference parser generator in `source/code/src/parser_gen.rs` emits **full** code for those alternatives: it captures each element’s value into `__v1`, `__v2`, …, then returns `Ok(action)` with `$1`, `$2`, … replaced by those variables. So the generated parser **does** build the AST for rules that have actions.

When an alternative has **no** action, the generator still emits a **skeleton**: it consumes the elements (rule refs and token refs) but returns a dummy `Ok(Expr::Literal(0))`, and alternative choice uses `if true` / `else if true`. To get a complete parser without actions you would add lookahead (first sets) and proper optional/repetition handling as described earlier in this chapter.

## 4.7 Tying Lexer and Parser Together

- **Rust:** Generated parser takes something like `tokens: Vec<Token>` or a lexer that yields tokens. Entry point: `ExprParser::parse(lexer) -> Result<Program, ParseError>`.
- **JS:** Same idea: pass token array or lexer; `parse(tokens)` returns AST or throws.

The **parser generator** assumes the lexer (from Chapter 3) produces the token types and literals that the parser expects. Names must match between lexer and parser (e.g. token type `PLUS` and parser reference `PLUS`).

## 4.8 Output of This Chapter

- **Parser generator** that, given grammar IR, emits:
  - Rust parser + AST node types (or references to shared AST),
  - JS (or other) parser + AST.
- Generated parser **uses** the generated lexer and produces an **AST** that the interpreter (Chapter 6) and later the runtime (Chapters 8–9) and LLVM (Chapter 10) can consume.

---

## 4.9 Source Code

The reference implementation provides **AST types** in `source/code/src/ast.rs` and the **parser generator** in `source/code/src/parser_gen.rs`. The generator emits Rust that uses tokens from the generated lexer and builds the AST.

### 4.9.1 AST types (expression language)

```rust
// source/code/src/ast.rs (excerpt)
#[derive(Debug, Clone)]
pub enum Expr {
    Literal(i64),
    Ident(String),
    Binary { left: Box<Expr>, op: BinOp, right: Box<Expr> },
    Unary { op: UnOp, operand: Box<Expr> },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BinOp { Add, Sub, Mul, Div }

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum UnOp { Neg }
```

The **full language** uses the same file with `Program`, `Stmt`, `Decl`, and `FullExpr` (with `Call`, etc.).

### 4.9.2 Parser state and helpers (generated)

The generated parser holds the token stream and an index; it never backtracks (we assume LL(1) or we try alternatives in order). The generated parser assumes `TokenKind` implements `Clone` (the generated lexer derives `Clone` for it):

```rust
// Pattern emitted by source/code/src/parser_gen.rs
pub struct ExprParser {
    tokens: Vec<lexer::Token>,
    pos: usize,
}

impl ExprParser {
    pub fn new(tokens: Vec<lexer::Token>) -> Self { ... }
    fn peek(&self) -> Option<&Token> { self.tokens.get(self.pos) }
    fn peek_kind(&self) -> TokenKind { ... }
    fn advance(&mut self) -> Option<Token> { ... }
    fn expect(&mut self, kind: TokenKind) -> Result<Token, ParseError> { ... }
}
```

### 4.9.3 One function per rule

For each parser rule we emit a `parse_<rulename>` that returns `Result<Expr, ParseError>` (or the appropriate AST type):

```rust
// source/code/src/parser_gen.rs — emit_parse_rule
fn emit_parse_rule(grammar: &Grammar, rule: &ParserRule, out: &mut String) -> Result<(), std::fmt::Error> {
    writeln!(out, "    pub fn parse_{}(&mut self) -> Result<Expr, ParseError> {{", to_snake(&rule.name))?;
    if rule.alternatives.len() == 1 {
        emit_alt(&rule.alternatives[0], grammar, out, 2)?;
    } else {
        for (i, alt) in rule.alternatives.iter().enumerate() {
            // emit: try this alternative (or use lookahead to choose)
            emit_alt(alt, grammar, out, 2)?;
        }
    }
    writeln!(out, "    }}")?;
    Ok(())
}
```

### 4.9.4 Mapping grammar elements to code

Each parser element is turned into consumption and/or AST construction:

```rust
// source/code/src/parser_gen.rs — emit_parser_elem
fn emit_parser_elem(elem: &ParserElement, grammar: &Grammar, out: &mut String, ...) {
    match elem {
        ParserElement::RuleRef(name) => {
            writeln!(out, "        let _ = self.parse_{}()?;", to_snake(name))?;
        }
        ParserElement::TokenRef(name) => {
            writeln!(out, "        self.expect(super::lexer::TokenKind::{})?;", to_pascal(name))?;
        }
        ParserElement::Group(elems) => {
            for e in elems { emit_parser_elem(e, ...)?; }
        }
        ParserElement::Optional(inner) => { /* if peek matches, parse inner */ }
        ParserElement::ZeroOrMore(inner) => { /* while peek matches, parse inner */ }
        ParserElement::OneOrMore(inner) => { /* parse once, then while ... */ }
        ...
    }
}
```

For the **expression grammar** with `expr : term ( ( PLUS | MINUS ) term )*`, we would emit: parse `term`, then a loop that, while peek is `PLUS` or `MINUS`, consumes the op, parses another `term`, and builds a `Binary` node (left-associative fold).

### 4.9.5 Semantic actions: from grammar to generated code

When each parser alternative has an **action** (Rust code in `{ ... }` with `$1`, `$2`, …), the generator emits code that (1) parses each element and stores its value, (2) substitutes `$N` in the action with the N-th value, (3) returns `Ok(action)`.

**Grammar (from `source/examples/grammars/Expr.grammar`):**

```text
expr  : term PLUS expr { Expr::Binary { left: Box::new($1), op: BinOp::Add, right: Box::new($3) } } ;
expr  : term { $1 } ;
factor : LPAREN expr RPAREN { $2 } ;
factor : INT { Expr::Literal($1.text.parse().unwrap_or(0)) } ;
```

Here, `$1` is the result of the first symbol (e.g. `term`), `$2` the second, `$3` the third. For `factor : INT { ... }`, `$1` is the **token** (so `$1.text` is the lexeme).

**Generated parser (excerpt from the output of `generate_rust_parser`):**

```rust
pub fn parse_expr(&mut self) -> Result<Expr, ParseError> {
    if true {  // alt 0
        let __v1 = self.parse_term()?;
        let __v2 = self.expect(super::lexer::TokenKind::Plus)?;
        let __v3 = self.parse_expr()?;
        Ok(Expr::Binary { left: Box::new(__v1), op: BinOp::Add, right: Box::new(__v3) })
    } else if true {  // alt 1
        let __v1 = self.parse_term()?;
        Ok(__v1)
    } else { ... }
}

pub fn parse_factor(&mut self) -> Result<Expr, ParseError> {
    if true {  // alt 0: LPAREN expr RPAREN
        let __v1 = self.expect(super::lexer::TokenKind::Lparen)?;
        let __v2 = self.parse_expr()?;
        let __v3 = self.expect(super::lexer::TokenKind::Rparen)?;
        Ok(__v2)
    } else if true {  // alt 1: INT
        let __v1 = self.expect(super::lexer::TokenKind::Int)?;
        Ok(Expr::Literal(__v1.text.parse().unwrap_or(0)))
    } else { ... }
}
```

**Explanation:**

- For `term PLUS expr`, the three elements get values `__v1`, `__v2`, `__v3`. The action uses `$1` and `$3` (the term and the expr); `$2` is the `PLUS` token (unused in the action). The generator replaces `$1` → `__v1`, `$3` → `__v3`, and emits `Ok(Expr::Binary { ... })`.
- For `LPAREN expr RPAREN`, the action is `$2`: return the expression in the middle.
- For `INT`, `$1` is the token, so the action uses `$1.text` to parse the integer.

The **start rule** `start : expr Eof { $1 }` becomes:

```rust
pub fn parse_start(&mut self) -> Result<Expr, ParseError> {
    let __v1 = self.parse_expr()?;
    let __v2 = self.expect(super::lexer::TokenKind::Eof)?;
    Ok(__v1)
}
```

So the pipeline is: **grammar file** (with actions) → **grammar_loader** → **Grammar** (with `ParserAlt.action` set) → **parser_gen** → full Rust parser that builds the AST. This AST (`Expr`) is exactly what the **interpreter** (`eval`, Chapter 6) and **LLVM codegen** (`compile_expr_to_ir`, Chapter 10) accept. To run **Grammar → Parser → Interpreter** or **Grammar → Parser → LLVM** on your own source, you integrate the generated `lexer.rs` and `parser.rs` into your crate (so they see your `ast` and lexer module), then: source → lexer → tokens → parser → `Expr` → `eval` or `compile_expr_to_ir`. The reference CLI’s **run** and **compile** commands do **not** use the grammar-generated parser; they use the FullLang hand-written parser. See Chapter 9, §9.4.3.

---

## 4.10 Code Walkthrough: Key Algorithms

### Algorithm 1: Recursive descent

**Goal:** For each grammar rule, one function that consumes tokens and returns the corresponding AST (or error).

**Steps:**

1. **Entry:** The start rule (e.g. `start : expr EOF`) is the public entry. It calls `parse_expr()`, then `expect(Eof)`, and returns the `Expr`.
2. **Per rule:** `parse_<rule>`:
   - If the rule has **one alternative**, emit the sequence of elements for that alternative.
   - If the rule has **multiple alternatives**, we need to **choose** one:
     - **LL(1):** Look at `peek_kind()` and emit `if peek == A { parse_alt0() } else if peek == B { parse_alt1() } ...`.
     - **Try in order:** Emit “try alt 0; if it fails (backtrack or catch), try alt 1; …”. Our reference uses a simplified structure; a full version would use lookahead or backtracking.
3. **Per element:**
   - **RuleRef:** Emit `self.parse_<name>()?` and use the result to build the AST (e.g. fold into a `Binary`).
   - **TokenRef / Literal:** Emit `self.expect(ThatToken)?` to consume one token.
   - **Group:** Emit the inner elements in sequence.
   - **Optional `e?`:** Emit `if peek matches first set of e { parse e }`.
   - **Zero or more `e*`:** Emit `while peek matches e { parse e }`.
   - **One or more `e+`:** Emit `parse e` once, then `while peek matches e { parse e }`.

So the **generator** walks the grammar IR and, for each rule and element, emits the corresponding Rust.

### Algorithm 2: Expression precedence (fold from left)

For a rule like `expr : term ( ( PLUS | MINUS ) term )*`, we want an AST that reflects left associativity. The emitted code looks like:

```text
let mut left = self.parse_term()?;
while matches!(self.peek_kind(), PLUS | MINUS) {
    let op = ...;  // consume PLUS or MINUS
    let right = self.parse_term()?;
    left = Expr::Binary { left: Box::new(left), op, right: Box::new(right) };
}
Ok(left)
```

So we **fold** the list of (op, term) into a left-heavy tree. The generator must emit this pattern when it sees “term ( ( PLUS | MINUS ) term )*” and the AST type is `Expr`.

### Algorithm 3: Lookahead via FIRST sets (LL(1)) — and how to generalize

When a rule has several alternatives (e.g. `factor : INT | ID | LPAREN expr RPAREN`), we need to decide which one to parse **before** consuming any tokens. For LL(1), we look only at the **next token**. The key notion is the **FIRST set**:

- **FIRST(α)** = set of token kinds that can start any string derived from `α`.

For a simple rule:

```text
factor : INT
       | ID
       | LPAREN expr RPAREN
       ;
```

we have:

- Alt 0: FIRST(`INT`) = { `INT` }.
- Alt 1: FIRST(`ID`) = { `ID` }.
- Alt 2: FIRST(`LPAREN expr RPAREN`) = { `LPAREN` }.

If the FIRST sets are **disjoint**, we can generate a clean LL(1) decision:

```rust
match self.peek_kind() {
    TokenKind::Int => { /* parse INT; return Literal(...) */ }
    TokenKind::Id => { /* parse ID; return Ident(...) */ }
    TokenKind::Lparen => { /* parse ( expr ); return expr */ }
    _ => Err(ParseError { message: "no alternative matched".into(), line: 0, column: 0 }),
}
```

#### 4.10.1 FIRST in the reference generator (simple LL(1))

The reference `parser_gen.rs` implements a **simple LL(1)** decision:

- For each alternative of a rule, it looks at the **first element**:
  - If it’s a `TokenRef(NAME)`, the first token is `NAME`.
  - If it’s a `RuleRef(ruleName)`, it recursively looks at the first alternative of `ruleName`.
  - If it’s a `Group(...)`, it looks at the first element inside.
  - If it can’t find a unique first token (e.g. because of `Optional` / `ZeroOrMore` / `Literal` in the wrong place), it gives up and falls back to the older **skeleton** (`if true { ... } else if true { ... }`).
- If **all** alternatives have a first token and those tokens are **distinct**, the generator emits a `match self.peek_kind()` with one arm per alternative, exactly as above.

This corresponds to a restricted form of FIRST where we only care about the **first token** and we assume no ε‑productions (no empty alternatives). For many expression and statement grammars, this is enough to get clean LL(1) parsers.

#### 4.10.2 From LL(1) to LL(k) (conceptual only)

To move from **LL(1)** to **LL(k)** in this design (not implemented in code, but conceptually straightforward):

1. Replace `peek_kind()` with **`peek_k(k)`** that returns the next `k` token kinds (or fewer at EOF), e.g. `Vec<TokenKind>`.
2. Generalize **FIRST** to **FIRST_k**, which is a set of **token sequences** (tuples) of length ≤ k that can start each alternative.
3. For each rule alternative, compute FIRST_k(alt) (via grammar analysis, similar to FIRST but tracking sequences instead of single tokens).
4. At runtime, look at the k‑token sequence from `peek_k(k)` and pick the alternative whose FIRST_k contains that sequence (or a matching prefix).
5. If two alternatives’ FIRST_k overlap, the grammar is **not LL(k)** for that k; the generator should report a conflict.

In practice:

- **LL(1)** (what the generator does now) is usually enough if you write **right‑factored**, non‑left‑recursive grammars.
- For more complex grammars, ANTLR4 uses **ALL(\*)** (adaptive LL) rather than a fixed k; it effectively runs many of these lookahead decisions and caches them in a DFA.

In this tutorial, we stop at a **simple FIRST‑based LL(1)** implementation to keep the generator readable, and we describe how you would *conceptually* evolve it into LL(k) if you wanted a more powerful front end.

---

## 4.11 Left recursion: why it breaks and how to avoid it

The reference parser generator emits **recursive descent** code: each rule becomes a function that may call itself or other rule functions. In that setting, **left recursion** in the grammar causes the generated parser to **never consume a token** before recursing, so it loops forever (stack overflow or infinite recursion). This section explains the problem and gives concrete ways to avoid it.

### 4.11.1 What is left recursion?

A rule is **left-recursive** if the first symbol of one of its alternatives is the rule itself (possibly after some other alternatives). For example:

```text
expr : expr PLUS term   // left-recursive: expr appears on the left
     | term ;
```

When the parser tries to match `expr`, it picks the first alternative and immediately calls `parse_expr()` again. That call again picks the first alternative and calls `parse_expr()` again, and so on—**without ever advancing the token stream**. So we never see `PLUS` or `term`; we just recurse until the stack overflows.

**Right recursion** is safe:

```text
expr : term PLUS expr   // right-recursive: expr is on the right
     | term ;
```

Here, to match the first alternative we must first match `term` (which consumes tokens) and then `PLUS`, and only then recurse for `expr`. So we always make progress before recursing.

### 4.11.2 Why it matters for recursive descent

In recursive descent, we decide which alternative to take (e.g. by lookahead or by trying in order). For a left-recursive rule, the first alternative **starts** with the same rule, so we have no way to “see” the next token before recursing—we recurse first. That recursion never terminates because the input position does not change. So:

- **Left-recursive grammar + naive recursive descent ⇒ infinite recursion.**
- The reference generator does **not** transform left-recursive rules; it emits one function per rule. So if your grammar is left-recursive, the generated parser will hang or crash on input that matches that rule.

### 4.11.3 How to avoid left recursion

Use one of the following.

**Option 1: Right-recursive grammar (simplest for the reference tool)**

Rewrite the rule so the recursive call is on the **right**:

```text
expr : term PLUS expr { Expr::Binary { left: Box::new($1), op: BinOp::Add, right: Box::new($3) } }
     | term { $1 } ;
```

- **Parsing:** For `1 + 2 + 3`, we parse `term` → 1, then `PLUS`, then `expr` → (2 + 3). So we build the tree as 1 + (2 + 3).
- **Associativity:** This gives **right** associativity. For addition it usually does not matter; for subtraction or exponentiation you may want right associativity anyway. For **left** associativity (e.g. 1 - 2 - 3 = (1 - 2) - 3), use Option 2.

The reference `Expr.grammar` uses this form so that the generated parser works without changing the generator.

**Option 2: Iterative style with repetition (left-associative)**

Use a single non-recursive symbol followed by a repeated (op, symbol) and fold in code:

```text
expr : term ( PLUS term { /* fold: left = Binary(left, Add, $2) */ } )* ;
```

Then the **generator** (or a hand-written loop) emits: parse one `term`, then `while peek == PLUS { consume PLUS; parse term; left = Binary(left, Add, term); }`. That yields left associativity. The reference generator does not yet emit this pattern automatically; you would need to extend it to recognize `term ( op term )*` and emit the loop, or write that part of the expression parser by hand (e.g. Pratt parser) and call it from the generated parser.

**Option 3: Precedence climbing (Pratt parser)**

Use a small **expression** subparser that handles precedence and associativity (e.g. Pratt/recursive descent with precedence levels). The rest of the language stays as generated recursive descent; only the expression part is hand-written or generated by a separate expression generator. This avoids left recursion entirely for expressions and gives full control over precedence and associativity.

### 4.11.4 Summary

| Approach              | Left recursion? | Associativity   | Supported by reference generator? |
|-----------------------|-----------------|-----------------|-----------------------------------|
| Left-recursive rule   | Yes (forbidden) | —               | No (infinite recursion)          |
| Right-recursive rule  | No              | Right           | Yes (see Expr.grammar)             |
| Iterative `term (op term)*` | No        | Left (if folded)| No (extend generator or hand-write)|
| Precedence climbing   | No              | Configurable    | No (hand-write expression parser)  |

**Recommendation:** For the reference tool, write expression rules in **right-recursive** form (e.g. `expr : term PLUS expr | term`) so the generated parser is correct. If you need left associativity, either extend the generator to emit a loop for `term (op term)*` or plug in a precedence-climbing expression parser for the expression nonterminal.

---

**Next:** [Chapter 5 — Simple Expression Language](05-expression-language.md)
