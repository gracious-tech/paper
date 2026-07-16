
import {reactive, ref, computed} from 'vue'
import {cloneDeep} from 'lodash-es'
import {collection, doc, query, where, orderBy, limit, onSnapshot, getDoc, getDocs, setDoc,
    updateDoc, deleteDoc, serverTimestamp, Timestamp} from 'firebase/firestore'
import type {DocumentData, Unsubscribe} from 'firebase/firestore'
import {ref as storage_ref, uploadBytes, getDownloadURL} from 'firebase/storage'
import {PDFDocument} from 'pdf-lib'
import {SCHEMA_VERSION, PDF_LIFETIME_MS} from 'paper-bible-typst'

import {firestore, firebase_storage} from '@/services/firebase'
import {api} from '@/services/api'
import {user} from '@/services/auth'
import {designs, current_design_id} from '@/services/designs'
import {bible_content} from '@/services/content'
import {typst_generator} from '@/services/typst'
import {custom_fonts, get_custom_font_styles, plan_version_fonts, upload_version_fonts,
    load_font_from_meta} from '@/services/custom_fonts'
import {generate_token} from '@/services/utils'
import {report_error, error_to_string} from '@/services/errors'

import type {CustomFont} from 'typst-fonts'
import type {Blueprint, Version} from '@/services/types'


let unsub_list:Unsubscribe|null = null


// The open design's rendered versions (scoped sync, re-subscribed whenever it changes)
export const versions = reactive([] as Version[])
export const selected_version_id = ref(null as string|null)
export const selected_version = computed(() => {
    return versions.find(item => item.id === selected_version_id.value)
})


// The most recently rendered version of the open design, if any
export const latest_version = computed(() => versions[0] ?? null)


// Whether the open design has no rendered version yet, or has unsaved/unrendered changes since
// its latest one — the condition ViewDesign.vue uses to decide editor-vs-version-list
export const design_needs_editor = computed(() => {
    const design = designs.find(item => item.id === current_design_id.value)
    if (!design){
        return true
    }
    return !latest_version.value || design.save_token !== latest_version.value.save_token
})


// --- List sync ------------------------------------------------------------------------------


function version_from_doc(id:string, data:DocumentData):Version{
    // Build a Version from its Firestore doc
    return {
        id,
        design_id: data['design_id'] as string,
        owner: data['owner'] as string,
        created: ((data['created'] ?? Timestamp.now()) as Timestamp).toDate(),
        title: data['title'] as string,
        blueprint: data['blueprint'] as Blueprint,
        status: data['status'] as Version['status'],
        pages: (data['pages'] ?? null) as number|null,
        pdf_path: data['pdf_path'] as string,
        pdf_expires: ((data['pdf_expires'] ?? null) as Timestamp|null)?.toDate() ?? null,
        copied_from: (data['copied_from'] ?? null) as string|null,
        custom_fonts: (data['custom_fonts'] ?? []) as Version['custom_fonts'],
        save_token: data['save_token'] as string,
        error: (data['error'] ?? null) as string|null,
        error_id: (data['error_id'] ?? null) as string|null,
    }
}


export function start_versions_sync(design_id:string):void{
    // Keep the reactive `versions` list mirrored from Firestore, scoped to one design (most
    // recent first) — re-subscribes (tearing down the previous listener) as the open design
    // changes
    unsub_list?.()
    versions.splice(0, versions.length)
    unsub_list = onSnapshot(
        query(collection(firestore, 'versions'),
            where('design_id', '==', design_id), orderBy('created', 'desc')),
        snap => {
            versions.splice(0, versions.length, ...snap.docs.map(item => {
                return version_from_doc(item.id, item.data({serverTimestamps: 'estimate'}))
            }))
        },
        error => {
            report_error('banner', error)
        })
}


export async function fetch_latest_version_id(design_id:string):Promise<string|null>{
    // Look up the most recently rendered version of a design without needing edit access —
    // versions are publicly readable by id, and this query's result is no more revealing than
    // that (see ViewDesign.vue, which uses this to give a bare /designs/:id link read access
    // to a design's latest version, same as if the specific version link had been shared)
    const snap = await getDocs(query(collection(firestore, 'versions'),
        where('design_id', '==', design_id), orderBy('created', 'desc'), limit(1)))
    return snap.docs[0]?.id ?? null
}


