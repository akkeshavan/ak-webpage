# Chapter 3: Lexer Generator

**Previous:** [Chapter 2 — Grammar Representation and Parsing](02-grammar-and-ir.md)

This chapter implements the **lexer generator**: given the lexer part of our grammar IR, emit a **lexer** in the target language (Rust first, then JavaScript or another language).

## 3.1 Role of the Lexer

The lexer turns **source text** into a **stream of tokens**:

- Each token has: **type** (e.g. `INT`, `PLUS`, `ID`), **text** (slice or string), and optionally **location** (line, column).
- Rules: **longest match** wins; if several rules match, the **first** (in grammar order) is typically chosen. This is why order of lexer rules matters.

Our generator will produce **source code** that implements this behavior in the target language.

## 3.2 Design Choices

- **Output:** A module/class that exposes something like:
  - `next_token() -> Token` (or `tokenize() -> Vec<Token>`),
  - and possibly `Token { type, text, line, col }`.
- **Strategy:** For each lexer rule we need to recognize one or more **alternatives**. We can:
  - Generate a **state machine** (e.g. DFA) from the combined rules—powerful but more complex.
  - Use **regex-like** matching: for each rule, build a matcher (regex or hand-written loop) and try rules in order with longest match—simpler and enough for many grammars.

We’ll start with a **per-rule matcher** and **try rules in order**, taking the longest match. That matches ANTLR4’s default behavior for disjoint rule sets.

## 3.3 From Grammar IR to Lexer Code (Rust Target)

### 3.3.1 Token Type Enum

Generate a Rust enum (or equivalent in other targets) with one variant per **non-fragment** lexer rule:

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    Int,
    Plus,
    Minus,
    Id,
    Eof,
    // ...
}
```

And a token value type:

```rust
pub struct Token {
    pub kind: TokenKind,
    pub text: String,
    pub line: u32,
    pub column: u32,
}
```

### 3.3.2 Lexer Structure

Generated lexer holds:

- Input string (or iterator over characters).
- Current position, line, column.
- (Optional) lookahead buffer for longest-match.

Pseudocode for main loop:

```
while not at EOF:
    skip whitespace (and comments if in grammar)
    start = position
    best = (rule_index, length) = (none, 0)
    for each non-fragment rule in order:
        try to match rule from start
        if match length > best.length: best = (rule_index, length)
    if best is none: error (unexpected character)
    else: emit token for best.rule, advance by best.length
```

### 3.3.3 Translating Lexer Elements to Code

- **Literal:** Match fixed string; advance if equal.
- **Char range `[a-z]`:** One character in range.
- **Char set `[abc]`:** One character in set.
- **Rule ref (fragment):** Call generated function for that fragment; it returns length or failure.
- **Negation `~x`:** Match single char not matching `x`.

For each rule we generate a function that returns **number of characters matched** (0 if no match). The main loop uses these to implement longest-match.

## 3.4 Generating the Lexer in Rust

- Emit a **Rust module** (or a string that can be written to a file).
- Use the grammar name for module/struct names (e.g. `ExprLexer`).
- Implement:
  - `Token` and `TokenKind`.
  - `Lexer::new(input: &str)`.
  - `Lexer::next_token(&mut self) -> Token`.
- Handle **EOF** explicitly: after consuming all input, emit an `Eof` token (and then subsequent calls can return `Eof` again or panic, as you prefer).

## 3.5 Generating the Lexer in Another Language (e.g. JavaScript)

Same algorithm, different syntax:

- **Token:** Object `{ kind, text, line, column }`. `kind` can be string or enum-like constants.
- **Lexer:** Class or function returning an iterator/generator of tokens.
- **Matching:** Same longest-match loop; character access via `input[i]`, substrings via `slice`.

Goal: **one** grammar IR → **multiple** target lexers (Rust and JS) so we can generate both from the same `.g4` file.

## 3.6 Handling Keywords

In ANTLR4, keywords are often lexer rules that look like `IF : 'if' ;`. So `IF` is a token type. The parser then uses `IF` in rules. Our generator doesn’t need to treat keywords specially: they’re just lexer rules. If the grammar has both `ID` and `IF : 'if'`, put `IF` before `ID` so that `"if"` is tokenized as `IF`, not `ID`.

## 3.7 Skipping Whitespace and Comments

- **Whitespace:** Either a single lexer rule `WS : [ \t\n\r]+ -> skip ;` or built-in skip in the generated lexer for space, tab, newline.
- **Comments:** If the grammar has `LINE_COMMENT` and `BLOCK_COMMENT` with `-> skip`, generate code that doesn’t emit a token for them (advance input and continue).

So the IR must record **skip** (or **channel**) for rules; then the generator either doesn’t emit a token or puts it on a hidden channel. For simplicity, “skip” = don’t emit.

## 3.8 Output of This Chapter

- A **lexer generator** that takes `Grammar` (or its lexer rules) and **emits**:
  - Rust lexer (source code),
  - JavaScript (or other) lexer (source code).
- The generated lexer can be compiled/run and used by the **generated parser** (Chapter 4).

The **Grammar** can be built by hand, from a minimal `.g4` subset (`g4_parser`), or from a **.grammar file** that includes lexer and parser rules with semantic actions—see **§2.9** and `grammar_loader::load_grammar_file`. The CLI command **`parser_gen gen <grammar_file> -o <dir>`** (Chapter 9) loads such a file and runs both the lexer and parser generators to produce a full lexer and parser.

---

## 3.9 Source Code

The reference implementation lives under `source/code/src/`. The **grammar IR** is in `grammar.rs` (from Chapter 2). The **lexer generator** is in `lexer_gen.rs`.

### 3.9.1 Grammar IR (excerpt)

We use the same structures as in Chapter 2; lexer rules can be marked `skip` for whitespace/comments:

```rust
// source/code/src/grammar.rs (excerpt)
pub struct Grammar {
    pub name: String,
    pub lexer_rules: Vec<LexerRule>,
    pub parser_rules: Vec<ParserRule>,
}

