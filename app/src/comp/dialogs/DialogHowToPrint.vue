
<template lang='pug'>

//- NOTE 850px wide so video ends up exactly 800px
v-dialog(v-model='open' max-width='850' scrollable :fullscreen='is_mobile')
    v-card(v-if='mode')
        v-card-title(class='px-6 pt-4') {{ $t(title_key) }}
        v-card-text(class='px-6 pt-2')

            //- Home booklet: fold-at-home guidance, absorbed from the old Help page
            template(v-if='mode === "home_booklet"')

                //- Step-by-step: looping silent clips the reader scrolls through
                PrintWalkthrough(:steps='booklet_steps')

                v-divider(class='my-4')
                p(class='text-title-medium mb-2') {{ $t("dialog.how_to_print.booklet_tips_h") }}

                h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.booklet_order_h") }}
                p(class='text-body-medium') {{ $t("dialog.how_to_print.booklet_order_p") }}

                h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.booklet_upside_down_h") }}
                p(class='text-body-medium') {{ $t("dialog.how_to_print.booklet_upside_down_p") }}

                h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.one_sided_h") }}
                p(class='text-body-medium') {{ $t("dialog.how_to_print.one_sided_p") }}

                h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.booklet_thick_h") }}
                p(class='text-body-medium') {{ $t("dialog.how_to_print.booklet_thick_p") }}

            //- Home, single pages
            template(v-else-if='mode === "home_plain"')
                p(class='mb-4 text-body-medium') {{ $t("dialog.how_to_print.plain_intro") }}

                h4(class='text-title-small') {{ $t("dialog.how_to_print.plain_scale_h") }}
                p(class='text-body-medium') {{ $t("dialog.how_to_print.plain_scale_p") }}

                h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.plain_double_sided_h") }}
                p(class='text-body-medium') {{ $t("dialog.how_to_print.plain_double_sided_p") }}

                h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.plain_bind_h") }}
                p(class='text-body-medium') {{ $t("dialog.how_to_print.plain_bind_p") }}

                h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.whole_bible_h") }}
                p(class='text-body-medium') {{ $t("dialog.how_to_print.whole_bible_p") }}

            //- Lulu: self-publishing upload flow
            template(v-else-if='mode === "lulu"')

                //- Step-by-step: looping silent clips the reader scrolls through (Lulu's own
                //- screen recordings are 4:3, unlike the 16:9 default used elsewhere)
                PrintWalkthrough(:steps='lulu_steps' aspect='4 / 3')

                v-divider(class='my-4')
                p(class='text-title-medium mb-2') {{ $t("dialog.how_to_print.lulu_tips_h") }}

                h4(class='text-title-small') {{ $t("dialog.how_to_print.lulu_color_h") }}
                p(class='text-body-medium')
                    | {{ $t("dialog.how_to_print.lulu_color_p_1") }}
                    em {{ $t("dialog.how_to_print.lulu_color_bw") }}
                    | {{ $t("dialog.how_to_print.lulu_color_p_2") }}
                    em {{ $t("dialog.how_to_print.lulu_color_std") }}
                    | {{ $t("dialog.how_to_print.lulu_color_p_3") }}

                h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.lulu_paper_h") }}
                p(class='text-body-medium')
                    | {{ $t("dialog.how_to_print.lulu_paper_p_1") }}
                    em {{ $t("dialog.how_to_print.lulu_paper_60") }}
                    | {{ $t("dialog.how_to_print.lulu_paper_p_2") }}
                    em {{ $t("dialog.how_to_print.lulu_paper_cream") }}
                    | {{ $t("dialog.how_to_print.lulu_paper_p_3") }}
                    em {{ $t("dialog.how_to_print.lulu_paper_white") }}
                    | {{ $t("dialog.how_to_print.lulu_paper_p_4") }}
                    em {{ $t("dialog.how_to_print.lulu_paper_80") }}
                    | {{ $t("dialog.how_to_print.lulu_paper_p_5") }}

                h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.lulu_finish_h") }}
                p(class='text-body-medium')
                    | {{ $t("dialog.how_to_print.lulu_finish_p_1") }}
                    em {{ $t("dialog.how_to_print.lulu_finish_glossy") }}
                    | {{ $t("dialog.how_to_print.lulu_finish_p_2") }}
                    em {{ $t("dialog.how_to_print.lulu_finish_matte") }}
                    | {{ $t("dialog.how_to_print.lulu_finish_p_3") }}


            //- Any other printing service (and the manual "Custom" service)
            template(v-else)
                p(class='mb-4 text-body-medium') {{ $t("dialog.how_to_print.generic_intro") }}

                dl.spec(v-if='spec_rows.length')
                    template(v-for='row of spec_rows' :key='row.label')
                        dt {{ row.label }}
                        dd {{ row.value }}

                h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.generic_match_h") }}
                p(class='text-body-medium') {{ $t("dialog.how_to_print.generic_match_p") }}

                h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.generic_noscale_h") }}
                p(class='text-body-medium') {{ $t("dialog.how_to_print.generic_noscale_p") }}

                template(v-if='is_custom')
                    h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.custom_spec_h") }}
                    p(class='text-body-medium') {{ $t("dialog.how_to_print.custom_spec_p") }}

                template(v-if='has_cover')
                    h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.generic_cover_h") }}
                    p(class='text-body-medium') {{ $t("dialog.how_to_print.generic_cover_p") }}

                h4(class='text-title-small mt-4') {{ $t("dialog.how_to_print.generic_proof_h") }}
                p(class='text-body-medium') {{ $t("dialog.how_to_print.generic_proof_p") }}

        v-card-actions(class='px-6 pb-4')
            v-btn(v-if='service_guide' :href='service_guide.url' target='_blank' variant='text'
                color='secondary')
                | {{ $t("dialog.how_to_print.service_guide", {service: service_guide.name}) }}
            v-spacer
            v-btn(@click='open = false' variant='tonal') {{ $t("common.close") }}

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {get_service} from 'printing-services'
import type {ServicePublic} from 'printing-services'

