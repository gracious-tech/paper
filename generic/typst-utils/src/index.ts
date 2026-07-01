
/**
 * Escape a string for embedding as a Typst double-quoted string literal.
 * Escapes backslashes and double-quotes only.
 */
export function escape_typst_str(s:string):string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}


/* Escape characters that have special meaning in Typst content mode
    \     Character escape / line break
    #     Code expression
    []    Content block
    $     Math mode
    *     Strong emphasis
    _     Emphasis
    `     Raw text
    <>    Label
    @     Reference
    ~     Symbol shorthand (non-breaking space)
    /     Term list / comment
    +     Numbered list
    -     Bullet list / symbol shorthand (dashes)
    =     Heading (line start)
*/
export function escape_typst(s:string):string {
    // eslint-disable-next-line no-useless-escape
    return s.replace(/[\\#\[\]$*_`<>@~/+\-=]/g, '\\$&')
}


/**
 * Escape a leading character that Typst would otherwise read as *continuing* a preceding
 * inline code expression: `(` (call arguments) or `.` (field access).
 *
 * Apply ONLY to text that is emitted directly after an inline code expression such as
 * `#v(8)` or the `]` that closes `#strong[…]`. Without it, `#v(8)` + "(aside)" becomes
 * `#v(8)(aside)`, which Typst parses as a function call and errors.
 *
 * MUST be run AFTER escape_typst(): by then a leading `[` is already `\[`, so only `(`
 * and `.` can still trigger. Running it before escape_typst() would double-escape.
 */
export function escape_typst_postfix(escaped:string):string {
    return escaped.replace(/^[.(]/, '\\$&')
}


/**
 * Concatenate an inline code expression with the markup text that follows it, escaping the
 * seam so a leading `(`, `[`, or `.` in the text is not read as continuing the expression.
 *
 * Example: typst_inline('#v(8)', '(an aside)…')  →  '#v(8)\\(an aside)…'
 *
 * For streaming/buffered emitters that don't join expr+text in one place, use
 * escape_typst_postfix() directly against a "just emitted a code expression" flag instead.
 */
export function typst_inline(expr:string, following_text:string):string {
    return expr + escape_typst_postfix(escape_typst(following_text))
}
