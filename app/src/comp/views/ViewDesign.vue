
<template lang='pug'>

div.view_design(v-if='!ready')
    v-progress-circular(indeterminate color='secondary' class='ma-auto')

//- Read-access deep link (someone else's design), not yet confirmed past the "Someone shared
//- this document with you" prompt — DialogViewedDesign (mounted globally in AppRoot) handles
//- the actual dialog, this just needs to occupy the space behind it
div.view_design(v-else-if='state.viewed_version && !state.viewed_confirmed')

div.view_design(v-else)
    template(v-if='show_editor')
        TabEditor(v-if='state.editor')
        ViewDesignSimple(v-else-if='design_wizard.simple_mode')
        ViewDesignEditor(v-else)
    template(v-else)
        DesignVersionsList(:design_id='id' :editable='is_editor')
            template(#after-latest)
                v-btn(@click='keep_copy' variant='tonal' color='secondary' :loading='keeping')
                    | {{$t("view.design.keep_copy")}}

</template>


<script lang='ts' setup>

import {computed, ref, watch} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import {useI18n} from '@/services/i18n'

import TabEditor from './TabEditor.vue'
import ViewDesignEditor from './ViewDesignEditor.vue'
import ViewDesignSimple from './ViewDesignSimple.vue'
import DesignVersionsList from './assets/DesignVersionsList.vue'
import {state, show_toast} from '@/services/state'
import {ApiError} from '@/services/api'
import {designs, designs_loaded, current_design_id, open_design, design_wizard}
    from '@/services/designs'
import {start_versions_sync, selected_version_id, latest_version, design_needs_editor,
    fetch_latest_version_id, copy_version_to_new_design} from '@/services/versions'
import {report_error} from '@/services/errors'


const route = useRoute()
const router = useRouter()
const {t} = useI18n()


const id = computed(() => route.params['id'] as string)
const version_param = computed(() => route.params['version'] as string|undefined)


// Whether this view has finished resolving whether `id` is ours (editor access) or someone
// else's (read-only, via a public version link)
const ready = ref(false)


watch(id, async new_id => {
    ready.value = false
    state.editor = null
    state.forced_editor = route.query['edit'] === '1'
    if (state.forced_editor){
        // One-shot flag — strip it so it doesn't linger in the address bar
        void router.replace({name: 'design', params: {id: new_id}})
    }

    await designs_loaded
    if (id.value !== new_id){
        return  // Stale — navigated elsewhere while awaiting
    }

    if (designs.some(item => item.id === new_id)){
        state.viewed_version = null
        if (current_design_id.value !== new_id){
            await open_design(new_id)
            if (id.value !== new_id){
                return  // Stale
            }
        }
        start_versions_sync(new_id)
        ready.value = true
    } else if (version_param.value){
        // Not an editor of this design — a public version link, show the read-only landing
        // prompt first (DialogViewedDesign), then the regular (read-only) version view once
        // confirmed — the versions list itself is publicly readable regardless of edit access
        state.viewed_version = {design_id: new_id, version_id: version_param.value}
        start_versions_sync(new_id)
        ready.value = true
    } else {
        // Not an editor and no specific version linked either — fall back to the design's
        // latest rendered version (versions are publicly readable regardless of edit access),
        // so a bare /designs/:id link works the same as sharing its latest version directly
        const latest_id = await fetch_latest_version_id(new_id)
        if (id.value !== new_id){
            return  // Stale — navigated elsewhere while awaiting
        }
        if (latest_id){
            state.viewed_version = {design_id: new_id, version_id: latest_id}
            start_versions_sync(new_id)
            ready.value = true
            void router.replace({name: 'design', params: {id: new_id, version: latest_id}})
        } else {
            // No rendered version to fall back to — not accessible at all
            await router.replace({name: 'designs'})
        }
    }
}, {immediate: true})


// The route is the source of truth for which version is selected, defaulting to the latest
// once it's known (e.g. right after a fresh render, or on first opening a rendered design)
watch([version_param, latest_version], () => {
    selected_version_id.value = version_param.value ?? latest_version.value?.id ?? null
}, {immediate: true})


// Go back to the designs list when this design stops being one of ours — deleted here, deleted
// by a co-editor while we had it open, or access revoked — rather than leaving the URL pointing
// at something that no longer exists. Watches the true→false edge specifically: someone viewing
// a public version link was never in `designs`, so this can never fire them off the page
watch(() => designs.some(item => item.id === id.value), (is_ours, was_ours) => {
    if (was_ours && !is_ours){
        void router.replace({name: 'designs'})
    }
})


// Whether the current user is an editor of this design (vs. viewing someone else's read-only,
// confirmed past the "Someone shared this document with you" prompt) — governs whether the
// version list shows edit-only actions (Regenerate/Edit/Delete, Make changes) or not
const is_editor = computed(() => designs.some(item => item.id === id.value))


// Editor shows for a bare /designs/:id when there's no rendered version yet, there are changes
// since the last one, or the user explicitly chose to keep editing — never for a specific
// /designs/:id/:version link, which always shows that version
const show_editor = computed(() => {
    return !version_param.value && (design_needs_editor.value || state.forced_editor)
})


// Whether "Keep my own copy" is in progress
const keeping = ref(false)


// Duplicate the shared design's latest version (blueprint, PDF and fonts) into a brand new
// design under the current user, then open it there (server-mediated — see copy_version_to_new_design)
const keep_copy = async () => {
    if (!latest_version.value){
        return
    }
    keeping.value = true
    try {
        const {design_id, version_id} = await copy_version_to_new_design(latest_version.value.id)
        await router.push({name: 'design', params: {id: design_id, version: version_id}})
    } catch (error){
        // A copy attempted while the version is still compiling is an expected case
        if (error instanceof ApiError && error.code === 'still_pending'){
            show_toast(t("view.design.still_generating"))
        // Hitting the daily copy cap is a refusal, not a fault — say so rather than reporting
        // it as an error, since the user can simply try again tomorrow
        } else if (error instanceof ApiError && error.code === 'quota_exceeded'){
            show_toast(t("view.design.copy_limit"))
        } else {
            report_error('banner', error)
        }
    } finally {
        keeping.value = false
    }
}

</script>


<style lang='sss' scoped>

.view_design
    display: flex
    flex-direction: column
    flex-grow: 1
    min-height: 0

</style>
