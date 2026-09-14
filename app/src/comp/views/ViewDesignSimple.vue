
<template lang='pug'>

div.cont
    //- Floats bottom-right on mobile, matching ViewDesignEditor's own BtnGenerate placement
    div.generate
        BtnGenerate

    //- Whole rows are clickable, each opening its own step's UI
    template(v-for='section of sections' :key='section.key')
        div.section(role='button' tabindex='0' @click='section.open()'
                @keydown.enter='section.open()' @keydown.space.prevent='section.open()')
            div.text
                h2(class='mb-2') {{ section.title }}
                p.value {{ section.value }}
            app-icon(name='chevron_right' class='chevron')

    //- Professional printing gets no service/binding choice in simple mode — explain the ones
    //- it went with, and point at the full editor for anything else
    v-alert(v-if='print_notice' type='info' :icon='false' variant='tonal' density='compact'
        class='my-6') {{ print_notice }}

    div(class='d-flex justify-center my-6')
        v-btn(@click='advanced' variant='tonal' color='primary') {{$t('common.more_options')}}

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {get_service} from 'printing-services'
import {get_cover_title} from 'paper-bible-typst'
import {useI18n} from '@/services/i18n'

import BtnGenerate from './assets/BtnGenerate.vue'
import {blue, state} from '@/services/state'
import {content} from '@/services/content'
import {content_preview, format_paper_size} from '@/services/blueprints'
import {design_wizard, current_design_id, leave_simple_mode} from '@/services/designs'
import {wizard_type_label, wizard_cover_label, wizard_size_label} from '@/services/new_design'

import type {WizardStep} from '@/services/new_design'


// The simple-mode summary shown for wizard-created designs still in simple_mode — one row per
// wizard step, clicking a row reopening just that step's own UI. Books/Bibles/Print read straight
// off `blue` (the live, always-accurate Blueprint); Type falls back to the persisted wizard
// draft instead, since build_new_blueprint() is a one-way transform that can't be read back
// reliably from the Blueprint it produced (see new_design.ts)
const {t} = useI18n()


const type_summary = computed(() => {
    const type = design_wizard.draft?.type
    return type ? wizard_type_label(type, t).label : ''
})

const books_summary = computed(() => content_preview(blue.content))

const bibles_summary = computed(() => {
    return blue.bibles.map(id => {
        const trans = content.translations[id]
        return trans?.name_local || trans?.name_english || id
    }).join(', ')
})

// The service the design prints with, or undefined for the service-less home/custom modes.
// get_service() is typed as total but returns undefined for an unknown id (a blueprint from a
// co-editor on a newer build), hence the cast
const print_service = computed(() => {
    if (blue.service_id === 'home' || blue.service_id === 'custom'){
        return undefined
    }
    return get_service(blue.service_id as Parameters<typeof get_service>[0]) as
        ReturnType<typeof get_service>|undefined
})


// Only what the user actually chose in the wizard: how they print ("At home"/"Professionally")
// and the size — everything simple mode derived from those (booklet folding, the service and
// its binding) is left out, and the size's dimensions belong in the full editor
const print_summary = computed(() => {
    let how = t("wizard.print.professionally")
    let size = format_paper_size(blue, true)
    if (blue.service_id === 'home'){
        how = t("wizard.print.at_home")
    } else if (blue.service_id === 'custom'){
        how = t("common.custom")
    } else {
        // Trim sizes are named the wizard's way ("Small" rather than "Novella"), falling back
        // to the size's real name for anything outside the wizard's own four
        size = wizard_size_label(blue.size_id, t) ?? size
    }
    return `${how} · ${size}`
})


// Which service/binding simple mode settled on, shown below the rows (only for a real printing
// service — home/custom modes have neither to explain)
const print_notice = computed(() => {
    const service = print_service.value
    if (!service){
        return undefined
    }
    const binding = service.get_binding_types().find(b => b.id === blue.binding_type)?.name
        ?? blue.binding_type
    return t("view.simple.service_notice", {service: service.name, binding})
})

// The cover's own title — which is exactly what this row's step edits (the wizard's title field
// sets the cover title, not the design's name; renaming is done from the /designs list). Falls
// back to the wizard's style label until a title exists
const cover_summary = computed(() => {
    const title = get_cover_title(blue.cover)
    if (title){
        return title
    }
    const cover = design_wizard.draft?.cover
    return cover ? wizard_cover_label(cover, t) : ''
})


// Open a single-step editor in the sidebar (Books/Bibles/Print/Cover — the steps that can't
// invalidate another step, unlike Type, whose row reopens the full wizard dialog instead;
// see DialogNewDesign.vue/state.wizard_edit)
const edit_step = (step:WizardStep) => {
    state.editor = {component: 'EditorWizardStep', props: {step}}
}


// The clickable rows, in wizard order
const sections = computed(() => [
    {key: 'type', title: t("common.type"), value: type_summary.value,
        open: () => {state.wizard_edit = {step: 'type'}}},
    {key: 'books', title: t("common.content"), value: books_summary.value,
        open: () => edit_step('books')},
    {key: 'bibles', title: t("common.bible_translations"), value: bibles_summary.value,
        open: () => edit_step('bibles')},
    {key: 'print', title: t("common.print"), value: print_summary.value,
        open: () => edit_step('print')},
    {key: 'cover', title: t("common.cover"), value: cover_summary.value,
        open: () => edit_step('cover')},
])


// Permanently leave simple mode, revealing the full editor from now on
const advanced = () => {
    void leave_simple_mode(current_design_id.value!)
}

</script>


<style lang='sass' scoped>

// Floating action button, bottom-right — only shown on mobile (see media query below); on
// larger screens the same action lives inline at the right end of the preview toolbar instead
.generate
    position: fixed
    right: 16px
    bottom: 16px
    z-index: 1
    @media (min-width: 901px)
        display: none

.cont
    padding: 24px
    overflow: auto
    padding-bottom: 30vh

// Each summary row acts as a button that opens its own step's UI
.section
    display: flex
    align-items: center
    gap: 12px
    padding: 12px
    margin: 0 -12px
    border-radius: 8px
    cursor: pointer
    &:hover, &:focus-visible
        background-color: rgba(var(--v-theme-on-surface), 0.06)
    &:focus-visible
        outline: none

.text
    flex-grow: 1
    min-width: 0

// AppIcon fills with currentColor, so tint via color rather than fill
.chevron
    flex-shrink: 0
    color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity))

h2
    font-size: 18px

.value
    color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity))
    margin-bottom: 0

</style>
