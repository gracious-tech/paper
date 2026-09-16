
import {reactive, ref, watch} from 'vue'
import {cloneDeep, isEqual, debounce} from 'lodash-es'
import {collection, doc, query, where, orderBy, onSnapshot, getDoc, getDocs, setDoc, updateDoc,
    deleteDoc, deleteField, arrayRemove, serverTimestamp, FieldPath, Timestamp, writeBatch}
    from 'firebase/firestore'
import type {DocumentData, Unsubscribe} from 'firebase/firestore'
import {split_blueprint_doc, join_blueprint_doc, resolve_design_name, get_cover_title,
    COVER_TITLE_KEY, SCHEMA_VERSION} from 'paper-bible-typst'

import {firestore} from '@/services/firebase'
import {api} from '@/services/api'
import {user} from '@/services/auth'
import {blue, state, estimated_pages} from '@/services/state'
import {clean_blueprint, gen_content_name, content_preview, get_default_blueprint}
    from '@/services/blueprints'
import {generate_token} from '@/services/utils'
import {report_error} from '@/services/errors'
import {translate} from '@/services/i18n'

import {build_new_blueprint} from '@/services/new_design'

import type {Blueprint, ContentItem, CoverConfig, DesignMeta, ViewedDesign, DesignEditorInfo}
    from '@/services/types'
import type {NewDesignDraft} from '@/services/new_design'


// Debounce delay for saving design edits (long enough to batch bursts of typing/slider drags)
const SAVE_DEBOUNCE_MS = 1500


// Metadata for every design the user can access (own + shared with them), most recent first
export const designs = reactive([] as DesignMeta[])


// Id of the design currently open (whose blueprint is mirrored into `blue`)
export const current_design_id = ref(null as string|null)


// Wizard-related state of the currently open design — sibling fields of the doc that live
// outside `Blueprint`/`blue` (see new_design.ts: build_new_blueprint() is a one-way, lossy
// transform, so accurately reopening/labelling a wizard step needs the original draft, not just
// a re-derivation from the Blueprint it produced). Kept as a simple full-replace on every
// snapshot (not diffed like `blue`) since these are only ever written by one explicit user
// action at a time (finishing a wizard-edit, or clicking "Advanced")
export const design_wizard = reactive({
    simple_mode: false,
    draft: null as NewDesignDraft|null,
})


// Resolves once the first designs-list snapshot has arrived — a deep-linked /designs/:id whose
// id isn't in the list by then belongs to someone else (read-access view), not still-loading
let resolve_designs_loaded:() => void
export const designs_loaded = new Promise<void>(resolve => {
    resolve_designs_loaded = resolve
})


// Module-level sync state
// `synced` is the last blueprint state received from (or flushed to) Firestore — the base for
// both outgoing diffs and three-way application of incoming snapshots
let synced:Blueprint|null = null
let unsub_doc:Unsubscribe|null = null
let unsub_list:Unsubscribe|null = null
let unsub_viewed:Unsubscribe|null = null


// Designs the user has viewed via a public version link but can't edit ("Read access" section
// of /designs), most recently viewed first
export const viewed_designs = reactive([] as ViewedDesign[])


// --- Converters between the Blueprint model and the Firestore doc shape -----------------
// Content items are stored as a map keyed by item id plus a separate order array, so that
// concurrent editors writing different items/fields never clobber each other. The actual
// reshaping lives in paper-bible-typst (shared with the server) — this just adds the
// validation step, which is client-only (co-editor data may be untrusted)


function doc_to_blueprint(data:DocumentData):Blueprint{
    // Reassemble a blueprint from a Firestore doc, validating since it may come from an editor
    return clean_blueprint(join_blueprint_doc({
        blueprint: (data['blueprint'] ?? {}) as Record<string, unknown>,
        content_items: (data['content_items'] ?? {}) as Record<string, ContentItem>,
        content_order: (data['content_order'] ?? []) as string[],
        name: (data['name'] ?? '') as string,
    }))
}


