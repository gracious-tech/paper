
<template lang='pug'>

BiblePicker(:model-value='blue.bibles[bibles_index] ?? blue.bibles[0] ?? null'
        @update:model-value='select')
    template(#actions)
        v-btn(@click='cancel' variant='text' size='large') {{$t("Cancel")}}

</template>


<script lang='ts' setup>


import {blue, state} from '@/services/state'
import BiblePicker from '@/comp/reuseable/BiblePicker.vue'


// Thin design-editor wrapper around the generic BiblePicker: writes the choice into the open
// design's bibles and closes the editor pane
const props = defineProps<{bibles_index:number}>()

// Pre-fill the slot being edited so cancelling still leaves a valid selection (e.g. opening
// the "add additional translation" slot immediately mirrors the primary)
if (!blue.bibles[props.bibles_index]){
    blue.bibles[props.bibles_index] = blue.bibles[0]!
}


// Methods

const select = (id:string) => {
    blue.bibles[props.bibles_index] = id
    state.editor = null
}

const cancel = () => {
    state.editor = null
}


</script>


<style lang='sass' scoped>


</style>