// --- Generation -----------------------------------------------------------------------------


export async function create_pending_version(design_id:string, blueprint:Blueprint)
        :Promise<string>{
    // Freeze a blueprint into a new pending version doc and return its id. Any uploaded fonts
    // it references are snapshotted into the version's own Storage paths so regeneration never
    // depends on the user's mutable font library. Reads the parent design's save_token directly
    // (rather than trusting the `designs` list's own listener to have caught up yet) so the
    // freshly-created version's save_token is always the exact one the caller just flushed
    const id = generate_token()
    const design_snap = await getDoc(doc(firestore, 'designs', design_id))
    const save_token = design_snap.data()?.['save_token'] as string
    const fonts = plan_version_fonts(id, blueprint)
    await setDoc(doc(firestore, 'versions', id), {
        schema: SCHEMA_VERSION,
        design_id,
        owner: user.value!.uid,
        created: serverTimestamp(),
        title: blueprint.title,
        blueprint: cloneDeep(blueprint),
        status: 'pending',
        pages: null,
        pdf_path: `versions/${id}/doc.pdf`,
        pdf_expires: null,
        copied_from: null,
        custom_fonts: fonts.meta,
        save_token,
        error: null,
        error_id: null,
    })
    // Font bytes may only be uploaded once the doc exists (Storage rules resolve the owner)
    await upload_version_fonts(fonts.uploads)
    return id
}


export async function compile_and_upload(id:string, blueprint:Blueprint,
        fonts?:CustomFont[]):Promise<void>{
    // Compile a version's PDF in-browser and upload it, updating the doc's status. If the
    // in-browser compile fails (e.g. device lacks memory for large docs) fall back to compiling
    // server-side, which updates the doc itself.
    // `fonts` supplies a version's snapshotted custom fonts when regenerating (the live library
    // is used otherwise).
    const doc_ref = doc(firestore, 'versions', id)
    try {
        try {
            // Resolve the frozen blueprint to a full request (fetches uncached Bible content)
            const generator = typst_generator.value
            if (!generator){
                throw new Error('Typst compiler not ready')
            }
            const font_styles = fonts
                ? Object.fromEntries(fonts.map(f => [f.family, f.style]))
                : get_custom_font_styles()
            const request = await bible_content.resolve(blueprint, font_styles)

            // Compile in the worker (temporarily adding snapshotted fonts when regenerating),
            // then count pages for the history badge
            let bytes:Uint8Array
            if (fonts?.length){
                const families = new Set(fonts.map(f => f.family))
                await generator.set_custom_fonts(
                    [...custom_fonts.filter(f => !families.has(f.family)), ...fonts])
                try {
                    bytes = await generator.compile_pdf(request)
                } finally {
                    await generator.set_custom_fonts(custom_fonts)
                }
            } else {
                bytes = await generator.compile_pdf(request)
            }
            const pages = (await PDFDocument.load(bytes)).getPageCount()

            // Publish the PDF, then mark the version available
            await uploadBytes(storage_ref(firebase_storage, `versions/${id}/doc.pdf`),
                bytes, {contentType: 'application/pdf'})
            await updateDoc(doc_ref, {
                status: 'available',
                pages,
                pdf_expires: Timestamp.fromMillis(Date.now() + PDF_LIFETIME_MS),
                error: null,
            })
        } catch (wasm_error){
            // In-browser path failed — hand over to the server (status updates then arrive
            // via the versions Firestore sync). Not critical yet as the fallback usually works
            report_error('silent', wasm_error,
                {context: {version_id: id, stage: 'wasm_compile'}})
            await api('/api/compile', {version_id: id})
        }
    } catch (error){
        // Even the server fallback failed (it records its own failures — this catch covers
        // not being able to reach it at all). Record the report's id on the doc so the failed
        // view can offer a support link containing it
        const error_id = report_error('silent', error,
            {force: true, critical: true, context: {version_id: id, stage: 'compile_fallback'}})
        await updateDoc(doc_ref, {status: 'failed', error: error_to_string(error), error_id})
            .catch((update_error:unknown) => {
                report_error('banner', update_error)
            })
    }
}


