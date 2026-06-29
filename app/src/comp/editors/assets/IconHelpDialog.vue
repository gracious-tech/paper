<template lang='pug'>

//- Dialog explaining Iconify and how to find/enter a custom icon ID (controlled via v-model:open)
v-dialog(v-model='open_model' max-width='450')
    v-card
        template(#title) {{$t("Search more icons")}}
        template(#text)
            p {{$t("You can search Iconify for more icons, which is a free icon library with over 200,000 icons.")}}
            p.mt-4.font-weight-medium {{$t("How to add a custom icon:")}}
            ol.ms-4.mt-2
                li {{$t("Visit the icon website below and search for any icon.")}}
                li {{$t("Click an icon to open its detail page.")}}
                li
                    | {{$t("Copy its ID — it looks like")}}
                    code.mx-1 collection:icon-name
                li {{$t("Paste or type the ID into the icon field.")}}
        template(#actions)
            v-btn(href='https://icon-sets.iconify.design' target='_blank' rel='noopener'
                color='secondary') {{$t("Open Iconify")}}
            v-spacer
            v-btn(@click='open_model = false') {{$t("Dismiss")}}

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
