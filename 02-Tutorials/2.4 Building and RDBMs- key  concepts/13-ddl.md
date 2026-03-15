# Chapter 13: DDL — DROP TABLE and ALTER TABLE

Once a database is in production, the schema is rarely static. Teams add new columns, rename tables, remove unused ones. These operations are collectively called **DDL** — Data Definition Language — as opposed to the DML (Data Manipulation Language) of SELECT, INSERT, UPDATE, and DELETE. This chapter adds three DDL operations to RustDB: `DROP TABLE`, `TRUNCATE TABLE`, and `ALTER TABLE ADD COLUMN`.

---

## Theory: the schema evolution problem

A table in a database is two things at once: a **schema** (a description of the columns and their types) and **data** (the actual serialised bytes). Changing the schema is straightforward — update an in-memory struct. But the data is already written to disk in the old format. Making the old bytes compatible with the new schema is the hard part.

### DROP TABLE

The simplest DDL: remove the table's entry from the catalog. The pages on disk that held the table's data are orphaned — no pointer leads to them any more. A production database maintains a **free-list** of available page IDs so those pages can be reused. RustDB does not implement a free-list, so dropped table pages are abandoned. This is a known limitation discussed in the comments.

### TRUNCATE TABLE

`TRUNCATE TABLE t` is semantically equivalent to `DELETE FROM t` (remove all rows) but much faster. Instead of scanning every row and tombstoning each slot, `TRUNCATE` allocates a fresh empty heap page and replaces the catalog's `heap_root` pointer. The old pages are abandoned just as with `DROP TABLE`.

This is the "swap the root" trick used by many real databases. PostgreSQL, for example, creates new relation files for `TRUNCATE`, leaving the old files to be removed by the transaction commit.

### ALTER TABLE ADD COLUMN: lazy materialisation

Adding a new column is deceptively tricky. The simplest approach — rewrite every row on disk to include the new column's value — is expensive and requires a full table scan. Postgres calls this an "access-exclusive lock" and blocks reads for the duration.

A better approach is **lazy materialisation** (also called "partial row" or "null-pad"):

1. Add the column definition to the schema in the catalog.
2. Leave the old rows on disk untouched. They have no bytes for the new column.
3. When reading an old row, pad the missing trailing values with `NULL`.
4. New rows written after the `ALTER` include the new column's value normally.

This is exactly what RustDB implements. It works correctly only for trailing columns (adding a column to the end of the schema), and only when the new column is nullable.

> **Warning: adding a NOT NULL column is not supported.** `ALTER TABLE users ADD COLUMN score INT` with no default will succeed in the catalog but existing rows will read back `Value::Null` for `score` — violating the NOT NULL constraint silently. RustDB does not validate this. Only add nullable columns with this command.

### Why ALTER TABLE DROP COLUMN is harder

Dropping a column from the middle of a schema is significantly harder:

- Old rows have bytes for the dropped column between bytes for other columns.
- Serialisation in RustDB is positional (value 0, then value 1, ...). Removing column 1 from a 3-column row would require every row to be re-serialised.
- A common production trick: mark the column as "dropped" in the catalog but leave the bytes in place, and skip those bytes during deserialisation. PostgreSQL's `pg_attribute` has an `attisdropped` flag for exactly this purpose.

RustDB does not implement `DROP COLUMN` to avoid this complexity.

---

## Code walkthrough

> **Files modified in this chapter:** `catalog.rs`, `sql/lexer.rs`, `sql/ast.rs`, `sql/parser.rs`, `executor.rs`

### `catalog.rs`: `drop_table()` and `truncate_table()`

```rust
// source/src/catalog.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-13

pub fn drop_table(&mut self, name: &str) -> Result<(), String> {
    let key = name.to_ascii_lowercase();
    if self.tables.remove(&key).is_none() {
        Err(format!("table '{}' does not exist", name))
    } else {
        Ok(())
    }
}

pub fn truncate_table(&mut self, name: &str, new_heap_root: u32) -> Result<(), String> {
    let key = name.to_ascii_lowercase();
    match self.tables.get_mut(&key) {
        None => Err(format!("table '{}' does not exist", name)),
        Some(meta) => {
            meta.heap_root = new_heap_root;
            Ok(())
        }
    }
}
```

`drop_table` removes the `TableMeta` from the `HashMap`. `truncate_table` updates only the `heap_root` field — the schema and index remain untouched.

### `executor.rs`: `exec_drop_table()` and `exec_truncate()`

```rust
fn exec_drop_table(&mut self, table: String) -> ResultSet {
    // Pages are abandoned (no free-list yet — a future enhancement).
    match self.catalog.drop_table(&table) {
        Ok(_) => ResultSet::Ok(format!("table '{}' dropped", table)),
        Err(e) => ResultSet::Error(e),
    }
}

fn exec_truncate(&mut self, table: String) -> ResultSet {
    let new_heap = match TableHeap::create(&mut self.bp) {
        Ok(h) => h,
        Err(e) => return ResultSet::Error(e.to_string()),
    };
    // Old pages are abandoned (no free-list yet).
    match self.catalog.truncate_table(&table, new_heap.first_page_id) {
        Ok(_) => ResultSet::Ok(format!("table '{}' truncated", table)),
        Err(e) => ResultSet::Error(e),
    }
}
```

