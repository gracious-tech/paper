
<template lang='pug'>

v-card-title(class='d-flex justify-space-between align-center')
    | {{$t("Advanced styles")}}
    v-btn(@click='done' size='large' variant='text' color='secondary') {{$t("Done")}}

v-divider

v-card-text(class='overflow-y-auto')

    h3(class='text-title-large mb-4') {{$t("Page numbers/headings")}}

    div(v-if='!blue.running_pages && !blue.running_headings' class='text-body-medium text-medium-emphasis mb-4') {{$t("Enable page numbers and/or book & chapter name under Features to configure these.")}}

    v-radio-group(v-model='blue.running_position' inline :label='$t("Position")'
            :disabled='!blue.running_pages && !blue.running_headings' class='my-4')
        v-radio(value='footer' :label='$t("Bottom")')
        v-radio(value='header' :label='$t("Top")')
    v-radio-group(v-model='blue.running_align' inline :label='$t("Page number alignment")'
            :disabled='!blue.running_pages && !blue.running_headings' class='my-4')
        v-radio(value='center' :label='$t("Center")')
        v-radio(value='outer' :label='$t("Outer edge")')

    v-divider(class='my-8')

    h3(class='text-title-large mb-4') {{$t("Chapter numbers")}}

    v-select(v-model='blue.show_chapters_style' :items='chapter_styles'
        :disabled='!blue.show_chapters' :label='$t("Style")' variant='outlined')

    v-divider(class='my-8')

    h3(class='text-title-large mb-4') {{$t("Headings")}}

    AppFontSelect(v-model='blue.font_headings' :label='$t("Font for headings")' auto
        example='heading' class='mb-4')

    v-checkbox(v-model='blue.show_headings_bold' :label='$t("Bold")')
    v-checkbox(v-model='blue.show_headings_italic' :label='$t("Italic")')

    v-slider(v-model='blue.show_headings_size' :label='$t("Size")' :min='0.8' :max='2'
        :step='0.05' thumb-label class='my-4' color='')
    p(class='text-body-medium text-medium-emphasis') {{$t("Size is relative to normal text, with 1 being the same size.")}}

    template(v-if='blue.bibles.length > 1')

        v-divider(class='my-8')

        h3(class='text-title-large mb-4') {{$t("Second translation")}}

        AppFontSelect(v-model='blue.font_text2' :label='$t("Font for second translation")' auto
            example='verse' class='mb-4')

        v-slider(v-model='font_size2' :label='$t("Font size")' :min='6' :max='26' thumb-label
            class='my-4' color='')

    v-divider(class='my-8')

    h3(class='text-title-large mb-4') {{$t("Text color")}}

    AppColor(v-model='blue.text_color' :label='$t("Color of text")')
    p(class='text-body-medium text-medium-emphasis mt-2') {{$t("It's not recommended to use this setting unless you have eyesight issues that require it.")}}

    v-divider(class='my-8')

    h3(class='text-title-large mb-4') {{$t("Title pages")}}
    p(class='text-body-medium text-medium-emphasis mb-4') {{$t("Applies to every title page in the document.")}}

    AppFontSelect(v-model='blue.titlepage_font' :label='$t("Font for title pages")' auto
        example='title' class='mb-4')

    div.patterns
        div.none(@click='blue.titlepage_frame = null'
            :class='{active: blue.titlepage_frame === null}') {{$t("None")}}
        img(v-for='pattern of pattern_items' :src='pattern.src' @click='pattern.click'
            :class='{active: blue.titlepage_frame === pattern.pattern}')

    div(class='mb-4')
        AppColor(v-model='blue.titlepage_color_text' :label='$t("Color of text")')
    div(class='mb-4')
        AppColor(v-model='blue.titlepage_color_icon' :label='$t("Color of icon")')
    div(class='mb-4')
        AppColor(v-model='blue.titlepage_color_frame' :label='$t("Color of frame")')

    v-slider(v-model='blue.titlepage_icon_size' :label='$t("Icon size")' :min='0.4' :max='2'
        :step='0.1' thumb-label class='my-4' color='')

    v-radio-group(v-model='titlepage_always' inline
            :label='$t("Always start title pages on")' class='my-6')
        v-radio(value='null' :label='$t("Either side")')
        v-radio(value='left' :label='$t("Left")')
        v-radio(value='right' :label='$t("Right")')

    v-divider(class='my-8')

    h3(class='text-title-large mb-4') {{$t("Images")}}
    p(class='text-body-medium text-medium-emphasis mb-4') {{$t("Applies to every passage image in the document.")}}

    v-radio-group(v-model='blue.image_style' inline :label='$t("Style")')
        v-radio(value='padded' :label='$t("Padded (within the normal page margins)")')
        v-radio(value='borderless' :label='$t("Borderless (bleeds to the page edge)")')

    v-divider(class='my-8')

    h3(class='text-title-large mb-4') {{$t("Picture stories")}}

    v-radio-group(v-model='blue.story_layout' inline :label='$t("Layout")' class='mb-2')
        v-radio(value='single' :label='$t("One image & passage per page")')
        v-radio(value='grid' :label='$t("Grid of 4 images & passages per page")')

    v-checkbox(v-model='blue.story_alternate' :label='$t("Alternate image side")' hide-details)
    p(class='text-body-medium text-medium-emphasis mt-2 mb-4') {{$t("Switch which side the image appears on from one passage to the next, rather than always the same side.")}}

    v-checkbox(v-model='blue.story_emphasis' :label='$t("Emphasize tone")' hide-details)
    p(class='text-body-medium text-medium-emphasis mt-2') {{$t("Italicize questions and embolden exclamations in picture story passages.")}}

    v-divider(class='my-8')

    h3(class='text-title-large mb-4') {{$t("Copyright")}}

    v-checkbox(v-model='blue.public_domain' :label='$t("Dedicate your own content to the public domain")')
    p(class='text-body-medium text-medium-emphasis') {{$t("It's recommended to leave this checked so anyone can copy and share your creation without any further restrictions than the Bible translations themselves require. This has no effect on the licenses of third-party material you use, such as Bible translations.")}}

    v-checkbox(v-model='blue.app_link' :label='$t(`Include "Created with /paper.bible/"`)' class='mt-4')

    v-divider(class='my-8')

    h3(class='text-title-large mb-4') {{$t("Workarounds")}}

    v-switch(v-model='blue.booklet_portrait' color='primary' :label="$t(`My printer doesn't allow \"flip on short edge\"`)" class='mt-4' :disabled='!blue.booklet')
    p(class='text-body-medium text-medium-emphasis') {{$t("If your printer can only flip on long edge (which is the default for double-sided portrait documents) then this setting will output a portrait PDF with alternating rotation which will look correct once printed double-sided.")}}

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useI18n} from 'vue-i18n'
import {PATTERNS as patterns} from 'paper-bible-typst'

import {blue, state} from '@/services/state'

const {t} = useI18n()


// Close the editor
const done = () => {
    state.editor = null
}


// Chapter number style options
const chapter_styles = [
    {value: 'divider', title: t("Divider") + " / --- 2 ---"},
    {value: 'float', title: t("Drop cap") + " / 2"},
    {value: 'heading', title: t("Heading / Chapter") + " 2"},
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
