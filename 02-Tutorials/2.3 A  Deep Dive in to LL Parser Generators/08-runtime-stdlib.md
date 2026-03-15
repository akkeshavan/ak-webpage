# Chapter 8: Runtime and Stdlib

**Previous:** [Chapter 7 — Full Language](07-full-language.md)

This chapter implements an **extensible runtime** in the target language (e.g. Rust) that provides **stdlib functions** and allows the user to **register additional functions**. The same runtime is used when the generated parser runs in **interpreted mode** (Chapter 9).

## 8.1 Role of the Runtime

When the user chooses to **generate the parser in Rust**, the runtime is also in Rust. When the interpreter executes a program (AST), it:

- Evaluates expressions and executes statements using the **environment** and **call stack**.
- Resolves **function calls** by name: built-in stdlib functions (e.g. `print`, `write`, `readfile`) or user-defined functions (from the AST).
- The **runtime** holds the **global environment**, the **registry of built-in functions**, and (optionally) **user-registered functions**.

So: **interpreter + runtime** together give “run this AST in the host language.”

## 8.2 Initial Stdlib Functions

We provide at least:

- **print(...)** — output one or more values to stdout (e.g. `print(1, "hello", x)`). Exact signature can be `print(args: Vec<Value>) -> Value` returning a unit/nil value.
- **write(path, content)** — write a string to a file. Arguments: path (string), content (string). Return success/failure or unit.
- **readfile(path)** — read a file and return its contents as a string. Argument: path (string).

These are **native** functions implemented in the target language (Rust/JS), not in the interpreted language. The interpreter, when it sees a call to `print`, looks up `print` in the runtime’s function table and calls the native implementation with the evaluated arguments.

## 8.3 Extensibility: User-Added Functions

The runtime should be **extensible**: the user can register **additional native functions** that become callable from interpreted code.

- **API:** e.g. `runtime.register_fn("my_func", |args| { ... })` (Rust) or `runtime.register('my_func', (args) => { ... })` (JS).
- **Signature:** native function receives a list of **values** (our `Value` type: Int, Bool, Str, etc.) and returns a `Value`. The interpreter passes the evaluated arguments and converts the return value back into the runtime representation.
- **Use case:** custom I/O, system calls, FFI, or helpers that would be slow or impossible to implement in the interpreted language.

So the runtime has:

1. **Built-in stdlib:** `print`, `write`, `readfile` (and any others you add).
2. **User-registered functions:** name → native implementation.
3. **Interpreted functions:** those defined in the source (e.g. `fn foo() { ... }`) and stored in the environment; the interpreter executes their body when they’re called.

The interpreter’s **call** logic: if the name is in the runtime’s native table, call the native function; otherwise treat it as an interpreted function and execute its body.

## 8.4 Implementation Sketch (Rust)

- **Value enum:** `Int(i64)`, `Bool(bool)`, `Str(String)`, `Fn(...)`, `Nil` (and maybe more).
- **Runtime struct:**  
  - `global_env: HashMap<String, Value>`  
  - `native_fns: HashMap<String, Box<dyn Fn(Vec<Value>) -> Result<Value, RuntimeError>>>`  
  - Method `register_fn(name, f)` to add a native function.
- **Bootstrap:** In `new()` or `default()`, register `print`, `write`, `readfile` in `native_fns`.
- **Interpreter** holds a reference to `Runtime`; on `Call(name, args)` it checks `native_fns` first, then the environment (interpreted function).

Same idea in JavaScript: object or Map for native functions, and a way to register new ones.

## 8.5 Error Handling in Stdlib

- **print:** Usually cannot fail; just format values and write to stdout.
- **write:** Can fail (permission, path not found). Return an error value or raise in the runtime; the interpreter can expose that to the script (e.g. optional “try/catch” or error value).
- **readfile:** Can fail (file not found, permission). Same as above.

Define a convention (e.g. `Result<Value, RuntimeError>`) so that both native and interpreted code can report errors.

## 8.6 Output of This Chapter

- **Runtime** type in the target language with global environment and native function table.
- **Stdlib:** `print`, `write`, `readfile` implemented and registered.
- **Extensibility:** API to register custom native functions so that the user can add more built-ins without changing the interpreter core.

This sets up **interpreted mode** (Chapter 9): the generated parser produces an AST that the interpreter runs using this runtime, in the same process and language as the parser.

---

## 8.7 Source Code

The runtime is in `source/code/src/runtime.rs`: **Runtime** struct, stdlib registration, and **register_fn** for user-defined native functions.

