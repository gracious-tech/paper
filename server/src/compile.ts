
import path from 'node:path'
import {tmpdir} from 'node:os'
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises'

import {Timestamp} from 'firebase-admin/firestore'
import {PDFDocument} from 'pdf-lib'
import {PDF_LIFETIME_MS, cover_form_for_render} from 'paper-bible-typst'
import {compile_pdf_from_blueprint} from 'paper-bible-typst-node'
import {generate as generate_cover, build_schema} from 'bookcover-node'

import {admin_db, admin_bucket} from './firebase.ts'
import {config} from './config.ts'
import {shared_content} from './content.ts'
import {save_error, generate_error_id} from './errors.ts'

import type {EmbedFormState} from 'bookcover-node'
import type {Blueprint, CustomFont} from 'paper-bible-typst-node'


// One compile at a time per user (heavy CPU/memory work; anonymous users can trigger this)
const active_uids = new Set<string>()


// Per-uid daily compile cap — deters cost abuse via minted anonymous accounts. Tracked in
// Firestore (compile_quota/{uid}) so it holds across instances, unlike the Set above; the
// path matches no security rule, so clients can't read or reset it
const DAILY_COMPILE_LIMIT = 50


async function compile_quota_allows(uid:string):Promise<boolean>{
    // Count an attempted compile against the caller's daily quota, refusing once over it
    const day = new Date().toISOString().slice(0, 10)
    return await admin_db.runTransaction(async txn => {
        const doc_ref = admin_db.doc(`compile_quota/${uid}`)
        const data = (await txn.get(doc_ref)).data()
        const count = (data?.['day'] === day ? data['count'] as number : 0) + 1
        if (count > DAILY_COMPILE_LIMIT){
            return false
        }
        txn.set(doc_ref, {day, count})
        return true
    })
}


async function render_cover(blueprint:Blueprint, custom_fonts:CustomFont[])
        :Promise<Uint8Array>{
    // Render a frozen blueprint's cover to PDF bytes via the bookcover-node package (Typst
    // CLI + the same mounted fonts tree the book compile uses). The renderable schema is
    // derived from the stored widget form with the blueprint's own size fields overlaid —
    // identical logic to the in-browser path (see cover.ts / cover_worker.ts in the app)
    const cover = blueprint.cover!
    const cover_fonts = custom_fonts.filter(font => cover.font_families.includes(font.family))
    const schema = build_schema(
        cover_form_for_render(cover, blueprint) as unknown as EmbedFormState,
        cover_fonts.map(font => ({family: font.family, style: font.style})))

    // bookcover-node works on disk: it discovers background.<ext> in the input dir and writes
    // the output file (the temp dir is always cleaned up, even on failure)
    const tmp_dir = await mkdtemp(path.join(tmpdir(), 'cover_'))
    try {
        if (cover.bg_image_path){
            const ext = cover.bg_image_path.slice(cover.bg_image_path.lastIndexOf('.'))
            const [bg_bytes] = await admin_bucket.file(cover.bg_image_path).download()
            await writeFile(path.join(tmp_dir, `background${ext}`), bg_bytes)
        }
        const output_path = path.join(tmp_dir, 'cover.pdf')
        await generate_cover({
            schema,
            input_path: tmp_dir,
            output_path,
            format: 'pdf',
            assets_dir: config.assets_dir,
            fonts_dir: config.fonts_dir,
            typst_path: config.typst_path,
            custom_fonts: cover_fonts,
        })
        return new Uint8Array(await readFile(output_path))
    } finally {
        await rm(tmp_dir, {recursive: true, force: true})
    }
}


