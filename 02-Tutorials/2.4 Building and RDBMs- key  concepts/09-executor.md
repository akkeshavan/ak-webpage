# Chapter 9: Query Execution

The parser turns SQL text into an AST. The executor turns that AST into results. This chapter wires together every subsystem built so far — catalog, heap, B-Tree, schema, row — into a query engine that can create tables, insert rows, and run filtered selects.

---

## The problem: bridging intent and storage

An AST node like `Statement::Select { columns: ["name"], table: "users", condition: Some(...) }` says *what* we want. The executor must figure out *how* to get it:

1. Look up `users` in the catalog to find the schema and heap root.
2. Scan the heap for all rows.
3. Evaluate the `WHERE` condition against each row, keeping matches.
4. Project the result to only the requested columns.
5. Format the output.

This deceptively simple plan — scan, filter, project — is the **sequential scan** operator. It is the basis of every query in RustDB and the fallback path in every real database when no index is available.

---

## Theory: the Volcano / iterator execution model

The dominant model for query execution is **Volcano** (also called **iterator** or **pipeline** model), introduced by Graefe in 1994.

Each operator implements a single interface:

```
next() → Row | None
```

Operators are composed into a tree. The root operator drives the query by calling `next()` on its child, which calls `next()` on its child, and so on — all the way down to the leaf scan. Each call to `next()` produces one row. No intermediate result is materialised in memory.

```
ProjectionOp  ← root, called by the executor
    │
FilterOp      ← evaluates WHERE predicate
    │
SeqScanOp     ← fetches rows from the heap
```

Calling `next()` on `ProjectionOp`:
1. ProjectionOp calls `FilterOp.next()`
2. FilterOp calls `SeqScanOp.next()` until it finds a row that passes the predicate
3. SeqScanOp reads the next row from the heap
4. FilterOp checks the predicate; if it passes, returns the row
5. ProjectionOp strips unwanted columns and returns the projected row

RustDB uses a simplified variant: instead of a streaming iterator, the executor materialises all matching rows into a `Vec<Row>` before projecting. This is simpler to implement and sufficient for a tutorial — the streaming approach is essential only when result sets are too large to fit in memory.

### Cost estimation and query planning

In a production database a **query planner** chooses between multiple execution strategies — sequential scan vs. index scan, nested loop join vs. hash join — by estimating the cost of each. Cost is typically measured in page I/Os.

RustDB skips the planner: it always uses a sequential scan. Adding an index lookup would be straightforward (the B-Tree is already built), but choosing *when* to use it requires cost estimation, which is a topic for a follow-on tutorial.

---

## Code walkthrough

### `ResultSet`

```rust
// source/src/executor.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-09

pub enum ResultSet {
    Rows { columns: Vec<String>, rows: Vec<Row> },
    Ok(String),
    Error(String),
}
```

`ResultSet::display()` formats the output as a simple table:

```
id | name
----------
1  | 'alice'
2  | 'bob'
(2 rows)
```

### `Executor`

```rust
pub struct Executor {
    pub catalog: Catalog,
    pub bp: BufferPool,
}
```

The executor owns both the catalog and the buffer pool. All statement handling goes through `execute(&mut self, stmt: Statement) -> ResultSet`.

### CREATE TABLE

```rust
fn exec_create_table(&mut self, table: String, col_defs: Vec<ColumnDef>) -> ResultSet {
    let schema = Schema::new(col_defs.iter().map(|c| {
        let mut col = Column::new(c.name.clone(), c.data_type.clone());
        if !c.nullable { col = col.not_null(); }
        col
    }).collect());

    let heap = match TableHeap::create(&mut self.bp) {
        Ok(h) => h,
        Err(e) => return ResultSet::Error(e.to_string()),
    };

    let meta = TableMeta::new(table.clone(), schema, heap.first_page_id);
    match self.catalog.create_table(meta) {
        Ok(_)  => ResultSet::Ok(format!("table '{}' created", table)),
        Err(e) => ResultSet::Error(e),
    }
}
```

This is the canonical three-step pattern for DDL: validate, allocate storage, register in catalog.

### INSERT

