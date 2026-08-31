
<template lang='pug'>

v-select(v-model='model' :items='items' :label='label' :hint='hint')
    template(#item='{internalItem: item, props: item_props}')
        v-list-item(v-bind='item_props')
            template(#title v-if='typeof item.raw === "string"')
                div(class='font-sample' :style='{fontFamily: item.raw}') {{ example_text }}
                div(class='font-name text-body-small text-medium-emphasis') {{ item.raw }}
    template(#append-item)
        v-divider
        v-list-item
            template(#prepend)
                AppIcon(name='upload')
            template(#title) {{$t("common.upload_font")}}
            DialogFontUpload(@font-added='model = $event')

</template>


<script lang='ts' setup>

// AppFontSelect — a font-family v-select whose dropdown items preview themselves: the current
// example text rendered in that font, with the family name captioned below

import {computed} from 'vue'
import {useI18n} from '@/services/i18n'

import {content} from '@/services/content'
import {font_items, font_items_with_auto, DEFAULT_FONT_EXAMPLE} from '@/services/fonts'

import AppIcon from '@/comp/global/AppIcon.vue'
import DialogFontUpload from '@/comp/dialogs/DialogFontUpload.vue'


const props = defineProps<{
    label:string
    hint?:string
    auto?:boolean  // include the "Auto (matches text font)" option
    example:'title'|'heading'|'verse'  // which content.example_text field to preview with
}>()

const model = defineModel<string|null>({required: true})


const {t} = useI18n()
const font_items_auto = font_items_with_auto(t)
const items = computed(() => props.auto ? font_items_auto.value : font_items.value)

const example_text = computed(() => content.example_text[props.example] || DEFAULT_FONT_EXAMPLE)

</script>


<style lang='sass' scoped>

// Fixed (not percentage) max-width — these sit inside Vuetify's shrink-to-fit list-item title
// slot, so without a concrete cap here the nowrap text just grows the whole menu instead of
// eliding, stretching the dropdown across the page
.font-sample
    max-width: 380px
    font-size: 1rem
    line-height: 1.3
    padding-top: 4px
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap

.font-name
    max-width: 380px
    padding-bottom: 4px
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap

</style>