import {useI18n} from '@/services/i18n'
import {state} from '@/services/state'
import {format_paper_size} from '@/services/blueprints'
import {use_is_mobile} from '@/services/display'
import {download_version_pdf} from '@/services/versions'
import PrintWalkthrough from '@/comp/dialogs/assets/PrintWalkthrough.vue'
import type {WalkthroughStep} from '@/comp/dialogs/assets/PrintWalkthrough.vue'


const {t} = useI18n()


// Fold-at-home booklet walkthrough — looping silent clips cut from the intro video
const booklet_steps:[WalkthroughStep, ...WalkthroughStep[]] = [
    {video: '/walkthrough/booklet-1.mp4', label: 'dialog.how_to_print.walk_1_label',
        title: 'dialog.how_to_print.walk_1_title', body: 'dialog.how_to_print.walk_1_body'},
    {video: '/walkthrough/booklet-2.mp4', label: 'dialog.how_to_print.walk_2_label',
        title: 'dialog.how_to_print.walk_2_title', body: 'dialog.how_to_print.walk_2_body'},
    {video: '/walkthrough/booklet-3.mp4', label: 'dialog.how_to_print.walk_3_label',
        title: 'dialog.how_to_print.walk_3_title', body: 'dialog.how_to_print.walk_3_body'},
    {video: '/walkthrough/booklet-4.mp4', label: 'dialog.how_to_print.walk_4_label',
        title: 'dialog.how_to_print.walk_4_title', body: 'dialog.how_to_print.walk_4_body'},
    {video: '/walkthrough/booklet-5.mp4', label: 'dialog.how_to_print.walk_5_label',
        title: 'dialog.how_to_print.walk_5_title', body: 'dialog.how_to_print.walk_5_body'},
]


// Save the open version's interior/cover PDF to disk (lulu walkthrough step actions) — reads
// state.how_to_print live rather than capturing it, since the steps below are built once but
// the dialog is reused across different versions
function download_interior():void{
    if (state.how_to_print){
        void download_version_pdf(state.how_to_print, 'interior')
    }
}
function download_cover():void{
    if (state.how_to_print){
        void download_version_pdf(state.how_to_print, 'cover')
    }
}


// The binding name required for the open version (step 4 names it explicitly, since Lulu's own
// option labels don't match what was chosen when the design was created)
const lulu_binding_name = computed(() => {
    const blueprint = state.how_to_print?.blueprint
    if (!blueprint){
        return ''
    }
    return get_service('lulu').get_binding_types({all: true})
        .find(item => item.id === blueprint.binding_type)?.name ?? ''
})


// Lulu upload-flow walkthrough — steps 1/3/5 carry an action button (site link, PDF downloads);
// a computed since step 4's body names the version's required binding
const lulu_steps = computed<[WalkthroughStep, ...WalkthroughStep[]]>(() => [
    {video: '/walkthrough/lulu/lulu1.mp4', label: 'dialog.how_to_print.lulu_walk_1_label',
        title: 'dialog.how_to_print.lulu_walk_1_title',
        body: 'dialog.how_to_print.lulu_walk_1_body',
        action: {label: 'dialog.how_to_print.lulu_walk_1_action',
            href: get_service('lulu').url_website}},
    {video: '/walkthrough/lulu/lulu2.mp4', label: 'dialog.how_to_print.lulu_walk_2_label',
        title: 'dialog.how_to_print.lulu_walk_2_title',
        body: 'dialog.how_to_print.lulu_walk_2_body'},
    {video: '/walkthrough/lulu/lulu3.mp4', label: 'dialog.how_to_print.lulu_walk_3_label',
        title: 'dialog.how_to_print.lulu_walk_3_title',
        body: 'dialog.how_to_print.lulu_walk_3_body',
        action: {label: 'dialog.how_to_print.lulu_walk_3_action', on_click: download_interior}},
    {video: '/walkthrough/lulu/lulu4.mp4', label: 'dialog.how_to_print.lulu_walk_4_label',
        title: 'dialog.how_to_print.lulu_walk_4_title',
        body: 'dialog.how_to_print.lulu_walk_4_body',
        warning: {before: 'dialog.how_to_print.lulu_walk_4_warning_1',
            after: 'dialog.how_to_print.lulu_walk_4_warning_2', value: lulu_binding_name.value}},
    {video: '/walkthrough/lulu/lulu5.mp4', label: 'dialog.how_to_print.lulu_walk_5_label',
        title: 'dialog.how_to_print.lulu_walk_5_title',
        body: 'dialog.how_to_print.lulu_walk_5_body',
        action: {label: 'dialog.how_to_print.lulu_walk_5_action', on_click: download_cover}},
    {video: '/walkthrough/lulu/lulu6.mp4', label: 'dialog.how_to_print.lulu_walk_6_label',
        title: 'dialog.how_to_print.lulu_walk_6_title',
        body: 'dialog.how_to_print.lulu_walk_6_body'},
])

