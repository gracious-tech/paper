
<template lang='pug'>

DisplayHelp.display

div.cont
    p This is a free app for printing Scripture. We highly recommend watching the very short introduction video before using it.

    v-divider

    div
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
    margin: 24px
    overflow: auto

    ol, ul
        padding-inline-start: 40px

    h2
        margin-top: 1em
        margin-bottom: 0.2em

    .v-divider
        margin: 24px 0

    .v-btn
        margin: 6px

.display
    display: none
    width: 100%
    aspect-ratio: 16 / 9
    @media (max-width: 900px)
        display: block

</style>
