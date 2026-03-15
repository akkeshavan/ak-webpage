# Chapter 9: Interpreted Mode and Seamless Execution

**Previous:** [Chapter 8 — Runtime and Stdlib](08-runtime-stdlib.md)

This chapter ties together the **generated parser**, the **interpreter**, and the **runtime** so that when the user generates the parser in a target language (e.g. Rust), they can run source code **seamlessly in interpreted mode** using the runtime in that same language.

## 9.1 What “Interpreted Mode” Means

- **Input:** Source code in the language defined by the grammar (expression language or full language).
- **Pipeline:** Source → **generated lexer** → token stream → **generated parser** → AST → **interpreter** (with **runtime**) → execution.
- **All in one process:** If the user chose “generate in Rust,” then the lexer, parser, interpreter, and runtime are all in Rust. The user compiles one binary (or runs one script) that: reads source, parses it, and executes it.

So there is **no separate “compiler” step** for interpreted mode; it’s parse → interpret.

In the reference CLI, **interpreted mode** is exposed via **`parser_gen run`**, which uses the **FullLang** (hand-written) parser. For a **grammar-generated** parser (e.g. from Expr.grammar), you run **gen**, integrate the generated modules into your crate, then run your own entry point that does lex → parse → eval.

## 9.2 Components in the Same Target

- **Generated lexer** (Chapter 3): tokenizes the source.
- **Generated parser** (Chapter 4): produces an AST.
- **Interpreter** (Chapter 6): walks the AST; evaluates expressions and executes statements; looks up and calls functions.
- **Runtime** (Chapter 8): holds global environment, stdlib (`print`, `write`, `readfile`), and user-registered native functions.

The interpreter and runtime are **not** generated per grammar; they are **one implementation per target language** that work with **any** AST that conforms to our AST schema (expression or full language). The **generated** part is only the lexer and parser (and possibly AST node construction if that’s generated). So:

- **Rust target:** One Rust interpreter + one Rust runtime; generated Rust lexer + parser feed AST into that interpreter.
- **JS target:** One JS interpreter + one JS runtime; generated JS lexer + parser feed AST into that interpreter.

## 9.3 Entry Point and API

Expose a simple API so the user can “run” a source string or file:

- **Rust:** e.g. `run_source(source: &str) -> Result<Value, RunError>` or `run_file(path: &str) -> Result<(), RunError>`. Inside: lex → parse → interpret with default runtime (with stdlib and any user-registered fns).
- **JS:** e.g. `runSource(source)` or `runFile(path)`.

Optional: allow passing a **preconfigured runtime** (with extra registered functions) so that the same binary can run scripts with custom built-ins.

## 9.4 CLI: Grammar → Lexer/Parser, Run, and Compile

The reference crate provides a **CLI** (`cargo run --` with the binary `parser_gen`) that ties together the grammar file, generated lexer/parser, interpreter, and LLVM codegen.

### 9.4.1 Commands

| Command | Purpose |
|--------|--------|
| **`parser_gen gen <grammar_file> -o <output_dir>`** | Load the grammar file (e.g. `.grammar` with actions; see §2.9 and Chapter 4), run the lexer and parser generators, and write **`lexer.rs`** and **`parser.rs`** into the given directory. The generated parser uses the semantic actions to build the AST. |
| **`parser_gen run <script_file>`** | Read the script as **FullLang** source, parse it with the hand-written FullLang parser, then **interpret** it with `run_program` and the default runtime (stdlib). |
| **`parser_gen compile <script_file> -o <out.ll>`** | Parse the script as FullLang, take the first expression statement, convert it to the expression AST, and emit **LLVM IR** to the given file (or default `script.ll`). Full program → LLVM would require extending the codegen (Chapter 10). |

### 9.4.2 Pipeline with a grammar file

1. **Write a grammar file** (e.g. `Expr.grammar`) with lexer rules and parser rules with **actions** (Chapter 2, §2.9; Chapter 4, §4.9.5). Use **right-recursive** rules to avoid left recursion; see Chapter 4, **§4.11 Left recursion** for why and how.
2. **Generate:**  
   `parser_gen gen Expr.grammar -o src/generated/`  
   This produces `lexer.rs` and `parser.rs` that expect to live in a crate with `super::lexer` and `super::ast` (or adjust paths). Place them in your project and add a module that uses them.
3. **Use the generated parser:** In your binary or library, run the lexer on the source string, collect tokens, then call the generated parser's start rule (e.g. `parse_start()`). The result is an AST (e.g. `Expr`). Pass that AST to the **interpreter** (same crate's `interpreter::eval` for a single expression, or a small runner that builds an env and runtime).
4. **Run FullLang scripts:** For the **full language**, use **`parser_gen run script.lang`**; it uses the built-in FullLang parser and interpreter (no grammar file needed for that path).

So: **grammar file with actions** → **gen** → **lexer + parser** → integrate into your crate → **interpret** (or, for one expression, **compile** via the `compile` command).

### 9.4.3 Two pipelines: what the CLI does

It is important not to confuse the two ways to get from source to execution:

