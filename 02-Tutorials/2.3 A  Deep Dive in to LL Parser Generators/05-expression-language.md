# Chapter 5: Simple Expression Language

**Previous:** [Chapter 4 — Parser and AST Generation](04-parser-ast-generation.md)

This chapter ties together the **grammar front end**, **lexer generator**, and **parser/AST generator** using a **simple expression language**. By the end you have an end-to-end pipeline: grammar file → grammar IR → generated lexer + parser → AST. The **reference** pipeline uses a **.grammar** file with semantic actions (see Ch 2.9); the same IR can be produced from a .g4 subset (Ch 2.8).

## 5.1 Grammar: Expr.g4

We use a minimal ANTLR4-style grammar that includes:

- **Lexer:** integers, identifiers, operators `+`, `-`, `*`, `/`, `(`, `)`, optional whitespace.
- **Parser:** expressions with precedence (additive and multiplicative), parenthesized expressions, and a start rule.

Example grammar (see `source/examples/grammars/Expr.g4`):

```antlr
grammar Expr;

// Lexer rules
INT  : [0-9]+ ;
WS   : [ \t\n\r]+ -> skip ;
PLUS : '+' ;
MINUS: '-' ;
MUL  : '*' ;
DIV  : '/' ;
LPAREN : '(' ;
RPAREN : ')' ;
ID   : [a-zA-Z_][a-zA-Z0-9_]* ;

// Parser rules (expression with precedence)
start : expr EOF ;

expr  : term ( ( PLUS | MINUS ) term )* ;
term  : factor ( ( MUL | DIV ) factor )* ;
factor: INT | ID | LPAREN expr RPAREN ;
```

This is **left-recursion-free** and encodes precedence via rule hierarchy: `expr` (additive) → `term` (multiplicative) → `factor` (atoms).

The **reference generator** expects **right-recursive** expression rules (Ch 4.11); see **Expr.grammar** for the form used by `grammar_loader` and **`parser_gen gen`**. The iterative form above is valid ANTLR4 and useful for understanding precedence; to use it with our generator you would need to extend it to emit the loop for `term (op term)*`.

## 5.2 Pipeline Steps

1. **Load grammar** → `Grammar` IR. In the reference crate, the grammar is loaded from **Expr.grammar** (see Ch 2.9) via `grammar_loader` and passed to the lexer and parser generators. Optionally, parse **Expr.g4** with the grammar parser from Chapter 2 to build the same IR.
2. **Generate lexer** (Chapter 3) for Rust and for JS → `expr_lexer.rs` (or `.js`).
3. **Generate parser + AST** (Chapter 4) for Rust and JS → `expr_parser.rs` + AST types, and JS equivalents.
4. **Wire:** Lexer tokenizes source string → Parser consumes token stream → AST.

## 5.3 AST for Expressions

For this language the AST can be:

- **Literal(i64)** or **Ident(String)** for integers and variables.
- **Binary(Box<Expr>, BinOp, Box<Expr>)** for binary ops.
- **Unary(UnOp, Box<Expr>)** if you add unary minus later.

The generated parser builds these when reducing `factor` and folding `term` / `expr` lists.

## 5.4 Testing the Pipeline

- **Input:** e.g. `"1 + 2 * 3"` or `"(1 + 2) * 3"`.
- **Expected:** AST representing the correct precedence and associativity.
- **Test:** Run generated Rust/JS parser on a few strings and assert on the AST (or print it). Optionally compare with a hand-written expected AST.

## 5.5 What You Have After This Chapter

- A **working pipeline**: ANTLR4 grammar → IR → generated lexer + parser in at least one target (Rust, and ideally JS).
- A **simple expression language** you can later extend (e.g. with assignment, statements) and use for the **interpreter** (Chapter 6), **runtime** (Chapters 8–9), and **LLVM** (Chapter 10).

---

## 5.6 Source Code: End-to-End Pipeline