`exec_truncate` allocates a fresh heap page (`TableHeap::create`), then updates the catalog pointer. Future inserts go to the new page; old pages are unreachable.

### `executor.rs`: `exec_alter_table()`

```rust
fn exec_alter_table(&mut self, table: String, action: AlterAction) -> ResultSet {
    match action {
        AlterAction::AddColumn(col_def) => {
            let meta = match self.catalog.get_mut(&table) {
                Some(m) => m,
                None => return ResultSet::Error(format!("table '{}' not found", table)),
            };
            let mut new_col = Column::new(col_def.name.clone(), col_def.data_type.clone());
            if !col_def.nullable { new_col = new_col.not_null(); }
            meta.schema.columns.push(new_col);
            ResultSet::Ok(format!("column '{}' added to '{}'", col_def.name, table))
        }
    }
}
```

The new column is simply appended to `meta.schema.columns`. No data is touched on disk.

### `heap.rs`: padding in `scan_with_ids()`

The padding logic lives in `scan_with_ids()`, which is called by both `scan()` and the executor:

```rust
if let Some(mut r) = maybe_row {
    // Pad missing columns with Null (for ALTER TABLE ADD COLUMN).
    while r.values.len() < schema.columns.len() {
        r.values.push(crate::types::Value::Null);
    }
    rows.push(((cur_id, slot), r));
}
```

When an old row is read back after an `ALTER TABLE ADD COLUMN`, `deserialize_partial` reads only the values that are present in the serialised bytes. The `while` loop pads the result to the current schema length.

### `row.rs`: `deserialize_partial()`

```rust
// source/src/row.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-13

pub fn deserialize_partial(bytes: &[u8], _schema: &Schema) -> Option<Row> {
    let mut values = Vec::new();
    let mut offset = 0;
    while offset < bytes.len() {
        match Value::deserialize(&bytes[offset..]) {
            Some((val, consumed)) => {
                values.push(val);
                offset += consumed;
            }
            None => break,
        }
    }
    if values.is_empty() && !bytes.is_empty() {
        return None;
    }
    Some(Row { values })
}
```

Unlike `deserialize` (which reads exactly `schema.columns.len()` values and fails if there are fewer), `deserialize_partial` reads until the bytes are exhausted. The schema parameter is present for API consistency but unused.

### SQL parser additions

New keywords in `sql/lexer.rs`:

```rust
Drop,
Alter,
Truncate,
Add,
```

New statement variants in `sql/ast.rs`:

```rust
DropTable { table: String },
TruncateTable { table: String },
AlterTable { table: String, action: AlterAction },
```

And the `AlterAction` enum:

```rust
pub enum AlterAction {
    AddColumn(ColumnDef),
}
```

The parser dispatch in `parse()`:

```rust
Token::Drop => {
    self.advance();
    self.expect(&Token::Table)?;
    let table = self.expect_ident()?;
    Ok(Statement::DropTable { table })
}
Token::Truncate => {
    self.advance();
    self.expect(&Token::Table)?;
    let table = self.expect_ident()?;
    Ok(Statement::TruncateTable { table })
}
Token::Alter => {
    self.advance();
    self.parse_alter_table()
}
```

`parse_alter_table()` handles `ALTER TABLE name ADD [COLUMN] col_def`:

