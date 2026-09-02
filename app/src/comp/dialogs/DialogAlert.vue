<template lang='pug'>

v-dialog(:model-value='!!state.alert' max-width='420' @update:model-value='val => !val && dismiss()')
    //- Light red card — the alert dialog only ever carries warning text (the binding page-limit
    //- explanation, or a version's compile failure with its own "Try again" action)
    v-card(v-if='state.alert' class='bg-error-lighten-2')
        v-card-text.message
            app-icon.message_icon(name='error')
            span {{ state.alert.message }}
        v-card-actions
            v-spacer
            v-btn(v-if='state.alert.action' @click='act' variant='tonal' color='white')
                | {{ state.alert.action }}
            v-btn(@click='dismiss' variant='tonal' color='white') {{$t("common.ok")}}

</template>


<script lang='ts' setup>

import {state} from '@/services/state'


// Resolve the pending alert request as "action button clicked" and close the dialog
const act = () => {
    state.alert?.resolve(true)
    state.alert = null
}

// Resolve the pending alert request as plain dismissal (also covers backdrop/esc dismissal)
const dismiss = () => {
    state.alert?.resolve(false)
    state.alert = null
}

</script>


<style lang='sass' scoped>

// Error icon sitting alongside the message, top-aligned so it stays with the first line of
// longer text
.message
    display: flex
    align-items: flex-start
    gap: 12px

.message_icon
    flex-shrink: 0
    height: 32px
    width: 32px
    color: rgb(var(--v-theme-error-darken-2))

</style>
