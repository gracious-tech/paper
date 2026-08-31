
<template lang='pug'>

v-dialog(:model-value='!!state.confirm' max-width='420' @update:model-value='val => !val && cancel()')
    v-card(v-if='state.confirm')
        v-card-text {{ state.confirm.message }}
        v-card-actions
            v-spacer
            v-btn(@click='cancel') {{$t("common.cancel")}}
            v-btn(@click='ok' color='primary') {{$t("common.ok")}}

</template>


<script lang='ts' setup>

import {state} from '@/services/state'


// Resolve the pending confirm request as accepted
const ok = () => {
    state.confirm?.resolve(true)
    state.confirm = null
}

// Resolve the pending confirm request as declined (also covers dismissing via backdrop/esc)
const cancel = () => {
    state.confirm?.resolve(false)
    state.confirm = null
}

</script>


<style lang='sass' scoped>

</style>
