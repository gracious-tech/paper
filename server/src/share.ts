import {randomBytes} from 'node:crypto'

import {FieldValue, Timestamp} from 'firebase-admin/firestore'
import {split_blueprint_doc, SCHEMA_VERSION, PDF_LIFETIME_MS} from 'paper-bible-typst'

import {admin_db, admin_bucket, admin_auth} from './firebase.ts'

import type {Blueprint} from 'paper-bible-typst'


interface HandlerResult {
    status:number
    body:Record<string, unknown>
}


function tokens_match(doc_token:unknown, given:string):boolean{
    // Whether a share token from a doc is enabled and matches the presented one
    return typeof doc_token === 'string' && doc_token.length > 0 && doc_token === given
}


async function find_design_by_token(design_id:string, token:string)
        :Promise<{doc_ref:FirebaseFirestore.DocumentReference, data:FirebaseFirestore.DocumentData}|null>{
    // Look up a design by its invite link, validating the token (shared by the preview and
    // redeem handlers below — same lookup, different side effects)
    const doc_ref = admin_db.doc(`designs/${design_id}`)
    const snap = await doc_ref.get()
    const data = snap.data()
    if (!snap.exists || data === undefined || !tokens_match(data['share_token'], token)){
        return null
    }
    return {doc_ref, data}
}


export async function handle_design_invite_preview(design_id:string, token:string)
        :Promise<HandlerResult>{
    // Look up a design's name via its invite token without granting access yet, so the client
    // can show what's being shared before the user decides whether to accept
    const found = await find_design_by_token(design_id, token)
    if (!found){
        // Same response whether missing or bad token (don't leak which)
        return {status: 404, body: {error: 'unknown_share'}}
    }
    return {status: 200, body: {name: found.data['name'] as string}}
}


export async function handle_redeem_design_invite(uid:string, design_id:string, token:string)
        :Promise<HandlerResult>{
    // Add the caller as an editor of a design after validating its share token
    const found = await find_design_by_token(design_id, token)
    if (!found){
        // Same response whether missing or bad token (don't leak which)
        return {status: 404, body: {error: 'unknown_share'}}
    }
    const {doc_ref, data} = found
    if (!(data['editor_uids'] as string[]).includes(uid)){
        await doc_ref.update({
            editor_uids: FieldValue.arrayUnion(uid),
            [`editors.${uid}`]: {joined: Timestamp.now()},
        })
    }
    return {status: 200, body: {ok: true}}
}


export async function handle_design_editors(uid:string, design_id:string):Promise<HandlerResult>{
    // List a design's owner + editors with display name/email, for the share dialog — Firestore
    // only stores uids, so this resolves them via Admin Auth (other users' auth profiles aren't
    // client-readable directly)
    const snap = await admin_db.doc(`designs/${design_id}`).get()
    const data = snap.data()
    const editor_uids = (data?.['editor_uids'] ?? []) as string[]
    if (!snap.exists || data === undefined || !editor_uids.includes(uid)){
        return {status: 404, body: {error: 'not_found'}}
    }
    const owner = data['owner'] as string
    const editors = await Promise.all(editor_uids.map(async euid => {
        const account = await admin_auth.getUser(euid).catch(() => null)
        return {
            uid: euid,
            owner: euid === owner,
            name: account?.displayName ?? null,
            email: account?.email ?? null,
        }
    }))
    return {status: 200, body: {editors}}
}


export async function handle_copy_version(uid:string, version_id:string)
        :Promise<HandlerResult>{
    // "Keep own copy": duplicate a shared version's design (metadata + PDF + font snapshots)
    // under the caller, so it survives the original owner deleting theirs. Versions are
    // publicly readable by id (see firestore.rules) so no capability check is needed beyond
    // existing. Creates two docs — a brand new design (the caller's own, editable copy of the
    // live content) plus the version itself (so the copy has render history from the start)
    const snap = await admin_db.doc(`versions/${version_id}`).get()
    const data = snap.data()
    if (!snap.exists || data === undefined){
        return {status: 404, body: {error: 'not_found'}}
    }
    if (data['status'] === 'pending'){
        return {status: 409, body: {error: 'still_pending'}}
    }

    // Two independent new docs — a design and a version — not to be confused with each other
    const new_design_id = randomBytes(15).toString('base64url')
    const new_version_id = randomBytes(15).toString('base64url')

    // Copy the PDF object if it still exists (a fresh object restarts the lifecycle year).
    // Both paths are derived from the version ids, never read from the doc — doc fields are
    // client-written, and trusting them would let a crafted doc exfiltrate arbitrary bucket
    // objects into a publicly-gettable copy
    const new_pdf_path = `versions/${new_version_id}/doc.pdf`
    const src_pdf = admin_bucket.file(`versions/${version_id}/doc.pdf`)
    const pdf_copied = (await src_pdf.exists())[0]
    if (pdf_copied){
        await src_pdf.copy(admin_bucket.file(new_pdf_path))
    }

    // Copy any custom font snapshots so the recipient can regenerate independently, dropping
    // (rather than rewriting) any metadata entry that points outside the version's own font
    // prefix — same trust reasoning as the PDF path above
    const src_fonts_prefix = `versions/${version_id}/fonts/`
    const new_fonts_prefix = `versions/${new_version_id}/fonts/`
    const [font_files] = await admin_bucket.getFiles({prefix: src_fonts_prefix})
    const new_fonts = []
    for (const font of (data['custom_fonts'] ?? []) as
            {family:string, style:string, files:string[]}[]){
        if (font.files.every(path => path.startsWith(src_fonts_prefix))){
            new_fonts.push({...font, files: font.files.map(
                path => path.replace(src_fonts_prefix, new_fonts_prefix))})
        }
    }
    for (const file of font_files){
        await file.copy(admin_bucket.file(
            file.name.replace(src_fonts_prefix, new_fonts_prefix)))
    }

    // The copy's design and version share the same freshly-generated save_token — matching the
    // existing randomBytes-based id generator already in this file rather than importing the
    // client's generate_token() — so the copy lands with design_needs_editor false, since its
    // live content is identical to the version it was just copied from
    const save_token = randomBytes(15).toString('base64url')
    const blueprint = data['blueprint'] as Blueprint

    await admin_db.doc(`designs/${new_design_id}`).set({
        schema: SCHEMA_VERSION,
        owner: uid,
        editor_uids: [uid],
        editors: {},
        share_token: randomBytes(15).toString('base64url'),
        name: data['title'],
        save_token,
        created: Timestamp.now(),
        modified: Timestamp.now(),
        ...split_blueprint_doc(blueprint),
    })

    await admin_db.doc(`versions/${new_version_id}`).set({
        schema: SCHEMA_VERSION,
        design_id: new_design_id,
        owner: uid,
        created: Timestamp.now(),
        title: data['title'],
        blueprint,
        status: data['status'],
        pages: data['pages'],
        pdf_path: new_pdf_path,
        pdf_expires: pdf_copied
            ? Timestamp.fromMillis(Date.now() + PDF_LIFETIME_MS)
            : (data['pdf_expires'] ?? null),
        copied_from: version_id,
        custom_fonts: new_fonts,
        save_token,
        error: (data['error'] ?? null),
    })

    return {status: 200, body: {design_id: new_design_id, version_id: new_version_id}}
}
