
// Render a QR code as Typst markup. Uses `uqr` (zero-dependency, runtime-agnostic) for the raw
// module matrix and draws the modules with a native Typst `curve` so the code has no background
// and takes the surrounding text color (`text.fill`) unless an explicit color is given.
//
// The returned string is a bare code-mode expression (no leading `#`) — use it directly as a
// function argument, or prefix `#` to drop it into markup.

import {encode} from 'uqr'


// Options for gen_qr_typst
export interface QrOptions {
    width?:string  // Rendered size of the whole code incl. quiet zone (default '2.6cm')
    color?:string  // Module color as a hex string; omitted = inherit the adjacent text color
}


// Blank margin kept around the code, in modules (the spec asks for 4; 3 is a fine compromise for
// a small printed code). Passed to `uqr` as `border`, which pads the matrix with light cells.
const QUIET = 3


// Build Typst markup for a QR code encoding `data`
export function gen_qr_typst(data:string, opts:QrOptions = {}):string {
    const width = opts.width ?? '2.6cm'

    // `border` bakes the quiet zone into the matrix, so `size` already spans code + margin
    const {size, data: matrix} = encode(data, {ecc: 'M', border: QUIET})
    const unit = `(${width} / ${size})`

    // One closed square per dark module. Relative lines keep the markup compact; curve.close()
    // returns each square to its start point
    let segments = ''
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (!matrix[y]![x]) {
                continue
            }
            const px = `${unit} * ${x}`
            const py = `${unit} * ${y}`
            segments += `curve.move((${px}, ${py})),`
                + `curve.line((${unit}, 0pt), relative: true),`
                + `curve.line((0pt, ${unit}), relative: true),`
                + `curve.line((-1 * ${unit}, 0pt), relative: true),`
                + 'curve.close(),'
        }
    }

    const fill = opts.color ? `rgb("${opts.color}")` : 'text.fill'
    const draw = `box(width: ${width}, height: ${width},`
        + ` curve(fill: ${fill}, stroke: none, ${segments}))`
    return opts.color ? draw : `context ${draw}`
}
