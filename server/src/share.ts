
import {randomBytes} from 'node:crypto'

import {FieldValue, Timestamp} from 'firebase-admin/firestore'

import {admin_db, admin_bucket} from './firebase.ts'


// How long copied PDFs live (fresh copy = fresh object = fresh lifecycle year)
// WARN Must match the age in firebase_storage_lifecycle.json
const PDF_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000


interface HandlerResult {
    status:number
    body:Record<string, unknown>
}


function tokens_match(doc_token:unknown, given:string):boolean{
    // Whether a share token from a doc is enabled and matches the presented one
    return typeof doc_token === 'string' && doc_token.length > 0 && doc_token === given
}


export async function handle_redeem_draft(uid:string, draft_id:string, token:string)
        :Promise<HandlerResult>{
    // Add the caller as an editor of a draft after validating its share token
    const doc_ref = admin_db.doc(`drafts/${draft_id}`)
    const snap = await doc_ref.get()
    const data = snap.data()
    if (!snap.exists || data === undefined || !tokens_match(data['share_token'], token)){
        // Same response whether missing or bad token (don't leak which)
        return {status: 404, body: {error: 'unknown_share'}}
    }
    if (!(data['editor_uids'] as string[]).includes(uid)){
        await doc_ref.update({
            editor_uids: FieldValue.arrayUnion(uid),
            [`editors.${uid}`]: {joined: Timestamp.now()},
        })
    }
    return {status: 200, body: {ok: true}}
}


export async function handle_copy_creation(uid:string, creation_id:string)
        :Promise<HandlerResult>{
    // "Keep own copy": duplicate a shared creation (metadata + PDF + font snapshots) under the
    // caller, so it survives the original owner deleting theirs. Creations are publicly
    // readable by id (see firestore.rules) so no capability check is needed beyond existing
    const snap = await admin_db.doc(`creations/${creation_id}`).get()
    const data = snap.data()
    if (!snap.exists || data === undefined){
        return {status: 404, body: {error: 'not_found'}}
    }
    if (data['status'] === 'pending'){
        return {status: 409, body: {error: 'still_pending'}}
    }

    // Copy the PDF object if it still exists (a fresh object restarts the lifecycle year)
    const new_id = randomBytes(15).toString('base64url')
    const new_pdf_path = `creations/${new_id}/doc.pdf`
    const src_pdf = admin_bucket.file(data['pdf_path'] as string)
    const pdf_copied = (await src_pdf.exists())[0]
    if (pdf_copied){
        await src_pdf.copy(admin_bucket.file(new_pdf_path))
    }

    // Copy any custom font snapshots so the recipient can regenerate independently
    const [font_files] = await admin_bucket.getFiles(
        {prefix: `creations/${creation_id}/fonts/`})
    const new_fonts = []
    for (const font of (data['custom_fonts'] ?? []) as
            {family:string, style:string, files:string[]}[]){
        new_fonts.push({...font, files: font.files.map(path => path.replace(
            `creations/${creation_id}/fonts/`, `creations/${new_id}/fonts/`))})
    }
    for (const file of font_files){
        await file.copy(admin_bucket.file(file.name.replace(
            `creations/${creation_id}/fonts/`, `creations/${new_id}/fonts/`)))
    }

    // The copy is the caller's own, with its own expiry
    await admin_db.doc(`creations/${new_id}`).set({
        owner: uid,
        created: Timestamp.now(),
        title: data['title'],
        blueprint: data['blueprint'],
        status: data['status'],
        pages: data['pages'],
        pdf_path: new_pdf_path,
        pdf_expires: pdf_copied
            ? Timestamp.fromMillis(Date.now() + PDF_LIFETIME_MS)
            : (data['pdf_expires'] ?? null),
        copied_from: creation_id,
        custom_fonts: new_fonts,
        error: (data['error'] ?? null),
    })
    return {status: 200, body: {id: new_id}}
}
