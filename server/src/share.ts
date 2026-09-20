import {randomBytes, timingSafeEqual} from 'node:crypto'

import {FieldValue, Timestamp} from 'firebase-admin/firestore'
import {split_blueprint_doc, resolve_design_name, get_cover_title, SCHEMA_VERSION,
    PDF_LIFETIME_MS, design_assets_prefix, version_assets_prefix, asset_basename,
    migrate_version_blueprint} from 'paper-bible-typst'

import {admin_db, admin_bucket, admin_auth} from './firebase.ts'
import {quota_allows, QUOTA_COPY, DAILY_COPY_LIMIT} from './quota.ts'
import {repath_assets, copy_basenames, collect_version_basenames} from './assets.ts'

import type {Blueprint, CoverConfig, StoredFontMeta} from 'paper-bible-typst'
import type {HandlerResult} from './types.ts'


function tokens_match(doc_token:unknown, given:string):boolean{
    // Whether a share token from a doc is enabled and matches the presented one.
    // Compared in constant time so how long the answer takes says nothing about how much of a
    // guess was right — `===` stops at the first differing byte, which in principle lets a
    // token be walked out one character at a time. The tokens are 120 bits of randomness and
    // the signal would be buried under network and Firestore latency, so this is cheap
    // insurance rather than a fix for a reachable attack — but it costs three lines
    if (typeof doc_token !== 'string' || doc_token.length === 0){
        return false
    }
    const expected = Buffer.from(doc_token, 'utf8')
    const presented = Buffer.from(given, 'utf8')
    // timingSafeEqual throws on a length mismatch, and length isn't secret anyway
    return expected.length === presented.length && timingSafeEqual(expected, presented)
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
    // Resolved from the doc's own fields (see resolve_design_name) — no Bible collection needed
    // here, since the content-derived fallback was cached on the design when it was written.
    // NOTE `name` is a sibling field of `blueprint`, not one of its options (split_blueprint_doc)
    const blueprint = (found.data['blueprint'] ?? {}) as Record<string, unknown>
    const name = resolve_design_name(
        (found.data['name'] ?? '') as string,
        get_cover_title(blueprint['cover'] as CoverConfig|null),
        (found.data['name_auto'] ?? '') as string,
    )
    return {status: 200, body: {name}}
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
    // "Keep own copy": duplicate a shared version's design (metadata, both PDFs, and every
    // snapshotted asset — fonts, cover background, passage images) under the caller, so it
    // survives the original owner deleting theirs. Versions are publicly readable by id (see
    // firestore.rules) so no capability check is needed beyond existing. Creates two docs — a
    // brand new design (the caller's own, editable copy of the live content) plus the version
    // itself (so the copy has render history from the start)
    const snap = await admin_db.doc(`versions/${version_id}`).get()
    const data = snap.data()
    if (!snap.exists || data === undefined){
        return {status: 404, body: {error: 'not_found'}}
    }
    if (data['status'] === 'pending'){
        return {status: 409, body: {error: 'still_pending'}}
    }

    // Throttle, after the checks above so a missing or still-compiling version costs the caller
    // nothing — only a copy we're actually about to make counts against them.
    // This route needs a cap for the same reason /api/compile does, and more so: every call
    // duplicates a rendered PDF and its assets server-side, which means an attacker spends no
    // bandwidth of their own and the cost they impose is storage that persists rather than CPU
    // that ends. Nothing about the request identifies a victim, so the only account that can be
    // filled up is the caller's own — this is a bill problem, not a data one
    if (!await quota_allows(QUOTA_COPY, uid, DAILY_COPY_LIMIT)){
        return {status: 429, body: {error: 'quota_exceeded'}}
    }

    // Two independent new docs — a design and a version — not to be confused with each other
    const new_design_id = randomBytes(15).toString('base64url')
    const new_version_id = randomBytes(15).toString('base64url')

    // The rendered PDFs — copied, not linked, so the copy expires on its own 365-day clock
    // rather than inheriting whatever is left of the source's. Both paths are derived from the
    // version ids, never read from the doc: doc fields are client-written, and trusting them
    // would let a crafted doc exfiltrate arbitrary bucket objects into a publicly-gettable copy
    const new_pdf_path = `versions/${new_version_id}/doc.pdf`
    const src_pdf = admin_bucket.file(`versions/${version_id}/doc.pdf`)
    // An expired version has metadata but no object, and the copy's expiry has to reflect
    // which of the two it got
    const pdf_copied = (await src_pdf.exists())[0]
    if (pdf_copied){
        await src_pdf.copy(admin_bucket.file(new_pdf_path))
    }
    const src_cover = admin_bucket.file(`versions/${version_id}/cover.pdf`)
    if ((await src_cover.exists())[0]){
        await src_cover.copy(admin_bucket.file(`versions/${new_version_id}/cover.pdf`))
    }

    // The assets the version renders from. Only the ones this version actually references —
    // the source design's version_assets prefix is shared by *every* version it has ever had,
    // so copying it wholesale would both waste space and hand the recipient images from
    // versions that were never shared with them.
    // src_design_id is the version doc's own design_id, which the rules pin at create
    // (the writer had to be an editor of it) and then forbid changing, so it can only name a
    // design the writer could already reach
    const src_design_id = data['design_id'] as string
    const src_prefix = version_assets_prefix(src_design_id)
    const names = collect_version_basenames(data)
    // Two destinations, because the copy is both a version and an editable design: the version
    // renders from the frozen snapshot, while the design needs assets of its own that it can
    // go on editing and eventually reclaim
    await copy_basenames(src_prefix, version_assets_prefix(new_design_id), names)
    await copy_basenames(src_prefix, design_assets_prefix(new_design_id), names)

    // Re-path the font snapshot metadata onto the new design's prefixes, dropping (rather than
    // rewriting) any entry pointing outside the source's own — same trust reasoning as above
    const new_fonts:StoredFontMeta[] = []
    const design_fonts:Record<string, StoredFontMeta> = {}
    for (const font of (data['custom_fonts'] ?? []) as StoredFontMeta[]){
        if (!font.files?.every(path => path.startsWith(src_prefix))){
            continue
        }
        const basenames = font.files.map(path => asset_basename(path))
        new_fonts.push({...font,
            files: basenames.map(name => version_assets_prefix(new_design_id) + name)})
        // The recipient's own editable copy of the family, so the new design can keep using
        // it (and offer it to their other designs) long after this snapshot is gone
        design_fonts[randomBytes(15).toString('base64url')] = {...font,
            files: basenames.map(name => design_assets_prefix(new_design_id) + name)}
    }

    // The copy's design and version share the same freshly-generated save_token — matching the
    // existing randomBytes-based id generator already in this file rather than importing the
    // client's generate_token() — so the copy lands with design_needs_editor false, since its
    // live content is identical to the version it was just copied from
    const save_token = randomBytes(15).toString('base64url')
    // Migrated to the current schema before anything is derived from it — both docs written below
    // are stamped with SCHEMA_VERSION, so copying an older blueprint through verbatim would
    // leave them declaring a shape they don't have, and the chain would never run on them again.
    // The *source* version is untouched, as always (migrate_version_blueprint clones)
    const blueprint = migrate_version_blueprint(data)
    // The same assets described two ways: the new *version* points at the frozen snapshots,
    // while the new *design* points at its own editable copies. Nothing else about the
    // blueprint differs between them
    const version_blueprint = repath_assets(blueprint, version_assets_prefix(new_design_id))
    const design_blueprint = repath_assets(blueprint, design_assets_prefix(new_design_id))
    // cover_status carries over verbatim — the copy's cover.pdf (if any) was copied above
    const cover_status = (data['cover_status'] ?? null) as 'available'|'failed'|null
    // The wizard state frozen into the version at creation, so a copy of a simple design is
    // simple for the recipient too. The design and version docs name these fields identically
    // (see WizardState in the app), so it passes straight through to both docs below without
    // being reshaped. Client-written like the blueprint beside it, and only ever read back by
    // the client's own wizard steps, which validate it
    const wizard = {
        wizard_draft: (data['wizard_draft'] ?? null) as unknown,
        simple_mode: !!data['simple_mode'],
    }

    await admin_db.doc(`designs/${new_design_id}`).set({
        schema: SCHEMA_VERSION,
        owner: uid,
        editor_uids: [uid],
        editors: {},
        share_token: randomBytes(15).toString('base64url'),
        // The source version's frozen title is already a resolved name, so it seeds the copy's
        // content-derived fallback without this service needing the Bible collection
        name_auto: data['title'],
        save_token,
        created: Timestamp.now(),
        modified: Timestamp.now(),
        category: null,
        latest_version: {status: data['status'], pages: data['pages'], save_token},
        fonts: design_fonts,
        ...wizard,
        ...split_blueprint_doc(design_blueprint),
    })

    await admin_db.doc(`versions/${new_version_id}`).set({
        schema: SCHEMA_VERSION,
        design_id: new_design_id,
        owner: uid,
        created: Timestamp.now(),
        title: data['title'],
        blueprint: version_blueprint,
        status: data['status'],
        cover_status,
        // Carried over verbatim like cover_status: the copy's cover.pdf is the source's bytes,
        // so what rendered it is the source's bookcover version, not today's
        cover_render_version: (data['cover_render_version'] ?? null),
        pages: data['pages'],
        pdf_path: new_pdf_path,
        pdf_expires: pdf_copied
            ? Timestamp.fromMillis(Date.now() + PDF_LIFETIME_MS)
            : (data['pdf_expires'] ?? null),
        copied_from: version_id,
        custom_fonts: new_fonts,
        save_token,
        ...wizard,  // Carried over so a copy of the copy is still simple
        error: (data['error'] ?? null),
    })

    return {status: 200, body: {design_id: new_design_id, version_id: new_version_id}}
}