| Pipeline | What it is | CLI | End-to-end in this crate? |
|----------|------------|-----|----------------------------|
| **Grammar → Parser → Interpreter** | Grammar file → **gen** → generated lexer + parser → (you integrate) → source → lex → parse → **Expr** → `interpreter::eval(Expr)` | **gen** only. The CLI does **not** run the generated parser. | No. You must add the generated modules to your crate and call the lexer, then the parser, then `eval`. |
| **Grammar → Parser → LLVM** | Same, but after parse you pass **Expr** to `llvm_codegen::compile_expr_to_ir(Expr)`. | **gen** only. | No. Same integration step; then use `compile_expr_to_ir`. |
| **FullLang → Interpreter** | Source → **hand-written** FullLang parser → **Program** → `run_program`. | **run** | Yes. |
| **FullLang → LLVM** | Source → FullLang parser → Program → first expr → **Expr** → `compile_expr_to_ir`. | **compile** | Yes (expression part only). |

So **`run`** and **`compile`** use the **FullLang** parser (no grammar file). The **grammar-based** pipelines (grammar file → interpreter, grammar file → LLVM) are **correct and working** at the level of code generation: **gen** produces a parser that builds `Expr`; that `Expr` is exactly what `eval` and `compile_expr_to_ir` accept. The missing piece is a CLI that runs your source through the **generated** lexer and parser; that step is done by you after you integrate the generated files. See [Implementation status](../docs/IMPLEMENTATION_STATUS.md) and [Critical review](../docs/CRITICAL_REVIEW.md).

## 9.5 Seamless Experience

- **Single command:** e.g. `my_lang script.lang` or `node my_parser.js script.lang` runs the script.
- **No codegen step:** User doesn’t run “generate parser from grammar” at runtime; they use the **already-generated** parser (and lexer) that was built for the chosen grammar (Expr or FullLang) and target (Rust/JS). So the “seamless” part is: one tool, one language, parse + interpret in one go.

If you want to support “load grammar at runtime and then interpret,” that would require embedding the **parser generator** itself and generating code on the fly (or interpreting the grammar); that’s an advanced option. The standard flow is: generate parser once for a grammar, then use that parser + interpreter + runtime to run programs.

## 9.6 Error Reporting

- **Parse errors:** From the generated parser (line, column, expected/found).
- **Runtime errors:** From the interpreter (undefined variable, type error, file error from stdlib). Propagate and print with context so the user sees where in the source the error occurred.

## 9.7 Output of This Chapter

- A clear **runner** that: takes source (or file path) → lex → parse → interpret with runtime.
- **Documentation** for how to build and run the generated parser in interpreted mode (Rust and/or JS).
- The runtime remains **extensible** so that the user can add more native functions and run scripts that use them.

**FullLang:** The reference crate runs full scripts via **`full_lang::parse_program(source)`** and **`interpreter::run_program(&program, &mut env, &runtime)`**. See the integration test **`test_fulllang_parse_and_run`** in `tests/integration_test.rs` and the FullLang walkthrough in Chapter 7.

---

## 9.8 Source Code: Runner

The **runner** is the entry point that ties lexer → parser → interpreter → runtime. It can live in a binary crate or in the same repo.

### 9.8.1 Single entry point (conceptual)

```rust
// Run source string; return last expression value or error.
pub fn run_source(source: &str, runtime: &mut Runtime) -> Result<Value, Box<dyn std::error::Error>> {
    let tokens = tokenize(source);           // use generated lexer
    let ast = parse(tokens)?;                // use generated parser
    let env = &mut runtime.global_env;
    for item in ast.items {
        match item {
            ProgramItem::Decl(d) => { /* define in env */ }
            ProgramItem::Stmt(s) => {
                if let Err(RuntimeError::Return(v)) = exec(&s, env) {
                    return Ok(v);            // top-level return
                }
                exec(&s, env)?;
            }
        }
    }
    Ok(Value::Nil)
}

// Run file
pub fn run_file(path: &str, runtime: &mut Runtime) -> Result<Value, Box<dyn std::error::Error>> {
    let source = fs::read_to_string(path)?;
    run_source(&source, runtime)
}
```

### 9.8.2 Call resolution in the interpreter

When the interpreter evaluates a **call** (e.g. `print(1, 2)`):

```rust
// In eval, for Call(name, args):
let args: Vec<Value> = args.iter().map(|a| eval(a, env)).collect::<Result<_, _>>()?;
if let Some(native) = runtime.get_native(&name) {
    return native(args);
}
// else: interpreted function from env
let Value::Fn { params, body } = env.get(&name)?;
// push scope, bind params to args, run body, pop; catch Return(v)
```

So the **same** interpreter and runtime run in one process: no separate VM; the generated parser and the runtime are both Rust (or both JS).

---

## 9.9 Code Walkthrough: Interpreted Mode Pipeline

### End-to-end flow

1. **Input:** Source code string (or path to a file).
2. **Lex:** Use the **generated** lexer for the chosen grammar (Expr or FullLang) to get a token list.
3. **Parse:** Use the **generated** parser on the token list to get an AST (`Expr`, or `Program` for the full language).
4. **Run:** Create or reuse a **Runtime** (with stdlib and any user-registered fns). For a **Program**, iterate over items: process declarations (store in global env), then execute statements; on **Return**, use that value as the result. For a single **Expr**, just call **eval** with the global env.
5. **Calls:** When the interpreter hits a call, it checks **runtime.get_native(name)** first; if present, call the native function with evaluated args; otherwise resolve as an interpreted function from the environment.

### Seamless experience

- The **user** compiles one binary (or runs one script) that includes the generated lexer, generated parser, interpreter, and runtime. No separate “compile the script” step: **parse then interpret** in the same process.
- If the user registered extra native functions (e.g. `runtime.register_fn("my_io", ...)`), those are available to the script automatically because the runner passes the same **Runtime** to the interpreter.

---

**Next:** [Chapter 10 — Integrating with LLVM](10-llvm-integration.md)
