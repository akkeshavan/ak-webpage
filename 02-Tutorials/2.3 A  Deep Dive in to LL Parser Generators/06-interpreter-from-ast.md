# Chapter 6: Building an Interpreter from ASTs

**Previous:** [Chapter 5 — Simple Expression Language](05-expression-language.md)

This chapter explains how to **build an interpreter** that executes programs by **walking the AST** and evaluating nodes. We start with the **expression language** and lay the groundwork for the **full language** (Chapter 7) and the **runtime** (we’ll build that in Chapters 8–9).

## 6.1 Interpreter vs Compiler

- **Compiler:** AST → (e.g.) LLVM IR → native code; execution is separate.
- **Interpreter:** AST is executed directly by an **evaluator** that walks the tree and performs operations (arithmetic, control flow, function calls) in the host language.

Our **interpreted mode** (Chapter 9) will run the generated parser, get an AST, and feed it to an interpreter implemented in the **same target language** as the parser (e.g. Rust), using a **runtime** that we provide.

## 6.2 Evaluation Model

- **Expressions** evaluate to **values**: numbers, booleans, strings, or (later) function references, composite values.
- **Statements** don’t produce a value (except maybe return); they have **effects**: bind variables, change control flow, call functions.
- We need an **environment** (symbol table): map variable names to values. For functions we’ll have a **call stack** and possibly a **global scope** plus **function scope**.

## 6.3 Expression Interpreter (Expression Language Only)

For the simple expression language (Chapter 5):

- **Literal(n):** return `n`.
- **Ident(name):** look up `name` in the environment; if missing, error (or 0 for a minimal demo).
- **Binary(left, op, right):** evaluate `left` and `right`, then apply `op` (+, -, *, /). Handle division by zero.

The **evaluator** is a recursive function (or a match on AST node type) that returns a value. No statements yet.

## 6.4 Adding Statements (Full Language Preview)

When we add the full language (Chapter 7), the interpreter will:

- **Block:** create a new scope (optional), execute statements in order.
- **If / Else:** evaluate condition, then execute then-branch or else-branch.
- **For / While:** loop: evaluate condition, execute body, update (for: step), repeat.
- **Assignment:** evaluate RHS, store in current scope (create or update).
- **Expression statement:** evaluate expression and discard value (or use for side effects).
- **Return:** set a “return value” and unwind to the caller (see below).

## 6.5 Functions

- **Definition:** store function (name, params, body) in the environment (or a separate function table).
- **Call:** evaluate arguments, push new frame with params bound to args, execute body, pop frame and return the return value.
- **Return:** when we hit `Return(expr)`, evaluate `expr`, then unwind the call stack and pass the value back. This can be done with a return flag/result cell or with exceptions/early-exit in the host language.

## 6.6 Design Patterns for the Tree Walker

Two common patterns:

1. **Visitor:** Each AST node type has a `visit_*(&self, ctx)` method; the interpreter implements the visitor and drives traversal. Good for keeping logic per node type.
2. **Single recursive function:** One function `eval(expr) -> Value` and `exec(stmt)` that match on node type and recurse. Simpler for small languages.

We can start with **(2)** and refactor to a visitor if the interpreter grows.

## 6.7 Values and Types

- **Expression language:** values might be just `i64` (or `f64`).
- **Full language:** we need a **value type**: e.g. `Int(i64)`, `Bool(bool)`, `Str(String)`, `Fn(params, body)`, maybe `Nil`. The interpreter and runtime (Chapters 8–9) will use this representation so that **stdlib functions** (e.g. `print`, `write`, `readfile`) can be called from interpreted code.

## 6.8 Error Handling

- **Runtime errors:** undefined variable, type mismatch, division by zero, non-callable value. Report with **source location** if we store span in AST nodes.
- **Return:** distinguish “return from function” from “error”; use a dedicated return path (e.g. enum `EvalResult::Return(Value)` vs `EvalResult::Ok(Value)`).

## 6.9 Output of This Chapter

- A clear **design** for the interpreter: evaluation of expressions and (in outline) statements and functions.
- **Implementation** of an interpreter for the **expression language** (and optionally a minimal subset of the full language).
- Foundation for **runtime** (stdlib, extensibility) and **interpreted mode** (parser + interpreter + runtime in the same target).

---

## 6.10 Source Code

The interpreter lives in `source/code/src/interpreter.rs`. It provides **eval** (expression → value) and **exec** (statement → effect), plus a simple **environment** (map of names to values).

### 6.10.1 Values and environment