pub struct LexerRule {
    pub name: String,
    pub fragment: bool,
    pub skip: bool,
    pub alternatives: Vec<LexerAlt>,
}

pub enum LexerElement {
    Literal(String),
    CharRange(char, char),
    CharSet(Vec<char>),
    RuleRef(String),
    Negated(Box<LexerElement>),
}
```

### 3.9.2 Lexer generator entry point

The generator writes a single Rust module string. It builds token rules (non-fragment, non-skip), then emits the enum, struct, and `next_token` loop:

```rust
// source/code/src/lexer_gen.rs (excerpt)
pub fn generate_rust_lexer(grammar: &Grammar) -> Result<String, std::fmt::Error> {
    let mut out = String::new();
    let token_rules: Vec<_> = grammar
        .lexer_rules
        .iter()
        .filter(|r| !r.fragment && !r.skip)
        .collect();
    // 1. Emit TokenKind enum and Token struct
    // 2. Emit Lexer struct and new(), peek(), advance(), skip_ws()
    // 3. For each rule (including fragments): emit match_XXX(start) -> Option<usize>
    // 4. Emit next_token(): skip_ws, then longest-match over token_rules
    // ...
}
```

### 3.9.3 Longest-match loop (generated code pattern)

The **generated** lexer’s `next_token` implements the longest-match algorithm like this:

```rust
// Pattern of generated code inside next_token()
self.skip_ws();
let start = self.pos;
if self.peek().is_none() {
    return Token { kind: TokenKind::Eof, ... };
}
let mut best_len = 0usize;
let mut best_kind = TokenKind::Eof;

if let Some(len) = self.match_int(start) {
    if len > best_len { best_len = len; best_kind = TokenKind::Int; }
}
if let Some(len) = self.match_plus(start) {
    if len > best_len { best_len = len; best_kind = TokenKind::Plus; }
}
// ... one block per token rule ...