### 8.7.1 Runtime struct and native table

```rust
// source/code/src/runtime.rs (excerpt)
pub type NativeFn = Box<dyn Fn(Vec<Value>) -> Result<Value, RuntimeError> + Send>;

pub struct Runtime {
    pub global_env: HashMap<String, Value>,
    pub native_fns: HashMap<String, NativeFn>,
}
```

### 8.7.2 Bootstrap: stdlib in `new()`

```rust
impl Runtime {
    pub fn new() -> Self {
        let mut native_fns = HashMap::new();

        native_fns.insert("print".into(), Box::new(|args| {
            for (i, v) in args.iter().enumerate() {
                if i > 0 { print!(" "); }
                match v {
                    Value::Int(n) => print!("{}", n),
                    Value::Bool(b) => print!("{}", b),
                    Value::Str(s) => print!("{}", s),
                    Value::Nil => print!("nil"),
                }
            }
            println!();
            Ok(Value::Nil)
        }));

        native_fns.insert("write".into(), Box::new(|args| {
            let path = match &args[0] { Value::Str(s) => s.clone(), _ => return Err(RuntimeError::Type("path must be string".into())) };
            let content = match &args[1] { Value::Str(s) => s.clone(), _ => return Err(RuntimeError::Type("content must be string".into())) };
            fs::write(&path, content).map_err(|e| RuntimeError::Type(e.to_string()))?;
            Ok(Value::Nil)
        }));

        native_fns.insert("readfile".into(), Box::new(|args| {
            let path = match &args[0] { Value::Str(s) => s.clone(), _ => return Err(RuntimeError::Type("path must be string".into())) };
            let s = fs::read_to_string(path).map_err(|e| RuntimeError::Type(e.to_string()))?;
            Ok(Value::Str(s))
        }));

        Self { global_env: HashMap::new(), native_fns }
    }

    pub fn register_fn<F>(&mut self, name: &str, f: F)
    where F: Fn(Vec<Value>) -> Result<Value, RuntimeError> + Send + 'static,
    {
        self.native_fns.insert(name.to_string(), Box::new(f));
    }

    pub fn get_native(&self, name: &str) -> Option<&NativeFn> {
        self.native_fns.get(name)
    }
}
```

### 8.7.3 Interpreter call resolution (conceptual)

When the interpreter sees a call `f(args)`:

1. Evaluate each argument to a `Value`.
2. If `runtime.get_native("f")` is `Some(native)` → call `native(args)` and return the result.
3. Else look up `"f"` in the current env; if it’s `Value::Fn { params, body }`, push a new scope, bind params to args, run body, pop scope and return (catching `RuntimeError::Return(v)`).

---

## 8.8 Code Walkthrough: Key Algorithms

### Algorithm 1: Resolving a call

**Goal:** Decide whether a call is to a **native** function or an **interpreted** function.

1. **Look up name** in the runtime’s `native_fns` map.
2. If found, it’s a **native** call: evaluate all arguments, then invoke the stored closure with `Vec<Value>`, and return its `Result<Value, RuntimeError>`.
3. If not found, look up the name in the **environment**. If the value is a function (e.g. `Value::Fn`), it’s an **interpreted** call: evaluate args, push frame, bind params, execute body, pop frame, and return the return value (via the `Return` sentinel in the interpreter).

So the **runtime** is the single place that holds native functions; the interpreter only needs to call `runtime.get_native(name)` before treating the call as interpreted.

### Algorithm 2: Stdlib implementation

- **print:** Iterate over `args`, format each `Value` (Int, Bool, Str, Nil) and print to stdout; return `Nil`. No I/O error in practice for stdout.
- **write(path, content):** Check two string args; call `fs::write(path, content)`; on success return `Nil`, on error convert to `RuntimeError::Type(msg)` so the interpreter can report it.
- **readfile(path):** Check one string arg; call `fs::read_to_string(path)`; return `Value::Str(s)` or error.

All three are registered in `Runtime::new()` so every runtime instance has them.

### Algorithm 3: Extensibility

**register_fn(name, f)** inserts `(name, f)` into `native_fns`. The closure must have signature `(Vec<Value>) -> Result<Value, RuntimeError>` so the interpreter can call it uniformly. The user can add custom I/O, system calls, or helpers without changing the interpreter or the grammar.

---

**Next:** [Chapter 9 — Interpreted Mode and Seamless Execution](09-interpreted-mode.md)
