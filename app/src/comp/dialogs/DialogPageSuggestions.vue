
<template lang='pug'>

v-dialog(v-model='open' max-width='480')
    v-card
        v-card-title(class='px-6 pt-4') {{ $t("page_suggestions.title") }}
        v-card-text(class='px-6 pt-2')
            p(class='mb-5 text-body-medium text-medium-emphasis')
                | {{ suggestions.length ? $t("page_suggestions.intro") : $t("page_suggestions.intro_none") }}
            v-checkbox(v-for='suggestion of suggestions' :key='suggestion.id' v-model='selected'
                :value='suggestion.id' :label='suggestion.text' density='compact' hide-details
                color='primary' class='my-2')
        v-card-actions(class='px-6 pb-4')
            v-spacer
            v-btn(@click='open = false') {{ $t("common.dismiss") }}
            v-btn(v-if='suggestions.length' @click='apply' color='primary'
                :disabled='!selected.length') {{ $t("page_suggestions.apply") }}

</template>


<script lang='ts' setup>

import {computed, ref, watch} from 'vue'
import {useI18n} from '@/services/i18n'

import {state, blue} from '@/services/state'
import {page_reduction_suggestions} from '@/services/blueprints'


const {t} = useI18n()


// Bound to state.page_suggestions so any page-limit warning can open this from anywhere
const open = computed({
    get: () => state.page_suggestions,
    set: value => {
        state.page_suggestions = value
    },
})


// Applicable tweaks for the open design, recomputed live so a warning box behind the dialog
// and this list never disagree
const suggestions = computed(() => page_reduction_suggestions(blue, t))


// Ids of the ticked suggestions; cleared each time the dialog opens
const selected = ref<string[]>([])
watch(open, is_open => {
    if (is_open){
        selected.value = []
    }
})


// Merge every ticked suggestion's patch into the live blueprint, then close — designs.ts picks
// up the mutations and the user re-generates to get a new version
const apply = () => {
    for (const suggestion of suggestions.value){
        if (selected.value.includes(suggestion.id)){
            Object.assign(blue, suggestion.patch)
        }
    }
    open.value = false
}

</script>


<style lang='sass' scoped>

</style>
