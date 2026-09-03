
<template lang='pug'>

v-card-title(class='d-flex justify-space-between align-center')
    | {{$t("common.advanced_options")}}
    v-btn(@click='done' size='large' variant='text' color='secondary') {{$t("common.done")}}

v-divider

v-card-text(class='overflow-y-auto')

    h2(class='mb-4') {{$t("options.layout.margins")}}

    div(class='d-flex align-center')
        v-text-field(v-model.number='blue.margin_top' type='number' variant='underlined'
            density='compact' :label='$t("common.top")' class='mr-4')
        v-text-field(v-model.number='blue.margin_bottom' type='number' variant='underlined'
            density='compact' :label='$t("common.bottom")' class='mr-4')
        v-text-field(v-model.number='blue.margin_inner' type='number' variant='underlined'
            density='compact' :label='$t("options.layout.inner")' class='mr-4')
        v-text-field(v-model.number='blue.margin_outer' type='number' variant='underlined'
            density='compact' :label='$t("options.layout.outer")' class='mr-4')

    div(class='d-flex align-center my-2')
        v-text-field(v-model.number='blue.column_gap' type='number' variant='underlined'
            density='compact' :label='$t("options.layout.column_gap")' class='mr-4'
            style='max-width: 90px' :disabled='blue.columns === false')
        v-radio-group(v-model='margin_unit' inline)
            v-radio(value='mm' label="mm")
            v-radio(value='in' label="inches")

    v-checkbox(v-model='gutter_checked' :label='$t("editor.advanced.auto_gutter")'
        :disabled='!service_provides_gutter' hide-details)
    template(v-if='service_provides_gutter')
        p(class='text-body-medium text-medium-emphasis mt-2') {{$t("editor.advanced.auto_gutter_note")}}
        p(v-if='gutter_amount' class='text-body-medium text-medium-emphasis mt-1') {{ $t("editor.advanced.auto_gutter_amount", {amount: gutter_amount, unit: blue.margin_unit, pages: gutter_pages}) }}
    p(v-else class='text-body-medium text-medium-emphasis mt-2') {{$t("editor.advanced.auto_gutter_unavailable")}}

    v-divider(class='my-8')

    h2(class='mb-4') {{$t("editor.advanced.running_heading")}}

    div(v-if='!blue.running_pages && !blue.running_headings' class='text-body-medium text-medium-emphasis mb-4') {{$t("editor.advanced.running_disabled_note")}}

    v-radio-group(v-model='blue.running_position' inline :label='$t("common.position")'
            :disabled='!blue.running_pages && !blue.running_headings' class='my-4')
        v-radio(value='footer' :label='$t("common.bottom")')
        v-radio(value='header' :label='$t("common.top")')
    v-radio-group(v-model='blue.running_align' inline :label='$t("editor.advanced.page_num_align")'
            :disabled='!blue.running_pages && !blue.running_headings' class='my-4')
        v-radio(value='center' :label='$t("common.center")')
        v-radio(value='outer' :label='$t("editor.advanced.outer_edge")')

    v-divider(class='my-8')

    h2(class='mb-4') {{$t("common.chapter_numbers")}}

    v-select(v-model='blue.show_chapters_style' :items='chapter_styles'
        :disabled='!blue.show_chapters' :label='$t("common.style")' variant='outlined')

    v-divider(class='my-8')

    h2(class='mb-4') {{$t("editor.advanced.headings")}}

    AppFontSelect(v-model='blue.font_headings' :label='$t("editor.advanced.headings_font")' auto
        example='heading' class='mb-4')

    v-checkbox(v-model='blue.show_headings_bold' :label='$t("common.bold")')
    v-checkbox(v-model='blue.show_headings_italic' :label='$t("common.italic")')

    v-slider(v-model='blue.show_headings_size' :label='$t("common.size")' :min='0.8' :max='2'
        :step='0.05' thumb-label class='my-4')

    template(v-if='blue.bibles.length > 1')

        v-divider(class='my-8')

        h2(class='mb-4') {{$t("editor.advanced.second_translation")}}

        AppFontSelect(v-model='blue.font_text2' :label='$t("editor.advanced.text2_font")' auto
            example='verse' class='mb-4')

        //- Sized relative to the main text (1 = match), not an absolute point size
        v-slider(v-model='blue.font_size2' :label='$t("editor.advanced.text2_size")' :min='0.5'
                :max='1.5' :step='0.01' thumb-label class='my-4')
            template(#thumb-label='{modelValue}')
                | {{ Math.round(modelValue * 100) }}%
        p(class='text-body-medium text-medium-emphasis') {{$t("editor.advanced.text2_size_note")}}

    v-divider(class='my-8')

    h2(class='mb-4') {{$t("common.text")}}

    v-checkbox(v-model='blue.hyphenate' :label='$t("editor.advanced.hyphenate")' hide-details)
    p(class='text-body-medium text-medium-emphasis mt-2') {{$t("editor.advanced.hyphenate_note")}}

    v-checkbox(v-model='blue.poetry_outdent' :label='$t("editor.advanced.poetry_outdent")' class='mt-4' hide-details)
    p(class='text-body-medium text-medium-emphasis mt-2') {{$t("editor.advanced.poetry_outdent_note")}}

    v-divider(class='my-8')

    h2(class='mb-4') {{$t("editor.advanced.text_color")}}

    AppColor(v-model='blue.text_color' :label='$t("editor.advanced.text_color_label")')
    p(class='text-body-medium text-medium-emphasis mt-2') {{$t("editor.advanced.big_text_note")}}

    v-divider(class='my-8')

    h2(class='mb-4') {{$t("editor.advanced.title_pages")}}
    p(class='text-body-medium text-medium-emphasis mb-4') {{$t("editor.advanced.titlepages_note")}}

    AppFontSelect(v-model='blue.titlepage_font' :label='$t("editor.advanced.titlepage_font")' auto
        example='title' class='mb-4')

    div.patterns
        div.none(@click='blue.titlepage_frame = null'
            :class='{active: blue.titlepage_frame === null}') {{$t("common.none")}}
        img(v-for='pattern of pattern_items' :src='pattern.src' @click='pattern.click'
            :class='{active: blue.titlepage_frame === pattern.pattern}')

    div(class='mb-4')
        AppColor(v-model='blue.titlepage_color_text' :label='$t("editor.advanced.text_color_label")')
    div(class='mb-4')
        AppColor(v-model='blue.titlepage_color_icon' :label='$t("editor.advanced.icon_color")')
    div(class='mb-4')
        AppColor(v-model='blue.titlepage_color_frame' :label='$t("editor.advanced.frame_color")')

    v-slider(v-model='blue.titlepage_text_size' :label='$t("editor.advanced.text_size")' :min='0.5' :max='2'
        :step='0.1' thumb-label class='my-4')

    v-slider(v-model='blue.titlepage_icon_size' :label='$t("common.icon_size")' :min='0.4' :max='2'
        :step='0.1' thumb-label class='my-4')

    v-radio-group(v-model='titlepage_always' inline
            :label='$t("editor.advanced.titlepage_side")' class='my-6')
        v-radio(value='null' :label='$t("editor.advanced.either_side")')
        v-radio(value='left' :label='$t("common.left")')
        v-radio(value='right' :label='$t("common.right")')

    v-divider(class='my-8')

    h2(class='mb-4') {{$t("common.images")}}
    p(class='text-body-medium text-medium-emphasis mb-4') {{$t("editor.advanced.images_note")}}

    v-radio-group(v-model='blue.image_style' inline :label='$t("common.style")')
        v-radio(value='padded' :label='$t("editor.advanced.image_padded")')
        v-radio(value='painted' :label='$t("editor.advanced.image_painted")')
        v-radio(value='torn' :label='$t("editor.advanced.image_torn")')
        v-radio(value='borderless' :label='$t("editor.advanced.image_borderless")')

    v-divider(class='my-8')

    h2(class='mb-4') {{$t("editor.advanced.stories")}}

    v-radio-group(v-model='blue.story_layout' inline :label='$t("common.layout")' class='mb-2')
        v-radio(value='single' :label='$t("editor.advanced.story_single")')
        v-radio(value='grid' :label='$t("editor.advanced.story_grid")')

    v-checkbox(v-model='blue.story_alternate' :label='$t("editor.advanced.alt_image_side")' hide-details)
    p(class='text-body-medium text-medium-emphasis mt-2 mb-4') {{$t("editor.advanced.alt_image_side_note")}}

    v-checkbox(v-model='blue.story_emphasis' :label='$t("editor.advanced.emphasize_tone")' hide-details)
    p(class='text-body-medium text-medium-emphasis mt-2 mb-4') {{$t("editor.advanced.emphasis_note")}}

    AppColor(v-if='blue.story_emphasis' v-model='blue.story_emphasis_color'
        :label='$t("editor.advanced.emphasis_color")')

    v-divider(class='my-8')

    h2(class='mb-4') {{$t("common.copyright")}}

    v-checkbox(v-model='blue.app_link' :label='$t(`editor.advanced.app_link`)' class='mt-4')

    v-checkbox(v-model='blue.design_link' :label='$t("editor.advanced.design_link")' class='mt-4')
    p(class='text-body-medium text-medium-emphasis mb-4') {{$t("editor.advanced.design_link_note")}}

    v-checkbox(v-model='blue.public_domain' :label='$t("editor.advanced.dedicate_pd")' class='mt-4' hide-details)
    p(class='text-body-medium text-medium-emphasis mt-2') {{$t("editor.advanced.pd_note")}} #[a(href='https://freely.giving/questions/public-domain' target='_blank' rel='noopener') {{$t('editor.advanced.pd_learn_more')}}]
    p(v-if='!blue.public_domain' class='text-body-medium text-error mt-2') {{$t("editor.advanced.design_link_warning")}}

    v-divider(class='my-8')

    h2(class='mb-4') {{$t("editor.advanced.workarounds")}}

    v-switch(v-model='blue.booklet_portrait' color='primary' :label="$t(`editor.advanced.flip_edge`)" class='mt-4' :disabled='!blue.booklet' hide-details)
    p(class='text-body-medium text-medium-emphasis') {{$t("editor.advanced.flip_edge_note")}}

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useI18n} from '@/services/i18n'
import {PATTERNS as patterns, resolve_binding_gutter} from 'paper-bible-typst'

