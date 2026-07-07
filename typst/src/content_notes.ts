
import {PassageReference} from '@gracious.tech/fetch-client'

import type {TypstNotesFile} from './types.js'


// Bold "chapter:verse" (or "chapter:verse-verse" / "chapter:verse-chapter:verse" for a range)
// reference label prefixed to a note's body, so readers can tell which verse(s) it covers
function gen_note_label(
    book:string, start_chapter:number, start_verse:number, end_chapter:number, end_verse:number,
):string {
    const verses_string = new PassageReference({
        book, start_chapter, start_verse, end_chapter, end_verse,
    }).get_verses_string()
    return `#strong[${verses_string}]`
}


// Splice study notes into a passage's pre-rendered Typst content string, each inserted
// immediately after the `#vn(n)` segment of the verse it refers to (as a `#studynote[...]` call,
// which renders as a footnote with a hidden mark — see `studynote` in preamble.ts)
export function inject_study_notes(
    content:string, notes:TypstNotesFile, ref:PassageReference,
):string {

    // Build an ordered map of chapter:verse -> note bodies (each prefixed with its bold reference
    // label) to insert there. Range notes are queued first so they always precede a
    // specific-verse note at the same key
    const insertions = new Map<string, string[]>()
    const queue = (chapter:number, verse:number, body:string) => {
        const key = `${chapter}:${verse}`
        const existing = insertions.get(key)
        if (existing) {
            existing.push(body)
        } else {
            insertions.set(key, [body])
        }
    }
    for (const range of notes.ranges) {
        if (ref.includes(range.start_chapter, range.start_verse)) {
            const label = gen_note_label(
                ref.book, range.start_chapter, range.start_verse,
                range.end_chapter, range.end_verse,
            )
            queue(range.start_chapter, range.start_verse, `${label} ${range.contents}`)
        }
    }
    for (const [chapter_str, verses] of Object.entries(notes.verses)) {
        const chapter = Number(chapter_str)
        for (const [verse_str, body] of Object.entries(verses)) {
            const verse = Number(verse_str)
            if (ref.includes(chapter, verse)) {
                const label = gen_note_label(ref.book, chapter, verse, chapter, verse)
                queue(chapter, verse, `${label} ${body}`)
            }
        }
    }
    if (!insertions.size) {
        return content
    }

    // Walk every `#ch(n)`/`#vn(n)` marker in order, tracking the current chapter, and append any
    // queued note(s) right after the segment for the verse they belong to. Every matched segment
    // (both chapter and verse markers) is always emitted verbatim — chapter markers must not be
    // dropped, since they're also what carries section headings in the fetched content
    const matches = Array.from(content.matchAll(/#(ch|vn)\((\d+)\)/g))
    let out = content.slice(0, matches[0]?.index ?? content.length)
    let current_chapter = ref.start_chapter
    for (let i = 0; i < matches.length; i++) {
        const m = matches[i]!
        const segment = content.slice(m.index, matches[i + 1]?.index ?? content.length)
        out += segment
        if (m[1] === 'ch') {
            current_chapter = Number(m[2])
        } else {
            const notes_for_verse = insertions.get(`${current_chapter}:${m[2]}`)
            if (notes_for_verse) {
                out += notes_for_verse.map(body => `#studynote[${body}]`).join('')
            }
        }
    }
    return out
}
