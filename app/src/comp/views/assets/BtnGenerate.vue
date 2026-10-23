
<template lang='pug'>

v-btn-group(rounded='pill' divided color='secondary-darken-1' variant='elevated')
    v-btn(@click='generate' :disabled='!blue.content.length || !typst_generator || blocked'
        :loading='generating') {{$t("view.design.build_it")}}
    v-btn(v-if='latest_version' @click='view_versions' icon
            v-tooltip:top='$t("common.versions")')
        app-icon(name='history_toggle_off')

</template>


<script lang='ts' setup>

import {ref, computed, nextTick} from 'vue'
import {useRouter} from 'vue-router'

import {useI18n} from '@/services/i18n'
import {blue, print_service_warning_dialog, report_failure} from '@/services/state'
import {current_design_id, flush_changes} from '@/services/designs'
import {selected_version_id, latest_version, until_version_settled} from '@/services/versions'
import {report_error} from '@/services/errors'
import {create_pending_version, compile_and_upload} from '@/services/version_compile'
import {hold_page, build_requests, version_progress} from '@/services/compile_progress'
import {has_seen_print_service_warning, record_seen_print_service_warning}
    from '@/services/user_prefs'
import {typst_generator} from '@/services/typst'
import {collect_passage_books, has_missing_books} from '@/services/blueprints'
import {resolve_content_for_style} from '@/services/content_images'
import {ensure_page_estimate} from '@/services/page_estimate'
import {generate_token} from '@/services/utils'


const router = useRouter()
const {t} = useI18n()


// Whether a PDF is currently being compiled (disables the Build it button)
const generating = ref(false)


// Whether a selected translation is missing one of the chosen books (disables the Build it button;
// the specifics are shown in place of the preview and under the translations selector)
const blocked = computed(() => {
    return has_missing_books(collect_passage_books(blue.content), blue.bibles)
})


const view_versions = async () => {
    // Jump to the latest rendered version (leaves the editor without discarding any changes)
    if (current_design_id.value && latest_version.value){
        await router.push({name: 'design',
            params: {id: current_design_id.value, version: latest_version.value.id}})
    }
}

const warn_before_printing = async (service_id:string, version_id:string) => {
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

const generate = async () => {

    // Compiler must be ready (the button is disabled until it is, but guard anyway)
    if (!typst_generator.value || !current_design_id.value){
        return
    }

    // Shown as loading from here on, until the version's page is showing it
    generating.value = true

    // Go straight to the version's page, under the id it's about to be created with, rather
    // than leaving the user on a spinning button while the steps before the freeze run (the page
    // estimate alone is a whole compile on mobile). The page shows it as preparing until its doc
    // arrives (see build_requests)
    const design_id = current_design_id.value
    const version_id = generate_token()
    build_requests[version_id] = {design_id, clicked: Date.now()}
    version_progress[version_id] = {stage: 'start'}
    let version_created = false

    // Set once the freeze starts
    let release_page:(() => void)|null = null
    try {
        selected_version_id.value = version_id
        await router.push({name: 'design', params: {id: design_id, version: version_id}})
        generating.value = false

        // Bring the page-count estimate up to date first (mobile has no live preview keeping it
        // current), and let its watchers settle — simple mode derives the binding from it, which
        // has to land in the design before it's flushed and frozen
        await ensure_page_estimate()
        await nextTick()

        // Force-flush any pending autosave so the design's persisted save_token always matches
        // what gets frozen below (the debounced autosave alone can't guarantee this at
        // click-time)
        await flush_changes()

        // The user is free to leave the version's page meanwhile, and `blue` is whichever design
        // is open, so a build whose design was switched away from is abandoned rather than
        // freezing another design under this one
        if (current_design_id.value !== design_id){
            return
        }

        // Freeze the current design into an immutable pending version (a deep clone, so later
        // edits to `blue` won't affect this in-flight version). Painted/torn images are swapped
        // for their processed variant here — before the version doc is written, since Firestore
        // rules forbid ever patching `blueprint` afterwards (see content_images.ts)
        const styled_content = await resolve_content_for_style(design_id, blue.content,
            blue.image_style)
        const blueprint = {...blue, content: styled_content}

        // Warn before leaving the page from the freeze onwards — compile_and_upload takes its own
        // hold synchronously when called, so handing over to it leaves no gap between the two
        release_page = hold_page()
        const job = await create_pending_version(design_id, blueprint, version_id)
        version_created = true

        // Compile the final PDF in-browser via Typst and upload it (status updates arrive via the
        // versions Firestore sync). The job carries everything the compile needs from this
        // design, so it's unaffected by the user opening another design meanwhile
        const compiling = compile_and_upload(job)
        release_page()
        await compiling
        void warn_before_printing(blueprint.service_id, version_id)
    } catch (error){
        // compile_and_upload handles its own failures; this covers the steps before it (freeze,
        // asset snapshotting, navigation) so a throw there surfaces to the user instead of
        // silently leaving them on a version that will never arrive
        report_failure(error, t("view.design.build_failed"))
        if (!version_created && router.currentRoute.value.params['version'] === version_id){
            await router.replace({name: 'design', params: {id: design_id}})
        }
    } finally {
        release_page?.()
        generating.value = false
        // Kept once the version exists, to keep timing it from the click through any server
        // fallback (a retry or regeneration starts its own clock, see build_requests)
        if (!version_created){
            delete build_requests[version_id]
            delete version_progress[version_id]
        }
    }
}

</script>


<style lang='sss' scoped>

</style>
