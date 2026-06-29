
import {parse_unit, to_mm} from './helpers.js'

import type {PageConfig, TypstLinesPage} from './types.js'


// Generate Typst markup for a page of dotted lines for notetaking
export function gen_lines(lines:TypstLinesPage, page:PageConfig):string {
    // Calculate how many lines fit on a page (use generous estimate based on A3 height)
    const spacing = parse_unit(lines.spacing)
    const max_height_mm = 420  // A3 height as upper bound
    const count = Math.ceil(max_height_mm / to_mm(spacing.num, spacing.unit))

    // Generate a grid of lines at the specified spacing
    const rows = `(${lines.spacing},) * ${count}`
    return `#grid(
    rows: ${rows},
    ..range(${count}).map(_ =>
        line(length: 100%, stroke: (dash: "dotted", thickness: 0.5pt))
    )
)`
}
