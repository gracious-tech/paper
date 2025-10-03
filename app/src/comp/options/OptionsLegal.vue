
<template lang='pug'>

v-text-field(v-model='blue.license_attribution' :label='$t("Name of creator")' class='my-4'
    :disabled='translation_forbids_derivatives')

v-select(v-model='blue.license' :items='licenses' variant='outlined'
    :label='$t("License of custom content")' density='compact' class='mt-6 mb-4'
    :disabled='translation_forbids_derivatives')

p(class='text-body-2 text-medium-emphasis') {{$t("It's recommended to leave this as \"Public Domain\" so anyone can copy and share your creation without any further restrictions than the Bible translations themselves require. This has no effect on the licenses of third-party material you use, such as Bible translations.")}}

v-checkbox(v-model='blue.app_link' :label='$t(`Include "Created with /paper.bible/"`)' class='mt-4')

</template>


<script lang='ts' setup>

import {useI18n} from 'vue-i18n'

import {blue, translation_forbids_derivatives} from '@/services/state'


const {t} = useI18n()


const licenses = [
    {value: 'public', title: "Public Domain"},
    {value: 'cc-by', title: "CC Attribution"},
    {value: 'cc-by-sa', title: "CC Attribution ShareAlike"},
    {value: 'cc-by-nc', title: "CC Attribution NonCommercial"},
    {value: 'cc-by-nc-sa', title: "CC Attribution NonCommercial ShareAlike"},
    {value: 'custom', title: t("Will specify own terms (not recommended)")},
]

</script>


<style lang='sass' scoped>



</style>
