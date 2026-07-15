
<template lang='pug'>

v-dialog(:model-value='!!state.prompt' max-width='420' @update:model-value='val => !val && cancel()')
    v-card(v-if='state.prompt')
        v-card-text
            p(class='mb-2') {{ state.prompt.message }}
            v-text-field(v-model='state.prompt.value' density='compact' hide-details autofocus
                    @keyup.enter='ok')
        v-card-actions
            v-spacer
            v-btn(@click='cancel') {{$t("Cancel")}}
            v-btn(@click='ok' color='primary') {{$t("OK")}}

</template>


<script lang='ts' setup>

import {state} from '@/services/state'


// Resolve the pending prompt request with the entered value
const ok = () => {
    state.prompt?.resolve(state.prompt.value)
    state.prompt = null
}

// Resolve the pending prompt request as cancelled (also covers dismissing via backdrop/esc)
const cancel = () => {
    state.prompt?.resolve(null)
    state.prompt = null
}

</script>


<style lang='sass' scoped>

</style>
