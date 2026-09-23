
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

            //- Deleting ends the content, below a divider and away from the sign-in actions above,
            //- since it's the one action here that can't be undone. Offered to guests too — an
            //- anonymous account is still an account, and its designs are still the user's to
            //- remove. What it destroys is spelled out in the confirmation it opens, so it needs
            //- no caption of its own
            v-divider(class='my-6')
            h4(class='text-title-small mb-2') {{$t("dialog.account.management")}}
            v-btn(@click='destroy' variant='text' :loading='busy')
                | {{ delete_label }}

        v-card-actions
            v-spacer
            v-btn(@click='close') {{$t("common.close")}}

</template>


<script lang='ts' setup>

import {ref, computed, watch} from 'vue'

import {user, is_anonymous, link_google, send_email_link, sign_out} from '@/services/auth'
import {release_user_data, reload_user_data, delete_account} from '@/services/account'
import {report_error} from '@/services/errors'
import {show_toast, prompt_dialog, confirm_dialog} from '@/services/state'
import {generating_here} from '@/services/compile_progress'
import {router} from '@/services/router'
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


// Sign in with Google (links in place, or merges into an existing account)
// NOTE Deliberately not run behind the busy lock while the popup is open — that wait is however
// long the user takes, and clicking again is exactly how a popup that was closed or lost behind
// the window gets recovered (Firebase cancels the previous request and opens a fresh one). The
// lock is raised only once the work becomes ours, via link_google()'s `on_merging` callback
const google = async () => {
    try {
        const result = await link_google(() => {
            busy.value = true
            // Merging signs in as the *other* account, so let go of this one's data first
            release_user_data()
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
const logout = async () => {
    // A generation running in this tab writes as the current account, so signing out would
    // leave it unable to finish — check first (outside the busy lock, as it's a wait on the user)
    if (generating_here.value && !await confirm_dialog(t('dialog.account.sign_out_generating'))){
        return
    }
    await sign_out_now()
}


// The sign-out itself, once confirmed
const sign_out_now = () => run_busy(async () => {
    release_user_data()
    await sign_out()
    // Leave whatever design the old account had open — the new guest uid can't read it — and
    // land on the (empty) design list rather than being greeted as a first-time visitor
    await router.push({name: 'designs'})
    await reload_user_data(false)
    close()
})


// What the destructive action is called. A guest has a real account in Firebase's terms, but has
// never been asked to think of it as one — they were never shown a sign-up — so for them what
// goes is their data. Derived once because the button and its confirmation must agree
const delete_label = computed(() => {
    return is_anonymous.value ? t('dialog.account.delete_data') : t('dialog.account.delete')
})


// Delete the account and everything in it, after a typed confirmation
// NOTE Deliberately a typed word rather than a plain confirm: this is the one irreversible action
// in the app that a mis-tap can't be recovered from, since there is nothing left to restore from
const destroy = async () => {
    // The word is its own key and reaches the message as a placeholder, so a translator can't
    // leave the two saying different things (which would make the dialog impossible to satisfy)
    const word = t('dialog.account.delete_word')
    const answer = await prompt_dialog(t('dialog.account.delete_confirm', {word}), '', {
        confirm_label: delete_label.value,
        confirm_color: 'error',
        require: word,
    })
    // Only a matching answer resolves with a value (the dialog keeps its button disabled
    // otherwise), so anything null here is a cancel or a dismissal
    if (answer === null){
        return
    }
    await run_busy(async () => {
        await delete_account()
        // Land on the (now empty) design list rather than a design the deleted uid owned
        await router.push({name: 'designs'})
        show_toast(t('dialog.account.deleted'))
        close()
    })
}


const close = () => {
    emit('update:modelValue', false)
}

</script>


<style lang='sss' scoped>

</style>
