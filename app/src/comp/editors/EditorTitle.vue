<template lang='pug'>

v-card-title(class='d-flex justify-space-between align-center')
    | {{$t("Edit title page")}}
    v-btn(@click='done' size='large' variant='text' color='secondary') {{$t("Done")}}

v-divider

v-card-text(class='overflow-y-auto')
    div
        v-text-field(v-model='item.title' :label='$t("Title")')
    div
        v-text-field(v-model='item.title_subtitle' :label='$t("Subtitle")')
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


.v-text-field
    margin-bottom: 24px

</style>