```rust
fn exec_insert(&mut self, table: String, values: Vec<Value>) -> ResultSet {
    let (schema, heap_root) = match self.catalog.get(&table) {
        Some(m) => (m.schema.clone(), m.heap_root),
        None    => return ResultSet::Error(format!("table '{}' not found", table)),
    };

    if let Err(e) = schema.validate(&values) {
        return ResultSet::Error(e);
    }

    let row = Row::new(values.clone());
    let heap = TableHeap::open(heap_root);
    let row_id = match heap.insert(&row, &mut self.bp) {
        Ok(rid) => rid,
        Err(e)  => return ResultSet::Error(e.to_string()),
    };

    // Maintain B-Tree index if one exists.
    if let Some(meta) = self.catalog.get_mut(&table) {
        if let Some(btree) = &mut meta.index {
            if let Some(Value::Int(key)) = values.first() {
                btree.insert(*key, row_id);
            }
        }
    }

    ResultSet::Ok("1 row inserted".into())
}
```

Two noteworthy details:

1. The schema is cloned before calling `catalog.get_mut` to avoid a double borrow of `self.catalog` (Rust's borrow checker prevents holding a shared reference and a mutable reference at the same time).
2. The B-Tree index, if present, is updated in the same call. This maintains the index eagerly — every insert keeps it current. A real database would also update indexes on update/delete.

### SELECT

```rust
fn exec_select(&mut self, proj_cols: Vec<String>, table: String,
               condition: Option<Condition>) -> ResultSet {
    let (schema, heap_root) = match self.catalog.get(&table) {
        Some(m) => (m.schema.clone(), m.heap_root),
        None    => return ResultSet::Error(format!("table '{}' not found", table)),
    };

    // 1. Scan.
    let heap = TableHeap::open(heap_root);
    let all_rows = match heap.scan(&schema, &mut self.bp) {
        Ok(r)  => r,
        Err(e) => return ResultSet::Error(e.to_string()),
    };

    // 2. Filter.
    let filtered: Vec<Row> = all_rows.into_iter()
        .filter(|row| condition.as_ref()
            .map(|c| eval_condition(c, row, &schema))
            .unwrap_or(true))
        .collect();

    // 3. Project.
    if proj_cols.is_empty() {
        // SELECT *
        let names = schema.columns.iter().map(|c| c.name.clone()).collect();
        return ResultSet::Rows { columns: names, rows: filtered };
    }

    let indices: Result<Vec<usize>, String> = proj_cols.iter()
        .map(|name| schema.column_index(name)
            .ok_or_else(|| format!("column '{}' not found", name)))
        .collect();

    let indices = match indices {
        Ok(i)  => i,
        Err(e) => return ResultSet::Error(e),
    };

    let out: Vec<Row> = filtered.into_iter()
        .map(|row| Row::new(indices.iter().map(|&i| row.values[i].clone()).collect()))
        .collect();

    ResultSet::Rows { columns: proj_cols, rows: out }
}
```

The three-step pipeline (scan → filter → project) maps directly to the Volcano operator tree described above.

### Condition evaluation

```rust
fn eval_condition(cond: &Condition, row: &Row, schema: &Schema) -> bool {
    match cond {
        Condition::Comparison { column, op, value } => {
            // column_index returns Option; an unknown column evaluates to false.
            let idx = match schema.column_index(column) {
                Some(i) => i,
                None => return false,
            };
            let cell = &row.values[idx];
            compare(cell, op, value)
        }
        Condition::And(l, r) =>
            eval_condition(l, row, schema) && eval_condition(r, row, schema),
        Condition::Or(l, r) =>
            eval_condition(l, row, schema) || eval_condition(r, row, schema),
        Condition::Not(inner) =>
            !eval_condition(inner, row, schema),
    }
}

fn compare(cell: &Value, op: &CompOp, rhs: &Value) -> bool {
    let ord = match (cell, rhs) {
        (Value::Int(a),  Value::Int(b))  => a.partial_cmp(b),
        (Value::Float(a),Value::Float(b))=> a.partial_cmp(b),
        (Value::Text(a), Value::Text(b)) => a.partial_cmp(b),
        (Value::Bool(a), Value::Bool(b)) => a.partial_cmp(b),
        _ => return false, // type mismatch or NULL
    };
    match ord {
        Some(Ordering::Less)    => matches!(op, CompOp::Lt | CompOp::Le | CompOp::Ne),
        Some(Ordering::Equal)   => matches!(op, CompOp::Eq | CompOp::Le | CompOp::Ge),
        Some(Ordering::Greater) => matches!(op, CompOp::Gt | CompOp::Ge | CompOp::Ne),
        None => false, // NaN comparison
    }
}
```

`compare` handles mismatched types and NULLs by returning `false` — which is consistent with SQL's three-valued logic (NULL compared to anything is UNKNOWN, which is falsy in a WHERE clause).

---

## Try it yourself

This end-to-end test exercises the full stack from SQL string to result set:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::sql::Parser;

    fn run(exec: &mut Executor, sql: &str) -> ResultSet {
        let stmt = Parser::new(sql).unwrap().parse().unwrap();
        exec.execute(stmt)
    }

    #[test]
    fn create_insert_select() {
        let _ = std::fs::remove_file("/tmp/exec_test.db");
        let mut exec = Executor::new("/tmp/exec_test.db").unwrap();

        run(&mut exec, "CREATE TABLE items (id INT, label TEXT)");
        run(&mut exec, "INSERT INTO items VALUES (1, 'apple')");
        run(&mut exec, "INSERT INTO items VALUES (2, 'banana')");
        run(&mut exec, "INSERT INTO items VALUES (3, 'cherry')");

        let rs = run(&mut exec, "SELECT * FROM items WHERE id > 1");
        match rs {
            ResultSet::Rows { rows, .. } => assert_eq!(rows.len(), 2),
            _ => panic!("expected rows"),
        }

        std::fs::remove_file("/tmp/exec_test.db").unwrap();
    }
}
```

The next three tests probe the executor's error handling and compound-condition logic:

```rust
#[test]
fn test_table_not_found() {
    let _ = std::fs::remove_file("/tmp/rustdb_ch09_notfound.db");
    let mut exec = Executor::new("/tmp/rustdb_ch09_notfound.db").unwrap();
    let stmt = Parser::new("SELECT * FROM nonexistent").unwrap().parse().unwrap();
    match exec.execute(stmt) {
        ResultSet::Error(msg) => assert!(msg.contains("not found")),
        other => panic!("expected Error, got {:?}", other),
    }
    std::fs::remove_file("/tmp/rustdb_ch09_notfound.db").unwrap();
}