export function gen_name_auto(blueprint:Blueprint):string{
    // Derive a design's fallback name from its content — the label of the first item, e.g.
    // "Genesis". Needs the Bible collection (book names come from the chosen translation), so
    // it's computed here, where the collection is always loaded, and cached on the design doc
    // as `name_auto` for readers that have no collection (see resolve_design_name)
    const item = blueprint.content[0]
    if (!item){
        return ''
    }
    // A passage the user has titled is named by that title, falling through to its reference
    // otherwise (a null "auto" title falls through the same as an explicitly blank one).
    // gen_content_name() isn't given this preference wholesale because it also feeds
    // content_preview(), whose whole job is to list references
    if (item.type === 'passage' && item.title?.trim()){
        return item.title.trim()
    }
    return gen_content_name(item, blueprint.bibles[0])
}


export function design_display_name(blueprint:Blueprint, name_auto:string):string{
    // A design's resolved name for *storing* (a version's frozen title), so unlike the list's
    // own lookup it can't leave the blank case to the template — it resolves the placeholder
    // here. `designs` list rows keep the raw '' and fall back in the markup, as they already did
    return resolve_design_name(blueprint.name, get_cover_title(blueprint.cover), name_auto)
        || translate('common.unnamed_design')
}


function content_summary(data:DocumentData, bible:string|undefined):string{
    // Abbreviated, passage-only preview of a design's content, straight off the raw doc fields
    // (no need for join_blueprint_doc()/clean_blueprint() just to list item names for a list row)
    const content_items = (data['content_items'] ?? {}) as Record<string, ContentItem>
    const content_order = (data['content_order'] ?? []) as string[]
    const items = content_order
        .map(id => content_items[id])
        .filter((item):item is ContentItem => !!item)
    return content_preview(items, bible)
}


// --- Outgoing sync (debounced field-level writes) ----------------------------------------


function gen_updates(prev:Blueprint, next:Blueprint):[string|FieldPath, unknown][]{
    // Diff two blueprints into minimal Firestore field updates (dotted paths / FieldPaths)

    const updates:[string|FieldPath, unknown][] = []

    // Scalar options (everything except the content array and the name, both of which are
    // stored as their own doc fields — see split_blueprint_doc)
    for (const key of Object.keys(next) as (keyof Blueprint)[]){
        if (key !== 'content' && key !== 'name' && !isEqual(prev[key], next[key])){
            updates.push([`blueprint.${key}`, cloneDeep(next[key])])
        }
    }

    // The design's name — a sibling doc field, not a blueprint option
    if (prev.name !== next.name){
        updates.push(['name', next.name])
    }

    // Changed/added content items (whole-item granularity — an editor working on one item
    // never writes the others)
    // NOTE Item ids contain url64 chars so must use FieldPath rather than dotted strings
    const prev_items = Object.fromEntries(prev.content.map(item => [item.id, item]))
    for (const item of next.content){
        if (!isEqual(prev_items[item.id], item)){
            updates.push([new FieldPath('content_items', item.id), cloneDeep(item)])
        }
    }

    // Removed content items
    const next_ids = new Set(next.content.map(item => item.id))
    for (const id of Object.keys(prev_items)){
        if (!next_ids.has(id)){
            updates.push([new FieldPath('content_items', id), deleteField()])
        }
    }

    // Order (whole array — reorders are rare and atomic)
    if (!isEqual(prev.content.map(i => i.id), next.content.map(i => i.id))){
        updates.push(['content_order', next.content.map(item => item.id)])
    }

    return updates
}


export async function flush_changes():Promise<void>{
    // Write any unsaved local edits of the open design to Firestore. Exported (not just used by
    // the debounced autosave) so generate() can force a flush immediately before freezing a
    // version, guaranteeing the persisted save_token always matches what gets frozen
    const id = current_design_id.value
    if (!id || !synced){
        return
    }
    const updates = gen_updates(synced, blue)
    if (!updates.length){
        return
    }

    // Whether anything that actually gets rendered changed. A rename on its own doesn't — the
    // name reaches the PDF only as metadata — so it must not flag existing versions as needing
    // a rebuild (see rename_design)
    const render_affecting = updates.some(([path]) => path !== 'name')

    // Optimistically advance the sync base so the write's own echo isn't re-applied over any
    // newer local edits (restored on failure so the next flush re-diffs everything)
    const pre_flush = synced
    synced = cloneDeep({...blue})

    // The derived fallback name is only recomputed when its inputs moved: the first content
    // item (the label is taken from it) or the primary translation (book names are that
    // translation's). Renames never touch it — that's `blueprint.name`, a separate field
    if (!isEqual(pre_flush.content[0], blue.content[0])
            || pre_flush.bibles[0] !== blue.bibles[0]){
        updates.push(['name_auto', gen_name_auto(blue)])
    }
    updates.push(['modified', serverTimestamp()])
    // A fresh opaque marker every time the design's persisted content changes — versions copy
    // this verbatim at freeze time, so comparing by equality (not timestamp order, which can't
    // be relied on across two independently-resolved serverTimestamp()s) tells whether a
    // version is still up to date with the live design
    if (render_affecting){
        updates.push(['save_token', generate_token()])
    }
    try {
        const [first, ...rest] = updates as [[string|FieldPath, unknown], ...[string|FieldPath, unknown][]]
        await updateDoc(doc(firestore, 'designs', id), first[0], first[1], ...rest.flat())
    } catch (error){
        synced = pre_flush
        report_error('banner', error)
    }
}

