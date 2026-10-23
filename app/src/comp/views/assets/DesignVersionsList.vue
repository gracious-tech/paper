
<template lang='pug'>

div(v-if='!versions.length && !preparing' class='pa-4 pt-10 text-center')
    | {{$t("view.version_list.none_yet")}}

template(v-else)
    div.summary
        //- Describes the latest version, so not while a newer one is on its way
        h2.summary_title(v-if='!preparing') {{ latest_version?.title }}
        div.summary_pills(v-if='latest_version && !preparing')
            v-chip(size='small' variant='tonal' color='primary')
                template(#prepend)
                    app-icon(name='straighten')
                | {{ paper_size_label }}
            v-chip(size='small' variant='tonal' color='primary')
                template(#prepend)
                    app-icon(name='menu_book')
                | {{ bibles_label }}
            v-chip(size='small' variant='tonal' color='primary')
                template(#prepend)
                    app-icon(name='subject')
                | {{ content_label }}
            v-chip(v-if='pages_label' size='small' variant='tonal' color='primary')
                template(#prepend)
                    app-icon(name='description')
                | {{ pages_label }}
            v-chip(size='small' variant='tonal' color='primary')
                template(#prepend)
                    app-icon(name='print')
                | {{ service_label }}
        //- Latest version still generating. Below 900px AppRoot hides the preview pane and its
        //- full progress screen, so this compact card carries the same readout there: time
        //- elapsed, and the current stage while this tab is the one compiling it. Also a build
        //- clicked here whose version doc hasn't arrived yet (see build_requests)
        div.mobile_pending(v-if='latest_pending || preparing')
            div(class='text-title-medium') {{ $t("display.version.preparing") + '…' }}
            div(class='text-display-small my-2') {{ elapsed }}
            div(v-if='progress_text') {{ progress_text }}
            div(v-else-if='on_server') {{ $t("display.version.on_server") }}
            div(class='mt-2 text-body-small') {{ $t("display.version.typical_time") }}
        //- Latest version couldn't be fully generated — the whole compile failed, it was
        //- abandoned mid-compile (stuck), or the interior compiled and only its wraparound cover
        //- render failed (a cover-only retry).
        //- A full alert bar (with its own "Try again") rather than just the row icon, so a
        //- mobile user — who never sees the preview pane's failure screen — can still act.
        //- Older versions get the same message + retry in a click-through dialog.
        v-alert(v-if='failure_alert && !preparing' class='mt-3 text-left bg-error-lighten-2')
            div.compile_error
                app-icon.compile_error_icon(name='error')
                span {{ failure_alert.message }}
            div.compile_error_actions
                v-btn(v-if='failure_alert.retry' @click='failure_alert.retry' size='small'
                        variant='flat' color='white' :loading='failure_alert.loading')
                    | {{ $t("common.try_again") }}
                v-btn(:href='contact_url' target='_blank' size='small' variant='tonal'
                        color='white') {{ $t("display.version.contact") }}
        //- Binding page-limit warning. It lives here in the always-visible version summary
        //- rather than in the preview pane (like the thinner "you're viewing an old render"
        //- advisory strip) on purpose: that strip only concerns what the on-screen preview is
        //- showing, so it's fine for it to be hidden with the whole preview pane below 900px —
        //- but a finished document that broke its binding's page limit can't be printed as
        //- designed, which a mobile user needs to see just as much as a desktop one.
        v-alert(v-if='binding_warning && !preparing' density='compact' type='error'
                class='mt-3 text-left bg-error-lighten-2')
            div {{ binding_warning.text }}
            div(v-if='binding_warning.too_many' class='text-right')
                v-btn(@click='state.page_suggestions = true' size='small' variant='flat'
                    class='mt-2' color='error') {{ $t("page_suggestions.button") }}
        v-alert(v-if='sheets_warning && !preparing' :color='sheets_warning.color' type='warning' density='compact'
                class='mt-3 text-left')
            div {{ sheets_warning.text }}
            div(class='text-right')
                v-btn(@click='state.page_suggestions = true' size='small' variant='flat'
                    class='mt-2' :color='`${sheets_warning.color}-darken-2`') {{ $t("page_suggestions.button") }}

    //- PDF + printing actions, shown only where the preview toolbar isn't (below 900px,
    //- where AppRoot hides the whole preview pane). Same controls as the preview toolbar in
    //- DisplayDesignVersion.vue — one centred row above the latest version card — except the
    //- PDFs open in a new tab rather than downloading, since there's no preview to see them in
    div.mobile_actions(v-if='downloads_ready && !preparing')
        v-btn(@click='open_interior' variant='tonal' color='secondary-darken-1')
            | {{ $t("view.version.open_interior") }}
        v-btn(v-if='has_cover' @click='open_cover' variant='tonal'
                color='secondary-darken-1' :disabled='cover_failed || cover_pending'
                :loading='cover_pending')
            | {{ $t("view.version.open_cover") }}
        v-btn(v-if='quotable' variant='tonal' color='' @click='show_estimate_cost')
            | {{ $t("display.version.estimate_cost") }}
        v-btn.how_to_print(variant='tonal' color='' @click='show_how_to_print')
            | {{ $t("display.version.how_to_print") }}

    v-list(bg-color='transparent' class='version_list flex-grow-1')
        DesignVersionItem(v-if='latest_version' :version='latest_version' :design_id='design_id'
            :is_latest='true' :editable='editable' class='latest_version')
        //- Non-editors get a "keep a copy" action here; for editors the changes button now
        //- lives inside the latest version row (its colour signals unrendered changes)
        div.after_latest(v-if='!editable')
            slot(name='after-latest')
        template(v-if='versions.length > 1')
            v-list-subheader {{$t("view.version_list.previous")}}
            DesignVersionItem(v-for='version of versions.slice(1)' :key='version.id'
                :version='version' :design_id='design_id' :editable='editable')

</template>


<script lang='ts' setup>

import {computed, ref} from 'vue'
import {useI18n, count_phrase} from '@/services/i18n'
import {PassageReference} from '@gracious.tech/fetch-client'

import {versions, latest_version, version_expired, open_version_pdf, preparing_version,
    cover_failed as version_cover_failed, cover_pending as version_cover_pending,
    version_contact_url, version_retryable, use_pending_clock, compiling_on_server}
    from '@/services/versions'
import {regenerate_version, regenerate_cover, retry_version} from '@/services/version_compile'
import {version_progress, stage_text} from '@/services/compile_progress'
import {state, report_failure} from '@/services/state'
import {format_paper_size, format_service_label, format_pages_label, get_passages}
    from '@/services/blueprints'
import {binding_page_issue} from '@/services/binding_advice'
import {content} from '@/services/content'
import {lulu_pod_package_id} from '@/services/print_cost'
import DesignVersionItem from './DesignVersionItem.vue'


const {t} = useI18n()


const props = defineProps<{design_id:string, editable:boolean}>()


// The version Build it was clicked for here, while its doc is still on its way
const preparing = computed(() => preparing_version(props.design_id))


// Paper size pill, e.g. "A4 (210 × 297 mm)", resolved from the latest rendered version (never
// unsaved/un-created changes to the open design)
const paper_size_label = computed(() => {
    return latest_version.value ? format_paper_size(latest_version.value.blueprint) : ''
})


// Bible translation(s) pill, e.g. "New International Version + King James Version"
const bibles_label = computed(() => {
    if (!latest_version.value){
        return ''
    }
    return latest_version.value.blueprint.bibles.map(id => {
        const trans = content.translations[id]
        return trans ? (trans.name_abbrev) : id
    }).join(' + ')
})


// Content pill: the single passage's reference, or a count when there are several (or none)
const content_label = computed(() => {
    if (!latest_version.value){
        return ''
    }
    const passages = get_passages(latest_version.value.blueprint)
    if (!passages.length){
        return t("view.version_list.no_passages")
    }
    if (passages.length === 1){
        return content.collection.reference_to_string(new PassageReference(passages[0]!),
            latest_version.value.blueprint.bibles[0])
    }
    return count_phrase(t, 'view.version_list.passages', passages.length)
})


// Page count pill, only once the latest version has finished rendering (see format_pages_label())
const pages_label = computed(() => {
    if (!latest_version.value){
        return null
    }
    return format_pages_label(latest_version.value.pages, latest_version.value.blueprint.booklet, t)
})


// Binding page-limit warning, latest rendered version only. Definite (the document has been
// produced), unlike the soft estimate-based warning shown in OptionsPaper while designing.
// Moved here from the preview pane so it survives the preview being hidden on mobile — see the
// note on the template alert and in DisplayDesignVersion.vue. States direction + limit so the
// fix (change the binding, create a new version) isn't a guess.
const binding_warning = computed(() => {
    const version = latest_version.value
    if (!version || version.status !== 'available' || version.pages === null){
        return null
    }
    const issue = binding_page_issue(version.blueprint, version.pages)
    if (!issue){
        return null
    }
    const key = issue.fewer
        ? 'view.version_list.binding_min_warning'
        : 'view.version_list.binding_max_warning'
    // Suggestions only ever reduce the page count, so they're no help when the document is
    // too short for the binding
    return {text: t(key, {name: issue.name, limit: issue.limit, final: version.pages}),
        too_many: !issue.fewer}
})


// Whether a retry of the failed latest version is in flight (drives the button's spinner)
const retrying = ref(false)


// Time since the latest version's compile began, and whether it was abandoned mid-compile
const {elapsed, stuck} = use_pending_clock(() => latest_version.value,
    () => preparing.value?.clicked ?? null)


// Whether the latest version is still generating (and not abandoned — see stuck)
const latest_pending = computed(() => {
    return latest_version.value?.status === 'pending' && !stuck.value
})


// The current in-browser compile stage of the latest version (e.g. "Writing Genesis (1/66)"),
// null when another tab or the server is compiling it (see version_progress)
const progress_text = computed(() => {
    const id = preparing.value?.id ?? latest_version.value?.id
    const event = id ? version_progress[id] : undefined
    return event ? stage_text(event, t) : null
})


// Whether the latest version's interior is available but its cover render failed (also gates
// the mobile "Download cover" button)
const cover_failed = computed(() => {
    return !!latest_version.value && version_cover_failed(latest_version.value)
})


// Whether the latest version's interior is available while the server renders its cover
const cover_pending = computed(() => {
    return !!latest_version.value && version_cover_pending(latest_version.value)
})


// Whether the server has taken over the latest version's compile
const on_server = computed(() => {
    return !!latest_version.value && compiling_on_server(latest_version.value)
})


// Whether a cover-only retry of the latest version is in flight
const retrying_cover = ref(false)


// Re-render just the latest version's cover from its frozen blueprint (see regenerate_cover)
const retry_cover = async () => {
    if (!latest_version.value){
        return
    }
    retrying_cover.value = true
    try {
        await regenerate_cover(latest_version.value)
    } catch (error){
        report_failure(error, t("common.action_failed"))
    } finally {
        retrying_cover.value = false
    }
}


// Support-contact link for the failed latest version, prefilled with its identifying debug ref
const contact_url = computed(() => version_contact_url(latest_version.value))


// Recompile the failed latest version from its frozen blueprint (see regenerate_version)
const retry_compile = async () => {
    if (!latest_version.value){
        return
    }
    retrying.value = true
    try {
        await regenerate_version(latest_version.value)
    } finally {
        retrying.value = false
    }
}


// Hand the stuck latest version to the server compile (see version_stuck / retry_version)
const retry_stuck = async () => {
    if (!latest_version.value){
        return
    }
    retrying.value = true
    try {
        await retry_version(latest_version.value)
    } catch (error){
        report_failure(error, t("common.action_failed"))
    } finally {
        retrying.value = false
    }
}


// The latest version's failure state, if any — a full compile failure, an abandoned compile, or
// an interior-compiled / cover-failed one (mutually exclusive by status). Drives
// the alert bar's message + which retry it runs. Shown here rather than only in the preview
// pane so a mobile user, who can't see that pane, still gets the message and a way to act.
// `retry` is only offered when the current user owns the version — Storage/Firestore rules
// restrict the write it triggers to that uid specifically (not just any design editor), so
// anyone else's click would only ever fail (see version_retryable)
const failure_alert = computed(() => {
    const retryable = !!latest_version.value && version_retryable(latest_version.value)
    if (latest_version.value?.status === 'failed'){
        return {message: t("view.version_list.compile_error"),
            retry: retryable ? retry_compile : null, loading: retrying.value}
    }
    if (stuck.value){
        return {message: t("display.version.taking_long") + ' '
                + t("display.version.interrupted"),
            retry: retryable ? retry_stuck : null, loading: retrying.value}
    }
    if (cover_failed.value){
        return {message: t("view.version_list.cover_failed"),
            retry: retryable ? retry_cover : null, loading: retrying_cover.value}
    }
    return null
})


// Booklet sheet-count warning, latest version only — flags when the fold-at-home booklet
// grows thick enough that folding/stapling by hand gets difficult. Same rendered-and-available
// guard as binding_warning so a stale page count from the previous compile can't keep the alert
// up while the latest version is regenerating
const sheets_warning = computed(() => {
    const version = latest_version.value
    if (!version || version.status !== 'available' || version.pages === null
            || !version.blueprint.booklet){
        return null
    }
    const sheets = Math.ceil(version.pages / 2)
    if (sheets > 20){
        return {color: 'error',
            text: t("view.version_list.sheets_hard", {sheets})}
    }
    if (sheets > 15){
        return {color: 'warning',
            text: t("view.version_list.sheets_tricky", {sheets})}
    }
    return null
})


// Printing service pill, e.g. a real service's name, or "Booklet (fold at home)"/"Home"/"Custom…"
// for the service-less modes
const service_label = computed(() => {
    return latest_version.value ? format_service_label(latest_version.value.blueprint, t) : ''
})


// Whether the latest version has a downloadable PDF (gates the mobile action row)
const downloads_ready = computed(() => {
    const version = latest_version.value
    return !!version && version.status === 'available' && !version_expired(version)
})


// Whether the latest version has a separate cover PDF to offer alongside the interior
const has_cover = computed(() => {
    return !!latest_version.value?.blueprint.cover
})


// Open the latest version's interior PDF in a new tab (tab opened synchronously so popup
// blockers credit the click as a user gesture — see open_version_pdf)
const open_interior = () => {
    if (latest_version.value){
        void open_version_pdf(self.open('', '_blank'), latest_version.value, 'interior')
    }
}


// Open the latest version's separate cover PDF in a new tab
const open_cover = () => {
    if (latest_version.value){
        void open_version_pdf(self.open('', '_blank'), latest_version.value, 'cover')
    }
}


// Open the printing guidance for the latest version, tailored to its printing service
const show_how_to_print = () => {
    if (latest_version.value){
        state.how_to_print = latest_version.value
    }
}


// Whether the latest version can be priced (Lulu only — see DisplayDesignVersion's `quotable`)
const quotable = computed(() => {
    const version = latest_version.value
    return !!version?.pages && !!lulu_pod_package_id(version.blueprint)
})


// Open the Lulu cost estimate for the latest version
const show_estimate_cost = () => {
    if (latest_version.value){
        state.estimate_cost = latest_version.value
    }
}

</script>


<style lang='sss' scoped>

.summary
    padding: 16px 16px 18px 16px
    text-align: center

.summary_title
    margin-bottom: 16px

.summary_pills
    display: flex
    flex-wrap: wrap
    justify-content: center
    gap: 8px
    margin-bottom: 24px


// Mobile progress card for a generating latest version, in the same moving gradient as the
// preview pane's progress screen (DisplayDesignVersion.vue). Hidden above 900px, where that
// screen is visible instead
.mobile_pending
    margin-top: 12px
    padding: 16px
    border-radius: 8px
    color: white
    background: linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab)
    background-size: 400% 400%
    animation: mobile_pending 20s ease infinite
    @media (min-width: 901px)
        display: none

@keyframes mobile_pending
    0%
        background-position: 0% 50%
    50%
        background-position: 100% 50%
    100%
        background-position: 0% 50%


// Compile-failure alert: an icon + message row, then a centred row of actions beneath it
.compile_error
    display: flex
    align-items: center
    gap: 8px
    line-height: 1.3

.compile_error_icon
    flex-shrink: 0
    height: 24px
    width: 24px
    color: rgb(var(--v-theme-error-darken-2))

.compile_error_actions
    display: flex
    flex-wrap: wrap
    justify-content: center
    gap: 8px
    margin-top: 12px

.summary_pills .icon
    height: 16px
    width: 16px
    margin-right: 6px

// Room around the rows so the outlined current-version card and the selected-row wash read as
// distinct blocks rather than sitting flush against the container edges
.version_list
    padding: 8px 12px

// Current version: an outlined "card" lifted off the plain rows with a faint primary tint
// (composes with the selected-row wash + accent bar when the latest version is also open)
.latest_version
    font-weight: bold
    border: 1px solid rgba(var(--v-theme-primary), 0.35)
    border-radius: 8px
    background-color: rgba(var(--v-theme-primary), 0.04)
    margin-bottom: 8px

.after_latest
    display: flex
    align-items: center
    justify-content: center
    gap: 12px
    padding: 16px 16px 0 16px

// One centred row of download / printing buttons above the latest version card. Only shown
// below 900px — above that the same actions sit in the preview toolbar (DisplayDesignVersion.vue)
.mobile_actions
    display: flex
    flex-wrap: wrap
    align-items: center
    justify-content: center
    gap: 8px
    padding: 16px 12px 12px 12px
    @media (min-width: 901px)
        display: none

</style>
