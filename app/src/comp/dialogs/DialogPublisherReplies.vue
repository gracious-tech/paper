
<template lang='pug'>

//- English only, like the commercial translations it explains, so not run through i18n
//- (i18n-ignore-file)
v-dialog(v-model='dialog' activator='parent' max-width='800' scrollable)
    v-card
        template(#title) Replies from publishers
        template(#text)
            PublisherReplies
        template(#actions)
            v-spacer
            v-btn(@click='dialog = false') Close

</template>


<script lang='ts' setup>

import {ref} from 'vue'

import PublisherReplies from '@/comp/reuseable/PublisherReplies.vue'


// Shown from DialogPeddlers, so users can read the owners' reasons in their own words without
// leaving what they were doing (the same content is shareable as the /publishers page)
const dialog = ref(false)

</script>


<style lang='sss' scoped>


</style>
