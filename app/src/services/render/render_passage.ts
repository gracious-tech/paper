
import {blue, books_meta, translation_forbids_derivatives} from '@/services/state'
import {ContentPassage} from '@/services/types'
import {gen_content_name} from '@/services/blueprints'
import {content} from '@/services/content'


// Books that have a substantial amount of poetry (not just a stanza here and there)
const lots_of_poetry = [
    'job',  // Job
    'psa',  // Psalms
    'pro',  // Proverbs
    'ecc',  // Ecclesiastes
    'sng',  // Song of Songs
    'isa',  // Isaiah
    'jer',  // Jeremiah
    'lam',  // Lamentations
    'ezk',  // Ezekiel
    // 'dan',  Daniel       (some stanzas but still part of the narrative)
    'hos',  // Hosea
    'jol',  // Joel
    'amo',  // Amos
    'oba',  // Obadiah
    // 'jon',  Jonah        (just one prayer)
    'mic',  // Micah
    'nam',  // Nahum
    'hab',  // Habakkuk
    'zep',  // Zephaniah
    'hag',  // Haggai
    'zec',  // Zechariah
    // 'mal',  Malachi      (dialogue, not stanzas)
]


// Books that almost always have to printed in columns due to size and poetry line breaks
const large_poetry = ['job', 'psa', 'pro', 'isa', 'jer', 'ezk']


// Generate HTML for a passage
export function gen_passage_html(passage:ContentPassage, bible_i:number):string{

    // Can't get if translation doesn't have requested book
    const bible = blue.bibles[bible_i]!
    if (!books_meta.value[bible]?.[passage.book]?.available){
        return ""
    }

    // Determine classes
    const fetch_bible_classes = Object.entries({
        // Official classes
        'no-headings': !blue.show_headings,
        'no-chapters': !blue.show_chapters,
        'no-verses': !blue.show_verses,
        'no-notes': !blue.show_footnotes,
        'no-red-letter': !blue.show_woj,
        'no-initial-indent': lots_of_poetry.includes(passage.book),
        // Custom classes
        'columns': (blue.columns ?? large_poetry.includes(passage.book))
            && (blue.bibles.length < 2 || blue.bibles_layout !== 'columns'),
        [`chapters-${blue.show_chapters_style}`]: blue.show_chapters,
        [`book-${passage.book}`]: true,
    }).filter(([clas, active]) => active).map(([clas, active]) => clas).join(' ')

    // Auto-include title if desired
    let title = passage.title ? gen_content_name(passage) : ''

    // Util for inserting notes before verse markers, if enabled and is primary translation
    function insert_notes(html:string){
        if (!blue.notes || translation_forbids_derivatives.value || bible_i !== 0
                || !content.notes[passage.book]){
            return html
        }
        return html.replace(/<sup data-v="(\d):(\d)">/g, (match, c, v) => {
            if (content.notes[passage.book]![c]?.[v]){
                return '<div class="study">'
                    + `<strong>${c}:${v}</strong> `
                    + content.notes[passage.book]![c]![v]
                    + '</div>' + match
            }
            return match
        })
    }

    // Fetch passage contents
    const html_inst = content.books_html[`${bible}_${passage.book}`]
    let passage_content = ''
    if (html_inst){

        if (blue.bibles.length === 1 || blue.bibles_layout === 'alternate'){
            // Only rendering one translation per subjob
            passage_content = html_inst.get_passage_from_obj(passage, {attribute: false})
            passage_content = insert_notes(passage_content)
        } else {
            // Rendering multiple translations in the one subjob
            const get_list_args = [
                passage.chapter_start ?? 1,
                passage.verse_start ?? 1,
                passage.chapter_end ?? undefined,
                passage.verse_end ?? undefined,
            ]
            const bible1 = html_inst.get_list(...get_list_args)
            const bible2_inst = content.books_html[`${blue.bibles[1]}_${passage.book}`]
            const bible2 = bible2_inst?.get_list(...get_list_args)
            passage_content = '<table>'
            for (let i = 0; i < bible1.length; i++){
                passage_content += `<tr>
                    <td>${insert_notes(bible1[i]!.content)}</td>
                    <td>${bible2?.[i]?.content ?? ''}</td>
                </tr>`
            }
            passage_content += '</table>'
        }
    }

    return `
        <div class='fetch-bible fb-plain ${fetch_bible_classes}'>
            <h2 class='passage-title'>${title}</h2>
            ${passage_content}
        </div>
    `
}


export function gen_passage_css(){
    return `
        .passage-title {
            margin-top: 0;
            text-align: center;
        }

        table {
            table-layout: fixed;
            border-spacing: ${blue.column_gap}${blue.margin_unit} 0;
            text-align: ${blue.justify === true ? 'justify' : 'start'};
        }

        table td {
            vertical-align: top;
            width: 50%;
        }

        table td p {
            text-indent: 0;  /* Every verse a new para so indenting start has no value */
        }

        .columns {
            column-count: 2;
            column-gap: ${blue.column_gap}${blue.margin_unit};
            text-align: ${blue.justify === true ? 'justify' : 'start'};
        }

        .book-psa .fb-chapter {
            break-inside: avoid;
        }

        .study, .fb-note {
            font-size: 0.8em;
            line-height: 1.2;
            text-indent: 0;
        }

        .chapters-divider h3[data-c] {
            text-align: center;
            font-size: 0.8em;
            font-weight: normal;
            font-family: Arial, sans-serif;  /* Arial has no visible space between --- */
            margin: 1em 0;
            line-height: 1;
        }
        .chapters-divider h3[data-c="1"] {
            display: none;
        }
        .chapters-divider h3[data-c="1"] + * {
            margin-top: 0;
        }
        .chapters-divider h3[data-c]::before {
            content: '——— ';
        }
        .chapters-divider h3[data-c]::after {
            content: ' ———';
        }

        .chapters-float h3[data-c] {
            /* WARN: Actually floating caused layout issues in WeasyPrint v60.0 */
            position: absolute;
            margin-left: -0.75em;
            margin-top: 0.6em;
            font-size: 2em;
            font-weight: bold;
            line-height: 1;
        }

        .chapters-heading h3[data-c] {
            margin-bottom: 0.25em;
        }

        .chapters-heading h3[data-c]::before {
            content: "Chapter ";
        }

        h4 {
            font-size: 0.9em;
            font-style: italic;
        }

        sup[data-v] {
            font-size: 0.7em;
            margin-right: 0.2em;
            font-weight: bold;
            color: #0008;
        }

        /* Hide number of psalms but not divider since it is biblical */
        .fetch-bible.no-chapters .book-psa h3[data-c]:not([data-c="1"]) {
            display: block !important;
            color: transparent;
            text-align: start;
        }
        .fetch-bible.no-chapters .book-psa h3[data-c]::before {
            color: #0006;
        }

        .fb-book-psa .fb-b {
            margin-top: 0.5em;
        }

        .fb-s1 {
            margin-bottom: 0;
        }

        .fb-q1, .fb-q2, .fb-q3, .fb-q4, .fb-pmo, .fb-pm, .fb-pmc {
            text-indent: 0 !important;
        }

        /* Styles that may cause issues with screen display */
        @media print {
            .fb-note, .study {
                float: footnote;
            }

            .fb-note > span {
                display: inline-block !important;
            }

            /* Don't show any footnote markers and rely on verse references instead */
            ::footnote-call {
                content: '';
            }
            ::footnote-marker {
                content: '';
            }
        }
    `
}
