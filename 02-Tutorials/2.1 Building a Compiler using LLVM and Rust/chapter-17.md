# Building a Compiler with Rust and LLVM - 17

*Part 2: Type checking*

---

The **type checker** takes a parsed program (AST) and produces a **typed program** that the code generator can lower to LLVM IR. In Part 2 we **reuse Part 1’s type checker**: the only difference is the **source** of the AST (Pest parser in Part 2 vs hand-written parser in Part 1). To do that, we either (1) build the **same** AST types as Part 1 in the Part 2 parser (so we can pass them directly), or (2) convert the Part 2 AST into Part 1’s AST and then run Part 1’s type checker.

This chapter mirrors **Chapter 6** (Part 1 type checking): we produce a **TypedProgram** (typed functions and statements), reject unbound variables and type mismatches, resolve overloads for `println`/`print` and `ArrayLen`/`get`/`append`/`set`, and support the same types (including records, arrays of records, and unit). Code lives in `source/part2-pest/03-typecheck`.

---

## Goals of this chapter

- **Reuse Part 1’s type checker** so we do not duplicate type rules or overload resolution.
- **Convert** Part 2 AST to Part 1 AST (to_part1_program, to_p1_expr, to_p1_stmt, to_p1_type_ann) so Part 1’s check_program can run.
- Expose a single **typecheck(source)** that parses (Part 2), converts, then runs Part 1 typecheck and returns TypedProgram or an error.

---

## Code structure in this chapter

| Area | Role |
|------|------|
| **03-typecheck** | Depends on Part 2 parser, Part 1 typecheck, Part 1 parser. |
| **to_p1_*** | Recursive conversion from Part 2 AST types to Part 1 AST types (every variant mapped). |
| **typecheck(source)** | Parse with Part 2 → convert to Part 1 Program → TypeChecker::check_program → TypedProgram. |

---

## 17.1 Cargo.toml and dependencies

`source/part2-pest/03-typecheck/Cargo.toml`:

```toml
[package]
name = "lumina-part2-typecheck"
version = "0.1.0"
edition = "2021"

[dependencies]
lumina-part2-parser = { path = "../02-parser" }
lumina-part1-typecheck = { path = "../../part1-recursive-descent/03-typecheck" }
lumina-part1-parser = { path = "../../part1-recursive-descent/02-parser" }
```

**What each dependency does:**

- **lumina-part2-parser:** We read the AST produced by the Pest parser (`Program`, `Expr`, `Stmt`, etc.). If the Part 2 parser exports the **same** types as Part 1 (same names and shape), we can pass that AST directly to Part 1’s type checker. If the Part 2 parser uses its **own** AST types (e.g. in a different crate), we need a **conversion** layer.
- **lumina-part1-typecheck:** Contains `TypeChecker`, `check_program`, `TypedProgram`, `TypedExpr`, `TypedStmt`, `Type`, and `TypeError`. We call the same logic that Part 1 uses.
- **lumina-part1-parser:** Part 1’s AST types (`Program`, `Expr`, `Stmt` from Part 1). We need this if we **convert** Part 2 AST → Part 1 AST and then call Part 1’s type checker; the type checker is defined over Part 1’s `Program`/`Expr`/`Stmt`.

**Two designs:**

1. **Shared AST:** Part 2 parser builds the **exact** types defined in Part 1’s parser (e.g. Part 2 parser depends on Part 1 parser and re-exports or uses `lumina_part1_parser::Program`). Then Part 2 typecheck only needs `lumina-part2-parser` (which is just a thin wrapper that returns Part 1’s `Program`) and `lumina-part1-typecheck`. No conversion.
2. **Separate AST + conversion:** Part 2 parser defines its own `Program`/`Expr`/`Stmt`. Part 2 typecheck depends on Part 2 parser and Part 1 typecheck and Part 1 parser. We implement a function `to_part1_program(p2: &Program) -> lumina_part1_parser::Program` and then call `lumina_part1_typecheck::check_program(&to_part1_program(&p))`.

We describe the **conversion** approach so that the Part 2 parser can remain independent (e.g. different AST names or small differences) and we still reuse Part 1’s type checker entirely.

---

## 17.2 Converting Part 2 AST to Part 1 AST (implementation walkthrough)

Assume the Part 2 parser exposes `Program`, `Expr`, `Stmt`, `TypeAnn`, `FunctionDef`, etc. We implement recursive conversion so that Part 1’s type checker sees the same structure.

