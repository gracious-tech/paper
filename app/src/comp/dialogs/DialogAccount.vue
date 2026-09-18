
<template lang='pug'>

v-dialog(:model-value='modelValue' @update:model-value='close' max-width='440')
    v-card
        v-card-title {{$t("common.account")}}
        v-card-text

            //- Guest — offer sign-in methods
            template(v-if='is_anonymous')
                p {{$t("dialog.account.guest_notice")}}
                v-btn(@click='google' block color='secondary' class='mt-6' :loading='busy')
                    template(#prepend)
                        AppIcon(name='google')
                    | {{$t("dialog.account.google")}}
                v-divider(class='my-6')
                template(v-if='email_sent')
                    p {{$t("dialog.account.link_sent")}}
                template(v-else)
                    v-text-field(v-model='email' :label='$t("dialog.account.email_address")' type='email'
                        density='compact' hide-details class='mb-2')
                    v-btn(@click='send_email' block variant='tonal' :loading='busy'
                        :disabled='!email.includes("@")') {{$t("dialog.account.send_link")}}

            //- Signed in — show identity + sign out
            template(v-else)
                p {{$t("dialog.account.signed_in_as")}}
                p(class='mb-6')
                    strong {{ user?.email || user?.displayName }}
                v-btn(@click='logout' variant='tonal' :loading='busy') {{$t("dialog.account.sign_out")}}

        v-card-actions
            v-spacer
            v-btn(@click='close') {{$t("common.close")}}

</template>


<script lang='ts' setup>

import {ref, watch} from 'vue'

import {user, is_anonymous, link_google, send_email_link, sign_out} from '@/services/auth'
import {init_designs, start_viewed_sync} from '@/services/designs'
import {restore_custom_fonts} from '@/services/custom_fonts'
import {report_error} from '@/services/errors'
import {show_toast} from '@/services/state'
import {useI18n} from '@/services/i18n'


const props = defineProps<{modelValue:boolean}>()
const emit = defineEmits<{(event:'update:modelValue', value:boolean):void}>()


const {t} = useI18n()


const email = ref('')
const email_sent = ref(false)
const busy = ref(false)


// This dialog stays mounted for the app's lifetime (AppRoot), so reset per-open state each time
// it opens — otherwise a sent link, or a busy lock that outlived its action, persists until reload
watch(() => props.modelValue, opened => {
    if (opened){
        email.value = ''
        email_sent.value = false
        busy.value = false
    }
})


// Run an action behind the busy lock, reporting only genuine failures
// NOTE Only for bounded work of our own — never for a wait on the user, which would leave the
// button dead for as long as they take
const run_busy = async (action:() => Promise<void>) => {
    if (busy.value){
        return
    }
    busy.value = true
    try {
        await action()
    } catch (error){
        report_error('banner', error)
    } finally {
        busy.value = false
    }
}


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
// NOTE Deliberately not run behind the busy lock while the popup is open — that wait is however
// long the user takes, and clicking again is exactly how a popup that was closed or lost behind
// the window gets recovered (Firebase cancels the previous request and opens a fresh one). The
// lock is raised only once the work becomes ours, via link_google()'s `on_merging` callback
const google = async () => {
    try {
        const result = await link_google(() => {
            busy.value = true
        })

        // The user dismissed the popup — leave the dialog as it was so they can simply try again
        if (result === 'cancelled'){
            return
        }

        // The browser blocked the popup, which only the user can undo
        if (result === 'blocked'){
            show_toast(t('dialog.account.popup_blocked'))
            return
        }

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
const send_email = () => run_busy(async () => {
    await send_email_link(email.value.trim())
    email_sent.value = true
})


// Sign out into a fresh guest session
const logout = () => run_busy(async () => {
    await sign_out()
    await reload_user_data()
    close()
})


const close = () => {
    emit('update:modelValue', false)
}

</script>


<style lang='sss' scoped>

</style>