import {blue, state, page_count_guess} from '@/services/state'

const {t} = useI18n()


// Close the editor
const done = () => {
    state.editor = null
}


// Wrap margin_unit so switching mm/inches converts existing margin values rather than
// leaving the numbers as-is (which would otherwise become nonsensically small/large)
const margin_unit = computed({
    get: () => blue.margin_unit,
    set: value => {
        if (value === blue.margin_unit) {
            return
        }
        const factor = value === 'in' ? 1 / 25.4 : 25.4
        const round = (num:number) => Math.round(num * 100) / 100
        blue.margin_top = round(blue.margin_top * factor)
        blue.margin_bottom = round(blue.margin_bottom * factor)
        blue.margin_inner = round(blue.margin_inner * factor)
        blue.margin_outer = round(blue.margin_outer * factor)
        blue.column_gap = round(blue.column_gap * factor)
        blue.margin_unit = value
    },
})


// Page estimate the gutter preview is calculated against (a thicker book needs a deeper gutter)
const gutter_pages = computed(() => page_count_guess())


// The raw gutter the chosen printing service would add right now (in the current margin unit).
// May legitimately be 0 for a known reason — a lay-flat binding (coil/staple), or a book
// still too thin to need one — in which case auto-calc is simply quiet, not broken
const gutter_raw = computed(() => resolve_binding_gutter(blue, gutter_pages.value))


