
<template lang='pug'>

v-dialog(:model-value='modelValue' @update:model-value='close' max-width='440')
    v-card
        v-card-title {{$t("Account")}}
        v-card-text

            //- Guest — offer sign-in methods
            template(v-if='is_anonymous')
                p {{$t("You're using a guest account. Sign in to keep your work safe and access it from any device.")}}
                v-btn(@click='google' block color='secondary' class='mt-6' :loading='busy')
                    | {{$t("Sign in with Google")}}
                v-divider(class='my-6')
                template(v-if='email_sent')
                    p {{$t("Check your inbox — we've sent you a sign-in link.")}}
                template(v-else)
                    v-text-field(v-model='email' :label='$t("Email address")' type='email'
                        density='compact' hide-details class='mb-2')
                    v-btn(@click='send_email' block variant='tonal' :loading='busy'
                        :disabled='!email.includes("@")') {{$t("Email me a sign-in link")}}

            //- Signed in — show identity + sign out
            template(v-else)
                p {{$t("Signed in as")}}
                p(class='mb-6')
                    strong {{ user?.email || user?.displayName }}
                v-btn(@click='logout' variant='tonal' :loading='busy') {{$t("Sign out")}}

        v-card-actions
            v-spacer
            v-btn(@click='close') {{$t("Close")}}

</template>


<script lang='ts' setup>

import {ref} from 'vue'

import {user, is_anonymous, link_google, send_email_link, sign_out} from '@/services/auth'
import {init_designs, start_viewed_sync} from '@/services/designs'
import {restore_custom_fonts} from '@/services/custom_fonts'
import {report_error} from '@/services/errors'


defineProps<{modelValue:boolean}>()
const emit = defineEmits<{(event:'update:modelValue', value:boolean):void}>()


const email = ref('')
const email_sent = ref(false)
const busy = ref(false)


// Reload designs/versions after the account (uid) changed — merging into an existing account
// or signing out both switch to a different uid's data
// NOTE The design auto-save watcher from boot persists (it follows whatever design is open);
// ViewDesign.vue's own watcher restarts the scoped versions sync once current_design_id settles
const reload_user_data = async () => {
    await init_designs()
    start_viewed_sync()
    await restore_custom_fonts()
}


// Sign in with Google (links in place, or merges into an existing account)
const google = async () => {
    busy.value = true
    try {
        const result = await link_google()
        if (result === 'merged'){
            await reload_user_data()
        }
        close()
    } catch (error){
        report_error('banner', error)
    } finally {
        busy.value = false
    }
}


// Send a passwordless sign-in link (completed on next boot via the emailed link)
const send_email = async () => {
    busy.value = true
    try {
        await send_email_link(email.value.trim())
        email_sent.value = true
    } catch (error){
        report_error('banner', error)
    } finally {
        busy.value = false
    }
}


// Sign out into a fresh guest session
const logout = async () => {
    busy.value = true
    try {
        await sign_out()
        await reload_user_data()
        close()
    } catch (error){
        report_error('banner', error)
    } finally {
        busy.value = false
    }
}


const close = () => {
    emit('update:modelValue', false)
}

</script>


<style lang='sass' scoped>

</style>
