
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
*/
export function escape_typst(s:string):string {
    // eslint-disable-next-line no-useless-escape
    return s.replace(/[\\#\[\]$*_`<>@~/+-]/g, '\\$&')
}
