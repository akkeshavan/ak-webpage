# Building a Compiler with Rust and LLVM - 6

*Type checking (Part 1: subset)*

---

The **type checker** takes a parsed **Program** (AST) and produces a **TypedProgram** (typed AST) that the code generator consumes. It rejects unbound variables and type mismatches, and it **resolves overloaded** names (e.g. `println`, `ArrayLen`, `get`, `append`) to type-specific function names. The code for this chapter lives in `source/part1-recursive-descent/03-typecheck`.

---

## Goals of this chapter

- Define **Type** and **TypedExpr** / **TypedStmt** so every expression and statement has a known type for codegen.
- **Typecheck** full programs: type definitions, function definitions, and statements; maintain a type environment (variables and their types) and check function bodies.
- **Reject** unbound variables and type mismatches (e.g. string used where int is expected).
- **Resolve overloads:** map `println(x)` to `println_str` or `println_i64` from the argument type; map `ArrayLen(arr)`, `get`, `append`, `set` to the correct array backend (i64, str, or record) from the argument’s element type.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **Type**, **TypeError** | Type representation (Int, Str, Unit, Range, Array, Optional, Record, Sum, TypeVar); error variants (Unbound, Mismatch, ArgCount, etc.). |
| **TypedExpr**, **TypedStmt** | Typed AST; each node carries or implies a type. |
| **TypeChecker** | Holds `env: HashMap<String, Type>` (and type defs, function signatures). **`check_program`** / **`check_function`** / **`check_stmt`** / **`check_expr`** recurse over the AST. |
| **Prelude / built-ins** | A map of function names to (parameter types, return type); used for `println`, `print`, array ops, `ArrayLen`, etc. Overload resolution picks the right entry (e.g. by first-argument type). |

---

## Dependencies (Cargo.toml) for this chapter

```toml
[package]
name = "lumina-part1-typecheck"
version = "0.1.0"
edition = "2021"

[dependencies]
lumina-part1-lexer = { path = "../01-lexer" }
lumina-part1-parser = { path = "../02-parser" }
```

- **lumina-part1-lexer:** Re-exports or types from the lexer if needed (often only the parser is used for AST types).
- **lumina-part1-parser:** We consume **Program**, **Expr**, **Stmt**, **TypeAnn** from the parser and produce **TypedProgram**, **TypedExpr**, **TypedStmt**. The type checker does not emit IR; it only enriches the AST with types and resolves overloads.

---

## 6.1 Types and errors (updated)

`source/part1-recursive-descent/03-typecheck/src/lib.rs`:

```rust
The current `Type` enum includes:

- `Int`
- `Str`
- `Unit`
- `Range` (only usable as the RHS of `for … in …`; it isn’t a first-class runtime value yet)
- **`Record`** (named fields and types)
- **`Sum`** (algebraic data type: list of variant names and their payload types)
- **`Array(Box<Type>)`** — generic array type (e.g. `Array<i64>`, `Array<str>`). The type checker accepts `Array<T>` for any `T`; the compiler and runtime currently support `T = i64` and `T = str` (see Chapter 8).

#[derive(Debug)]
pub enum TypeError {
    Unbound(String),
    Mismatch(Type, Type),
}
```

---

## 6.2 The typed AST (updated)

```rust
The typed tree has:

- `TypedProgram` / `TypedFunctionDef`
- `TypedStmt` for `let`, expression statements, `return`, `for`, and assignment
- `TypedExpr` for integers, strings, arithmetic (including modulus `%`), comparisons, calls, `if`, ranges, **records** (literals and field access), **constructors** (sum-type values), and **match** (exhaustive pattern matching on sum types)

### Update: `ArrayLen(arr)` overload

**`ArrayLen(arr)`** is a built-in that takes one array argument and returns its length as `i64`. The type checker resolves it by the argument’s element type: `Array<i64>` → `array_i64_len`, `Array<str>` → `array_str_len`, and `Array<Record>` (array of records) uses the same i64-based representation. This allows loops like `for i in 0..ArrayLen(arr) { ... }` for arrays of integers, strings, or records.

### Update: `println`/`print` overload resolution

We treat `println` and `print` as *overloaded* based on the argument type:

- `println("hi")` → string form
- `println(42)` → integer form (`println_i64`) internally

This is implemented in the `Expr::Call` branch of the type checker by typechecking the first argument, then selecting the correct signature.
```

