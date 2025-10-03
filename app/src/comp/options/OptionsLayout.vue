<template lang='pug'>

v-radio-group(v-model='columns' inline :label='$t("Columns")' class='my-4'
        :disabled='blue.bibles_layout === "columns" && blue.bibles.length > 1')
    v-radio(value='null' :label='$t("Auto")')
    v-radio(value='false' :label='$t("One")')
    v-radio(value='true' :label='$t("Two")')
p(class='text-body-2 text-disabled') {{ $t("Auto will use two columns only for poetic books") }}

v-radio-group(v-model='blue.bibles_layout' inline :label='$t("Layout for multiple translations")'
        :disabled='blue.bibles.length < 2' class='my-6')
    v-radio(value='columns' :label='$t("Separate columns")')
    v-radio(value='alternate' :label='$t("Separate pages")')

v-checkbox(v-model='blue.half_blank' :label='$t("Keep right-side blank for notetaking")'
    :disabled='blue.bibles.length > 1 && blue.bibles_layout === "alternate"')

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {blue} from '@/services/state'


const columns = computed({
    get: () => String(blue.columns),
    set: value => {
        blue.columns = value === 'null' ? null : (value === 'true')
    },
})


</script>


<style lang='sass' scoped>



</style>
