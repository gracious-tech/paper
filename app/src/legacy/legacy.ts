
// Access to data created by the PREVIOUS version of Paper Bible (pre-Firebase)
//
// The old app kept everything in an IndexedDB database on the client and rendered PDFs into an
// AWS S3 bucket. None of that is migrated into the new app, so this module exists purely to let
// returning users retrieve what they had before the rebuild.
//
// WARN This whole directory is TEMPORARY and is meant to be deleted outright after a transition
//      period. It intentionally sits outside comp/services (breaking those conventions) and
//      duplicates the old types rather than importing anything, so that removal is just
//      `rm -r app/src/legacy/` plus the four marked lines in AppRoot.vue. Strings are hardcoded
//      in English for the same reason (no i18n catalog entries to unpick later).

import {reactive} from 'vue'

import {book_names_english} from '@gracious.tech/bible-references'


// Where the old app's PDFs still live (bucket name and region from the old SAM stack config)
const OLD_BUCKET = 'paper-bible-prod'
const OLD_REGION = 'us-west-2'

// The old app's IndexedDB database and its two object stores
const OLD_DATABASE = 'paper_bible'
const OLD_STORE_CREATIONS = 'creations'
const OLD_STORE_CONFIG = 'config'


// Copies of the old app's types (see the `main` branch's app/src/services/types.ts)
// WARN Deliberately duplicated, not imported — the current types have since diverged

export interface OldContentTitle {
    type:'title'
    id:string
    title:string
    subtitle:string
    icon:string|null
    pattern:string
    color_primary:string
    color_secondary:string
    alone:boolean
}

export interface OldContentPassage {
    type:'passage'
    id:string
    book:string
    start_chapter:number|null
    start_verse:number|null
    end_chapter:number|null
    end_verse:number|null
    title:boolean
}

export interface OldContentCustom {
    type:'custom'
    id:string
    name:string
    html:string
    position:'top'|'middle'|'bottom'
}

export type OldContentItem = OldContentTitle|OldContentPassage|OldContentCustom

export interface OldBlueprint {
    title:string
    paper_unit:'mm'|'in'
    paper_width:number
    paper_height:number
    page_arrangement:'normal'|'book'|'booklet'
    content:OldContentItem[]
    bibles:string[]
    bibles_layout:'alternate'|'columns'
    show_headings:boolean
    show_chapters:boolean
    show_chapters_style:'divider'|'float'|'heading'
    show_verses:boolean
    show_pages:boolean
    show_footnotes:boolean
    show_woj:boolean
    show_lines:boolean
    notes:string|null
    crossref:'small'|'medium'|'large'|null
    half_blank:boolean
    font_family:string
    font_size:number
    line_height:number
    justify:null|boolean
    columns:null|boolean
    margin_unit:'mm'|'in'
    margin_top:number
    margin_bottom:number
    margin_left:number
    margin_right:number
    margin_swap:boolean
    column_gap:number
    license:string
    license_attribution:string
    app_link:boolean
}

export interface OldCreation {
    request_id:string
    creation_id:string|null
    created:Date
    blueprint:OldBlueprint
    status:'pending'|'failed'|'available'|'expired'
    pages:number|null
}


// A single row in the dialog — either a saved creation or the draft the user was last editing
export interface LegacyItem {
    id:string
    is_draft:boolean
    title:string
    created:Date|null
    pages:number|null
    pdf_url:string|null
    blueprint:OldBlueprint
}


// State for the "Old version" button and dialog (kept here so services/state.ts stays untouched)
export const legacy = reactive({
    available: false,
    open: false,
    items: [] as LegacyItem[],
})


// Promisify an IndexedDB request
function idb_result<T>(request:IDBRequest<T>):Promise<T>{
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
    })
}


// Open the old database WITHOUT a version, so no upgrade handler can ever fire and mutate it
function open_old_database():Promise<IDBDatabase>{
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(OLD_DATABASE)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error("Could not open old database"))
        request.onblocked = () => reject(new Error("Old database blocked"))
    })
}


// Public url for an old creation's PDF (objects are public-read and stored with an inline
// content-disposition naming them after the user's own title, so a plain link is enough)
function old_pdf_url(creation_id:string):string{
    return `https://${OLD_BUCKET}.s3.${OLD_REGION}.amazonaws.com/creations/${creation_id}.pdf`
}


// Load everything from the old database, revealing the "Old version" button if anything is found
export async function probe_legacy_data():Promise<void>{

    let db:IDBDatabase
    try {
        db = await open_old_database()
    } catch {
        return  // IndexedDB is unavailable in some private tabs and webviews — just stay hidden
    }

    // Opening a database that doesn't exist creates an empty one, so remove it again rather
    // than leaving junk behind for users who never used the old version
    if (!db.objectStoreNames.contains(OLD_STORE_CREATIONS)){
        db.close()
        indexedDB.deleteDatabase(OLD_DATABASE)
        return
    }

    // Read both stores in a single read-only transaction
    let creations:OldCreation[] = []
    let draft:OldBlueprint|null = null
    try {
        const transaction = db.transaction([OLD_STORE_CREATIONS, OLD_STORE_CONFIG], 'readonly')
        creations = await idb_result(
            transaction.objectStore(OLD_STORE_CREATIONS).getAll() as IDBRequest<OldCreation[]>)
        const draft_record = await idb_result(transaction.objectStore(OLD_STORE_CONFIG)
            .get('draft') as IDBRequest<{key:string, value:OldBlueprint}|undefined>)
        draft = draft_record?.value ?? null
    } catch {
        db.close()
        return  // Unreadable (corrupt or a store missing) — nothing to offer
    }
    db.close()

    // Creations, newest first
    const items:LegacyItem[] = creations
        .filter(creation => !!creation.blueprint)
        .sort((a, b) => (b.created?.getTime() ?? 0) - (a.created?.getTime() ?? 0))
        .map(creation => ({
            id: creation.request_id,
            is_draft: false,
            title: creation.blueprint.title?.trim() || "Untitled",
            created: creation.created instanceof Date ? creation.created : null,
            pages: creation.pages,
            pdf_url: creation.creation_id ? old_pdf_url(creation.creation_id) : null,
            blueprint: creation.blueprint,
        }))

    // The draft goes first — it's what the user was working on when the upgrade landed, and is
    // the one thing that never made it to a PDF at all
    if (draft?.content){
        items.unshift({
            id: 'draft',
            is_draft: true,
            title: draft.title?.trim() || "Unsaved draft",
            created: null,
            pages: null,
            pdf_url: null,
            blueprint: draft,
        })
    }

    legacy.items = items
    legacy.available = items.length > 0
}