```rust
fn parse_alter_table(&mut self) -> Result<Statement, String> {
    self.expect(&Token::Table)?;
    let table = self.expect_ident()?;
    self.expect(&Token::Add)?;
    // Optional COLUMN keyword — note: COLUMN is not a reserved token in the
    // lexer (there is no Token::Column), so it is matched as a plain Ident.
    if let Token::Ident(ref s) = self.peek().clone() {
        if s.to_ascii_uppercase() == "COLUMN" { self.advance(); }
    }
    let col_def = self.parse_col_def()?;
    Ok(Statement::AlterTable { table, action: AlterAction::AddColumn(col_def) })
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
    fn alter_table_add_column() {
        let _ = std::fs::remove_file("/tmp/ddl_test.db");
        let _ = std::fs::remove_file("/tmp/ddl_test.wal");
        let mut exec = Executor::new("/tmp/ddl_test.db").unwrap();

        run(&mut exec, "CREATE TABLE users (id INT, name TEXT)");
        run(&mut exec, "INSERT INTO users VALUES (1, 'alice')");
        run(&mut exec, "INSERT INTO users VALUES (2, 'bob')");

        // Add a new column — existing rows should show NULL for it.
        let rs = run(&mut exec, "ALTER TABLE users ADD COLUMN email TEXT");
        match rs {
            ResultSet::Ok(msg) => assert!(msg.contains("email"), "got: {}", msg),
            _ => panic!("expected Ok"),
        }

        let rs = run(&mut exec, "SELECT * FROM users");
        match rs {
            ResultSet::Rows { rows, columns } => {
                assert_eq!(columns.len(), 3);
                assert_eq!(rows.len(), 2);
                // Existing rows should have NULL for the new column.
                assert_eq!(rows[0].values[2], crate::types::Value::Null);
                assert_eq!(rows[1].values[2], crate::types::Value::Null);
            }
            _ => panic!("expected rows"),
        }

        // New row includes the email column.
        run(&mut exec, "INSERT INTO users VALUES (3, 'carol', 'carol@example.com')");
        let rs = run(&mut exec, "SELECT * FROM users WHERE id = 3");
        match rs {
            ResultSet::Rows { rows, .. } => {
                assert_eq!(rows[0].values[2], crate::types::Value::Text("carol@example.com".into()));
            }
            _ => panic!("expected rows"),
        }

        std::fs::remove_file("/tmp/ddl_test.db").ok();
        std::fs::remove_file("/tmp/ddl_test.wal").ok();
    }

    #[test]
    fn drop_table_removes_from_catalog() {
        let _ = std::fs::remove_file("/tmp/drop_test.db");
        let _ = std::fs::remove_file("/tmp/drop_test.wal");
        let mut exec = Executor::new("/tmp/drop_test.db").unwrap();

        run(&mut exec, "CREATE TABLE temp (x INT)");
        assert!(exec.catalog.exists("temp"));

        let rs = run(&mut exec, "DROP TABLE temp");
        match rs {
            ResultSet::Ok(msg) => assert!(msg.contains("dropped"), "got: {}", msg),
            _ => panic!("expected Ok"),
        }

        assert!(!exec.catalog.exists("temp"));

        // Trying to select from a dropped table should give an error.
        let rs = run(&mut exec, "SELECT * FROM temp");
        assert!(matches!(rs, ResultSet::Error(_)));

        std::fs::remove_file("/tmp/drop_test.db").ok();
        std::fs::remove_file("/tmp/drop_test.wal").ok();
    }
}
```

Run with `cargo test alter_table_add_column` and `cargo test drop_table_removes_from_catalog`.

Three additional tests cover error paths and `TRUNCATE`:

`test_alter_table_existing_rows_get_null` inserts a row before the `ALTER TABLE`, then verifies that the new column appears as `NULL` in the result (lazy materialisation — no disk rewrite):

```rust
#[test]
fn test_alter_table_existing_rows_get_null() {
    // ...
    run(&mut exec, "CREATE TABLE t (id INT)");
    run(&mut exec, "INSERT INTO t VALUES (42)");
    run(&mut exec, "ALTER TABLE t ADD COLUMN name TEXT");
    match run(&mut exec, "SELECT * FROM t") {
        ResultSet::Rows { rows, .. } => {
            assert_eq!(rows[0].values.len(), 2);
            assert_eq!(rows[0].values[1], Value::Null);
        }
        _ => panic!(),
    }
}
```

`test_drop_nonexistent_table_errors` attempts to drop a table that was never created; the executor must return `ResultSet::Error` rather than panicking:

```rust
#[test]
fn test_drop_nonexistent_table_errors() {
    let stmt = crate::sql::Parser::new("DROP TABLE ghost").unwrap().parse().unwrap();
    match exec.execute(stmt) {
        ResultSet::Error(_) => {} // expected
        other => panic!("expected error, got {:?}", other),
    }
}
```

`test_truncate_removes_all_rows` inserts two rows, truncates the table, then selects — the result set must be empty. This confirms that the heap-root pointer in the catalog was replaced with a fresh empty page:

```rust
#[test]
fn test_truncate_removes_all_rows() {
    // ...
    run(&mut exec, "INSERT INTO t VALUES (1)");
    run(&mut exec, "INSERT INTO t VALUES (2)");
    run(&mut exec, "TRUNCATE TABLE t");
    match run(&mut exec, "SELECT * FROM t") {
        ResultSet::Rows { rows, .. } => assert_eq!(rows.len(), 0),
        _ => panic!(),
    }
}
```

---

## Key takeaways

- `DROP TABLE` removes the catalog entry; orphaned pages are a known limitation until a free-list is implemented.
- `TRUNCATE` is faster than `DELETE *` because it swaps in a fresh heap page rather than tombstoning every row.
- `ALTER TABLE ADD COLUMN` uses lazy materialisation: add the column to the schema only, and pad old rows with `NULL` at read time. This is fast and requires no disk rewrites.
- `deserialize_partial` reads as many values as the bytes contain, enabling forward-compatible reads of old rows after a schema extension.
- `DROP COLUMN` requires marking columns as dropped in the schema or rewriting all rows — it is left as a future exercise.

---

**← Previous:** [Chapter 12 — UPDATE and DELETE](12-update-delete.md) | **Next:** [Chapter 14 — Crash Recovery](14-recovery.md)
