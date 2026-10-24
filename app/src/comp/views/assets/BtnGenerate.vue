
<template lang='pug'>

v-btn-group(rounded='pill' divided color='secondary-darken-1' variant='elevated')
    v-btn(@click='click' :disabled='!blue.content.length || !typst_generator || blocked'
            :loading='build_starting')
        | {{ previews ? $t("view.design.preview") : $t("view.design.build_it") }}
    v-btn(v-if='latest_version' @click='view_versions' icon
            v-tooltip:top='$t("common.versions")')
        app-icon(name='history_toggle_off')

</template>


<script lang='ts' setup>

import {computed} from 'vue'
import {useRouter} from 'vue-router'

import {blue, state} from '@/services/state'
import {current_design_id} from '@/services/designs'
import {latest_version} from '@/services/versions'
import {typst_generator} from '@/services/typst'
import {collect_passage_books, has_missing_books} from '@/services/blueprints'
import {build_design, build_starting} from '@/services/build'
import {server_mode} from '@/services/compile_mode'
import {use_is_mobile} from '@/services/display'


const router = useRouter()
const is_mobile = use_is_mobile()


// Whether a selected translation is missing one of the chosen books (disables the Build it button;
// the specifics are shown in place of the preview and under the translations selector)
const blocked = computed(() => {
    return has_missing_books(collect_passage_books(blue.content), blue.bibles)
})


// Whether this button previews rather than builds: on a phone, which has no live preview to see
// the design in first, unless it builds on the server (where phase 1 has nothing to preview with)
const previews = computed(() => is_mobile.value && !server_mode.value)


const view_versions = async () => {
    // Jump to the latest rendered version (leaves the editor without discarding any changes)
    if (current_design_id.value && latest_version.value){
        await router.push({name: 'design',
            params: {id: current_design_id.value, version: latest_version.value.id}})
    }
}

const click = () => {
    // Open the phone's preview (it has its own Build it), or build straight away
    if (previews.value){
        state.phone_preview = true
    } else {
        void build_design(router)
    }
}

</script>



<style lang='sss' scoped>

</style>
