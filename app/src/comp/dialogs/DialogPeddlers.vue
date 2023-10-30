
<template lang='pug'>

v-dialog(v-model='dialog' activator='parent' max-width='800')
    v-card
        template(#title) Commercial translations
        template(#text)
            p We have a policy of not including commercial translations as they are illegal to share. This unfortunately includes the most popular English translations, such as the NIV, ESV, NLT, etc. We instead highly recommend the Berean Standard Bible which has a translation style between the NIV and ESV, and is trustworthy and free to share.
        template(#actions)
            v-spacer
            v-btn(@click='dialog = false') Close
            v-btn(href='https://sellingjesus.org/articles/bible-publishers' target='_blank' color='secondary') Learn More

</template>


<script lang='ts' setup>

import {computed, ref} from 'vue'


const dialog = ref(false)

</script>


<style lang='sass' scoped>


</style>
