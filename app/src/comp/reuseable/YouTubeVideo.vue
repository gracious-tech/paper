<template lang='pug'>

//- strict-origin: YouTube refuses to play without a referrer, but only the origin is sent, never
//- the page's path (which can hold a version id). Sandboxed to what the player needs: popups
//- for its "Watch on YouTube" link, presentation for casting
iframe(:src='src' allowfullscreen referrerpolicy='strict-origin'
    allow='fullscreen; picture-in-picture; encrypted-media'
    sandbox='allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox')

</template>


<script lang='ts' setup>

import {computed} from 'vue'


const props = defineProps<{
    id:string
}>()

// The privacy-enhanced domain (no cookies until playback), related videos limited to the same
// channel, and no annotations
// WARN No hl/cc_lang_pref: either can lead the player to switch captions on by default
const src = computed(() => {
    const params = new URLSearchParams({
        rel: '0',
        iv_load_policy: '3',
        playsinline: '1',
    })
    return `https://www.youtube-nocookie.com/embed/${props.id}?${params.toString()}`
})

</script>


<style lang='sss' scoped>

iframe
    border-style: none
    display: block

</style>
