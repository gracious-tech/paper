
<template lang='pug'>

div(v-if='!versions.length' class='pa-4 pt-10 text-center') {{$t("No versions (yet)")}}

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
        v-alert(v-if='sheets_warning' :color='sheets_warning.color' density='compact'
                class='mt-3 text-left')
            | {{ sheets_warning.text }}

    v-list(bg-color='transparent' class='flex-grow-1')
        DesignVersionItem(v-if='latest_version' :version='latest_version' :design_id='design_id'
            :is_latest='true' :editable='editable' class='latest_version')
        div.after_latest
            v-chip(v-if='editable && design_needs_editor' size='small' variant='flat'
                    color='warning'
                    :title='$t("This design has changes since this version was created")')
                | {{ $t("Unapplied changes") }}
            slot(name='after-latest')
        template(v-if='versions.length > 1')
            v-list-subheader {{$t("Previous versions")}}
            DesignVersionItem(v-for='version of versions.slice(1)' :key='version.id'
                :version='version' :design_id='design_id' :editable='editable')

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useI18n} from 'vue-i18n'
import {PassageReference} from '@gracious.tech/fetch-client'

import {versions, latest_version, design_needs_editor} from '@/services/versions'
import {format_paper_size, format_service_label, format_pages_label, get_passages}
    from '@/services/blueprints'
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
        return t("No passages")
    }
    if (passages.length === 1){
        return content.collection.reference_to_string(new PassageReference(passages[0]!),
            latest_version.value.blueprint.bibles[0])
    }
    return `${passages.length} ${t("passages")}`
})


// Page count pill, only once the latest version has finished rendering (see format_pages_label())
const pages_label = computed(() => {
    if (!latest_version.value){
        return null
    }
    return format_pages_label(latest_version.value.pages, latest_version.value.blueprint.booklet, t)
})


// Booklet sheet-count warning, latest version only — flags when the fold-at-home booklet
// grows thick enough that folding/stapling by hand gets difficult
const sheets_warning = computed(() => {
    const pages = latest_version.value?.pages
    if (pages == null || !latest_version.value!.blueprint.booklet){
        return null
    }
    const sheets = Math.ceil(pages / 2)
    if (sheets > 20){
        return {color: 'error',
            text: `${sheets} ${t("sheets is a lot to fold and staple by hand — a printing service may work better")}`}
    }
    if (sheets > 15){
        return {color: 'warning',
            text: `${sheets} ${t("sheets may be tricky to fold and staple neatly by hand")}`}
    }
    return null
})


// Printing service pill, e.g. a real service's name, or "Booklet (fold at home)"/"Home"/"Custom…"
// for the service-less modes
const service_label = computed(() => {
    return latest_version.value ? format_service_label(latest_version.value.blueprint, t) : ''
})

</script>


<style lang='sass' scoped>

.summary
    padding: 16px 16px 0 16px
    text-align: center

.summary_title
    margin-bottom: 8px

.summary_pills
    display: flex
    flex-wrap: wrap
    justify-content: center
    gap: 8px

.summary_pills .icon, .after_latest .v-chip .icon
    height: 16px
    width: 16px
    margin-right: 6px

.latest_version
    font-weight: bold

.after_latest
    display: flex
    align-items: center
    justify-content: center
    gap: 12px
    padding: 16px 16px 0 16px

</style>
