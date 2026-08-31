
<template lang='pug'>

div.cont(v-if='!trigger_rerender')
    //- Floats bottom-right on mobile; hidden on larger screens where the same action sits at
    //- the right end of the preview toolbar instead (DisplayPreview.vue)
    div.generate
        BtnGenerate

    v-text-field(v-model='blue.title' :label='$t("common.title")' density='compact' hide-details
        class='mb-8')

    h2 {{$t("common.content")}}
    OptionsContent
    v-divider(class='my-8')

    h2 {{$t("common.bible_translations")}}
    OptionsBibles
    v-divider(class='my-8')

    h2 {{$t("common.book_size")}}
    OptionsPaper

    v-divider(class='my-8')

    h2 {{$t("common.cover")}}
    OptionsCover
    v-divider(class='my-8')

    h2 {{$t("common.features")}}
    OptionsFeatures
    v-divider(class='my-8')

    h2 {{$t("common.study")}}
    OptionsStudy
    v-divider(class='my-8')

    h2 {{$t("common.style")}}
    OptionsStyle
    v-divider(class='my-8')

    h2 {{$t("common.layout")}}
    OptionsLayout

    v-divider(class='my-8')

    div(class='d-flex justify-center')
        v-btn(@click='advanced' variant='tonal' color='primary') {{$t("common.advanced_options")}}

</template>


<script lang='ts' setup>

import {ref} from 'vue'

import BtnGenerate from './assets/BtnGenerate.vue'
import OptionsContent from '@/comp/options/OptionsContent.vue'
import OptionsCover from '@/comp/options/OptionsCover.vue'
import OptionsFeatures from '@/comp/options/OptionsFeatures.vue'
import OptionsStyle from '@/comp/options/OptionsStyle.vue'
import OptionsLayout from '@/comp/options/OptionsLayout.vue'
import OptionsPaper from '@/comp/options/OptionsPaper.vue'
import OptionsStudy from '@/comp/options/OptionsStudy.vue'
import OptionsBibles from '@/comp/options/OptionsBibles.vue'

import {blue, state} from '@/services/state'


const trigger_rerender = ref(false)


// Open the advanced options editor (headings, text color, title pages, etc)
const advanced = () => {
    state.editor = {
        component: 'EditorAdvancedStyles',
        props: {},
    }
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

.title
    max-width: 70%

h2
    font-size: 18px
    margin-bottom: 12px

</style>
