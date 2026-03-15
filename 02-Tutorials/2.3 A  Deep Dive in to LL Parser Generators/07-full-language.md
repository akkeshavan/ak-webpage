# Chapter 7: Full Language — Types, Functions, and Control Flow

**Previous:** [Chapter 6 — Building an Interpreter from ASTs](06-interpreter-from-ast.md)

This chapter defines a **larger language** with functions, types, expressions, **for** loops, and **if / else-if / else** statements. We give an ANTLR4-style grammar and an AST schema, and show how the parser generator and interpreter from previous chapters extend to this language.

> **Implementation note:** The reference repo implements FullLang end-to-end: a **hand-written** lexer and parser in `full_lang/` produce a `Program` AST; the interpreter runs it via `eval_full` and `run_program`. See [Implementation status](../docs/IMPLEMENTATION_STATUS.md) and the walkthrough below.

## 7.1 Language Features

- **Types:** integers, booleans, strings (and optionally more). Variables and parameters can be typed.
- **Expressions:** literals, identifiers, binary/unary operators, function calls, comparison, logical and/or.
- **Statements:**
  - **if / else-if / else**
  - **for** (e.g. `for i = 0; i < n; i = i + 1 { ... }` or `for x in list { ... }` if we add lists)
  - **while** (optional)
  - Assignment, block `{ ... }`, return, expression statement
- **Functions:** name, parameters (with optional types), optional return type, body (block). Top-level only for simplicity, or nested if the grammar allows.

## 7.2 Grammar: FullLang.g4

We use a single grammar file that includes both lexer and parser rules. See `source/examples/grammars/FullLang.g4` for the full grammar; below is a sketch.

**Lexer:** keywords (`if`, `else`, `for`, `while`, `fn`, `return`, `var`, `int`, `bool`, `string`), identifiers, literals (integer, string, `true`/`false`), operators and punctuation.

**Parser (high level):**

- **program:** top-level declarations and statements (functions and global statements).
- **declaration:** function declaration `fn name(params) -> type? { body }` or variable `var name : type? = expr`.
- **statement:** block, if/else-if/else, for, while, return, assignment, expression statement.
- **expr:** assignment (or not), logical or, logical and, comparison, additive, multiplicative, unary, primary (literal, id, call, parenthesized).

Precedence and associativity are encoded in the rule hierarchy. We avoid left recursion by using iterative forms (e.g. `expr : term ( ( PLUS | MINUS ) term )*`) or a dedicated expression subgrammar.

## 7.3 AST Schema for the Full Language

- **Program:** list of `Decl` and `Stmt`.
- **Decl:** `FnDecl { name, params: [(name, type?)], return_type?, body }`, `VarDecl { name, type?, init? }`.
- **Stmt:** `Block(Vec<Stmt>)`, `If { cond, then_branch, else_if_branches: [(cond, branch)], else_branch? }`, `For { init?, cond?, step?, body }`, `While(Expr, Stmt)`, `Return(Expr?)`, `Assign(name, Expr)`, `ExprStmt(Expr)`.
- **Expr:** as in expression language + `Call(name, args)`, comparison ops, logical and/or, maybe indexing.

The **parser generator** (Chapter 4) is extended so that rules for this grammar produce these AST nodes. The **interpreter** (Chapter 6) is extended to execute all these constructs.

## 7.4 Scoping and Execution

- **Global scope:** top-level variables and function names.
- **Function scope:** parameters and local variables; nested blocks can introduce inner scopes (optional).
- **Control flow:** if/else-if/else and for/while are implemented in the tree walker as in Chapter 6; for-loops evaluate init, then loop: check cond, run body, run step, repeat.

## 7.5 Integration with the Parser Generator

- **Grammar IR:** Our `.g4` parser and IR already support the constructs we need (alternatives, groups, `*`, `+`, `?`). We may add more lexer/parser rules as needed.
- **Code generation:** Parser and AST generator emit code that builds the full AST (Decl, Stmt, Expr variants). Same for Rust and JS targets.
- **Interpreter:** Implement `exec(stmt)` and `eval(expr)` for every new AST node type; use the value type (Int, Bool, Str, Fn, etc.) and environment/scopes from Chapter 6.

