# Chapter 5: Rows, Types, and Serialisation

Pages are just bytes. A database's job is to impose meaning on those bytes: this byte offset holds an integer, the next four bytes are a string length, and so on. This chapter builds the type system and the serialisation layer that lets RustDB store and retrieve structured data.

---

## The gap between types and bytes

A SQL `INTEGER` column might hold the value `42`. On disk it is represented as the 8-byte little-endian sequence `2A 00 00 00 00 00 00 00`. When you read those bytes back, you need to know:

1. That they represent an integer (not a float or a string)
2. That the encoding is little-endian signed 64-bit
3. Where the integer ends and the next value begins

There are two broad strategies for encoding this information:

**Schema-dependent encoding** — the schema defines the layout completely. Given `(id INT, name TEXT, active BOOL)`, the decoder knows that bytes 0–7 are a little-endian `i64` for `id`, the next bytes hold the `name` text (with a length prefix), and so on — *with no type tag*, because the schema already specifies the type. PostgreSQL uses this approach for fixed-width columns.

**Self-describing encoding** — each encoded value carries its own type tag. The decoder can read a stream of values without consulting a schema. RustDB uses this approach: every `Value::serialize()` call prepends a type tag byte. This simplifies deserialisation and lets us handle nullable columns uniformly.

---

## Theory: fixed-width vs. variable-width records

### Fixed-width records

If every column is a fixed size (INT = 8 bytes, BOOL = 1 byte, no TEXT), rows have a known, compile-time size. This allows:

- Direct array indexing: row `n` starts at byte `n × row_size`
- No length prefixes needed
- Fast access to any column without scanning

This is how column-oriented stores (Parquet, ORC) and some row stores (ISAM files) work for numeric data.

### Variable-width records

Once you introduce variable-length columns (TEXT, BLOB), rows can differ in length. You now need a way to find where each value ends. Options:

1. **Length-prefixed** — store the byte count before the value. RustDB uses this for TEXT: 4 bytes of length followed by the UTF-8 content.
2. **Null-terminated** — scan for a sentinel byte. Fragile and prohibits the sentinel in the data.
3. **Offset array** — store an array of offsets at the start of each row pointing to each column's data. Used by PostgreSQL's heap format.

RustDB's self-describing encoding is effectively option 1 with a type tag:

```
[tag: 1 byte][length (for text): 4 bytes][data: length bytes]
             └─── payload ───────────────────────────────────┘
```

---

## Code walkthrough

### `types.rs` — the `Value` and `DataType` enums

```rust
// source/src/types.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-05

pub enum DataType { Int, Float, Text, Bool }

pub enum Value {
    Int(i64),
    Float(f64),
    Text(String),
    Bool(bool),
    Null,
}
```

`DataType` describes a column's declared type. `Value` holds an actual runtime datum (or `Null`). The decoupling matters: a column declared `INT` may hold `Value::Null` if it is nullable.

**Encoding table:**

| Tag | Variant | Payload |
|-----|---------|---------|
| 0 | `Int(i64)` | 8 bytes, little-endian |
| 1 | `Float(f64)` | 8 bytes, IEEE 754 little-endian |
| 2 | `Text(String)` | 4-byte length + UTF-8 bytes |
| 3 | `Bool(bool)` | 1 byte (0 or 1) |
| 4 | `Null` | (nothing) |

**Serialisation:**

```rust
pub fn serialize(&self) -> Vec<u8> {
    match self {
        Value::Int(n) => {
            let mut b = vec![0u8];
            b.extend_from_slice(&n.to_le_bytes());
            b
        }
        Value::Text(s) => {
            let mut b = vec![2u8];
            let sb = s.as_bytes();
            b.extend_from_slice(&(sb.len() as u32).to_le_bytes());
            b.extend_from_slice(sb);
            b
        }
        // ... other variants ...
    }
}
```

**Deserialisation:**

```rust
pub fn deserialize(bytes: &[u8]) -> Option<(Value, usize)> {
    let tag = *bytes.first()?;
    match tag {
        0 => {
            let n = i64::from_le_bytes(bytes[1..9].try_into().ok()?);
            Some((Value::Int(n), 9)) // consumed 1 tag + 8 data bytes
        }
        2 => {
            let len = u32::from_le_bytes(bytes[1..5].try_into().ok()?) as usize;
            let s = String::from_utf8(bytes[5..5 + len].to_vec()).ok()?;
            Some((Value::Text(s), 5 + len))
        }
        // ...
    }
}
```

The return type `(Value, usize)` includes the number of bytes consumed. This lets the `Row::deserialize` function advance through a byte slice without knowing individual value sizes in advance.

---

### `schema.rs` — the `Column` and `Schema` structs

```rust
// source/src/schema.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-05

pub struct Column {
    pub name: String,
    pub data_type: DataType,
    pub nullable: bool,
}

pub struct Schema {
    pub columns: Vec<Column>,
}
```

`Schema::validate` checks that a slice of `Value`s matches the schema: correct count, correct types, and no nulls in non-nullable columns:

```rust
pub fn validate(&self, values: &[Value]) -> Result<(), String> {
    if values.len() != self.columns.len() {
        return Err(format!("expected {} value(s), got {}", ...));
    }
    for (col, val) in self.columns.iter().zip(values.iter()) {
        match val {
            Value::Null if !col.nullable => {
                return Err(format!("column '{}' is NOT NULL", col.name));
            }
            Value::Null => {}
            other => {
                if let Some(vt) = other.data_type() {
                    if vt != col.data_type {
                        return Err(format!("type mismatch for column '{}'", col.name));
                    }
                }
            }
        }
    }
    Ok(())
}
```

