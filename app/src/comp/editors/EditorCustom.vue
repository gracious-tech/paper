
<template lang='pug'>

v-card-title(class='d-flex align-center')
    | {{$t("editor.custom.edit_text")}}
    v-spacer
    v-btn(@click='cancel' size='large' variant='text') {{$t("common.cancel")}}
    v-btn(@click='done' size='large' variant='text' color='secondary') {{$t("common.done")}}

v-divider

v-card-text(class='flex-grow-1 d-flex flex-column')
    div(class='mb-4')
        v-text-field(v-model='item.name' :placeholder='$t("common.label") + "..."')
    app-prose(v-model='item.doc' class='flex-grow-1')
    AppOptionToggle(v-model='item.position' :label='$t("editor.custom.vertical_position")'
        :items='position_items' class='mt-4 mb-4')

    //- Only offered while this is the document's final item, since that's the only case the
    //- setting can act on — it's a document-wide setting, not a property of this page
    template(v-if='is_last')
        v-checkbox(v-model='blue.last_item_at_end'
            :label='$t("editor.custom.last_item_at_end")' hide-details)
        p(class='hint') {{$t("editor.custom.last_item_at_end_note")}}

</template>


<script lang='ts' setup>

import {computed, reactive} from 'vue'
import {useI18n} from '@/services/i18n'

import {blue, state} from '@/services/state'
import {generate_token} from '@/services/utils'

import type {ContentCustom} from '@/services/types'


const props = defineProps<{item:ContentCustom|null}>()

const {t} = useI18n()


// Vertical placement of the custom content on its page
const position_items = computed(() => [
    {value: 'top', title: t("common.top")},
    {value: 'middle', title: t("common.middle")},
    {value: 'bottom', title: t("common.bottom")},
])


// Keep copy of original so can restore if cancel — including the document-wide "last item on
// the last page" setting, which this editor offers (see is_last) and cancelling must also undo
const original = props.item ? {...props.item} : null
const original_at_end = blue.last_item_at_end


// Create if a new item
let item = props.item!
if (!item){
    item = reactive({
        type: 'custom',
        id: generate_token(),
        name: '',
        doc: {type: 'doc', content: [{type: 'paragraph'}]},
        position: 'top',
    } as ContentCustom)
    blue.content.push(item)
}


// Whether this page is currently the document's last item. A new one always is (it's appended
// above), and reordering the content list while this editor is open updates it
const is_last = computed(() => blue.content.at(-1)?.id === item.id)


const done = () => {
    state.editor = null
}


const cancel = () => {
    blue.last_item_at_end = original_at_end
    if (original){
        Object.assign(item, original)
    } else {
        blue.content.splice(blue.content.length-1, 1)
    }
    state.editor = null
}

</script>


<style lang='sass' scoped>


</style>
