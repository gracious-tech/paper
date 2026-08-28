
// Alignment of two side-by-side/facing translations. The primary translation is chunked at
// the chosen granularity (verse/paragraph/chapter) and the second translation is force-cut at
// the same verse boundaries, so each chunk pair renders as one vertically-aligned row (see
// gen_multi_bible_grids in content_passage.ts). All functions operate on the pre-rendered
// Typst markup from fetch.bible (#ch/#vn marker calls, blank-line paragraph blocks).


// One chapter of book markup with its chapter number (parsed from the #ch marker)
export interface ChapterChunk {
    num:number
    text:string
}


// Split book markup into chapters on the #ch(n) marker lines. Content before the first marker
// (book intro, or a partial-chapter extract with no marker at all) joins the first chunk.
export function split_chapters(content:string):ChapterChunk[] {
    const parts = content.split(/(?=^#ch\(\d+\))/m)
    if (parts.length > 1 && !/^#ch\(/.test(parts[0]!)) {
        parts[1] = parts[0]! + parts[1]!
        parts.shift()
    }
    return parts.map(text => {
        const match = /#ch\((\d+)\)/.exec(text)
        return {num: match ? Number(match[1]) : 1, text}
    })
}


// A cut at `pos` must not land inside an unclosed content block (e.g. between the brackets of
// a poetry line `#q(1)[#vn(3)...]`) — that would break the markup. If brackets are unbalanced
// between the line start and pos, snap the cut back to the line start (whole-line cuts are
// safe: poetry continuation lines belong with the preceding verse).
function snap_cut(text:string, pos:number):number {
    const line_start = text.lastIndexOf('\n', pos - 1) + 1
    const prefix = text.slice(line_start, pos)
    const opens = (prefix.match(/\[/g) ?? []).length
    const closes = (prefix.match(/\]/g) ?? []).length
    return opens > closes ? line_start : pos
}


// Character offset where each verse begins within a chunk of markup, snapped to a safe cut
// position (first occurrence wins when a verse number repeats)
function verse_offsets(text:string):Map<number, number> {
    const offsets = new Map<number, number>()
    for (const match of text.matchAll(/#vn\((\d+)\)/g)) {
        const verse = Number(match[1])
        if (!offsets.has(verse)) {
            offsets.set(verse, snap_cut(text, match.index))
        }
    }
    return offsets
}


// End of the paragraph block that holds this text's last verse marker — the first blank line
// after it, or end of text. Used as the cut point for a boundary verse that lies past every
// verse this translation actually has, so any trailing prose (a closing greeting, a verse the
// translation merges away) lands in that boundary's row instead of being piled onto the row
// before it.
function end_of_last_verse_block(text:string):number {
    let last = -1
    for (const match of text.matchAll(/#vn\(\d+\)/g)) {
        last = match.index
    }
    if (last === -1) {
        return text.length
    }
    const brk = text.indexOf('\n\n', last)
    return brk === -1 ? text.length : brk + 2
}


// Pull a cut position back over any heading line(s) (`==`, `===`, …) that directly precede it,
// so a section heading travels into the row of the verses it introduces rather than being
// stranded at the foot of the previous row (the primary translation keeps its own headings
// attached this way — this makes the forced cut of the second translation match).
function widen_cut_over_headings(text:string, pos:number):number {
    let cut = pos
    while (cut > 0 && text[cut - 1] === '\n') {
        const line_start = text.lastIndexOf('\n', cut - 2) + 1
        if (!/^\s*={1,6}\s+\S/.test(text.slice(line_start, cut - 1))) {
            break
        }
        cut = line_start
    }
    return cut
}


// Cut markup at the given boundary start-verses (ascending), returning one chunk per boundary
// — used to force the second translation's breaks to match the primary's structure. A boundary
// verse missing in this text falls through to the next verse that does exist (its content then
// sits a row early, which still reads fine and never loses text).
export function cut_at_verses(text:string, boundaries:number[]):string[] {
    const offsets = verse_offsets(text)
    const positions:number[] = []
    for (const verse of boundaries.slice(1)) {  // First chunk always starts at 0
        let pos:number|undefined = offsets.get(verse)
        if (pos === undefined) {
            const later = [...offsets.entries()].filter(([v]) => v > verse)
                .sort((x, y) => x[0] - y[0])[0]
            pos = later ? later[1] : end_of_last_verse_block(text)
        }
        positions.push(widen_cut_over_headings(text, pos))
    }
    const chunks:string[] = []
    let start = 0
    for (const pos of [...positions, text.length]) {
        chunks.push(text.slice(start, Math.max(start, pos)))
        start = Math.max(start, pos)
    }
    return chunks
}


// Chunk one chapter of the primary translation at the requested granularity: 'verse' cuts at
// every verse marker, 'paragraph' at every blank-line block that introduces a new verse
// (blocks with no verse of their own — headings, chapter markers — stay attached so every
// chunk starts on a verse). Returns the chunks plus the start-verse boundary of each, for
// cutting the second translation at the same points.
function chapter_rows(
    text:string, align:'verse'|'paragraph',
):{chunks:string[], boundaries:number[]} {

    if (align === 'verse') {
        const offsets = [...verse_offsets(text).entries()].sort((x, y) => x[0] - y[0])
        const chunks:string[] = []
        const boundaries:number[] = []
        let start = 0
        for (let i = 0; i < offsets.length; i++) {
            const [verse, pos] = offsets[i]!
            if (i === 0) {
                // Pre-verse content (headings, superscription) joins the first verse
                boundaries.push(verse)
                continue
            }
            chunks.push(text.slice(start, pos))
            boundaries.push(verse)
            start = pos
        }
        chunks.push(text.slice(start))
        return {chunks, boundaries}
    }

    // Paragraph: group blank-line blocks, starting a new group on each verse-introducing block
    // (a verse-less block — heading, chapter marker — continues the current group)
    const blocks = text.split(/\n{2,}/).filter(block => block.trim().length)
    const groups:string[][] = []
    for (const block of blocks) {
        if (/#vn\(\d+\)/.test(block) || !groups.length) {
            groups.push([block])
        } else {
            groups[groups.length - 1]!.push(block)
        }
    }
    // Leading verse-less groups (chapter marker, headings before the first verse) join the
    // first real group so the opening chunk starts the chapter properly
    while (groups.length > 1 && !/#vn\(\d+\)/.test(groups[0]!.join('\n'))) {
        groups[1] = [...groups[0]!, ...groups[1]!]
        groups.shift()
    }
    const chunks = groups.map(group => group.join('\n\n'))
    const boundaries = chunks.map(chunk => {
        const match = /#vn\((\d+)\)/.exec(chunk)
        return match ? Number(match[1]) : 1
    })
    return {chunks, boundaries}
}


// Build aligned row pairs for a whole passage: [primary chunk, second-translation chunk][].
// Chapters pair by chapter number rather than position (robust when a preview truncation cuts
// the two translations at slightly different points); within a chapter the primary's
// boundaries drive both sides. Chapters the primary lacks are dropped — the primary
// translation defines the document's structure.
export function build_aligned_rows(
    content_a:string, content_b:string, align:'verse'|'paragraph'|'chapter',
):[string, string][] {
    const chapters_b = new Map(split_chapters(content_b).map(ch => [ch.num, ch.text]))
    const rows:[string, string][] = []
    for (const chapter of split_chapters(content_a)) {
        const text_b = chapters_b.get(chapter.num) ?? ''
        if (align === 'chapter') {
            rows.push([chapter.text, text_b])
            continue
        }
        const {chunks, boundaries} = chapter_rows(chapter.text, align)
        const chunks_b = cut_at_verses(text_b, boundaries)
        for (let j = 0; j < chunks.length; j++) {
            rows.push([chunks[j]!, chunks_b[j] ?? ''])
        }
    }
    return rows
}
