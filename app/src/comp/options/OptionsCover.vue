
<template lang='pug'>

//- Cover is optional — no cover by default, and removable once added
template(v-if='blue.cover')
    p.hint {{$t("options.cover.has_cover")}}
    div.actions
        v-btn(@click='open_editor' variant='tonal' color='secondary') {{$t("options.cover.edit_cover")}}
        v-btn(@click='remove_cover' variant='text') {{$t("options.cover.remove_cover")}}
template(v-else)
    p.hint {{$t("options.cover.intro")}}
    v-btn(@click='open_editor' variant='tonal' color='secondary') {{$t("options.cover.add_cover")}}

</template>


<script lang='ts' setup>

import {useI18n} from '@/services/i18n'

import {blue, state, confirm_dialog} from '@/services/state'


const {t} = useI18n()


// Open the embedded cover editor as a full-window overlay (DialogCoverEditor)
const open_editor = () => {
    state.cover_editor = true
}


// Remove the cover from the design (the config is discarded, not just disabled)
const remove_cover = async () => {
    if (await confirm_dialog(t("options.cover.remove_confirm"))){
        blue.cover = null
    }
}

</script>


<style lang='sass' scoped>

.hint
    font-size: 14px
    opacity: 0.8
    margin-bottom: 12px

.actions
    display: flex
    gap: 12px

</style>
