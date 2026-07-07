
import {describe, it, expect} from 'vitest'
import {PassageReference} from '@gracious.tech/fetch-client'

import {inject_study_notes} from '../src/content_notes.js'

import type {TypstNotesFile} from '../src/types.js'


// Shared reference covering Genesis 1:1 through 2:3 (spans a chapter boundary)
const ref = new PassageReference({
    book: 'gen', start_chapter: 1, start_verse: 1, end_chapter: 2, end_verse: 3,
})


// Minimal notes file builder
function make_notes(overrides:Partial<TypstNotesFile> = {}):TypstNotesFile {
    return {
        notes_id: 'eng_tyndale',
        book: 'gen',
        verses: {},
        ranges: [],
        ...overrides,
    }
}


describe('inject_study_notes', () => {

    it('inserts a single-verse note right after its #vn segment, labelled in bold', () => {
        const content = '#ch(1)\n#vn(1)In the beginning God created the heavens and the earth.'
            + '\n\n#vn(2)Now the earth was formless and empty.'
        const notes = make_notes({verses: {'1': {'1': 'Note on verse 1'}}})
        const result = inject_study_notes(content, notes, ref)
        expect(result).toBe(
            '#ch(1)\n#vn(1)In the beginning God created the heavens and the earth.\n\n'
            + '#studynote[#strong[1:1] Note on verse 1]'
            + '#vn(2)Now the earth was formless and empty.',
        )
    })

    it('labels a same-chapter range note as "chapter:verse-verse"', () => {
        const content = '#ch(1)\n#vn(1)Verse one.\n\n#vn(2)Verse two.\n\n#vn(3)Verse three.'
        const notes = make_notes({
            ranges: [{start_chapter: 1, start_verse: 1, end_chapter: 1, end_verse: 3,
                contents: 'Covers three verses'}],
        })
        const result = inject_study_notes(content, notes, ref)
        expect(result).toContain('#studynote[#strong[1:1-3] Covers three verses]')
    })

    it('labels a cross-chapter range note as "chapter:verse-chapter:verse"', () => {
        const content = '#ch(1)\n#vn(1)Verse one.'
        const notes = make_notes({
            ranges: [{start_chapter: 1, start_verse: 1, end_chapter: 2, end_verse: 3,
                contents: 'Spans chapters'}],
        })
        const result = inject_study_notes(content, notes, ref)
        expect(result).toContain('#studynote[#strong[1:1-2:3] Spans chapters]')
    })

    it('places a range note before a specific-verse note at the same verse', () => {
        const content = '#ch(1)\n#vn(1)In the beginning God created the heavens and the earth.'
        const notes = make_notes({
            verses: {'1': {'1': 'Specific note'}},
            ranges: [{start_chapter: 1, start_verse: 1, end_chapter: 2, end_verse: 3,
                contents: 'Range note'}],
        })
        const result = inject_study_notes(content, notes, ref)
        const range_pos = result.indexOf('Range note')
        const specific_pos = result.indexOf('Specific note')
        expect(range_pos).toBeGreaterThan(-1)
        expect(specific_pos).toBeGreaterThan(-1)
        expect(range_pos).toBeLessThan(specific_pos)
    })

    it('tracks chapter via #ch so repeated verse numbers across chapters disambiguate', () => {
        const content = '#ch(1)\n#vn(1)Chapter one verse one.'
            + '\n\n#ch(2)\n#vn(1)Chapter two verse one.'
        const notes = make_notes({verses: {
            '1': {'1': 'Note for 1:1'},
            '2': {'1': 'Note for 2:1'},
        }})
        const result = inject_study_notes(content, notes, ref)
        // Note for 1:1 appears right after chapter one's verse 1, before chapter 2 starts
        const ch2_pos = result.indexOf('#ch(2)')
        const note_1_1_pos = result.indexOf('Note for 1:1')
        const note_2_1_pos = result.indexOf('Note for 2:1')
        expect(note_1_1_pos).toBeGreaterThan(-1)
        expect(note_1_1_pos).toBeLessThan(ch2_pos)
        expect(note_2_1_pos).toBeGreaterThan(ch2_pos)
        // The chapter-2 note is labelled 2:1, not 1:1, confirming chapter tracking (not just verse)
        expect(result).toContain('#studynote[#strong[2:1] Note for 2:1]')
    })

    it('passes through unchanged when a verse has no matching note', () => {
        const content = '#ch(1)\n#vn(1)In the beginning God created the heavens and the earth.'
        const notes = make_notes()
        const result = inject_study_notes(content, notes, ref)
        expect(result).toBe(content)
    })

    it('preserves a #ch marker and heading text before the first #vn', () => {
        const content = '#ch(1)\n== A Section Heading\n#vn(1)Verse one text.'
        const notes = make_notes({verses: {'1': {'1': 'Note'}}})
        const result = inject_study_notes(content, notes, ref)
        expect(result).toBe(
            '#ch(1)\n== A Section Heading\n#vn(1)Verse one text.#studynote[#strong[1:1] Note]',
        )
    })
})
