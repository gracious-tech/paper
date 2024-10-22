
<template lang='pug'>

div.cont(class='text-body-2')

    DisplayHelp.display

    div(class='ma-6')

        p(class='text-body-1') This is a free app for printing Scripture and we <strong>highly recommend</strong> watching the very short introduction video before using it.

        v-divider

        h3(class='text-h6 mb-5') Common Issues

        h4(class='text-subtitle-2') My booklet's pages are out of order
        p The order of pages will only make sense once the booklet has been folded. It is correct if you see the first and last pages at the start of the document and the middle pages at the end. It's also correct if you see some blank pages at the start as these are needed to ensure pages are paired correctly when opened.

        h4(class='text-subtitle-2') Some pages are upside down
        p The setting for double sided printing is likely incorrect. When printing a booklet it needs to be set to flip on "short edge" since the document is in landscape.

        h4(class='text-subtitle-2') How do I bind my booklet?
        p Please watch the introduction video for a simple method using a common household stapler and eraser.

        h4(class='text-subtitle-2') The translation I want isn't available
        p We can only legally add openly licensed translations. Many popular translations are under restrictive copyright and the publishers do not want you to be able to print portions of them yourself. We know as #[a(href='https://sellingjesus.org/articles/bible-publishers' target='_blank') we asked them]. You should consider switching to a trustworthy alternative like the #[a(href='https://bereanbibles.com/about-berean-study-bible/' target='_blank') Berean Standard Bible] for English.

        h4(class='text-subtitle-2') How do I print the whole Bible?
        p This app is best used for printing portions of Scripture or individual books. While you can technically add all books into one document, it would need to be professionally printed and even then might exceed the limits of some services.

        v-divider

        div(class='mb-16')
            v-btn(href='https://gracious.tech' target='_blank' variant='outlined' size='small') Creator
            v-btn(href='https://gracious.tech/support/' target='_blank' variant='outlined' size='small') Contact
            v-btn(href='https://github.com/gracious-tech/paper' target='_blank' variant='outlined' size='small') Source code

</template>


<script lang='ts' setup>

import DisplayHelp from '@/comp/display/DisplayHelp.vue'


</script>


<style lang='sass' scoped>

.cont
    flex-grow: 1
    overflow: auto

    ol, ul
        padding-inline-start: 40px

    h2
        margin-top: 1em
        margin-bottom: 0.2em

    .v-divider
        margin: 24px 0

    .text-subtitle-2
        margin-top: 24px

    .v-btn
        margin: 6px

.display
    display: none
    width: 100%
    aspect-ratio: 16 / 9
    @media (max-width: 900px)
        display: block

</style>