// Fullscreen on mobile (long scrolling walkthrough)
const is_mobile = use_is_mobile()


// Bound to state.how_to_print — which holds the blueprint to describe, or null when hidden
const open = computed({
    get: () => state.how_to_print !== null,
    set: value => {
        if (!value){
            state.how_to_print = null
        }
    },
})


// Resolve the printing service for a real-service blueprint (null for the home/custom modes)
function resolve_service(service_id:string):ServicePublic|null{
    if (service_id === 'home' || service_id === 'custom'){
        return null
    }
    return get_service(service_id as Parameters<typeof get_service>[0])
}


// Which set of instructions to show, keyed off the blueprint's printing service
const mode = computed(() => {
    const blueprint = state.how_to_print?.blueprint
    if (!blueprint){
        return null
    }
    if (blueprint.service_id === 'home'){
        return blueprint.booklet ? 'home_booklet' : 'home_plain'
    }
    if (blueprint.service_id === 'lulu'){
        return 'lulu'
    }
    return 'generic'
})


// Dialog heading, phrased for the printing service the guidance is about
const title_key = computed(() => {
    switch (mode.value){
        case 'home_booklet':
            return 'dialog.how_to_print.title_booklet'
        case 'home_plain':
            return 'dialog.how_to_print.title_home'
        case 'lulu':
            return 'dialog.how_to_print.title_lulu'
        default:
            return 'dialog.how_to_print.title_pro'
    }
})


// Whether this is the manual "Custom" service (trim size only, user-entered bleed/spine)
const is_custom = computed(() => state.how_to_print?.blueprint.service_id === 'custom')


// Whether the version carries a wraparound cover to hand to the printer separately
const has_cover = computed(() => !!state.how_to_print?.blueprint.cover)


// The exact print specification to reproduce at the service — shown for lulu/generic modes so
// the "match the settings shown for this version" instruction has something concrete to point at
const spec_rows = computed(() => {
    const blueprint = state.how_to_print?.blueprint
    if (!blueprint || blueprint.service_id === 'home'){
        return []
    }
    const rows:{label:string, value:string}[] = [
        {label: t('options.paper.trim_size'), value: format_paper_size(blueprint)},
    ]
    // Named binding/ink/paper only exist for real services (Custom just has trim + bleed/spine)
    const service = resolve_service(blueprint.service_id)
    if (service){
        const binding = service.get_binding_types({all: true})
            .find(item => item.id === blueprint.binding_type)
        if (binding){
            rows.push({label: t('options.paper.binding'), value: binding.name})
        }
        const paper = service.get_paper_types({all: true})
            .find(item => item.id === blueprint.paper_type)
        if (paper){
            rows.push({label: t('options.paper.paper_type'), value: paper.name})
        }
        const ink = service.get_ink_types({all: true})
            .find(item => item.id === blueprint.ink_type)
        if (ink){
            rows.push({label: t('options.paper.ink_type'), value: ink.name})
        }
    }
    return rows
})


// Link to the printing service's own preparation guide (real services only, and not lulu —
// its walkthrough already links to lulu.com directly)
const service_guide = computed(() => {
    const blueprint = state.how_to_print?.blueprint
    const service = blueprint && mode.value !== 'lulu' ? resolve_service(blueprint.service_id)
        : null
    if (!service){
        return null
    }
    const url = service.url_guide || service.url_website
    return url ? {name: service.name, url} : null
})

</script>


<style lang='sass' scoped>

.spec
    display: grid
    grid-template-columns: auto 1fr
    column-gap: 16px
    row-gap: 4px
    margin: 8px 0 4px
    padding: 12px
    border-radius: 8px
    background-color: rgba(var(--v-theme-primary), 0.06)
    font-size: 0.875rem

    dt
        font-weight: 500
        opacity: 0.7

    dd
        margin: 0

</style>