// Escape text for inclusion in the exported HTML
function escape_html(value:string):string{
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}


// Format one end of a passage range (chapter, or chapter:verse)
function format_ref(chapter:number|null, verse:number|null):string{
    if (chapter === null){
        return ''
    }
    return verse === null ? `${chapter}` : `${chapter}:${verse}`
}


// Describe a passage in readable form, e.g. "Genesis 1:1 – 3:24"
function format_passage(item:OldContentPassage):string{
    const name = book_names_english[item.book] ?? item.book.toUpperCase()
    const start = format_ref(item.start_chapter, item.start_verse)
    const end = format_ref(item.end_chapter, item.end_verse)
    if (!start && !end){
        return `${name} (whole book)`
    }
    if (!end || end === start){
        return `${name} ${start}`
    }
    return `${name} ${start} – ${end}`
}


// Render one content item as a section of the exported HTML
function render_item(item:OldContentItem):string{

    // Title pages — the wording only; the pattern/colors/icon are styling, not content
    if (item.type === 'title'){
        return `
            <section>
                <p class="kind">Title page</p>
                <h2>${escape_html(item.title)}</h2>
                ${item.subtitle ? `<h3>${escape_html(item.subtitle)}</h3>` : ''}
            </section>
        `
    }

    // Bible passages — the reference is all there is to recover (the text itself is still
    // available in the new app)
    if (item.type === 'passage'){
        return `
            <section>
                <p class="kind">Bible passage</p>
                <h2>${escape_html(format_passage(item))}</h2>
            </section>
        `
    }

    // Custom pages — the user's own text, and the whole reason this export exists.
    // The old app swapped AUTO-COPYRIGHT for a generated copyright block at render time, so
    // note what it stood for rather than leaving the bare placeholder in the export
    const html = item.html.replace(/AUTO-COPYRIGHT/g,
        '<em>[copyright and license details were inserted here automatically]</em>')
    return `
        <section>
            <p class="kind">Custom text</p>
            <h2>${escape_html(item.name)}</h2>
            <div class="custom">${html}</div>
        </section>
    `
}


// Build a self-contained HTML document holding everything recoverable from an old item
export function build_legacy_html(item:LegacyItem):string{

    // Note when it was made and how long it was
    const meta:string[] = []
    if (item.created){
        meta.push(`Created ${item.created.toLocaleString()}`)
    }
    if (item.pages){
        meta.push(`${item.pages} pages`)
    }
    if (item.is_draft){
        meta.push("Unsaved draft (was never made into a PDF)")
    }

    const pages = (item.blueprint.content ?? []).map(render_item).join('\n')

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape_html(item.title)}</title>
<style>
body {font-family: Georgia, serif; line-height: 1.5; max-width: 40em; margin: 3em auto;
    padding: 0 1.5em; color: #222}
h1 {margin-bottom: 0.2em}
h2 {font-size: 1.2em; margin: 0.2em 0}
h3 {font-size: 1em; font-weight: normal; font-style: italic; margin: 0.2em 0; color: #555}
section {border-top: 1px solid #ddd; padding: 1.5em 0}
.kind, .detail, .meta {font-family: sans-serif; font-size: 0.8em; color: #777; margin: 0.3em 0}
.kind {font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.08em; color: #999}
.custom {margin-top: 1em}
footer {border-top: 1px solid #ddd; padding-top: 1.5em; margin-top: 2em; font-family: sans-serif;
    font-size: 0.8em; color: #777}
</style>
</head>
<body>

<h1>${escape_html(item.title)}</h1>
${meta.length ? `<p class="meta">${escape_html(meta.join(' — '))}</p>` : ''}

${pages || '<p class="detail">This document had no content.</p>'}

<footer>Saved from the previous version of paper.bible</footer>

</body>
</html>
`
}


// Save an item's content as an HTML file
export function download_legacy_html(item:LegacyItem):void{

    // Hand the browser a blob url via a transient anchor (as download_version_pdf() does)
    const blob = new Blob([build_legacy_html(item)], {type: 'text/html'})
    const blob_url = URL.createObjectURL(blob)
    const base = item.title.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'bible'
    const anchor = document.createElement('a')
    anchor.href = blob_url
    anchor.download = `${base} (old paper.bible).html`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()

    // Give the browser a beat to start the download before releasing the blob
    setTimeout(() => URL.revokeObjectURL(blob_url), 10000)
}