// Whether the chosen service can work a gutter out at all. False only when the user would have
// to size the inner margin themselves: home printing, the "custom" (unlisted service) mode,
// and listed services that never specify a gutter (Officeworks, Vistaprint). Stays true when
// the current gutter is 0 for a known reason (lay-flat binding / thin book) — probed by asking
// for a thick book on a perfect binding
const service_provides_gutter = computed(() => {
    if (blue.booklet || blue.service_id === 'home' || blue.service_id === 'custom'
            || blue.service_id === '') {
        return false
    }
    return ['hardcover', 'paperback'].some(binding_type => {
        return resolve_binding_gutter({...blue, binding_type}, 2000) > 0
    })
})


// Checkbox state: shows unticked whenever the option is disabled, whatever the stored value is
// (margin_gutter_auto defaults on, but is a no-op without a service that provides a gutter)
const gutter_checked = computed({
    get: () => service_provides_gutter.value && blue.margin_gutter_auto,
    set: value => {
        blue.margin_gutter_auto = value
    },
})


// The gutter amount rounded for display: whole mm, or 2dp for the much smaller inch values
const gutter_amount = computed(() => {
    return blue.margin_unit === 'mm'
        ? Math.round(gutter_raw.value)
        : Math.round(gutter_raw.value * 100) / 100
})


// Chapter number style options
const chapter_styles = [
    {value: 'divider', title: t("editor.advanced.divider") + " / --- 2 ---"},
    {value: 'float', title: t("editor.advanced.drop_cap") + " / 2"},
    {value: 'heading', title: t("editor.advanced.heading_chapter") + " 2"},
]


// Corner-frame pattern swatches for the global title-page frame setting
const pattern_items = Object.entries(patterns).map(([pattern, svg]) => {
    return {
        pattern,
        src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
        click(){
            blue.titlepage_frame = pattern
        },
    }
})


// Wrap titlepage_always so the radio group can use string values (null isn't a valid radio value)
const titlepage_always = computed({
    get: () => String(blue.titlepage_always),
    set: value => {
        blue.titlepage_always = value === 'null' ? null : (value as 'left'|'right')
    },
})

</script>


<style lang='sass' scoped>

.v-card-text
    padding-bottom: 30vh


h2
    font-size: 18px
    margin-bottom: 12px


.patterns
    display: flex
    flex-wrap: wrap

    img, .none
        width: 90px
        height: 90px
        cursor: pointer
        margin: 6px

        &:hover
            outline: 1px solid rgb(var(--v-theme-primary), 0.3)

        &.active
            outline: 2px solid rgb(var(--v-theme-secondary))

    .none
        display: inline-flex
        justify-content: center
        align-items: center

</style>
