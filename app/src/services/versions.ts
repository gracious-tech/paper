
import {reactive, ref, computed} from 'vue'
import {collection, doc, query, where, orderBy, limit, onSnapshot, getDoc, getDocs, setDoc,
    serverTimestamp, Timestamp} from 'firebase/firestore'
import type {DocumentData, Unsubscribe} from 'firebase/firestore'
import {ref as storage_ref, getDownloadURL} from 'firebase/storage'
import {migrate_version_blueprint} from 'paper-bible-typst'

import {firestore, firebase_storage} from '@/services/firebase'
import {api} from '@/services/api'
import {user} from '@/services/auth'
import {designs, current_design_id} from '@/services/designs'
import {read_wizard_state} from '@/services/new_design'
import {report_error} from '@/services/errors'

import type {DesignMeta, Version} from '@/services/types'


let unsub_list:Unsubscribe|null = null


// The open design's rendered versions (scoped sync, re-subscribed whenever it changes)
export const versions = reactive([] as Version[])
export const selected_version_id = ref(null as string|null)
export const selected_version = computed(() => {
    return versions.find(item => item.id === selected_version_id.value)
})


// The most recently rendered version of the open design, if any
export const latest_version = computed(() => versions[0] ?? null)


// Whether the open design has no rendered version matching its current content — the condition
// ViewDesign.vue uses to decide editor-vs-version-list. Every version is checked, not just the
// newest: after restoring an older version over the design (see restore_version_into_design)
// the content *has* been rendered, just not by the most recent render
export const design_needs_editor = computed(() => {
    const design = designs.find(item => item.id === current_design_id.value)
    if (!design){
        return true
    }
    return !versions.some(item => item.save_token === design.save_token)
})


// Same condition as design_needs_editor, but usable for any row in the /designs list (not just
// the currently-open design) — reads the denormalized `latest_version` summary on the design doc
// instead of the live per-design `versions` subscription, which is only ever populated for the
// open design. Every write of that summary keeps it pointed at the version representing the
// design's current content, which is what makes the cheap save_token comparison here hold
export function design_needs_version(design:DesignMeta):boolean{
    return !design.latest_version || design.save_token !== design.latest_version.save_token
}


// A pending version is treated as stuck once it's sat this long past its latest compile attempt.
// That's well beyond any realistic compile time (the server fallback is capped near 5 min by the
// Cloud Run request timeout), so crossing it almost always means the compile's driver went away
// — the tab that clicked "Create" reloaded/closed/crashed, or the server instance was killed.
// `compile_and_upload` (version_compile.ts) runs only in that one tab and nothing else ever
// advances a pending doc, so past this the UI offers a retry instead of an unbounded progress
// screen
export const STUCK_MS = 4 * 60 * 1000


export function version_stuck(version:Version):boolean{
    // Whether a pending version has been abandoned mid-compile (see STUCK_MS). Reads the wall
    // clock directly, so components re-run it against a ticking ref to keep the result current
    if (version.status !== 'pending'){
        return false
    }
    const since = (version.compile_started ?? version.created).getTime()
    return Date.now() - since > STUCK_MS
}


// --- List sync ------------------------------------------------------------------------------


function version_from_doc(id:string, data:DocumentData):Version{
    // Build a Version from its Firestore doc
    return {
        id,
        design_id: data['design_id'] as string,
        owner: data['owner'] as string,
        created: ((data['created'] ?? Timestamp.now()) as Timestamp).toDate(),
        compile_started: ((data['compile_started'] ?? null) as Timestamp|null)?.toDate() ?? null,
        title: data['title'] as string,
        // Migrated to the current schema here, at the single point every consumer reads a
        // version's blueprint through — regeneration, cover re-render, "keep a copy" and
        // restore-into-design all get the current shape without each needing to know. The clone
        // migrate_version_blueprint() works on is what keeps that in memory: the stored blueprint
        // is immutable by rule, and nothing here is ever written back to it (see migrate.ts)
        blueprint: migrate_version_blueprint(data),
        status: data['status'] as Version['status'],
        cover_status: (data['cover_status'] ?? null) as Version['cover_status'],
        cover_render_version: (data['cover_render_version'] ?? null) as number|null,
        pages: (data['pages'] ?? null) as number|null,
        pdf_path: data['pdf_path'] as string,
        pdf_expires: ((data['pdf_expires'] ?? null) as Timestamp|null)?.toDate() ?? null,
        copied_from: (data['copied_from'] ?? null) as string|null,
        custom_fonts: (data['custom_fonts'] ?? []) as Version['custom_fonts'],
        save_token: data['save_token'] as string,
        // Frozen from the parent design and validated like the blueprint beside it, since both
        // are client-written (and server-written for a copy) — see read_wizard_state
        ...read_wizard_state(data),
        error: (data['error'] ?? null) as string|null,
        error_id: (data['error_id'] ?? null) as string|null,
    }
}


