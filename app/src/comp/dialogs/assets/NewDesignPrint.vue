
<template lang='pug'>

p(class='mb-3 text-body-2 text-medium-emphasis') {{ $t("How would you like to print it?") }}

//- First decision: printing at home vs professionally
div.grid
    NewDesignCard(:image='img_btn_home' :label='$t("At home")'
        :subtitle='$t("Your own printer, regular paper")'
        :selected='draft.service_id === "home"' @select='choose_home')
    NewDesignCard(:image='img_btn_pro' :label='$t("Professionally")'
        :subtitle='$t("A printing service that makes real books")'
        :selected='professional' @select='choose_professional')

//- Home branch: just the printer's paper size (booklet folding is on by default, no option)
template(v-if='draft.service_id === "home"')
    div(class='mt-4 text-medium-emphasis') {{ $t("Printer's paper size") }}
    v-radio-group(v-model='draft.size_id' inline hide-details)
        v-radio(value='a4' label="A4")
        v-radio(value='us_letter' label="US Letter")

//- Professional branch: always Lulu, binding is implied by the design type — the only
//- choice offered here is the book's trim size, with a comparison image for scale
template(v-else-if='professional')
    div(class='mt-4 text-medium-emphasis') {{ $t("Book size") }}
    div.grid_sizes.mt-2
        v-card.choice(v-for='item in SIZE_OPTIONS' :key='item.id' variant='outlined' density='compact'
                :class='{selected: draft.size_id === item.id}' @click='draft.size_id = item.id')
            v-card-title(class='text-subtitle-1') {{ item.label }}
            v-card-subtitle {{ item.dims }}
            v-card-text {{ item.subtitle }}
    img.size_guide(src='@/assets/images/book_sizes.avif' alt='' class='mt-5')

</template>


<script lang='ts' setup>

import {computed, ref, watch} from 'vue'
import {useI18n} from 'vue-i18n'

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
    {id: 'novella', label: t("Small"), dims: '5 × 8 inches', subtitle: t("Feels like a novel")},
    {id: 'digest', label: t("Medium"), dims: '5.5 × 8.5 inches', subtitle: t("A good middle-ground")},
    {id: 'us_trade', label: t("Large"), dims: '6 × 9 inches', subtitle: t("Feels like a non-fiction book")},
    {id: 'executive', label: t("Extra Large"), dims: '7 × 10 inches', subtitle: t("Feels like a textbook")},
])


// Methods

// Choose home printing (restores the booklet default, but leaves the paper size for the user
// to pick — clearing it if it's a professional trim size left over from switching branches)
const choose_home = () => {
    professional.value = false
    draft.service_id = 'home'
    if (draft.size_id !== 'a4' && draft.size_id !== 'us_letter'){
        draft.size_id = null
    }
}


// Choose professional printing — Lulu is the only service offered, so this locks in its
// defaults straight away rather than requiring a separate service-picking step. The trim size
// is left for the user to pick — cleared if it's a home paper size left over from switching
const choose_professional = () => {
    professional.value = true
    draft.service_id = 'lulu'
    draft.booklet = false
    if (!SIZE_OPTIONS.value.some(item => item.id === draft.size_id)){
        draft.size_id = null
    }
    draft.binding_type = binding_for_type()
    draft.ink_type = 'bw'
    draft.paper_type = 'white'
}


// Coil binding suits a notes bible's flat-lay writing space, otherwise perfect bound (both
// Lulu binding ids) — the wizard never offers a binding choice
const binding_for_type = ():string => {
    return draft.type === 'notes' ? 'paperback_coil' : 'paperback'
}


// Keep the implied binding in sync if the user goes back and changes the design type
watch(() => draft.type, () => {
    if (draft.service_id === 'lulu'){
        draft.binding_type = binding_for_type()
    }
})


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
