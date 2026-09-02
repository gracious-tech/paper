
<template lang='pug'>

v-list-item(:active='!is_mobile && version.id === selected_version_id' color='primary'
        v-on='is_mobile ? {} : {click: select}')
    //- Version age as a relative label ("3 hours ago"); hover for the exact local date + time.
    //- The latest row also carries the "open editor" button, vertically centred beside the
    //- title + date block — its colour signals unrendered design changes (warning) or none.
    div.title_row
        div
            v-list-item-title
                strong(v-if='is_latest') {{ $t("view.version.latest") }}
                span(v-else v-tooltip='created_exact') {{ created_relative }}
            v-list-item-subtitle(v-if='is_latest || expired')
                span(v-if='is_latest' v-tooltip='created_exact') {{ created_relative }}
                template(v-if='expired') &nbsp;— {{$t("view.version.expired")}}
        v-btn(v-if='is_latest && editable' @click.stop='view_changes' variant='flat' size='small'
                :color='design_needs_editor ? "warning" : "secondary"')
            | {{ design_needs_editor ? $t("view.design.unapplied_changes") : $t("common.edit") }}
    template(#append)
        div.status
            v-progress-circular(v-if='version.status === "pending" && !stuck' indeterminate
                size='32' color='secondary')
            app-icon(v-else-if='version.status === "failed" || stuck' name='error'
                class='text-error')
            //- The document compiled, but its actual page count broke its chosen binding.
            //- The latest version gets a full alert bar in DesignVersionsList's summary; older
            //- versions only have room for this icon, so clicking it opens the same full text
            //- in a dismissable dialog (the tooltip is just the short form / hover hint).
            v-btn(v-else-if='binding_issue' icon variant='text' size='small' color='error'
                    v-tooltip='binding_issue_message' @click.stop='show_binding_detail')
                app-icon(name='error')
        v-menu
            template(#activator='{props}')
                v-btn(v-bind='props' icon variant='text' color='black' @click.stop)
                    app-icon(name='more_vert')
            v-list
                v-list-item(@click='download'
                        :disabled='version.status !== "available" || expired')
                    v-list-item-title {{$t("view.version.open_interior")}}
                v-list-item(v-if='version.blueprint.cover' @click='download_cover'
                        :disabled='version.status !== "available" || expired')
                    v-list-item-title {{$t("view.version.open_cover")}}
                template(v-if='editable')
                    v-list-item(v-if='expired || version.status === "failed"' @click='regen')
                        v-list-item-title {{$t("common.regenerate")}}
                    v-list-item(v-else-if='stuck' @click='retry')
                        v-list-item-title {{$t("common.try_again")}}
                    v-list-item(@click='edit_in_place')
                        v-list-item-title {{$t("common.edit")}}
                    v-list-item(@click='duplicate')
                        v-list-item-title {{$t("view.version.copy_as_design")}}
                v-list-item(@click='share' :disabled='version.status === "pending"')
                    v-list-item-title {{$t("common.share")}}
                v-list-item(v-if='editable' @click='remove'
                        :disabled='version.status === "pending" && !stuck')
                    v-list-item-title {{$t("common.delete")}}
    DialogShareVersion(v-model='show_share' :design_id='design_id' :version_id='version.id')

</template>


<script lang='ts' setup>

import {computed, ref, watch, onUnmounted} from 'vue'
import {useDisplay} from 'vuetify'
import {useI18n} from '@/services/i18n'
import {useRouter} from 'vue-router'

import DialogShareVersion from '@/comp/dialogs/DialogShareVersion.vue'
import {state, show_toast, confirm_dialog, alert_dialog} from '@/services/state'
import {report_error} from '@/services/errors'
import {binding_page_issue} from '@/services/blueprints'
import {create_design, restore_version_into_design} from '@/services/designs'
import {open_version_pdf, delete_version, regenerate_version, retry_version, version_expired,
    version_stuck, share_version, selected_version_id, design_needs_editor} from '@/services/versions'
import {format_relative_time, format_datetime} from '@/services/utils'

import type {Version} from '@/services/types'


const {t} = useI18n()
const router = useRouter()
const {width} = useDisplay()


// Below the 900px preview-pane breakpoint the row is info-only — the preview it would select
// into is hidden (see AppRoot), so click-to-select is dropped and only the menu / action
// buttons stay live
const is_mobile = computed(() => width.value <= 900)


const props = defineProps<{version:Version, design_id:string, is_latest?:boolean,
    editable:boolean}>()


// Whether the share dialog is open
const show_share = ref(false)


// Ticking clock so `stuck` re-evaluates while a version sits pending; only runs while it's
// actually pending (started/stopped by the watcher below)
const now = ref(Date.now())
let tick:ReturnType<typeof setInterval>|null = null

watch(() => props.version.status, status => {
    if (tick){
        clearInterval(tick)
        tick = null
    }
    if (status === 'pending'){
        tick = setInterval(() => {
            now.value = Date.now()
        }, 5000)
    }
}, {immediate: true})

onUnmounted(() => {
    if (tick){
        clearInterval(tick)
    }
})


// Whether this pending version's compile was almost certainly abandoned (see version_stuck) —
// swaps the spinner for a retry affordance instead of an indefinite one
const stuck = computed(() => {
    void now.value
    return version_stuck(props.version)
})


// Whether the PDF has passed its 1-year Storage lifetime (metadata remains, can regenerate)
const expired = computed(() => version_expired(props.version))


// When this version was created — a relative label ("3 hours ago") for the row, with the exact
// local date + time surfaced on hover
const created_relative = computed(() => format_relative_time(props.version.created))
const created_exact = computed(() => format_datetime(props.version.created))


// Whether the produced document's actual page count isn't supported by its chosen binding,
// and if so whether it fell short or ran over. Skipped for the latest version — it already
// gets the full alert bar in DesignVersionsList's summary just above this row
const binding_issue = computed(() => {
    return !props.is_latest && props.version.status === 'available' && props.version.pages !== null
        ? binding_page_issue(props.version.blueprint, props.version.pages)
        : null
})


// Tooltip text explaining the binding issue above (fewer/more pages than the binding supports)
const binding_issue_message = computed(() => {
    if (!binding_issue.value){
        return ''
    }
    const key = binding_issue.value.fewer
        ? 'view.version.binding_min'
        : 'view.version.binding_max'
    return t(key, {limit: binding_issue.value.limit})
})


// Full binding-issue explanation (binding name, limit, and this version's actual page count) —
// shown in a dismissable dialog when the warning icon is clicked. Mirrors the alert bar the
// latest version gets in DesignVersionsList's summary
const show_binding_detail = () => {
    if (!binding_issue.value || props.version.pages === null){
        return
    }
    const key = binding_issue.value.fewer
        ? 'view.version_list.binding_min_warning'
        : 'view.version_list.binding_max_warning'
    void alert_dialog(t(key, {name: binding_issue.value.name, limit: binding_issue.value.limit,
        final: props.version.pages}))
}


const select = () => {
    void router.push({name: 'design', params: {id: props.design_id, version: props.version.id}})
}

const view_changes = () => {
    // Force the design's editor open (even when it currently matches a rendered version) and
    // navigate to the bare design route — mirrors ViewDesign's own show_editor gate
    state.forced_editor = true
    void router.push({name: 'design', params: {id: props.design_id}})
}

const download = () => {
    // Open the stored interior PDF in a new tab (tab opened synchronously so popup blockers
    // credit the click as a user gesture — see open_version_pdf)
    void open_version_pdf(self.open('', '_blank'), props.version, 'interior')
}

const download_cover = () => {
    // Open the version's separate cover PDF in a new tab
    void open_version_pdf(self.open('', '_blank'), props.version, 'cover')
}

const regen = async () => {
    // Recompile the expired/failed PDF from the version's frozen blueprint
    await regenerate_version(props.version)
}

const retry = async () => {
    // Re-drive a version stuck in 'pending' (its original compile never finished) back through
    // the pipeline — see version_stuck / retry_version
    try {
        await retry_version(props.version)
    } catch (error){
        report_error('banner', error)
    }
}

const duplicate = async () => {
    // Fork the version's blueprint into a brand new design (non-destructive)
    const new_id = await create_design(props.version.blueprint)
    await router.push({name: 'design', params: {id: new_id}})
}

const edit_in_place = async () => {
    // Destructive: overwrite the live design's content with this version's frozen content
    if (!await confirm_dialog(t("view.version.overwrite_note"))){
        return
    }
    await restore_version_into_design(props.design_id, props.version)
    // ?edit=1 tells ViewDesign.vue to force the editor open even though the design now matches
    // a rendered version (design_needs_editor would otherwise read false straight after restore)
    await router.push({name: 'design', params: {id: props.design_id}, query: {edit: '1'}})
}

const remove = async () => {
    await delete_version(props.version.id)
}

const share = async () => {
    // Prefer the OS share sheet or clipboard; only open a dialog if neither is available
    const result = await share_version(props.design_id, props.version.id)
    if (result === 'copied'){
        show_toast(t("common.copied"))
    } else if (result === 'manual'){
        show_share.value = true
    }
}


</script>


<style lang='sass' scoped>

.status
    width: 48px
    display: inline-flex
    justify-content: center
    align-items: center

// Title + date block with the editor button vertically centred beside it
.title_row
    display: flex
    align-items: center
    gap: 12px

.v-progress-circular
    margin: 8px

// Selected version: a stronger primary wash than Vuetify's default active state, plus a solid
// accent bar down the leading edge so the open version is unmistakable
.v-list-item.v-list-item--active
    background-color: rgba(var(--v-theme-primary), 0.14)
    box-shadow: inset 3px 0 0 0 rgb(var(--v-theme-primary))

</style>
