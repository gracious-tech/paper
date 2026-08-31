<template lang='pug'>

//- Dialog explaining Iconify and how to find/enter a custom icon ID (controlled via v-model:open)
v-dialog(v-model='open_model' max-width='450')
    v-card
        template(#title) {{$t("editor.icon_help.search_more")}}
        template(#text)
            p {{$t("editor.icon_help.about")}}
            p.mt-4.font-weight-medium {{$t("editor.icon_help.title")}}
            ol.ms-4.mt-2
                li {{$t("editor.icon_help.step_visit")}}
                li {{$t("editor.icon_help.step_open")}}
                li
                    | {{$t("editor.icon_help.step_copy")}}
                    code.mx-1 collection:icon-name
                li {{$t("editor.icon_help.step_paste")}}
        template(#actions)
            v-btn(href='https://icon-sets.iconify.design' target='_blank' rel='noopener'
                color='secondary') {{$t("editor.icon_help.open_site")}}
            v-spacer
            v-btn(@click='open_model = false') {{$t("common.dismiss")}}

</template>


<script lang='ts' setup>

import {computed} from 'vue'


// Two-way binding for the dialog's open state
const props = defineProps<{open:boolean}>()
const emit = defineEmits<{(e:'update:open', val:boolean):void}>()


const open_model = computed({
    get: () => props.open,
    set: (val) => emit('update:open', val),
})


</script>


<style lang='sass' scoped>

ol
    display: flex
    flex-direction: column
    gap: 6px

code
    font-size: 0.85em
    padding: 1px 4px
    border-radius: 3px
    background: rgb(var(--v-theme-on-surface), 0.08)


</style>
