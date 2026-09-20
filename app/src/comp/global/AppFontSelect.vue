
<template lang='pug'>

v-select(:model-value='model' :items='items' :label='label' :loading='copying'
        @update:model-value='on_select')
    template(#item='{internalItem: item, props: item_props}')
        v-list-item(v-bind='item_props')
            template(#title v-if='typeof item.raw === "string"')
                div(class='font-sample' :style='{fontFamily: `"${item.raw}"`}') {{ example_text }}
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
// example text rendered in that font, with the family name captioned below. Families from the
// user's other designs are listed too, by name only, and copied into this design when picked

import {computed, ref} from 'vue'
import {useI18n} from '@/services/i18n'

import {content} from '@/services/content'
import {font_items, font_items_with_auto, DEFAULT_FONT_EXAMPLE} from '@/services/fonts'
import {font_suggestions, adopt_font} from '@/services/asset_suggestions'
import {current_design_id} from '@/services/designs'
import {report_error} from '@/services/errors'

import AppIcon from '@/comp/global/AppIcon.vue'
import DialogFontUpload from '@/comp/dialogs/DialogFontUpload.vue'


const props = defineProps<{
    label:string
    auto?:boolean  // include the "Auto (matches text font)" option
    example:'title'|'heading'|'verse'  // which content.example_text field to preview with
}>()

const model = defineModel<string|null>({required: true})


const {t} = useI18n()
const font_items_auto = font_items_with_auto(t)
const items = computed(() => props.auto ? font_items_auto.value : font_items.value)

const example_text = computed(() => content.example_text[props.example] || DEFAULT_FONT_EXAMPLE)

// Whether a font picked from another design is still being copied into this one
const copying = ref(false)


// Apply the chosen family, copying it into this design first if it belongs to another one
// (fonts are per-design — see asset_suggestions.ts). The model is set straight away so the
// picker responds immediately, and put back if the copy fails: a blueprint naming a font the
// design doesn't hold would silently render as a fallback instead
const on_select = async (value:string|null) => {
    const previous = model.value
    model.value = value
    const suggestion = font_suggestions.value.find(font => font.family === value)
    if (!suggestion || !current_design_id.value){
        return
    }
    copying.value = true
    try {
        await adopt_font(suggestion, current_design_id.value)
    } catch (error){
        model.value = previous
        report_error('banner', error)
    } finally {
        copying.value = false
    }
}

</script>


<style lang='sss' scoped>

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