```rust
use lumina_part1_parser::{Program as P1Program, Expr as P1Expr, Stmt as P1Stmt, TypeAnn as P1TypeAnn, FunctionDef as P1FunctionDef, TypeDef as P1TypeDef, SumVariant as P1SumVariant, MatchArm as P1MatchArm};
use lumina_part2_parser::{Program, Expr, Stmt, TypeAnn, FunctionDef, TypeDef, SumVariant, MatchArm};

fn to_p1_type_ann(t: &TypeAnn) -> P1TypeAnn {
    match t {
        TypeAnn::I64 => P1TypeAnn::I64,
        TypeAnn::Str => P1TypeAnn::Str,
        TypeAnn::Unit => P1TypeAnn::Unit,
        TypeAnn::Array(inner) => P1TypeAnn::Array(Box::new(to_p1_type_ann(inner))),
        TypeAnn::Optional(inner) => P1TypeAnn::Optional(Box::new(to_p1_type_ann(inner))),
        TypeAnn::Record(fields) => P1TypeAnn::Record(
            fields.iter().map(|(n, t)| (n.clone(), to_p1_type_ann(t))).collect()
        ),
        TypeAnn::Named(n) => P1TypeAnn::Named(n.clone()),
        TypeAnn::Sum(variants) => P1TypeAnn::Sum(
            variants.iter().map(|v| P1SumVariant {
                name: v.name.clone(),
                payload: v.payload.iter().map(to_p1_type_ann).collect(),
            }).collect()
        ),
    }
}

fn to_p1_expr(e: &Expr) -> P1Expr {
    match e {
        Expr::Int(n) => P1Expr::Int(*n),
        Expr::Str(s) => P1Expr::Str(s.clone()),
        Expr::Var(s) => P1Expr::Var(s.clone()),
        Expr::Add(l, r) => P1Expr::Add(Box::new(to_p1_expr(l)), Box::new(to_p1_expr(r))),
        Expr::Sub(l, r) => P1Expr::Sub(Box::new(to_p1_expr(l)), Box::new(to_p1_expr(r))),
        Expr::Mul(l, r) => P1Expr::Mul(Box::new(to_p1_expr(l)), Box::new(to_p1_expr(r))),
        Expr::Div(l, r) => P1Expr::Div(Box::new(to_p1_expr(l)), Box::new(to_p1_expr(r))),
        Expr::Mod(l, r) => P1Expr::Mod(Box::new(to_p1_expr(l)), Box::new(to_p1_expr(r))),
        Expr::Eq(l, r) => P1Expr::Eq(Box::new(to_p1_expr(l)), Box::new(to_p1_expr(r))),
        Expr::Ne(l, r) => P1Expr::Ne(Box::new(to_p1_expr(l)), Box::new(to_p1_expr(r))),
        Expr::Lt(l, r) => P1Expr::Lt(Box::new(to_p1_expr(l)), Box::new(to_p1_expr(r))),
        Expr::Le(l, r) => P1Expr::Le(Box::new(to_p1_expr(l)), Box::new(to_p1_expr(r))),
        Expr::Gt(l, r) => P1Expr::Gt(Box::new(to_p1_expr(l)), Box::new(to_p1_expr(r))),
        Expr::Ge(l, r) => P1Expr::Ge(Box::new(to_p1_expr(l)), Box::new(to_p1_expr(r))),
        Expr::Call(n, args) => P1Expr::Call(n.clone(), args.iter().map(to_p1_expr).collect()),
        Expr::Unit => P1Expr::Unit,
        Expr::Range { start, end, inclusive, step } => P1Expr::Range {
            start: Box::new(to_p1_expr(start)),
            end: Box::new(to_p1_expr(end)),
            inclusive: *inclusive,
            step: step.as_ref().map(|e| Box::new(to_p1_expr(e))),
        },
        Expr::If(c, t, e) => P1Expr::If(
            Box::new(to_p1_expr(c)),
            Box::new(to_p1_expr(t)),
            Box::new(to_p1_expr(e)),
        ),
        Expr::ArrayLit(elems) => P1Expr::ArrayLit(elems.iter().map(to_p1_expr).collect()),
        Expr::Null => P1Expr::Null,
        Expr::TypeOf(inner) => P1Expr::TypeOf(Box::new(to_p1_expr(inner))),
        Expr::FieldAccess(b, f) => P1Expr::FieldAccess(Box::new(to_p1_expr(b)), f.clone()),
        Expr::RecordLit(fields) => P1Expr::RecordLit(
            fields.iter().map(|(n, e)| (n.clone(), to_p1_expr(e))).collect()
        ),
        Expr::Match(scrut, arms) => P1Expr::Match(
            Box::new(to_p1_expr(scrut)),
            arms.iter().map(|a| P1MatchArm {
                variant: a.variant.clone(),
                bindings: a.bindings.clone(),
                body: to_p1_expr(&a.body),
            }).collect(),
        ),
    }
}

fn to_p1_stmt(s: &Stmt) -> P1Stmt {
    match s {
        Stmt::Let(name, ty, e) => P1Stmt::Let(
            name.clone(),
            ty.as_ref().map(to_p1_type_ann),
            to_p1_expr(e),
        ),
        Stmt::Expr(e) => P1Stmt::Expr(to_p1_expr(e)),
        Stmt::Return(e) => P1Stmt::Return(e.as_ref().map(to_p1_expr)),
        Stmt::For { var, range, body } => P1Stmt::For {
            var: var.clone(),
            range: to_p1_expr(range),
            body: body.iter().map(to_p1_stmt).collect(),
        },
        Stmt::Assign(l, r) => P1Stmt::Assign(to_p1_expr(l), to_p1_expr(r)),
    }
}

fn to_p1_program(p: &Program) -> P1Program {
    P1Program {
        type_defs: p.type_defs.iter().map(|d| P1TypeDef {
            name: d.name.clone(),
            body: to_p1_type_ann(&d.body),
        }).collect(),
        functions: p.functions.iter().map(|f| P1FunctionDef {
            name: f.name.clone(),
            type_params: f.type_params.clone(),
            params: f.params.iter().map(|(n, t)| (n.clone(), to_p1_type_ann(t))).collect(),
            return_type: to_p1_type_ann(&f.return_type),
            body: f.body.iter().map(to_p1_stmt).collect(),
        }).collect(),
    }
}
```

