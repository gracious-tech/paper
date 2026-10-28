
<template lang='pug'>

BiblePicker(:model-value='blue.bibles[bibles_index] ?? blue.bibles[0] ?? null'
        @update:model-value='select')
    template(#actions)
        v-btn(@click='cancel' variant='text' size='large') {{$t("common.cancel")}}

</template>


<script lang='ts' setup>


import {blue, state} from '@/services/state'
import BiblePicker from '@/comp/reuseable/BiblePicker.vue'


// Thin design-editor wrapper around the generic BiblePicker: writes the choice into the open
// design's bibles and closes the editor pane
const props = defineProps<{bibles_index:number}>()

// Methods

// Write the choice into the slot (an empty "additional translation" slot stays empty until
// one is chosen, so cancelling adds nothing). The same translation twice is never a valid
// pairing, so choosing the one the other slot already holds changes nothing
const select = (id:string) => {
    if (!blue.bibles.some((bible, i) => bible === id && i !== props.bibles_index)){
        blue.bibles[props.bibles_index] = id
    }
    state.editor = null
}

const cancel = () => {
    state.editor = null
}


</script>


<style lang='sss' scoped>


</style>