export async function handle_compile(uid:string, version_id:string, client_ip:string|null)
        :Promise<{status:number, body:Record<string, unknown>}>{
    // Compile a pending version's PDF server-side (fallback for devices whose in-browser
    // compile failed, and regeneration of expired PDFs)

    // Validate the version and the caller's right to it
    const doc_ref = admin_db.doc(`versions/${version_id}`)
    const snap = await doc_ref.get()
    const data = snap.data()
    if (!snap.exists || data === undefined){
        return {status: 404, body: {error: 'unknown_version'}}
    }
    if (data['owner'] !== uid){
        return {status: 403, body: {error: 'not_owner'}}
    }
    if (data['status'] !== 'pending'){
        return {status: 409, body: {error: 'not_pending'}}
    }

    // Storage paths are always derived from the version id, never read from the doc — doc
    // fields are client-written, and trusting them would let a crafted doc make the Admin SDK
    // read/overwrite arbitrary bucket objects
    const pdf_path = `versions/${version_id}/doc.pdf`
    const fonts_prefix = `versions/${version_id}/fonts/`
    const fonts_meta = (data['custom_fonts'] ?? []) as
        {family:string, style:'serif'|'sans', files:string[]}[]
    if (fonts_meta.some(meta => meta.files.some(path => !path.startsWith(fonts_prefix)))){
        return {status: 400, body: {error: 'bad_font_path'}}
    }

    // The cover's snapshotted bg image must sit under the version's own prefix too (its path
    // lives inside the client-written blueprint, so it gets the same distrust as font paths —
    // including its type, since nothing validates the doc's shape server-side)
    const blueprint = data['blueprint'] as Blueprint
    const cover_bg_path = (blueprint.cover?.bg_image_path ?? null) as unknown
    if (cover_bg_path !== null && (typeof cover_bg_path !== 'string'
            || !cover_bg_path.startsWith(`versions/${version_id}/cover/`))){
        return {status: 400, body: {error: 'bad_cover_path'}}
    }

    // Throttle
    if (active_uids.has(uid)){
        return {status: 429, body: {error: 'compile_in_progress'}}
    }
    if (!await compile_quota_allows(uid)){
        return {status: 429, body: {error: 'quota_exceeded'}}
    }
    active_uids.add(uid)

    try {
        // Download the version's snapshotted custom fonts (usually none)
        const custom_fonts:CustomFont[] = await Promise.all(
            fonts_meta.map(
                async meta => ({
                    family: meta.family,
                    style: meta.style,
                    files: await Promise.all(meta.files.map(async path => {
                        return new Uint8Array((await admin_bucket.file(path).download())[0])
                    })),
                })))

        // Compile straight from the frozen blueprint (Bible content comes via the instance-wide
        // shared cache — see content.ts)
        const bytes = await compile_pdf_from_blueprint(blueprint, {
            typst_path: config.typst_path,
            fonts_dir: config.fonts_dir,
            content: shared_content,
            custom_fonts,
        })
        const pages = (await PDFDocument.load(bytes)).getPageCount()

        // Publish the PDF and mark the version available (contentDisposition: 'inline' so the
        // iframe preview displays it rather than triggering a download — the Storage emulator
        // defaults to 'attachment' when it's left unset, unlike production)
        await admin_bucket.file(pdf_path).save(Buffer.from(bytes), {
            contentType: 'application/pdf',
            metadata: {contentDisposition: 'inline'},
        })

        // Render + publish the cover as its own separate PDF when the version has one (a
        // wraparound cover is a different page size and print services take it as its own
        // file). A cover failure fails the whole compile — same error surface as the book
        if (blueprint.cover){
            const cover_bytes = await render_cover(blueprint, custom_fonts)
            await admin_bucket.file(`versions/${version_id}/cover.pdf`).save(
                Buffer.from(cover_bytes),
                {contentType: 'application/pdf', metadata: {contentDisposition: 'inline'}})
        }

        await doc_ref.update({
            status: 'available',
            pages,
            pdf_expires: Timestamp.fromMillis(Date.now() + PDF_LIFETIME_MS),
            error: null,
        })
        return {status: 200, body: {ok: true, pages}}

    } catch (error){
        console.error(error)
        const message = error instanceof Error ? error.message : String(error)

        // Save a report (a document failing to render is critical) and put its id on the doc
        // so the app can offer the user a support link containing it
        const error_id = await save_error({
            id: generate_error_id(),
            source: 'server',
            severity: 'critical',
            message: error instanceof Error ? error.stack ?? error.message : String(error),
            ip: client_ip,
            uid,
            url: '/api/compile',
            user_agent: null,
            language: null,
            runtime_ms: null,
            context: {version_id},
        })
        await doc_ref.update({status: 'failed', error: message, error_id})
            .catch(() => undefined)
        return {status: 500, body: {error: 'compile_failed'}}

    } finally {
        active_uids.delete(uid)
    }
}
