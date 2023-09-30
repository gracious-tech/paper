
<template lang='pug'>

v-select(v-model='blue.license' :items='licenses' variant='outlined'
    label="License of custom content" density='compact' class='mt-6 mb-4'
    :disabled='translation_forbids_derivatives')

v-text-field(v-model='blue.license_attribution' label="Name of creator" class='my-4'
    :disabled='translation_forbids_derivatives')

p(class='text-body-2 text-medium-emphasis') It's recommended to leave this as "Public Domain" so anyone can copy and share your creation without any further restrictions than the Bible translations themselves require. This has no effect on the licenses of third-party material you use, such as Bible translations.

v-checkbox(v-model='blue.app_link' label='Include "Created with /paper.bible/"' class='mt-4')

</template>


<script lang='ts' setup>

import {blue, translation_forbids_derivatives} from '@/services/state'


const licenses = [
    {value: 'public', title: "Public Domain"},
    {value: 'cc-by', title: "CC Attribution"},
    {value: 'cc-by-sa', title: "CC Attribution ShareAlike"},
    {value: 'cc-by-nc', title: "CC Attribution NonCommercial"},
    {value: 'cc-by-nc-sa', title: "CC Attribution NonCommercial ShareAlike"},
    {value: 'custom', title: "Custom"},
]

</script>


<style lang='sass' scoped>



</style>