// Debounced save (flushable when switching designs / creating)
const save = debounce(() => {void flush_changes()}, SAVE_DEBOUNCE_MS)


export function start_design_sync():void{
    // Start auto-saving edits to the open design (call once at boot, after the design is loaded)
    // WARN Watch source must be a function so still reactive if blueprint wholly replaced
    watch(() => blue, () => {
        save()
    }, {deep: true})
}


// --- Incoming sync (three-way apply of remote snapshots) ---------------------------------


function apply_remote(remote:Blueprint):void{
    // Apply remotely-changed fields into `blue` without clobbering unsaved local edits to
    // other fields (same-field conflicts resolve to the remote value — last write wins)
    if (!synced){
        return
    }

    // Scalar options
    for (const key of Object.keys(remote) as (keyof Blueprint)[]){
        if (key !== 'content' && !isEqual(remote[key], synced[key])){
            (blue as Record<string, unknown>)[key] = cloneDeep(remote[key])
        }
    }

    // Content items — take the remote version of items it changed, keep local versions of the
    // rest, and preserve locally-added items that haven't been flushed yet
    const remote_changed = !isEqual(
        remote.content, synced.content)
    if (remote_changed){
        const synced_items = Object.fromEntries(synced.content.map(item => [item.id, item]))
        const local_items = Object.fromEntries(blue.content.map(item => [item.id, item]))
        const new_content = remote.content.map(item => {
            const synced_item = synced_items[item.id]
            if (!synced_item || !isEqual(item, synced_item)){
                return cloneDeep(item)  // New or changed remotely
            }
            return local_items[item.id] ?? cloneDeep(item)  // Unchanged remotely — keep local
        })
        for (const item of blue.content){
            if (!(item.id in synced_items) && !remote.content.some(i => i.id === item.id)){
                new_content.push(item)  // Added locally, not yet flushed
            }
        }
        blue.content.splice(0, blue.content.length, ...new_content)
    }

    synced = cloneDeep(remote)
}


// --- Design management ---------------------------------------------------------------------


export async function open_design(id:string):Promise<void>{
    // Open a design, mirroring its blueprint into `blue` and subscribing to remote changes

    // Flush pending edits of the previously open design before switching away
    save.flush()
    unsub_doc?.()
    synced = null
    current_design_id.value = id
    design_wizard.simple_mode = false
    design_wizard.draft = null
    // The page estimate belongs to the design that produced it — anything reading it (cover
    // spine, binding validity, the derived binding) must wait for this design's first preview
    // rather than size itself from the previous design's length
    estimated_pages.value = null

    await new Promise<void>((resolve, reject) => {
        unsub_doc = onSnapshot(doc(firestore, 'designs', id), snap => {

            // Design was deleted (e.g. by its owner in another session) — move to another
            if (!snap.exists()){
                if (current_design_id.value === id){
                    void open_other_design(id)
                }
                resolve()
                return
            }

            const data = snap.data()
            design_wizard.simple_mode = !!data['simple_mode']
            design_wizard.draft = data['wizard_draft']
                ? cloneDeep(data['wizard_draft'] as NewDesignDraft) : null

            // First snapshot populates the whole blueprint; later ones merge field-by-field
            if (!synced){
                const remote = doc_to_blueprint(data)
                Object.assign(blue, remote)
                synced = cloneDeep(remote)
                resolve()
            } else if (!snap.metadata.hasPendingWrites){
                // Ignore local echoes — only apply snapshots that include the server's state
                apply_remote(doc_to_blueprint(data))
            }
        }, error => {
            report_error('banner', error)
            reject(error as Error)
        })
    })
}


