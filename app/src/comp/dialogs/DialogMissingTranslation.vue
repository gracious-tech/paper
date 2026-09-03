
<template lang='pug'>

v-dialog(v-model='dialog' activator='parent' max-width='800')
    v-card
        template(#title) {{ $t("dialog.missing_translation.title") }}
        template(#text)
            p(class='text-body-large') {{ $t("dialog.missing_translation.body1") }}
            p(class='text-body-large mt-2') {{ $t("dialog.missing_translation.body2") }}
        template(#actions)
            v-spacer
            v-btn(@click='dialog = false') {{ $t("common.close") }}
            v-btn(href='https://sellingjesus.org/articles/bible-publishers' target='_blank'
                color='secondary') {{ $t("dialog.missing_translation.learn_more") }}

</template>


<script lang='ts' setup>

import {ref} from 'vue'


// Shown from the Bible picker when a user's desired translation/language isn't listed
const dialog = ref(false)

</script>


<style lang='sass' scoped>


</style>
