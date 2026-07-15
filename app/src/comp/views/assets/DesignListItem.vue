
<template lang='pug'>

v-list-item(@click='open' color='primary')
    v-list-item-title {{ design.name || $t("Unnamed design") }}
    v-list-item-subtitle {{ design.modified.toLocaleString() }}
    template(#append)
        app-icon(v-if='design.shared' name='group' class='mr-2' :title='$t("Shared design")')
        v-menu
            template(#activator='{props}')
                v-btn(v-bind='props' icon variant='text' color='black' @click.stop)
                    app-icon(name='more_vert')
            v-list
                v-list-item(@click='rename')
                    v-list-item-title {{$t("Rename")}}
                v-list-item(@click='duplicate')
                    v-list-item-title {{$t("Duplicate")}}
                v-list-item(@click='show_invite = true')
                    v-list-item-title
                        | {{ is_owner ? $t("Invite an editor") : $t("People with access") }}
                v-list-item(v-if='is_owner' @click='remove')
                    v-list-item-title {{$t("Delete")}}
    DialogInviteEditor(v-model='show_invite' :id='design.id')

</template>


<script lang='ts' setup>

import {computed, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {useRouter} from 'vue-router'

import DialogInviteEditor from '@/comp/dialogs/DialogInviteEditor.vue'
import {user} from '@/services/auth'
import {confirm_dialog, prompt_dialog} from '@/services/state'
import {rename_design, duplicate_design, delete_design} from '@/services/designs'

import type {DesignMeta} from '@/services/types'


const {t} = useI18n()
const router = useRouter()


const props = defineProps<{design:DesignMeta}>()


// Whether the current user owns this design (only owners may delete/invite, per security rules)
const is_owner = computed(() => props.design.owner === user.value?.uid)


// Whether the invite-editor dialog is open
const show_invite = ref(false)


const open = () => {
    void router.push({name: 'design', params: {id: props.design.id}})
}

const rename = async () => {
    const title = await prompt_dialog(t("Rename design"), props.design.name)
    if (title !== null){
        void rename_design(props.design.id, title)
    }
}

const duplicate = async () => {
    const new_id = await duplicate_design(props.design.id)
    await router.push({name: 'design', params: {id: new_id}})
}

const remove = async () => {
    if (await confirm_dialog(t("Delete this design? This cannot be undone."))){
        void delete_design(props.design.id)
    }
}

</script>


<style lang='sass' scoped>

</style>
