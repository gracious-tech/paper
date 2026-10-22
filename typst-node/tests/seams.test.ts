
import {execFile} from 'node:child_process'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {promisify} from 'node:util'

import {describe, it, expect} from 'vitest'
import {PDFDocument} from 'pdf-lib'
import {PassageReference} from '@gracious.tech/fetch-client'
import {escape_typst} from 'typst-utils'
import {gen_copyright_typst, prose_to_typst, replace_copyright_marker} from 'paper-bible-typst'

import {compile_pdf, generate_typst} from '../src/index.js'
// Internals the package doesn't export, reached from source since only a real compile tests them
import {emphasize_sentences} from '../../typst/src/helpers.js'
import {inject_study_notes} from '../../typst/src/content_notes.js'
import {make_blueprint} from '../../typst/tests/fixtures.js'

import type {GetResourcesItem} from '@gracious.tech/fetch-client'
import type {PmDoc, TypstRequest} from 'paper-bible-typst'


// Text a user could type straight after something we emit as an embedded `#...` expression.
// Each would continue an unterminated expression — call arguments, a trailing content argument,
// a field access — or, for `;`, be swallowed as its terminator. The `Q` marks each one's end, so
// a swallowed `;` shows as a lone `Q`
const FOLLOWERS = ['(a)Q', '[b]Q', '.xQ', ';Q']


// The label each probe's block carries, so its text can be queried out of the compiled document
const PROBE = 'pb-seam'


// A paragraph node holding the given inline nodes
function para(content:PmDoc[], attrs?:Record<string, unknown>):PmDoc {
    return {type: 'paragraph', ...attrs && {attrs}, content}
}


// A document of the given blocks
function doc(...content:PmDoc[]):PmDoc {
    return {type: 'doc', content}
}


// A plain text node
function text(value:string, marks?:string[]):PmDoc {
    return {type: 'text', text: value, ...marks && {marks: marks.map(type => ({type}))}}
}


// The minimal resource metadata gen_copyright_typst reads
const RESOURCES = {eng_bsb: {
    id: 'eng_bsb',
    language: 'eng',
    name_local: 'Berean Standard Bible',
    name_english: 'Berean Standard Bible',
    attribution: 'BSB Committee',
    licenses: [{id: 'cc0', name: 'CC0', url: 'https://example.org/license', restrictions: {
        forbid_attributionless: false, forbid_commercial: false, forbid_derivatives: false,
        forbid_limitless: false, forbid_other: false,
    }}],
} as unknown as GetResourcesItem}


// Each emitter, given the (escaped, where the real path escapes it) text to follow it
const EMITTERS:Record<string, (follower:string) => string> = {
    // pm-to-typst's own marks, followed by more text in the same paragraph
    'pm-to-typst underline': f => prose_to_typst(doc(para([text('u', ['underline']), text(f)]))),
    'pm-to-typst inline code': f => prose_to_typst(doc(para([text('c', ['code']), text(f)]))),
    // The copyright block, spliced in where the marker sat mid-text
    'copyright block': f => replace_copyright_marker(
        prose_to_typst(doc(para([text(`AUTO-COPYRIGHT${f}`)]))),
        gen_copyright_typst(make_blueprint(), RESOURCES)),
    // prose.ts's own wrappers, with text placed straight after them
    'paragraph direction scope': f =>
        prose_to_typst(doc(para([text('Intro')]), para([text('مقدمة')]))) + escape_typst(f),
    'document direction scope': f => prose_to_typst(doc(para([text('مقدمة')]))) + escape_typst(f),
    'RTL left alignment': f =>
        prose_to_typst(doc(para([text('עברית')], {textAlign: 'left'})), false, 'rtl')
            + escape_typst(f),
    'blank line': f => prose_to_typst(doc(para([text('x')]), para([])), true) + escape_typst(f),
    // A picture-story sentence emphasized up to its closing quote, the next one starting there
    'emphasized sentence': f => emphasize_sentences(`“Come!”${f}`, null),
    // A study note, with text after it
    'study note': f => inject_study_notes('#vn(1)Verse one.', {
        notes_id: 'eng_tyndale', book: 'gen', verses: {'1': {'1': 'Note'}}, ranges: [],
    }, new PassageReference({book: 'gen', start_chapter: 1, start_verse: 1, end_chapter: 1,
        end_verse: 1})) + escape_typst(f),
}


