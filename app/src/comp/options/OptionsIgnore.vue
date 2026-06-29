
<template lang='pug'>

v-checkbox(v-model='blue.public_domain' class='mt-4'
    :label='$t("Dedicate your own content to the public domain")')

p(class='text-body-2 text-medium-emphasis') {{$t("It's recommended to leave this checked so anyone can copy and share your creation without any further restrictions than the Bible translations themselves require. This has no effect on the licenses of third-party material you use, such as Bible translations.")}}

v-checkbox(v-model='blue.app_link' :label='$t(`Include "Created with /paper.bible/"`)' class='mt-4')

</template>


<script lang='ts' setup>

import {blue} from '@/services/state'

</script>


<style lang='sass' scoped>



</style>
