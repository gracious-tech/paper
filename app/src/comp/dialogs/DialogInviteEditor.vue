
<template lang='pug'>

v-dialog(:model-value='modelValue' @update:model-value='close' max-width='520')
    v-card
        v-card-title {{ is_owner ? $t("Invite an editor") : $t("People with access") }}
        v-card-text
            template(v-if='is_owner')
                p(class='text-caption mb-4')
                    | {{$t("Anyone with this link can join as an editor and make changes together with you.")}}
                v-text-field(v-if='share_url' :model-value='share_url' readonly density='compact'
                        hide-details class='mb-2' @focus='select_all')
                    template(#append-inner)
                        v-btn(@click='copy_link' variant='text' size='small')
                            | {{ copied ? $t("Copied!") : $t("Copy") }}
                v-btn(@click='reset_link' variant='tonal' size='small') {{$t("Reset link")}}
                p(class='text-caption mt-1')
                    | {{$t("Disables the previous link so it can no longer be used to become an editor.")}}
                v-divider(class='my-4')

            p(class='mb-2') {{$t("People with access:")}}
            v-progress-circular(v-if='loading_editors' indeterminate color='secondary'
                size='24')
            v-list(v-else density='compact')
                v-list-item(v-for='person of editors' :key='person.uid')
                    v-list-item-title
                        | {{ person.name || person.email || $t("Guest") }}
                        v-chip(v-if='person.owner' size='x-small' variant='tonal' class='ml-2')
                            | {{$t("Owner")}}
                    v-list-item-subtitle(v-if='person.name && person.email') {{ person.email }}
                    template(#append)
                        v-btn(v-if='is_owner && !person.owner' @click='kick_editor(person.uid)'
                                icon='mdi-close' variant='text' size='small' color='error')
        v-card-actions
            v-spacer
            v-btn(@click='close') {{$t("Close")}}

</template>


<script lang='ts' setup>

import {computed, ref, watch} from 'vue'

import {designs, reset_design_share_token, remove_design_editor, fetch_design_editors_info}
    from '@/services/designs'
import {user} from '@/services/auth'
import {report_error} from '@/services/errors'

import type {DesignEditorInfo} from '@/services/types'


const props = defineProps<{modelValue:boolean, id:string}>()
const emit = defineEmits<{(event:'update:modelValue', value:boolean):void}>()


// Feedback flash for the copy button
const copied = ref(false)


// Whether the current user owns this design (only owners may invite/remove editors, per
// security rules) — computed here rather than passed in, so any editor can open this dialog
const is_owner = computed(() => {
    return designs.find(item => item.id === props.id)?.owner === user.value?.uid
})


// Live share-invite token for this design (null only for designs created before sharing was
// always-on; backfilled below rather than shown as a disabled state)
const share_token = computed(() => {
    return designs.find(item => item.id === props.id)?.share_token ?? null
})


// The full share link, carrying the invite token (kept out of the app's normal URLs since it's
// a one-time credential — see ViewDesignInvite.vue for how it's redeemed and stripped)
const share_url = computed(() => {
    return share_token.value ? `${location.origin}/designs/${props.id}/invite/${share_token.value}`
        : ''
})


// The owner + editors with their names/emails, resolved server-side (Admin Auth) since other
// users' auth profiles aren't client-readable directly
const editors = ref([] as DesignEditorInfo[])
const loading_editors = ref(false)


// Sharing is always on — generate a link immediately for any design that predates this. Also
// (re)fetch the participant list every time the dialog opens
watch(() => props.modelValue, async open => {
    if (!open){
        return
    }
    if (is_owner.value && !share_token.value){
        void reset_design_share_token(props.id)
    }
    loading_editors.value = true
    try {
        editors.value = await fetch_design_editors_info(props.id)
    } catch (error){
        report_error('banner', error)
    } finally {
        loading_editors.value = false
    }
}, {immediate: true})


// Invalidate the old invite link and issue a fresh one
const reset_link = () => {
    void reset_design_share_token(props.id)
}

// Remove a single editor from a shared design (optimistic, since the list isn't live-synced)
const kick_editor = async (uid:string) => {
    editors.value = editors.value.filter(item => item.uid !== uid)
    try {
        await remove_design_editor(props.id, uid)
    } catch (error){
        report_error('banner', error)
    }
}

// Copy the link to the clipboard with brief feedback
const copy_link = async () => {
    await navigator.clipboard.writeText(share_url.value)
    copied.value = true
    setTimeout(() => {
        copied.value = false
    }, 2000)
}

// Select the whole link when its field is focused (easy manual copy)
const select_all = (event:FocusEvent) => {
    (event.target as HTMLInputElement).select()
}

const close = () => {
    emit('update:modelValue', false)
}

</script>


<style lang='sass' scoped>

</style>