async function open_other_design(deleted_id:string):Promise<void>{
    // Open the most recent remaining design (or a fresh one) after the open design disappeared
    const other = designs.find(item => item.id !== deleted_id)
    if (other){
        await open_design(other.id)
    } else {
        await create_design()
    }
}


export async function create_design(from?:Blueprint, wizard_draft?:NewDesignDraft,
        simple_mode = true):Promise<string>{
    // Create a new design (optionally copying an existing blueprint) and open it. `wizard_draft`
    // is passed by the new-design wizard's finish step and when duplicating a wizard-created
    // design — it stashes the draft so its steps can be reopened/summarised accurately later
    // (see design_wizard above). `simple_mode` only matters when a draft is given, and is only
    // false when copying a design that has already left simple mode
    const uid = user.value!.uid
    const id = generate_token()
    const blueprint = clean_blueprint(from ? cloneDeep(from) : undefined)
    await setDoc(doc(firestore, 'designs', id), {
        schema: SCHEMA_VERSION,
        owner: uid,
        editor_uids: [uid],
        editors: {},
        share_token: generate_token(),
        name_auto: gen_name_auto(blueprint),
        save_token: generate_token(),
        created: serverTimestamp(),
        modified: serverTimestamp(),
        category: null,
        latest_version: null,
        ...(wizard_draft ? {simple_mode, wizard_draft: cloneDeep(wizard_draft)} : {}),
        ...split_blueprint_doc(blueprint),
    })
    await open_design(id)
    return id
}


// One-way: permanently leave simple mode for a design, revealing the full editor from then on
export async function leave_simple_mode(id:string):Promise<void>{
    design_wizard.simple_mode = false  // Optimistic — avoids a visible flash back before the echo
    await updateDoc(doc(firestore, 'designs', id), {simple_mode: false})
}


// Apply an edited wizard draft to the open design: rebuilds the Blueprint from the draft (the
// same transform the wizard itself uses at creation) and persists the draft alongside it, so a
// later "Change" on another step still shows accurate values. Only valid while `id` is the open
// design (blue is mutated directly, riding the existing debounced autosave in start_design_sync())
export async function apply_wizard_edit(id:string, draft:NewDesignDraft):Promise<void>{
    // The wizard never sets `blueprint.name` (its title field is the cover's title), so a name
    // set from the /designs list survives the rebuild without needing to be carried over
    const previous_name = blue.name
    Object.assign(blue, await build_new_blueprint(draft, estimated_pages.value))
    blue.name = previous_name
    design_wizard.draft = cloneDeep(draft)  // Optimistic, mirrors leave_simple_mode() above
    await updateDoc(doc(firestore, 'designs', id), {wizard_draft: cloneDeep(draft)})
}


export async function delete_design(id:string):Promise<void>{
    // Delete a design (owner only, per security rules), moving away from it if currently open
    if (current_design_id.value === id){
        save.cancel()
        unsub_doc?.()
        current_design_id.value = null
        synced = null
    }
    await deleteDoc(doc(firestore, 'designs', id))
    if (!current_design_id.value){
        await open_other_design(id)
    }
}


export async function rename_design(id:string, name:string):Promise<void>{
    // Rename a design from the /designs list, without needing to open it.
    // A rename alone isn't a content edit (the name reaches the PDF only as metadata), so it
    // deliberately leaves save_token alone rather than flagging rendered versions as stale.
    // It does carry through to the cover's printed title while the user hasn't set that
    // themselves — and *that* is a real render change, so it bumps save_token when it happens
    const trimmed = name.trim()

    // Open design: mutate and let the debounced sync diff it (flush_changes decides on
    // save_token by looking at what actually changed)
    if (id === current_design_id.value){
        blue.name = trimmed  // The cover title follows via the watcher in watchers.ts
        await flush_changes()
        return
    }

    // Closed design: read it only to decide whether the cover title should follow
    const snap = await getDoc(doc(firestore, 'designs', id))
    const cover = ((snap.data()?.['blueprint'] ?? {}) as Record<string, unknown>)['cover'] as
        CoverConfig|null|undefined
    const updates:Record<string, unknown> = {name: trimmed}
    if (trimmed && cover && !cover.title_custom){
        updates[`blueprint.cover.form.${COVER_TITLE_KEY}`] = trimmed
        updates['save_token'] = generate_token()
        updates['modified'] = serverTimestamp()
    }
    await updateDoc(doc(firestore, 'designs', id), updates)
}