#[test]
fn test_column_not_found_in_select() {
    let _ = std::fs::remove_file("/tmp/rustdb_ch09_col.db");
    let mut exec = Executor::new("/tmp/rustdb_ch09_col.db").unwrap();
    let run = |exec: &mut Executor, sql: &str| {
        let stmt = Parser::new(sql).unwrap().parse().unwrap();
        exec.execute(stmt)
    };
    run(&mut exec, "CREATE TABLE t (id INT)");
    run(&mut exec, "INSERT INTO t VALUES (1)");
    match run(&mut exec, "SELECT nonexistent FROM t") {
        ResultSet::Error(msg) => assert!(msg.contains("not found")),
        other => panic!("expected Error, got {:?}", other),
    }
    std::fs::remove_file("/tmp/rustdb_ch09_col.db").unwrap();
}

#[test]
fn test_where_with_and_or() {
    let _ = std::fs::remove_file("/tmp/rustdb_ch09_where.db");
    let mut exec = Executor::new("/tmp/rustdb_ch09_where.db").unwrap();
    let run = |exec: &mut Executor, sql: &str| {
        let stmt = Parser::new(sql).unwrap().parse().unwrap();
        exec.execute(stmt)
    };
    run(&mut exec, "CREATE TABLE t (id INT, val INT)");
    for i in 1i64..=5 {
        run(&mut exec, &format!("INSERT INTO t VALUES ({}, {})", i, i * 10));
    }
    // id > 2 AND val < 50 matches rows (3, 30) and (4, 40)
    match run(&mut exec, "SELECT * FROM t WHERE id > 2 AND val < 50") {
        ResultSet::Rows { rows, .. } => assert_eq!(rows.len(), 2),
        other => panic!("unexpected: {:?}", other),
    }
    std::fs::remove_file("/tmp/rustdb_ch09_where.db").unwrap();
}
```

`test_table_not_found` and `test_column_not_found_in_select` verify that the executor returns `ResultSet::Error` (not a panic) when the catalog lookup fails. `test_where_with_and_or` exercises the recursive `eval_condition` path: rows (3, 30) and (4, 40) satisfy both predicates; rows 1, 2, and 5 are filtered out.

---

## Key takeaways

- The executor owns both the catalog and the buffer pool — it is the central coordinator of the query engine.
- Scan → filter → project is the fundamental building block. Every other operator (join, sort, aggregate) is layered on top.
- The borrow checker shapes the API: we clone schema data from the catalog before accessing storage, to avoid holding two borrows into the same struct simultaneously.
- Condition evaluation recurses over the AST's `Condition` tree, short-circuiting on AND/OR as expected.

---

**← Previous:** [Chapter 8 — Parsing SQL](08-sql-parser.md) | **Next:** [Chapter 10 — Transactions and the Write-Ahead Log](10-wal.md)
