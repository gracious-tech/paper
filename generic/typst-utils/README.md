# typst-utils

Zero-dependency helpers for working with Typst markup.

Works in browser and Node.

`npm install typst-utils`

## API

| Function | Use |
|---|---|
| `escape_typst(s)` | Escape a string for embedding as markup/content text (includes `=`, the line-start heading marker). |
| `escape_typst_str(s)` | Escape a string for embedding inside a double-quoted string literal. |
| `escape_typst_postfix(s)` | Escape a leading `(` / `.` in text emitted directly after an inline code expression. Run after `escape_typst`. |
| `typst_inline(expr, text)` | Join an inline code expression to following markup text, escaping the seam. |

```ts
// escape_typst — markup text; here * would otherwise start strong emphasis
escape_typst('Or *the anointed one*')      // → Or \*the anointed one\*

// escape_typst_str — contents of a "quoted string", e.g. raw("...")
escape_typst_str('print("hi")')            // → print(\"hi\")

// escape_typst_postfix — leading ( or . after a code expr (run after escape_typst)
escape_typst_postfix('(Selah) Praise him') // → \(Selah) Praise him
escape_typst_postfix('Praise the Lord')    // → Praise the Lord (no leading trigger)

// typst_inline — a verse expression joined to verse text starting with "("
typst_inline('#v(8)', '(Selah)')           // → #v(8)\(Selah)
```

## Emitting code expressions next to text

Typst keeps reading code after an expression like `#v(8)` if the next character starts a
postfix operator — `(` (call), `[` (content arg), or `.` (field access). `escape_typst`
already neutralises `[`, but a leading `(` or `.` in literal text would still be consumed.
When you emit a code expression immediately followed by text, pass that text through
`escape_typst_postfix` (after `escape_typst`), or use `typst_inline` to do both:

```ts
// ❌ "#v(8)(an aside)"  — Typst error: tries to call v(8)
output += '#v(8)' + escape_typst('(an aside)')

// ✅ "#v(8)\(an aside)" — literal parenthesis
output += typst_inline('#v(8)', '(an aside)')
```

You do not need `escape_typst_postfix` for text that follows plain markup, a space, or
the start of a paragraph, nor for text inside a content block (`#strong[…]`) — there the
text is in markup context and `(` / `.` are already literal.