## 7.6 Output of This Chapter

- A complete **FullLang.g4** grammar.
- **AST** and **generated parser** for the full language in Rust (and optionally JS).
- **Interpreter** that can run programs with functions, types, for, and if/else-if/else, ready to be wired to the **runtime** and **stdlib** in Chapter 8.

---

## 7.7 Source Code: Full-Language AST and Grammar

The **AST** for the full language is in `source/code/src/ast.rs`: `Program`, `Decl`, `Stmt`, `FullExpr`, `Lit`. The **grammar** is in `source/examples/grammars/FullLang.g4`.

### 7.7.1 AST (excerpt)

```rust
// source/code/src/ast.rs
pub struct Program { pub items: Vec<ProgramItem> }
pub enum ProgramItem { Decl(Decl), Stmt(Stmt) }

pub enum Decl {
    Fn { name: String, params: Vec<(String, Option<String>)>, return_type: Option<String>, body: Vec<Stmt> },
    Var { name: String, type_name: Option<String>, init: Option<Box<Expr>> },
}

pub enum Stmt {
    Block(Vec<Stmt>),
    If { cond: Box<Expr>, then_branch: Vec<Stmt>, else_if_branches: Vec<(Expr, Vec<Stmt>)>, else_branch: Option<Vec<Stmt>> },
    For { init: Option<Box<Stmt>>, cond: Option<Box<Expr>>, step: Option<Box<Expr>>, body: Vec<Stmt> },
    While { cond: Box<Expr>, body: Vec<Stmt> },
    Return(Option<Box<Expr>>),
    Assign { name: String, value: Box<Expr> },
    ExprStmt(Box<Expr>),
}

pub enum FullExpr {
    Literal(Lit),
    Ident(String),
    Binary { left: Box<FullExpr>, op: BinOp, right: Box<FullExpr> },
    Call { name: String, args: Vec<FullExpr> },
    // ...
}
pub enum Lit { Int(i64), Bool(bool), Str(String) }
```

### 7.7.2 Grammar structure (FullLang.g4)

- **Lexer:** `INT_LIT`, `STR_LIT`, `TRUE`/`FALSE`, keywords (`IF`, `ELSE`, `FOR`, `WHILE`, `FN`, `RETURN`, `VAR`, `INT`, `BOOL`, `STRING`), `ID`, operators, `WS`/comments with `-> skip`.
- **Parser:** `program` → (decl | stmt)*; `decl` → fnDecl | varDecl; `stmt` → block | ifStmt | forStmt | whileStmt | returnStmt | assignStmt | exprStmt; `expr` → logicOr → … → primary (with call: `ID LPAREN argList? RPAREN`).

---

## 7.8 Code Walkthrough: Full Language vs Expression Language

### Differences

1. **AST:** We add `Program`/`Decl`/`Stmt` and `FullExpr`/`Lit` so we can represent functions, variables, control flow, and calls. The **parser generator** (Chapter 4) is unchanged in algorithm; we add more rule→node mappings and emit code that builds these types.
2. **Interpreter:** We already have `exec(Stmt)` and `eval(Expr)` in `interpreter.rs`. For the full language we’d add:
   - **Function definitions:** When we parse a `fnDecl`, store in env (or a separate function table) a value like `Value::Fn { params, body }`.
   - **Calls:** On `Call(name, args)`, first check the **runtime**’s native table (Chapter 8); if not found, look up `name` in env; if it’s `Value::Fn`, create a new scope with params bound to evaluated args, run the body, and handle `Return` (Chapter 6).
3. **Scoping:** Global scope holds top-level vars and function names. Each function call pushes a frame (new HashMap or chain of envs); return pops it. The reference interpreter uses a single `Env`; for nested scopes we’d pass a stack of envs or use a parent-pointer chain.

