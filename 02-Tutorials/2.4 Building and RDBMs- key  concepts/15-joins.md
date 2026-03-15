# Chapter 15: Multi-table JOINs

Every interesting query in a real application touches more than one table. A user record lives in `users`; their orders live in `orders`; order line items live in `line_items`. Combining these into a single result requires a JOIN. This chapter adds INNER JOIN to RustDB, extending the parser, AST, and executor.

---

## Theory: why JOINs are fundamentally different

A single-table SELECT has a straightforward execution model: scan, filter, project. A JOIN is different in kind, not just in complexity.

### The relational algebra view

In relational algebra, a JOIN is a **filtered Cartesian product**:

```
users JOIN orders ON users.id = orders.user_id
  ≡  σ(users.id = orders.user_id) (users × orders)
```

The Cartesian product `users × orders` produces every combination of a row from `users` with a row from `orders` — `|users| × |orders|` pairs. The selection `σ` keeps only pairs where the join condition holds.

The combined row has all columns from both tables: `(users.id, users.name, orders.user_id, orders.amount)`. This is the "wide row" produced by the join.

### Nested loop join

The simplest algorithm implements the Cartesian product directly:

```
for each row L in the left (outer) table:
    for each row R in the right (inner) table:
        if join_condition(L, R):
            emit (L, R)
```

Cost: `O(|outer| × |inner|)` row comparisons. For small tables this is fine. For large tables it is catastrophic — two tables of one million rows each produce one trillion comparisons.

Real databases use optimised algorithms when at least one table is large:

**Hash join** (`O(n + m)`): build a hash table on the smaller ("build") relation keyed on the join column; then probe the hash table for each row in the larger ("probe") relation. Fast but requires memory proportional to the build relation.

**Sort-merge join** (`O(n log n + m log m)`): sort both relations on the join column; then merge them in a single linear pass. Useful when the data is already sorted or when sorted output is needed.

RustDB implements only the nested loop join because it requires no additional data structures beyond what is already built. Adding hash join would be a good follow-on exercise.

### Equi-join only

RustDB supports only equi-joins (`ON left_col = right_col`). Theta-joins (arbitrary predicates like `ON a.price > b.min_price`) are left as an exercise. The column reference syntax supports `table.col` notation to disambiguate columns with the same name in different tables.

---

## Code walkthrough

> **Files modified in this chapter:** `sql/lexer.rs`, `sql/ast.rs`, `sql/parser.rs`, `executor.rs`

### `sql/ast.rs`: `JoinClause` and updated `Select`

```rust
// source/src/sql/ast.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-15

pub struct JoinClause {
    pub table: String,
    pub left_col: String,   // e.g. "users.id"
    pub right_col: String,  // e.g. "orders.user_id"
}
```

`Statement::Select` gains a `joins` field:

```rust
Select {
    columns: Vec<String>,
    table: String,
    joins: Vec<JoinClause>,   // new — empty for single-table queries
    condition: Option<Condition>,
},
```

Existing `SELECT` statements that have no JOIN clause produce `joins: vec![]` and behave exactly as before.

### `sql/parser.rs`: parsing JOIN clauses

`parse_select()` now checks for one or more `[INNER] JOIN table ON left = right` clauses between the table name and the optional `WHERE`:

```rust
fn parse_select(&mut self) -> Result<Statement, String> {
    let columns = self.parse_projections()?;
    self.expect(&Token::From)?;
    let table = self.expect_ident()?;

    let mut joins = Vec::new();
    loop {
        let is_inner = if self.peek() == &Token::Inner {
            self.advance();
            true
        } else { false };

        if self.peek() == &Token::Join || is_inner {
            if !is_inner { self.advance(); } else { self.expect(&Token::Join)?; }
            let join_table = self.expect_ident()?;
            self.expect(&Token::On)?;
            let left_col = self.expect_ident()?;
            self.expect(&Token::Eq)?;
            let right_col = self.expect_ident()?;
            joins.push(JoinClause { table: join_table, left_col, right_col });
        } else { break; }
    }

    let condition = if self.peek() == &Token::Where { ... } else { None };
    Ok(Statement::Select { columns, table, joins, condition })
}
```

The loop allows multiple consecutive JOIN clauses. Each JOIN reads a table name, `ON`, a left column reference, `=`, and a right column reference.

