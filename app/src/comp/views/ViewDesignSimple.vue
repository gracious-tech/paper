
<template lang='pug'>

div.cont
    //- Floats bottom-right on mobile, matching ViewDesignEditor's own BtnGenerate placement
    div.generate
        BtnGenerate

    div.row
        h2 {{$t("common.type")}}
        v-btn(@click='state.wizard_edit = {step: "type"}' variant='text' size='small' color='secondary')
            | {{$t('common.change')}}
    p.value {{ type_summary }}
    v-divider(class='my-8')

    div.row
        h2 {{$t("common.content")}}
        v-btn(@click='edit_step("books")' variant='text' size='small' color='secondary')
            | {{$t('common.change')}}
    p.value {{ books_summary }}
    v-divider(class='my-8')

    div.row
        h2 {{$t("common.bible_translations")}}
        v-btn(@click='edit_step("bibles")' variant='text' size='small' color='secondary')
            | {{$t('common.change')}}
    p.value {{ bibles_summary }}
    v-divider(class='my-8')

    div.row
        h2 {{$t("common.print")}}
        v-btn(@click='edit_step("print")' variant='text' size='small' color='secondary')
            | {{$t('common.change')}}
    p.value {{ print_summary }}
    v-divider(class='my-8')

    div.row
        h2 {{$t("common.cover")}}
        v-btn(@click='edit_step("cover")' variant='text' size='small' color='secondary')
            | {{$t('common.change')}}
    p.value {{ cover_summary }}

    v-divider(class='my-8')

    div(class='d-flex justify-center')
        v-btn(@click='advanced' variant='tonal' color='primary') {{$t('common.more_options')}}

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useI18n} from '@/services/i18n'

import BtnGenerate from './assets/BtnGenerate.vue'
import {blue, state} from '@/services/state'
import {content} from '@/services/content'
import {content_preview, format_service_label, format_paper_size} from '@/services/blueprints'
import {design_wizard, current_design_id, leave_simple_mode} from '@/services/designs'
import {wizard_type_label, wizard_cover_label} from '@/services/new_design'

import type {WizardStep} from '@/services/new_design'


// The simple-mode summary shown for wizard-created designs still in simple_mode — one row per
// wizard step, each "Change" reopening just that step's own UI. Books/Bibles/Print read straight
// off `blue` (the live, always-accurate Blueprint); Type/Cover read off the persisted wizard
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

const print_summary = computed(() => {
    return `${format_service_label(blue, t)} · ${format_paper_size(blue)}`
})

const cover_summary = computed(() => {
    const cover = design_wizard.draft?.cover
    return cover ? wizard_cover_label(cover, t) : ''
})


// Open a single-step editor in the sidebar (Books/Bibles/Print/Cover — the steps that can't
// invalidate another step, unlike Type, whose "Change" reopens the full wizard dialog instead;
// see DialogNewDesign.vue/state.wizard_edit)
const edit_step = (step:WizardStep) => {
    state.editor = {component: 'EditorWizardStep', props: {step}}
}


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

.row
    display: flex
    align-items: center
    justify-content: space-between

h2
    font-size: 18px

.value
    color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity))

</style>
