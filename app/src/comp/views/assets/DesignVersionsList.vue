
<template lang='pug'>

div(v-if='!versions.length' class='pa-4 pt-10 text-center') {{$t("view.version_list.none_yet")}}

template(v-else)
    div.summary
        h2.summary_title {{ latest_version?.title }}
        div.summary_pills
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
        //- Latest version couldn't be fully generated — either the whole compile failed, or the
        //- interior compiled and only its wraparound cover render failed (a cover-only retry).
        //- A full alert bar (with its own "Try again") rather than just the row icon, so a
        //- mobile user — who never sees the preview pane's failure screen — can still act.
        //- Older versions get the same message + retry in a click-through dialog.
        v-alert(v-if='failure_alert' class='mt-3 text-left bg-error-lighten-2')
            div.compile_error
                app-icon.compile_error_icon(name='error')
                span {{ failure_alert.message }}
            div.compile_error_actions
                v-btn(@click='failure_alert.retry' size='small' variant='flat' color='white'
                        :loading='failure_alert.loading') {{ $t("common.try_again") }}
                v-btn(:href='contact_url' target='_blank' size='small' variant='tonal'
                        color='white') {{ $t("display.version.contact") }}
        //- Binding page-limit warning. It lives here in the always-visible version summary
        //- rather than in the preview pane (like the thinner "you're viewing an old render"
        //- advisory strip) on purpose: that strip only concerns what the on-screen preview is
        //- showing, so it's fine for it to be hidden with the whole preview pane below 900px —
        //- but a finished document that broke its binding's page limit can't be printed as
        //- designed, which a mobile user needs to see just as much as a desktop one.
        v-alert(v-if='binding_warning' density='compact' type='warning'
                class='mt-3 text-left bg-error-lighten-2')
            div {{ binding_warning }}
            div(class='text-right')
                v-btn(@click='state.page_suggestions = true' size='small' variant='flat'
                    class='mt-2') {{ $t("page_suggestions.button") }}
        v-alert(v-if='sheets_warning' :color='sheets_warning.color' density='compact'
                class='mt-3 text-left')
            div {{ sheets_warning.text }}
            div(class='text-right')
                v-btn(@click='state.page_suggestions = true' size='small' variant='flat'
                    class='mt-2') {{ $t("page_suggestions.button") }}

    //- Download + printing actions, shown only where the preview toolbar isn't (below 900px,
    //- where AppRoot hides the whole preview pane). Same controls as the preview toolbar in
    //- DisplayDesignVersion.vue — one centred row above the latest version card
    div.mobile_actions(v-if='downloads_ready')
        v-btn(@click='download_interior' variant='tonal' color='secondary-darken-1')
            | {{ $t("display.version.download_interior") }}
        v-btn(v-if='has_cover' @click='download_cover' variant='tonal'
                color='secondary-darken-1' :disabled='cover_failed')
            | {{ $t("display.version.download_cover") }}
        v-btn.how_to_print(variant='tonal' color='')
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
import {useI18n} from '@/services/i18n'
import {PassageReference} from '@gracious.tech/fetch-client'

import {versions, latest_version, version_expired, download_version_pdf, regenerate_version,
    regenerate_cover, cover_failed as version_cover_failed, version_contact_url}
    from '@/services/versions'
import {report_error} from '@/services/errors'
import {state} from '@/services/state'
import {format_paper_size, format_service_label, format_pages_label, get_passages,
    binding_page_issue} from '@/services/blueprints'
import {content} from '@/services/content'
import DesignVersionItem from './DesignVersionItem.vue'


const {t} = useI18n()


defineProps<{design_id:string, editable:boolean}>()


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
    return `${passages.length} ${t("view.version_list.passages")}`
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
    return t(key, {name: issue.name, limit: issue.limit, final: version.pages})
})


// Whether a retry of the failed latest version is in flight (drives the button's spinner)
const retrying = ref(false)


// Whether the latest version's interior is available but its cover render failed (also gates
// the mobile "Download cover" button)
const cover_failed = computed(() => {
    return !!latest_version.value && version_cover_failed(latest_version.value)
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
        report_error('banner', error)
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


// The latest version's failure state, if any — a full compile failure or an interior-compiled
// / cover-failed one (mutually exclusive: a version is either 'failed' or 'available'). Drives
// the alert bar's message + which retry it runs. Shown here rather than only in the preview
// pane so a mobile user, who can't see that pane, still gets the message and a way to act
const failure_alert = computed(() => {
    if (latest_version.value?.status === 'failed'){
        return {message: t("view.version_list.compile_error"), retry: retry_compile,
            loading: retrying.value}
    }
    if (cover_failed.value){
        return {message: t("view.version_list.cover_failed"), retry: retry_cover,
            loading: retrying_cover.value}
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


// Save the latest version's interior PDF to disk (see download_version_pdf)
const download_interior = () => {
    if (latest_version.value){
        void download_version_pdf(latest_version.value, 'interior')
    }
}


// Save the latest version's separate cover PDF to disk
const download_cover = () => {
    if (latest_version.value){
        void download_version_pdf(latest_version.value, 'cover')
    }
}

</script>


<style lang='sass' scoped>

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
