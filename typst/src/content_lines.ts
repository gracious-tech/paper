
import {parse_unit, to_mm} from './helpers.js'

import type {TypstLinesPage} from './types.js'


// Generate Typst markup for a page of dotted lines for notetaking
export function gen_lines(lines:TypstLinesPage):string {
    // Calculate how many lines fit on a page (use generous estimate based on A3 height)
    const spacing = parse_unit(lines.spacing)
    const max_height_mm = 420  // A3 height as upper bound
    const count = Math.ceil(max_height_mm / to_mm(spacing.num, spacing.unit))

    // Generate a grid of lines at the specified spacing. Lines sit at the bottom of their row
    // rather than the top, so the first line isn't flush against the top margin — and the last
    // fully-fitting row's line lands right at its row's bottom edge rather than leaving a
    // dangling gap above it (whatever doesn't fit as a whole row still spills onto a discarded
    // extra page — see gen_lines callers)
    const rows = `(${lines.spacing},) * ${count}`
    return `#grid(
    rows: ${rows},
    align: bottom,
    ..range(${count}).map(_ =>
        line(length: 100%, stroke: (dash: "dotted", thickness: 0.5pt))
    )
)`
}