// Every probe: each emitter followed by each follower, in its own labelled block
const PROBES = Object.entries(EMITTERS).flatMap(([name, emit]) =>
    FOLLOWERS.map(follower => ({name, follower, markup: emit(follower)})))


// A request whose one custom page holds every probe
function make_request():TypstRequest {
    const content = PROBES.map(probe => `#block[${probe.markup}\n] <${PROBE}>`).join('\n\n')
    return {
        title: 'Seams',
        page: {width: '148mm', height: '210mm', margin_top: '15mm', margin_bottom: '15mm',
            margin_left: '15mm', margin_right: '15mm'},
        typography: {font_text: 'serif', font_text2: 'serif', font_fallbacks: [],
            font_fallbacks2: [], font_size: '10pt', footnote_size: '8.5pt', lang: 'en',
            lang2: null, dir: 'ltr', dir2: null, notes_lang: null, notes_dir: null,
            line_height: 1.5, justify: true, hyphenate: true, poetry_outdent: true,
            text_color: null, font_headings: 'serif', font_headings2: 'serif'},
        titlepage: {font: 'serif', frame_svg: null, color_text: '#333333',
            color_frame: '#666666', text_size: 1, icon_size: 1, always: null, blank_back: false},
        features: {show_chapters: false, show_chapters_style: 'divider', show_verses: true,
            show_wj: false, show_wj_color: null, show_wj_bold: false, show_wj_italic: false},
        content: [{type: 'custom', content, position: 'top'}],
    } as TypstRequest
}


// Collect the printed text of a queried element, in document order (spaces as ' '). An escaped
// character (`\[`) comes back as a symbol rather than text
function collect_text(value:unknown):string {
    if (Array.isArray(value)) {
        return value.map(collect_text).join('')
    }
    if (!value || typeof value !== 'object') {
        return ''
    }
    const element = value as Record<string, unknown>
    if ((element['func'] === 'text' || element['func'] === 'symbol')
            && typeof element['text'] === 'string') {
        return element['text']
    }
    if (element['func'] === 'space') {
        return ' '
    }
    return Object.values(element).map(collect_text).join('')
}


describe('embedded expressions followed by text', () => {

    it('compiles with `(`, `[`, `.ident` or `;` straight after each one', async () => {
        const doc = await PDFDocument.load(await compile_pdf(make_request()))
        expect(doc.getPageCount()).toBeGreaterThan(0)
    }, 30000)

    it('prints the text after each one, `;` included', async () => {
        // Query the compiled document for each probe's text
        const dir = await mkdtemp(join(tmpdir(), 'seams-'))
        let elements:unknown[]
        try {
            const input = join(dir, 'input.typ')
            await writeFile(input, generate_typst(make_request()), 'utf-8')
            const {stdout} = await promisify(execFile)('typst', ['query', input, `<${PROBE}>`],
                {maxBuffer: 64 * 1024 * 1024})
            elements = JSON.parse(stdout) as unknown[]
        } finally {
            await rm(dir, {recursive: true, force: true})
        }

        // Each probe's printed text ends with its follower, verbatim
        expect(elements).toHaveLength(PROBES.length)
        PROBES.forEach((probe, i) => {
            expect(collect_text(elements[i]).trimEnd(), `${probe.name}: ${probe.follower}`)
                .toMatch(new RegExp(`${probe.follower.replace(/[.()[\]]/g, '\\$&')}$`))
        })
    }, 30000)
})
