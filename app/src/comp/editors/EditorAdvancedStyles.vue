
<template lang='pug'>

v-card-title(class='d-flex justify-space-between align-center')
    | {{$t("common.advanced_options")}}
    v-btn(@click='done' size='large' variant='text' color='secondary') {{$t("common.done")}}

v-divider

v-card-text(class='overflow-y-auto')

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
        :step='0.05' thumb-label class='my-4' color='')

    template(v-if='blue.bibles.length > 1')

        v-divider(class='my-8')

        h2(class='mb-4') {{$t("editor.advanced.second_translation")}}

        AppFontSelect(v-model='blue.font_text2' :label='$t("editor.advanced.text2_font")' auto
            example='verse' class='mb-4')

        v-slider(v-model='font_size2' :label='$t("common.font_size")' :min='6' :max='26' thumb-label
            class='my-4' color='')

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
        :step='0.1' thumb-label class='my-4' color='')

    v-slider(v-model='blue.titlepage_icon_size' :label='$t("common.icon_size")' :min='0.4' :max='2'
        :step='0.1' thumb-label class='my-4' color='')

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
import {PATTERNS as patterns} from 'paper-bible-typst'

import {blue, state} from '@/services/state'

const {t} = useI18n()


// Close the editor
const done = () => {
    state.editor = null
}


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


// Wrap font_size2 so the slider has a number to bind to (null means auto = matches font_size)
const font_size2 = computed({
    get: () => blue.font_size2 ?? blue.font_size,
    set: value => {
        blue.font_size2 = value
    },
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
