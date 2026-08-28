
import {describe, it, expect} from 'vitest'

import {split_chapters, cut_at_verses, build_aligned_rows} from '../src/bilingual.js'


// Two chapters of prose in the primary translation: ch1 has two paragraphs (vv1-2, v3) after
// a heading, ch2 a single paragraph
const CONTENT_A = `#ch(1)

== The Beginning

#vn(1)Alpha one one. #vn(2)Alpha one two.

#vn(3)Alpha one three.

#ch(2)

#vn(1)Alpha two one.`

// Same chapters in the second translation, but with different paragraphing (one block per
// chapter) so its breaks must be forced to match the primary's
const CONTENT_B = `#ch(1)

#vn(1)Beta one one. #vn(2)Beta one two. #vn(3)Beta one three.

#ch(2)

#vn(1)Beta two one.`


describe('split_chapters', () => {

    it('splits on #ch markers and records chapter numbers', () => {
        const chapters = split_chapters(CONTENT_A)
        expect(chapters.map(ch => ch.num)).toEqual([1, 2])
        expect(chapters[0]!.text).toContain('Alpha one three')
        expect(chapters[1]!.text).toContain('Alpha two one')
    })

    it('joins content before the first marker to the first chunk', () => {
        const chapters = split_chapters(`Book intro.\n\n${CONTENT_A}`)
        expect(chapters.map(ch => ch.num)).toEqual([1, 2])
        expect(chapters[0]!.text).toContain('Book intro.')
    })

    it('treats marker-less content as a single chapter-1 chunk', () => {
        const chapters = split_chapters('#vn(1)Just a verse.')
        expect(chapters).toEqual([{num: 1, text: '#vn(1)Just a verse.'}])
    })
})


describe('cut_at_verses', () => {

    it('cuts at boundary start-verses, first chunk from the start', () => {
        const text = '#vn(1)One. #vn(2)Two. #vn(3)Three.'
        const chunks = cut_at_verses(text, [1, 2, 3])
        expect(chunks).toEqual(['#vn(1)One. ', '#vn(2)Two. ', '#vn(3)Three.'])
    })

    it('falls through to the next existing verse when a boundary is missing', () => {
        const text = '#vn(1)One. #vn(3)Three.'
        const chunks = cut_at_verses(text, [1, 2, 3])
        // Verse 2 is absent, so its chunk is empty and verse 3 starts the next chunk
        expect(chunks).toEqual(['#vn(1)One. ', '', '#vn(3)Three.'])
    })

    it('snaps a cut to the line start when it would land inside poetry brackets', () => {
        const text = '#vn(1)Prose line.\n#q(1)[#vn(2)Poetry line]'
        const chunks = cut_at_verses(text, [1, 2])
        // A raw cut at the #vn(2) offset would split `#q(1)[` from its closing bracket
        expect(chunks).toEqual(['#vn(1)Prose line.\n', '#q(1)[#vn(2)Poetry line]'])
    })

    it('carries a section heading into the row of the verse it introduces', () => {
        const text = '#vn(1)One.\n\n== A Section\n#vn(2)Two.'
        const chunks = cut_at_verses(text, [1, 2])
        // The `== A Section` line belongs above verse 2, not stranded at the foot of verse 1
        expect(chunks[0]).toBe('#vn(1)One.\n\n')
        expect(chunks[1]).toBe('== A Section\n#vn(2)Two.')
    })

    it('gives trailing prose to a missing boundary past the last verse, not the row before', () => {
        const text = '#vn(13)Thirteen. #vn(14)Fourteen.\n\nPeace to you.\n\nA closing line.\n\n'
        const chunks = cut_at_verses(text, [13, 15])
        // Verse 15 doesn't exist here (merged away): its row gets the closing prose, while the
        // verse 13-14 row keeps only its own paragraph
        expect(chunks[0]).toBe('#vn(13)Thirteen. #vn(14)Fourteen.\n\n')
        expect(chunks[1]).toBe('Peace to you.\n\nA closing line.\n\n')
    })
})


describe('build_aligned_rows', () => {

    it('paragraph alignment forces the second translation to the primary\'s breaks', () => {
        const rows = build_aligned_rows(CONTENT_A, CONTENT_B, 'paragraph')
        // ch1 = 2 paragraph rows (vv1-2, v3), ch2 = 1
        expect(rows.length).toBe(3)
        expect(rows[0]![0]).toContain('Alpha one two')
        expect(rows[0]![1]).toContain('Beta one two')
        expect(rows[0]![1]).not.toContain('Beta one three')
        expect(rows[1]![0]).toContain('Alpha one three')
        expect(rows[1]![1]).toContain('Beta one three')
    })

    it('verse alignment yields one row per verse', () => {
        const rows = build_aligned_rows(CONTENT_A, CONTENT_B, 'verse')
        expect(rows.length).toBe(4)
        expect(rows[2]![0]).toContain('Alpha one three')
        expect(rows[2]![1]).toContain('Beta one three')
    })

    it('chapter alignment yields one row per chapter', () => {
        const rows = build_aligned_rows(CONTENT_A, CONTENT_B, 'chapter')
        expect(rows.length).toBe(2)
        expect(rows[1]![0]).toContain('Alpha two one')
        expect(rows[1]![1]).toContain('Beta two one')
    })

    it('pairs chapters by number, not position', () => {
        // Second translation missing chapter 1 entirely (e.g. preview truncation)
        const partial_b = '#ch(2)\n\n#vn(1)Beta two one.'
        const rows = build_aligned_rows(CONTENT_A, partial_b, 'chapter')
        expect(rows[0]![1]).toBe('')
        expect(rows[1]![1]).toContain('Beta two one')
    })

    it('keeps headings with the following paragraph row', () => {
        const rows = build_aligned_rows(CONTENT_A, CONTENT_B, 'paragraph')
        expect(rows[0]![0]).toContain('== The Beginning')
    })

    it('handles an empty second translation', () => {
        const rows = build_aligned_rows(CONTENT_A, '', 'paragraph')
        expect(rows.length).toBe(3)
        expect(rows.every(([, b]) => b === '')).toBe(true)
    })

    it('never loses any content on either side', () => {
        for (const align of ['verse', 'paragraph', 'chapter'] as const) {
            const rows = build_aligned_rows(CONTENT_A, CONTENT_B, align)
            const joined_a = rows.map(([a]) => a).join('')
            const joined_b = rows.map(([, b]) => b).join('')
            for (const marker of ['one one', 'one two', 'one three', 'two one']) {
                expect(joined_a).toContain(`Alpha ${marker}`)
                expect(joined_b).toContain(`Beta ${marker}`)
            }
        }
    })
})
