
<template lang='pug'>

v-dialog(v-model='dialog' activator='parent' max-width='800')
    v-card
        template(#title) Commercial translations
        template(#text)
            p We cannot include commercial translations as the owners do not wish for you to be able to print them, whole or in part. This unfortunately includes the most popular English translations, such as the NIV, ESV, NLT, etc. We instead highly recommend the <a href='https://bsb.freely.giving' target='_blank'>Berean Standard Bible</a> which has a translation style between the NIV and ESV, and is trustworthy and free to share.
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
