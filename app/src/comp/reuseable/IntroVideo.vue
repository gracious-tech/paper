
<template lang='pug'>

div.iframe-cont
    iframe(src='https://lets.church/embed/media/tUicmDVEPFpU94xcCpJQzx' allowfullscreen
        allow='fullscreen; picture-in-picture')

</template>


<script lang='ts' setup>




</script>


<style lang='sass' scoped>


// Centers the video within whatever space the parent gives this component (which must have a
// definite size, as the video is sized relative to it)
.iframe-cont
    container-type: size
    display: flex
    align-items: center
    justify-content: center

// Always exactly 16/9, shrunk to fit whatever aspect the container happens to be
iframe
    aspect-ratio: 16 / 9
    // Fit by width when the container is taller than 16/9, by height when it is wider
    width: min(100cqw, 100cqh * 16 / 9)
    border-style: none
    display: block


</style>
