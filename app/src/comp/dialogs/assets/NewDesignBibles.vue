
<template lang='pug'>

template(v-if='picking === null')
    p(class='mb-3 text-body-medium text-medium-emphasis')
        | {{ $t("What Bible translation would you like to use?") }}
    v-list(bg-color='transparent')
        v-list-item(@click='picking = 0')
            v-list-item-title {{ primary_title }}
        v-list-item(@click='picking = 1')
            v-list-item-title(:class='{"text-disabled": !draft.bibles[1]}') {{ secondary_title }}
            template(#append)
                v-btn(v-if='draft.bibles[1] && draft.type !== "bilingual"' icon variant='text'
                        @click.stop='rm_secondary')
                    app-icon(name='close')
    p.hint(v-if='draft.type === "bilingual" && !draft.bibles[1]' class='text-body-medium mt-2')
        | {{$t("Bilingual bibles need a second translation")}}
    p.hint(v-if='duplicate' class='text-body-medium mt-2 text-error')
        | {{$t("The two translations must be different")}}
    div(v-if='warnings.length' class='mt-2 text-error text-body-medium')
        div(v-for='warning of warnings') {{ warning }}

BiblePicker(v-else :model-value='draft.bibles[picking] ?? draft.bibles[0] ?? null'
        @update:model-value='select')
    template(#actions)
        v-btn(@click='picking = null' variant='text' size='large') {{$t("Cancel")}}

</template>


<script lang='ts' setup>

import {computed, ref, watch} from 'vue'
import {useI18n} from 'vue-i18n'

import {content} from '@/services/content'
import {missing_book_warnings} from '@/services/blueprints'
import BiblePicker from '@/comp/reuseable/BiblePicker.vue'

import type {NewDesignDraft} from '@/services/new_design'


// Wizard step 3: choose one or two translations (two required for bilingual designs). While
// the picker subview is open the wizard hides its own navigation (via the busy emit)
const props = defineProps<{draft:NewDesignDraft}>()
const draft = props.draft
const emit = defineEmits<{(e:'busy', value:boolean):void}>()

const {t} = useI18n()


// Default the primary slot to the preferred translation on first reaching this step (rather
// than in get_default_draft(), so the step isn't marked complete until actually viewed)
if (!draft.bibles.length){
    draft.bibles.push(content.collection.get_preferred_resource().id)
}


// Which slot (0/1) is currently being picked, null when showing the summary list
const picking = ref<number|null>(null)
watch(picking, value => {
    emit('busy', value !== null)
})


// Display names for the two slots
const primary_title = computed(() => {
    const trans = content.translations[draft.bibles[0]!]!
    return trans.name_local || trans.name_english
})
const secondary_title = computed(() => {
    if (!draft.bibles[1]){
        return t("Add additional translation")
    }
    const trans = content.translations[draft.bibles[1]]!
    return trans.name_local || trans.name_english
})


// Whether both slots hold the same translation (blocks proceeding via step validation)
const duplicate = computed(() => {
    return !!draft.bibles[1] && draft.bibles[0] === draft.bibles[1]
})


// Books referenced by whichever of the previous step's two modes is active
const referenced_books = computed(() => {
    if (draft.book_mode === 'books'){
        return draft.books
    }
    return draft.passages
        .map(passage => passage.book)
        .filter((book):book is string => book !== null)
})


// Warn if either chosen translation doesn't include one of the referenced books
const warnings = computed(() => {
    return missing_book_warnings(referenced_books.value, draft.bibles, t)
})


// Methods

const select = (id:string) => {
    draft.bibles[picking.value!] = id
    picking.value = null
}

const rm_secondary = () => {
    draft.bibles.splice(1, 1)
}


</script>


<style lang='sass' scoped>

.hint
    opacity: 0.8

</style>