`column_index` does a case-insensitive linear scan, which is fast enough for tables with tens of columns:

```rust
pub fn column_index(&self, name: &str) -> Option<usize> {
    self.columns.iter().position(|c| c.name.eq_ignore_ascii_case(name))
}
```

---

### `row.rs` — the `Row` struct

```rust
// source/src/row.rs
// https://github.com/akkeshavan/db-tutorial-source/chapter-05

pub struct Row {
    pub values: Vec<Value>,
}

impl Row {
    pub fn serialize(&self) -> Vec<u8> {
        self.values.iter().flat_map(|v| v.serialize()).collect()
    }

    pub fn deserialize(bytes: &[u8], schema: &Schema) -> Option<Row> {
        let mut values = Vec::with_capacity(schema.columns.len());
        let mut offset = 0;
        for _ in &schema.columns {
            let (val, consumed) = Value::deserialize(&bytes[offset..])?;
            values.push(val);
            offset += consumed;
        }
        Some(Row { values })
    }
}
```

Serialisation chains all column values into a flat byte vector. Deserialisation loops once per column, consuming bytes from the front of the slice. The schema provides the column count — the only schema information needed for deserialization (the self-describing tags handle types).

---

## Why little-endian?

All multi-byte integers in RustDB are encoded little-endian (least-significant byte first). Modern x86, ARM, and RISC-V processors are little-endian. Using the native byte order means that on common hardware, no byte-swapping is needed — `to_le_bytes()` and `from_le_bytes()` are no-ops on those platforms. The Rust standard library functions are always correct on big-endian platforms too, so the code is portable.

---

## Try it yourself

Add this test to `src/types.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_all_types() {
        let cases = vec![
            Value::Int(42),
            Value::Float(3.14),
            Value::Text("hello".to_string()),
            Value::Bool(true),
            Value::Null,
        ];
        for original in &cases {
            let bytes = original.serialize();
            let (decoded, consumed) = Value::deserialize(&bytes).unwrap();
            assert_eq!(decoded, *original);
            assert_eq!(consumed, bytes.len());
        }
    }

    #[test]
    fn multi_value_stream() {
        let vals = vec![Value::Int(1), Value::Text("ab".into()), Value::Bool(false)];
        let mut stream: Vec<u8> = Vec::new();
        for v in &vals {
            stream.extend(v.serialize());
        }
        let mut offset = 0;
        for expected in &vals {
            let (got, n) = Value::deserialize(&stream[offset..]).unwrap();
            assert_eq!(got, *expected);
            offset += n;
        }
    }
}
```

The next two tests go further: `test_all_types_roundtrip` hits every `Value` variant (including `Float` and `Null`) and asserts both that the decoded value matches and that `consumed == bytes.len()` — so there are no stray trailing bytes:

```rust
#[test]
fn test_all_types_roundtrip() {
    let values = vec![
        Value::Int(-99),
        Value::Float(3.14),
        Value::Text("hello world".into()),
        Value::Bool(false),
        Value::Null,
    ];
    for v in &values {
        let bytes = v.serialize();
        let (v2, consumed) = Value::deserialize(&bytes).expect("deserialize failed");
        assert_eq!(consumed, bytes.len());
        match (&v, &v2) {
            (Value::Float(a), Value::Float(b)) => assert!((a - b).abs() < 1e-10),
            _ => assert_eq!(format!("{:?}", v), format!("{:?}", v2)),
        }
    }
}
```

`test_chained_deserialization` serializes three values end-to-end into one byte buffer, then advances an offset cursor through it. This is exactly how `Row::deserialize` works — each call consumes exactly its own bytes and leaves the rest intact:

```rust
#[test]
fn test_chained_deserialization() {
    let vals = vec![Value::Int(1), Value::Text("ab".into()), Value::Bool(true)];
    let bytes: Vec<u8> = vals.iter().flat_map(|v| v.serialize()).collect();
    let mut offset = 0;
    for expected in &vals {
        let (got, consumed) = Value::deserialize(&bytes[offset..]).unwrap();
        assert_eq!(format!("{:?}", expected), format!("{:?}", got));
        offset += consumed;
    }
    assert_eq!(offset, bytes.len());
}
```

Two schema validation tests belong in `src/schema.rs`. The first catches a type mismatch; the second catches a `NULL` written into a `NOT NULL` column:

```rust
#[test]
fn test_schema_validate_wrong_type() {
    let schema = Schema::new(vec![Column::new("id", DataType::Int)]);
    let result = schema.validate(&[Value::Text("oops".into())]);
    assert!(result.is_err(), "wrong type should fail validation");
}

#[test]
fn test_schema_validate_null_not_null() {
    let schema = Schema::new(vec![Column::new("id", DataType::Int).not_null()]);
    let result = schema.validate(&[Value::Null]);
    assert!(result.is_err(), "NULL in NOT NULL column should fail");
}
```

These four tests together give full coverage of the type system's two jobs: faithfully encoding and decoding every variant, and enforcing schema constraints before a row touches storage.

---

## Key takeaways

- A type tag byte before each value makes deserialization self-describing and simplifies nullable handling.
- `(Value, usize)` from `deserialize` lets callers advance a byte cursor through packed row data.
- `Schema::validate` is the single enforcement point for type correctness — called before every insert.
- Rows are stored as a flat byte sequence; the schema is only needed at the point of deserialization.

---

**← Previous:** [Chapter 4 — The Buffer Pool](04-buffer-pool.md) | **Next:** [Chapter 6 — Tables and the System Catalog](06-catalog.md)
