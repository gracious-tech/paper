<template lang='pug'>

v-card-title(class='d-flex justify-space-between align-center')
    | {{$t("editor.title.edit")}}
    v-btn(@click='done' size='large' variant='text' color='secondary') {{$t("common.done")}}

v-divider

v-card-text(class='overflow-y-auto')
    div(class='mb-6')
        v-text-field(v-model='item.title' :label='$t("common.title")')
    div(class='mb-6')
        v-text-field(v-model='item.title_subtitle' :label='$t("common.subtitle")')
    IconField(v-model:icon='item.title_icon')

</template>


<script lang='ts' setup>

import IconField from '@/comp/editors/assets/IconField.vue'

import type {ContentTitle} from '@/services/types'
import {state} from '@/services/state'


defineProps<{item:ContentTitle}>()


const done = () => {
    state.editor = null
}

</script>


<style lang='sass' scoped>

.v-card-text
    padding-bottom: 30vh

</style>
