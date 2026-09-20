
<template lang='pug'>

v-dialog(:model-value='!!state.prompt' max-width='420' @update:model-value='val => !val && cancel()')
    v-card(v-if='state.prompt')
        v-card-text
            p(class='mb-2') {{ state.prompt.message }}
            v-text-field(v-model='state.prompt.value' density='compact' hide-details autofocus
                    @keyup.enter='ok' v-bind='input_attrs')
        v-card-actions
            v-spacer
            v-btn(@click='cancel') {{$t("common.cancel")}}
            v-btn(@click='ok' :color='state.prompt.confirm_color || "primary"'
                :disabled='!can_confirm')
                | {{ state.prompt.confirm_label || $t("common.ok") }}

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {state} from '@/services/state'


// Whether the confirm button is live. A prompt with no `require` always is (the answer can even
// be blank — renaming to nothing is the caller's business, not this dialog's); one with a
// `require` waits for that exact answer, trimmed and case-insensitive so a phone's autocapitalise
// or a stray space can't refuse a correct one
const can_confirm = computed(() => {
    const prompt = state.prompt
    if (!prompt?.require){
        return true
    }
    return prompt.value.trim().toLowerCase() === prompt.require.trim().toLowerCase()
})


// Extra input attributes for a prompt with a required answer. The word is there to be copied off
// the message in front of the user, never recalled, so autofill, saved-value dropdowns, password
// managers and spellcheck squiggles are all pure noise over it — and a history dropdown offering
// back a previous answer is the opposite of a deliberate confirmation.
// Left alone for an ordinary prompt (renaming a design), where a suggestion can genuinely help.
// autocapitalize is deliberately not disabled: a phone helpfully typing DELETE in caps is fine,
// since can_confirm compares case-insensitively
const input_attrs = computed(() => {
    if (!state.prompt?.require){
        return {}
    }
    return {
        // These three reach the <input> itself, which is what makes them work
        autocomplete: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        // 1Password's opt-out, which it honours on an ancestor — necessary here, because Vuetify
        // routes every data-* attribute to the field's wrapper rather than the input
        // (filterInputAttrs in vuetify/lib/util/helpers.js). The equivalents that must sit on the
        // input itself, like data-lpignore, are deliberately not set: they'd land on the wrapper
        // too and do nothing but suggest coverage that isn't there
        'data-1p-ignore': 'true',
    }
})


// Resolve the pending prompt request with the entered value
// NOTE Re-checks can_confirm because Enter reaches here too, bypassing the button's disabled state
const ok = () => {
    if (!can_confirm.value){
        return
    }
    state.prompt?.resolve(state.prompt.value)
    state.prompt = null
}

// Resolve the pending prompt request as cancelled (also covers dismissing via backdrop/esc)
const cancel = () => {
    state.prompt?.resolve(null)
    state.prompt = null
}

</script>


<style lang='sss' scoped>

</style>