---

## 6.3 The type checker

```rust
pub struct TypeChecker {
    env: HashMap<String, Type>,
}

impl TypeChecker {
    pub fn new() -> Self {
        Self {
            env: HashMap::new(),
        }
    }

    pub fn check(&mut self, expr: &Expr) -> Result<TypedExpr, TypeError> {
        match expr {
            Expr::Int(n) => Ok(TypedExpr::Int(*n)),
            Expr::Var(name) => {
                let _ty = self
                    .env
                    .get(name)
                    .cloned()
                    .ok_or(TypeError::Unbound(name.clone()))?;
                Ok(TypedExpr::Var(name.clone()))
            }
            Expr::Add(l, r) => Ok(TypedExpr::Add(Box::new(self.check(l)?), Box::new(self.check(r)?))),
            Expr::Sub(l, r) => Ok(TypedExpr::Sub(Box::new(self.check(l)?), Box::new(self.check(r)?))),
            Expr::Mul(l, r) => Ok(TypedExpr::Mul(Box::new(self.check(l)?), Box::new(self.check(r)?))),
        }
    }
}
```

**Implementation walkthrough:**

1. **`check_program(program)`** – Registers type definitions (name → Type) and function signatures (name → (param types, return type)) in the type checker. Then typechecks each function: for each function, the environment is seeded with parameter names and their types; the body (statements) is checked in order; each `let` adds a binding to the environment.
2. **`check_expr(expr)`** – **Int/Str/Unit** → return the obvious typed node. **Var(name)** → look up `name` in `env`, return `TypedExpr::Var(name, ty)`; if not found, return `Unbound(name)`. **Add/Sub/Mul/Div/Mod** → typecheck left and right, require both to be Int, return typed node with type Int. **Call(name, args)** → if name is overloaded (e.g. `println`), typecheck the first argument and pick the overload (e.g. `println_str` vs `println_i64`); then check remaining args against the chosen signature and return the chosen return type. **ArrayLen(arr)** → typecheck `arr`, require it to be `Array(elem_ty)`, resolve to `array_i64_len` / `array_str_len` / same for record; return Int. **If(cond, then_b, else_b)** → typecheck cond (must be usable as bool), typecheck both branches; branches must have the same type; return that type. **Record literals, field access, match** → typecheck subexpressions and construct typed nodes with the appropriate Record or Sum type.
3. **`check_stmt(stmt)`** – **Let(name, type_ann, expr)** → typecheck expr; if type_ann is present, unify or check compatibility; extend env with name → type. **Expr(e)** → typecheck e (result discarded for side effects). **Return(Some(e))** → typecheck e; type must match function return type. **For** → typecheck range (must be Range), extend env with loop variable as Int, typecheck body. **Assign(lhs, rhs)** → lhs must be Var or FieldAccess; typecheck both; types must match.
4. **Arrays of records** – For `Array(Record(...))`, the type checker allows it and resolves `ArrayLen`, `get`, `append`, `set` to the same backend as i64 (pointers stored as integers); codegen will insert ptr2int/int2ptr at boundaries.

---

## 6.4 Running tests

```bash
cd source/part1-recursive-descent/03-typecheck
cargo test
```

---

## 6.5 Summary

We now have a `TypedExpr` tree for the full language, including sum types and match (with exhaustiveness checking). Next we lower that into LLVM IR.

**Next:** **Chapter 7 — Code Generation** (`source/part1-recursive-descent/04-codegen`).
