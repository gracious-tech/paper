
// Building a design: freezing the open design into a new version and compiling it. Started from
// BtnGenerate.vue, or from a phone's preview (DialogPhonePreview.vue) once the user is happy
// with what they see there

import {ref, nextTick} from 'vue'
import {cloneDeep} from 'lodash-es'

import {translate} from '@/services/i18n'
import {blue, print_service_warning_dialog, report_failure, page_count_guess}
    from '@/services/state'
import {current_design_id, flush_changes, design_wizard} from '@/services/designs'
import {selected_version_id, until_version_settled} from '@/services/versions'
import {report_error} from '@/services/errors'
import {create_pending_version, compile_and_upload} from '@/services/version_compile'
import {hold_page, build_requests, version_progress, claim_compile_turn, compiling_here}
    from '@/services/compile_progress'
import {has_seen_print_service_warning, record_seen_print_service_warning}
    from '@/services/user_prefs'
import {typst_generator} from '@/services/typst'
import {resolve_content_for_style} from '@/services/content_images'
import {fresh_estimate, estimate_pages_for, render_signature} from '@/services/page_estimate'
import {auto_binding, auto_binding_applies} from '@/services/binding_advice'
import {compiles_on_server} from '@/services/compile_mode'
import {generate_token} from '@/services/utils'

import type {Router} from 'vue-router'


// Whether a build was just asked for and its version's page isn't showing yet (the button that
// started it shows as loading meanwhile)
export const build_starting = ref(false)


async function warn_before_printing(service_id:string, version_id:string):Promise<void>{
    // Real printing services (i.e. not printing at home) need a physical print run the user
    // can't easily undo, so once this account's first such version has a PDF to look through,
    // ask them to review it before ordering copies (once per account). Waits out a server
    // fallback too, and stays quiet if the build failed, as there's nothing to review yet
    try {
        if (service_id === 'home' || await has_seen_print_service_warning()){
            return
        }
        if (await until_version_settled(version_id) !== 'available'){
            return
        }
        await print_service_warning_dialog()
        await record_seen_print_service_warning()
    } catch (error){
        // The build itself succeeded, so a failure here is no reason to tell the user anything
        report_error('silent', error)
    }
}

export async function build_design(router:Router):Promise<void>{
    // Build the open design: freeze it into a new version and compile that, taking the user
    // straight to the version's page (see below). Any failure is told to the user here

    // Compiler must be ready, unless the server compiles for this device (the button is disabled
    // until one is, but guard anyway)
    if ((!typst_generator.value && !compiles_on_server()) || !current_design_id.value){
        return
    }

    // Shown as loading from here on, until the version's page is showing it
    build_starting.value = true

    // Go straight to the version's page, under the id it's about to be created with, rather
    // than leaving the user on a spinning button while the steps before the freeze run. The page
    // shows it as preparing until its doc arrives (see build_requests)
    const design_id = current_design_id.value
    const version_id = generate_token()
    build_requests[version_id] = {design_id, clicked: Date.now()}
    version_progress[version_id] = {stage: compiling_here.value ? 'queued' : 'start'}
    let version_created = false

    // What gets built is the design as it is at the click: it can be left for the editor while
    // the build waits for its turn or measures its length, and edits made meanwhile belong in
    // the next build, not this one
    const snapshot = cloneDeep({...blue})
    const simple = design_wizard.simple_mode
    const fallback_estimate = page_count_guess()

    // Set once the freeze starts, and once this build's turn at the compiler comes
    let release_page:(() => void)|null = null
    let release_turn:(() => void)|null = null
    try {
        selected_version_id.value = version_id
        await router.push({name: 'design', params: {id: design_id, version: version_id}})
        build_starting.value = false

        // The page count is only needed before the freeze where it decides what's frozen: a
        // simple design's binding (see auto_binding), when it isn't known for this content yet
        // (mobile has no live preview keeping it current). Measuring it is a compile, so it waits
        // for this build's turn (see claim_compile_turn). Any other build is frozen straight
        // away, so it exists (and is recovered if the tab dies) from the start, and works out
        // its estimate, which only sizes the auto binding gutter, once its compile's turn comes
        // A device that builds on the server never measures in its browser (see compile_mode.ts)
        let estimate = fresh_estimate(snapshot)
        const measure_first = estimate === null && simple && !compiles_on_server()
            && auto_binding_applies(snapshot.service_id)
        if (measure_first){
            release_turn = await claim_compile_turn()
            version_progress[version_id] = {stage: 'start'}
            estimate = await estimate_pages_for(snapshot, design_id)
        }
        if (simple && estimate !== null){
            snapshot.binding_type = auto_binding(snapshot, estimate)
        }

        // Let the estimate's watchers settle (they give the open design the same binding), then
        // force-flush any pending autosave so the design's persisted save_token is current (the
        // debounced autosave alone can't guarantee this at click-time)
        await nextTick()
        await flush_changes()

        // The user is free to leave the version's page meanwhile, and the snapshot's fonts and
        // images are planned against the open design's (see create_pending_version), so a build
        // whose design was switched away from is abandoned rather than frozen half from another
        if (current_design_id.value !== design_id){
            return
        }

        // The version takes the design's own save_token if nothing was edited since the click,
        // else one of its own, so the design reads as having unbuilt changes (see
        // design_needs_editor)
        const save_token = render_signature() === render_signature(snapshot)
            ? null : generate_token()

        // Freeze the snapshot into an immutable pending version. Painted/torn images are swapped
        // for their processed variant here — before the version doc is written, since Firestore
        // rules forbid ever patching `blueprint` afterwards (see content_images.ts)
        const styled_content = await resolve_content_for_style(design_id, snapshot.content,
            snapshot.image_style)
        const blueprint = {...snapshot, content: styled_content}
        const page_estimate = estimate ?? (measure_first ? fallback_estimate
            : async () => await estimate_pages_for(snapshot, design_id) ?? fallback_estimate)

        // Warn before leaving the page from the freeze onwards — compile_and_upload takes its own
        // hold synchronously when called, so handing over to it leaves no gap between the two
        release_page = hold_page()
        const job = await create_pending_version(design_id, blueprint, version_id, page_estimate,
            save_token)
        version_created = true

        // Compile the final PDF in-browser via Typst and upload it (status updates arrive via the
        // versions Firestore sync). The job carries everything the compile needs from this
        // design, so it's unaffected by the user opening another design meanwhile. It takes over
        // this build's turn at the compiler if it has one, or waits for its own, releasing it
        // once the browser's part is done
        const compiling = compile_and_upload(job, release_turn)
        release_page()
        await compiling
        void warn_before_printing(blueprint.service_id, version_id)
    } catch (error){
        // compile_and_upload handles its own failures; this covers the steps before it (freeze,
        // asset snapshotting, navigation) so a throw there surfaces to the user instead of
        // silently leaving them on a version that will never arrive
        report_failure(error, translate("view.design.build_failed"))
        if (!version_created && router.currentRoute.value.params['version'] === version_id){
            await router.replace({name: 'design', params: {id: design_id}})
        }
    } finally {
        release_page?.()
        release_turn?.()
        build_starting.value = false
        // Kept once the version exists, to keep timing it from the click through any server
        // fallback (a retry or regeneration starts its own clock, see build_requests)
        if (!version_created){
            delete build_requests[version_id]
            delete version_progress[version_id]
        }
    }
}