`Token::Inner` and `Token::Join` are both defined in `sql/lexer.rs` — they were added as part of this chapter's source changes. `Token::On` was already present from the `CREATE INDEX ON` syntax.

### `executor.rs`: `exec_select_join()`

The executor dispatches to `exec_select_simple` (no joins) or `exec_select_join` depending on whether `joins` is empty:

```rust
fn exec_select_join(
    &mut self,
    proj_cols: Vec<String>,
    left_table: String,
    joins: Vec<JoinClause>,
    condition: Option<Condition>,
) -> ResultSet {
    // 1. Scan the left table.
    let (left_schema, left_heap_root) = ...;
    let left_rows = TableHeap::open(left_heap_root).scan(&left_schema, &mut self.bp)?;

    let mut combined_rows = left_rows;
    let mut combined_schema = left_schema;

    // 2. For each join, scan the right table and perform nested loop join.
    for join in &joins {
        let (right_schema, right_heap_root) = ...;
        let right_rows = TableHeap::open(right_heap_root).scan(&right_schema, &mut self.bp)?;

        // Build the combined schema.
        let mut new_cols = combined_schema.columns.clone();
        new_cols.extend(right_schema.columns.clone());
        let new_schema = Schema::new(new_cols);

        // Nested loop join.
        let mut joined = Vec::new();
        for lrow in &combined_rows {
            for rrow in &right_rows {
                let lv = resolve_col(&join.left_col,  lrow, &combined_schema);
                let rv = resolve_col(&join.right_col, rrow, &right_schema);
                if let (Some(lv), Some(rv)) = (lv, rv) {
                    if lv == rv {
                        let mut vals = lrow.values.clone();
                        vals.extend(rrow.values.clone());
                        joined.push(Row::new(vals));
                    }
                }
            }
        }

        combined_rows = joined;
        combined_schema = new_schema;
    }

    // 3. Apply WHERE on the combined schema.
    let filtered: Vec<Row> = combined_rows.into_iter()
        .filter(|row| condition.as_ref()
            .map(|c| eval_condition_joined(c, row, &combined_schema, ...))
            .unwrap_or(true))
        .collect();

    // 4. Project.
    project_joined(proj_cols, combined_schema, filtered)
}
```

Multiple joins are handled iteratively: each iteration produces a wider `combined_rows` and `combined_schema`, which become the "left" input for the next join.

> **Performance note:** The nested loop costs O(|left| × |right|) per join. For two tables of 1,000 rows each, that is one million comparisons. For 100,000 rows each, 10 billion. This implementation is suitable only for small tables. Hash join (O(n + m)) or a B-Tree index probe would be needed for larger datasets.

### Column name resolution

Column references in `JOIN ... ON` and in `SELECT` projections can be either plain names (`id`) or dotted names (`users.id`). The helper `resolve_col` handles both:

```rust
fn resolve_col<'a>(col_ref: &str, row: &'a Row, schema: &Schema) -> Option<&'a Value> {
    // Try exact match first.
    if let Some(idx) = schema.column_index(col_ref) {
        return row.values.get(idx);
    }
    // Strip "table." prefix and try again.
    let bare = col_ref.split('.').last().unwrap_or(col_ref);
    let idx = schema.column_index(bare)?;
    row.values.get(idx)
}
```

`Schema::column_index` does case-insensitive matching. If the column name exists verbatim (e.g., the combined schema has a column literally named "users.id"), it is used directly. Otherwise the prefix is stripped and the bare name is tried.

### `project_joined()` for dotted projection columns

When the user writes `SELECT users.name, orders.amount FROM ...`, the column references contain dots. The projection step must handle these:

```rust
fn project_joined(proj_cols: Vec<String>, schema: Schema, rows: Vec<Row>) -> ResultSet {
    if proj_cols.is_empty() {
        let names = schema.columns.iter().map(|c| c.name.clone()).collect();
        return ResultSet::Rows { columns: names, rows };
    }
    let indices: Result<Vec<usize>, String> = proj_cols.iter()
        .map(|col_ref| {
            schema.column_index(col_ref).or_else(|| {
                let bare = col_ref.split('.').last().unwrap_or(col_ref);
                schema.column_index(bare)
            }).ok_or_else(|| format!("column '{}' not found", col_ref))
        })
        .collect();
    ...
}
```

---

## Try it yourself