export async function set_design_category(id:string, category:string|null):Promise<void>{
    // Assign (or clear) a design's category — deliberately doesn't touch modified/save_token,
    // since recategorizing isn't a content edit and shouldn't flip design_needs_version()
    await updateDoc(doc(firestore, 'designs', id), {category})
}


export async function rename_category(old_name:string, new_name:string):Promise<void>{
    // Rename a category across every design currently in it (categories aren't their own
    // collection — just a string field on each design — so renaming is a bulk field update)
    const batch = writeBatch(firestore)
    for (const design of designs.filter(item => item.category === old_name)){
        batch.update(doc(firestore, 'designs', design.id), {category: new_name})
    }
    await batch.commit()
}


export async function clear_category(name:string):Promise<void>{
    // Ungroup a category, moving every design in it back to Uncategorized
    const batch = writeBatch(firestore)
    for (const design of designs.filter(item => item.category === name)){
        batch.update(doc(firestore, 'designs', design.id), {category: null})
    }
    await batch.commit()
}


export async function duplicate_design(id:string):Promise<string>{
    // Copy a design's live blueprint into a brand new design (no version history copied).
    // A wizard-created design's draft comes along too, so a copy of a simple design is still
    // simple (and a copy of one that has left simple mode still knows its wizard answers)
    const snap = await getDoc(doc(firestore, 'designs', id))
    const data = snap.data() ?? {}
    const blueprint = doc_to_blueprint(data)
    const draft = data['wizard_draft']
        ? cloneDeep(data['wizard_draft'] as NewDesignDraft) : undefined
    return await create_design(blueprint, draft, !!data['simple_mode'])
}


export async function restore_version_into_design(design_id:string,
        version:{blueprint:Blueprint, save_token:string}):Promise<void>{
    // Destructive: bulk-replace the live design's content with a frozen version's content.
    // Callers must warn the user first — any unsaved/unrendered changes are lost
    save.cancel()
    // `name` is deliberately dropped from the split here: restoring a version restores what the
    // document *is*, not what the design is called — the user's current name stays put
    const fields = split_blueprint_doc(cloneDeep(version.blueprint))
    await updateDoc(doc(firestore, 'designs', design_id), {
        blueprint: fields.blueprint,
        content_items: fields.content_items,
        content_order: fields.content_order,
        name_auto: gen_name_auto(version.blueprint),
        save_token: version.save_token,
        modified: serverTimestamp(),
    })
    // The design's own onSnapshot listener (if open) picks up the echo and repopulates `blue`
}


// --- Sharing --------------------------------------------------------------------------------


export async function reset_design_share_token(id:string):Promise<void>{
    // Issue a fresh invite link, invalidating any previous one (owner only, per rules); also
    // used to backfill a token for designs created before sharing was always-on
    await updateDoc(doc(firestore, 'designs', id), {share_token: generate_token()})
}


export async function remove_design_editor(id:string, uid:string):Promise<void>{
    // Remove a single editor from a design (owner only, per rules); uid may contain url64
    // chars so the editors map key needs a FieldPath rather than a dotted string.
    // The invite token is rotated in the same write — the removed editor joined via the invite
    // link, so leaving it valid would let them immediately rejoin
    await updateDoc(doc(firestore, 'designs', id),
        'editor_uids', arrayRemove(uid), new FieldPath('editors', uid), deleteField(),
        'share_token', generate_token())
}


export async function fetch_design_invite_preview(id:string, token:string):Promise<{name:string}>{
    // Look up what an invite link points to, without redeeming it (see DialogAcceptInvite.vue —
    // shown before the user decides whether to accept)
    return await api<{name:string}>('/api/design_invite_preview', {design_id: id, token})
}


export async function redeem_design_share(id:string, token:string):Promise<void>{
    // Become an editor of a shared design via its secret link (server validates the token)
    await api('/api/redeem_design_invite', {design_id: id, token})
}


export async function fetch_design_editors_info(id:string):Promise<DesignEditorInfo[]>{
    // Resolve a design's owner + editors to display names/emails, for the share dialog
    const {editors} = await api<{editors:DesignEditorInfo[]}>('/api/design_editors',
        {design_id: id})
    return editors
}


