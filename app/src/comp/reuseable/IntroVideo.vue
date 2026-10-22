<template lang='pug'>

YouTubeVideo(v-if='youtube_id' :id='youtube_id')
iframe(v-else src='https://lets.church/embed/media/qPtUkv7Dvsu6inaAoME6Dy' allowfullscreen
    allow='fullscreen; picture-in-picture')

</template>


<script lang='ts' setup>

import {computed} from 'vue'

import {useI18n} from '@/services/i18n'
import YouTubeVideo from '@/comp/reuseable/YouTubeVideo.vue'


// The intro video in other languages, by UI locale (English is hosted on lets.church, which is
// also the fallback for any locale not listed)
const YOUTUBE_IDS:Record<string, string> = {
}

const {locale} = useI18n()

// The current UI locale's YouTube video, if it has one
const youtube_id = computed(() => YOUTUBE_IDS[locale.value])

</script>


<style lang='sss' scoped>


</style>
