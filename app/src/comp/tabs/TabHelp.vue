
<template lang='pug'>

div.cont(class='text-body-2')

    DisplayHelp.display

    div(class='ma-6')

        p(class='text-body-1 mb-4') {{$t("This is a free app for printing Scripture and we highly recommend watching the very short introduction video before using it.")}}

        div(class='mb-6')
            v-btn(href='https://gracious.tech' target='_blank' variant='outlined'
                size='small') {{$t("Creator")}}
            v-btn(href='https://gracious.tech/support/' target='_blank' variant='outlined'
                size='small') {{$t("Contact")}}
            v-btn(href='https://github.com/gracious-tech/paper' target='_blank' variant='outlined'
                size='small') {{$t("Source code")}}

        v-alert(color='secondary') {{$t("This app is still in beta so it may have some rough edges. Please contact us if you encounter any issues.")}}

        v-divider

        h3(class='text-h6') Printing &amp; Binding

        h4(class='text-subtitle-2') My booklet's pages are out of order
        p The order of pages will only make sense once the booklet has been folded. It is correct if you see the first and last pages at the start of the document and the middle pages at the end. It's also correct if you see some blank pages at the start as these are needed to ensure pages are paired correctly when opened.

        h4(class='text-subtitle-2') Some pages are upside down
        p The setting for double sided printing is likely incorrect. When printing a booklet it needs to be set to flip on "short edge" since the document is in landscape.

        h4(class='text-subtitle-2') How do I bind my booklet?
        p Please watch the introduction video for a simple method using a common household stapler and eraser.

        h4(class='text-subtitle-2') My booklet is too difficult to fold
        p You should experiment with the following, printing test pages before trying to print the whole document again:
        ol
            li Reduce the font size and/or line height
            li Experiment with other settings like margins and layout
            li Buy thinner paper (e.g. 70gsm / 18lb)
            li Separate your content into two different booklets

        h3(class='text-h6') Missing translations/books

        h4(class='text-subtitle-2') The translation I want isn't available
        p We can only legally add openly licensed translations. Many popular translations are under restrictive copyright and the publishers do not want you to be able to print portions of them yourself. We know as #[a(href='https://sellingjesus.org/articles/bible-publishers' target='_blank') we asked them]. You should consider switching to a trustworthy alternative like the #[a(href='https://bsb.freely.giving/' target='_blank') Berean Standard Bible] for English.

        h4(class='text-subtitle-2') Some books of the Bible aren't available
        p We try to include all books of the Protestant canon for every translation. Many translations are missing books due to not being completed by the translators. In rare cases there may have been a problem digitizing a particular book. Feel free to contact us if you are not sure why a particular book isn't available.

        h3(class='text-h6') App Usage

        h4(class='text-subtitle-2') The app is taking a long time to finish a creation
        p If it is still going after {{ MAX_MINUTES }} minutes then something is wrong and you should contact us. If it fails to complete then the creation was too large or complex. This is more likely to happen when there is a combination of large books, multiple translations, and study notes enabled. Try breaking the content into separate documents.

        h4(class='text-subtitle-2') How do I print the whole Bible?
        p This app is best used for printing portions of Scripture or individual books. While you can technically add all books into one document, it would need to be professionally printed and even then might exceed the limits of some services.

        h4(class='text-subtitle-2') What does the number next to my creation mean?
        p The number is how many sheets of paper you'll need to print the document. When printing in booklet format, each sheet will have 4 pages on it, and it will show a color for how easy the booklet will be to fold. Green numbers (<span class='text-green'>1-15</span>) are easy to fold, orange numbers (<span class='text-orange'>16-20</span>) are harder to fold, and red numbers (<span class='text-red'>20+</span>) will likely be too difficult to fold.

        div(class='mb-16')

</template>


<script lang='ts' setup>

import DisplayHelp from '@/comp/display/DisplayHelp.vue'
import {MAX_MINUTES} from '@/services/create'

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

    h3
        margin-top: 24px

    h4
        margin-top: 18px

    .v-btn
        margin: 6px

.display
    display: none
    width: 100%
    aspect-ratio: 16 / 9
    @media (max-width: 900px)
        display: block

</style>
