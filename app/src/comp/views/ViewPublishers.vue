
<template lang='pug'>

div.cont(class='text-body-medium')

    div(class='ma-6')

        //- Back to the About page, which links here
        v-btn.back(:to='{name: "about"}' variant='tonal' class='mb-6')
            template(#prepend)
                AppIcon(name='arrow_back')
            | {{$t("app.about")}}

        h1(class='text-headline-small mb-4') Replies from publishers

        PublisherReplies

</template>


<script lang='ts' setup>

import PublisherReplies from '@/comp/reuseable/PublisherReplies.vue'

// Shareable page version of DialogPublisherReplies, for linking people to the owners' replies

</script>


<style lang='sss' scoped>

.cont
    flex-grow: 1
    overflow: auto

</style>