if best_len == 0 { panic!("Unexpected char"); }
let text = self.slice(start, start + best_len);
for _ in 0..best_len { self.advance(); }
Token { kind: best_kind, text, line, column }
```

### 3.9.4 Per-rule match function (one alternative)

Each rule gets a `match_<name>(&self, start: usize) -> Option<usize>`. For one alternative, we advance a logical `pos` and return `Some(pos - start)` if the whole sequence matches:

```rust
// Generated: match_int for INT : [0-9]+
fn match_int(&self, start: usize) -> Option<usize> {
    let mut pos = start;
    while let Some(&c) = self.input.get(pos) {
        if c >= '0' && c <= '9' { pos += 1; } else { break; }
    }
    if pos > start { Some(pos - start) } else { None }
}
```

(Our current generator emits character-by-character checks; for `[0-9]+` we could emit a loop like above. The **algorithm** is: try each element in sequence; if any fails, return `None` or `break` to try the next alternative.)

### 3.9.5 Multiple alternatives (try in order)

When a lexer rule has multiple alternatives (e.g. `PLUS : '+' ; MINUS : '-' ;` or one rule with `|`), we try each in order. The emitter uses a block per alternative; failure in one block falls through to the next:

```rust
// source/code/src/lexer_gen.rs — emit_match_fn (simplified)
for alt in &rule.alternatives {
    writeln!(out, "        {{")?;
    writeln!(out, "            let mut pos = start;")?;
    for elem in &alt.elements {
        emit_element_match(elem, out, "pos", true)?;  // on fail: break
    }
    writeln!(out, "            return Some(pos - start);")?;
    writeln!(out, "        }}")?;
}
writeln!(out, "        None")?;
```

So the generated code looks like: `{ let mut pos = start; ...; return Some(pos - start); } { let mut pos = start; ...; return Some(pos - start); } None`.

---

## 3.10 Code Walkthrough: Key Algorithms

### Algorithm 1: Longest-match token choice

**Goal:** At a given position, choose the token that matches the **longest** span of input. If multiple rules match the same length, the **first** (in grammar order) wins.

**Steps:**

1. **Skip whitespace** (and any skip rules) so we start at the first “real” character.
2. If at EOF, emit an `Eof` token and return.
3. **Initialize** `best_len = 0`, `best_kind = Eof`.
4. **For each** non-fragment, non-skip lexer rule in order:
   - Call `match_<rule>(start)`. It returns `Some(n)` if the rule matches `n` characters from `start`.
   - If `n > best_len`, set `best_len = n` and `best_kind` to that rule’s token kind.
5. If `best_len == 0`, no rule matched → report an error (unexpected character).
6. **Emit** a token with `best_kind` and text `input[start..start+best_len]`, then advance the lexer position by `best_len`. After emitting a token, we advance by `best_len` so the next `next_token` call starts at the right place; the generated lexer’s `advance()` keeps line and column in sync.

**Why longest match:** So that `"123"` is one `INT` token, not three single-digit tokens, and `"if"` is one keyword token when we have both `IF` and `ID` rules (and `IF` is tried first).

### Algorithm 2: Matching one rule (match_XXX)

**Goal:** Decide how many characters a single rule matches from `start`, without consuming the input (the lexer advances only after choosing the best token).

**Steps:**

1. For **each alternative** of the rule (in order):
   - Set a local `pos = start`.
   - For **each element** in the alternative:
     - **Literal:** Check that `input[pos..]` starts with the literal; if so, add its length to `pos`; else fail this alternative (break or return None).
     - **Char range `[a-z]`:** If `input[pos]` is in range, `pos += 1`; else fail.
     - **Char set:** Same with a set of allowed characters.
     - **Rule ref (fragment):** Call `match_<fragment>(pos)`. If it returns `Some(n)`, do `pos += n`; else fail.
   - If all elements matched, return `Some(pos - start)`.
2. If no alternative matched, return `None`.

So each `match_XXX` is **pure**: it only reads from the input and returns a length or failure. The main loop then picks the longest successful match.

### Algorithm 3: Emitting code from grammar IR

**Goal:** From `Grammar::lexer_rules`, produce Rust (or JS) source that implements the above.

1. **Token set:** Collect rules where `!fragment && !skip`; emit `TokenKind` and `Token` (and in JS, constants or an enum-like object).
2. **Lexer state:** Emit struct/class with `input`, `pos`, `line`, `column`, and helpers `peek()`, `advance()`, `skip_ws()`.
3. **Per-rule matcher:** For each lexer rule, emit `match_<name>(start) -> Option<usize>`:
   - For each alternative, emit a block: `let mut pos = start;` then, for each element, emit the corresponding condition and `pos` update (or `break` on failure).
   - Return `Some(pos - start)` at the end of a successful block, `None` after all alternatives.
4. **next_token:** Emit the longest-match loop as in 3.9.3, then advance by `best_len` and return the token.

With this, the **generated** lexer is a runnable implementation of the two algorithms above. The **generator** itself is in `source/code/src/lexer_gen.rs`; you can trace `generate_rust_lexer` and `emit_match_fn` / `emit_element_match` to see how each IR construct is turned into code.

---

**Next:** [Chapter 4 — Parser and AST Generation](04-parser-ast-generation.md)
