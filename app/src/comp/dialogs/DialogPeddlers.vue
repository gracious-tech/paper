
<template lang='pug'>

v-dialog(v-model='dialog' activator='parent' max-width='800')
    v-card
        template(#title) {{ $t("dialog.peddlers.title") }}
        template(#text)
            p(class='text-body-large' v-html='$t("dialog.peddlers.body1")')
            p(class='text-body-large mt-2' v-html='$t("dialog.peddlers.body2", {bsb: bsb_link})')
        template(#actions)
            v-spacer
            v-btn(@click='dialog = false') {{ $t("common.close") }}
            v-btn(href='https://sellingjesus.org/articles/bible-publishers' target='_blank'
                color='secondary') {{ $t("dialog.peddlers.learn_more") }}

</template>


<script lang='ts' setup>

import {ref} from 'vue'


// Shown from the Bible picker when a user wants a commercial translation we can't include
const dialog = ref(false)

//- Inline link to the recommended translation, substituted into the {bsb} placeholder
const bsb_link = '<a href="https://bsb.freely.giving" target="_blank" rel="noopener">Berean Standard Bible</a>'

</script>


<style lang='sass' scoped>


</style>
