
<template lang='pug'>

v-list-item(@click='select' :active='version.id === selected_version_id' color='primary')
    v-list-item-title
        | {{ is_latest ? $t("Latest version") : version.created.toLocaleString() }}
    v-list-item-subtitle(v-if='is_latest || expired')
        template(v-if='is_latest') {{ version.created.toLocaleString() }}
        template(v-if='expired') &nbsp;— {{$t("Expired")}}
    template(#append)
        div.status
            v-progress-circular(v-if='version.status === "pending"' indeterminate size='32'
                color='secondary')
            app-icon(v-else-if='version.status === "failed"' name='error' class='text-error')
        v-menu
            template(#activator='{props}')
                v-btn(v-bind='props' icon variant='text' color='black' @click.stop)
                    app-icon(name='more_vert')
            v-list
                v-list-item(@click='download'
                        :disabled='version.status !== "available" || expired')
                    v-list-item-title {{$t("Open")}}
                v-list-item(v-if='version.blueprint.cover' @click='download_cover'
                        :disabled='version.status !== "available" || expired')
                    v-list-item-title {{$t("Open cover")}}
                template(v-if='editable')
                    v-list-item(v-if='expired || version.status === "failed"' @click='regen')
                        v-list-item-title {{$t("Regenerate")}}
                    v-list-item(@click='edit_in_place')
                        v-list-item-title {{$t("Edit")}}
                    v-list-item(@click='duplicate')
                        v-list-item-title {{$t("Copy as new design")}}
                v-list-item(@click='share' :disabled='version.status === "pending"')
                    v-list-item-title {{$t("Share")}}
                v-list-item(v-if='editable' @click='remove'
                        :disabled='version.status === "pending"')
                    v-list-item-title {{$t("Delete")}}
    DialogShareVersion(v-model='show_share' :design_id='design_id' :version_id='version.id')

</template>


<script lang='ts' setup>

import {computed, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {useRouter} from 'vue-router'

import DialogShareVersion from '@/comp/dialogs/DialogShareVersion.vue'
import {show_toast, confirm_dialog} from '@/services/state'
import {create_design, restore_version_into_design} from '@/services/designs'
import {get_pdf_url, get_cover_pdf_url, delete_version, regenerate_version, version_expired,
    share_version, selected_version_id} from '@/services/versions'

import type {Version} from '@/services/types'


const {t} = useI18n()
const router = useRouter()


const props = defineProps<{version:Version, design_id:string, is_latest?:boolean,
    editable:boolean}>()


// Whether the share dialog is open
const show_share = ref(false)


// Whether the PDF has passed its 1-year Storage lifetime (metadata remains, can regenerate)
const expired = computed(() => version_expired(props.version))


const select = () => {
    void router.push({name: 'design', params: {id: props.design_id, version: props.version.id}})
}

const download = async () => {
    // Open the stored PDF in a new tab
    // NOTE Window opened before the async URL resolution so popup blockers see a user gesture
    const win = self.open('', '_blank')
    const url = await get_pdf_url(props.version)
    if (url && win){
        win.location.href = url
    } else {
        win?.close()
    }
}

const download_cover = async () => {
    // Open the version's separate cover PDF in a new tab (same popup-safe pattern as above)
    const win = self.open('', '_blank')
    const url = await get_cover_pdf_url(props.version)
    if (url && win){
        win.location.href = url
    } else {
        win?.close()
    }
}

const regen = async () => {
    // Recompile the expired/failed PDF from the version's frozen blueprint
    await regenerate_version(props.version)
}

const duplicate = async () => {
    // Fork the version's blueprint into a brand new design (non-destructive)
    const new_id = await create_design(props.version.blueprint)
    await router.push({name: 'design', params: {id: new_id}})
}

const edit_in_place = async () => {
    // Destructive: overwrite the live design's content with this version's frozen content
    if (!await confirm_dialog(t("This will overwrite the current design's content with this version's. "
            + "Any existing changes will be lost. Continue?"))){
        return
    }
    await restore_version_into_design(props.design_id, props.version)
    // ?edit=1 tells ViewDesign.vue to force the editor open even though the design now matches
    // a rendered version (design_needs_editor would otherwise read false straight after restore)
    await router.push({name: 'design', params: {id: props.design_id}, query: {edit: '1'}})
}

const remove = async () => {
    await delete_version(props.version.id)
}

const share = async () => {
    // Prefer the OS share sheet or clipboard; only open a dialog if neither is available
    const result = await share_version(props.design_id, props.version.id)
    if (result === 'copied'){
        show_toast(t("Copied!"))
    } else if (result === 'manual'){
        show_share.value = true
    }
}


</script>


<style lang='sass' scoped>

.status
    width: 48px
    display: inline-flex
    justify-content: center
    align-items: center

.v-progress-circular
    margin: 8px

</style>
