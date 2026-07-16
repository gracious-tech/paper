
<template lang='pug'>

v-dialog(:model-value='!!state.design_invite' persistent max-width='420')

    //- Loaded — ask whether to accept edit access
    v-card(v-if='preview')
        v-card-title {{ preview.name || $t("Unnamed design") }}
        v-card-text {{$t("You've been granted edit access to this document.")}}
        v-card-actions
            v-spacer
            v-btn(@click='ignore') {{$t("Ignore")}}
            v-btn(@click='accept' color='secondary' :loading='accepting') {{$t("Accept")}}

    //- Link didn't resolve (deleted, or invalidated by a fresh invite link since)
    v-card(v-else-if='failed')
        v-card-text {{$t("This invite link is invalid or has been disabled.")}}
        v-card-actions
            v-spacer
            v-btn(@click='ignore') {{$t("Close")}}

    //- Still loading
    v-card(v-else)
        v-card-text(class='text-center py-8')
            v-progress-circular(indeterminate color='secondary')

</template>


<script lang='ts' setup>

import {ref, watch} from 'vue'
import {useRouter} from 'vue-router'
import {useI18n} from 'vue-i18n'

import {state, show_toast} from '@/services/state'
import {ApiError} from '@/services/api'
import {fetch_design_invite_preview, redeem_design_share} from '@/services/designs'
import {report_error} from '@/services/errors'


const router = useRouter()
const {t} = useI18n()


const preview = ref(null as null|{name:string})
const failed = ref(false)
const accepting = ref(false)


// Fetch a preview of the invite's target whenever a link arrives, without redeeming it —
// redemption (adding the caller as an editor) only happens once the user explicitly accepts
watch(() => state.design_invite, async invite => {
    preview.value = null
    failed.value = false
    accepting.value = false
    if (!invite){
        return
    }
    try {
        preview.value = await fetch_design_invite_preview(invite.design_id, invite.token)
    } catch {
        failed.value = true
    }
}, {immediate: true})


// Accept — redeem the invite (grants edit access), then open the design
const accept = async () => {
    const invite = state.design_invite
    if (!invite){
        return
    }
    accepting.value = true
    try {
        await redeem_design_share(invite.design_id, invite.token)
        state.design_invite = null
        await router.push({name: 'design', params: {id: invite.design_id}})
    } catch (error){
        // A dead invite (link rotated/design deleted since the preview) is an expected case,
        // shown via the dialog's failed state rather than reported as an app error
        if (error instanceof ApiError && error.code === 'unknown_share'){
            failed.value = true
        } else {
            show_toast(t("Couldn't accept the invite — try the link again"))
            report_error('banner', error)
        }
    } finally {
        accepting.value = false
    }
}


// Dismiss without becoming an editor
const ignore = () => {
    state.design_invite = null
}

</script>


<style lang='sass' scoped>

</style>