export function stop_versions_sync():void{
    // Drop the versions listener ahead of a uid change — see stop_design_sync() in designs.ts
    unsub_list?.()
    unsub_list = null
    versions.splice(0, versions.length)
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


// --- Status helpers -------------------------------------------------------------------------


export function version_expired(version:Version):boolean{
    // Whether the version's PDF has passed its Storage lifetime (metadata remains)
    return version.status === 'available'
        && version.pdf_expires !== null && version.pdf_expires.getTime() <= Date.now()
}


export function version_debug_ref(version:Version|null):string{
    // Identifying string for a version (host + id + saved error-report id) — shown to users to
    // quote in a support request, and prefilled into the "Contact us" link's description
    const error_part = version?.error_id ? ` error:${version.error_id}` : ''
    return location.hostname + ' version:' + (version?.id ?? '') + error_part
}


export function version_contact_url(version:Version|null):string{
    // "Contact us" link with the version's debug ref prefilled as the message description
    return 'https://gracious.tech/contact?desc=' + encodeURIComponent(version_debug_ref(version))
}


export function cover_failed(version:Version):boolean{
    // Whether the version's interior is available but its wraparound cover failed to render —
    // the interior PDF can still be viewed/downloaded, the cover can't (and can be regenerated
    // on its own via regenerate_cover in version_compile.ts)
    return version.cover_status === 'failed' && version.status === 'available'
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


export async function get_cover_pdf_url(version:Version):Promise<string|null>{
    // Resolve a download URL for the version's separate cover PDF (path derived from the id,
    // never read from the doc — same rule as the server's pdf_path convention). Null when the
    // version has no cover, the cover render failed (cover_status), the version isn't available,
    // or the PDF expired (covers share doc.pdf's lifecycle — both under the same versions/ prefix)
    if (!version.blueprint.cover || version.cover_status === 'failed'
            || version.status !== 'available' || version_expired(version)){
        return null
    }
    try {
        return await getDownloadURL(
            storage_ref(firebase_storage, `versions/${version.id}/cover.pdf`))
    } catch (error){
        if ((error as {code?:string}).code === 'storage/object-not-found'){
            return null
        }
        throw error
    }
}


export async function open_version_pdf(win:Window|null, version:Version,
        which:'interior'|'cover'):Promise<void>{
    // Navigate an already-opened blank tab to one of the version's PDFs. The caller opens the
    // tab synchronously (passing the handle in) so popup blockers still credit the originating
    // click as a user gesture; this resolves the URL and points the tab at it, closing the tab
    // when the PDF isn't available (pending/failed/expired, or no cover)
    const url = which === 'cover' ? await get_cover_pdf_url(version) : await get_pdf_url(version)
    if (url && win){
        win.location.href = url
    } else {
        win?.close()
    }
}


export async function download_version_pdf(version:Version, which:'interior'|'cover')
        :Promise<void>{
    // Save one of the version's PDFs to disk. The stored objects have contentDisposition 'inline'
    // (so the preview iframe renders them) and live on a different origin, so the <a download>
    // attribute alone is ignored — fetch the bytes and hand the browser a same-origin blob URL
    const url = which === 'cover' ? await get_cover_pdf_url(version) : await get_pdf_url(version)
    if (!url){
        return
    }
    const blob = await (await fetch(url)).blob()
    const blob_url = URL.createObjectURL(blob)
    // Build a readable filename from the version title
    const base = (version.title || 'bible').replace(/[/\\?%*:|"<>]/g, '-').trim() || 'bible'
    const name = which === 'cover' ? `${base} (cover).pdf` : `${base}.pdf`
    // Trigger the download via a transient anchor, then release the blob URL
    const anchor = document.createElement('a')
    anchor.href = blob_url
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Give the browser a beat to start the download before releasing the blob
    setTimeout(() => URL.revokeObjectURL(blob_url), 10000)
}


export async function delete_version(version:Version):Promise<void>{
    // Delete a version: its doc, its PDFs, and any frozen snapshot no sibling version still
    // needs. Server-mediated — clients can't delete Storage objects, and the parent design's
    // denormalized summary has to be repointed in the same breath so the /designs row never
    // describes a version that's gone (see handle_delete_version)
    await api<{ok:boolean}>('/api/delete_version', {version_id: version.id})
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
