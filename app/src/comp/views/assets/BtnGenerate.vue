
<template lang='pug'>

v-btn-group(rounded='pill' divided color='secondary-darken-1' variant='elevated')
    v-btn(@click='generate' :disabled='!blue.content.length || !typst_generator || blocked'
        :loading='generating') {{$t("view.design.build_it")}}
    v-btn(v-if='latest_version' @click='view_versions' icon
            v-tooltip:top='$t("common.versions")')
        app-icon(name='history_toggle_off')

</template>


<script lang='ts' setup>

import {ref, computed} from 'vue'
import {useRouter} from 'vue-router'

import {blue, print_service_warning_dialog} from '@/services/state'
import {current_design_id, flush_changes} from '@/services/designs'
import {selected_version_id, latest_version} from '@/services/versions'
import {create_pending_version, compile_and_upload} from '@/services/version_compile'
import {hold_page} from '@/services/compile_progress'
import {has_seen_print_service_warning, record_seen_print_service_warning}
    from '@/services/user_prefs'
import {typst_generator} from '@/services/typst'
import {collect_passage_books, has_missing_books} from '@/services/blueprints'
import {resolve_content_for_style} from '@/services/content_images'
import {report_error} from '@/services/errors'


const router = useRouter()


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

const generate = async () => {

    // Compiler must be ready (the button is disabled until it is, but guard anyway)
    if (!typst_generator.value || !current_design_id.value){
        return
    }

    // Shown as loading from here on — style resolution below can take a moment the first time a
    // painted/torn image needs processing, same as the compile step already did
    generating.value = true
    // Set once the freeze starts (after any print-service warning, which is only a wait on the user)
    let release_page:(() => void)|null = null
    try {
        // Force-flush any pending autosave so the design's persisted save_token always matches
        // what gets frozen below (the debounced autosave alone can't guarantee this at
        // click-time)
        await flush_changes()

        // Freeze the current design into an immutable pending version (a deep clone, so later
        // edits to `blue` won't affect this in-flight version). Painted/torn images are swapped
        // for their processed variant here — before the version doc is written, since Firestore
        // rules forbid ever patching `blueprint` afterwards (see content_images.ts)
        const design_id = current_design_id.value
        const styled_content = await resolve_content_for_style(design_id, blue.content,
            blue.image_style)
        const blueprint = {...blue, content: styled_content}

        // Real printing services (i.e. not printing at home) need a physical print run the
        // user can't easily undo, so warn once, the first time this account creates such a
        // version, and require them to acknowledge it before continuing
        if (blueprint.service_id !== 'home' && !await has_seen_print_service_warning()){
            await print_service_warning_dialog()
            await record_seen_print_service_warning()
        }

        // Warn before leaving the page from the freeze onwards — compile_and_upload takes its own
        // hold synchronously when called, so handing over to it leaves no gap between the two
        release_page = hold_page()
        const job = await create_pending_version(design_id, blueprint)

        // Switch to the version view
        selected_version_id.value = job.id
        await router.push({name: 'design', params: {id: design_id, version: job.id}})

        // Compile the final PDF in-browser via Typst and upload it (status updates arrive via the
        // versions Firestore sync). The job carries everything the compile needs from this
        // design, so it's unaffected by the user opening another design meanwhile
        const compiling = compile_and_upload(job)
        release_page()
        await compiling
    } catch (error){
        // compile_and_upload handles its own failures; this covers the steps before it (freeze,
        // asset snapshotting, navigation) so a throw there surfaces to the user instead of
        // silently leaving them on the editor with a half-created version
        report_error('banner', error)
    } finally {
        release_page?.()
        generating.value = false
    }
}

</script>


<style lang='sss' scoped>

</style>
