
// Escape text for use in Typst markup content
export function escape_typst(text:string):string {
    return text.replace(/[\\#\[\]$*_`<>@~]/g, '\\$&')
}


// Books that almost always need 2-column layout due to size and poetry line breaks
export const LARGE_POETRY = ['job', 'psa', 'pro', 'isa', 'jer', 'ezk']


// Books that have a substantial amount of poetry (not just a stanza here and there)
export const LOTS_OF_POETRY = [
    'job', 'psa', 'pro', 'ecc', 'sng',
    'isa', 'jer', 'lam', 'ezk',
    'hos', 'jol', 'amo', 'oba',
    'mic', 'nam', 'hab', 'zep', 'hag', 'zec',
]


// Indent every line of a string by the given number of spaces
export function indent(text:string, spaces:number = 4):string {
    const pad = ' '.repeat(spaces)
    return text.split('\n').map(line => line ? pad + line : line).join('\n')
}


// Parse a Typst unit string like "210mm" or "10pt" into numeric value and unit
export function parse_unit(value:string):{num:number, unit:string} {
    const match = value.match(/^([\d.]+)\s*(mm|cm|in|pt|em)$/)
    if (!match) {
        throw new Error(`Invalid Typst unit string: "${value}"`)
    }
    return {num: parseFloat(match[1]!), unit: match[2]!}
}


// Convert a value to mm for calculation purposes
export function to_mm(value:number, unit:string):number {
    switch (unit) {
        case 'mm':
            return value
        case 'cm':
            return value * 10
        case 'in':
            return value * 25.4
        case 'pt':
            return value * 0.3528
        default:
            return value
    }
}
