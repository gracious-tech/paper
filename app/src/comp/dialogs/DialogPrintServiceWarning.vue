
<template lang='pug'>

v-dialog(:model-value='!!state.print_service_warning' persistent max-width='480')
    v-card
        v-card-title(class='px-6 pt-4') {{ $t("dialog.print_service_warning.title") }}
        v-card-text(class='px-6 pt-2')
            p(class='mb-4 text-body-medium') {{ $t("dialog.print_service_warning.body") }}
            v-checkbox(v-model='checked' :label='$t("dialog.print_service_warning.checkbox")'
                density='compact' color='primary')
        v-card-actions(class='px-6 pb-4')
            v-spacer
            v-btn(@click='dismiss' :disabled='!checked' color='primary')
                | {{ $t("common.dismiss") }}

</template>


<script lang='ts' setup>

import {ref, watch} from 'vue'

import {state} from '@/services/state'


// Ticked state of the required checkbox; cleared each time the dialog opens
const checked = ref(false)
watch(() => state.print_service_warning, request => {
    if (request){
        checked.value = false
    }
})


// Resolve the pending promise and close — only reachable once the checkbox is ticked (there's
// no cancel path, matching the "persistent" dialog that can't be dismissed any other way)
function dismiss():void{
    state.print_service_warning?.resolve()
    state.print_service_warning = null
}

</script>


<style lang='sass' scoped>

</style>