Add this test to `source/src/executor.rs`:

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
    fn inner_join_two_tables() {
        let _ = std::fs::remove_file("/tmp/join_test.db");
        let _ = std::fs::remove_file("/tmp/join_test.wal");
        let mut exec = Executor::new("/tmp/join_test.db").unwrap();

        // Create and populate users.
        run(&mut exec, "CREATE TABLE users (id INT, name TEXT)");
        run(&mut exec, "INSERT INTO users VALUES (1, 'alice')");
        run(&mut exec, "INSERT INTO users VALUES (2, 'bob')");

        // Create and populate orders.
        run(&mut exec, "CREATE TABLE orders (user_id INT, amount INT)");
        run(&mut exec, "INSERT INTO orders VALUES (1, 500)");
        run(&mut exec, "INSERT INTO orders VALUES (1, 300)");
        run(&mut exec, "INSERT INTO orders VALUES (2, 200)");

        // JOIN — alice has 2 orders, bob has 1.
        let rs = run(
            &mut exec,
            "SELECT name, amount FROM users JOIN orders ON id = user_id",
        );
        match rs {
            ResultSet::Rows { rows, .. } => {
                assert_eq!(rows.len(), 3, "expected 3 joined rows");
            }
            ResultSet::Error(e) => panic!("unexpected error: {}", e),
            _ => panic!("expected rows"),
        }

        // With WHERE clause — only alice's orders.
        let rs = run(
            &mut exec,
            "SELECT name, amount FROM users JOIN orders ON id = user_id WHERE id = 1",
        );
        match rs {
            ResultSet::Rows { rows, .. } => {
                assert_eq!(rows.len(), 2, "expected 2 rows for user 1");
                assert_eq!(rows[0].values[0], crate::types::Value::Text("alice".into()));
            }
            ResultSet::Error(e) => panic!("unexpected error: {}", e),
            _ => panic!("expected rows"),
        }

        std::fs::remove_file("/tmp/join_test.db").ok();
        std::fs::remove_file("/tmp/join_test.wal").ok();
    }
}
```

Run with `cargo test inner_join_two_tables`.

Two more tests cover a WHERE filter applied on top of a join, and the empty-result case:

`test_join_with_where_filter` creates `users` (id, name) and `orders` (uid, amount), then runs a JOIN filtered to `amount > 99`. Alice has two qualifying orders (100 and 200); Bob's order (50) is excluded. The test uses unqualified column names — the lexer does not support `table.column` dot syntax:

```rust
#[test]
fn test_join_with_where_filter() {
    // ...
    run(&mut exec, "CREATE TABLE users (id INT, name TEXT)");
    run(&mut exec, "CREATE TABLE orders (uid INT, amount INT)");
    // alice: 100, 200 — bob: 50
    match run(&mut exec, "SELECT * FROM users JOIN orders ON id = uid WHERE amount > 99") {
        ResultSet::Rows { rows, .. } => assert_eq!(rows.len(), 2),
        other => panic!("unexpected: {:?}", other),
    }
}
```

`test_join_empty_result` verifies that a JOIN where no keys match returns zero rows rather than panicking or returning an error:

```rust
#[test]
fn test_join_empty_result() {
    // a.id = 1, b.fk = 99 — no match
    match run(&mut exec, "SELECT * FROM a JOIN b ON id = fk") {
        ResultSet::Rows { rows, .. } => assert_eq!(rows.len(), 0),
        _ => panic!(),
    }
}
```

---

## Key takeaways

- A JOIN is a filtered Cartesian product. The nested loop join makes this literal: two nested loops, one per table, with the join condition as the filter.
- Nested loop join costs O(|outer| × |inner|). Hash join (O(n + m)) and sort-merge join (O(n log n)) are faster for large tables but require more infrastructure.
- The `JoinClause` AST node stores the join table and the two column references. The parser consumes one or more `[INNER] JOIN table ON left = right` clauses.
- Column references in JOIN conditions and SELECT lists support "table.col" notation. The executor strips the prefix and searches the combined schema.
- Multiple JOINs are handled iteratively: each join widens the combined schema and combined row set.
- Only equi-joins are supported. Theta-joins, outer joins, and self-joins are natural extensions.

---

**← Previous:** [Chapter 14 — Crash Recovery](14-recovery.md) | **Next:** [Chapter 16 — Concurrent Access](16-concurrency.md)