**How this achieves the goal:** Every Part 2 AST node is mapped to the corresponding Part 1 node. The type checker only sees Part 1’s types, so all existing logic (environments, overload resolution for `ArrayLen`/`println`/`get`/`append`, record and array-of-record support, unit) works unchanged.

---

## 17.3 Public API: typecheck the Part 2 program

```rust
use lumina_part1_typecheck::{TypeChecker, TypedProgram, TypeError};

pub fn typecheck(source: &str) -> Result<TypedProgram, String> {
    let program = lumina_part2_parser::parse(source).map_err(|e| e.to_string())?;
    let p1 = to_p1_program(&program);
    TypeChecker::new()
        .check_program(&p1)
        .map_err(|e| format!("{:?}", e))
}
```

**Flow:**

1. Parse source with the Part 2 (Pest) parser → `Program`.
2. Convert to Part 1 `Program` with `to_p1_program`.
3. Run Part 1’s `TypeChecker::check_program(&p1)` → `Result<TypedProgram, TypeError>`.
4. Map errors to `String` and return.

The **typed program** is the same as in Part 1: it contains `TypedExpr`, `TypedStmt`, and type information for every node, ready for codegen.

---

## 17.4 What the type checker does (same as Chapter 6)

- **Unbound variables:** Rejected with `TypeError::Unbound(name)`.
- **Type mismatches:** e.g. `"hello" + 42` → `Mismatch(...)`.
- **Overload resolution:** `println(x)` → string or i64 form based on `x`’s type; `ArrayLen(arr)` → `array_i64_len` / `array_str_len` / same for `Array<Record>`; `get`/`append`/`set` resolved by array element type.
- **Records and arrays of records:** Supported; empty array with type annotation `let result: Array<User> = []` typechecks; record parameters and return types are allowed.

No Part 2-specific type rules: we reuse Part 1’s type checker entirely.

---

## 17.5 Tests (same examples as Part 1)

```rust
#[test]
fn typecheck_int() {
    let typed = typecheck("42").unwrap();
    assert!(typed.functions.len() >= 1);
}

#[test]
fn typecheck_add() {
    let typed = typecheck("1 + 2").unwrap();
    assert!(typed.functions.len() >= 1);
}

#[test]
fn typecheck_unbound_fails() {
    let r = typecheck("x + 1");
    assert!(r.is_err());
}
```

Run:

```bash
cd source/part2-pest/03-typecheck
cargo test
```

---

## 17.6 Summary

| Item | Purpose |
|------|--------|
| **Cargo.toml** | Part 2 parser, Part 1 parser, Part 1 typecheck |
| **to_p1_* ** | Convert Part 2 AST → Part 1 AST so the same type checker runs |
| **typecheck(source)** | Parse (Part 2) → convert → Part 1 typecheck → TypedProgram |

Part 2’s type checking is a thin wrapper: convert AST, then reuse Part 1. The same examples (Hello World, FizzBuzz, array of records) typecheck the same way. Next we feed the typed program to codegen.

**Next:** **Chapter 18 — Code generation (Part 2)** (reusing Part 1’s codegen in `04-codegen`).