// --- Boot ----------------------------------------------------------------------------------


function meta_from_doc(id:string, data:DocumentData):DesignMeta{
    // Build a DesignMeta list entry from a Firestore doc
    const blueprint = (data['blueprint'] ?? {}) as Record<string, unknown>
    const bibles = (blueprint['bibles'] ?? []) as string[]
    return {
        id,
        // Resolved at read time off the raw doc fields, like content_summary below — nothing
        // needs the fully-resolved name stored, and deriving it means it can never drift
        name: resolve_design_name(
            (data['name'] ?? '') as string,
            get_cover_title(blueprint['cover'] as CoverConfig|null),
            (data['name_auto'] ?? '') as string,
        ),
        owner: data['owner'] as string,
        shared: (data['editor_uids'] as string[]).length > 1,
        editor_count: (data['editor_uids'] as string[]).length,
        share_token: (data['share_token'] ?? null) as string|null,
        save_token: data['save_token'] as string,
        created: ((data['created'] ?? Timestamp.now()) as Timestamp).toDate(),
        modified: ((data['modified'] ?? Timestamp.now()) as Timestamp).toDate(),
        category: (data['category'] ?? null) as string|null,
        content_summary: content_summary(data, bibles[0]),
        latest_version: (data['latest_version'] ?? null) as DesignMeta['latest_version'],
        paper: {
            service_id: (blueprint['service_id'] ?? '') as string,
            size_id: (blueprint['size_id'] ?? '') as string,
            custom_unit: (blueprint['custom_unit'] ?? 'mm') as 'mm'|'inch',
            custom_trim_width: (blueprint['custom_trim_width'] ?? 0) as number,
            custom_trim_height: (blueprint['custom_trim_height'] ?? 0) as number,
            booklet: (blueprint['booklet'] ?? false) as boolean,
            bibles,
        },
    }
}


export async function init_designs(open_id:string|null = null):Promise<void>{
    // Boot the designs system: live list sync, then open the requested design (from a share
    // link), else the most recent one, else create the user's first design
    const uid = user.value!.uid
    const designs_query = query(collection(firestore, 'designs'),
        where('editor_uids', 'array-contains', uid), orderBy('modified', 'desc'))

    // Keep the designs list in sync
    unsub_list?.()
    unsub_list = onSnapshot(designs_query, snap => {
        designs.splice(0, designs.length, ...snap.docs.map(item => {
            return meta_from_doc(item.id, item.data({serverTimestamps: 'estimate'}))
        }))
        resolve_designs_loaded()
    }, error => {
        report_error('banner', error)
    })

    // Open the requested design if it's actually one of ours (e.g. a deep link to a design
    // whose access was since revoked isn't, and a bare /designs/:id for someone else's design
    // never was) — else the most recent, else create the user's first. Checking membership
    // first (rather than attempting to open and catching the permission error) avoids
    // provoking a Firestore permission-denied error for what's actually a normal, expected case
    const existing = await getDocs(designs_query)
    if (existing.empty){
        // No designs yet means this is a brand new user — populate `blue` locally (never
        // persisted; flush_changes can't write while no design is open) so boot-time watchers
        // that dereference it stay safe, and show the welcome splash, which routes them into
        // the new-design wizard rather than silently creating a design they never chose
        Object.assign(blue, get_default_blueprint())
        state.splash = true
    } else if (open_id && existing.docs.some(item => item.id === open_id)){
        await open_design(open_id)
    } else {
        await open_design(existing.docs[0]!.id)
    }
}


export function start_viewed_sync():void{
    // Keep the "Read access" list (/designs) mirrored from Firestore
    const uid = user.value!.uid
    unsub_viewed?.()
    unsub_viewed = onSnapshot(
        query(collection(firestore, 'users', uid, 'viewed'), orderBy('last_viewed', 'desc')),
        snap => {
            viewed_designs.splice(0, viewed_designs.length, ...snap.docs.map(item => {
                const data = item.data({serverTimestamps: 'estimate'})
                return {
                    design_id: data['design_id'] as string,
                    title: data['title'] as string,
                    last_version_id: data['last_version_id'] as string,
                    last_viewed: ((data['last_viewed'] ?? Timestamp.now()) as Timestamp).toDate(),
                }
            }))
        },
        error => {
            report_error('banner', error)
        })
}