```rust
// source/code/src/interpreter.rs (excerpt)
#[derive(Clone, Debug)]
pub enum Value {
    Int(i64),
    Bool(bool),
    Str(String),
    Nil,
}

pub type Env = HashMap<String, Value>;
```

### 6.10.2 Evaluating expressions

```rust
pub fn eval(expr: &Expr, env: &Env) -> Result<Value, RuntimeError> {
    match expr {
        Expr::Literal(n) => Ok(Value::Int(*n)),
        Expr::Ident(name) => env
            .get(name)
            .cloned()
            .ok_or_else(|| RuntimeError::UndefinedVar(name.clone())),
        Expr::Binary { left, op, right } => {
            let l = eval(left, env)?;
            let r = eval(right, env)?;
            match (l, r) {
                (Value::Int(a), Value::Int(b)) => match op {
                    BinOp::Add => Ok(Value::Int(a + b)),
                    BinOp::Sub => Ok(Value::Int(a - b)),
                    BinOp::Mul => Ok(Value::Int(a * b)),
                    BinOp::Div => if b == 0 { Err(RuntimeError::DivByZero) } else { Ok(Value::Int(a / b)) },
                },
                _ => Err(RuntimeError::Type("expected two integers".into())),
            }
        }
        Expr::Unary { op, operand } => {
            let v = eval(operand, env)?;
            match (op, v) {
                (UnOp::Neg, Value::Int(n)) => Ok(Value::Int(-n)),
                _ => Err(RuntimeError::Type("expected integer for unary neg".into())),
            }
        }
    }
}
```

### 6.10.3 Executing statements

```rust
pub fn exec(stmt: &Stmt, env: &mut Env) -> Result<(), RuntimeError> {
    match stmt {
        Stmt::Block(stmts) => {
            for s in stmts { exec(s, env)?; }
            Ok(())
        }
        Stmt::ExprStmt(expr) => { eval(expr, env)?; Ok(()) }
        Stmt::Assign { name, value } => {
            let v = eval(value, env)?;
            env.insert(name.clone(), v);
            Ok(())
        }
        Stmt::If { cond, then_branch, else_if_branches, else_branch } => {
            if to_bool(&eval(cond, env)?) {
                for s in then_branch { exec(s, env)?; }
            } else {
                // try else_if, then else_branch
            }
            Ok(())
        }
        Stmt::Return(expr) => Err(RuntimeError::Return(...)),
        // For, While: loop with to_bool(cond)
    }
}
```

Conditions use a helper **to_bool**: `Int(0)` → false, other `Int` → true, `Bool(b)` → b.

---

## 6.11 Code Walkthrough: Key Algorithms

### Algorithm 1: Expression evaluation (eval)

**Goal:** Turn an AST expression into a single value using the current environment.

- **Literal(n):** Return `Value::Int(n)`.
- **Ident(name):** Look up `name` in `env`; if missing, return `UndefinedVar`.
- **Binary(left, op, right):** Recursively evaluate `left` and `right`. If both are `Value::Int`, apply the operator (+, -, *, /); for `/`, return `DivByZero` if divisor is 0. Otherwise return a type error.
- **Unary(Neg, operand):** Evaluate `operand`; if `Value::Int(n)`, return `Value::Int(-n)`; else type error.

So **eval** is a single recursive match on the expression type; no mutable state except reading from `env`.

### Algorithm 2: Statement execution (exec)

**Goal:** Execute one statement, updating the environment and optionally signaling return.

- **Block:** Execute each statement in order; abort on first error (or return).
- **ExprStmt:** Evaluate the expression and discard the value (side effects only).
- **Assign:** Evaluate RHS, then `env.insert(name, value)`.
- **If:** Evaluate condition; coerce to bool via **to_bool**. If true, run then_branch; else try each else_if; else run else_branch.
- **For:** Run init once. Loop: evaluate cond (if present), coerce to bool; if false, break. Run body, then step. Repeat.
- **While:** Loop: evaluate cond, coerce to bool; if false break; run body.
- **Return(expr):** Evaluate expr (or use Nil), then return `Err(RuntimeError::Return(value))`. The **caller** (e.g. a function runner) catches this and propagates the value.

So **exec** mutates `env` and uses **eval** for expressions; return is implemented as a sentinel error so we don’t need explicit stack unwinding in this design.

### Algorithm 3: Condition coercion (to_bool)

For the expression language we may only have integers. We treat **Int(0)** as false and any other **Int** as true; **Bool(b)** as b. That way conditions in if/for/while work before we add a dedicated bool type in the grammar.

---

**Next:** [Chapter 7 — Full Language: Types, Functions, Control Flow](07-full-language.md)
