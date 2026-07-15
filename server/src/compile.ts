
import {Timestamp} from 'firebase-admin/firestore'
import {PDFDocument} from 'pdf-lib'
import {compile_pdf_from_blueprint} from 'paper-bible-typst-node'

import {admin_db, admin_bucket} from './firebase.ts'
import {config} from './config.ts'
import {shared_content} from './content.ts'
import {save_error, generate_error_id} from './errors.ts'

import type {Blueprint, CustomFont} from 'paper-bible-typst-node'


// How long generated PDFs are kept before the bucket's lifecycle rule deletes them
// WARN Must match the age in firebase_storage_lifecycle.json
const PDF_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000


// One compile at a time per user (heavy CPU/memory work; anonymous users can trigger this)
const active_uids = new Set<string>()


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

    // Throttle
    if (active_uids.has(uid)){
        return {status: 429, body: {error: 'compile_in_progress'}}
    }
    active_uids.add(uid)

    try {
        // Download the version's snapshotted custom fonts (usually none)
        const custom_fonts:CustomFont[] = await Promise.all(
            ((data['custom_fonts'] ?? []) as
                    {family:string, style:'serif'|'sans', files:string[]}[]).map(
                async meta => ({
                    family: meta.family,
                    style: meta.style,
                    files: await Promise.all(meta.files.map(async path => {
                        return new Uint8Array((await admin_bucket.file(path).download())[0])
                    })),
                })))

        // Compile straight from the frozen blueprint (Bible content comes via the instance-wide
        // shared cache — see content.ts)
        const bytes = await compile_pdf_from_blueprint(data['blueprint'] as Blueprint, {
            typst_path: config.typst_path,
            fonts_dir: config.fonts_dir,
            content: shared_content,
            custom_fonts,
        })
        const pages = (await PDFDocument.load(bytes)).getPageCount()

        // Publish the PDF and mark the version available
        await admin_bucket.file(data['pdf_path'] as string).save(Buffer.from(bytes), {
            contentType: 'application/pdf',
        })
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