### Integration

- **Grammar IR** for FullLang is larger but uses the same structures (lexer/parser rules, alternatives, groups, *?+).
- **Codegen** emits parser functions that build `Program`, `Decl`, `Stmt`, `FullExpr` instead of just `Expr`.
- **Interpreter** extends `eval` to handle `FullExpr::Call` and `Lit`; `exec` already handles all `Stmt` variants. The runtime (Chapter 8) is used for native calls.

---

## 7.9 Reference Implementation: FullLang Parser and Interpreter (Source Walkthrough)

The reference crate implements FullLang with a **hand-written** lexer and parser (no generator) and the same interpreter/runtime used for the expression language.

### 7.9.1 FullLang lexer (`source/code/src/full_lang/lexer.rs`)

- **`Lexer::new(source)`** — wraps the source string; **`next_token()`** returns the next token (or `TokenKind::Eof`).
- **Skip phase:** `skip_whitespace_and_comments()` skips spaces/tabs/newlines and `//`/`/* */` comments; a lone `/` is returned as `DIV`.
- **Token order:** Two-character operators are tried first (`==`, `!=`, `<=`, `>=`, `->`), then single-character, then string literals `"..."` (with `\n`, `\t`, `\"`, `\\` escapes), then **keywords** (e.g. `true`, `if`, `fn`) vs **ID** (`[a-zA-Z_][a-zA-Z0-9_]*`), then **INT_LIT** (digits).
- **`Lexer::lex(source)`** — returns `Vec<Token>` (including a final `Eof`).

### 7.9.2 FullLang parser (`source/code/src/full_lang/parser.rs`)

- **`parse_program(source)`** — runs the lexer, then **`Parser::parse_program()`** to build a `Program`.
- **Program:** sequence of items; each item is either **Decl** (if token is `fn` or `var`) or **Stmt**.
- **Decl:** `parse_decl()` handles `fn name ( params ) -> type? block` and `var name : type? = expr? ;`.
- **Stmt:** `parse_stmt()` dispatches on first token: `{` → block, `if` → if (with optional else-if/else), `for`/`while` → loop, `return` → return, `ID` → assign (if next is `=`) or expression statement.
- **Expression precedence** (low to high): `logicOr` (or) → `logicAnd` (and) → `comparison` (==, !=, <, <=, >, >=) → `additive` (+,-) → `multiplicative` (*,/) → `unary` (-, not) → **primary** (literal, ID, ID(args), `( expr )`).
- **`parse_primary()`** — for `ID` followed by `(` we parse an argument list and build `FullExpr::Call { name, args }`; otherwise `FullExpr::Ident(name)`.

### 7.9.3 Full-language interpreter (`source/code/src/interpreter.rs`)

- **`eval_full(expr, env, runtime)`** — evaluates `FullExpr`: literals (Int/Bool/Str), `Ident` (env lookup), binary (arithmetic + comparison + And/Or), unary (Neg, Not), and **`Call`**: if `runtime` is provided, tries **`runtime.get_native(name)`** first; else looks up **`Value::Fn { params, body }`** in env, builds a new env with params bound to evaluated args, runs the body, and propagates **`Return(v)`**.
- **`exec(stmt, env, runtime)`** — executes `Stmt` (Block, If, For, While, Return, Assign, **VarDecl**, ExprStmt) using **`eval_full`** for all expressions.
- **`run_program(program, env, runtime)`** — processes items in order: **Decl::Fn** → insert **Value::Fn** into env; **Decl::Var** → evaluate init (if any) and insert; **Stmt** → **exec**; a top-level **Return** stops and returns that value.

See **`source/code/src/value.rs`** for **`Value`** (including **`Fn { params, body }`**) and **`RuntimeError`**; **`runtime.rs`** for **`Runtime::get_native`** and stdlib (print, write, readfile).

---

**Next:** [Chapter 8 — Runtime and Stdlib](08-runtime-stdlib.md)