The pipeline is: **grammar file → Grammar IR → generate_rust_lexer / generate_rust_parser → run lexer → run parser → AST**. The reference code uses the modules from Chapters 2–4.

### 5.6.1 Building the grammar IR (by hand for Expr)

Until we implement the `.g4` parser (Chapter 2), we can build the IR manually for the expression grammar:

```rust
// Conceptual: building Expr grammar IR
use parser_gen::grammar::{Grammar, LexerRule, LexerAlt, LexerElement, ParserRule, ParserAlt, ParserElement};

let grammar = Grammar {
    name: "Expr".into(),
    lexer_rules: vec![
        LexerRule { name: "INT".into(), fragment: false, skip: false,
            alternatives: vec![LexerAlt { elements: vec![
                LexerElement::OneOrMore(Box::new(LexerElement::CharRange('0', '9')))
            ] }] },
        LexerRule { name: "WS".into(), ..., skip: true, ... },
        LexerRule { name: "PLUS".into(), ..., alternatives: vec![LexerAlt { elements: vec![LexerElement::Literal("+".into())] }] },
        // ... MINUS, MUL, DIV, LPAREN, RPAREN, ID
    ],
    parser_rules: vec![
        ParserRule { name: "start".into(), alternatives: vec![
            ParserAlt { elements: vec![ParserElement::RuleRef("expr".into()), ParserElement::TokenRef("EOF".into())] }
        ]},
        ParserRule { name: "expr".into(), alternatives: vec![
            ParserAlt { elements: vec![
                ParserElement::RuleRef("term".into()),
                ParserElement::ZeroOrMore(Box::new(ParserElement::Group(vec![
                    ParserElement::TokenRef("PLUS".into()), ParserElement::RuleRef("term".into())
                ])))
            ]}
        ]},
        // term, factor ...
    ],
};
```

### 5.6.2 Generating and running

```rust
// 1. Generate lexer and parser (strings)
let lexer_src = lexer_gen::generate_rust_lexer(&grammar)?;
let parser_src = parser_gen::generate_rust_parser(&grammar)?;
// Write to files or compile in a build script.

// 2. At runtime: tokenize then parse
// let mut lexer = ExprLexer::new("1 + 2 * 3");
// let tokens: Vec<Token> = std::iter::from_fn(|| Some(lexer.next_token())).take_while(|t| t.kind != TokenKind::Eof).collect();
// let mut parser = ExprParser::new(tokens);
// let ast = parser.parse_start()?;
```

### 5.6.3 Expected AST for `"1 + 2 * 3"`

Precedence means `*` binds tighter: the AST should be like `Binary(Literal(1), Add, Binary(Literal(2), Mul, Literal(3)))`. The generated parser’s `expr`/`term`/`factor` fold (Chapter 4) produces this structure.

---

## 5.7 Code Walkthrough: Pipeline and Precedence

### Pipeline

1. **Grammar IR** is the single source of truth. From it we generate both lexer and parser.
2. **Lexer** turns source into tokens (INT, PLUS, MUL, etc.). Order and longest-match (Chapter 3) ensure `123` is one INT and `+` is PLUS.
3. **Parser** consumes tokens via one function per rule. For `expr : term ( ( PLUS | MINUS ) term )*`, the emitted code parses one `term`, then in a loop: if peek is PLUS or MINUS, consume op and next `term`, and fold into a left-associative `Binary` node.
4. **Precedence** comes from the rule hierarchy: `expr` (lowest) calls `term`, which calls `factor` (atoms). So additive ops are at the top level and multiplicative inside `term`; the resulting tree has `*` deeper than `+`.

### Testing

- Feed `"1 + 2 * 3"` and assert the root is `Binary(_, Add, Binary(_, Mul, _))`.
- Feed `"(1 + 2) * 3"` and assert the root is `Binary(Binary(_, Add, _), Mul, _)`.

---

**Next:** [Chapter 6 — Building an Interpreter from ASTs](06-interpreter-from-ast.md)