export function version_expired(version:Version):boolean{
    // Whether the version's PDF has passed its Storage lifetime (metadata remains)
    return version.status === 'available'
        && version.pdf_expires !== null && version.pdf_expires.getTime() <= Date.now()
}


export async function regenerate_version(version:Version):Promise<void>{
    // Recompile an expired/failed version's PDF from its frozen blueprint and font snapshot
    // NOTE Storage rules only allow (re)creating the object when it no longer exists
    if (version.status === 'pending'){
        return
    }
    const fonts = await Promise.all(version.custom_fonts.map(meta => load_font_from_meta(meta)))
    await updateDoc(doc(firestore, 'versions', version.id), {status: 'pending', error: null})
    await compile_and_upload(version.id, version.blueprint, fonts)
}


// --- Access ---------------------------------------------------------------------------------


export async function get_pdf_url(version:Version):Promise<string|null>{
    // Resolve a download URL for the version's PDF, or null if it isn't (or is no longer)
    // available — a null for an 'available' version means the PDF expired
    if (version.status !== 'available' || version_expired(version)){
        return null
    }
    try {
        return await getDownloadURL(storage_ref(firebase_storage, version.pdf_path))
    } catch (error){
        // Object already lifecycle-deleted despite pdf_expires (clock skew/manual deletion)
        if ((error as {code?:string}).code === 'storage/object-not-found'){
            return null
        }
        throw error
    }
}


export async function delete_version(id:string):Promise<void>{
    // Delete a version's metadata — its PDF object becomes unreachable immediately (Storage
    // rules can no longer resolve an owner) and is removed by the bucket's lifecycle rule
    await deleteDoc(doc(firestore, 'versions', id))
}


// --- Sharing --------------------------------------------------------------------------------


export async function fetch_shared_version(id:string):Promise<Version>{
    // Look up someone else's shared version directly — versions are publicly readable by id
    // (see firestore.rules), so the link itself is the whole capability, no token needed. Never
    // attempts to read the parent design doc, which stays gated to editors only
    const snap = await getDoc(doc(firestore, 'versions', id))
    if (!snap.exists()){
        throw new Error('not_found')
    }
    return version_from_doc(snap.id, snap.data())
}


export async function copy_version_to_new_design(id:string)
        :Promise<{design_id:string, version_id:string}>{
    // "Keep own copy": duplicate a shared version's design + PDF under the current user,
    // returning the new design and version ids (both appear in the user's own lists via sync)
    return await api<{design_id:string, version_id:string}>('/api/copy_version', {version_id: id})
}


export async function record_viewed(design_id:string, version_id:string, title:string)
        :Promise<void>{
    // Track that the user viewed someone else's design via a public version link, for the
    // /designs "Read access" section (they can copy it, not edit it)
    const uid = user.value!.uid
    await setDoc(doc(firestore, 'users', uid, 'viewed', design_id), {
        design_id, title, last_version_id: version_id, last_viewed: serverTimestamp(),
    }, {merge: true})
}


export async function has_viewed_design(design_id:string):Promise<boolean>{
    // Whether the user has already viewed this design before — a direct targeted read rather
    // than relying on the reactive `viewed_designs` list (designs.ts), which may not have
    // synced yet this early (DialogViewedDesign.vue uses this to only show the "Someone shared
    // this document with you" prompt the first time, not on every repeat visit)
    const uid = user.value!.uid
    const snap = await getDoc(doc(firestore, 'users', uid, 'viewed', design_id))
    return snap.exists()
}


export async function share_version(design_id:string, version_id:string)
        :Promise<'shared'|'copied'|'manual'>{
    // Share a version's public link, preferring the OS share sheet then the clipboard, only
    // falling back to a 'manual' result (caller shows a dialog to copy by hand) if neither
    // is available
    const url = `${location.origin}/designs/${design_id}/${version_id}`
    if (navigator.share){
        try {
            await navigator.share({url})
            return 'shared'
        } catch (error){
            // User cancelled -- they already saw the native share sheet, so nothing else to do
            if ((error as {name?:string}).name === 'AbortError'){
                return 'shared'
            }
        }
    }
    if (navigator.clipboard){
        try {
            await navigator.clipboard.writeText(url)
            return 'copied'
        } catch {
            // Fall through to manual dialog
        }
    }
    return 'manual'
}
