
<template lang='pug'>

p(class='mb-3 text-body-medium text-medium-emphasis') {{ $t("wizard.print.question") }}

//- First decision: printing at home vs professionally
div.grid
    NewDesignCard(:image='img_btn_home' :label='$t("wizard.print.at_home")'
        :subtitle='$t("wizard.print.home_desc")'
        :selected='draft.service_id === "home"' @select='choose_home')
    NewDesignCard(:image='img_btn_pro' :label='$t("wizard.print.professionally")'
        :subtitle='$t("wizard.print.pro_desc")'
        :selected='professional' @select='choose_professional')

//- Home branch: just the printer's paper size (booklet folding is on by default, no option)
template(v-if='draft.service_id === "home"')
    div(class='mt-4 text-medium-emphasis') {{ $t("wizard.print.paper_size") }}
    v-radio-group(v-model='draft.size_id' inline hide-details)
        v-radio(value='a4' label="A4")
        v-radio(value='us_letter' label="US Letter")

//- Professional branch: always Lulu, binding is implied by the design type — the only
//- choice offered here is the book's trim size, with a comparison image for scale
template(v-else-if='professional')
    div(class='mt-4 text-medium-emphasis') {{ $t("common.book_size") }}
    div.grid_sizes.mt-2
        v-card.choice(v-for='item in SIZE_OPTIONS' :key='item.id' variant='outlined' density='compact'
                :class='{selected: draft.size_id === item.id}' @click='draft.size_id = item.id')
            v-card-title(class='text-body-large') {{ item.label }}
            v-card-subtitle {{ item.dims }}
            v-card-text {{ item.subtitle }}
    img.size_guide(src='@/assets/images/book_sizes.avif' alt='' class='mt-5')

</template>


<script lang='ts' setup>

import {computed, ref} from 'vue'
import {useI18n} from '@/services/i18n'

import NewDesignCard from '@/comp/dialogs/assets/NewDesignCard.vue'
import img_btn_home from '@/assets/images/btn_home.avif'
import img_btn_pro from '@/assets/images/btn_pro.avif'

import type {NewDesignDraft} from '@/services/new_design'


// Wizard step 4: how the document will be printed — simplified compared to the main editor's
// options (single professional service, binding implied by design type, a curated size list)
const props = defineProps<{draft:NewDesignDraft}>()
const draft = props.draft

const {t} = useI18n()


// Whether the professional branch is expanded (chosen but possibly no size picked yet)
const professional = ref(draft.service_id !== null && draft.service_id !== 'home')


// The only trim sizes offered, each an exact match to a Lulu size id
const SIZE_OPTIONS = computed(() => [
    {id: 'novella', label: t("wizard.print.small"), dims: '5 × 8 inches', subtitle: t("wizard.print.size_small_desc")},
    {id: 'digest', label: t("wizard.print.medium"), dims: '5.5 × 8.5 inches', subtitle: t("wizard.print.size_medium_desc")},
    {id: 'us_trade', label: t("wizard.print.large"), dims: '6 × 9 inches', subtitle: t("wizard.print.size_large_desc")},
    {id: 'executive', label: t("wizard.print.extra_large"), dims: '7 × 10 inches', subtitle: t("wizard.print.size_xl_desc")},
])


// Methods

// Choose home printing — booklet folding is implied (build_new_blueprint sets it from the
// service). Leaves the paper size for the user to pick, clearing it if it's a professional
// trim size left over from switching branches
const choose_home = () => {
    professional.value = false
    draft.service_id = 'home'
    if (draft.size_id !== 'a4' && draft.size_id !== 'us_letter'){
        draft.size_id = null
    }
}


// Choose professional printing — Lulu is the only service offered, so this locks it in
// straight away rather than requiring a separate service-picking step. The trim size is left
// for the user to pick — cleared if it's a home paper size left over from switching. Binding /
// ink / paper aren't offered here; build_new_blueprint derives them from the service and type
const choose_professional = () => {
    professional.value = true
    draft.service_id = 'lulu'
    if (!SIZE_OPTIONS.value.some(item => item.id === draft.size_id)){
        draft.size_id = null
    }
}


</script>


<style lang='sass' scoped>

.grid
    display: grid
    grid-template-columns: 1fr 1fr
    gap: 12px

.grid_sizes
    display: grid
    grid-template-columns: repeat(4, 1fr)
    gap: 8px

.choice
    cursor: pointer

    &.selected
        border-color: rgb(var(--v-theme-secondary))
        border-width: 2px
        background-color: rgba(var(--v-theme-secondary), 0.08)

.size_guide
    display: block
    width: 100%
    height: auto
    border-radius: 8px

</style>
